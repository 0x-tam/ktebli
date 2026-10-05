-- Add one independently verified official grant page. This changes only the
-- source allowlists; existing catalogue rows and account data are untouched.
ALTER TABLE membership.opportunities DROP CONSTRAINT opportunities_source_check;
ALTER TABLE membership.opportunities ADD CONSTRAINT opportunities_source_check
  CHECK (source IN ('cdr','ppa','japan-ggp','australia-dap','czech-ssp','canada-cfli','eeas','aics','undp','ungm','mawred'));
ALTER TABLE membership.crawler_checkpoints DROP CONSTRAINT crawler_checkpoints_source_check;
ALTER TABLE membership.crawler_checkpoints ADD CONSTRAINT crawler_checkpoints_source_check
  CHECK (source IN ('ppa','ungm-curated','mawred'));
