-- ============================================================================
-- The pre-delivery quality gate. Invariant 1: nothing unfundable is ever
-- delivered. Invariant 9: all of it is observable in the append-only events table.
--
-- The gate itself is supabase/functions/worker/delivery_gate.ts. This file holds
-- the part that must NOT live in a worker isolate: the record of what was judged,
-- and the rule that a verdict already reached on a document is the verdict.
--
-- WHY THE STICKINESS RULE IS IN THE DATABASE
--
-- "It cannot be retried into passing without the document actually changing."
-- A rule enforced only in the worker is a rule that survives exactly as long as
-- nobody adds a second call site. Here it is a partial unique index: at most one
-- STICKY verdict can ever exist for one (proposal, document hash) pair, so a
-- second roll of the dice on an unchanged document is not merely discouraged,
-- it cannot be written down — and record_gate_verdict() hands the caller the
-- verdict that already exists instead.
--
-- Sticky = the gate reached a judgement ABOUT THE DOCUMENT: it passed, it failed
-- the bar, or it failed a deterministic preflight check. Not sticky = the gate
-- obtained no judgement at all (the critic timed out, returned garbage, or was
-- misconfigured into the generator's own family). The absence of a judgement is
-- not a judgement, so re-attempting it is not re-rolling; those rows accumulate
-- as evidence and never claim the unique slot.
--
-- The document hash covers the gate version (see documentHash()), so changing
-- the bar invalidates every stored verdict by construction rather than by
-- anyone remembering to invalidate it.
-- ============================================================================

-- ---------------------------------------------------------------- 1. the record
create table if not exists public.delivery_gate_verdicts (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.order_proposals(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,

  -- SHA-256 over (gate version + whitespace-normalised narrative). The identity
  -- of the thing judged. Two verdicts with the same hash judged the same words.
  doc_hash text not null check (doc_hash ~ '^[0-9a-f]{64}$'),
  gate_version text not null,

  decision text not null check (decision in ('pass','hold')),
  cause text check (cause in ('bar_not_cleared','preflight_failed',
                              'judgement_unavailable','judge_misconfigured')),
  sticky boolean not null,

  -- Per critic: model, family, attempts, whether a judgement was obtained, the
  -- ten scores, the disqualifiers, and the named failures. This is the audit
  -- trail for a refund, so it is kept whole rather than summarised.
  critics jsonb not null default '[]'::jsonb,
  preflight jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  model_calls smallint not null default 0,

  created_at timestamptz not null default now(),

  -- A pass is a pass; it has no cause. A hold always has one. Nothing else is
  -- representable, which is how "pass with reservations" stays unwritable.
  constraint delivery_gate_verdicts_shape check (
    (decision = 'pass' and cause is null and sticky)
    or (decision = 'hold' and cause is not null)
  ),
  -- Only the two causes that are judgements about the document may be sticky.
  constraint delivery_gate_verdicts_sticky_cause check (
    sticky = (decision = 'pass' or cause in ('bar_not_cleared','preflight_failed'))
  )
);

-- THE re-judge rule, as a constraint rather than as a convention.
create unique index if not exists delivery_gate_verdicts_doc_key
  on public.delivery_gate_verdicts (proposal_id, doc_hash) where sticky;

create index if not exists delivery_gate_verdicts_proposal_idx
  on public.delivery_gate_verdicts (proposal_id, created_at desc);
create index if not exists delivery_gate_verdicts_holds_idx
  on public.delivery_gate_verdicts (created_at desc) where decision = 'hold';

alter table public.delivery_gate_verdicts enable row level security;
revoke all on public.delivery_gate_verdicts from anon, authenticated;
-- No policy: only service_role (which bypasses RLS) reads or writes this. The
-- customer's order page shows progress, never a score.

comment on table public.delivery_gate_verdicts is
  'One row per attempt to clear the pre-delivery quality gate. At most one sticky row per (proposal, doc_hash): a verdict about a document is reached once and replayed thereafter.';

-- ---------------------------------------------------------------- 2. refund state
alter table public.orders add column if not exists gate_refunded_at timestamptz;
alter table public.orders add column if not exists gate_refund_reason text;
alter table public.orders add column if not exists gate_refund_email_sent boolean not null default false;

comment on column public.orders.gate_refunded_at is
  'Set when the delivery gate could not be cleared and the order was refunded rather than delivered. Invariant 2: no money is taken for an order the system cannot fulfil.';

-- ---------------------------------------------------------------- 3. escalations
-- Invariant 7: no human reviews a held proposal, and operator alerting is
-- required anyway. These two kinds are alerts, not review queues — nothing in
-- the customer's path waits on anyone opening them.
-- 'immediate' does not exist yet in the priority check, and an unexecuted refund
-- is the one alert in this system that genuinely cannot wait 72 hours.
alter table public.escalations drop constraint if exists escalations_priority_check;
alter table public.escalations add constraint escalations_priority_check
  check (priority in ('normal','deadline_72h','immediate'));

alter table public.escalations drop constraint if exists escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','gate_hold','gate_refund',
                  'gate_refund_failed','other'));

-- ---------------------------------------------------------------- 4. record a verdict
-- Insert-or-replay, atomically, with the events row written in the same
-- transaction so the ledger cannot drift from the record.
--
-- Returns the EFFECTIVE verdict as jsonb: the row just written, or — where a
-- sticky verdict already existed for this document — that one, with
-- replayed=true. A caller that hoped for a different answer gets the old one.
create or replace function public.record_gate_verdict(
  p_proposal uuid,
  p_order uuid,
  p_doc_hash text,
  p_gate_version text,
  p_decision text,
  p_cause text,
  p_sticky boolean,
  p_critics jsonb default '[]'::jsonb,
  p_preflight jsonb default '[]'::jsonb,
  p_findings jsonb default '[]'::jsonb,
  p_model_calls smallint default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.delivery_gate_verdicts; v_replayed boolean := false;
begin
  insert into public.delivery_gate_verdicts (
    proposal_id, order_id, doc_hash, gate_version, decision, cause, sticky,
    critics, preflight, findings, model_calls)
  values (
    p_proposal, p_order, p_doc_hash, p_gate_version, p_decision, p_cause, p_sticky,
    coalesce(p_critics,'[]'::jsonb), coalesce(p_preflight,'[]'::jsonb),
    coalesce(p_findings,'[]'::jsonb), coalesce(p_model_calls,0))
  on conflict (proposal_id, doc_hash) where sticky do nothing
  returning * into v_row;

  if v_row.id is null then
    -- A sticky verdict for this exact document already exists. It stands.
    select * into v_row from public.delivery_gate_verdicts
     where proposal_id = p_proposal and doc_hash = p_doc_hash and sticky limit 1;
    v_replayed := true;
  end if;

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('delivery_gate',
          case when v_replayed then 'gate_verdict_replayed'
               when v_row.decision = 'pass' then 'gate_passed'
               else 'gate_held' end,
          'order_proposal', p_proposal::text,
          jsonb_build_object(
            'verdict_id', v_row.id,
            'order_id', p_order,
            'doc_hash', v_row.doc_hash,
            'gate_version', v_row.gate_version,
            'decision', v_row.decision,
            'cause', v_row.cause,
            'sticky', v_row.sticky,
            'model_calls', v_row.model_calls,
            'findings', v_row.findings,
            'critics', v_row.critics,
            -- true when this attempt was answered from the record rather than judged
            'replayed', v_replayed,
            -- true when the caller tried to write a DIFFERENT answer for a document
            -- already judged. Nothing is wrong with retrying; this is how a retry
            -- that hoped for a different roll becomes visible.
            'superseded_attempt', v_replayed and v_row.decision is distinct from p_decision));

  return to_jsonb(v_row) || jsonb_build_object('replayed', v_replayed);
end; $$;

revoke all on function public.record_gate_verdict(uuid,uuid,text,text,text,text,boolean,jsonb,jsonb,jsonb,smallint) from public, anon, authenticated;
grant execute on function public.record_gate_verdict(uuid,uuid,text,text,text,text,boolean,jsonb,jsonb,jsonb,smallint) to service_role;

-- ---------------------------------------------------------------- 5. read a verdict
-- The lookup the gate performs before it spends a single token: is this exact
-- document already judged?
create or replace function public.gate_verdict_for(p_proposal uuid, p_doc_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(v) from public.delivery_gate_verdicts v
   where v.proposal_id = p_proposal and v.doc_hash = p_doc_hash and v.sticky
   limit 1;
$$;
revoke all on function public.gate_verdict_for(uuid,text) from public, anon, authenticated;
grant execute on function public.gate_verdict_for(uuid,text) to service_role;

-- How much of the regeneration ladder this proposal has already spent, and how
-- many times the gate failed to obtain a judgement at all. Counted from the
-- record, never from a mutable counter on the order.
create or replace function public.gate_progress(p_proposal uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sticky_holds',  count(*) filter (where decision = 'hold' and sticky),
    'unavailable',   count(*) filter (where decision = 'hold' and not sticky),
    'passed',        count(*) filter (where decision = 'pass') > 0,
    'distinct_docs', count(distinct doc_hash))
  from public.delivery_gate_verdicts where proposal_id = p_proposal;
$$;
revoke all on function public.gate_progress(uuid) from public, anon, authenticated;
grant execute on function public.gate_progress(uuid) to service_role;

-- The brief the regeneration stage works from: the findings of the most recent
-- verdict that was actually a judgement about a document. A hold with no
-- judgement behind it has nothing to regenerate against, so it is skipped.
create or replace function public.gate_last_hold(p_proposal uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('doc_hash', v.doc_hash, 'cause', v.cause,
                            'findings', v.findings, 'preflight', v.preflight,
                            'created_at', v.created_at)
    from public.delivery_gate_verdicts v
   where v.proposal_id = p_proposal and v.decision = 'hold' and v.sticky
   order by v.created_at desc, v.id desc limit 1;
$$;
revoke all on function public.gate_last_hold(uuid) from public, anon, authenticated;
grant execute on function public.gate_last_hold(uuid) to service_role;

-- ---------------------------------------------------------------- 6. the refund
-- Marks the order refunded and records why, atomically with its events row.
-- It does NOT move money: Stripe does, from the worker, keyed on an idempotency
-- key derived from the order id. This function is called only after the refund
-- is confirmed, or — where Stripe could not be reached after the worker's retry
-- budget — with p_confirmed=false, which raises a gate_refund_failed escalation
-- so an operator finishes the transfer. That is alerting, not review: the
-- proposal is already refused and nobody is deciding anything about it.
create or replace function public.gate_refund_order(
  p_order uuid, p_proposal uuid, p_reason text, p_confirmed boolean, p_stripe_refund text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders;
begin
  update public.orders
     set status = 'refunded',
         gate_refunded_at = coalesce(gate_refunded_at, now()),
         gate_refund_reason = coalesce(gate_refund_reason, left(p_reason, 2000))
   where id = p_order
  returning * into v_order;
  if v_order.id is null then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;

  insert into public.escalations (kind, order_id, order_proposal_id, priority, detail)
  values (case when p_confirmed then 'gate_refund' else 'gate_refund_failed' end,
          p_order, p_proposal,
          case when p_confirmed then 'deadline_72h' else 'immediate' end,
          jsonb_build_object('reason', left(p_reason, 2000), 'amount_usd', v_order.amount_usd,
                             'stripe_refund', p_stripe_refund, 'confirmed', p_confirmed));

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('delivery_gate', 'gate_refund', 'order', p_order::text,
          jsonb_build_object('proposal', p_proposal, 'reason', left(p_reason, 2000),
                             'amount_usd', v_order.amount_usd, 'confirmed', p_confirmed,
                             'stripe_refund', p_stripe_refund));

  return jsonb_build_object('ok', true, 'order_no', v_order.order_no, 'email', v_order.email,
                            'org_name', v_order.org_name, 'amount_usd', v_order.amount_usd,
                            'already_emailed', v_order.gate_refund_email_sent);
end; $$;
revoke all on function public.gate_refund_order(uuid,uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function public.gate_refund_order(uuid,uuid,text,boolean,text) to service_role;

-- ---------------------------------------------------------------- 7. observability
-- Invariant 9. One row per gate outcome, joinable to the order, for the drift
-- monitoring that reports/launch-readiness-report.md §P1.8 says validator-based
-- monitoring cannot provide: these are judgements against the customer-visible
-- bar, not against our own validators.
create or replace view public.gate_outcomes as
  select v.created_at, v.order_id, v.proposal_id, v.doc_hash, v.gate_version,
         v.decision, v.cause, v.sticky, v.model_calls,
         jsonb_array_length(v.findings) as finding_count,
         o.tier, o.status as order_status
    from public.delivery_gate_verdicts v
    join public.orders o on o.id = v.order_id;
revoke all on public.gate_outcomes from anon, authenticated;
