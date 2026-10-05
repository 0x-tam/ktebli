import "server-only";
import { userTransaction } from "./db";
import { z } from "zod";
const cursorSchema = z.object({
  at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});
export async function dashboardData(
  userId: string,
  options: { query?: string; cursor?: string; saved?: boolean } = {},
) {
  const query = (options.query ?? "").trim().slice(0, 200);
  let cursor: { at: string; id: string } | undefined;
  if (options.cursor)
    cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")),
    );
  return userTransaction(userId, async (db) => {
    const profile = await db.query(
      "SELECT * FROM membership.profiles WHERE user_id=$1",
      [userId],
    );
    const subscription = await db.query(
      "SELECT state,paid_until,cancel_at_period_end FROM membership.subscriptions WHERE user_id=$1",
      [userId],
    );
    const paid =
      subscription.rows[0]?.state === "active" &&
      new Date(subscription.rows[0].paid_until) > new Date();
    const credits = await db.query(
      "SELECT id,amount_cents,expires_at,state FROM membership.credits WHERE user_id=$1 AND expires_at>now() AND valid_from<=now() AND state IN ('available','reserved') ORDER BY expires_at DESC LIMIT 1",
      [userId],
    );
    const base = {
      profile: profile.rows[0] ?? null,
      subscription: subscription.rows[0] ?? null,
      credit: credits.rows[0] ?? null,
    };
    if (!paid)
      return { ...base, opportunities: [], alerts: [], nextCursor: null };
    const opportunities = await db.query(
      `SELECT o.*,o.published_at::text AS published_at,o.deadline::text AS deadline,s.opportunity_id IS NOT NULL AS saved,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND NOT o.deadline_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.fit END AS fit,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND NOT o.deadline_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.confidence END AS confidence,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND NOT o.deadline_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.eligibility END AS eligibility,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND NOT o.deadline_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.reasons END AS reasons
   FROM membership.opportunities o LEFT JOIN membership.saved_opportunities s ON s.opportunity_id=o.id AND s.user_id=$1
   LEFT JOIN membership.matches m ON m.opportunity_id=o.id AND m.user_id=$1 LEFT JOIN membership.profiles p ON p.user_id=$1
   WHERE (o.deadline IS NULL OR o.deadline>=CURRENT_DATE) AND o.application_status NOT IN ('not_open_competition','closed') AND (o.deadline IS NOT NULL OR o.fetched_at>now()-interval '30 days')
    AND ($2='' OR strpos(lower(o.title||' '||o.description),lower($2))>0)
    AND ($3::timestamptz IS NULL OR (o.fetched_at,o.id)<($3::timestamptz,$4::uuid))
   AND ($5::boolean=false OR s.opportunity_id IS NOT NULL) ORDER BY o.fetched_at DESC,o.id DESC LIMIT 51`,
      [
        userId,
        query,
        cursor?.at ?? null,
        cursor?.id ?? null,
        options.saved ?? false,
      ],
    );
    const more = opportunities.rows.length > 50,
      rows = opportunities.rows.slice(0, 50),
      last = rows.at(-1);
    const alerts = await db.query(
      `SELECT a.id,a.created_at,a.read_at,o.title,o.source_url FROM membership.alerts a
       JOIN membership.opportunities o ON o.id=a.opportunity_id AND o.content_hash=a.content_hash
       JOIN membership.matches m ON m.user_id=a.user_id AND m.opportunity_id=a.opportunity_id AND m.content_hash=a.content_hash
       JOIN membership.profiles p ON p.user_id=a.user_id AND p.revision=m.profile_revision
       WHERE a.user_id=$1 AND o.kind=ANY(p.opportunity_types)
         AND o.detail_status='verified' AND NOT o.deadline_conflict
         AND o.deadline>CURRENT_DATE
         AND o.application_status NOT IN ('closed','not_open_competition')
         AND o.fetched_at>now()-interval '24 hours'
       ORDER BY a.created_at DESC LIMIT 30`,
      [userId],
    );
    return {
      ...base,
      opportunities: rows,
      alerts: alerts.rows,
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({
                at: last.fetched_at.toISOString(),
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  });
}
