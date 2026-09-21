-- human order numbers, revision flow, intake file analysis
create sequence public.order_no_seq start 10001;
alter table public.orders add column order_no text not null
  default 'KT-' || nextval('public.order_no_seq')::text;
create unique index orders_order_no_idx on public.orders (order_no);

alter table public.order_proposals
  add column revisions_used smallint not null default 0,
  add column revisions_cap smallint not null default 1;

-- customer revision requests (audit trail; stages do the work)
create table public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.order_proposals(id) on delete cascade,
  options text[] not null default '{}',
  details text,
  created_at timestamptz not null default now()
);
alter table public.revision_requests enable row level security;
revoke all on public.revision_requests from anon, authenticated;

-- uploaded old proposals, with extracted text where we can read the format
create table public.intake_files (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  file_name text not null,
  storage_path text not null,
  extracted_text text,          -- null when the format could not be read (e.g. pdf, v1)
  created_at timestamptz not null default now()
);
create index intake_files_email_idx on public.intake_files (email, created_at desc);
alter table public.intake_files enable row level security;
revoke all on public.intake_files from anon, authenticated;

alter table public.pre_intakes add column org_reg text;

-- rollups must allow complete -> processing when a revision appends new stages
create or replace function public.rollup_statuses()
returns void language sql security definer set search_path = '' as $$
  update public.order_proposals p set status =
    case
      when not exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status <> 'done') then 'complete'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'failed') then 'attention'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'held') then 'attention'
      else 'processing'
    end
  where exists (select 1 from public.job_stages s where s.proposal_id = p.id);

  update public.orders o set status =
    case
      when not exists (select 1 from public.order_proposals p where p.order_id = o.id and p.status <> 'complete') then 'complete'
      when exists (select 1 from public.order_proposals p where p.order_id = o.id and p.status = 'attention') then 'attention'
      else 'processing'
    end
  where o.status in ('paid','processing','attention','complete')
    and exists (select 1 from public.order_proposals p where p.order_id = o.id);
$$;
revoke all on function public.rollup_statuses() from public, anon, authenticated;
grant execute on function public.rollup_statuses() to service_role;