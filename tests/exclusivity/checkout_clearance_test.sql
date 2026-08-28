-- ============================================================================
-- Invariant-2 authority test: consume_checkout_token() refuses by default.
--
-- stripe-webhook creates an order-with-work ONLY from the jsonb this function
-- returns. This proves, by execution on the replayed head, that every refusal
-- path refuses (returning null and writing a checkout_refused events row) and
-- that the one legitimate path — cleared row, matching fingerprint, unused,
-- fresh token — returns the row exactly once. There is no argument that makes
-- it return a row it would otherwise refuse.
--
-- Also proves the storage contract the webhook relies on:
--   * pre_intakes_clearance_complete: a row cannot claim sufficiency_cleared
--     without fingerprint/score/threshold/timestamps;
--   * pre_intakes.tier is constrained to the four real tiers;
--   * orders.pre_intake_id / sufficiency_fingerprint / intake_answers exist
--     (the "order remembers its licence" columns the webhook writes).
-- Runs in one transaction, rolled back.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- storage contract ------------------------------------------------------------
do $$
begin
  begin
    insert into public.pre_intakes (email, tier) values ('x@example.invalid', 'gold');
    raise exception 'CLEARANCE REGRESSION: unknown tier accepted on pre_intakes';
  exception when check_violation then
    raise notice 'CLEARANCE-OK: unknown tier refused by pre_intakes_tier_check';
  end;
  begin
    insert into public.pre_intakes (email, tier, sufficiency_cleared) values ('x@example.invalid', 'draft', true);
    raise exception 'CLEARANCE REGRESSION: cleared=true accepted with no fingerprint/score — pre_intakes_clearance_complete is gone';
  exception when check_violation then
    raise notice 'CLEARANCE-OK: cleared without a complete clearance record refused';
  end;
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'orders' and column_name = 'pre_intake_id';
  if not found then raise exception 'orders.pre_intake_id missing'; end if;
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'orders' and column_name = 'sufficiency_fingerprint';
  if not found then raise exception 'orders.sufficiency_fingerprint missing'; end if;
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'orders' and column_name = 'intake_answers';
  if not found then raise exception 'orders.intake_answers missing'; end if;
  raise notice 'CLEARANCE-OK: the order-licence columns exist';
end $$;

-- the refusal matrix ----------------------------------------------------------
do $$
declare
  v_tok text := repeat('ab', 24); -- 48 chars, like mintCheckoutToken()
  v_fp  text := repeat('11', 32);
  v_id uuid; v_out jsonb; v_refusals int;
  refused_reasons text[];
begin
  -- a CLEARED intake with a live token
  insert into public.pre_intakes
    (email, tier, org_name, grant_input, site_place, sufficiency, sufficiency_cleared,
     sufficiency_fingerprint, sufficiency_score, sufficiency_threshold, sufficiency_scorer,
     sufficiency_contract, sufficiency_at, checkout_token, checkout_token_at)
  values
    ('clear@example.invalid', 'draft', 'Clearance Probe Org', 'probe guidelines', 'Qobbe, Tripoli',
     '{"cleared":true}'::jsonb, true, v_fp, 2, 1, 'referent_count', '1.0.0', now(), v_tok, now());

  -- 1. absent token
  v_out := public.consume_checkout_token(null, 'cs_t1', v_fp);
  if v_out is not null then raise exception 'REFUSAL FAILURE: null token returned a row'; end if;
  -- 2. short token
  v_out := public.consume_checkout_token('short', 'cs_t2', v_fp);
  if v_out is not null then raise exception 'REFUSAL FAILURE: short token returned a row'; end if;
  -- 3. unknown token
  v_out := public.consume_checkout_token(repeat('cd', 24), 'cs_t3', v_fp);
  if v_out is not null then raise exception 'REFUSAL FAILURE: unknown token returned a row'; end if;
  -- 4. fingerprint mismatch (the edited-answers case)
  v_out := public.consume_checkout_token(v_tok, 'cs_t4', repeat('22', 32));
  if v_out is not null then raise exception 'REFUSAL FAILURE: wrong fingerprint returned a row'; end if;
  raise notice 'CLEARANCE-OK: absent/short/unknown token and wrong fingerprint all refuse';

  -- 5. the legitimate path returns the row, once
  v_out := public.consume_checkout_token(v_tok, 'cs_t5', v_fp);
  if v_out is null then raise exception 'CLEARANCE FAILURE: a valid cleared token was refused'; end if;
  if (v_out->>'email') <> 'clear@example.invalid' then raise exception 'wrong row returned'; end if;
  raise notice 'CLEARANCE-OK: a valid cleared token is consumed and returns its row';

  -- 6. single use: the same token again refuses
  v_out := public.consume_checkout_token(v_tok, 'cs_t6', v_fp);
  if v_out is not null then raise exception 'REFUSAL FAILURE: a consumed token was consumed twice'; end if;
  raise notice 'CLEARANCE-OK: a consumed token refuses on reuse';

  -- 7. not cleared: token exists, clearance withdrawn
  insert into public.pre_intakes (email, tier, checkout_token, checkout_token_at)
  values ('uncleared@example.invalid', 'draft', repeat('ef', 24), now());
  v_out := public.consume_checkout_token(repeat('ef', 24), 'cs_t7', v_fp);
  if v_out is not null then raise exception 'REFUSAL FAILURE: an uncleared row returned a row'; end if;
  -- 8. expired token on a cleared row
  insert into public.pre_intakes
    (email, tier, org_name, sufficiency_cleared, sufficiency_fingerprint, sufficiency_score,
     sufficiency_threshold, sufficiency_scorer, sufficiency_contract, sufficiency_at,
     checkout_token, checkout_token_at)
  values
    ('stale@example.invalid', 'draft', 'Stale Org', true, v_fp, 2, 1, 'referent_count', '1.0.0',
     now() - interval '7 hours', repeat('99', 24), now() - interval '7 hours');
  v_out := public.consume_checkout_token(repeat('99', 24), 'cs_t8', v_fp);
  if v_out is not null then raise exception 'REFUSAL FAILURE: an expired token returned a row'; end if;
  raise notice 'CLEARANCE-OK: uncleared and expired tokens refuse';

  -- every refusal above is an events row (invariant 9)
  select count(*), array_agg(distinct detail->>'reason')
    into v_refusals, refused_reasons
    from public.events
   where actor = 'sufficiency-gate' and action = 'checkout_refused'
     and detail->>'session' in ('cs_t1','cs_t2','cs_t3','cs_t4','cs_t6','cs_t7','cs_t8');
  if v_refusals <> 7 then
    raise exception 'OBSERVABILITY FAILURE: expected 7 checkout_refused events, found %', v_refusals;
  end if;
  raise notice 'CLEARANCE-OK: all 7 refusals recorded as events (reasons: %)', refused_reasons;
  if not exists (select 1 from public.events
                 where actor = 'sufficiency-gate' and action = 'checkout_consumed'
                   and detail->>'session' = 'cs_t5') then
    raise exception 'OBSERVABILITY FAILURE: the consumption was not recorded';
  end if;
  raise notice 'CLEARANCE-OK: the consumption is an events row';
end $$;

rollback;
\echo 'CHECKOUT-CLEARANCE TEST PASSED'
