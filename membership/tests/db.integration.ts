import test from "node:test";
import { catalogueData, dashboardData } from "../lib/dashboard";
import { loadPublicOpportunityHandoff } from "../lib/opportunity-handoff";
import {
  matchingAlertSql,
  matchingCandidatesSql,
  matchingClaimEligibilitySql,
  matchingWriteSql,
} from "../lib/matching-candidates";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { readFile } from "node:fs/promises";
import {
  bindCreatedCheckoutSql,
  persistCheckoutRequestSql,
  bindReconciledSessionSql,
  releaseOrphanCreditSql,
  reserveCreditSql,
  redeemCreditSql,
  releaseCreditSql,
} from "../lib/credit-sql";
const socket = process.env.MEMBERSHIP_TEST_PG_SOCKET;
if (!socket?.startsWith("/private/tmp/"))
  throw new Error("A disposable local Unix socket is required");
const config = { host: socket, port: 55439, database: "membership_test" };
process.env.DATABASE_URL = `postgresql://membership_test_runtime@localhost/membership_test?host=${encodeURIComponent(socket)}&port=55439`;
const admin = new Pool({ ...config, user: "Tamam" });
const runtime = new Pool({ ...config, user: "membership_test_runtime" }),
  billing = new Pool({ ...config, user: "membership_test_billing" }),
  worker = new Pool({ ...config, user: "membership_test_worker" }),
  ingest = new Pool({ ...config, user: "membership_test_ingest" });
async function tx<T>(
  pool: Pool,
  role: string,
  user: string,
  run: (db: PoolClient) => Promise<T>,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query("SELECT set_config('app.user_id',$1,true)", [user]);
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
test("real Postgres: tenant isolation, privilege separation, idempotency and concurrent credit lifecycle", async () => {
  try {
    await admin.query("DROP SCHEMA IF EXISTS membership CASCADE");
    await admin.query(await readFile("db/001_membership.sql", "utf8"));
    await admin.query(await readFile("db/002_crawler_checkpoint.sql", "utf8"));
    await admin.query(await readFile("db/003_mawred_source.sql", "utf8"));
    await admin.query(await readFile("db/004_central_catalogue.sql", "utf8"));
    await admin.query(await readFile("db/005_worldwide_catalogue.sql", "utf8"));
    for (const [name, role] of [
      ["membership_test_runtime", "membership_runtime"],
      ["membership_test_billing", "membership_billing"],
      ["membership_test_worker", "membership_worker"],
      ["membership_test_ingest", "membership_ingest"],
    ]) {
      await admin.query(
        `DO $$ BEGIN CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT ${role} TO ${name}`,
      );
    }
    await admin.query(
      "INSERT INTO membership.profiles(user_id,organization_name) VALUES('alice','Alice'),('bob','Bob')",
    );
    assert.deepEqual(
      (
        await tx(runtime, "membership_runtime", "alice", (db) =>
          db.query("SELECT user_id FROM membership.profiles"),
        )
      ).rows,
      [{ user_id: "alice" }],
    );
    assert.equal(
      (
        await tx(runtime, "membership_runtime", "alice", (db) =>
          db.query(
            "UPDATE membership.profiles SET organization_name='stolen' WHERE user_id='bob'",
          ),
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      tx(runtime, "membership_runtime", "alice", (db) =>
        db.query(
          "UPDATE membership.profiles SET user_id='bob' WHERE user_id='alice'",
        ),
      ),
      /row-level security/,
    );
    await assert.rejects(
      tx(runtime, "membership_runtime", "alice", (db) =>
        db.query(
          "INSERT INTO membership.webhook_events VALUES('evt_attack','invoice.paid',now())",
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(runtime, "membership_runtime", "alice", (db) =>
        db.query(
          "INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at) VALUES('alice','fake',now(),now()+interval '1 month')",
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(billing, "membership_billing", "", (db) =>
        db.query("SELECT * FROM membership.profiles"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(billing, "membership_billing", "", (db) =>
        db.query("SELECT * FROM membership.opportunities"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(runtime, "membership_runtime", "alice", (db) =>
        db.query("SET LOCAL ROLE membership_billing"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(worker, "membership_worker", "", (db) =>
        db.query("UPDATE membership.subscriptions SET state='active'"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(worker, "membership_worker", "", (db) =>
        db.query(
          "INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at) VALUES('alice','fake',now(),now()+interval '1 month')",
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(worker, "membership_worker", "", (db) =>
        db.query("UPDATE membership.credits SET state='redeemed'"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(worker, "membership_worker", "", (db) =>
        db.query("DELETE FROM membership.matching_spend"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(ingest, "membership_ingest", "", (db) =>
        db.query("SELECT * FROM membership.profiles"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(ingest, "membership_ingest", "", (db) =>
        db.query("SELECT * FROM membership.subscriptions"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(ingest, "membership_ingest", "", (db) =>
        db.query(
          "INSERT INTO membership.matching_spend(user_id,opportunity_id,reserved_usd,profile_revision,content_hash) VALUES('alice',gen_random_uuid(),0.01,1,'x')",
        ),
      ),
      /permission denied/,
    );
    await tx(ingest, "membership_ingest", "", async (db) => {
      await db.query(
        "INSERT INTO membership.source_runs(coverage) VALUES('{}'::jsonb)",
      );
      await db.query(
        "INSERT INTO membership.crawler_checkpoints(source,state_gzip,state_sha256,phase,last_status) VALUES('ppa',decode('1f','hex'),repeat('a',64),'listing','pending')",
      );
      await db.query(
        "INSERT INTO membership.crawler_checkpoints(source,state_gzip,state_sha256,phase,last_status) VALUES('mawred',decode('1f','hex'),repeat('a',64),'listing','pending')",
      );
      await db.query(
        "INSERT INTO membership.opportunities(source,source_key,source_url,title,kind,source_content_hash,content_hash,fetched_at,geography_status) VALUES('mawred','mawred:production-awards:2026','https://mawred.org/artistic-creativity/production-awards/?lang=en','Production Awards','grant',repeat('f',64),'fixture',now(),'regional_includes_lebanon')",
      );
    });
    assert.equal(
      (
        await tx(runtime, "membership_runtime", "alice", (db) =>
          db.query(
            "SELECT source,last_status FROM membership.crawler_checkpoints ORDER BY source",
          ),
        )
      ).rowCount,
      2,
    );
    await assert.rejects(
      tx(runtime, "membership_runtime", "alice", (db) =>
        db.query("SELECT state_gzip FROM membership.crawler_checkpoints"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      tx(billing, "membership_billing", "", (db) =>
        db.query("DELETE FROM membership.credits"),
      ),
      /permission denied/,
    );
    const roles = (
      await admin.query(
        "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('membership_test_runtime','membership_test_billing','membership_test_worker','membership_test_ingest')",
      )
    ).rows;
    assert.equal(roles.length, 4);
    assert.ok(roles.every((r) => !r.rolsuper && !r.rolbypassrls));
    await tx(billing, "membership_billing", "", async (db) => {
      await db.query(
        "INSERT INTO membership.customers(user_id,stripe_customer_id) VALUES('alice','cus_alice')",
      );
      await db.query(
        "INSERT INTO membership.subscriptions(user_id,stripe_subscription_id,state,paid_until) VALUES('alice','sub_alice','active',now()+interval '1 month')",
      );
      await db.query(
        "INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at) VALUES('alice','in_1',now(),now()+interval '1 month')",
      );
    });
    const reservations = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        tx(billing, "membership_billing", "", async (db) => {
          await db.query(
            "SELECT 1 FROM membership.customers WHERE user_id='alice' FOR UPDATE",
          );
          return db.query(reserveCreditSql, [
            "alice",
            String(i).padStart(48, "a"),
            "draft",
            "alice@example.test",
          ]);
        }),
      ),
    );
    assert.equal(
      reservations.reduce((sum, r) => sum + (r.rowCount ?? 0), 0),
      1,
    );
    const credit = reservations.find((r) => r.rowCount)!.rows[0];
    await tx(billing, "membership_billing", "", (db) =>
      db.query(
        "UPDATE membership.credits SET stripe_session_id='cs_1' WHERE id=$1",
        [credit.id],
      ),
    );
    const redemptions = await Promise.all(
      Array.from({ length: 12 }, () =>
        tx(billing, "membership_billing", "", (db) =>
          db.query(redeemCreditSql, ["cs_1", credit.id]),
        ),
      ),
    );
    assert.equal(
      redemptions.reduce((sum, r) => sum + (r.rowCount ?? 0), 0),
      1,
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(releaseCreditSql, [credit.id, "cs_1"]),
        )
      ).rowCount,
      0,
      "redeemed credit cannot be released",
    );
    const events = await Promise.all(
      Array.from({ length: 12 }, () =>
        tx(billing, "membership_billing", "", (db) =>
          db.query(
            "INSERT INTO membership.webhook_events(event_id,event_type) VALUES('evt_1','invoice.paid') ON CONFLICT DO NOTHING RETURNING event_id",
          ),
        ),
      ),
    );
    assert.equal(
      events.reduce((sum, r) => sum + (r.rowCount ?? 0), 0),
      1,
    );
    await assert.rejects(
      tx(billing, "membership_billing", "", (db) =>
        db.query(
          "INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at) SELECT user_id,'in_duplicate',valid_from,expires_at FROM membership.credits WHERE id=$1",
          [credit.id],
        ),
      ),
      /unique constraint/,
    );
    // An expired session can release a reservation once, never another session's.
    const another = (
      await tx(billing, "membership_billing", "", (db) =>
        db.query(
          "INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at,state,reservation_id,stripe_session_id) VALUES('alice','in_2',now()+interval '1 second',now()+interval '1 month','reserved',gen_random_uuid(),'cs_expired') RETURNING id",
        ),
      )
    ).rows[0];
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(releaseCreditSql, [another.id, "cs_wrong"]),
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(releaseCreditSql, [another.id, "cs_expired"]),
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(releaseCreditSql, [another.id, "cs_expired"]),
        )
      ).rowCount,
      0,
    );
    await admin.query(
      "UPDATE membership.credits SET valid_from=now()-interval '1 day' WHERE id=$1",
      [another.id],
    );
    // A reconciler that scanned reservation A cannot bind/release replacement B.
    const snapshot = (
      await tx(billing, "membership_billing", "", (db) =>
        db.query(reserveCreditSql, [
          "alice",
          "token-new",
          "draft",
          "alice@example.com",
        ]),
      )
    ).rows[0];
    assert.ok(snapshot);
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(releaseOrphanCreditSql, [
            snapshot.id,
            snapshot.reservation_id,
            snapshot.checkout_expires_at,
          ]),
        )
      ).rowCount,
      1,
    );
    const replacement = (
      await tx(billing, "membership_billing", "", (db) =>
        db.query(reserveCreditSql, [
          "alice",
          "token-next",
          "draft",
          "alice@example.com",
        ]),
      )
    ).rows[0];
    assert.notEqual(replacement.reservation_id, snapshot.reservation_id);
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(persistCheckoutRequestSql, [
            JSON.stringify({ fixture: "stale" }),
            snapshot.id,
            snapshot.reservation_id,
            snapshot.checkout_token,
            snapshot.tier,
            snapshot.buyer_email,
            snapshot.checkout_expires_at,
          ]),
        )
      ).rowCount,
      0,
      "stale checkout A cannot store its request in reservation B",
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(persistCheckoutRequestSql, [
            JSON.stringify({ fixture: "current" }),
            replacement.id,
            replacement.reservation_id,
            replacement.checkout_token,
            replacement.tier,
            replacement.buyer_email,
            replacement.checkout_expires_at,
          ]),
        )
      ).rowCount,
      1,
    );

    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(releaseOrphanCreditSql, [
            snapshot.id,
            snapshot.reservation_id,
            snapshot.checkout_expires_at,
          ]),
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(bindReconciledSessionSql, [
            "cs_stale",
            snapshot.id,
            snapshot.reservation_id,
            snapshot.checkout_expires_at,
          ]),
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(bindReconciledSessionSql, [
            "cs_current",
            replacement.id,
            replacement.reservation_id,
            replacement.checkout_expires_at,
          ]),
        )
      ).rowCount,
      1,
    );
    await tx(billing, "membership_billing", "", (db) =>
      db.query(
        "UPDATE membership.credits SET state='revoked',reservation_id=NULL WHERE id=$1",
        [replacement.id],
      ),
    );
    assert.equal(
      (
        await tx(billing, "membership_billing", "", (db) =>
          db.query(bindCreatedCheckoutSql, [
            "cs_after_refund",
            replacement.id,
            replacement.reservation_id,
          ]),
        )
      ).rowCount,
      0,
      "refund between persistence and Stripe creation prevents returning a payable checkout",
    );
    const claims = await Promise.all(
      Array.from({ length: 12 }, () =>
        tx(worker, "membership_worker", "", (db) =>
          db.query(
            "INSERT INTO membership.matching_spend(user_id,opportunity_id,reserved_usd,profile_revision,content_hash,identity_group_key,group_version) VALUES('alice','00000000-0000-4000-8000-000000000001',0.003,1,'fixture-hash','00000000-0000-4000-8000-000000000001','fixture-hash') ON CONFLICT DO NOTHING RETURNING id",
          ),
        ),
      ),
    );
    assert.equal(
      claims.reduce((sum, r) => sum + (r.rowCount ?? 0), 0),
      1,
      "one paid claim across concurrent workers",
    );
    await admin.query(
      "INSERT INTO membership.opportunities(id,source,source_key,source_url,title,kind,source_content_hash,content_hash,fetched_at,deadline,detail_status,geography_status) VALUES('00000000-0000-4000-8000-000000000001','ppa','claimed','https://www.ppa.gov.lb/en/1','Claimed','procurement',repeat('a',64),'fixture-hash',now(),CURRENT_DATE+1,'verified','lebanon_confirmed'),('00000000-0000-4000-8000-000000000002','ppa','next','https://www.ppa.gov.lb/en/2','Next','procurement',repeat('b',64),'next-hash',now(),CURRENT_DATE+1,'verified','lebanon_confirmed')",
    );
    await admin.query(
      "UPDATE membership.opportunities SET identity_key=repeat('c',64) WHERE source_key='next'",
    );
    await admin.query(
      "INSERT INTO membership.opportunities(id,source,source_key,source_url,title,kind,source_content_hash,content_hash,fetched_at,first_seen_at,deadline,detail_status,geography_status,identity_key) VALUES('00000000-0000-4000-8000-000000000003','worldbank','worldbank:alias','https://projects.worldbank.org/en/projects-operations/procurement-detail/OP12345','Same exact notice','procurement',repeat('d',64),'alias-hash',now()-interval '1 second',now()+interval '1 second',CURRENT_DATE+1,'verified','lebanon_confirmed',repeat('c',64))",
    );
    await admin.query(
      `INSERT INTO membership.opportunities(
         id,source,source_key,source_url,title,kind,source_content_hash,content_hash,
         fetched_at,deadline,detail_status,geography_status,locations
       ) VALUES('00000000-0000-4000-8000-000000000004','sam-gov','sam-gov:us-procurement',
         'https://sam.gov/opp/12345/view','US procurement','procurement',repeat('e',64),
         repeat('f',64),now(),CURRENT_DATE+1,'verified','unknown',
         '{"countryCodes":["US"],"scope":"countries","evidence":[{"label":"Place of performance country","text":"United States","url":"https://sam.gov/opp/12345/view"}]}'::jsonb)`,
    );
    const candidates = await tx(worker, "membership_worker", "", (db) =>
      db.query(matchingCandidatesSql),
    );
    assert.deepEqual(
      candidates.rows.map((r) => r.source_key),
      ["next"],
      "claimed failed/unknown versions do not starve later candidates",
    );
    await admin.query(
      "UPDATE membership.opportunities SET deadline=CURRENT_DATE+2 WHERE source_key='worldbank:alias'",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rowCount,
      0,
      "fresh aliases with conflicting deadlines need review before paid matching",
    );
    await admin.query(
      "UPDATE membership.opportunities SET deadline=CURRENT_DATE+1,application_status='closed' WHERE source_key='worldbank:alias'",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rowCount,
      0,
      "fresh closed alias conflicts with open alias",
    );
    await admin.query(
      "UPDATE membership.opportunities SET application_status='needs_verification',detail_status='partial',fetched_at=now()+interval '1 second' WHERE source_key='worldbank:alias'",
    );
    assert.deepEqual(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rows.map((r) => r.source_key),
      ["next"],
      "newer partial alias does not suppress a fresh verified primary",
    );
    await admin.query(
      "UPDATE membership.opportunities SET detail_status='verified',fetched_at=now()-interval '1 second' WHERE source_key='worldbank:alias'",
    );
    await admin.query(
      "UPDATE membership.opportunities SET geography_status='unknown' WHERE source_key='next'",
    );
    assert.deepEqual(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rows.map((r) => r.source_key),
      ["worldbank:alias"],
      "a source-backed Lebanon alias remains eligible when another alias is unknown",
    );
    await admin.query(
      "UPDATE membership.opportunities SET geography_status='unknown' WHERE source_key='worldbank:alias'",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rowCount,
      0,
      "unknown geography on every alias cannot trigger a paid call",
    );
    await admin.query(
      "UPDATE membership.opportunities SET geography_status='lebanon_confirmed' WHERE source_key IN ('next','worldbank:alias')",
    );
    assert.equal(
      typeof candidates.rows[0].deadline,
      "string",
      "issuer date remains date-only text through the actual matcher SQL",
    );
    const writeParams = [
      "alice",
      "00000000-0000-4000-8000-000000000002",
      1,
      "next-hash",
      90,
      0.9,
      "possible",
      "[]",
      "jev-1.13.0",
      candidates.rows[0].group_version,
    ];
    const alertParams = [
      writeParams[0],
      writeParams[1],
      writeParams[3],
      writeParams[2],
      candidates.rows[0].group_version,
    ];
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingClaimEligibilitySql, [
            "alice",
            "00000000-0000-4000-8000-000000000002",
            1,
            "next-hash",
            candidates.rows[0].group_version,
          ]),
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingWriteSql, writeParams),
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingAlertSql, alertParams),
        )
      ).rowCount,
      1,
    );
    await admin.query(
      "INSERT INTO membership.saved_opportunities(user_id,opportunity_id) VALUES('alice','00000000-0000-4000-8000-000000000003')",
    );
    let board = await dashboardData("alice", { saved: true });
    assert.equal(board.opportunities.length, 1, "saved sibling appears once");
    assert.equal(board.opportunities[0].source_key, "next");
    assert.equal(board.opportunities[0].saved, true);
    assert.equal(Number(board.opportunities[0].fit), 90);
    assert.equal(board.alerts.length, 1);
    await admin.query(
      "UPDATE membership.matches SET fit=20 WHERE user_id='alice' AND opportunity_id='00000000-0000-4000-8000-000000000002'",
    );
    board = await dashboardData("alice", { saved: true });
    assert.equal(
      board.alerts.length,
      0,
      "a downgraded fit does not revive a prior alert",
    );
    await admin.query(
      "UPDATE membership.matches SET fit=90 WHERE user_id='alice' AND opportunity_id='00000000-0000-4000-8000-000000000002'",
    );
    await admin.query(
      "UPDATE membership.opportunities SET application_status='closed' WHERE source_key='worldbank:alias'",
    );
    board = await dashboardData("alice", { saved: true });
    assert.equal(
      board.opportunities.length,
      1,
      "conflicting aliases stay visible for review",
    );
    assert.equal(board.opportunities[0].group_conflict, true);
    assert.equal(board.opportunities[0].fit, null);
    assert.equal(
      board.alerts.length,
      0,
      "closed sibling suppresses an actionable alert",
    );
    await admin.query(
      "UPDATE membership.opportunities SET application_status='needs_verification' WHERE source_key='worldbank:alias'",
    );
    await admin.query(
      "UPDATE membership.opportunities SET content_hash='alias-changed-hash' WHERE source_key='worldbank:alias'",
    );
    board = await dashboardData("alice", { saved: true });
    assert.equal(board.opportunities.length, 1);
    assert.equal(
      board.opportunities[0].fit,
      null,
      "sibling evidence invalidates displayed fit",
    );
    assert.equal(
      board.alerts.length,
      0,
      "sibling evidence hides the stale alert",
    );
    assert.deepEqual(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rows.map((r) => r.source_key),
      ["next"],
      "sibling evidence change permits one fresh paid decision",
    );
    await admin.query(
      "UPDATE membership.opportunities SET content_hash='alias-hash' WHERE source_key='worldbank:alias'",
    );
    await admin.query(
      "UPDATE membership.opportunities SET content_hash='changed-hash' WHERE source_key='next'",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingClaimEligibilitySql, [
            ...writeParams.slice(0, 4),
            candidates.rows[0].group_version,
          ]),
        )
      ).rowCount,
      0,
      "source change between candidate read and paid reservation blocks the call",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingWriteSql, writeParams),
        )
      ).rowCount,
      0,
      "a changed source cannot receive the old paid result",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingAlertSql, alertParams),
        )
      ).rowCount,
      0,
      "a changed source cannot receive the old alert",
    );
    await admin.query(
      "UPDATE membership.opportunities SET content_hash='next-hash',fetched_at=now()-interval '25 hours' WHERE source_key='next'",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingWriteSql, writeParams),
        )
      ).rowCount,
      0,
      "stale source details cannot receive a match",
    );
    await admin.query(
      "UPDATE membership.opportunities SET fetched_at=now() WHERE source_key='next'",
    );
    await admin.query(
      "UPDATE membership.profiles SET opportunity_types=ARRAY['grant'],revision=revision+1 WHERE user_id='alice'",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingClaimEligibilitySql, [
            ...writeParams.slice(0, 4),
            candidates.rows[0].group_version,
          ]),
        )
      ).rowCount,
      0,
      "profile edit between candidate read and paid reservation blocks the call",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingCandidatesSql),
        )
      ).rowCount,
      0,
      "a procurement never enters paid matching for a grant-only profile",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingWriteSql, writeParams),
        )
      ).rowCount,
      0,
      "old profile revision cannot receive the paid result",
    );
    await admin.query(
      "UPDATE membership.profiles SET opportunity_types=ARRAY['procurement'],revision=revision+1 WHERE user_id='alice'",
    );
    await admin.query(
      "UPDATE membership.subscriptions SET state='inactive' WHERE user_id='alice'",
    );
    await admin.query(
      `INSERT INTO membership.opportunities(source,source_key,source_url,title,kind,source_content_hash,content_hash,fetched_at,deadline,detail_status,geography_status,application_status,locations)
       SELECT 'ppa','board-fixture-'||n,'https://www.ppa.gov.lb/en/'||n,
         'Board fixture '||n,CASE WHEN n%2=1 THEN 'grant' ELSE 'procurement' END,
         repeat('e',64),'board-hash-'||n,now(),
         CASE WHEN n=61 THEN NULL WHEN n<=40 THEN CURRENT_DATE+1 ELSE CURRENT_DATE-1 END,
         'verified','lebanon_confirmed',CASE WHEN n%5=0 THEN 'closed' ELSE 'needs_verification' END,
         jsonb_build_object('countryCodes',ARRAY['LB'],'scope','countries','evidence',
           jsonb_build_array(jsonb_build_object('label','Procurement jurisdiction',
             'text','Lebanon Public Procurement Authority official portal',
             'url','https://www.ppa.gov.lb/en/'||n)))
       FROM generate_series(1,61) n`,
    );
    const freeFirst = await dashboardData("alice", { query: "Board fixture" });
    const apiFirst = await catalogueData("alice", { query: "Board fixture" });
    assert.equal(apiFirst.filteredCount, 61);
    assert.equal(apiFirst.opportunities.length, 50);
    assert.ok(!("profile" in apiFirst) && !("alerts" in apiFirst));
    assert.ok(
      apiFirst.opportunities.every((row) => row.fit === null && !row.saved),
    );
    const publicHint = await tx(runtime, "membership_runtime", "alice", (db) =>
      loadPublicOpportunityHandoff(db, apiFirst.opportunities[0].id),
    );
    assert.equal(publicHint.id, apiFirst.opportunities[0].id);
    assert.ok(publicHint.sourceUrl.startsWith("https://"));
    assert.ok(!("fit" in publicHint) && !("credit" in publicHint));
    assert.ok(!("profile" in publicHint) && !("email" in publicHint));
    const closedId = (
      await admin.query(
        "SELECT id FROM membership.opportunities WHERE source_key='board-fixture-50'",
      )
    ).rows[0].id as string;
    const closedHint = await tx(runtime, "membership_runtime", "alice", (db) =>
      loadPublicOpportunityHandoff(db, closedId),
    );
    assert.equal(
      closedHint.status,
      "closed",
      "past or closed notice cannot be presented as open",
    );
    const apiEmpty = await catalogueData("alice", {
      query: "no-such-notice-928374",
    });
    assert.equal(apiEmpty.filteredCount, 0);
    assert.deepEqual(apiEmpty.opportunities, []);
    assert.equal(apiEmpty.nextCursor, null);
    await assert.rejects(
      catalogueData("alice", { cursor: "not-a-cursor" }),
      /Invalid page cursor/,
    );
    assert.equal(
      freeFirst.filteredCount,
      61,
      "free account sees entire filtered catalogue",
    );
    assert.equal(freeFirst.opportunities.length, 50);
    assert.ok(freeFirst.nextCursor);
    assert.equal(freeFirst.alerts.length, 0);
    assert.ok(
      freeFirst.opportunities.every((row) => row.fit === null && !row.saved),
    );
    const freeSecond = await dashboardData("alice", {
      query: "Board fixture",
      cursor: freeFirst.nextCursor!,
    });
    assert.equal(
      freeSecond.filteredCount,
      61,
      "count is independent of cursor",
    );
    assert.equal(freeSecond.opportunities.length, 11);
    assert.equal(freeSecond.nextCursor, null);
    assert.equal(
      new Set(
        [...freeFirst.opportunities, ...freeSecond.opportunities].map(
          (row) => row.id,
        ),
      ).size,
      61,
    );
    assert.equal(
      (await dashboardData("alice", { query: "Board fixture", kind: "grant" }))
        .filteredCount,
      31,
    );
    assert.equal(
      (
        await dashboardData("alice", {
          query: "Board fixture",
          status: "current",
        })
      ).filteredCount,
      32,
    );
    assert.equal(
      (
        await dashboardData("alice", {
          query: "Board fixture",
          status: "closed",
        })
      ).filteredCount,
      28,
    );
    assert.equal(
      (
        await dashboardData("alice", {
          query: "Board fixture",
          deadline: "past",
        })
      ).filteredCount,
      20,
    );
    assert.equal(
      (
        await dashboardData("alice", {
          query: "Board fixture",
          deadline: "unknown",
        })
      ).filteredCount,
      1,
    );
    assert.equal(
      (
        await dashboardData("alice", {
          query: "Board fixture",
          source: "worldbank",
        })
      ).filteredCount,
      0,
    );
    assert.equal(
      (
        await dashboardData("alice", {
          query: "Board fixture",
          kind: "grant",
          status: "current",
          deadline: "future",
        })
      ).filteredCount,
      16,
    );
    await assert.rejects(
      dashboardData("alice", { saved: true }),
      /active paid membership/,
    );
    const freeAlias = await dashboardData("alice", { query: "Next" });
    assert.equal(
      freeAlias.opportunities.find((row) => row.source_key === "next")?.saved,
      false,
    );
    assert.equal(
      (await dashboardData("alice", { query: "Next", source: "worldbank" }))
        .filteredCount,
      1,
      "source filter includes an official cross-listed alias",
    );
    assert.equal(
      (await dashboardData("alice", { query: "Same exact notice" }))
        .filteredCount,
      1,
      "search includes a cross-listed alias title",
    );
    assert.equal(
      (
        await tx(worker, "membership_worker", "", (db) =>
          db.query(matchingWriteSql, [
            ...writeParams.slice(0, 2),
            3,
            ...writeParams.slice(3),
          ]),
        )
      ).rowCount,
      0,
      "canceled entitlement cannot receive a paid match",
    );
    const countryRecords = [
      {
        source: "grants-gov",
        sourceKey: "grants-gov:country-us-current",
        sourceUrl: "https://www.grants.gov/search-results-detail/10001",
        title: "US country opportunity",
        deadlineOffset: 5,
        locations: {
          countryCodes: ["US"],
          scope: "countries",
          evidence: [
            {
              label: "Project country",
              text: "United States",
              url: "https://www.grants.gov/search-results-detail/10001",
            },
          ],
        },
      },
      {
        source: "sam-gov",
        sourceKey: "sam-gov:country-unknown",
        sourceUrl: "https://sam.gov/opp/10002/view",
        title: "Unknown location opportunity",
        deadlineOffset: 5,
        locations: { countryCodes: [], scope: "unknown", evidence: [] },
      },
      {
        source: "grants-gov",
        sourceKey: "grants-gov:worldwide-current",
        sourceUrl: "https://www.grants.gov/search-results-detail/10003",
        title: "Worldwide opportunity",
        deadlineOffset: 5,
        locations: {
          countryCodes: [],
          scope: "worldwide",
          evidence: [
            {
              label: "Opportunity geography",
              text: "Worldwide",
              url: "https://www.grants.gov/search-results-detail/10003",
            },
          ],
        },
      },
      {
        source: "grants-gov",
        sourceKey: "grants-gov:country-us-expired",
        sourceUrl: "https://www.grants.gov/search-results-detail/10004",
        title: "Expired US opportunity",
        deadlineOffset: -1,
        locations: {
          countryCodes: ["US"],
          scope: "countries",
          evidence: [
            {
              label: "Project country",
              text: "United States",
              url: "https://www.grants.gov/search-results-detail/10004",
            },
          ],
        },
      },
    ];
    for (const record of countryRecords) {
      await admin.query(
        `INSERT INTO membership.opportunities(
           source,source_key,source_url,title,description,kind,deadline,evidence,
           content_hash,source_content_hash,fetched_at,detail_status,geography_status,
           application_status,locations
         ) VALUES($1,$2,$3,$4,'','grant',CURRENT_DATE+$5::integer,'[]'::jsonb,
           repeat('a',64),repeat('a',64),now(),'verified','unknown','needs_verification',$6::jsonb)`,
        [
          record.source,
          record.sourceKey,
          record.sourceUrl,
          record.title,
          record.deadlineOffset,
          JSON.stringify(record.locations),
        ],
      );
    }
    const usBoard = await dashboardData("alice", { country: "US" });
    const usKeys = new Set(usBoard.opportunities.map((row) => row.source_key));
    assert.ok(usKeys.has("grants-gov:country-us-current"));
    assert.ok(usKeys.has("grants-gov:worldwide-current"));
    assert.ok(usKeys.has("grants-gov:country-us-expired"));
    assert.ok(!usKeys.has("sam-gov:country-unknown"));
    assert.ok(
      usBoard.countries.includes("LB") && usBoard.countries.includes("US"),
    );
    const legacyLebanonBoard = await dashboardData("alice", {
      query: "Board fixture",
      country: "LB",
    });
    assert.equal(legacyLebanonBoard.filteredCount, 61);
    assert.ok(
      legacyLebanonBoard.opportunities.every((row) =>
        row.locations.countryCodes.includes("LB"),
      ),
    );
    const currentUs = await dashboardData("alice", {
      country: "US",
      status: "current",
    });
    assert.deepEqual(
      new Set(currentUs.opportunities.map((row) => row.source_key)),
      new Set([
        "grants-gov:country-us-current",
        "grants-gov:worldwide-current",
        "sam-gov:us-procurement",
      ]),
    );
    assert.equal(
      (await dashboardData("alice", { country: "US", status: "closed" }))
        .opportunities[0]?.source_key,
      "grants-gov:country-us-expired",
    );
    const unknownId = (
      await admin.query(
        "SELECT id FROM membership.opportunities WHERE source_key='sam-gov:country-unknown'",
      )
    ).rows[0].id as string;
    const handoff = await tx(runtime, "membership_runtime", "alice", (db) =>
      loadPublicOpportunityHandoff(db, unknownId),
    );
    assert.equal(handoff.status, "current");
    assert.equal(handoff.source, "sam-gov");

    const longUnicodeQuery = "ع".repeat(200);
    await admin.query(
      "UPDATE membership.opportunities SET title=$1||' '||title WHERE source_key LIKE 'board-fixture-%'",
      [longUnicodeQuery],
    );
    const firstLongPage = await catalogueData("alice", {
      query: longUnicodeQuery,
      country: "LB",
    });
    assert.ok(firstLongPage.nextCursor);
    assert.ok(firstLongPage.nextCursor!.length < 500);
    const secondLongPage = await catalogueData("alice", {
      query: longUnicodeQuery,
      country: "LB",
      cursor: firstLongPage.nextCursor!,
    });
    assert.equal(secondLongPage.opportunities.length, 11);
    await assert.rejects(
      catalogueData("alice", {
        query: longUnicodeQuery,
        country: "US",
        cursor: firstLongPage.nextCursor!,
      }),
      /Invalid page cursor/,
    );
    // SQL parameters preserve hostile text without changing the tenant filter.
    const injection = "alice' OR true --";
    assert.equal(
      (
        await tx(runtime, "membership_runtime", injection, (db) =>
          db.query("SELECT * FROM membership.profiles WHERE user_id=$1", [
            injection,
          ]),
        )
      ).rowCount,
      0,
    );
  } finally {
    await Promise.all([
      admin.end(),
      runtime.end(),
      billing.end(),
      worker.end(),
    ]);
  }
});
