-- Organisation intelligence: cached website understanding + consolidated
-- organisation profile + evidence ledger + voice guide, one row per organisation.
-- This is the reusable organisational asset (contract parts 7, 8, 8B).
create table if not exists public.org_intel (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  domain text,
  profile jsonb not null default '{}'::jsonb,   -- Organisation Profile (structured, provenance-keyed)
  evidence jsonb not null default '[]'::jsonb,  -- Evidence Ledger items [{id,claim,source_type,source_ref,date,confidence,status,allowed,time_sensitive}]
  voice jsonb not null default '{}'::jsonb,     -- language/voice guide derived from website
  gaps jsonb not null default '[]'::jsonb,      -- material information gaps [{gap,severity}]
  crawl jsonb not null default '{}'::jsonb,     -- {pages:[urls], fetched:n, skipped:n, ms, errors}
  content_hash text,                            -- hash of deduped site text, for change detection
  crawled_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.org_intel enable row level security;

-- Full strategic approach record on the claim (abstract, safe to compare
-- across customers; never contains another customer's raw text).
alter table public.claims add column if not exists strategy jsonb;

comment on table public.org_intel is 'Cached per-organisation intelligence: website crawl digest, organisation profile, evidence ledger, voice guide. Service-role only.';
comment on column public.claims.strategy is 'Abstract strategic approach record (problem frame, intervention, delivery, beneficiary, geography, partnership, sustainability, measurement, narrative thesis). Used for cross-customer distinctness comparison; contains no customer prose.';