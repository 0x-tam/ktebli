# Reliability audit — completion, failure notification, retry stranding, crawler

Scope: `supabase/functions/worker/index.ts` (v26, 1929 lines), `supabase/migrations/*.sql`,
`supabase/functions/stripe-webhook/index.ts`, `supabase/functions/order-status/index.ts`,
`supabase/functions/worker/ssrf.ts`.

Design only. No file in the repo is modified by this document. Every fix below is stated as the
*minimum* change, with the test that proves it, and none of them puts a human in the customer
workflow.

---

## (a) COMPLETION — Competitive and Full do not reliably finish

### a.1 What actually governs an invocation

| Mechanism | Location | What it really bounds |
|---|---|---|
| `TIME_BUDGET_MS = 100_000` | `index.ts:43` | nothing but the *claim* loop |
| `while (Date.now() - start < TIME_BUDGET_MS)` | `index.ts:1901` | **the only place the clock is read in the entire file** |
| `PARALLEL = 3`, batch claim | `index.ts:44`, `1903-1907` | 3 stages claimed per iteration |
| `await Promise.all(claims.map(...))` | `index.ts:1909-1925` | **unbounded** — no deadline, no timeout, no cancellation |
| `runStage()` | `index.ts:1122-1888` | contains no clock read at all |

The consequence is precise and load-bearing: **`TIME_BUDGET_MS` is a claiming budget, not an
execution budget.** The loop may claim a batch at t = 99.9 s (line 1901 passes) and then run those
three stages to completion at line 1909. The effective ceiling of one invocation is therefore
`100 s + (duration of the slowest stage in the last batch)`, and nothing in the worker knows or
cares what that second term is. Because `Promise.all` waits for all three, one slow stage also pins
the isolate for its two fast siblings.

### a.2 Heartbeat and the reaper — both directions are broken

`reap_stale_stages()` (`20260820145739_orders_and_job_queue.sql:114-123`) kills any stage whose
`heartbeat_at < now() - interval '3 minutes'`, setting it back to `pending`, or to `failed` once
`attempt >= max_attempts` (default 3, `20260820145739:52`). `claim_next_stage` increments `attempt`
at claim time (`:106`), so three timeouts consume the whole budget.

The beat is `beatAll()` (`index.ts:118-127`), called from exactly one place: the **first line of
`llmRaw`** (`index.ts:138`), throttled to 20 s (`:121-123`). It beats every stage in `ACTIVE_BEATS`,
i.e. all three siblings sharing the isolate.

Two failure modes follow directly from "beat at call start only":

1. **Under-beating during a single long call.** The gap between beats equals the gap between call
   *starts*. A single `llmRaw` that takes longer than 180 s produces no beat while it is in flight,
   so the reaper kills a stage that is alive and working. A 7 000-token completion with reasoning on
   a congested provider reaches that. This is the residual hole left by the v21 fix, which moved the
   beat to call boundaries but not *inside* a call.
2. **Over-beating a hung stage.** `llmRaw`'s fetch (`index.ts:139-149`) has **no `AbortSignal` and
   no timeout** — the only network call in the file without one (compare `renderService` at
   `:938` using `AbortSignal.timeout(45_000)`, and `safeFetchText` at `ssrf.ts:91-92`). Deno's
   `fetch` will wait indefinitely. Meanwhile the two sibling stages keep calling `beatAll()`, which
   beats the hung stage too. `heartbeat_at` therefore means *"this isolate is alive"*, not *"this
   stage is progressing"*, and the reaper cannot recover a wedged stage while any sibling is busy.

That second mechanism is the most likely explanation of the observed **807 s**: the stage kept a
fresh heartbeat far past 180 s because it, or a sibling, was still issuing calls, and it was
eventually "lost" not by the reaper but by the platform tearing down the isolate — an event the
worker never observes and never records.

### a.3 Exactly where a long generation exceeds one invocation

Worst-case model calls per stage, from the code:

- `llm()` = up to **4** `llmRaw` hops (`index.ts:159-167`).
- `generateValidated()` = up to **3** `llm()` calls — initial `:626`, repair `:648`, final `:663` —
  hence up to **12** `llmRaw` calls.

| Stage | Worst-case `llmRaw` calls | Where |
|---|---|---|
| `gen:narrative` | 12 @ `max_tokens` 7000 | `:1554` → `generateValidated`, spec.max 7000 (`:1049`) |
| `validate`, tier `full` | **48** | `:1594-1682` |
| `check` when the similarity gate fires | 24 @ 7000 | `:1744-1751`, 2 rewrites × `generateValidated` |
| `revise` | 28 | `:1692-1713` |

`validate` at `full` is the arithmetic that matters. `maxRounds = 2` (`:1587`) gives three loop
iterations; each does a Claim-Ledger call (`:1604`, 3000 tok) plus a coverage/review call
(`:1621`, 3500 tok, `effort: "high"`) = 2 × `llm()` = 8 hops; rounds 0 and 1 each end in a
**full-narrative regeneration** at `generateValidated(..., 7000, ...)` (`:1676`) = 12 hops each.
3 × 8 + 24 = **48 calls in one stage**. At a realistic 15-25 s per 7000-token reasoning call that
is 720-1200 s — the observed 807 s sits inside that band.

**This is the tier correlation.** `deep`/`mid` (`:1560-1561`) are set from `order.tier`; `maxRounds`
is 2 only for `full`; the four extra `gen:*` stages exist only for `competitive`/`full`
(`stripe-webhook/index.ts:67-78`); more documents mean a longer narrative, which makes the
word-limit repair ladder in `generateValidated` more likely, which multiplies the call count. Draft
never reaches these branches, which is why only the paid-up tiers fail.

### a.4 Is any stage resumable? No.

- `done()` (`index.ts:1125-1126`) is the only writer of `status: "done"` + `output`. It runs once, at
  the very end of the stage.
- `ctx()` (`:996-1003`) collects `out[st.key]` **only where `st.status === "done"`** (`:1001`). A
  retried stage therefore cannot see one byte of its own previous attempt.
- `claim_next_stage` returns `(stage_id, proposal_id, seq, key, attempt)`
  (`20260820145739:78`) — **not `output`**. The worker never re-reads its own row.
- Three mid-flight `output` patches exist — strategy exhaustion `:1447-1456`, validate unresolved
  `:1638-1641`, package QA `:1824/:1838/:1849` — but all three are diagnostics written immediately
  before a `throw`, and **nothing anywhere reads them back**.

So the only resumption granularity the system has is *stage*-level, which it gets for free from the
queue. Within a stage, a death at call 47 of 48 discards all 47 and burns an attempt.

**State that must be persisted for section-by-section resumption of `gen:narrative`:**

1. **The section plan** — an ordered list of headings, derived deterministically from
   `analysis.application_structure.sections_or_questions` (`:1518-1521`) or `fmt.requiredSections`
   (`:1133`), falling back to a plan derived from `design.project` outputs. It must be *persisted*,
   not re-derived, or a resumed run can splice sections from two different plans.
2. **Per-section text**, keyed by section index.
3. **An input fingerprint** — a hash of `baseCtx()` (`:1150-1161`). `baseCtx()` is a pure function of
   upstream stage outputs, all frozen at `done`. If the fingerprint differs from the stored one
   (upstream stage was reset), discard progress rather than splice two strategies together.
4. **Per-section repair-ladder position**, so `generateValidated`'s 3-attempt ladder is not reset to
   zero on every invocation and allowed to loop forever.
5. **An `assembled` flag**, so the final word-count/shorten pass is not re-run on an already-valid
   document.

`validate` needs the same treatment, and is cheaper: `{ round_index, current_narrative }` written
after each iteration of the loop at `:1594`. `rounds` is already accumulated at `:1601`.

### a.5 Minimum fix

Three parts, all worker-side plus one column.

**A1 — cooperative deadline.** Make `start` from `:1898` reachable inside `runStage` and check it at
every existing `await beat()` site and at the top of each iteration of the three loops that can
run long: `validate`'s round loop (`:1594`), `check`'s rewrite loop (`:1744`), `package`'s document
loop (`:1780`). On exceeding a self-imposed deadline **well inside** the platform ceiling (proposed:
`start + 240_000`, i.e. beyond the claiming budget but with wide margin), persist progress and
yield: set the row back to `pending` **without consuming an attempt**. That needs one new
SECURITY DEFINER function, `yield_stage(p_stage bigint)`, doing
`update job_stages set status='pending', attempt = attempt - 1, heartbeat_at = null where id = ... and status='running'`.
This converts "isolate killed, all work lost, attempt burned, order eventually `failed`" into
"worker stops on its own terms and the next cron tick continues".

**A2 — bound the unbounded call.** Add `signal: AbortSignal.timeout(120_000)` to the `llmRaw` fetch
(`:139-149`), and arm a `setInterval(beatAll, 20_000)` for the invocation's lifetime instead of
relying on call-boundary beating. The interval fixes under-beating during one long call; the abort
bounds the hang so the sibling-beating problem can no longer exceed 120 s. No schema change.

**A3 — section-by-section narrative.** Within the `gen:narrative` stage only (stages stay strictly
sequential; this is entirely internal). Add `job_stages.progress jsonb`, have `runStage` read its
own row's `progress` at entry, generate one section per bounded call (~800-1200 tokens instead of
7000), write `progress` after each, and assemble at the end. Word-limit compliance becomes an
assembly-time shorten pass — which `generateValidated` already implements as the `lengthOnly`
branch at `:659-671`. The same `progress` column carries `validate`'s round state.

### a.6 How this is tested

All tests run against a **local** stack (`supabase start`) — never the production project — with a
test module that patches `globalThis.fetch` to intercept `openrouter.ai`, `api.resend.com` and the
render service *before* dynamically importing the worker (`await import(...)`), then drives the
worker over HTTP with the correct `x-worker-secret`.

- **A-t1 (regression, must fail today):** stub sleeps 200 s on one call. Assert the stage is reaped
  mid-flight while the isolate is alive. This is the proof that call-boundary beating is
  insufficient. Passes after A2.
- **A-t2 (deadline):** stub delays 40 s per call, `validate` at tier `full`. Assert the invocation
  returns before deadline + slack, the row is `pending`, and `attempt` did not increase.
- **A-t3 (resumption):** stub returns exactly one section per call and counts calls per section
  heading. Run the worker three times. Assert the stage reaches `done`, the narrative contains every
  section in order, and **each section was generated exactly once** across all three invocations.
- **A-t4 (reaper interaction):** back-date `heartbeat_at` by 4 minutes, call `reap_stale_stages()`,
  re-run. Assert `pending`, and that completed sections are not regenerated.
- **A-t5 (fingerprint):** resume with an upstream stage output mutated. Assert progress is discarded
  and the narrative is rebuilt from section 1.
- **A-t6 (cost ceiling):** assert total stubbed calls for a `full`-tier order stays under a fixed
  budget, so the fix cannot regress into unbounded regeneration.

---

## (b) FAILURE NOTIFICATION — every terminal path is silent

`sendEmail` is defined at `index.ts:1037-1046` and called at **`index.ts:1877`** — the deliver
stage, success only. That is the only call site in the worker. `stripe-webhook/index.ts:86` defines
its own copy, called once at `:205` (the "we're on it" email). There is no third.

### b.1 Every terminal path, and who learns about it

| # | Terminal state | Produced at | Customer learns | Operator learns |
|---|---|---|---|---|
| 1 | `failed` — 3 attempts exhausted in the worker's own catch | `index.ts:1913-1917` (`st.attempt >= 3`) | nothing; order page shows a soothing note | nothing |
| 2 | `failed` — reaper, `attempt >= max_attempts` | `20260820145739:117` | nothing | nothing |
| 3 | `held` — similarity gate | thrown `:1749`, classified final `:1913` | nothing | nothing |
| 4 | `held` — `claim blocked: existing_claim_same_org` | thrown `:1434` | nothing | nothing |
| 5 | `held` — `claim blocked: strategy_space_exhausted` (**the 9th customer**) | thrown `:1459` | nothing | nothing |
| 6 | `failed` — page limit unverifiable, render service down | thrown `:1846` | nothing | nothing |
| 7 | `failed` — rendered page count over donor limit | thrown `:1834` | nothing | nothing |
| 8 | `failed` — visual QA blocking | thrown `:1842` | nothing | nothing |
| 9 | `failed` — validation unresolved after all rounds | thrown `:1642` | nothing | nothing |
| 10 | `failed` — budget over ceiling after one rework | thrown `:1542` | nothing | nothing |
| 11 | `failed` — content validation failed after 3 attempts | thrown `:675` | nothing | nothing |
| 12 | order parked, **no stages ever created** — Stripe price mismatch | `stripe-webhook:183-194` | **not even the "we're on it" email** — it returns at `:193` before `:205` | intended, but see b.3 |
| 13 | isolate torn down mid-stage | platform | nothing | nothing |

Rows 1-11 all end at `rollup_statuses` (`20260820172956:38-57`), which maps any `failed` or `held`
stage to proposal `attention` and then order `attention`. **`attention` is a terminal resting state
with no consumer.** Nothing polls it, nothing emails on it, nothing escalates it.

### b.2 What the customer actually sees

`order-status/index.ts:70-74`:

```
note: s.status === "held" || s.status === "failed"
  ? "The final checks on this document are taking a little longer than usual. If this does not
     clear shortly, we will follow up by email."
  : null,
```

The paid customer sees a stalled progress bar and **an explicit promise of a follow-up email that no
code in the repository is capable of sending**. The `error` column is (correctly) not exposed. The
order page never transitions to any terminal statement. A dead order and a slow order are visually
identical, forever.

For the price-mismatch path (#12) the customer sees an order page with `proposals: []` and
`status: "paid"` — zero stages, zero explanation, and no email of any kind was ever sent.

### b.3 What the operator sees

Nothing, and the one mechanism that was meant to tell them is broken.

`stripe-webhook/index.ts:190-192` inserts into `escalations`. That table
(`20260819194825_core_schema.sql:179-190`) has:

- `kind text not null check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck','provenance_failed','other'))` — **`'price_mismatch'` is not in the list**;
- `due_at timestamptz not null` with **no default** — the insert omits it;
- `proposal_id uuid references public.proposals(id)` — the *legacy* `proposals` table, not
  `order_proposals`.

The insert therefore fails on two constraints, and it is wrapped in `.catch(() => {})` at `:192`.
**The only escalation call in the entire system is a silent no-op.** The `events` insert at
`:186-189` does land, but nothing reads `events` either — there is no operator UI, no digest, no
alert in the repo.

### b.4 Minimum fix

**B1 — one column for idempotency:** `alter table job_stages add column notified_at timestamptz;`

**B2 — one notifier, two call sites.** A helper `notifyTerminal(stage, order, classification)` that
sends a customer email and an operator email (to the `support_email` Vault secret) and writes an
`escalations` row. Called from:

- the worker's catch block at `:1912-1922`, when `final` is true — covers rows 1, 3-11;
- **a sweeper at the top of every invocation**, immediately after `reap_stale_stages()` at `:1900`:
  `select ... from job_stages where status in ('failed','held') and notified_at is null`. This is
  **mandatory, not optional** — the reaper is pure SQL (row 2) and no TypeScript ever observes its
  transitions, so the catch block alone can never cover it. `notified_at` makes it exactly-once.

**B3 — repair `escalations`** so B2's operator half can actually write: extend the `kind` CHECK with
`'stage_failed','stage_held','strategy_exhausted','price_mismatch'`, give `due_at` a default
(`now() + interval '4 hours'`), and repoint `proposal_id` at `order_proposals` (or drop the FK).

**B4 — classification decides the customer's message**, and every class must reach a terminal
outcome without a human:

| Class | Rows | Customer message | Automatic action |
|---|---|---|---|
| capacity exhausted | 5 | "we cannot serve this grant for you" | refund, order → `refunded` |
| exclusivity collision | 3, 4 | "we could not produce a proposal that meets our uniqueness guarantee" | refund |
| infrastructure | 1, 2, 6, 13 | "we hit a technical problem; we are retrying" | re-queue once, then refund |
| content/compliance | 7-11 | "we could not meet this donor's limits" | refund |

**B5 — fix the price-mismatch dead end** (`stripe-webhook:183-194`): send the customer *something*
before returning at `:193`.

**B6 — remove the false promise** at `order-status:70-74` once B2 makes it true, and add a terminal
note for orders that have been notified.

### b.5 How this is tested

- **B-t1:** force each of rows 1-11 with a stub that throws the exact error string, assert exactly
  one stubbed Resend call to the customer, one to support, and one `escalations` row per stage.
- **B-t2 (reaper coverage, the one the catch block cannot do):** insert a `running` row with
  `attempt = 3` and a back-dated heartbeat, run the worker, assert `reap_stale_stages` marked it
  `failed` **and** the sweeper notified.
- **B-t3 (idempotency):** run the worker twice over the same failed row; assert exactly one email.
- **B-t4 (constraint regression):** a plain SQL test that inserts one `escalations` row of every
  `kind` the code uses. This test fails against today's schema, which is the point.
- **B-t5:** assert `order-status` never returns `error` text and that a notified order returns a
  terminal note.

---

## (c) RETRY STRANDING — the claim is never released

### c.1 Why `release_claim()` does not fire

It is defined at `20260819194949_rls_and_claim_functions.sql:151-160` and granted to `service_role`
at `20260820145930:38`. A repo-wide grep for `release_claim` finds **only the definition, the revoke,
the grant, and a sentence in BLUEPRINT.md**. There is **no call site** in any of the eight edge
functions, in any trigger, or in any cron job. It is dead code.

### c.2 Why `expire_stale_holds()` does not fire

`20260819194949:66-73`:

```sql
update public.claims set status = 'released'
where grant_id = p_grant and status = 'hold' and hold_expires_at < now()
```

Three independent reasons it can never touch this claim:

1. **Scope is `status = 'hold'`.** The strategy stage calls `confirm_claim` at `index.ts:1462`
   *immediately* after the grant at `:1425`. The claim is `'confirmed'` within milliseconds and is
   out of scope permanently. `confirm_claim` (`20260819194949:137-149`) has no inverse in any code
   path.
2. **`hold_expires_at` is `now() + interval '6 hours'`** (`20260819194825:88`) — even in the `hold`
   window the claim is not expirable for six hours.
3. **It is only reachable from inside `claim_approach`** (`20260819194949:93`), i.e. it runs *before*
   the insert that is about to fail, and only for that grant.

### c.3 The exact block

`claim_approach`'s `unique_violation` handler tests the locks in order
(`20260819194949:104-120`), and `claims_one_per_org` (`20260819194825:93-95`) is tested **first**:

```sql
when exists (select 1 from public.claims where grant_id = p_grant
  and organisation_id = p_org and status in ('hold','confirmed'))
  then 'existing_claim_same_org'
```

→ `index.ts:1433-1435` throws `"claim blocked: existing_claim_same_org"` — note this `throw` is
inside the template/opening loop and aborts the whole stage, with no fallback candidate →
`index.ts:1913` classifies it `final` on the *first* attempt (`msg.includes("claim blocked")`) →
`:1914-1917` sets `held` → `rollup_statuses` sets the order to `attention` → nobody is told (§b).

### c.4 This is not only an operator-reset problem

The report frames this as "resetting a stage at or before `strategy` strands the order". The code
says it is worse. Between the irreversible side effect and the commit of stage output there are
**five network round trips**:

```
:1425  claim_approach  ← irreversible: the claim row now exists
:1462  confirm_claim
:1463  patch claims.strategy
:1464  patch order_proposals.claim_id
:1465  sel structural_templates
:1466  sel opening_devices
:1467  done()          ← only now is the work durable
```

Any isolate death in that window leaves a live claim, a `running` stage that the reaper returns to
`pending`, and a retry that hits `existing_claim_same_org` and is `held` **permanently, with no
human involved**. Given §a, isolate death is a routine event, not an exotic one.

Two distinct crash windows matter for the fix: after `:1464` the orphan claim is reachable through
`order_proposals.claim_id`; between `:1425` and `:1464` it is reachable through nothing but
`(grant_id, organisation_id)`.

### c.5 Side effect nobody has costed: the 8-proposal ceiling is lower than 8

Every stranded retry leaves a `confirmed` claim holding one of the eight `structural_template_id`
slots and one of the eight `opening_device_id` slots on that grant
(`20260819194825:101-107`), forever. The P0 ceiling of 8 proposals per grant is therefore an
*upper* bound that each stranding permanently decrements.

### c.6 Minimum correct fix

**C1 — one new SECURITY DEFINER function** that releases only a claim this proposal could legally
own:

```sql
create or replace function public.release_stranded_claim(p_proposal uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_claim uuid; v_grant uuid; v_org uuid;
begin
  select p.grant_id, o.organisation_id into v_grant, v_org
    from public.order_proposals p join public.orders o on o.id = p.order_id
   where p.id = p_proposal;
  if v_grant is null or v_org is null then return null; end if;

  select c.id into v_claim
    from public.claims c
   where c.grant_id = v_grant and c.organisation_id = v_org
     and c.status in ('hold','confirmed')
     and (
          exists (select 1 from public.order_proposals op
                   where op.id = p_proposal and op.claim_id = c.id)   -- this proposal owns it
       or (not exists (select 1 from public.order_proposals op
                        where op.claim_id = c.id)                     -- orphan: owned by nobody
           and c.created_at < now() - interval '2 minutes')           -- and not a live sibling race
     )
   limit 1;
  if v_claim is null then return null; end if;

  update public.claims set status = 'released' where id = v_claim;
  update public.order_proposals set claim_id = null where id = p_proposal;
  insert into public.events (actor, action, entity, entity_id, detail)
  values ('release_stranded_claim','claim_released','claim', v_claim::text,
          jsonb_build_object('proposal', p_proposal));
  return v_claim;
end; $$;
```

**C2 — one call**, unconditionally, at the top of the `strategy` stage, before `takenRows` is read
at `index.ts:1376`: `await rpc("release_stranded_claim", { p_proposal: stage.proposal_id });`

Why this is correct and minimal:

- It covers **both** crash windows: the `claim_id`-set case and the orphan case.
- A genuine second concurrent order from the same organisation on the same grant is **still
  blocked** — its claim is referenced by a *different* `order_proposals` row, so neither branch
  matches. The exclusivity guarantee is untouched: the organisation cannot come out of this holding
  two claims, because the same run immediately re-claims.
- The `created_at < now() - interval '2 minutes'` guard closes the only race: a sibling proposal that
  has claimed at `:1425` but not yet patched `claim_id` at `:1464` is, for a few hundred
  milliseconds, indistinguishable from an orphan. An orphan is by definition old.
- It reads `takenRows` *after* the release, so the freed template/opening slots are visible to the
  same run — which also stops the slot leak in §c.5.
- Ordering note: it must run **before** `:1376`, not merely before `:1425`, or the run will exclude
  its own just-freed template/opening from `usedT`/`usedO` (`:1412-1413`).

Rejected alternative: making `claim_approach` return `granted` on `existing_claim_same_org` for the
same org. That would silently permit an organisation to hold two claims when the second order is
legitimate, and it erases the reset from the audit trail.

### c.7 How this is tested

Pure SQL/local-stack tests, no model calls needed:

- **C-t1 (the reported bug):** seed grant + org + proposal; run `strategy` to a confirmed claim;
  reset the stage to `pending`; re-run. Assert the second run is `granted`, the first claim is
  `released`, one `claim_released` event exists, and `order_proposals.claim_id` points at the new
  claim. Fails today.
- **C-t2 (crash window, `claim_id` null):** call `claim_approach` directly, back-date the claim's
  `created_at` by 3 minutes, leave `claim_id` null, then run `strategy`. Assert granted.
- **C-t3 (must stay blocked):** two *different* `order_proposals` for the same org on the same grant.
  Assert the second still gets `existing_claim_same_org` and the first's claim is untouched.
- **C-t4 (race guard):** orphan claim with `created_at = now()`. Assert it is **not** released.
- **C-t5 (slot reclamation):** assert the released claim's `structural_template_id` is claimable by
  the retry.

---

## (d) CRAWLER — empty is not distinguishable from blocked

### d.1 The root cause: HTTP status is fetched and then discarded

`safeFetchText` (`ssrf.ts:78-141`) returns `{ finalUrl, status, contentType, body }`. It handles
3xx (`:107-114`) and rejects a disallowed content-type (`:117`), but **it never inspects
`resp.status` for 4xx/5xx**. And `crawlSite`'s `get()` (`index.ts:220-231`) uses only `res.finalUrl`
and `res.body`. Repo-wide, **no caller ever reads `.status`.**

So a Cloudflare/WAF `403` page, a `404`, or a `503` maintenance page is treated as a *successful
fetch of real content*. Two outcomes, both bad:

- long block page → its text is crawled, extracted, and fed to the evidence-extraction call at
  `:1255` as if it were the organisation's own site;
- short block page (e.g. a 77-byte `text/plain` "Forbidden") → `text.length > 120` at `:264` is
  false, the page is dropped, and — because `home !== null` at `:231` — the crawl does **not** return
  `error: "unreachable"`.

That last sequence produces exactly the reported signature: `pages: []`, `meta` with **no `error`
key at all**, `errors: []`, and no distinction from a site that simply has no prose.

### d.2 Every path that can return empty

| # | Path | Line | Recorded state | Distinguishable? |
|---|---|---|---|---|
| 1 | malformed URL | `:217` | `meta.error = "bad_url"` | **yes** |
| 2 | homepage fetch threw (DNS, SSRF block, timeout, bad content-type, redirect loop) | `:231-232` | `meta.error = "unreachable"`, `meta.errors[]` = `String(e.message).slice(0,40)` | **partly** — reason strings survive but are truncated, capped at 8 (`:268`), and unclassified |
| 3 | homepage returned 4xx/5xx with a short body | `:264` | `pages: []`, **no `error` key** | **no** |
| 4 | homepage returned 4xx/5xx with a long body | `:264` | `pages: [blockpage]` — worse than empty | **no** |
| 5 | JS-rendered site: `stripHtml` of an empty app shell yields <120 chars | `:264` | `pages: []`, no `error` | **no** |
| 6 | prose exists but the paragraph splitter finds nothing: `split(/(?<=[.!?])\s+(?=[A-Z...])/)` then `p.length > 40` (`:256-262`) | `:264` | `pages: []`, no `error` | **no** |
| 7 | cross-page dedupe removed everything: `seenPara` keyed on `p.toLowerCase().slice(0,120)` (`:258`) is shared across pages (`:246`) | `:264` | `pages: []`, no `error` | **no** |
| 8 | `MAX_FETCHES` (14) exhausted | `:223` `return null` | **nothing pushed to `errors`** | **no** |
| 9 | offsite redirect | `:225` | `errors.push("offsite:" + u)` | **yes**, but only for that URL |
| 10 | sitemap absent/broken | `:238` `catch {}` | **nothing recorded** | **no** |
| 11 | discovery starved: the href regex `[^"'#?]+` (`:192`) silently drops every URL containing `?` or `#`, so query-routed and SPA-hash sites yield no candidates | `:192` | `meta.discovered` is low, nothing else | **weakly** |
| 12 | `TOTAL_CHARS` reached before any page kept | `:250` | nothing | **no** |

`meta` is preserved into the stage output as `crawl: crawlMeta` (`:1326`), so whatever *is* recorded
does survive — the problem is that for cases 3-8, 10 and 12 nothing distinguishing is recorded at
all. All of them collapse at `index.ts:1264-1265` into one string:

```
gaps.push({ gap: "website unreachable or empty — no public organisational evidence available",
            severity: "important" })
```

which is what the customer eventually reads. It is true, useless, and not actionable.

### d.3 The identity gate

`orgNameMatchesSite` (`index.ts:447-464`) is sound in what it does: distinctive-token intersection
against `profile.legal_name`, then a domain-substring fallback for tokens longer than 3 chars,
default-deny (`:449` returns false when the applicant name has no distinctive token). The
Beit Al-Shabab / Amel case it was built for is correctly rejected.

Its **trigger condition** is the hole. `index.ts:1288`:

```ts
if (domain && (webEvidence.length || profile.legal_name)) {
```

If the extraction returns `evidence: []` **and** `legal_name: null` but a populated `mission`,
`sector`, `target_populations` or `voice_guide` — the normal shape of a thin or partly-JS site — the
gate never runs. The wrong organisation's `profile` and `voice_guide` then flow into `baseCtx()`
(`:1152`, `:1157`) and drive strategy, design and voice. No `identity_mismatch` is recorded, so the
customer's "Before you submit" page (`certificationsMd`, `:1093`; wired at `:1774`) says nothing.

Related: `content_unchanged` (`:1245-1251`) and `cache_fresh` (`:1238-1243`) both re-enter the gate
at `:1288` — that part is correct and deliberate — but they inherit the same trigger hole.

### d.4 Minimum fix

**D1 — stop treating an error page as content.** One line in `crawlSite.get()` (`index.ts:220-231`),
after the `safeFetchText` call:

```ts
if (res.status >= 400) { errors.push(`http_${res.status}:${u}`); return null; }
```

This alone converts cases 3 and 4 into case 2, which is already recorded. Cleaner variant: raise
`SsrfError("http_" + status)` inside `safeFetchText` (`ssrf.ts:116`) so every caller benefits —
including the `analyze` stage's grant-URL fetch at `index.ts:1167`, which today can silently ingest
a 403 page as the grant text and build the entire specification from it. **That second consequence
is not in the report and is arguably more serious than the crawler symptom.**

**D2 — one always-present classification.** Add `meta.outcome` to every `CrawlResult` return, from a
closed set:

`ok | bad_url | dns_unresolved | ssrf_blocked | http_4xx | http_5xx | offsite_redirect |
no_extractable_text | fetch_budget_exhausted | timeout | no_candidates_discovered`

plus `meta.status_codes: Record<url, number>` and `meta.sitemap: "ok"|"absent"|"error"`. The
distinction that matters commercially is **`http_4xx` (your site blocked our reader) vs
`no_extractable_text` (your site's text is drawn by JavaScript) vs `ok` with thin content** — the
first two are actionable by the customer, the current message is not.

**D3 — branch the customer-facing gap** at `index.ts:1264` on `meta.outcome`, so the "Before you
submit" page says which of the three happened, and asks the customer to paste text or upload a
document instead. Architecture is fixed — no headless-browser service — so for `no_extractable_text`
the correct behaviour is to record it precisely, tell the customer, and proceed with an empty ledger,
which the pipeline already handles honestly (`:1155`).

**D4 — close the identity-gate hole.** Change `:1288` from
`(webEvidence.length || profile.legal_name)` to "any site-derived output is non-empty":

```ts
if (domain && (webEvidence.length || Object.keys(profile).length || Object.keys(voiceGuide).length)) {
```

With `orgNameMatchesSite` already default-deny, a site that states no legal name and shares no
distinctive token with the applicant is then discarded rather than silently trusted — which is the
asymmetry the gate was designed around.

**D5 — record what was skipped.** Push a marker in `get()` at `:223` when `MAX_FETCHES` is hit
(case 8) and in the sitemap `catch` at `:238` (case 10), so a starved crawl is visible in `meta`.

### d.5 How this is tested

`crawlSite` and `orgNameMatchesSite` are pure given `fetch`, so these are fast, hermetic, and need
**no network** — a fixture table with a stubbed `globalThis.fetch`:

- **D-t1 (outcome table):** one fixture per row of §d.2 — 403 with a short `text/plain` body, 403
  with a long HTML wall, 200 React shell with an empty `<div id="root">`, 200 with sitemap + good
  prose, DNS failure, offsite redirect, `MAX_FETCHES` exhaustion, all-duplicate paragraphs across
  pages, query-string-only navigation. Assert a **distinct** `meta.outcome` for each and that `ok`
  is returned only by the good fixture. Every row except 1, 2 and 9 fails today.
- **D-t2 (the 403 regression):** the 77-byte `403 text/plain` fixture. Assert
  `outcome === "http_4xx"`, not `pages: []` with an empty `meta`. This is the reported bug, pinned.
- **D-t3 (grant-page contamination):** the `analyze` stage against a 403 grant URL. Assert it does
  **not** build a grant intelligence object from the error page.
- **D-t4 (identity-gate truth table):** the Beit Al-Shabab / Amel case (must reject); an exact match;
  a domain-token match; the §d.3 hole — `evidence: []`, `legal_name: null`, `mission` populated
  (must reject after D4, is accepted today); and an applicant name made entirely of generic words
  (must reject via `:449`).
- **D-t5 (customer copy):** assert `certificationsMd` renders a distinct, actionable sentence for
  `http_4xx`, `no_extractable_text` and `identity_mismatch`.

---

## Cross-cutting note

(a) and (c) compound: isolate death is routine, and the `strategy` stage has a six-round-trip window
between an irreversible database side effect and its commit. Fixing (a) reduces how often (c) fires
but cannot remove it — the claim must be made releasable regardless. And until (b) exists, every
occurrence of (a), (c) and (d) is invisible to both the customer and the operator, which is why (b)
should land first: it is the smallest change and it is what turns the other three from "unknown
unknowns in production" into measurable rates.
