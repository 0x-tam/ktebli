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
      `WITH grouped AS (
         SELECT o.*,
           CASE WHEN o.identity_key IS NULL THEN o.content_hash ELSE (
             SELECT md5(string_agg(alias.content_hash,'|' ORDER BY alias.source,alias.source_key))
             FROM membership.opportunities alias WHERE alias.identity_key=o.identity_key
           ) END AS group_version,
           row_number() OVER (PARTITION BY coalesce(o.identity_key,o.id::text)
             ORDER BY (o.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
               AND o.detail_status='verified' AND NOT o.deadline_conflict
               AND o.fetched_at>now()-interval '24 hours'
               AND o.application_status NOT IN ('closed','not_open_competition')
               AND o.deadline>CURRENT_DATE) DESC,
               (o.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
               AND o.application_status NOT IN ('closed','not_open_competition')
               AND (o.deadline IS NULL OR o.deadline>=CURRENT_DATE)) DESC,
               (o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours') DESC,
               o.fetched_at DESC,o.source DESC,o.source_key DESC,o.id DESC) AS group_rank,
           array_agg(o.id) OVER (PARTITION BY coalesce(o.identity_key,o.id::text)) AS alias_ids,
           jsonb_agg(jsonb_build_object('source',o.source,'source_url',o.source_url,'title',o.title))
             OVER (PARTITION BY coalesce(o.identity_key,o.id::text)) AS source_aliases,
           (o.identity_key IS NOT NULL AND EXISTS (
             SELECT 1 FROM membership.opportunities conflict
             WHERE conflict.identity_key=o.identity_key AND conflict.id<>o.id
               AND conflict.detail_status='verified'
               AND conflict.fetched_at>now()-interval '24 hours'
               AND (conflict.deadline IS DISTINCT FROM o.deadline
                 OR conflict.kind IS DISTINCT FROM o.kind
                 OR conflict.application_status IN ('closed','not_open_competition')
                 OR conflict.geography_status='outside_lebanon'
                 OR conflict.deadline_conflict)
           )) AS group_conflict
         FROM membership.opportunities o
       )
       SELECT o.*,o.published_at::text AS published_at,o.deadline::text AS deadline,
   EXISTS(SELECT 1 FROM membership.saved_opportunities s WHERE s.user_id=$1 AND s.opportunity_id=ANY(o.alias_ids)) AS saved,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND m.group_version=o.group_version AND NOT o.deadline_conflict AND NOT o.group_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.fit END AS fit,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND m.group_version=o.group_version AND NOT o.deadline_conflict AND NOT o.group_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.confidence END AS confidence,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND m.group_version=o.group_version AND NOT o.deadline_conflict AND NOT o.group_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.eligibility END AS eligibility,
   CASE WHEN m.profile_revision=p.revision AND m.content_hash=o.content_hash AND m.group_version=o.group_version AND NOT o.deadline_conflict AND NOT o.group_conflict AND o.detail_status='verified' AND o.fetched_at>now()-interval '24 hours' THEN m.reasons END AS reasons
   FROM grouped o
   LEFT JOIN membership.matches m ON m.opportunity_id=o.id AND m.user_id=$1 LEFT JOIN membership.profiles p ON p.user_id=$1
   WHERE o.group_rank=1 AND o.geography_status IN ('lebanon_confirmed','regional_includes_lebanon') AND (o.deadline IS NULL OR o.deadline>=CURRENT_DATE) AND o.application_status NOT IN ('not_open_competition','closed') AND (o.deadline IS NOT NULL OR o.fetched_at>now()-interval '30 days')
    AND ($2='' OR strpos(lower(o.title||' '||o.description),lower($2))>0)
    AND ($3::timestamptz IS NULL OR (o.fetched_at,o.id)<($3::timestamptz,$4::uuid))
   AND ($5::boolean=false OR EXISTS(SELECT 1 FROM membership.saved_opportunities s WHERE s.user_id=$1 AND s.opportunity_id=ANY(o.alias_ids))) ORDER BY o.fetched_at DESC,o.id DESC LIMIT 51`,
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
       JOIN membership.matches m ON m.user_id=a.user_id AND m.opportunity_id=a.opportunity_id AND m.content_hash=a.content_hash AND m.group_version=a.group_version
       JOIN membership.profiles p ON p.user_id=a.user_id AND p.revision=m.profile_revision
       WHERE a.user_id=$1 AND o.kind=ANY(p.opportunity_types)
         AND p.alerts_enabled AND m.fit>=70 AND m.confidence>=0.65 AND m.eligibility='possible'
         AND o.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
         AND o.detail_status='verified' AND NOT o.deadline_conflict
         AND o.deadline>CURRENT_DATE
         AND o.application_status NOT IN ('closed','not_open_competition')
         AND o.fetched_at>now()-interval '24 hours'
         AND a.group_version=(CASE WHEN o.identity_key IS NULL THEN o.content_hash ELSE (
           SELECT md5(string_agg(alias.content_hash,'|' ORDER BY alias.source,alias.source_key))
           FROM membership.opportunities alias WHERE alias.identity_key=o.identity_key
         ) END)
         AND NOT EXISTS (
           SELECT 1 FROM membership.opportunities better
           WHERE better.identity_key=o.identity_key AND better.id<>o.id
             AND better.kind=ANY(p.opportunity_types)
             AND better.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
             AND better.detail_status='verified' AND NOT better.deadline_conflict
             AND better.deadline>CURRENT_DATE
             AND better.application_status NOT IN ('closed','not_open_competition')
             AND better.fetched_at>now()-interval '24 hours'
             AND (better.fetched_at,better.source,better.source_key,better.id)
                 >(o.fetched_at,o.source,o.source_key,o.id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM membership.opportunities conflict
           WHERE conflict.identity_key=o.identity_key AND conflict.id<>o.id
             AND conflict.detail_status='verified'
             AND conflict.fetched_at>now()-interval '24 hours'
             AND (conflict.deadline IS DISTINCT FROM o.deadline
               OR conflict.kind IS DISTINCT FROM o.kind
               OR conflict.application_status IN ('closed','not_open_competition')
               OR conflict.geography_status='outside_lebanon'
               OR conflict.deadline_conflict)
         )
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
