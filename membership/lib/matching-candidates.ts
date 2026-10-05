const eligible = `s.state='active' AND s.paid_until>now()
  AND o.kind=ANY(p.opportunity_types)
  AND o.detail_status='verified' AND NOT o.deadline_conflict
  -- The source contract stores only a date. A notice due today may already
  -- have closed at a time we cannot represent, so exclude it conservatively.
  AND o.deadline>CURRENT_DATE
  AND o.application_status NOT IN ('not_open_competition','closed')
  AND o.fetched_at>now()-interval '24 hours'`;

export const matchingCandidatesSql = `SELECT p.*,o.id AS opportunity_id,o.source,o.source_key,o.source_url,o.title,o.description,o.kind,o.published_at::text,o.deadline::text,o.evidence,o.locales,o.content_hash,o.fetched_at,o.detail_status,o.deadline_conflict,o.application_status
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  CROSS JOIN membership.opportunities o
  LEFT JOIN membership.matches m ON m.user_id=p.user_id AND m.opportunity_id=o.id
  LEFT JOIN membership.matching_blocks b ON b.user_id=p.user_id AND b.opportunity_id=o.id AND b.profile_revision=p.revision AND b.content_hash=o.content_hash
  WHERE ${eligible}
    AND b.user_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM membership.matching_spend spent WHERE spent.user_id=p.user_id AND spent.opportunity_id=o.id AND spent.profile_revision=p.revision AND spent.content_hash=o.content_hash)
    AND (m.user_id IS NULL OR m.profile_revision<>p.revision OR m.content_hash<>o.content_hash)
  ORDER BY o.fetched_at DESC LIMIT 20`;

// Check again immediately before reserving a paid call; the initial candidate
// read can race profile edits, subscription changes and catalogue refreshes.
export const matchingClaimEligibilitySql = `SELECT 1 FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  JOIN membership.opportunities o ON o.id=$2
  LEFT JOIN membership.matches m ON m.user_id=p.user_id AND m.opportunity_id=o.id
  WHERE p.user_id=$1 AND p.revision=$3 AND o.content_hash=$4 AND ${eligible}
    AND (m.user_id IS NULL OR m.profile_revision<>p.revision OR m.content_hash<>o.content_hash)`;

// Recheck the paid account, profile revision, and source version after the
// model call. A failed recheck still settles the already-reserved spend.
export const matchingWriteSql = `INSERT INTO membership.matches(user_id,opportunity_id,profile_revision,content_hash,fit,confidence,eligibility,reasons,model)
  SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  JOIN membership.opportunities o ON o.id=$2
  WHERE p.user_id=$1 AND p.revision=$3 AND o.content_hash=$4 AND ${eligible}
  ON CONFLICT(user_id,opportunity_id) DO UPDATE
  SET profile_revision=$3,content_hash=$4,fit=$5,confidence=$6,eligibility=$7,reasons=$8,model=$9,matched_at=now()
  RETURNING user_id`;

export const matchingAlertSql = `INSERT INTO membership.alerts(user_id,opportunity_id,content_hash)
  SELECT $1,$2,$3
  FROM membership.profiles p
  JOIN membership.subscriptions s ON s.user_id=p.user_id
  JOIN membership.opportunities o ON o.id=$2
  JOIN membership.matches m ON m.user_id=p.user_id AND m.opportunity_id=o.id
  WHERE p.user_id=$1 AND p.revision=$4 AND p.alerts_enabled
    AND o.content_hash=$3 AND m.profile_revision=p.revision AND m.content_hash=o.content_hash
    AND m.fit>=70 AND m.confidence>=0.65 AND m.eligibility='possible'
    AND ${eligible}
  ON CONFLICT DO NOTHING`;
