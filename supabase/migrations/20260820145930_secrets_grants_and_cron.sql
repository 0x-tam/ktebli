-- !! THIS FILE DELIBERATELY DIFFERS FROM THE RECORDED MIGRATION !!
--
-- The migration as recorded in supabase_migrations.schema_migrations for version
-- 20260820145930 differs from this file in two places. Both differences are
-- corrections, not transcription losses, and both exist so that replaying this
-- history into a NON-PRODUCTION environment is safe:
--
--   1. SECRET. The recorded statement embeds a worker_secret value as a plaintext
--      literal. That value has since been rotated and must never re-enter version
--      control. This file generates a fresh random secret per environment instead.
--      Nothing needs to know the literal: the worker reads it from Vault via
--      public.get_secret('worker_secret') and cron sends it from the same place,
--      so both sides of the comparison resolve from Vault at call time.
--
--   2. CRON TARGET. The recorded statement hardcodes the production project URL
--      (uocauqflcqefgdixbzpf). Replayed anywhere else that job would tick every
--      minute against PRODUCTION's worker. This file reads the target from a Vault
--      secret named 'worker_url' and ticks nothing until an operator sets it.
--
-- CONSEQUENCE FOR PRODUCTION: production's live 'ktebli-worker-tick' job still
-- carries the literal URL, because it was scheduled by the recorded statement and
-- this file has not been replayed there. Production is unaffected and keeps
-- working. To bring production onto the Vault-sourced form, an operator sets the
-- worker_url secret and re-runs the cron.schedule block at the bottom of this file.
-- Do not "fix" that divergence by replaying this migration against production.

-- secret access helper (service role only) + grants + worker cron
create or replace function public.get_secret(p_name text)
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
revoke all on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- the API server (service role) drives these; explicit grants after PUBLIC revokes
grant execute on function public.claim_approach(uuid,uuid,text,text,text,text,text,smallint,smallint,uuid,text) to service_role;
grant execute on function public.confirm_claim(uuid) to service_role;
grant execute on function public.release_claim(uuid) to service_role;
grant execute on function public.expire_stale_holds(uuid) to service_role;
grant execute on function public.claim_next_stage(int) to service_role;
grant execute on function public.reap_stale_stages() to service_role;
grant execute on function public.rollup_statuses() to service_role;

-- worker shared secret.
-- Generated, never literal. Created only if absent, so replaying this migration
-- cannot silently rotate a secret the deployed worker is already authenticating
-- against. 64 hex chars / 256 bits from core Postgres — no pgcrypto dependency.
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'worker_secret';
  if v_id is null then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'worker_secret'
    );
  end if;
end $$;

-- tick the worker every minute; the worker itself loops within its time budget.
-- The target comes from Vault, NOT from a literal, so this history can be replayed
-- into a branch or a scratch project without pointing at production. Until an
-- operator sets the worker_url secret the job is scheduled but ticks nothing:
-- the WHERE clause makes each tick a no-op rather than an error.
select cron.schedule(
  'ktebli-worker-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := s.u,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret', public.get_secret('worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  from (select public.get_secret('worker_url') as u) s
  where s.u is not null and s.u <> '';
  $$
);
