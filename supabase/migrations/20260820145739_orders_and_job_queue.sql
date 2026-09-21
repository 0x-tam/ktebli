-- Orders + persistent server-side job queue. Survives browser death by design.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- organisations can now be created by the payment webhook before any auth user exists
alter table public.organisations alter column owner_id drop not null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(), -- capability URL secret
  stripe_session_id text unique,
  organisation_id uuid references public.organisations(id),
  email text not null,
  org_name text not null,
  whatsapp text,
  tier text not null check (tier in ('trial','draft','competitive','full')),
  amount_usd numeric(7,2),
  grant_input text not null,
  deadline date,
  directions text,            -- the customer's dos and don'ts
  uploads_expected smallint not null default 0,
  status text not null default 'paid'
    check (status in ('paid','processing','complete','attention','refunded')),
  tracking_email_sent boolean not null default false,
  completion_email_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.order_proposals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  grant_id uuid references public.grants(id),
  claim_id uuid references public.claims(id),
  title text not null default 'Your proposal',
  status text not null default 'queued'
    check (status in ('queued','processing','complete','attention','failed')),
  created_at timestamptz not null default now()
);

-- one row per pipeline stage per proposal; THIS is the progress the UI shows
create table public.job_stages (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.order_proposals(id) on delete cascade,
  seq smallint not null,
  key text not null,          -- analyze | plan | gen:<kind> | check | package | deliver
  label text not null,        -- customer-facing wording
  status text not null default 'pending'
    check (status in ('pending','running','done','failed','held')),
  attempt smallint not null default 0,
  max_attempts smallint not null default 3,
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  output jsonb,               -- stage artifacts (analysis json, doc storage paths...)
  error text,
  unique (proposal_id, seq)
);
create index job_stages_ready on public.job_stages (status, seq) where status in ('pending','running');

-- intake analysis snapshots from the wizard (pre-payment link previews)
create table public.link_previews (
  id uuid primary key default gen_random_uuid(),
  url_or_text_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_proposals enable row level security;
alter table public.job_stages enable row level security;
alter table public.link_previews enable row level security;
revoke all on public.orders, public.order_proposals, public.job_stages, public.link_previews
  from anon, authenticated;

-- claim one runnable stage (concurrency-safe): earliest pending stage whose
-- predecessors are done, on a proposal not already running a stage.
create or replace function public.claim_next_stage(p_global_cap int default 6)
returns table (stage_id bigint, proposal_id uuid, seq smallint, key text, attempt smallint)
language plpgsql security definer set search_path = '' as $$
begin
  -- global concurrency cap across all proposals
  if (select count(*) from public.job_stages s
      where s.status = 'running'
        and s.heartbeat_at > now() - interval '3 minutes') >= p_global_cap then
    return;
  end if;

  return query
  with runnable as (
    select s.id
    from public.job_stages s
    where s.status = 'pending'
      and s.attempt < s.max_attempts
      and not exists (select 1 from public.job_stages p
                      where p.proposal_id = s.proposal_id and p.seq < s.seq
                        and p.status <> 'done')
      and not exists (select 1 from public.job_stages r
                      where r.proposal_id = s.proposal_id and r.status = 'running'
                        and r.heartbeat_at > now() - interval '3 minutes')
    order by s.proposal_id, s.seq
    limit 1
    for update skip locked
  )
  update public.job_stages s
     set status = 'running', attempt = s.attempt + 1,
         started_at = coalesce(s.started_at, now()), heartbeat_at = now(), error = null
    from runnable r where s.id = r.id
  returning s.id, s.proposal_id, s.seq, s.key, s.attempt;
end;
$$;
revoke all on function public.claim_next_stage(int) from public, anon, authenticated;

-- reap stages whose worker died (no heartbeat): back to pending or failed
create or replace function public.reap_stale_stages()
returns int language sql security definer set search_path = '' as $$
  with reaped as (
    update public.job_stages
       set status = case when attempt >= max_attempts then 'failed' else 'pending' end,
           error = coalesce(error,'') || ' [timeout]'
     where status = 'running' and heartbeat_at < now() - interval '3 minutes'
    returning id
  ) select count(*)::int from reaped;
$$;
revoke all on function public.reap_stale_stages() from public, anon, authenticated;

-- roll proposal + order status up from stages, once per tick
create or replace function public.rollup_statuses()
returns void language sql security definer set search_path = '' as $$
  update public.order_proposals p set status =
    case
      when not exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status <> 'done') then 'complete'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'failed') then 'attention'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'held') then 'attention'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'running') then 'processing'
      else p.status
    end
  where p.status not in ('complete');

  update public.orders o set status =
    case
      when not exists (select 1 from public.order_proposals p where p.order_id = o.id and p.status <> 'complete') then 'complete'
      when exists (select 1 from public.order_proposals p where p.order_id = o.id and p.status = 'attention') then 'attention'
      else 'processing'
    end
  where o.status in ('paid','processing','attention')
    and exists (select 1 from public.order_proposals p where p.order_id = o.id);
$$;
revoke all on function public.rollup_statuses() from public, anon, authenticated;

-- deliverables bucket
insert into storage.buckets (id, name, public) values ('order-files','order-files', false)
on conflict (id) do nothing;