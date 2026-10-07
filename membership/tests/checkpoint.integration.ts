import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Client } from "pg";

const socket = process.env.MEMBERSHIP_TEST_PG_SOCKET;
if (!socket?.startsWith("/private/tmp/"))
  throw new Error("Disposable local PostgreSQL socket required");
const connectionString = `postgresql://membership_test_ingest@localhost/membership_test?host=${encodeURIComponent(socket)}&port=55439`;

async function runner(
  seedDir: string,
  options: {
    failBacklog?: boolean;
    stopAfterRefresh?: boolean;
    expectedExit?: number;
  } = {},
) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/run-catalogue.ts"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        INGEST_DATABASE_URL: connectionString,
        MEMBERSHIP_EXPECTED_DB_HOST: "localhost",
        CATALOGUE_SOURCES: "ppa",
        CATALOGUE_RECENT_DETAILS: "1",
        CATALOGUE_BACKLOG_DETAILS: "1",
        CATALOGUE_SEED_STATE_DIR: seedDir,
        ...(options.failBacklog ? { CATALOGUE_TEST_FAIL_BACKLOG: "1" } : {}),
        ...(options.stopAfterRefresh
          ? { CATALOGUE_TEST_STOP_AFTER_REFRESH: "1" }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, options.expectedExit ?? 0, output.slice(-3000));
  return output;
}

test("scheduled catalogue restores a checkpoint, imports once, and resumes a backlog phase", async () => {
  const temp = await mkdtemp("/private/tmp/ktebli-catalogue-checkpoint-");
  const admin = new Client({
    host: socket,
    port: 55439,
    database: "membership_test",
    user: "Tamam",
  });
  await admin.connect();
  try {
    const record = JSON.parse(
      await readFile("tests/fixtures/ppa-matching.json", "utf8"),
    );
    const now = new Date().toISOString();
    record.fetchedAt = now;
    record.locales = record.locales.map((locale: Record<string, unknown>) => ({
      ...locale,
      detailStatus: "verified",
      detailNeedsRefresh: false,
      detailFetchedAt: now,
    }));
    const state = {
      version: 1,
      records: { [record.sourceKey]: record },
      streams: Object.fromEntries(
        ["en", "ar"].map((locale) => [
          `ppa:${locale}`,
          {
            source: "ppa",
            locale,
            cursor: null,
            status: "complete",
            pages: 1,
            seen: [record.sourceKey],
            fingerprints: [],
            expectedTotal: 1,
          },
        ]),
      ),
    };
    await writeFile(`${temp}/ppa.json`, JSON.stringify(state), { mode: 0o600 });
    await admin.query(
      "DELETE FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    await runner(temp);
    const first = await admin.query(
      "SELECT phase,last_status,revision,octet_length(state_gzip) AS bytes FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    assert.equal(first.rows[0].phase, "imported");
    assert.equal(first.rows[0].last_status, "imported");
    assert.ok(Number(first.rows[0].bytes) > 0);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM membership.opportunities WHERE source_key=$1",
          [record.sourceKey],
        )
      ).rows[0].n,
      1,
    );
    // Simulate a runner stopped after the recent pass. The next invocation
    // must finish backlog/import from the saved state instead of refreshing.
    await admin.query(
      "UPDATE membership.crawler_checkpoints SET phase='backlog',last_status='pending' WHERE source='ppa'",
    );
    await runner(temp);
    const resumed = await admin.query(
      "SELECT phase,last_status,revision FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    assert.equal(resumed.rows[0].phase, "imported");
    assert.ok(
      BigInt(resumed.rows[0].revision) > BigInt(first.rows[0].revision),
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM membership.opportunities WHERE source_key=$1",
          [record.sourceKey],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await admin.end();
    await rm(temp, { recursive: true, force: true });
  }
});

test("failed historical pass retains fresh import and next daily cycle refreshes listings", async () => {
  const temp = await mkdtemp("/private/tmp/ktebli-catalogue-backlog-fail-");
  const admin = new Client({
    host: socket,
    port: 55439,
    database: "membership_test",
    user: "Tamam",
  });
  await admin.connect();
  try {
    const record = JSON.parse(
      await readFile("tests/fixtures/ppa-matching.json", "utf8"),
    );
    const now = new Date().toISOString();
    record.fetchedAt = now;
    record.locales = record.locales.map((locale: Record<string, unknown>) => ({
      ...locale,
      detailStatus: "verified",
      detailNeedsRefresh: false,
      detailFetchedAt: now,
    }));
    const state = {
      version: 1,
      records: { [record.sourceKey]: record },
      streams: Object.fromEntries(
        ["en", "ar"].map((locale) => [
          `ppa:${locale}`,
          {
            source: "ppa",
            locale,
            cursor: null,
            status: "complete",
            pages: 1,
            seen: [record.sourceKey],
            fingerprints: [],
            expectedTotal: 1,
          },
        ]),
      ),
    };
    await writeFile(`${temp}/ppa.json`, JSON.stringify(state), { mode: 0o600 });
    await admin.query(
      "DELETE FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    await admin.query(
      "DELETE FROM membership.opportunities WHERE source_key=$1",
      [record.sourceKey],
    );
    await runner(temp, { failBacklog: true, expectedExit: 1 });
    const failed = await admin.query(
      "SELECT phase,last_status,last_import_at FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    assert.equal(failed.rows[0].phase, "backlog");
    assert.equal(failed.rows[0].last_status, "failed");
    assert.ok(failed.rows[0].last_import_at instanceof Date);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM membership.opportunities WHERE source_key=$1",
          [record.sourceKey],
        )
      ).rows[0].n,
      1,
    );
    await admin.query(
      "UPDATE membership.crawler_checkpoints SET last_run_at=now()-interval '2 days' WHERE source='ppa'",
    );
    await runner(temp, { stopAfterRefresh: true, expectedExit: 1 });
    const refreshed = await admin.query(
      "SELECT phase,last_import_at FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    assert.equal(refreshed.rows[0].phase, "listing");
    // A halted recent-detail pass also remains in listing phase. A new UTC
    // day must not keep reusing yesterday's complete listing ID set.
    await admin.query(
      "UPDATE membership.crawler_checkpoints SET phase='listing',last_run_at=now()-interval '2 days' WHERE source='ppa'",
    );
    await runner(temp, { stopAfterRefresh: true, expectedExit: 1 });
    const retry = await admin.query(
      "SELECT phase,last_run_at FROM membership.crawler_checkpoints WHERE source='ppa'",
    );
    assert.equal(retry.rows[0].phase, "listing");
    assert.ok(Date.now() - +retry.rows[0].last_run_at < 60000);
    assert.equal(
      +refreshed.rows[0].last_import_at,
      +failed.rows[0].last_import_at,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM membership.opportunities WHERE source_key=$1",
          [record.sourceKey],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await admin.end();
    await rm(temp, { recursive: true, force: true });
  }
});

test("malformed ingestion URL fails without echoing credential input", async () => {
  const marker = "not-a-url-secret-canary-987654321";
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/run-catalogue.ts"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        INGEST_DATABASE_URL: marker,
        MEMBERSHIP_EXPECTED_DB_HOST: "localhost",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise<number | null>((resolve) =>
    child.on("close", resolve),
  );
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /exact reviewed membership branch/);
  assert.ok(!stderr.includes(marker), "diagnostic must not echo URL input");
});
