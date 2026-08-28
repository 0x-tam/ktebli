-- ============================================================================
-- Escalation-kind regression test (WS4a-21)
--
-- escalations_kind_check is maintained by drop-and-recreate, so the last
-- migration to touch it wins outright. 20260826180000 re-created it without the
-- gate_* kinds 20260826170000 added, and gate_refund_order() — which inserts
-- two of them — aborted with check_violation on every call: a confirmed Stripe
-- refund could not be recorded, and the "customer is out of pocket" alert could
-- never be written. 20260828120000 restores the full union.
--
-- This test makes that class of regression impossible to reintroduce silently:
--   1. every escalation kind named by ANY code path or migration must insert;
--   2. gate_refund_order() must execute end to end on a real order graph,
--      BOTH paths: p_confirmed=true (kind gate_refund) and p_confirmed=false
--      (kind gate_refund_failed, priority immediate).
-- Runs inside one transaction, rolled back: it proves the schema, not data.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- 1. Every kind in the union list writes a row. If a future migration
-- re-creates the constraint and drops one, this fails on that exact kind.
do $$
declare k text;
begin
  foreach k in array array[
    'similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
    'provenance_failed','price_mismatch','stage_failed','stage_held',
    'order_stalled','delivery_failed','gate_hold','gate_refund',
    'gate_refund_failed','payment_ungated','sufficiency_refund_failed','other']
  loop
    begin
      insert into public.escalations (kind, detail) values (k, jsonb_build_object('probe', true));
    exception when check_violation or not_null_violation then
      raise exception 'ESCALATION-KIND REGRESSION: kind % is refused by escalations_kind_check (or due_at lost its default). A migration re-created the constraint without the full union.', k;
    end;
  end loop;
  raise notice 'KINDS-OK: all 16 escalation kinds insert';
end $$;

-- An unknown kind must still be refused (the constraint exists and bites).
do $$
begin
  begin
    insert into public.escalations (kind, detail) values ('made_up_kind', '{}'::jsonb);
    raise exception 'ESCALATION-KIND REGRESSION: an unknown kind was accepted — the constraint is gone';
  exception when check_violation then
    raise notice 'KINDS-OK: unknown kind refused';
  end;
end $$;

-- The immediate priority the refund-failed alert uses must be valid too.
do $$
begin
  insert into public.escalations (kind, priority, detail)
  values ('gate_refund_failed', 'immediate', '{"probe":true}'::jsonb);
  raise notice 'KINDS-OK: gate_refund_failed at priority immediate inserts';
exception when others then
  raise exception 'ESCALATION-KIND REGRESSION: gate_refund_failed@immediate refused: %', sqlerrm;
end $$;

-- 2. gate_refund_order() end to end, both paths, on a real order graph.
do $$
declare v_org uuid; v_order uuid; v_prop uuid; v_out jsonb;
begin
  insert into public.organisations (name, registration_number, email, sanctions_status)
  values ('Kind Probe Org', 'KIND-1', 'kinds@example.invalid', 'cleared') returning id into v_org;
  insert into public.orders (stripe_session_id, organisation_id, email, org_name, tier, amount_usd, grant_input)
  values ('cs_kinds_probe', v_org, 'kinds@example.invalid', 'Kind Probe Org', 'draft', 149, 'probe')
  returning id into v_order;
  insert into public.order_proposals (order_id, title) values (v_order, 'Proposal 1') returning id into v_prop;

  -- unconfirmed: the worker path (it moves no money) -> gate_refund_failed @ immediate
  v_out := public.gate_refund_order(v_order, v_prop, 'kind probe unconfirmed', false, null);
  if not (v_out->>'ok')::boolean then
    raise exception 'gate_refund_order(confirmed=false) did not succeed: %', v_out;
  end if;
  if not exists (select 1 from public.escalations
                 where kind = 'gate_refund_failed' and order_id = v_order and priority = 'immediate') then
    raise exception 'gate_refund_order(confirmed=false) wrote no gate_refund_failed escalation';
  end if;

  -- confirmed: the post-Stripe path -> gate_refund
  v_out := public.gate_refund_order(v_order, v_prop, 'kind probe confirmed', true, 're_probe');
  if not (v_out->>'ok')::boolean then
    raise exception 'gate_refund_order(confirmed=true) did not succeed: %', v_out;
  end if;
  if not exists (select 1 from public.escalations
                 where kind = 'gate_refund' and order_id = v_order) then
    raise exception 'gate_refund_order(confirmed=true) wrote no gate_refund escalation';
  end if;

  if not exists (select 1 from public.orders where id = v_order and status = 'refunded' and gate_refunded_at is not null) then
    raise exception 'gate_refund_order did not mark the order refunded';
  end if;
  if (select count(*) from public.events where action = 'gate_refund' and entity_id = v_order::text) < 2 then
    raise exception 'gate_refund_order did not write its events rows';
  end if;

  raise notice 'REFUND-OK: gate_refund_order executes end to end on both paths';
end $$;

rollback;
\echo 'ESCALATION-KINDS TEST PASSED'
