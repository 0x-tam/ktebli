-- !! REDACTED FOR VERSION CONTROL !!
-- The migration as recorded in the live project embeds the real worker_secret
-- value literally in the two vault calls below. That value is NOT reproduced
-- here. Both occurrences are replaced with the placeholder __WORKER_SECRET__.
-- This file therefore differs from supabase_migrations.schema_migrations for
-- version 20260820145930; that difference is deliberate.
-- Before replaying this anywhere, substitute a real secret, and see
-- reports/supabase-cli-audit.md on rotating the live one.

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

-- worker shared secret (idempotent create-or-update)
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'worker_secret';
  if v_id is null then
    perform vault.create_secret('__WORKER_SECRET__', 'worker_secret');
  else
    perform vault.update_secret(v_id, '__WORKER_SECRET__');
  end if;
end $$;

-- tick the worker every minute; the worker itself loops within its time budget
select cron.schedule(
  'ktebli-worker-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://uocauqflcqefgdixbzpf.supabase.co/functions/v1/worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret', public.get_secret('worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);