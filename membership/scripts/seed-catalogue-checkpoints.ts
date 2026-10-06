import { Client } from "pg";
import { readFile } from "node:fs/promises";
import {
  catalogueBatchSchema,
  mawredPageBatchSchema,
  ungmCuratedBatchSchema,
  worldBankBatchSchema,
} from "../lib/catalogue";
import {
  encodeCrawlerState,
  ppaStreamsComplete,
  type CrawlSource,
} from "../lib/crawler-checkpoint";

const url = process.env.INGEST_DATABASE_URL;
if (
  !url ||
  url.includes("-pooler.") ||
  process.env.CONFIRM_MEMBERSHIP_BRANCH !== "yes" ||
  !process.env.MEMBERSHIP_EXPECTED_DB_HOST ||
  new URL(url).hostname !== process.env.MEMBERSHIP_EXPECTED_DB_HOST
)
  throw new Error(
    "Confirmed direct isolated ingestion URL and exact endpoint required",
  );
const inputs: { source: CrawlSource; state: string; output: string }[] = [
  {
    source: "ppa",
    state: "crawler/.state/current-release-state.json",
    output: "crawler/.state/current-release-opportunities.json",
  },
  {
    source: "ungm-curated",
    state: "crawler/.state/ungm-coverage.json",
    output: "crawler/.state/ungm-opportunities.json",
  },
  {
    source: "mawred",
    state: "crawler/.state/mawred-coverage.json",
    output: "crawler/.state/mawred-opportunities.json",
  },
  {
    source: "worldbank",
    state: "crawler/.state/worldbank-coverage.json",
    output: "crawler/.state/worldbank-opportunities.json",
  },
];
const wanted = new Set(
  (
    process.env.CATALOGUE_SEED_SOURCES ?? "ppa,ungm-curated,mawred,worldbank"
  ).split(","),
);
if (
  !wanted.size ||
  [...wanted].some((source) => !inputs.some((input) => input.source === source))
)
  throw new Error("Unknown checkpoint seed source");
const seeds: string[] = JSON.parse(
  await readFile("crawler/fixtures/ungm-curated-seeds.json", "utf8"),
);
const validated = [];
for (const input of inputs.filter((item) => wanted.has(item.source))) {
  const state = JSON.parse(await readFile(input.state, "utf8"));
  const output = JSON.parse(await readFile(input.output, "utf8"));
  const batch =
    input.source === "ppa"
      ? catalogueBatchSchema.parse(output)
      : input.source === "ungm-curated"
        ? ungmCuratedBatchSchema(seeds).parse(output)
        : input.source === "mawred"
          ? mawredPageBatchSchema.parse(output)
          : worldBankBatchSchema.parse(output);
  if (input.source === "ppa" && !ppaStreamsComplete(state))
    throw new Error("PPA seed needs both complete locale streams");
  const currentRecords: Record<string, { contentHash: string }> =
    input.source === "ppa"
      ? state.records
      : input.source === "ungm-curated"
        ? Object.fromEntries(
            Object.entries(state.entries).flatMap(([, entry]) => {
              const record = (
                entry as { record?: { sourceKey: string; contentHash: string } }
              ).record;
              return record ? [[record.sourceKey, record]] : [];
            }),
          )
        : input.source === "mawred"
          ? state.record
            ? { [state.record.sourceKey]: state.record }
            : {}
          : state.entries;
  if (
    Object.keys(currentRecords).length !== batch.records.length ||
    batch.records.some(
      (record) =>
        currentRecords[record.sourceKey]?.contentHash !== record.contentHash,
    )
  )
    throw new Error(
      `${input.source} checkpoint differs from imported artifact`,
    );
  validated.push({
    source: input.source,
    encoded: encodeCrawlerState(input.source, state),
    coverage: batch.coverage,
    count: batch.records.length,
  });
}
const db = new Client({ connectionString: url });
await db.connect();
try {
  await db.query("SET ROLE membership_ingest");
  const lock = await db.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('membership-public-catalogue-runner')) AS locked",
  );
  if (!lock.rows[0]?.locked)
    throw new Error("Catalogue runner active; do not seed concurrently");
  await db.query("BEGIN");
  for (const item of validated) {
    const inserted = await db.query(
      `INSERT INTO membership.crawler_checkpoints
       (source,state_gzip,state_sha256,phase,last_status,last_import_at,coverage)
       VALUES($1,$2,$3,'imported','imported',now(),$4) ON CONFLICT DO NOTHING RETURNING source`,
      [
        item.source,
        item.encoded.gzip,
        item.encoded.sha256,
        JSON.stringify(item.coverage),
      ],
    );
    if (!inserted.rowCount)
      throw new Error(
        `${item.source} checkpoint already exists; refusing overwrite`,
      );
  }
  await db.query("COMMIT");
  console.log(
    JSON.stringify(
      validated.map((item) => ({
        source: item.source,
        records: item.count,
        compressedBytes: item.encoded.gzip.length,
      })),
    ),
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
