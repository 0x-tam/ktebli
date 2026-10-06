const groupKey = "coalesce(o.identity_key,o.id::text)";
const groupVersion = `CASE WHEN o.identity_key IS NULL THEN o.content_hash ELSE (
  SELECT md5(string_agg(alias.content_hash,'|' ORDER BY alias.source,alias.source_key))
  FROM membership.opportunities alias WHERE alias.identity_key=o.identity_key
) END`;

function sourceUsable(name: string) {
  return `${name}.kind=ANY(p.opportunity_types)
    AND ${name}.geography_status IN ('lebanon_confirmed','regional_includes_lebanon')
    AND ${name}.detail_status='verified' AND NOT ${name}.deadline_conflict
    -- The source contract has date-only deadlines. Due-today calls may have
    -- closed at an unrepresented hour, so paid matching excludes them.
    AND ${name}.deadline>CURRENT_DATE
    AND ${name}.application_status NOT IN ('not_open_competition','closed')
    AND ${name}.fetched_at>now()-interval '24 hours'`;
}

const eligible = `s.state='active' AND s.paid_until>now()
  AND ${sourceUsable("o")}
  AND (o.identity_key IS NULL OR (
    -- A newer usable publisher alias wins. Old partial/closed records cannot
    -- silently suppress a fresh qualified notice.
    NOT EXISTS (
      SELECT 1 FROM membership.opportunities better
      WHERE better.identity_key=o.identity_key AND better.id<>o.id
        AND ${sourceUsable("better")}
        AND (better.fetched_at,better.source,better.source_key,better.id)
            >(o.fetched_at,o.source,o.source_key,o.id)
    )
    -- Fresh official aliases with conflicting date, scope or state need
    -- operator review before any paid model call.
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
  ))`;

export const matchingCandidatesSql = `SELECT p.*,o.id AS opportunity_id,o.source,o.source_key,o.source_url,o.title,o.description,o.kind,o.published_at::text,o.deadline::text,o.evidence,o.locales,o.content_hash,o.fetched_at,o.detail_status,o.deadline_conflict,o.application_status,
  ${groupKey} AS group_key, ${groupVersion} AS group_version
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  CROSS JOIN membership.opportunities o
  LEFT JOIN membership.matches m ON m.user_id=p.user_id AND m.opportunity_id=o.id
  LEFT JOIN membership.matching_blocks b ON b.user_id=p.user_id AND b.opportunity_id=o.id AND b.profile_revision=p.revision AND b.content_hash=o.content_hash
  WHERE ${eligible}
    AND b.user_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM membership.matching_spend spent WHERE spent.user_id=p.user_id AND spent.identity_group_key=${groupKey} AND spent.profile_revision=p.revision AND spent.group_version=${groupVersion})
    AND (m.user_id IS NULL OR m.profile_revision<>p.revision OR m.content_hash<>o.content_hash OR m.group_version<>${groupVersion})
  ORDER BY o.fetched_at DESC LIMIT 20`;

// Recheck group winner, source version and material alias set in the same
// transaction that reserves a paid call. The first read can race a refresh.
export const matchingClaimEligibilitySql = `SELECT ${groupKey} AS group_key,${groupVersion} AS group_version
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  JOIN membership.opportunities o ON o.id=$2
  LEFT JOIN membership.matches m ON m.user_id=p.user_id AND m.opportunity_id=o.id
  WHERE p.user_id=$1 AND p.revision=$3 AND o.content_hash=$4
    AND ${groupVersion}=$5 AND ${eligible}
    AND (m.user_id IS NULL OR m.profile_revision<>p.revision OR m.content_hash<>o.content_hash OR m.group_version<>${groupVersion})`;

// Recheck after the model call. A stale result still settles its reservation.
export const matchingWriteSql = `INSERT INTO membership.matches(user_id,opportunity_id,profile_revision,content_hash,fit,confidence,eligibility,reasons,model,group_version)
  SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  JOIN membership.opportunities o ON o.id=$2
  WHERE p.user_id=$1 AND p.revision=$3 AND o.content_hash=$4
    AND ${groupVersion}=$10 AND ${eligible}
  ON CONFLICT(user_id,opportunity_id) DO UPDATE
  SET profile_revision=$3,content_hash=$4,fit=$5,confidence=$6,eligibility=$7,reasons=$8,model=$9,group_version=$10,matched_at=now()
  RETURNING user_id`;

export const matchingAlertSql = `INSERT INTO membership.alerts(user_id,opportunity_id,content_hash,group_version)
  SELECT $1,$2,$3,$5
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  JOIN membership.opportunities o ON o.id=$2
  JOIN membership.matches m ON m.user_id=p.user_id AND m.opportunity_id=o.id
  WHERE p.user_id=$1 AND p.revision=$4 AND p.alerts_enabled
    AND o.content_hash=$3 AND ${groupVersion}=$5
    AND m.profile_revision=p.revision AND m.content_hash=o.content_hash AND m.group_version=$5
    AND m.fit>=70 AND m.confidence>=0.65 AND m.eligibility='possible'
    AND ${eligible}
  ON CONFLICT DO NOTHING`;
