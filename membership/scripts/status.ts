import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.WORKER_DATABASE_URL });
const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE membership_worker");
  const sources = await db.query(
    "SELECT coverage,imported_at FROM membership.source_runs ORDER BY imported_at DESC LIMIT 10",
  );
  const counts = await db.query(
    "SELECT source,application_status,detail_status,count(*)::int AS notices,max(fetched_at) AS last_checked FROM membership.opportunities GROUP BY source,application_status,detail_status ORDER BY source",
  );
  const spend = await db.query(
    "SELECT status,count(*)::int AS calls,sum(reserved_usd) AS reserved_usd,sum(actual_usd) AS known_actual_usd FROM membership.matching_spend GROUP BY status",
  );
  const checkpoints = await db.query(
    "SELECT source,phase,last_status,last_run_at,last_import_at,last_error,revision::text,octet_length(state_gzip)::int AS compressed_bytes,coverage FROM membership.crawler_checkpoints ORDER BY source",
  );
  console.log(
    JSON.stringify(
      {
        sources: sources.rows,
        catalogue: counts.rows,
        checkpoints: checkpoints.rows,
        matching: spend.rows,
      },
      null,
      2,
    ),
  );
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
