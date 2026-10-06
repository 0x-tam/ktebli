import "server-only";
import { userTransaction } from "./db";
import { HttpError } from "./http";
import { z } from "zod";

export const catalogueFiltersSchema = z.object({
  query: z.string().trim().max(200).default(""),
  kind: z.enum(["all", "procurement", "grant", "unknown"]).default("all"),
  source: z
    .enum(["all", "ppa", "ungm", "mawred", "worldbank", "cdr"])
    .default("all"),
  status: z.enum(["all", "current", "needs_review", "closed"]).default("all"),
  deadline: z
    .enum(["all", "future", "today", "past", "unknown"])
    .default("all"),
  saved: z.boolean().default(false),
  cursor: z.string().max(500).optional(),
});
export type CatalogueFilters = z.input<typeof catalogueFiltersSchema>;
const cursorSchema = z.object({
  at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

// The representative is selected before filters so a filtered page cannot display
// a stale sibling as though it were an independent notice. Every alias remains in
// source_aliases and saved state, while matching remains tied to the group version.
const catalogueCte = `WITH ranked AS (
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
), selected AS (
  SELECT o.*,
    CASE
      WHEN o.application_status IN ('closed','not_open_competition') OR o.deadline<CURRENT_DATE THEN 'closed'
      WHEN o.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
        AND o.detail_status='verified' AND NOT o.deadline_conflict AND NOT o.group_conflict
        AND o.fetched_at>now()-interval '24 hours' AND o.deadline>CURRENT_DATE THEN 'current'
      ELSE 'needs_review'
    END AS board_status
  FROM ranked o WHERE o.group_rank=1
), filtered AS (
  SELECT o.* FROM selected o
  WHERE ($2='' OR EXISTS(
      SELECT 1 FROM membership.opportunities search_alias
      WHERE search_alias.id=ANY(o.alias_ids)
        AND strpos(lower(search_alias.title||' '||search_alias.description||' '||search_alias.source),lower($2))>0))
    AND ($3='all' OR o.kind=$3)
    AND ($4='all' OR EXISTS(
      SELECT 1 FROM membership.opportunities source_alias
      WHERE source_alias.id=ANY(o.alias_ids) AND source_alias.source=$4))
    AND ($5='all' OR o.board_status=$5)
    AND ($6='all' OR ($6='future' AND o.deadline>CURRENT_DATE)
      OR ($6='today' AND o.deadline=CURRENT_DATE)
      OR ($6='past' AND o.deadline<CURRENT_DATE)
      OR ($6='unknown' AND o.deadline IS NULL))
    AND ($7::boolean=false OR EXISTS(
      SELECT 1 FROM membership.saved_opportunities s
      WHERE s.user_id=$1 AND s.opportunity_id=ANY(o.alias_ids)))
)`;

export async function dashboardData(
  userId: string,
  raw: CatalogueFilters = {},
) {
  const options = catalogueFiltersSchema.parse(raw);
  let cursor: { at: string; id: string } | undefined;
  if (options.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new HttpError(400, "Invalid page cursor");
    }
  }
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
    if (options.saved && !paid)
      throw new HttpError(402, "An active paid membership is required");
    const credits = await db.query(
      "SELECT id,amount_cents,expires_at,state FROM membership.credits WHERE user_id=$1 AND expires_at>now() AND valid_from<=now() AND state IN ('available','reserved') ORDER BY expires_at DESC LIMIT 1",
      [userId],
    );
    const values = [
      userId,
      options.query,
      options.kind,
      options.source,
      options.status,
      options.deadline,
      options.saved,
      paid,
      cursor?.at ?? null,
      cursor?.id ?? null,
    ];
    const count = await db.query(
      `${catalogueCte} SELECT count(*)::int AS total FROM filtered`,
      values.slice(0, 7),
    );
    const opportunities = await db.query(
      `${catalogueCte}
       SELECT o.*,o.published_at::text AS published_at,o.deadline::text AS deadline,
         to_char(o.fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
         CASE WHEN $8::boolean THEN EXISTS(
           SELECT 1 FROM membership.saved_opportunities s
           WHERE s.user_id=$1 AND s.opportunity_id=ANY(o.alias_ids)) ELSE false END AS saved,
         CASE WHEN $8::boolean AND m.profile_revision=p.revision AND m.content_hash=o.content_hash
           AND m.group_version=o.group_version AND o.board_status='current'
           THEN m.fit END AS fit,
         CASE WHEN $8::boolean AND m.profile_revision=p.revision AND m.content_hash=o.content_hash
           AND m.group_version=o.group_version AND o.board_status='current'
           THEN m.confidence END AS confidence,
         CASE WHEN $8::boolean AND m.profile_revision=p.revision AND m.content_hash=o.content_hash
           AND m.group_version=o.group_version AND o.board_status='current'
           THEN m.eligibility END AS eligibility,
         CASE WHEN $8::boolean AND m.profile_revision=p.revision AND m.content_hash=o.content_hash
           AND m.group_version=o.group_version AND o.board_status='current'
           THEN m.reasons END AS reasons
       FROM filtered o
       LEFT JOIN membership.matches m ON $8::boolean AND m.opportunity_id=o.id AND m.user_id=$1
       LEFT JOIN membership.profiles p ON $8::boolean AND p.user_id=$1
       WHERE ($9::timestamptz IS NULL OR (o.fetched_at,o.id)<($9::timestamptz,$10::uuid))
       ORDER BY o.fetched_at DESC,o.id DESC LIMIT 51`,
      values,
    );
    const more = opportunities.rows.length > 50;
    const rows = opportunities.rows.slice(0, 50);
    const last = rows.at(-1);
    const alerts = paid
      ? await db.query(
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
        )
      : { rows: [] };
    return {
      profile: profile.rows[0] ?? null,
      subscription: subscription.rows[0] ?? null,
      credit: credits.rows[0] ?? null,
      opportunities: rows,
      alerts: alerts.rows,
      filteredCount: count.rows[0].total as number,
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({ at: last.cursor_at, id: last.id }),
            ).toString("base64url")
          : null,
    };
  });
}
