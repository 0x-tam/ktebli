-- wizard answers captured before payment; the webhook attaches them to the order by email
create table public.pre_intakes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  org_name text,
  grant_input text,
  deadline date,
  directions text,
  upload_names text[],
  created_at timestamptz not null default now()
);
create index pre_intakes_email_idx on public.pre_intakes (email, created_at desc);
alter table public.pre_intakes enable row level security;
revoke all on public.pre_intakes from anon, authenticated;