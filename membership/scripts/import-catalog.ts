import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import {
  catalogueBatchSchema,
  mawredPageBatchSchema,
  ungmCuratedBatchSchema,
  worldBankBatchSchema,
} from "../lib/catalogue";
import { catalogueQualification } from "../lib/catalogue-identity";
const path = process.argv[2];
if (!path) throw new Error("Provide the crawler JSON artifact path");
const raw = JSON.parse(await readFile(path, "utf8"));
const sources = new Set(
  (raw.records ?? []).map((record: { source?: string }) => record.source),
);
const input = sources.has("mawred")
  ? mawredPageBatchSchema.parse(raw)
  : sources.has("worldbank") ||
      raw.coverage?.scope ===
        "Current World Bank procurement notices explicitly assigned to project country Lebanon; bidder eligibility remains unverified"
    ? worldBankBatchSchema.parse(raw)
    : sources.has("ungm")
      ? ungmCuratedBatchSchema(
          JSON.parse(
            await readFile("crawler/fixtures/ungm-curated-seeds.json", "utf8"),
          ),
        ).parse(raw)
      : catalogueBatchSchema.parse(raw);
const records = input.records;
const ingestionUrl = process.env.INGEST_DATABASE_URL;
const pool = new Pool({
  connectionString: ingestionUrl ?? process.env.WORKER_DATABASE_URL,
});
const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query(
    ingestionUrl
      ? "SET LOCAL ROLE membership_ingest"
      : "SET LOCAL ROLE membership_worker",
  );
  for (const o of records) {
    const qualification = catalogueQualification(o);
    await db.query(
      `INSERT INTO membership.opportunities(source,source_key,source_url,title,description,kind,published_at,deadline,evidence,locales,source_content_hash,content_hash,fetched_at,detail_status,deadline_conflict,application_status,geography_status,geography_evidence,identity_key,identity_claim,locations)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT(source,source_key) DO UPDATE SET source_url=EXCLUDED.source_url,title=EXCLUDED.title,description=EXCLUDED.description,kind=EXCLUDED.kind,published_at=EXCLUDED.published_at,deadline=EXCLUDED.deadline,evidence=EXCLUDED.evidence,locales=EXCLUDED.locales,source_content_hash=EXCLUDED.source_content_hash,content_hash=EXCLUDED.content_hash,fetched_at=EXCLUDED.fetched_at,detail_status=EXCLUDED.detail_status,deadline_conflict=EXCLUDED.deadline_conflict,application_status=EXCLUDED.application_status,geography_status=EXCLUDED.geography_status,geography_evidence=EXCLUDED.geography_evidence,identity_key=EXCLUDED.identity_key,identity_claim=EXCLUDED.identity_claim,locations=EXCLUDED.locations
       WHERE membership.opportunities.fetched_at<=EXCLUDED.fetched_at`,
      [
        o.source,
        o.sourceKey,
        o.sourceUrl,
        o.title,
        o.description,
        o.kind,
        o.publishedAt,
        o.deadline,
        JSON.stringify(o.evidence),
        JSON.stringify(o.locales),
        qualification.sourceContentHash,
        qualification.contentHash,
        o.fetchedAt,
        o.detailStatus,
        o.deadlineConflict,
        o.applicationStatus,
        qualification.geography.status,
        JSON.stringify(qualification.geography.evidence),
        qualification.identity.key,
        qualification.identity.claim
          ? JSON.stringify(qualification.identity.claim)
          : null,
        JSON.stringify(qualification.locations),
      ],
    );
  }
  await db.query("INSERT INTO membership.source_runs(coverage) VALUES($1)", [
    JSON.stringify(input.coverage ?? { status: "unknown" }),
  ]);
  await db.query("COMMIT");
  console.log(
    JSON.stringify({
      imported: records.length,
      coverage: input.coverage ?? null,
      deletions: 0,
    }),
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
