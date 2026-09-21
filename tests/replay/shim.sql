-- ============================================================================
-- Ktebli migration-replay shim
--
-- Stands in for the Supabase-managed objects the migrations reference but do not
-- create: the three service roles, and the auth / storage / vault schemas.
-- pgvector, pg_cron and pg_net are shimmed as fake extensions instead (see
-- tests/replay/fake-extensions/) so that the `create extension` lines in the
-- migrations replay unmodified.
--
-- The point of this file is that schema parity with production is REPRODUCIBLE.
-- Run tests/replay/run.sh. Nothing here talks to production and nothing here
-- makes a network call.
-- ============================================================================

-- Supabase's three service roles. NOLOGIN: this is a replay, not a running stack.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;

-- ---------------------------------------------------------------- auth
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Replay stand-in: always null, i.e. an anonymous caller. RLS policies that call
-- auth.uid() therefore replay and can be inspected, but grant nothing.
create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;

-- ---------------------------------------------------------------- storage
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  metadata jsonb
);

-- Mirrors Supabase's real signature: splits an object path into its folder parts.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;

-- ---------------------------------------------------------------- vault
-- Supabase Vault stores secrets encrypted and exposes them through the
-- decrypted_secrets view. The shim keeps them in plaintext because the replay
-- database is thrown away at the end of the run and never holds a real secret:
-- 20260820145930 generates a random value rather than carrying a literal.
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  secret text not null,
  created_at timestamptz not null default now()
);

create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret, created_at from vault.secrets;

create or replace function vault.create_secret(p_secret text, p_name text default null)
returns uuid language sql as $$
  insert into vault.secrets (name, secret) values (p_name, p_secret) returning id;
$$;

create or replace function vault.update_secret(p_id uuid, p_secret text)
returns void language sql as $$
  update vault.secrets set secret = p_secret where id = p_id;
$$;

-- ---------------------------------------------------------------- default privileges
-- Supabase grants the three service roles full privileges on anything later created
-- in `public`, and the migrations then REVOKE from there (deny-by-default is applied
-- on top, not from scratch). Without these the replay under-grants and the `grants`
-- fingerprint diverges from production. They must be set before any migration runs.
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
