-- =====================================================================
-- public.bench_cases — EXISTS IN PRODUCTION, IN NO MIGRATION
--
-- Replaying supabase/migrations/ reproduces the live public schema exactly
-- EXCEPT for this table. It was created outside the migration history
-- (ad hoc), which is also why it is the only table in the database with
-- RLS *disabled* — it never went through the deny-by-default pass in
-- 20260819194949_rls_and_claim_functions.sql.
--
-- It holds benchmark cases (B1-B10 archetypes, R1-R3 real organisations),
-- so it is test scaffolding rather than customer data. Decide deliberately:
--   (a) adopt it — add this as a migration, then tell the CLI production
--       already has it:  supabase migration repair --status applied <version>
--   (b) drop it from production if the benchmark work is finished.
-- Either way it should stop being invisible drift.
--
-- Left OUT of supabase/migrations/ on purpose: a file there would look
-- unapplied to the CLI and invite a push against production.
-- =====================================================================

CREATE TABLE public.bench_cases (
    code text NOT NULL,
    label text,
    tier text,
    org_name text,
    org_reg text,
    org_website text,
    directions text,
    guidelines text,
    order_id uuid,
    proposal_id uuid,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.bench_cases ADD CONSTRAINT bench_cases_pkey PRIMARY KEY (code);

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bench_cases TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bench_cases TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bench_cases TO postgres;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bench_cases TO service_role;

-- NOTE: production has NO "ALTER TABLE public.bench_cases ENABLE ROW LEVEL
-- SECURITY". Reproduced here as-is. anon and authenticated therefore hold
-- full DML on this table with nothing constraining them.
