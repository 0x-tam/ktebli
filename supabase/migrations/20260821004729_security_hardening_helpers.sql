
-- =========================================================================
-- Security hardening helpers: rate limiting, atomic revision claim,
-- Stripe event idempotency. All objects are service-role only (no anon).
-- =========================================================================

-- ---- Rate limiting (fixed-window counter) --------------------------------
create table if not exists public.rate_limits (
  bucket        text        not null,
  window_start  timestamptz not null,
  count         integer     not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security;  -- deny-all to anon/authenticated

create or replace function public.rl_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into public.rate_limits(bucket, window_start, count)
  values (p_key, w, 1)
  on conflict (bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into c;
  return c <= p_max;  -- true = allowed
end;
$$;

-- ---- Atomic revision claim (prevents concurrent over-cap) -----------------
create or replace function public.claim_revision(p_proposal uuid, p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used   smallint;
  v_cap    smallint;
  v_status text;
  v_new    smallint;
begin
  select status, revisions_used, revisions_cap
    into v_status, v_used, v_cap
    from public.order_proposals
    where id = p_proposal and order_id = p_order
    for update;                       -- row lock serialises concurrent callers

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status <> 'complete' then
    return jsonb_build_object('ok', false, 'reason', 'not_complete');
  end if;
  if v_used >= v_cap then
    return jsonb_build_object('ok', false, 'reason', 'no_revisions_left', 'remaining', 0);
  end if;

  update public.order_proposals
     set revisions_used = revisions_used + 1, status = 'processing'
     where id = p_proposal
     returning revisions_used into v_new;

  return jsonb_build_object('ok', true, 'revisions_used', v_new, 'remaining', v_cap - v_new);
end;
$$;

-- ---- Stripe event idempotency --------------------------------------------
create table if not exists public.stripe_events (
  id          text primary key,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;  -- deny-all to anon/authenticated

-- returns true if the event was already processed (seen), false on first sight
create or replace function public.stripe_event_seen(p_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_events(id) values (p_id);
  return false;
exception when unique_violation then
  return true;
end;
$$;

-- ---- Lock these helpers down to service_role only -------------------------
revoke all on function public.rl_hit(text,integer,integer)        from public, anon, authenticated;
revoke all on function public.claim_revision(uuid,uuid)           from public, anon, authenticated;
revoke all on function public.stripe_event_seen(text)             from public, anon, authenticated;
grant  execute on function public.rl_hit(text,integer,integer)    to service_role;
grant  execute on function public.claim_revision(uuid,uuid)       to service_role;
grant  execute on function public.stripe_event_seen(text)         to service_role;

-- Ensure the new tables are never exposed through PostgREST to public roles
revoke all on public.rate_limits   from anon, authenticated;
revoke all on public.stripe_events from anon, authenticated;
