-- ============================================================================
-- Stranded-claim test
--
-- P1: resetting a stage at or before `strategy` leaves the previous claim held, so
-- the retry hits existing_claim_same_org and the organisation competes against
-- itself. Today that needs manual database surgery.
--
-- release_stranded_claim() (migration 20260826150000) fixes it. This test proves
-- the fix works AND -- the part that matters -- that it does not weaken exclusivity:
-- a genuine second concurrent order from the same organisation is still refused.
-- ============================================================================
\set ON_ERROR_STOP on
create schema if not exists t;

insert into public.grants (funder, title, title_normalized, guidelines_text)
values ('Test Funder', 'Stranded Probe', 'stranded probe', 'probe');

insert into auth.users (email) values ('stranded@example.invalid'), ('sibling@example.invalid');

insert into public.organisations (owner_id, name, registration_number, email)
select id, 'Stranded Org', 'REG-S1', email from auth.users where email = 'stranded@example.invalid';
insert into public.organisations (owner_id, name, registration_number, email)
select id, 'Sibling Org', 'REG-S2', email from auth.users where email = 'sibling@example.invalid';

do $$
declare
  v_grant uuid; v_org uuid; v_sib uuid;
  v_order uuid; v_prop uuid; v_order2 uuid; v_prop2 uuid;
  v_vp uuid; v_vp_sib uuid; v_claim uuid; v_released uuid; v jsonb;
begin
  select id into v_grant from public.grants where title = 'Stranded Probe';
  select id into v_org from public.organisations where name = 'Stranded Org';
  select id into v_sib from public.organisations where name = 'Sibling Org';

  insert into public.voice_profiles (organisation_id, kind, profile)
    values (v_org, 'custom', '{}') returning id into v_vp;
  insert into public.voice_profiles (organisation_id, kind, profile)
    values (v_sib, 'custom', '{}') returning id into v_vp_sib;

  insert into public.orders (organisation_id, email, org_name, tier, grant_input)
    values (v_org, 'stranded@example.invalid', 'Stranded Org', 'draft', 'probe')
    returning id into v_order;
  insert into public.order_proposals (order_id, grant_id)
    values (v_order, v_grant) returning id into v_prop;

  -- ---- the first run claims and confirms, exactly as the strategy stage does
  v := public.claim_approach(v_org, v_grant, 'i1','d1','b1','g1','m1',
                             repeat('a', 64), '{"spine":"place"}'::jsonb, '{}'::jsonb,
                             1::smallint, v_vp, 'custom');
  if not (v->>'granted')::boolean then raise exception 'setup failed: first claim refused'; end if;
  v_claim := (v->>'claim_id')::uuid;
  perform public.confirm_claim(v_claim);
  update public.order_proposals set claim_id = v_claim where id = v_prop;

  -- ---- BEFORE the fix: an operator resets the stage and the retry is blocked
  v := public.claim_approach(v_org, v_grant, 'i2','d2','b2','g2','m2',
                             repeat('b', 64), '{"spine":"phase"}'::jsonb, '{}'::jsonb,
                             1::smallint, v_vp, 'custom');
  if (v->>'granted')::boolean then
    raise exception 'expected the retry to be blocked before release, but it was granted';
  end if;
  raise notice 'reset without release  -> blocked_by = %  (this is the P1)', v->>'blocked_by';

  -- ---- the fix
  v_released := public.release_stranded_claim(v_prop);
  if v_released is null then raise exception 'release_stranded_claim returned null'; end if;
  if v_released <> v_claim then raise exception 'released the wrong claim'; end if;
  raise notice 'release_stranded_claim -> released the order''s own claim';

  if exists (select 1 from public.order_proposals where id = v_prop and claim_id is not null) then
    raise exception 'claim_id was not cleared on the proposal';
  end if;

  -- ---- the retry now succeeds, and the freed template/opening are re-issuable
  v := public.claim_approach(v_org, v_grant, 'i2','d2','b2','g2','m2',
                             repeat('a', 64), '{"spine":"place"}'::jsonb, '{}'::jsonb,
                             1::smallint, v_vp, 'custom');
  if not (v->>'granted')::boolean then
    raise exception 'retry still blocked after release: %', v->>'blocked_by';
  end if;
  raise notice 'retry after release    -> granted, and the freed fingerprint was re-issued';
  perform public.confirm_claim((v->>'claim_id')::uuid);
  update public.order_proposals set claim_id = (v->>'claim_id')::uuid where id = v_prop;

  -- ---- SAFETY: a genuine second concurrent order from the SAME org is still refused.
  -- Its claim would be a second live claim for one organisation on one grant, which is
  -- exactly what lock 1 exists to prevent. release_stranded_claim must not open a hole.
  insert into public.orders (organisation_id, email, org_name, tier, grant_input)
    values (v_org, 'stranded@example.invalid', 'Stranded Org', 'draft', 'probe')
    returning id into v_order2;
  insert into public.order_proposals (order_id, grant_id)
    values (v_order2, v_grant) returning id into v_prop2;

  v_released := public.release_stranded_claim(v_prop2);
  if v_released is not null then
    raise exception 'SAFETY FAILURE: a second order released the first order''s live claim';
  end if;
  raise notice 'second concurrent order-> released nothing (exclusivity intact)';

  v := public.claim_approach(v_org, v_grant, 'i3','d3','b3','g3','m3',
                             repeat('c', 64), '{"spine":"actor"}'::jsonb, '{}'::jsonb,
                             1::smallint, v_vp, 'custom');
  if (v->>'granted')::boolean then
    raise exception 'SAFETY FAILURE: the organisation now holds two live claims on one grant';
  end if;
  raise notice 'second concurrent order-> still blocked_by = %', v->>'blocked_by';

  -- ---- a DIFFERENT organisation is unaffected
  v := public.claim_approach(v_sib, v_grant, 'i4','d4','b4','g4','m4',
                             repeat('d', 64), '{"spine":"place"}'::jsonb, '{}'::jsonb,
                             1::smallint, v_vp_sib, 'custom');
  if not (v->>'granted')::boolean then
    raise exception 'a different organisation was wrongly blocked: %', v->>'blocked_by';
  end if;
  raise notice 'different organisation -> granted, unaffected';

  raise notice 'STRANDED-CLAIM TEST PASSED';
end $$;

\echo ''
\echo '=== audit trail (the release must be recorded, not silent) ==='
select actor, action, entity from public.events where action = 'claim_released';
