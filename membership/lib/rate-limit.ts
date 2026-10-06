import "server-only";
import { userTransaction } from "./db";
import { HttpError } from "./http";
export async function throttle(userId: string, action: string, limit = 10) {
  const result = await userTransaction(userId, (db) =>
    db.query(
      `INSERT INTO membership.rate_limits(user_id,action,window_start,hits) VALUES($1,$2,now(),1) ON CONFLICT(user_id,action) DO UPDATE SET window_start=CASE WHEN membership.rate_limits.window_start<now()-interval '1 hour' THEN now() ELSE membership.rate_limits.window_start END,hits=CASE WHEN membership.rate_limits.window_start<now()-interval '1 hour' THEN 1 ELSE membership.rate_limits.hits+1 END WHERE membership.rate_limits.window_start<now()-interval '1 hour' OR membership.rate_limits.hits<$3 RETURNING hits`,
      [userId, action, limit],
    ),
  );
  if (!result.rowCount)
    throw new HttpError(429, "Please wait before trying again");
}
