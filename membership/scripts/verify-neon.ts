// Read-only/rollback-only live provisioning checks; no real accounts or payments.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";

function readEnv(path: string) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}
let stage = "connect";
async function main() {
  const app = readEnv(".env.local");
  const job = readEnv(".env.worker.local");
  const pools = [
    app.DATABASE_URL,
    app.BILLING_DATABASE_URL,
    job.WORKER_DATABASE_URL,
  ].map((connectionString) => new Pool({ connectionString }));
  const results: Record<string, unknown> = {};
  async function denied(pool: Pool, sql: string) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await assert.rejects(
        db.query(sql),
        (error: { code: string }) => error.code === "42501",
      );
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  }
  try {
    await denied(pools[0], "SET LOCAL ROLE membership_billing");
    stage = "app cannot assume migration owner";
    await denied(pools[0], "SET LOCAL ROLE neondb_owner");
    stage = "billing cannot assume worker";
    await denied(pools[1], "SET LOCAL ROLE membership_worker");
    stage = "worker cannot assume billing";
    await denied(pools[2], "SET LOCAL ROLE membership_billing");
    results.loginRoleSwitchIsolation = "passed";
    stage = "table privilege isolation";
    for (const [pool, role, sql] of [
      [
        pools[0],
        "membership_runtime",
        "INSERT INTO membership.webhook_events(event_id,event_type) VALUES('setup-check','invoice.paid')",
      ],
      [pools[1], "membership_billing", "SELECT * FROM membership.profiles"],
      [
        pools[1],
        "membership_billing",
        "SELECT * FROM membership.opportunities",
      ],
      [
        pools[2],
        "membership_worker",
        "UPDATE membership.subscriptions SET state='active'",
      ],
      [pools[2], "membership_worker", "DELETE FROM membership.matching_spend"],
    ] as const) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(
          db.query(sql),
          (error: { code: string }) => error.code === "42501",
        );
      } finally {
        await db.query("ROLLBACK");
        db.release();
      }
    }
    results.tablePrivilegeSeparation = "passed";
    stage = "tenant isolation";
    const db = await pools[0].connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL ROLE membership_runtime");
      await db.query(
        "SELECT set_config('app.user_id','setup-check-alice',true)",
      );
      await db.query(
        "INSERT INTO membership.profiles(user_id,organization_name) VALUES('setup-check-alice','rollback-only check')",
      );
      assert.equal(
        (await db.query("SELECT user_id FROM membership.profiles")).rows.length,
        1,
      );
      await db.query("SELECT set_config('app.user_id','setup-check-bob',true)");
      assert.equal(
        (await db.query("SELECT user_id FROM membership.profiles")).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "UPDATE membership.profiles SET organization_name='forbidden' WHERE user_id='setup-check-alice'",
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        db.query(
          "INSERT INTO membership.profiles(user_id) VALUES('setup-check-alice-other')",
        ),
        (error: { code: string }) => error.code === "42501",
      );
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
    results.tenantIsolationRollbackOnly = "passed";
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
  }
  const cli = "/Users/Tamam/.nvm/versions/node/v20.19.4/bin/neon";
  const scope = [
    "--project-id",
    "green-shadow-66380714",
    "--branch",
    "br-falling-thunder-b19x4p2p",
    "-o",
    "json",
  ];
  stage = "localhost Auth policy";
  const localhost = JSON.parse(
    execFileSync(
      cli,
      ["neon-auth", "domain", "allow-localhost", "get", ...scope],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  results.authLocalhostPolicy = localhost;
  stage = "anonymous Auth session status";
  const session = await fetch(app.NEON_AUTH_BASE_URL + "/get-session");
  assert.equal(session.status, 200);
  stage = "anonymous Auth session response";
  assert.equal(await session.json(), null);
  results.authAnonymousSessionEndpoint = "passed: 200 with null session";
  stage = "root environment and private-file checks";
  const before = JSON.parse(
    readFileSync("/private/tmp/ktebli-root-env-before.json", "utf8"),
  );
  assert.equal(
    createHash("sha256").update(readFileSync("../.env.local")).digest("hex"),
    before.sha256,
  );
  results.rootEnvUnchanged = true;
  results.credentialFiles = [
    ".env.local",
    ".env.worker.local",
    ".env.migrations.local",
  ].map((path) => {
    const mode = (statSync(path).mode & 0o777).toString(8);
    assert.equal(mode, "600");
    return { path, mode };
  });
  const path = "reports/neon-provisioning.json";
  const report = JSON.parse(readFileSync(path, "utf8"));
  report.liveChecks = results;
  report.liveChecksAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(
    "Live restricted-role, tenant isolation, Auth availability and private environment checks passed.",
  );
}
main().catch((error) => {
  console.error(
    "Live verification stopped; error type/code only:",
    stage,
    error?.name,
    error?.code ?? null,
  );
  process.exitCode = 1;
});
