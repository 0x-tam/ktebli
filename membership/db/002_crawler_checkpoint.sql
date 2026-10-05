-- Public-source ingestion has no access to applicant or billing data.
DO $$ BEGIN CREATE ROLE membership_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA membership TO membership_ingest;
CREATE POLICY catalogue_ingest ON membership.opportunities TO membership_ingest USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON membership.opportunities TO membership_ingest;
CREATE POLICY source_runs_ingest ON membership.source_runs TO membership_ingest USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON membership.source_runs TO membership_ingest;

-- A bounded checkpoint survives ephemeral runners. Full enrichment will grow
-- state substantially; the runner also enforces a decoded 256 MiB limit.
CREATE TABLE membership.crawler_checkpoints (
  source text PRIMARY KEY CHECK (source IN ('ppa','ungm-curated')),
  state_gzip bytea NOT NULL CHECK (octet_length(state_gzip) BETWEEN 1 AND 33554432),
  state_sha256 text NOT NULL CHECK (state_sha256 ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  phase text NOT NULL CHECK (phase IN ('listing','backlog','imported')),
  last_run_at timestamptz NOT NULL DEFAULT now(),
  last_import_at timestamptz,
  last_status text NOT NULL CHECK (last_status IN ('pending','incomplete','failed','imported')),
  last_error text CHECK (length(last_error) <= 80),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE membership.crawler_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.crawler_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY crawler_checkpoint_ingest ON membership.crawler_checkpoints
  TO membership_ingest USING (true) WITH CHECK (true);
CREATE POLICY crawler_checkpoint_worker_read ON membership.crawler_checkpoints
  FOR SELECT TO membership_worker USING (true);
GRANT SELECT,INSERT,UPDATE ON membership.crawler_checkpoints TO membership_ingest;
GRANT SELECT ON membership.crawler_checkpoints TO membership_worker;
