-- Add 'spend_cap' to escalations.kind: the operator alert a capped proposal raises is
-- an infrastructure/cost event, not a quality hold (gate_hold) or a stalled order
-- (order_stalled) — it deserves its own filterable kind, matching how every other
-- distinct alert class in this table already gets one (see
-- 20260828120000_escalations_kind_union.sql's own note on this pattern).
alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','gate_hold','gate_refund',
                  'gate_refund_failed','payment_ungated','sufficiency_refund_failed',
                  'spend_cap','other'));

-- Atomic "claim the first cap-crossing" for a proposal: PARALLEL can run several
-- stages from the SAME proposal concurrently (unlikely for one proposal, but not
-- impossible if a retry and a fresh claim land in the same tick), and each would hit
-- the cap independently. Only the caller that flips spend_capped_at from NULL gets
-- true back — everyone else sees it already set and does not raise a second
-- escalation for the same event. Same idempotency shape as reap_stale_stages'
-- attempt-based terminal marking.
create or replace function public.mark_spend_capped(p_proposal_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.order_proposals
     set spend_capped_at = now()
   where id = p_proposal_id and spend_capped_at is null
  returning true;
$$;
revoke all on function public.mark_spend_capped(uuid) from public, anon, authenticated;
grant execute on function public.mark_spend_capped(uuid) to service_role;
