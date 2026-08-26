-- ============================================================================
-- Exclusivity ceiling test
--
-- Proves, in SQL alone, how many proposals one grant can actually serve. No
-- worker, no edge function, no orders, no models, no production. It calls
-- claim_approach() directly the way the worker does and records where it stops.
--
-- Run via tests/exclusivity/run.sh (which replays the migrations first).
--
-- WHAT IT ASSERTS TODAY: the ceiling is 8, and the 9th applicant is refused with
-- blocked_by='structural_template'. That is the P0. This test is written to FAIL
-- once the unbounded composer lands -- at which point the expectation below moves
-- to "no applicant is ever refused", and the failure is the point.
-- ============================================================================
\set ON_ERROR_STOP on
\set APPLICANTS 40

create schema if not exists t;

-- ---------------------------------------------------------------- fixtures
-- One grant, APPLICANTS distinct organisations, each with a distinct concept
-- tuple so that ONLY the structure/opening/voice locks can be what refuses them.
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
  template smallint,
  opening smallint
);

-- ---------------------------------------------------------------- the probe
-- Mirrors the worker's loop at supabase/functions/worker/index.ts:1416-1435:
-- for each applicant, walk template 1..8 x opening 1..8 and take the first pair
-- the database grants. Distinct concept tuple per applicant, so the concept lock
-- never fires and the result isolates the structure/opening ceiling.
do $$
declare
  r record; v jsonb; v_vp uuid; n int := 0; v_grant uuid;
  tpl smallint; op smallint; got boolean; last_block text;
begin
  select id into v_grant from public.grants where title = 'Ceiling Probe Grant';
  for r in select id from public.organisations where name like 'Applicant %'
           order by (regexp_replace(name, '\D', '', 'g'))::int
  loop
    n := n + 1;
    insert into public.voice_profiles (organisation_id, kind, profile)
      values (r.id, 'custom', '{}'::jsonb) returning id into v_vp;

    got := false; last_block := null;
    for tpl in 1..8 loop
      exit when got;
      for op in 1..8 loop
        exit when got;
        v := public.claim_approach(
          r.id, v_grant,
          'intervention_' || n, 'delivery_' || n, 'beneficiary_' || n, 'geography_' || n,
          'mechanic_' || n, tpl::smallint, op::smallint, v_vp, 'custom');
        if (v->>'granted')::boolean then
          got := true;
          insert into t.result values (n, r.id, true, null, tpl, op);
        else
          last_block := v->>'blocked_by';
        end if;
      end loop;
    end loop;

    if not got then
      insert into t.result values (n, r.id, false, last_block, null, null);
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
select n, granted, coalesce(blocked_by, '-') as blocked_by, template, opening
from t.result where n between greatest(1, (select min(n) from t.result where not granted) - 2)
                          and greatest(1, (select min(n) from t.result where not granted) + 1)
order by n;

\echo ''
\echo '=== the house-voice lock: does it index anything at all? ==='
select count(*) as claims_total,
       count(*) filter (where voice_kind = 'house') as house_voice_claims
from public.claims;

\echo ''
\echo '=== do failed proposals return their slot? ==='
-- release_claim exists and is granted to service_role, but nothing calls it.
-- Release applicant 1's claim and see whether applicant 9 can now be served.
select public.release_claim(id) from public.claims order by created_at limit 1;

do $$
declare v jsonb; v_org uuid; v_vp uuid; tpl smallint; op smallint; got boolean := false;
begin
  select organisation_id into v_org from t.result where not granted order by n limit 1;
  if v_org is null then return; end if;
  select id into v_vp from public.voice_profiles where organisation_id = v_org limit 1;
  for tpl in 1..8 loop exit when got;
    for op in 1..8 loop exit when got;
      v := public.claim_approach(v_org, (select grant_id from public.claims limit 1),
             'retry_i', 'retry_d', 'retry_b', 'retry_g', 'retry_m', tpl::smallint, op::smallint, v_vp, 'custom');
      if (v->>'granted')::boolean then got := true; end if;
    end loop;
  end loop;
  raise notice 'after releasing one slot, a previously refused applicant %',
    case when got then 'WAS served' else 'was STILL refused' end;
end $$;

-- ---------------------------------------------------------------- assertion
\echo ''
do $$
declare v_served int; v_refused int;
begin
  select count(*) filter (where granted), count(*) filter (where not granted)
    into v_served, v_refused from t.result;

  if v_refused > 0 then
    raise exception E'CEILING CONFIRMED: % of % applicants served, % refused.\n'
      '  Every refused applicant pays, lands in attention, and is never emailed.\n'
      '  This test passes only when a grant can serve any number of applicants.',
      v_served, v_served + v_refused, v_refused;
  end if;

  raise notice 'UNBOUNDED: all % applicants served on one grant', v_served;
end $$;
