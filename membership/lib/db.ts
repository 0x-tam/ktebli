import "server-only";
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";
const pools = new Map<string, Pool>();
export function dbPool(billing = false) {
  const key = billing ? "BILLING_DATABASE_URL" : "DATABASE_URL";
  let pool = pools.get(key);
  if (!pool) {
    const connectionString = process.env[key];
    if (!connectionString) throw new Error("Database is not configured");
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });
    attachDatabasePool(pool);
    pools.set(key, pool);
  }
  return pool;
}
export async function transaction<T>(
  role: "membership_runtime" | "membership_billing",
  userId: string | undefined,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await dbPool(role === "membership_billing").connect();
  try {
    await db.query("BEGIN");
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query("SET LOCAL statement_timeout='10s'");
    await db.query("SELECT set_config('app.user_id',$1,true)", [userId ?? ""]);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export const userTransaction = <T>(
  userId: string,
  fn: (db: PoolClient) => Promise<T>,
) => transaction("membership_runtime", userId, fn);
export const billingTransaction = <T>(fn: (db: PoolClient) => Promise<T>) =>
  transaction("membership_billing", undefined, fn);
