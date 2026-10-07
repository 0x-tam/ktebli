import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url || url.includes("-pooler."))
  throw new Error("Use the isolated branch direct DATABASE_URL_UNPOOLED");
if (process.env.CONFIRM_MEMBERSHIP_BRANCH !== "yes")
  throw new Error(
    "Set CONFIRM_MEMBERSHIP_BRANCH=yes after verifying the isolated branch",
  );
const expectedHost = process.env.MEMBERSHIP_EXPECTED_DB_HOST;
if (!expectedHost || new URL(url).hostname !== expectedHost)
  throw new Error(
    "Set MEMBERSHIP_EXPECTED_DB_HOST to the exact isolated branch endpoint",
  );
const pool = new Pool({ connectionString: url });
const db = await pool.connect();
try {
  await db.query("BEGIN");
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('ktebli-membership-migrations'))",
  );
  await db.query("CREATE SCHEMA IF NOT EXISTS membership");
  await db.query(
    "CREATE TABLE IF NOT EXISTS membership.migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  if (
    !(await db.query("SELECT 1 FROM membership.migrations WHERE version='001'"))
      .rowCount
  ) {
    await db.query(await readFile(resolve("db/001_membership.sql"), "utf8"));
    await db.query("INSERT INTO membership.migrations(version) VALUES('001')");
  }
  if (
    !(await db.query("SELECT 1 FROM membership.migrations WHERE version='002'"))
      .rowCount
  ) {
    await db.query(
      await readFile(resolve("db/002_crawler_checkpoint.sql"), "utf8"),
    );
    await db.query("INSERT INTO membership.migrations(version) VALUES('002')");
  }
  if (
    !(await db.query("SELECT 1 FROM membership.migrations WHERE version='003'"))
      .rowCount
  ) {
    await db.query(await readFile(resolve("db/003_mawred_source.sql"), "utf8"));
    await db.query("INSERT INTO membership.migrations(version) VALUES('003')");
  }
  if (
    !(await db.query("SELECT 1 FROM membership.migrations WHERE version='004'"))
      .rowCount
  ) {
    await db.query(
      await readFile(resolve("db/004_central_catalogue.sql"), "utf8"),
    );
    await db.query("INSERT INTO membership.migrations(version) VALUES('004')");
  }
  if (
    !(await db.query("SELECT 1 FROM membership.migrations WHERE version='005'"))
      .rowCount
  ) {
    await db.query(
      await readFile(resolve("db/005_worldwide_catalogue.sql"), "utf8"),
    );
    await db.query("INSERT INTO membership.migrations(version) VALUES('005')");
  }
  await db.query("COMMIT");
  console.log(
    "Membership schema applied. Runtime login grants remain a separate provisioning step.",
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
