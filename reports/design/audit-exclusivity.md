# Exclusivity ceiling audit — worker v26

Files audited (line numbers are from these exact files):

- `/home/user/ktebli/supabase/migrations/20260819194825_core_schema.sql` — the five locks
- `/home/user/ktebli/supabase/migrations/20260819194949_rls_and_claim_functions.sql` — `claim_approach`, `confirm_claim`, `release_claim`, `expire_stale_holds`
- `/home/user/ktebli/supabase/migrations/20260819195010_seed_pools_and_tests.sql` — pool inventory
- `/home/user/ktebli/supabase/migrations/20260820145739_orders_and_job_queue.sql` — queue, reaper, rollup
- `/home/user/ktebli/supabase/migrations/20260820145930_secrets_grants_and_cron.sql` — grants on the claim functions
- `/home/user/ktebli/supabase/functions/worker/index.ts` — strategy stage (1367–1467), check stage (1714–1756), dispatcher (1890–1929)
- `/home/user/ktebli/supabase/functions/stripe-webhook/index.ts` — organisation resolution (152–167)
- `/home/user/ktebli/supabase/functions/request-revision/index.ts` — revision stage injection (63–72)

No file in the repository was modified. This is a design/audit document only.

---

## 1. The five locks — four questions each

| # | Lock (index) | Value space | Max concurrent live claims per grant | Behaviour on collision today | Race-safe? Where arbitrated? |
|---|---|---|---|---|---|
| 1 | `claims_one_per_org` — `(grant_id, organisation_id) where status in ('hold','confirmed')`, core_schema.sql:92–94 | **Open** — one uuid per customer organisation. Unbounded as customers grow. | **= number of distinct organisations.** Not a volume ceiling *across* customers, but a hard ceiling of **1 live claim per org per grant**. | **Hard refuse, no retry.** `claim_approach` returns `blocked_by='existing_claim_same_org'` (rls_and_claim_functions.sql:105–108); worker treats it as terminal at index.ts:1428–1430 (`throw new Error("claim blocked: " + res.blocked_by)`), dispatcher marks the stage `held` at index.ts:1917–1919. `held` → `rollup_statuses` sets proposal `attention` (orders_and_job_queue.sql:133) → `sendEmail` is only reached in the deliver stage (index.ts:1877), so **no mail is ever sent**. | Yes. Arbitrated by the partial unique index inside the single `INSERT` at rls_and_claim_functions.sql:88–94; the `unique_violation` handler at :95 classifies after the fact. |
| 2 | `claims_concept_lock` — `(grant_id, intervention_type, delivery_method, beneficiary, geography_bucket) where status in ('hold','confirmed')`, core_schema.sql:97–99 | **Open** in the type system — four free `text` columns. In practice **quasi-finite**: the values are snake_case tokens invented by the strategy model (index.ts:1393, "short snake_case tokens (these are lock fields)") with no controlled vocabulary, so token clustering across customers is likely. | **Unbounded in principle.** In practice bounded by how many *distinct* tuples the strategy stage can produce: the prompt asks for exactly **4 candidates** (index.ts:1385), and only candidates surviving `feasibility >= 40` (index.ts:1413) and `distinctness !== "same"` (index.ts:1414) are attempted. | **Degrade then refuse.** On `blocked_by='concept_combination'` the worker abandons the *whole* candidate — `break` out of the opening loop at index.ts:1431–1435 and out of the template loop at :1437 — and moves to the next candidate. Exhausting all 4 candidates throws `strategy_space_exhausted` (index.ts:1454) → `held` → `attention` → no email. | Yes. Same INSERT, same index. Note the classification re-query at rls_and_claim_functions.sql:109–113 runs *after* the aborted subtransaction, so the reported blocker can be stale; harmless, but it is a report, not the arbiter. |
| 3 | `claims_template_lock` — `(grant_id, structural_template_id) where status in ('hold','confirmed')`, core_schema.sql:102–104 | **FINITE and enumerable.** `structural_templates` is seeded with exactly **8** rows, ids 1–8 (`smallint generated always as identity`, core_schema.sql:6; seed_pools_and_tests.sql:2–10). | **Exactly 8.** | **Silent skip, then refuse.** `usedT` (index.ts:1405) pre-skips known-taken ids; a live collision returns `blocked_by='structural_template'`, which matches **none** of the branches at index.ts:1428/1431, so the inner loop just tries the next opening with the same dead template — up to 8 wasted RPCs per blocked template, 64 per candidate, 256 per order, **with no `beat()` inside either loop** (last heartbeat is index.ts:1380). Final outcome is `strategy_space_exhausted` at :1454 → `held` → `attention` → no email. | Yes. Same INSERT/index. The worker's `usedT`/`usedO` snapshot is read at index.ts:1374 *before* a high-effort model call (index.ts:1382–1399), so it is stale by minutes; the DB is the only real arbiter, exactly as the comment at index.ts:1415 claims. |
| 4 | `claims_opening_lock` — `(grant_id, opening_device_id) where status in ('hold','confirmed')`, core_schema.sql:105–107 | **FINITE and enumerable.** `opening_devices` seeded with exactly **8** rows, ids 1–8 (core_schema.sql:13; seed_pools_and_tests.sql:12–20). | **Exactly 8.** | Same path as lock 3. `blocked_by='opening_device'` also matches no branch, so the loop advances to the next opening — this one is correct behaviour, unlike lock 3. | Yes. Same INSERT/index. |
| 5 | `claims_house_voice_lock` — `(grant_id, voice_profile_id) where status in ('hold','confirmed') **and voice_kind = 'house'**`, core_schema.sql:110–112 | **N/A — the predicate is never satisfied.** See §2. | **Unbounded. The lock permits infinitely many claims because it indexes zero rows.** | Never fires. Its `blocked_by` label is reachable only as the `else` catch-all at rls_and_claim_functions.sql:114 — i.e. any unique violation the four preceding tests fail to explain is *mislabelled* `house_voice`. | Vacuously. Nothing to arbitrate. |

---

## 2. The house-voice lock is dead code, and voice uniqueness is not enforced at all

The string `house` appears in **exactly four places in the entire repository**, all four in `20260819194825_core_schema.sql` (lines 37, 40, 86, 112). No edge function, no seed, no site file ever writes it.

What the worker actually does:

- index.ts:1370–1371 (strategy stage) — looks up the org's voice profile and, if absent, creates one:
  `ins("voice_profiles", { organisation_id: c.order.organisation_id, kind: "custom", profile: {} })`
- index.ts:1355 (voice stage) — the only other insert, also `kind: "custom"`.
- index.ts:1425 — **`p_voice_kind: "custom"`, hardcoded.** Every claim ever written carries `voice_kind='custom'`.

Consequences, in order of severity:

1. **`claims_house_voice_lock` has never matched a single row and never can.** `voice_profiles` has zero `kind='house'` rows (nothing seeds them, and `check ((kind='house') = (organisation_id is null))` at core_schema.sql:40 means a house row must have a null org, which no code path produces). Lock 5 is a ceiling on paper and a no-op in production.
2. **Even removing `and voice_kind = 'house'` would change nothing.** Voice profiles are per-organisation (one row, looked up by `organisation_id`, index.ts:1370), and lock 1 already permits one live claim per org per grant. An unconditional `(grant_id, voice_profile_id)` unique index is therefore *implied by* lock 1 and would still never fire.
3. **The `voice_profiles` row is a bookkeeping stub with no effect on output.** Generation never reads that table. `baseCtx()` composes voice from stage outputs only — `c.out["voice"].profile` and `org.voice_guide` (index.ts:1129, 1132, 1157). `claims.voice_profile_id` exists solely to satisfy the `not null` FK at core_schema.sql:85.
4. **So voice distinctness for normal customers is currently enforced by nothing.** Worse, index.ts:1157 wraps the whole voice clause in a conditional: an applicant with no uploaded past proposals and no usable website (or a website discarded by the identity gate at index.ts:1290–1305) contributes `voice?.profile = undefined` and `org?.voice_guide = {}`, so **the voice clause is omitted from the prompt entirely** and every such applicant on the grant is written in the generator's default register. The only thing standing between two such customers is the `check` stage's 25-word overlap gate (§4), which measures wording, not voice.

This is precisely the inverted failure the audit was asked to look for: **a documented ceiling of one house voice per grant, and zero actual voice uniqueness in production.**

---

## 3. The true ceiling per grant

**8 delivered proposals per grant is the theoretical maximum. The practical maximum is lower and monotonically decreasing, because slots are consumed permanently and never returned.**

Derivation:

- Every granted claim consumes exactly one `structural_template_id` **and** one `opening_device_id` (both `not null`, core_schema.sql:83–84).
- Both pools hold exactly 8 rows; both are unique per grant. After 8 live claims every template id is taken, so the outer loop at index.ts:1416 `continue`s all 8 iterations and no candidate can be reserved. The 9th order throws `strategy_space_exhausted` (index.ts:1454).
- The pools cannot be grown by data alone. **The worker hardcodes `tpl <= 8` and `op <= 8` (index.ts:1416, 1418) and never queries the tables for inventory or for `active`.** Inserting a 9th `structural_templates` row would be ignored by the worker; deactivating one (`active = false`) would be ignored too, since `active` is read nowhere in the codebase.

Why the practical ceiling is **below** 8:

- `confirm_claim` is called at index.ts:1456, milliseconds after the grant, so `hold_expires_at` (6 h default, core_schema.sql:88) never elapses and `expire_stale_holds` — which only touches `status='hold'` (rls_and_claim_functions.sql:74–80) — has nothing to do. It is called from exactly one place, inside `claim_approach` itself (:87); **no cron job calls it** (the only cron is the worker tick, secrets_grants_and_cron.sql:65–81).
- `release_claim` (rls_and_claim_functions.sql:145–153) is **granted to service_role (secrets_grants_and_cron.sql:38) and called by nothing.** `grep -rn release_claim supabase/functions/` returns zero hits.
- Therefore **a `confirmed` claim is immortal.** Every order that reaches the strategy stage and then dies anywhere downstream — the P0 #3 competitive/full non-completion, a validate failure, a similarity-gate hold, a refund — permanently burns one of the 8 template slots and one of the 8 opening slots on that grant, for the life of the grant row.
- Effective ceiling = `8 − (orders that reached strategy on this grant and never delivered)`.

Two additional silent-drop paths that are *not* the count of 8:

- **Orphaned hold.** If the isolate dies between the successful `claim_approach` (index.ts:1420) and `confirm_claim` (index.ts:1456), the claim is committed as `hold` but `order_proposals.claim_id` is never written (index.ts:1458). On retry the same org hits lock 1 → `existing_claim_same_org` → `throw` at index.ts:1429 → `held` (terminal, index.ts:1917) → no further retry. The 6-hour hold expiry would clear the row, but the stage was already marked terminal hours earlier. Permanently stuck, paid, never emailed. This is the mechanism behind report P1 #5.
- **Repeat customer on the same grant.** `stripe-webhook/index.ts:152–167` resolves the organisation by `registration_number` and **then by `email`**, so a returning customer reuses their existing `organisations.id`. A second order on the same grant therefore collides with lock 1 and is hard-refused by the same path. The customer pays $149–$449 and receives nothing.

---

## 4. Every other finite pool, fixed list, or degrading branch found

| Where | What | Behaviour at volume |
|---|---|---|
| index.ts:1416, 1418 | `tpl <= 8`, `op <= 8` hardcoded in the worker, independent of table contents | The pool size is a **code constant**, not data. Growing the tables is inert. |
| core_schema.sql:9, 16 | `structural_templates.active`, `opening_devices.active` | Columns exist; **read nowhere in the repo**. An operator cannot retire a template. |
| index.ts:1385 | Strategy prompt fixed at **4 candidates**; ranking filtered at index.ts:1402–1403 | With `feasibility < 40` (:1413) and `distinctness === "same"` (:1414) rejections, a crowded grant can exhaust all four before touching the template loop. As live claims on a grant grow, the `ALREADY-RESERVED APPROACHES` block (:1384) grows, pushing the model toward "same" verdicts — the candidate supply shrinks exactly when it is needed most. |
| index.ts:1714–1756 (`check`) | Similarity gate: longest shared word run capped at **25** (:1744, :1751), max **2** automated rewrites (:1744) | The **real soft ceiling.** Compares against every other completed narrative on the grant (:1716–1718), so cost and collision probability both scale O(N). Failure throws `similarity gate: …` → terminal `held` at index.ts:1917–1919 → `attention` → **no email**. This gate can drop a paying order well before slot 8. |
| index.ts:1431–1437 | Concept-collision handling abandons the entire candidate rather than trying a different concept tuple | Wastes candidate budget; a single unlucky tuple collision costs 25% of the order's chances. |
| index.ts:1428 vs the four `blocked_by` values | `structural_template` and `opening_device` match no branch | Lock-3 collisions burn up to 64 RPCs per candidate with **no heartbeat between index.ts:1380 and :1456**; the 3-minute reaper (orders_and_job_queue.sql:120) can kill the stage mid-scan. |
| rls_and_claim_functions.sql:114 | `else 'house_voice'` catch-all in the blocker classifier | Any unexplained unique violation is reported as a lock that cannot fire. Diagnostics on the P0 are actively misleading. |
| orders_and_job_queue.sql:50, index.ts:1917 | `max_attempts` default **3**; `claim_next_stage` requires `attempt < max_attempts` (:93) | Three tries then `failed` → `attention` → no email. |
| core_schema.sql:130 | `proposals.attempt_count smallint check (attempt_count <= 3)` | A hard CHECK, not a clamp: an increment to 4 raises rather than saturating. |
| orders_and_job_queue.sql:84, index.ts:1904, 1903/44 | Global running-stage cap **6**; `PARALLEL = 3` per isolate; `TIME_BUDGET_MS = 100_000` | Throughput ceiling: at most 6 stages in flight platform-wide, one tick per minute. Queue depth grows without any backpressure signal to the customer. |
| stripe-webhook/index.ts:54 | `REV_CAPS = { trial: 1, draft: 1, competitive: 3, full: 10 }` | Finite revision rounds; each revision re-runs `check` (request-revision/index.ts:68), so a revision can trip the similarity gate, consume the round, and end `held` with no email. |
| index.ts:349 | `KNOWN_FONTS` — 10 entries | Donor font requirements outside the list degrade silently. |
| index.ts:1051, 1529 | `"currency":"USD"` hardcoded in both budget prompts | Report P2 #10. Not a volume ceiling but a fixed enumeration of one. |
| index.ts:1193–1202 | Grant identity = `lower(title)` stripped to `[a-z0-9 ]` + exact `funder` match; `grants_dedupe_idx` (core_schema.sql:57) is **non-unique** | Cuts both ways. A title or issuer the model renders differently forks a new `grants` row and silently *resets* the 8-slot pool (masking the ceiling in testing); identical renderings merge orders onto one 8-slot pool. Nothing calls the `grant_merge_reviews` machinery (core_schema.sql:60–71) — `grep` finds no writer. |
| index.ts:1037, 1877 | `sendEmail` exists once, in the deliver stage | Every ceiling above terminates in `held`/`failed` → `attention` → **silence**. This is the amplifier that turns each ceiling into a silent drop. |

---

## 5. How any fix must be tested

Any remedy to the above must be verifiable without a human in the customer workflow and without creating orders in the production project (per the testing conventions in `CLAUDE.md`, and because `bench_cases` was dropped on 2026-08-23):

1. **Pure-SQL lock harness, no worker, no orders.** Against a scratch branch database, replay all 11 migrations, insert one synthetic `grants` row and N synthetic `organisations`, then call `claim_approach` N times in a loop with distinct concept tuples. Assert the exact N at which `granted` first turns false, and assert `blocked_by`. Today this must return `structural_template` at N = 9; a fix must move that number and must not change it to `house_voice` (which would mean the classifier fell through to the catch-all at rls_and_claim_functions.sql:114).
2. **Concurrency assertion.** Fire k parallel `claim_approach` calls on one grant with the *same* template id from k separate sessions; assert exactly one `granted: true` and k−1 `blocked_by='structural_template'`, and that `select count(*) from claims where grant_id = … and status in ('hold','confirmed')` equals the number granted. This is the only test that proves the index, not the worker's `usedT` snapshot, is arbitrating.
3. **Slot-reclamation assertion.** After granting a claim, mark its proposal failed by whatever the fix's reclamation path is, then re-run step 1 and assert the freed template id is re-issued. Today this test fails by construction: nothing calls `release_claim`.
4. **Dead-lock assertion (regression guard).** `select count(*) from claims where voice_kind = 'house'` must be asserted, with the expected value stated explicitly. If a fix introduces house voices, this test is what proves lock 5 started doing work; if it does not, the test documents that lock 5 is inert rather than leaving it to be rediscovered.
5. **Similarity-gate scaling.** Drive `longestCommonRun` directly (it is a pure function) over the fixture at `tests/regression/similarity-gate/` plus N synthetic narratives, and record the 25-run breach rate as a function of N. Word counts and run lengths must be computed deterministically in the harness, never asked of a model.
6. **Silent-drop detector.** A single query is the acceptance criterion for the whole P0: `orders` in `attention`, or `job_stages` in `held`/`failed`, where `completion_email_sent = false` and `created_at < now() - interval '1 hour'`. Any fix must drive this to zero and keep it there; it needs no human and no customer interaction to evaluate.

---

## 6. The number

**8.**

Eight is the ceiling only if every one of the eight orders that reach the strategy stage also delivers. Because `release_claim` is never called and `confirm_claim` fires at index.ts:1456 before a single word is written, each order that reaches strategy and then fails permanently destroys one of the eight slots. The ninth paying customer on a grant — and, given the reuse-by-email organisation lookup at stripe-webhook/index.ts:152–160, any *returning* customer on a grant they have already ordered against — is charged, marked `attention`, and never emailed.
