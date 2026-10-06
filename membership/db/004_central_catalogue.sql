-- Keep every publisher notice and stable opportunity UUID. Exact identity
-- claims may group display cards, but never delete or rewrite saved notices.
ALTER TABLE membership.opportunities DROP CONSTRAINT opportunities_source_check;
ALTER TABLE membership.opportunities ADD CONSTRAINT opportunities_source_check
  CHECK (source IN ('cdr','ppa','japan-ggp','australia-dap','czech-ssp','canada-cfli','eeas','aics','undp','ungm','mawred','worldbank'));
ALTER TABLE membership.opportunities
  ADD COLUMN source_content_hash text,
  ADD COLUMN geography_status text NOT NULL DEFAULT 'unknown'
    CHECK (geography_status IN ('lebanon_confirmed','regional_includes_lebanon','unknown','outside_lebanon')),
  ADD COLUMN geography_evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(geography_evidence)='array'),
  ADD COLUMN identity_key text CHECK (identity_key ~ '^[a-f0-9]{64}$'),
  ADD COLUMN identity_claim jsonb CHECK (identity_claim IS NULL OR jsonb_typeof(identity_claim)='object');
UPDATE membership.opportunities SET source_content_hash=content_hash;
ALTER TABLE membership.opportunities ALTER COLUMN source_content_hash SET NOT NULL;
ALTER TABLE membership.opportunities ADD CONSTRAINT opportunities_source_content_hash_check
  CHECK (source_content_hash ~ '^[a-f0-9]{64}$');
CREATE INDEX opportunities_identity_group_idx
  ON membership.opportunities(identity_key,first_seen_at,id)
  WHERE identity_key IS NOT NULL;
CREATE INDEX opportunities_geography_fresh_idx
  ON membership.opportunities(geography_status,fetched_at DESC);

-- One paid reservation per exact group/profile/material group version. This
-- remains unique if the freshest publisher alias changes between runs.
ALTER TABLE membership.matching_spend
  ADD COLUMN identity_group_key text,
  ADD COLUMN group_version text;
UPDATE membership.matching_spend spend
SET identity_group_key=coalesce(o.identity_key,spend.opportunity_id::text),
    group_version=spend.content_hash
FROM membership.opportunities o WHERE o.id=spend.opportunity_id;
UPDATE membership.matching_spend
SET identity_group_key=coalesce(identity_group_key,opportunity_id::text),
    group_version=coalesce(group_version,content_hash);
ALTER TABLE membership.matching_spend
  ALTER COLUMN identity_group_key SET NOT NULL,
  ALTER COLUMN group_version SET NOT NULL;
CREATE UNIQUE INDEX matching_spend_exact_group_version_idx
  ON membership.matching_spend(user_id,identity_group_key,profile_revision,group_version);

-- A sibling publisher refresh invalidates prior fit and alert even when the
-- selected notice's own content hash did not change. Legacy results fail closed.
ALTER TABLE membership.matches ADD COLUMN group_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE membership.matches ALTER COLUMN group_version DROP DEFAULT;
ALTER TABLE membership.alerts ADD COLUMN group_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE membership.alerts ALTER COLUMN group_version DROP DEFAULT;
ALTER TABLE membership.alerts DROP CONSTRAINT alerts_user_id_opportunity_id_content_hash_key;
CREATE UNIQUE INDEX alerts_group_version_idx
  ON membership.alerts(user_id,opportunity_id,content_hash,group_version);

ALTER TABLE membership.crawler_checkpoints DROP CONSTRAINT crawler_checkpoints_source_check;
ALTER TABLE membership.crawler_checkpoints ADD CONSTRAINT crawler_checkpoints_source_check
  CHECK (source IN ('ppa','ungm-curated','mawred','worldbank'));
-- Authenticated users can inspect public collection health, never raw state.
CREATE POLICY crawler_checkpoint_runtime_meta ON membership.crawler_checkpoints
  FOR SELECT TO membership_runtime USING (true);
GRANT SELECT(source,phase,last_status,last_run_at,last_import_at,coverage)
  ON membership.crawler_checkpoints TO membership_runtime;
