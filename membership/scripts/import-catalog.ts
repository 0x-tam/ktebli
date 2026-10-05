import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import {
  catalogueBatchSchema,
  mawredPageBatchSchema,
  ungmCuratedBatchSchema,
} from "../lib/catalogue";
const path = process.argv[2];
if (!path) throw new Error("Provide the crawler JSON artifact path");
const raw = JSON.parse(await readFile(path, "utf8"));
const sources = new Set(
  (raw.records ?? []).map((record: { source?: string }) => record.source),
);
const input = sources.has("mawred")
  ? mawredPageBatchSchema.parse(raw)
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
    await db.query(
      `INSERT INTO membership.opportunities(source,source_key,source_url,title,description,kind,published_at,deadline,evidence,locales,content_hash,fetched_at,detail_status,deadline_conflict,application_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(source,source_key) DO UPDATE SET source_url=$3,title=$4,description=$5,kind=$6,published_at=$7,deadline=$8,evidence=$9,locales=$10,content_hash=$11,fetched_at=$12,detail_status=$13,deadline_conflict=$14,application_status=$15 WHERE membership.opportunities.fetched_at<=$12`,
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
        o.contentHash,
        o.fetchedAt,
        o.detailStatus,
        o.deadlineConflict,
        o.applicationStatus,
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
