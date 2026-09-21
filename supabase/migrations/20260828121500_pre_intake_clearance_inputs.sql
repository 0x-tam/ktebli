-- ===========================================================================
-- Invariant 2 wiring (WS3's phase-3 exit blocker): the two inputs the
-- fingerprint recompute needs but the row could not store.
--
-- 20260826180000 built the whole clearance mechanism — slots, verdict columns,
-- checkout_token, consume_checkout_token() — but `canonicalPayload()` in
-- worker/sufficiency.ts fingerprints over {tier, ..., grant_ok, ...} and
-- pre_intakes had nowhere to store either. Without them the webhook cannot
-- recompute the fingerprint from the row's own answers, which is the exact
-- check consume_checkout_token() exists to make.
--
--   tier              the tier the clearance was scored for. The webhook also
--                     compares it against the PAID tier: a clearance earned for
--                     one tier does not authorise a charge for another.
--   grant_analysis_ok whether the grant input was server-verified as readable
--                     (save-intake fetches a URL-shaped grant input itself,
--                     deterministically, via the same SSRF-hardened fetch the
--                     worker uses — never a client assertion).
-- ===========================================================================

alter table public.pre_intakes add column if not exists tier text;
alter table public.pre_intakes drop constraint if exists pre_intakes_tier_check;
alter table public.pre_intakes add constraint pre_intakes_tier_check
  check (tier is null or tier in ('trial','draft','competitive','full'));

alter table public.pre_intakes add column if not exists grant_analysis_ok boolean not null default false;
