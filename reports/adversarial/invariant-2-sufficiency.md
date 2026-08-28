# Invariant 2 — the pre-payment sufficiency gate — adversarial round 2

**Invariant:** no money is taken for an order the system cannot fulfil.
**Operationalised (my brief):** `save-intake` must refuse to mint a checkout
authorisation without a cleared verdict; `stripe-webhook` must refuse
order-with-work creation without a stored, fingerprint-matched, single-use
clearance.

**Verdict: CONCEDED.** I could not create a funded order (stages queued + worker
woken) without a legitimately-cleared, fingerprint-matched, single-use clearance,
and I could not mint a checkout token without `evaluateSufficiency()` clearing.
Every attack in my brief refuses, and I proved the two things round 1 asserted by
source but never *executed*: the FOR-UPDATE serialisation of
`consume_checkout_token` under real concurrency, and the RLS/grant lockdown of
`pre_intakes`.

This is round 2. Round 1 (`tests/adversarial/payment_without_clearance_test.ts`,
`tests/exclusivity/checkout_clearance_test.sql`) is assumed closed; I did not
re-attack what it already proves. I went after the gaps it left: **live
concurrency** and the **public write surface**.

> Environment note. This agent was isolated in a git worktree whose checkout is an
> older snapshot (no `supabase/migrations/`, no `tests/`, no sufficiency gate). The
> code under test — `supabase/functions/{save-intake,stripe-webhook}/`,
> `worker/sufficiency.ts`, `clearance.ts`, the two clearance migrations — was read
> and attacked in the authoritative checkout at `/home/jarvis/ktebli` (branch
> `claude/supabase-audit-verify-77v56v`), and the SQL was executed against the live
> local stack. All `file:line` references below are to that authoritative tree, the
> same tree `adv2_sufficiency_test.ts` is written to run inside (round-1 import
> convention). `deno` is not installed in this environment, so the module-level
> assertions were reasoned and the DB-level ones executed via `psql`; outputs are
> quoted verbatim.

Attacker model. What an adversary actually controls:
- the wizard inputs to `save-intake` (fully controlled);
- which gate-minted token to attach as Stripe `client_reference_id`, and which
  tier's payment link to pay (one link per tier, server-owned price/tier).
An adversary does **not** control the Stripe signature (checked, 300 s tolerance,
`stripe-webhook/index.ts:60-70,121`), the price/tier/currency of a link, or —
critically — any direct write to `pre_intakes`.

---

## The one order-creation path

`grep` across all eight edge functions and the migrations: the **only** insert
into `orders` is `stripe-webhook/index.ts:226` (`ins("orders", …)`), and it is
the only site that then creates `order_proposals` (:276), `job_stages` (:280) and
wakes the worker (:299-304). `request-revision/index.ts:88` inserts a `job_stages`
row, but only onto an *already-paid* proposal it has verified the caller owns
(:63) — it cannot mint an order and is out of invariant-2 scope. There is no
`create_order` RPC. So the whole invariant reduces to one predicate at
`stripe-webhook/index.ts:213`:

```
const funded = priceOk && emailOk && clearanceOk;   // clearanceOk = (pi !== null)
```

and `pi` is *only* ever the jsonb returned by `consume_checkout_token()`
(:174-177). When `funded` is false the webhook still writes an `orders` row but
parks it `status:"attention"` with **no proposal, no stages, no worker wake**
(:242-274) and raises a `payment_ungated` escalation at priority `immediate`. That
parked path is money-moved-but-no-work: the *designed* refund case, not a
fulfilment. So a break means driving `clearanceOk` true without a real clearance,
or minting a token without clearing.

---

## Attacks tried, and why each refused

### 1. Race two webhook calls on ONE token — can two orders be created? (executed)

The sharpest untested question. `consume_checkout_token` is `SECURITY DEFINER`
and does `select … where checkout_token = p_token FOR UPDATE`
(`20260826180000_sufficiency_gate.sql:119`) before the used-at guard (:123). The
claim is that FOR UPDATE serialises two concurrent webhooks so at most one gets
the row. Round 1 only asserted FOR UPDATE *by source*; I executed it against the
live schema (`postgresql://…54322`, local function verified byte-identical to the
migration).

**Controlled contention** (guaranteed overlap, real function on both sides): open
session A inside an explicit txn, run `consume_checkout_token(tok,'sessA',fp)`
(acquires the row lock, sets `used_at`, does **not** commit), then fire session B
`consume_checkout_token(tok,'sessB',fp)` as a separate autocommit call. B provably
**blocks** on A's row lock; A `pg_sleep`s then commits; B unblocks, re-evaluates
under READ COMMITTED against the now-committed row, sees `checkout_token_used_at`
set, and refuses.

```
A output:  A_got=true
B output:  B_got=false
pre_intakes: used=t  session=sessA
events:  checkout_consumed  sess=sessA
         checkout_refused   sess=sessB  reason=token_already_used
```

**Simultaneous-fire stress:** 25 fresh tokens, two autocommit `consume` calls
fired at once per token. Result: `double_or_zero_win_iterations=0`, and exactly
one `checkout_consumed` event per token (`tokens=25 min_consumed=1 max_consumed=1`).

Two orders cannot be created from one token: the loser gets `null` →
`funded=false` → parked, no work. **Refused.**

### 2. Reuse a spent token (executed, across committed transactions)

Round 1 proves reuse inside a single txn. I proved it across two *committed*
autocommit calls: first `consume` → row (`t`); second `consume` on the same token
→ `null` (`f`), `reason=token_already_used`. Single use survives commit
boundaries. **Refused.**

### 3. Forge a clearance by writing `pre_intakes` directly (executed — the linchpin)

Every other attack (clear-then-edit, forged fingerprint, tier swap in the row,
fake `sufficiency_cleared`) collapses to one question: **can the attacker write
`pre_intakes` at all?** The clearance columns (`sufficiency_cleared`,
`sufficiency_fingerprint`, `checkout_token`, `checkout_token_at`) are written
*only* by `save-intake` from a server-computed verdict
(`save-intake/index.ts:142-165`) — `grep` confirms no other writer. `save-intake`
mints a token at exactly one site, gated on the verdict it just computed:

```
save-intake/index.ts:141:  const token = verdict.cleared ? mintCheckoutToken() : null;
```

Nothing client-supplied can assert `cleared`; `evaluateSufficiency` derives it
(`sufficiency.ts:836`) and `assertVerdictConsistent` (:865-873) throws if the
boolean disagrees with `blockers/gaps/score` — and `save-intake` has no try/catch
around the call, so an inconsistent verdict 500s with no token. And the DB
constraint `pre_intakes_clearance_complete` (:73-84) forbids
`sufficiency_cleared=true` unless `sufficiency_score >= sufficiency_threshold`.

So forging means writing the row yourself. Executed, as both public roles:

```
grants on pre_intakes for anon/authenticated:  (none)
RLS enabled: t   policies on pre_intakes: 0
role anon          insert pre_intakes  -> ERROR: permission denied for table pre_intakes
role authenticated insert pre_intakes  -> ERROR: permission denied for table pre_intakes
role anon          select pre_intakes  -> ERROR: permission denied for table pre_intakes
role authenticated update pre_intakes  -> ERROR: permission denied for table pre_intakes
role anon  execute consume_checkout_token -> ERROR: permission denied for function consume_checkout_token
```

`pre_intakes` is `enable row level security` + `revoke all … from anon,
authenticated` (`20260820150903_pre_intakes.sql:13-14`) with **zero** policies, so
PostgREST exposes no read or write of it to the public roles; and
`consume_checkout_token` is granted to `service_role` only (:150-151). The public
API cannot forge, read, or edit a clearance, and cannot consume a token itself.
**Refused.**

### 4. Clear-then-edit (good answers, edit down, pay)

Requires mutating the stored row after clearance. Two paths, both closed:
- **Direct edit** — blocked by §3 (anon/authenticated `UPDATE` → permission
  denied).
- **Via `save-intake`** — the only customer edit path re-runs the whole gate,
  re-computes the fingerprint, and re-mints (or nulls) the token in the *same*
  atomic row write (`save-intake/index.ts:130-165,173`). There is no reachable
  state where `sufficiency_cleared=true` sits beside a token whose fingerprint
  belongs to a *different* (better) set of answers than the row currently holds:
  cleared flag, answers, and fingerprint are always written together. The webhook
  re-canonicalises the current row through the byte-identical twin and hands the
  recomputed fingerprint to the gate (:172-176); any divergence →
  `fingerprint_mismatch`. **Refused.**

### 5. Clearance for intake A used to pay for intake B / tier mismatch

The token is a unique key (`pre_intakes_checkout_token_idx`,
`20260826180000:98-99`); the webhook loads the row *by token* (:163), so "pay for
a different intake" is not expressible — you always get the token's own row. Tier
is checked twice: the webhook refuses if `found[0].tier !== paidTier`
(`:166`, `tier_mismatch`) and `tier` is inside the fingerprint (`canonicalPayload`,
`sufficiency.ts:938`), so a row edited to another tier also mismatches. Price is a
third gate (`priceOk`, :147-148): a draft clearance paid via the full link fails
the amount check anyway. **Refused.**

### 6. Expired clearance

`consume_checkout_token` refuses when `checkout_token_at < now() - interval '6
hours'` (`20260826180000:124`, `token_expired`). `checkout_clearance_test.sql`
step 8 executes it; nothing lets the caller widen the TTL. **Refused.**

### 7. Forge a fingerprint that matches

The fingerprint is SHA-256 of `canonicalPayload` (`sufficiency.ts:954-960`); a
second-preimage is infeasible, and §3 shows the attacker cannot write the recorded
fingerprint anyway. **Refused.**

### 8. Mint a token on the error/catch path

There is no catch that returns a token: the sole mint site is gated on
`verdict.cleared` (§3), and `evaluateSufficiency`/`assertVerdictConsistent` throw
rather than return a truthy `cleared` on inconsistency. A thrown gate 500s the
request. **Refused.**

---

## The residual I probed, and why it is still not reachable

`canonicalPayload` binds the grant by **length + analysability**, not by text
(`sufficiency.ts:943` `grant_len`; and `grant_ok`). So a *same-length* different
grant would keep the fingerprint. Round 1 recorded this. I confirmed the mechanism
holds (a same-length grant swap does keep the fingerprint) and then confirmed it is
**not reachable**: exploiting it needs a post-clearance edit of `grant_input` that
does not go through `save-intake`, which §3 proves impossible for the public roles.
The same reasoning covers `directions` and `upload_names` — carried to the order
(`stripe-webhook:190,194`), not in the fingerprint, and not gate-relevant — both
fixed at `save-intake` time behind the same RLS wall. None is a reachable break;
all are recorded so a future change that opens a public write to `pre_intakes`
re-opens them.

Boundary note (not invariant 2): the gate scores applicant **assertions** and marks
them `applicant_asserted` (`sufficiency.ts:644`, never `verified`). A fabricated but
well-shaped place name would clear the floor. That is by design — pre-payment the
gate only asks whether *something specific* was supplied to write about; verifying
it against reality is the post-payment identity/claim-ledger job (invariant 3,
`fabricated_identity_test`), not this gate. Out of invariant-2 scope; not pursued
as a break here.

---

## Reproduction

Executed against the local stack
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres`); the deployed
`consume_checkout_token` body was verified byte-identical to
`supabase/migrations/20260826180000_sufficiency_gate.sql`. Three harnesses:

1. **Controlled contention** — insert one cleared/live-token row; session A runs
   `consume` inside an open txn and `pg_sleep(2)`s before COMMIT; session B fires
   `consume` on the same token 0.6 s later and provably blocks, then refuses
   `token_already_used`. Exactly one winner (A).
2. **Simultaneous-fire stress** — 25 fresh tokens, two autocommit `consume` calls
   per token fired at once. Zero double/zero-win iterations; exactly one
   `checkout_consumed` event per token.
3. **RLS/grant + committed reuse** — table-grant introspection, `set role
   anon`/`authenticated` insert/select/update all denied, `consume` execute denied
   to anon, and single-use across two committed autocommit calls.

The harnesses create only `email like 'adv2-%'` `pre_intakes` rows and delete them
afterward. The four pre-existing `KT-1000x` orders were never touched (no order was
created or modified by any probe). One unavoidable, benign side effect: the ~54
audit rows the probes wrote into `public.events` cannot be deleted — `events` is
append-only (trigger `events_no_change` raised `events is append-only` on my
cleanup DELETE), which is itself confirmation that the invariant-9 audit trail
resists tampering. They are clearly marked (`actor='sufficiency-gate'`, sessions
`sessA/sessB/r1/r2/x*`) and reference now-deleted probe rows.

`tests/adversarial/adv2_sufficiency_test.ts` encodes the round-2 findings as a
regression guard: module-level attacks execute the shipping `sufficiency.ts` +
`clearance.ts`; the DB-authority facts (FOR UPDATE serialisation, single-use, TTL,
fingerprint + cleared checks, `service_role`-only grant, unique token index, the
`score >= threshold` clearance constraint, the RLS+revoke on `pre_intakes`, and the
single order-creation site) are asserted against the real migration and function
sources — the same by-source technique round 1 uses for glue that cannot be
imported. An optional block re-runs the live concurrency proof when `KTEBLI_DB_URL`
is set (skipped, and non-fatal, otherwise).

## Fix spec

None. Invariant 2 holds against the reachable attack surface; no change to shared
code is warranted. The single forward-looking guard: **never grant `anon` or
`authenticated` any privilege on `pre_intakes`, and never add a policy that exposes
it** — that RLS wall is what makes the fingerprint's grant/directions/upload
residuals unreachable. `adv2_sufficiency_test.ts` fails if that wall, the
FOR-UPDATE serialisation, the single-use/TTL guards, or the single order-creation
path regress.
