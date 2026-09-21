-- Reliability repairs: reclaim stranded slots, and make failure notification possible.
--
-- Three defects, all of which end with a paying customer receiving nothing:
--
--  1. A claim is confirmed milliseconds after it is granted and is never released.
--     release_claim() exists and is granted to service_role, and nothing calls it.
--     So every order that reaches `strategy` and then dies burns one structural
--     template and one opening device on that grant permanently, and a reset order
--     is blocked by its own held claim (existing_claim_same_org).
--
--  2. escalations cannot be written to. The only insert in the codebase
--     (stripe-webhook price_mismatch) violates the kind CHECK and omits due_at,
--     which has no default, and it is wrapped in .catch(() => {}). The one
--     operator-alerting mechanism in the system is a silent no-op.
--
--  3. Nothing records whether a terminal failure has been notified, so any
--     notifier added to the worker would have no way to avoid re-sending on
--     every tick.

-- ---------------------------------------------------------------- 1. stranded claims
-- Releases only a claim this proposal could legitimately own: either the proposal
-- points at it, or it is an orphan owned by no proposal at all (the crash window
-- between claim_approach and the order_proposals patch).
--
-- A genuine second concurrent order from the same organisation on the same grant is
-- still blocked, because its claim is referenced by a different order_proposals row
-- and neither branch matches. The organisation cannot end up holding two claims.
--
-- The age guard closes the only race: a sibling that has claimed but not yet written
-- claim_id is briefly indistinguishable from an orphan. An orphan is by definition old.
create or replace function public.release_stranded_claim(p_proposal uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_claim uuid; v_grant uuid; v_org uuid;
begin
  select p.grant_id, o.organisation_id into v_grant, v_org
    from public.order_proposals p
    join public.orders o on o.id = p.order_id
   where p.id = p_proposal;
  if v_grant is null or v_org is null then return null; end if;

  select c.id into v_claim
    from public.claims c
   where c.grant_id = v_grant
     and c.organisation_id = v_org
     and c.status in ('hold','confirmed')
     and (
          exists (select 1 from public.order_proposals op
                   where op.id = p_proposal and op.claim_id = c.id)
       or (not exists (select 1 from public.order_proposals op where op.claim_id = c.id)
           and c.created_at < now() - interval '2 minutes')
     )
   limit 1;
  if v_claim is null then return null; end if;

  update public.claims set status = 'released' where id = v_claim;
  update public.order_proposals set claim_id = null where id = p_proposal;
  insert into public.events (actor, action, entity, entity_id, detail)
  values ('release_stranded_claim', 'claim_released', 'claim', v_claim::text,
          jsonb_build_object('proposal', p_proposal));
  return v_claim;
end; $$;

revoke all on function public.release_stranded_claim(uuid) from public, anon, authenticated;
grant execute on function public.release_stranded_claim(uuid) to service_role;

-- ---------------------------------------------------------------- 2. escalations
-- The kinds the system actually needs to raise, and a default due_at so an insert
-- that omits it succeeds instead of silently failing inside a swallowed catch.
alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','other'));

alter table public.escalations alter column due_at set default now() + interval '24 hours';

-- escalations.proposal_id points at the legacy public.proposals table, not at
-- order_proposals, which is what the worker actually operates on. Add the correct
-- reference rather than repointing the old column, so nothing already written breaks.
alter table public.escalations add column if not exists order_proposal_id uuid
  references public.order_proposals(id) on delete cascade;
alter table public.escalations add column if not exists order_id uuid
  references public.orders(id) on delete cascade;
create index if not exists escalations_open_idx
  on public.escalations (status, created_at desc) where status = 'open';

-- ---------------------------------------------------------------- 3. notification state
-- Idempotency for terminal-failure notification: a stage is notified at most once,
-- however many times the worker ticks over it afterwards.
alter table public.job_stages add column if not exists notified_at timestamptz;
create index if not exists job_stages_unnotified_idx
  on public.job_stages (status, finished_at)
  where notified_at is null and status in ('failed','held');
