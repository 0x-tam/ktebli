import { Client } from "pg";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeCrawlerState,
  encodeCrawlerState,
  ppaNeedsListingRefresh,
  ppaStreamsComplete,
  type CrawlPhase,
  type CrawlSource,
} from "../lib/crawler-checkpoint";
import {
  catalogueBatchSchema,
  mawredPageBatchSchema,
  ungmCuratedBatchSchema,
  worldBankBatchSchema,
} from "../lib/catalogue";

const connectionString = process.env.INGEST_DATABASE_URL;
const expectedHost = process.env.MEMBERSHIP_EXPECTED_DB_HOST;
let connectionHost: string | null = null;
try {
  if (connectionString) connectionHost = new URL(connectionString).hostname;
} catch {
  // Never let URL parser diagnostics include credential-bearing input.
}
if (
  !connectionString ||
  connectionString.includes("-pooler.") ||
  !expectedHost ||
  connectionHost !== expectedHost
)
  throw new Error(
    "Use the direct ingestion URL for the exact reviewed membership branch",
  );
function boundedDetails(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return String(value);
}
const recentDetails = boundedDetails("CATALOGUE_RECENT_DETAILS", 300, 500);
// The measured first GitHub request pace indicates a 100-detail archive slice could exceed
// the 80-minute runner budget after a full recent-detail refresh. Preserve
// today's qualified import and advance older evidence in a smaller daily slice.
const backlogDetails = boundedDetails("CATALOGUE_BACKLOG_DETAILS", 40, 300);
const sources = (
  process.env.CATALOGUE_SOURCES ?? "worldbank,mawred,ungm-curated,ppa"
).split(",");
const stopAt = Date.now() + 80 * 60 * 1000;
if (
  sources.length < 1 ||
  new Set(sources).size !== sources.length ||
  sources.some(
    (source) =>
      source !== "ppa" &&
      source !== "ungm-curated" &&
      source !== "mawred" &&
      source !== "worldbank",
  )
)
  throw new Error("CATALOGUE_SOURCES must name unique approved sources");
const stateDir = resolve("crawler/.state/scheduled");
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const client = new Client({ connectionString });
await client.connect();
await client.query("SET ROLE membership_ingest");
const locked = await client.query<{ locked: boolean }>(
  "SELECT pg_try_advisory_lock(hashtext('membership-public-catalogue-runner')) AS locked",
);
if (!locked.rows[0]?.locked) {
  await client.end();
  throw new Error("A catalogue runner already holds the source lock");
}

type Row = {
  state_gzip: Buffer;
  state_sha256: string;
  revision: string;
  phase: CrawlPhase;
  last_run_at: Date;
};
type Checkpoint = {
  source: CrawlSource;
  state: unknown;
  phase: CrawlPhase;
  revision: string;
  lastRunAt: Date;
};

async function checkpoint(source: CrawlSource): Promise<Checkpoint> {
  const prior = await client.query<Row>(
    "SELECT state_gzip,state_sha256,revision::text,phase,last_run_at FROM membership.crawler_checkpoints WHERE source=$1",
    [source],
  );
  if (prior.rows[0]) {
    const row = prior.rows[0];
    return {
      source,
      state: decodeCrawlerState(source, row.state_gzip, row.state_sha256),
      phase: row.phase,
      revision: row.revision,
      lastRunAt: row.last_run_at,
    };
  }
  const seedPath = process.env.CATALOGUE_SEED_STATE_DIR
    ? resolve(process.env.CATALOGUE_SEED_STATE_DIR, `${source}.json`)
    : null;
  let state: unknown;
  if (seedPath) {
    state = JSON.parse(await readFile(seedPath, "utf8"));
  } else if (source === "ppa") {
    // @ts-expect-error The separately tested crawler package is plain JavaScript.
    const { initialState } = await import("../crawler/src/run.mjs");
    state = initialState();
  } else if (source === "ungm-curated") {
    state = { version: 1, entries: {} };
  } else if (source === "worldbank") {
    state = {
      version: 1,
      entries: {},
      seen: [],
      total: null,
      status: "incomplete",
    };
  } else {
    state = { version: 1 };
  }
  const encoded = encodeCrawlerState(source, state);
  const added = await client.query<Row>(
    `INSERT INTO membership.crawler_checkpoints
     (source,state_gzip,state_sha256,phase,last_status)
     VALUES($1,$2,$3,'listing','pending') ON CONFLICT DO NOTHING
     RETURNING state_gzip,state_sha256,revision::text,phase,last_run_at`,
    [source, encoded.gzip, encoded.sha256],
  );
  if (!added.rows[0])
    throw new Error("Checkpoint appeared during exclusive run");
  return {
    source,
    state,
    phase: "listing",
    revision: added.rows[0].revision,
    lastRunAt: added.rows[0].last_run_at,
  };
}

async function persist(
  cp: Checkpoint,
  status: "pending" | "incomplete" | "failed" | "imported",
  coverage: unknown = {},
  error: string | null = null,
  imported = false,
) {
  const encoded = encodeCrawlerState(cp.source, cp.state);
  const updated = await client.query<{ revision: string }>(
    `UPDATE membership.crawler_checkpoints
     SET state_gzip=$3,state_sha256=$4,phase=$5,last_status=$6,
         coverage=$7,last_error=$8,last_run_at=now(),
         last_import_at=CASE WHEN $9 THEN now() ELSE last_import_at END,
         revision=revision+1
     WHERE source=$1 AND revision=$2 RETURNING revision::text`,
    [
      cp.source,
      cp.revision,
      encoded.gzip,
      encoded.sha256,
      cp.phase,
      status,
      JSON.stringify(coverage),
      error?.slice(0, 80) ?? null,
      imported,
    ],
  );
  if (!updated.rows[0]) throw new Error("Crawler checkpoint revision changed");
  cp.revision = updated.rows[0].revision;
  cp.lastRunAt = new Date();
}

async function importArtifact(outputPath: string) {
  const imported = await runProcess(resolve("."), [
    "--import",
    "tsx",
    "scripts/import-catalog.ts",
    outputPath,
  ]);
  if (imported.exitCode !== 0) throw new Error("catalogue_import_failed");
}

async function runProcess(
  cwd: string,
  args: string[],
  onTick?: () => Promise<void>,
) {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "production",
  };
  if (cwd === resolve(".")) environment.INGEST_DATABASE_URL = connectionString;
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-8000);
    });
  let tickFailure: unknown;
  let ticking = Promise.resolve();
  let stoppedForBudget = false;
  const stopTimer = setTimeout(
    () => {
      stoppedForBudget = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10000).unref();
    },
    Math.max(1, stopAt - Date.now()),
  );
  const timer = onTick
    ? setInterval(() => {
        ticking = ticking.then(onTick).catch((error: unknown) => {
          tickFailure = error;
          child.kill("SIGTERM");
        });
      }, 30000)
    : null;
  const exitCode = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => done(code));
  }).finally(() => {
    if (timer) clearInterval(timer);
    clearTimeout(stopTimer);
  });
  await ticking;
  if (tickFailure) throw tickFailure;
  if (onTick) await onTick();
  if (stoppedForBudget) throw new Error("run_time_budget");
  return { exitCode, output };
}

async function runSource(source: CrawlSource) {
  const startedAt = Date.now();
  const cp = await checkpoint(source);
  const statePath = resolve(stateDir, `${source}.json`);
  const outputPath = resolve(stateDir, `${source}-output.json`);
  if (
    source === "ppa" &&
    ppaNeedsListingRefresh(cp.phase, cp.lastRunAt, new Date())
  ) {
    // @ts-expect-error The separately tested crawler package is plain JavaScript.
    const { refreshState } = await import("../crawler/src/run.mjs");
    cp.state = refreshState(cp.state, ["ppa"]);
    cp.phase = "listing";
    await persist(cp, "pending");
    if (
      process.env.NODE_ENV === "test" &&
      process.env.CATALOGUE_TEST_STOP_AFTER_REFRESH === "1"
    )
      throw new Error("test_stop_after_refresh");
  } else if (source !== "ppa" && cp.phase === "imported") {
    cp.phase = "listing";
    await persist(cp, "pending");
  }
  await writeFile(statePath, JSON.stringify(cp.state), { mode: 0o600 });
  const saveProgress = async () => {
    const next = JSON.parse(await readFile(statePath, "utf8"));
    const encoded = encodeCrawlerState(source, next);
    const current = encodeCrawlerState(source, cp.state);
    if (encoded.sha256 === current.sha256) return;
    cp.state = next;
    await persist(cp, "pending");
  };
  const crawlDir = resolve("crawler");
  const cutoff = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (source === "ppa" && cp.phase === "listing") {
    await rm(outputPath, { force: true });
    const result = await runProcess(
      crawlDir,
      [
        "src/cli.mjs",
        "--sources",
        "ppa",
        "--state",
        statePath,
        "--output",
        outputPath,
        "--max-pages",
        "60",
        "--enrich",
        "--max-details",
        recentDetails,
        "--published-since",
        cutoff,
        ...(ppaStreamsComplete(cp.state) ? [] : ["--retry-blocked"]),
      ],
      saveProgress,
    );
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    if (result.exitCode !== 0 || !ppaStreamsComplete(cp.state)) {
      await persist(
        cp,
        "incomplete",
        output.coverage,
        "ppa_listing_incomplete",
      );
      throw new Error(
        `PPA listing remains incomplete (exit ${result.exitCode})`,
      );
    }
    catalogueBatchSchema.parse(output);
    await importArtifact(outputPath);
    cp.phase = "backlog";
    await persist(cp, "pending", output.coverage, null, true);
    if (
      process.env.NODE_ENV === "test" &&
      process.env.CATALOGUE_TEST_FAIL_BACKLOG === "1"
    )
      throw new Error("test_backlog_failure");
  }
  if (source === "ppa" && cp.phase === "backlog") {
    await rm(outputPath, { force: true });
    const result = await runProcess(
      crawlDir,
      [
        "src/cli.mjs",
        "--sources",
        "ppa",
        "--state",
        statePath,
        "--output",
        outputPath,
        "--max-pages",
        "60",
        "--enrich",
        "--max-details",
        backlogDetails,
        "--published-before",
        cutoff,
      ],
      saveProgress,
    );
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    if (result.exitCode !== 0 || !ppaStreamsComplete(cp.state)) {
      await persist(
        cp,
        "incomplete",
        output.coverage,
        "ppa_backlog_incomplete",
      );
      throw new Error(`PPA backlog pass incomplete (exit ${result.exitCode})`);
    }
    catalogueBatchSchema.parse(output);
  }
  if (source === "ungm-curated") {
    await rm(outputPath, { force: true });
    const result = await runProcess(
      crawlDir,
      [
        "src/ungm-cli.mjs",
        "--state",
        statePath,
        "--output",
        outputPath,
        "--seeds",
        resolve(crawlDir, "fixtures/ungm-curated-seeds.json"),
        "--max-details",
        "12",
      ],
      saveProgress,
    );
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    if (result.exitCode !== 0) {
      await persist(
        cp,
        "incomplete",
        output.coverage,
        "ungm_curated_incomplete",
      );
      throw new Error(
        `Curated UNGM details remain incomplete (exit ${result.exitCode})`,
      );
    }
    const ids: string[] = JSON.parse(
      await readFile(
        resolve(crawlDir, "fixtures/ungm-curated-seeds.json"),
        "utf8",
      ),
    );
    ungmCuratedBatchSchema(ids).parse(output);
  }
  if (source === "mawred") {
    await rm(outputPath, { force: true });
    const result = await runProcess(
      crawlDir,
      [
        "src/mawred-cli.mjs",
        "--state",
        statePath,
        "--output",
        outputPath,
        "--refresh",
      ],
      saveProgress,
    );
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    if (result.exitCode !== 0) {
      await persist(
        cp,
        "incomplete",
        output.coverage,
        "mawred_page_incomplete",
      );
      throw new Error("mawred_page_incomplete");
    }
    mawredPageBatchSchema.parse(output);
  }
  if (source === "worldbank") {
    await rm(outputPath, { force: true });
    const result = await runProcess(
      crawlDir,
      [
        "src/worldbank-cli.mjs",
        "--state",
        statePath,
        "--output",
        outputPath,
        "--rows",
        "50",
        "--max-pages",
        "10",
      ],
      saveProgress,
    );
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    if (result.exitCode !== 0) {
      await persist(
        cp,
        "incomplete",
        output.coverage,
        "worldbank_api_incomplete",
      );
      throw new Error("worldbank_api_incomplete");
    }
    worldBankBatchSchema.parse(output);
  }
  await importArtifact(outputPath);
  const output = JSON.parse(await readFile(outputPath, "utf8"));
  cp.phase = "imported";
  await persist(cp, "imported", output.coverage, null, true);
  console.log(
    JSON.stringify({
      source,
      imported: output.records.length,
      phase: cp.phase,
      details: output.coverage.details ?? null,
      checkpointCompressedBytes: encodeCrawlerState(source, cp.state).gzip
        .length,
      elapsedMs: Date.now() - startedAt,
    }),
  );
}

try {
  for (const source of sources as CrawlSource[]) {
    try {
      await runSource(source);
    } catch (error) {
      const timedOut =
        error instanceof Error && error.message === "run_time_budget";
      await client.query(
        "UPDATE membership.crawler_checkpoints SET last_status=$2,last_error=$3,last_run_at=now() WHERE source=$1 AND last_status='pending'",
        [
          source,
          timedOut ? "incomplete" : "failed",
          timedOut ? "run_time_budget" : "runner_failed",
        ],
      );
      console.error(
        JSON.stringify({
          source,
          error: timedOut ? "run_time_budget" : "runner_failed",
        }),
      );
      process.exitCode = 1;
      if (timedOut) break;
    }
  }
} finally {
  await client.query(
    "SELECT pg_advisory_unlock(hashtext('membership-public-catalogue-runner'))",
  );
  await client.end();
}
