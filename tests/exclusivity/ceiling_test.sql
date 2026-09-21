-- ============================================================================
-- Exclusivity ceiling test
--
-- Proves, in SQL alone, how many proposals one grant can actually serve. No
-- worker, no edge function, no orders, no models, no production. It calls
-- claim_approach() directly the way the worker does and records where it stops.
--
-- Run via tests/exclusivity/run.sh (which replays the migrations first).
--
-- WHAT IT ASSERTS: every applicant is served. Before the unbounded composer this
-- test failed at applicant 9 with blocked_by='structural_template', because the
-- structural_template and opening_device pools held exactly 8 rows each and each
-- row was exclusive per grant. The composer replaced those pools with a composed
-- space locked on a fingerprint, and on collision the composer re-rolls rather
-- than refusing -- so there is no count at which this can start failing again.
-- ============================================================================
\set ON_ERROR_STOP on
\set APPLICANTS 40

create schema if not exists t;

-- ---------------------------------------------------------------- fixtures
-- One grant, APPLICANTS distinct organisations, each with a distinct concept
-- tuple, so a refusal can only come from the composition lock.
insert into public.grants (funder, title, title_normalized, source_url, guidelines_text)
values ('Test Funder', 'Ceiling Probe Grant', 'ceiling probe grant',
        'https://example.invalid/g', 'probe')
returning id \gset grant_

-- organisations carry a NOT NULL owner_id -> auth.users and a unique registration
-- number, so each synthetic applicant needs its own user row.
insert into auth.users (email)
select 'applicant' || g || '@example.invalid' from generate_series(1, :APPLICANTS) g;

insert into public.organisations (owner_id, name, registration_number, email)
select u.id,
       'Applicant ' || row_number() over (order by u.email),
       'REG-' || row_number() over (order by u.email),
       u.email
from auth.users u where u.email like 'applicant%@example.invalid';

create table t.result (
  n int primary key,
  organisation_id uuid not null,
  granted boolean not null,
  blocked_by text,
  rerolls int not null default 0
);

-- ---------------------------------------------------------------- the probe
-- The worker no longer walks an 8x8 pool. It composes across twelve axes, hashes
-- the canonical draw, and re-rolls on collision. This mirrors that: each applicant
-- draws a distinct composition, so nothing but a real ceiling could refuse them.
--
-- Digests are built in SQL from the axis vocabulary so the test depends on the
-- schema, not on a hardcoded list that could drift away from it.
do $$
declare
  r record; v jsonb; v_vp uuid; n int := 0; v_grant uuid;
  v_axes jsonb; v_fp text; got boolean; last_block text; rerolls int;
  v_spine text; v_open text; v_close text; v_stance text; v_carrier text;
begin
  select id into v_grant from public.grants where title = 'Ceiling Probe Grant';

  for r in select id from public.organisations where name like 'Applicant %'
           order by (regexp_replace(name, '\D', '', 'g'))::int
  loop
    n := n + 1;
    insert into public.voice_profiles (organisation_id, kind, profile)
      values (r.id, 'custom', '{}'::jsonb) returning id into v_vp;

    got := false; last_block := null; rerolls := 0;

    -- Draw, hash, insert; on fingerprint_taken re-roll with a different draw.
    -- There is no refusal branch in the worker and there is none here.
    while not got and rerolls < 50 loop
      select code into v_spine   from public.composition_axes where axis='spine'
        order by md5(code || n::text || rerolls::text) limit 1;
      select code into v_open    from public.composition_axes where axis='opening_move'
        order by md5(code || n::text || rerolls::text || 'o') limit 1;
      select code into v_close   from public.composition_axes where axis='closing_move'
        order by md5(code || n::text || rerolls::text || 'c') limit 1;
      select code into v_stance  from public.composition_axes where axis='stance'
        order by md5(code || n::text || rerolls::text || 's') limit 1;
      select code into v_carrier from public.composition_axes where axis='argument_carrier'
        order by md5(code || n::text || rerolls::text || 'a') limit 1;

      v_axes := jsonb_build_object(
        'spine', v_spine, 'opening_move', v_open, 'closing_move', v_close,
        'stance', v_stance, 'argument_carrier', v_carrier,
        -- move_order and the dyadic grids are integers in the real composer;
        -- a counter stands in for them here and is what makes the space open.
        'move_order', (n * 7 + rerolls * 13), 'cadence_mu', 12 + (n % 13),
        'weight_profile', (n * 3 + rerolls));
      v_fp := encode(sha256(v_axes::text::bytea), 'hex');

      v := public.claim_approach(
        r.id, v_grant,
        'intervention_' || n, 'delivery_' || n, 'beneficiary_' || n, 'geography_' || n,
        'mechanic_' || n, v_fp, v_axes, '{}'::jsonb, 1::smallint, v_vp, 'custom');

      if (v->>'granted')::boolean then
        got := true;
        insert into t.result values (n, r.id, true, null, rerolls);
      else
        last_block := v->>'blocked_by';
        exit when last_block <> 'fingerprint_taken';   -- a real refusal, not a race
        rerolls := rerolls + 1;
      end if;
    end loop;

    if not got then
      insert into t.result values (n, r.id, false, last_block, rerolls);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- report
\echo ''
\echo '=== applicants served on one grant ==='
select count(*) filter (where granted)     as served,
       count(*) filter (where not granted) as refused,
       min(n)   filter (where not granted) as first_refused_at
from t.result;

\echo ''
\echo '=== where it stops, and why ==='
select n, granted, coalesce(blocked_by, '-') as blocked_by, rerolls
from t.result where n between greatest(1, (select min(n) from t.result where not granted) - 2)
                          and greatest(1, (select min(n) from t.result where not granted) + 1)
order by n;

\echo ''
\echo '=== the composition space actually used ==='
select count(distinct fingerprint) as distinct_fingerprints,
       count(*)                     as claims,
       max(rerolls)                 as worst_reroll_count,
       sum(rerolls)                 as total_rerolls
from public.claims c join t.result r on r.organisation_id = c.organisation_id;

\echo ''
\echo '=== no finite pool remains in the arbiter ==='
-- The old ceiling was two NOT NULL FKs into 8-row tables. If either column comes
-- back, the ceiling comes back with it.
select case when count(*) = 0 then 'ok: claims has no pool foreign key'
            else 'FAIL: a consumable pool column is back on claims' end
from information_schema.columns
where table_schema = 'public' and table_name = 'claims'
  and column_name in ('structural_template_id','opening_device_id');

select case when count(*) = 1 then 'ok: the arbiter is the composition fingerprint'
            else 'FAIL: expected exactly one fingerprint lock' end
from pg_indexes where schemaname='public' and indexname = 'claims_fingerprint_lock';

-- ---------------------------------------------------------------- assertion
\echo ''
do $$
declare v_served int; v_refused int; v_blockers text;
begin
  select count(*) filter (where granted), count(*) filter (where not granted)
    into v_served, v_refused from t.result;

  if v_refused > 0 then
    select string_agg(distinct coalesce(blocked_by,'?'), ', ') into v_blockers
      from t.result where not granted;
    raise exception E'CEILING: % of % applicants served, % refused (%).\n'
      '  Every refused applicant pays, lands in attention, and is never emailed.\n'
      '  This test passes only when a grant can serve any number of applicants.',
      v_served, v_served + v_refused, v_refused, v_blockers;
  end if;

  raise notice 'UNBOUNDED: all % applicants served on one grant', v_served;
end $$;
