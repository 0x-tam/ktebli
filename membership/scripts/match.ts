import {
  matchingAlertSql,
  matchingCandidatesSql,
  matchingClaimEligibilitySql,
  matchingWriteSql,
} from "../lib/matching-candidates";
import { Pool, type PoolClient } from "pg";
import { boundedMatchBody, parseMatch } from "../lib/matching";
import { opportunitySchema, profileSchema } from "../lib/contracts";
if (process.env.MEMBERSHIP_MATCHING_ENABLED !== "true")
  throw new Error("Membership matching is disabled");
const key = process.env.MEMBERSHIP_TYPESAFE_API_KEY;
const budget = Number(process.env.MEMBERSHIP_MATCHING_BUDGET_USD ?? 0);
const reserve = Number(process.env.MEMBERSHIP_MATCHING_RESERVATION_USD ?? 0);
if (
  !key ||
  !Number.isFinite(budget) ||
  budget <= 0 ||
  !Number.isFinite(reserve) ||
  reserve < 0.003 ||
  reserve > budget
)
  throw new Error(
    "A separately approved matching key, cumulative budget, and conservative per-call reservation are required",
  );
if (Date.now() > Date.parse("2026-11-04T00:00:00Z"))
  throw new Error(
    "Refresh the pinned TypeSafe pricing qualification before matching",
  );
// Official docs checked 2026-10-05: jev-1.13.0 input $0.042/M, output free,
// context <=64k; $0.003 covers even 65,536 input tokens ($0.002752512).
// Reservations are retained even on unknown outcomes. Never resets at day/cycle boundaries.
const pool = new Pool({ connectionString: process.env.WORKER_DATABASE_URL });
const db = await pool.connect();
async function workerTransaction<T>(run: (db: PoolClient) => Promise<T>) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE membership_worker");
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
try {
  const candidates = await workerTransaction((db) =>
    db.query(matchingCandidatesSql),
  );
  for (const row of candidates.rows) {
    const profile = profileSchema.parse({
      organizationName: row.organization_name,
      organizationType: row.organization_type,
      sectors: row.sectors,
      capabilities: row.capabilities,
      locations: row.locations,
      alertsEnabled: row.alerts_enabled,
      qualifications: row.qualifications,
      interests: row.interests,
      excludedWork: row.excluded_work,
      opportunityTypes: row.opportunity_types,
      pastWork: row.past_work,
      teamCapacity: row.team_capacity,
      languages: row.languages,
      budgetMin: row.budget_min,
      budgetMax: row.budget_max,
    });
    const opportunity = opportunitySchema.parse({
      source: row.source,
      sourceKey: row.source_key,
      sourceUrl: row.source_url,
      title: row.title,
      description: row.description,
      kind: row.kind,
      publishedAt: row.published_at ?? null,
      deadline: row.deadline ?? null,
      evidence: row.evidence,
      locales: row.locales,
      contentHash: row.content_hash,
      fetchedAt: row.fetched_at.toISOString(),
      detailStatus: row.detail_status,
      deadlineConflict: row.deadline_conflict,
      applicationStatus: row.application_status,
    });
    const body = boundedMatchBody(profile, opportunity);
    if (body === null) {
      await workerTransaction((db) =>
        db.query(
          "INSERT INTO membership.matching_blocks(user_id,opportunity_id,profile_revision,content_hash,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [
            row.user_id,
            row.opportunity_id,
            row.revision,
            row.content_hash,
            "input_limit",
          ],
        ),
      );
      console.warn(
        JSON.stringify({
          code: "matching_context_too_large",
          opportunity: row.opportunity_id,
        }),
      );
      continue;
    }
    const claim = await workerTransaction(async (db) => {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('membership-matching-budget'))",
      );
      const stillEligible = await db.query(matchingClaimEligibilitySql, [
        row.user_id,
        row.opportunity_id,
        row.revision,
        row.content_hash,
        row.group_version,
      ]);
      if (!stillEligible.rowCount) return { exhausted: false, id: null };
      const spent = Number(
        (
          await db.query(
            "SELECT COALESCE(SUM(reserved_usd),0) AS spent FROM membership.matching_spend",
          )
        ).rows[0].spent,
      );
      if (spent + reserve > budget) return { exhausted: true, id: null };
      const id = (
        await db.query(
          "INSERT INTO membership.matching_spend(user_id,opportunity_id,reserved_usd,profile_revision,content_hash,identity_group_key,group_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",
          [
            row.user_id,
            row.opportunity_id,
            reserve,
            row.revision,
            row.content_hash,
            stillEligible.rows[0].group_key,
            stillEligible.rows[0].group_version,
          ],
        )
      ).rows[0]?.id as string | undefined;
      return { exhausted: false, id: id ?? null };
    });
    if (claim.exhausted) {
      console.log("Cumulative matching reservation budget exhausted");
      break;
    }
    const reservation = claim.id;
    if (!reservation) continue;
    try {
      const response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`Matching provider status ${response.status}`);
      const match = parseMatch(await response.json(), opportunity);
      const persisted = await workerTransaction(async (db) => {
        await db.query(
          "UPDATE membership.matching_spend SET status=$1,usage=$2,actual_usd=$4 WHERE id=$3",
          [
            "completed",
            JSON.stringify(match.usage),
            reservation,
            (match.usage.input_tokens * 0.042) / 1_000_000,
          ],
        );
        const written = await db.query(matchingWriteSql, [
          row.user_id,
          row.opportunity_id,
          row.revision,
          row.content_hash,
          match.fit,
          match.confidence,
          match.eligibility,
          JSON.stringify(match.reasons),
          match.model,
          row.group_version,
        ]);
        if (written.rowCount)
          await db.query(matchingAlertSql, [
            row.user_id,
            row.opportunity_id,
            row.content_hash,
            row.revision,
            row.group_version,
          ]);
        return Boolean(written.rowCount);
      });
      console.log(
        JSON.stringify({
          code: persisted ? "matched" : "stale_match_skipped",
          opportunity: row.opportunity_id,
        }),
      );
    } catch (error) {
      await workerTransaction((db) =>
        db.query(
          "UPDATE membership.matching_spend SET status='failed' WHERE id=$1",
          [reservation],
        ),
      );
      throw error;
    }
  }
} finally {
  db.release();
  await pool.end();
}
