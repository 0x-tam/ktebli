-- ===========================================================================
-- FIX WS4a-21 (P0): restore the FULL union of escalation kinds.
--
-- THE REGRESSION. `escalations_kind_check` is written by drop-and-recreate, so
-- the last migration to touch it wins outright:
--
--   20260826150000 wrote the base list + price_mismatch/stage_failed/stage_held/
--                  order_stalled/delivery_failed
--   20260826170000 (delivery gate) re-created it ADDING gate_hold, gate_refund,
--                  gate_refund_failed — the kinds gate_refund_order() inserts
--   20260826180000 (sufficiency gate) re-created it again ADDING
--                  payment_ungated and sufficiency_refund_failed but WITHOUT
--                  the three gate_* kinds
--
-- On that head, gate_refund_order() raises check_violation unconditionally
-- (proven by execution: reports/phase4-compliance.md WS4a-21, proofs P3a–c/P4),
-- so a refund can never be recorded, the whole call aborts and rolls back the
-- order-status update, and the gate_refund_failed "customer is out of pocket"
-- alert can never be written. The delivery gate's refund path is bricked the
-- moment it is wired.
--
-- THE FIX. Re-state the constraint as the exact element-by-element union of the
-- 20260826170000 and 20260826180000 lists (14 + 2 = 16 kinds; the 170000 list
-- is a superset of the 150000 one).
--
-- RULE FOR THE NEXT PERSON: this constraint is drop-and-recreate, so ANY future
-- migration that adds a kind MUST re-state the FULL union below plus its
-- addition. A list that omits one kind silently bricks every code path that
-- inserts it — that is exactly what happened here. The regression test is
-- tests/exclusivity/escalation_kinds_test.sql: it inserts every kind named in
-- any migration and executes gate_refund_order() end to end.
-- ===========================================================================

alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','gate_hold','gate_refund',
                  'gate_refund_failed','payment_ungated','sufficiency_refund_failed','other'));
