-- =====================================================================
-- Schema fingerprint — does a database still match production?
--
-- Run against BOTH the live project and any rebuilt/local database; every
-- row must match. Each hash covers names AND full definitions, so a silently
-- altered policy, constraint or function body changes its hash.
--
-- Live values, 2026-08-23, AFTER the benchmark cleanup dropped
-- public.bench_cases (Postgres 17.6.1.155):
--   columns_nonvector  c549a92d3b33261b3061439cc144807a
--   constraints        c899d726f2fdf0909af373fa255b79d3
--   functions          946d52d37d2c6d9523e7d960e3f32c9b
--   grants             53540d7b048d4d0dd424f4e20cbb8d04
--   indexes            6f49e9526ad6b87e8db221eb73c63e71
--   policies           66d57dd2e060c72c312926123b48dc22
--   rls_flags          5f8af02255d31b263dfdd3d9856bd76a
--   triggers           ec7f46725697aa62c2d33efd33b3fa41
--
-- Replaying supabase/migrations/ into a clean Postgres reproduces all eight
-- exactly. There is no longer any bench_cases exclusion: production and the
-- migration history now describe the same schema.
--
-- The two pgvector columns (fingerprints.narrative_embedding,
-- grants.guidelines_embedding) are excluded from columns_nonvector so this
-- still works where pgvector is unavailable.
-- =====================================================================

select 'indexes' as part, md5(string_agg(indexname||'|'||indexdef, E'\n' order by indexname)) as h
  from pg_indexes where schemaname='public'
union all
select 'constraints', md5(string_agg(con.conname||'|'||pg_get_constraintdef(con.oid), E'\n' order by con.conname))
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all
select 'functions', md5(string_agg(p.proname||'|'||p.prosecdef::text||'|'||md5(p.prosrc), E'\n' order by p.proname))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all
select 'triggers', md5(string_agg(c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid), E'\n' order by t.tgname))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all
select 'policies', md5(string_agg(tablename||'|'||policyname||'|'||cmd||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' order by tablename, policyname))
  from pg_policies where schemaname='public'
union all
select 'rls_flags', md5(string_agg(c.relname||'|'||c.relrowsecurity::text, E'\n' order by c.relname))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all
select 'grants', md5(string_agg(t, E'\n' order by t)) from (
  select table_name||'|'||grantee||'|'||string_agg(privilege_type,',' order by privilege_type) as t
  from information_schema.role_table_grants where table_schema='public'
    and grantee in ('anon','authenticated','service_role','postgres')
  group by table_name, grantee) g
union all
select 'columns_nonvector', md5(string_agg(t, E'\n' order by t)) from (
  select table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') as t
  from information_schema.columns where table_schema='public'
    and not (table_name='fingerprints' and column_name='narrative_embedding')
    and not (table_name='grants' and column_name='guidelines_embedding')) cc
order by 1;
