-- Ktebli core schema. The locks live here as constraints, not conventions.
create extension if not exists vector;

-- ============ reference pools ============
create table public.structural_templates (
  id smallint generated always as identity primary key,
  name text not null unique,
  description text not null,
  active boolean not null default true
);

create table public.opening_devices (
  id smallint generated always as identity primary key,
  name text not null unique,
  description text not null,
  active boolean not null default true
);

-- ============ customers ============
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  registration_number text not null unique,
  email text not null,
  whatsapp text,
  sanctions_status text not null default 'pending'
    check (sanctions_status in ('pending','cleared','flagged','refused')),
  sanctions_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id)
);

create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  kind text not null check (kind in ('custom','house')),
  profile jsonb not null,
  created_at timestamptz not null default now(),
  check ((kind = 'house') = (organisation_id is null))
);

-- ============ grants ============
create table public.grants (
  id uuid primary key default gen_random_uuid(),
  funder text not null,
  title text not null,
  title_normalized text not null,
  deadline date,
  source_url text,
  guidelines_text text not null,
  guidelines_embedding vector(1536),
  embedding_version text not null default 'v1',
  status text not null default 'open' check (status in ('open','closed','merged')),
  merged_into uuid references public.grants(id),
  created_at timestamptz not null default now()
);
create index grants_dedupe_idx on public.grants (funder, title_normalized, deadline);

create table public.grant_merge_reviews (
  id uuid primary key default gen_random_uuid(),
  grant_a uuid not null references public.grants(id),
  grant_b uuid not null references public.grants(id),
  similarity numeric(4,3) not null,
  status text not null default 'pending' check (status in ('pending','same','different')),
  due_at timestamptz not null default now() + interval '4 hours',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (grant_a, grant_b),
  check (grant_a < grant_b)
);

-- ============ THE LOCK ============
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.grants(id),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  intervention_type text not null,
  delivery_method text not null,
  beneficiary text not null,
  geography_bucket text not null,
  signature_mechanic text not null,
  structural_template_id smallint not null references public.structural_templates(id),
  opening_device_id smallint not null references public.opening_devices(id),
  voice_profile_id uuid not null references public.voice_profiles(id),
  voice_kind text not null check (voice_kind in ('custom','house')),
  status text not null default 'hold' check (status in ('hold','confirmed','released')),
  hold_expires_at timestamptz not null default now() + interval '6 hours',
  created_at timestamptz not null default now()
);

create unique index claims_one_per_org
  on public.claims (grant_id, organisation_id)
  where status in ('hold','confirmed');

-- LOCK 2: no two live claims share the concept combination on one grant
create unique index claims_concept_lock
  on public.claims (grant_id, intervention_type, delivery_method, beneficiary, geography_bucket)
  where status in ('hold','confirmed');

-- LOCK 3: structure and opening are exclusive per grant
create unique index claims_template_lock
  on public.claims (grant_id, structural_template_id)
  where status in ('hold','confirmed');
create unique index claims_opening_lock
  on public.claims (grant_id, opening_device_id)
  where status in ('hold','confirmed');

-- house voices are exclusive per grant (voice_kind denormalised onto the claim)
create unique index claims_house_voice_lock
  on public.claims (grant_id, voice_profile_id)
  where status in ('hold','confirmed') and voice_kind = 'house';

-- ============ work ============
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  grant_id uuid not null references public.grants(id),
  claim_id uuid not null references public.claims(id),
  tier text not null check (tier in ('draft','competitive','full')),
  price_usd numeric(6,2) not null,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','paid','refunded')),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','queued','generating','similarity_check',
                      'human_review','delivered','failed','refunded')),
  attempt_count smallint not null default 0 check (attempt_count <= 3),
  revision_rounds_used smallint not null default 0,
  revision_rounds_cap smallint not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  check (revision_rounds_used <= revision_rounds_cap),
  unique (claim_id)
);

create table public.intakes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (proposal_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  kind text not null check (kind in ('narrative','concept_note','budget_xlsx','budget_justification',
    'workplan','logframe','risk_table','board_summary','support_letter','job_descriptions',
    'followup_prep','cover_email','similarity_check','review_report','arabic_narrative','other')),
  storage_path text not null,
  sha256 text not null,
  version smallint not null default 1,
  created_at timestamptz not null default now()
);

-- abstract shape; survives account deletion with organisation_id nulled
create table public.fingerprints (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.grants(id),
  organisation_id uuid references public.organisations(id) on delete set null,
  proposal_id uuid references public.proposals(id) on delete set null,
  claim_snapshot jsonb not null,
  narrative_embedding vector(1536),
  section_embeddings jsonb,
  embedding_version text not null default 'v1',
  created_at timestamptz not null default now()
);
create index fingerprints_grant_idx on public.fingerprints (grant_id);

create table public.similarity_reports (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  passed boolean not null,
  results jsonb not null,
  embedding_version text not null,
  created_at timestamptz not null default now()
);

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete cascade,
  kind text not null check (kind in ('similarity_exhausted','grant_merge','sanctions_review',
                                     'planner_stuck','provenance_failed','other')),
  detail jsonb not null default '{}'::jsonb,
  priority text not null default 'normal' check (priority in ('normal','deadline_72h')),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);