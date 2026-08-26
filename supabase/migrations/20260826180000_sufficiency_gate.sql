-- ===========================================================================
-- THE PRE-PAYMENT SUFFICIENCY GATE — state
--
-- Invariant 2: no money is taken for an order the system cannot fulfil.
--
-- Today the pre-payment path has no gate at all, and it has two holes that a
-- purely client-side gate could not close:
--
--   1. index.html:817-822 navigates to the Stripe payment link after a 2500 ms
--      timeout EVEN IF save-intake has not answered, with client_reference_id
--      null. A browser can therefore reach checkout with no intake row at all.
--   2. stripe-webhook/index.ts:133-138 then falls back to "any pre_intake with
--      this email in the last 48 hours", so a null reference still finds a row —
--      possibly one from a different, abandoned attempt.
--
-- So the gate's authority has to live in the database, and the webhook has to
-- refuse by default. This migration adds:
--
--   * the six pre-payment answer slots and their two honest escapes;
--   * the verdict, its score, the bar it was scored against, and the
--     fingerprint of exactly what was scored;
--   * a single-use checkout authorisation, consumed atomically;
--   * the link from a paid order back to the clearance that authorised it, so
--      "was any order ever charged without clearing?" is one query;
--   * escalation kinds for the two operator alerts this path can raise.
--
-- Nothing here can be turned off by configuration. There is no column whose
-- value opens the gate: `sufficiency_cleared` is written only by the edge
-- function that ran the scorer, and `consume_checkout_token()` re-checks it,
-- re-checks the fingerprint, and refuses on any mismatch.
-- ===========================================================================

-- ------------------------------------------------------------------ 1. slots
-- The pre-payment floor from reports/design/challenge-conversion.md section 5:
-- recall only. No numbers, no lookups, no documents to go and find. Every one
-- of these is a fact only the applicant can supply and no crawl can reach.
alter table public.pre_intakes add column if not exists site_place          text;
alter table public.pre_intakes add column if not exists site_venue          text;
alter table public.pre_intakes add column if not exists site_activity       text;
alter table public.pre_intakes add column if not exists last_delivery_what  text;
alter table public.pre_intakes add column if not exists last_delivery_when  text;
alter table public.pre_intakes add column if not exists local_trigger       text;

-- The two escapes. They are answers, not skips: each one writes a stated
-- absence into the ledger ("delivery is street-based, not at a fixed venue"),
-- and neither one adds a referent. An applicant who takes both and names
-- nothing else still refuses.
alter table public.pre_intakes add column if not exists venue_escape text;
alter table public.pre_intakes drop constraint if exists pre_intakes_venue_escape_check;
alter table public.pre_intakes add constraint pre_intakes_venue_escape_check
  check (venue_escape is null or venue_escape in ('homes','street','outdoors','mobile','online'));
alter table public.pre_intakes add column if not exists never_delivered boolean not null default false;

alter table public.pre_intakes add column if not exists updated_at timestamptz not null default now();

-- --------------------------------------------------------------- 2. verdict
-- The whole verdict is kept, not just its boolean: the gaps that were shown to
-- the customer, the referents that were counted, which scorer decided, and
-- which arm of the threshold set the bar. The referent ladder will be read off
-- these rows, and so will any later argument that the scoring rule is wrong.
alter table public.pre_intakes add column if not exists sufficiency            jsonb;
alter table public.pre_intakes add column if not exists sufficiency_cleared    boolean not null default false;
alter table public.pre_intakes add column if not exists sufficiency_fingerprint text;
alter table public.pre_intakes add column if not exists sufficiency_score      numeric;
alter table public.pre_intakes add column if not exists sufficiency_threshold  numeric;
alter table public.pre_intakes add column if not exists sufficiency_scorer     text;
alter table public.pre_intakes add column if not exists sufficiency_contract   text;
alter table public.pre_intakes add column if not exists sufficiency_at         timestamptz;
alter table public.pre_intakes add column if not exists attempts               integer not null default 0;

-- A clearance is meaningless without the fingerprint of what was scored: it is
-- what stops a customer clearing on good answers, editing them down, and paying.
alter table public.pre_intakes drop constraint if exists pre_intakes_clearance_complete;
alter table public.pre_intakes add constraint pre_intakes_clearance_complete
  check (
    sufficiency_cleared = false
    or (sufficiency_fingerprint is not null
        and sufficiency_at is not null
        and sufficiency_scorer is not null
        and sufficiency_contract is not null
        and sufficiency_score is not null
        and sufficiency_threshold is not null
        and sufficiency_score >= sufficiency_threshold)
  );

-- Funnel measurement. reports/design/challenge-conversion.md section 6.3 is
-- right that this argument needs data: today an abandoner leaves no row at all.
create index if not exists pre_intakes_gate_idx
  on public.pre_intakes (sufficiency_cleared, created_at desc);

-- ------------------------------------------------- 3. checkout authorisation
-- A checkout is opened only against a token minted by the gate. Single use,
-- short-lived, and bound to the fingerprint of the answers that earned it.
alter table public.pre_intakes add column if not exists checkout_token       text;
alter table public.pre_intakes add column if not exists checkout_token_at    timestamptz;
alter table public.pre_intakes add column if not exists checkout_token_used_at timestamptz;
alter table public.pre_intakes add column if not exists checkout_session_id  text;
create unique index if not exists pre_intakes_checkout_token_idx
  on public.pre_intakes (checkout_token) where checkout_token is not null;

-- Consume the authorisation, atomically, refusing by default.
--
-- Returns the intake row as jsonb ONLY when every one of these holds:
--   the token exists; the intake cleared; the recorded fingerprint matches the
--   one the caller recomputed from the row's own current answers; the token has
--   not been used; and the token is not older than the TTL.
-- Anything else returns null and writes a refusal event. There is no argument
-- and no setting that makes it return a row it would otherwise refuse.
create or replace function public.consume_checkout_token(
  p_token text,
  p_session text,
  p_fingerprint text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.pre_intakes; v_reason text;
begin
  if p_token is null or length(p_token) < 32 then
    v_reason := 'token_absent';
  else
    select * into v from public.pre_intakes where checkout_token = p_token for update;
    if not found then v_reason := 'token_unknown';
    elsif v.sufficiency_cleared is not true then v_reason := 'not_cleared';
    elsif v.sufficiency_fingerprint is distinct from p_fingerprint then v_reason := 'fingerprint_mismatch';
    elsif v.checkout_token_used_at is not null then v_reason := 'token_already_used';
    elsif v.checkout_token_at is null or v.checkout_token_at < now() - interval '6 hours' then v_reason := 'token_expired';
    end if;
  end if;

  if v_reason is not null then
    insert into public.events (actor, action, entity, entity_id, detail)
    values ('sufficiency-gate', 'checkout_refused', 'pre_intake',
            coalesce(v.id::text, 'unknown'),
            jsonb_build_object('reason', v_reason, 'session', p_session));
    return null;
  end if;

  update public.pre_intakes
     set checkout_token_used_at = now(),
         checkout_session_id = coalesce(checkout_session_id, p_session),
         updated_at = now()
   where id = v.id;

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('sufficiency-gate', 'checkout_consumed', 'pre_intake', v.id::text,
          jsonb_build_object('session', p_session, 'score', v.sufficiency_score,
                             'threshold', v.sufficiency_threshold, 'scorer', v.sufficiency_scorer,
                             'contract', v.sufficiency_contract));
  return to_jsonb(v);
end; $$;

revoke all on function public.consume_checkout_token(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_checkout_token(text, text, text) to service_role;

-- ----------------------------------------- 4. the order remembers its licence
-- Every paid order records the clearance that authorised it. An order with a
-- null pre_intake_id was charged without passing the gate, and the partial
-- index below makes that one query rather than an audit.
alter table public.orders add column if not exists pre_intake_id uuid
  references public.pre_intakes(id) on delete set null;
alter table public.orders add column if not exists sufficiency_fingerprint text;
-- The answers themselves travel to the order so the worker can rebuild the
-- E-ASK ledger items through the SAME function that scored them
-- (worker/sufficiency.ts). Derived state is never carried across the payment
-- boundary — only the raw answers are, and they are re-derived on arrival.
alter table public.orders add column if not exists intake_answers jsonb;
create index if not exists orders_ungated_idx
  on public.orders (created_at desc) where pre_intake_id is null;

-- ------------------------------------------------------------ 5. escalations
-- Invariant 7: operator alerting is not review, and is required.
--
--   payment_ungated          a charge arrived with no valid clearance. The
--                            webhook queues NO work and refunds it; a human is
--                            told either way, because money moved.
--   sufficiency_refund_failed the automatic refund itself failed. This is the
--                            only state in the path where a customer is out of
--                            pocket, so it alerts separately and loudly.
alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','payment_ungated',
                  'sufficiency_refund_failed','other'));

-- ------------------------------------------------------------- 6. observable
-- Invariant 9. Every refusal, every clearance and every ungated charge is an
-- events row; this index makes the gate's own history cheap to read.
create index if not exists events_sufficiency_idx
  on public.events (created_at desc)
  where actor in ('sufficiency-gate','save-intake','stripe-webhook');
