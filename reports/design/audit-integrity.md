# Audit: numeric integrity, cost accounting, currency, drift blindness

Design document only. No code in `supabase/functions/worker/index.ts` or any migration is modified by
this track. All line numbers refer to `/home/user/ktebli/supabase/functions/worker/index.ts` as it
stands (worker v26, 1929 lines), and to `/home/user/ktebli/supabase/migrations/*.sql`.

Stage sequence is defined outside the worker, in
`/home/user/ktebli/supabase/functions/stripe-webhook/index.ts:58-85` (`stagesFor(tier)`). This matters
throughout: **`gen:budget` only exists on `competitive` and `full`** (stripe-webhook:66-69). On the
`draft` tier there is no budget stage, so every budget-related check below is not merely weak, it is
absent.

---

## (a) ARITHMETIC

### a.1 Where numeric validation lives, and what it is

There is exactly **one** numeric validator in the worker: `consistencyFindings()` at
**index.ts:307-336**, with helpers `numbersNear()` at **292** and `scanNumbers()` at **293-300**.

It is *not* in the `check` stage. `check` (**index.ts:1713-1756**) is the cross-proposal similarity
gate — `longestCommonRun` against other proposals on the same grant, cap 25 words. It contains no
arithmetic whatsoever. `consistencyFindings` is called from the **`validate`** stage, once per
correction round, at **index.ts:1599**:

```ts
1599:      detFindings.push(...consistencyFindings(docs, dn, budget?.total_usd ?? null, evidenceNums));
```

Its canonical values are three scalars lifted off the design object at **index.ts:1571-1575**:

```ts
1571:    const dn: DesignNumbers = {
1572:      participants: (project.participants_total as number | null) ?? null,
1573:      duration_months: (project.duration_months as number | null) ?? null,
1574:      budget_total: (project.budget_envelope_usd as number | null) ?? null,
1575:    };
```

### a.2 What it actually verifies — exhaustively

Three tests. That is all.

**Test 1 — participants (index.ts:311-321).**
```ts
313:        const found = scanNumbers(md, /participants|beneficiaries|people (?:reached|served|trained)|individuals/);
314:        if (n < dn.participants * 0.05) continue;
315:        if (evidenceNums.has(n)) continue;
316:        if (n > dn.participants * 1.01 && !numbersNear(n, dn.participants)) {
```

**Test 2 — duration (index.ts:322-331).** `n > dn.duration_months && n <= 60`.

**Test 3 — budget envelope (index.ts:333-335).** `Math.abs(budgetTotal - dn.budget_total) / max(dn.budget_total,1) > 0.02`.

### a.3 What it does **not** verify

1. **It never sums anything.** There is no addition anywhere in `consistencyFindings`. Not across
   components, not across budget categories, not across cohorts, not across logframe rows. The
   function compares scanned integers against one scalar. Internal arithmetic is outside its universe.
2. **It is one-directional.** `n > dn.participants * 1.01` (**316**) and `n > dn.duration_months`
   (**326**). An **understatement is structurally invisible.** A design carrying
   `participants_total: 216` with a narrative headline of "200 beneficiaries" produces
   `200 > 216 * 1.01` → false → **PASS**. This is the exact shape of the delivered defect.
3. **`numbersNear` is dead code.** `numbersNear(a,b) { return a === b; }` (**292**). It is only ever
   reached from `n > dn.participants * 1.01`, which already guarantees `n !== dn.participants`, so
   `!numbersNear(...)` is always `true`. The name promises tolerance the function does not implement
   and the call site could not use.
4. **The unit regex is narrow enough to miss the components.** `/participants|beneficiaries|people (?:reached|served|trained)|individuals/` (**313**). "120 young people", "60 parents", "36 peer
   mentors", "4 cohorts of 30" all fail to match. The components that sum to 216 are literally not
   scanned. Even if they were, each is individually below the ceiling and would pass.
5. **The 5% floor discards small numbers wholesale** (**314**) — precisely the per-cohort figures a
   summation check would need.
6. **No currency amount in any document is ever scanned.** `scanNumbers` is called exactly twice
   (**313**, **323**), with a people regex and a months regex. Test 3 compares the *computed* budget
   line total against the design *envelope*. A narrative sentence reading "we request $450,000" while
   the budget totals $312,000 is never compared to anything.
7. **The document set is a hardcoded list of four** (**index.ts:1566**):
   `["concept_note","workplan","logframe","budget_justification"]` plus `narrative`. `risk_table`,
   `board_summary` and `cover_email` are generated (stripe-webhook:69,73-76) and never scanned.
8. **`indicators[].target` is typed `string`** in the design schema (**index.ts:1490**). Targets are
   free prose, so no numeric extraction or reconciliation of the logframe's target column is even
   possible.
9. **On the draft tier, Test 3 never runs** — no `gen:budget` stage, `budget?.total_usd` is
   `undefined` → `null` → the `budgetTotal !== null` guard at **333** short-circuits.
10. **The reviewer LLM cannot compensate**, because the design object it is shown is truncated
    mid-JSON: **index.ts:1633** `JSON.stringify(project).slice(0, 8000)`. `participants_total` and
    `indicators` sit late in the serialisation order (**index.ts:1487-1490**) and are routinely cut.

### a.4 THE CRUX — where numbers originate

**Numbers are stated once in a JSON blob, then re-invented independently by every generation call.
There is no derivation, no reference, and no identity.**

Proof, `baseCtx()` at **index.ts:1151-1160**, the single prompt prefix every generation stage uses:

```ts
1163:    (design ? `\n\nPROJECT DESIGN (the single source of truth — every number, activity, phase, indicator and cost in every document must derive from this):\n${JSON.stringify(design.project ?? design)}` : "") +
```

The design object is **pasted as prose into a prompt**. The words "single source of truth" are an
instruction to a language model, not a mechanism. Nothing downstream reads a field; every downstream
number is re-emitted by an independent sampling call.

The design object itself contains no composite structure. From **index.ts:1481-1491**:

* `"participants_total": number|null` — one scalar, no breakdown, no components (**1485**).
* `"outputs":[{"output":string,"from_activities":[number]}]` — `from_activities` is an index list,
  not a quantity (**1483**).
* `"indicators":[{... "baseline":string,"target":string ...}]` — strings (**1490**).
* `"budget_envelope_usd": number|null` — one scalar (**1487**).

So `participants_total` has **no components in the data model at all**. The 120 / 60 / 36 that sum to
216 exist only inside prose the model wrote at generation time. Nothing in the system can add them,
because nothing in the system knows they are addends.

The prompts ask for consistency and get it by luck:

* `GEN_SPECS.narrative` (**index.ts:1050**): *"…with the same numbers everywhere."*
* Budget brief (**index.ts:1526-1529**): *"FROM THE PROJECT DESIGN: activities → resources →
  quantities → unit costs."*
* Design rule (**index.ts:1493**): *"each numeric target must be producible by the listed activities."*

Every one is an instruction to a sampler.

Two further amplifiers:

* **Ordering.** `gen:narrative` runs *before* `gen:budget` (stripe-webhook:65,67). The narrative
  invents its cost language before any budget exists; the budget is then told to match a narrative it
  is shown truncated.
* **Truncation.** **index.ts:1516-1517**:
  ```ts
  1517:    const extra = priorNarrative ? `\n\nTHE PROPOSAL NARRATIVE (be consistent with it):\n${priorNarrative.slice(0, 12_000)}` : "";
  ```
  A 2,500-word narrative is ~15,000 characters. Every sibling document — concept note, budget,
  workplan, logframe — is asked to be consistent with a narrative whose final ~20% it cannot see.

**The one place a number IS derived rather than restated** is the budget total, **index.ts:1531-1532**:
```ts
1531:      const total = (lines: Array<{ qty?: number; unit_cost?: number }>) =>
1532:        Math.round(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0));
```
This is correct and is the pattern the rest of the system needs. It computes `qty × unit_cost` in
TypeScript and ignores any total the model asserted. It is the only such computation in 1,929 lines.

### a.5 Collateral finding: the customer is told this check happened

**index.ts:1068**, inside `reportMd()` — the Full-tier customer-facing review report:

```ts
1068:  md += `- **Numbers and consistency.** Participant figures, timelines and budget totals were reconciled across every document in your package.\n\n`;
```

Nothing reconciles anything across every document. Four document names are hardcoded, one scalar is
compared in one direction, no money is scanned in prose, and no sum is ever computed. This sentence
is a customer-facing accuracy problem independent of the arithmetic bug, and it should not survive
the fix in its current form.

### a.6 Minimum fix — a Numeric Register with deterministic resolution

Three parts, all inside the existing architecture. No new services, stages stay sequential.

**Part 1 — the design stage emits a register, not scalars.** Add to the design JSON schema
(alongside **index.ts:1481-1491**):

```json
"numeric_register":[
  {"id":"N1","label":"young people completing the 12-week programme","unit":"people","kind":"leaf","value":120,"basis":"4 cohorts x 30"},
  {"id":"N2","label":"parents in family workshops","unit":"people","kind":"leaf","value":60},
  {"id":"N3","label":"peer mentors trained","unit":"people","kind":"leaf","value":36},
  {"id":"N4","label":"total direct beneficiaries","unit":"people","kind":"sum","of":["N1","N2","N3"]},
  {"id":"M1","label":"project duration","unit":"months","kind":"leaf","value":18},
  {"id":"B1","label":"total requested","unit":"money","kind":"sum","of":["B2","B3","B4"]}
]
```

Rules: `kind ∈ {leaf, sum, product, rate}`; a non-leaf node **must not** carry a model-supplied
`value`; every number that will appear in any document must have an id. `participants_total`,
`duration_months`, `budget_envelope_usd` and each `indicators[].target` become
`{"register_ref":"N4"}` references rather than free scalars — `target` stops being `string`.

**Part 2 — `resolveRegister()`, a pure TypeScript function.** Topologically sorts the register,
computes every derived node, and **throws at the design stage** on: a cycle, a dangling ref, a unit
mismatch inside a `sum`, or a mixed-currency `sum`. The design stage already throws on structural
failure (**index.ts:1500-1502**) and on ceiling breach (**index.ts:1505-1507**), so the retry path
exists: the stage fails, `attempt` increments, the reaper/retry logic at **index.ts:1915-1922** re-runs
it up to 3 times. **This kills 200-vs-216 before a single word is written**, which is the right place
— an arithmetic error caught in the design object costs one cheap call to re-derive, whereas the same
error caught at validate costs a full narrative regeneration.

**Part 3 — register conformance replaces `consistencyFindings`.** In `validate`, for **every**
document (drop the hardcoded four at **index.ts:1566**; iterate all `gen:*` outputs carrying `.text`):

* Extract every `(number, trailing-unit-phrase)` pair with a widened unit lexicon — people/persons/
  participants/beneficiaries/youth/children/parents/households/staff/mentors/trainees/sessions/
  workshops/cohorts/months/weeks/years, plus every currency symbol and ISO code.
* Classify each: **matches a resolved register value** (exact for counts and money; the tolerance in
  `numbersNear` should either be implemented honestly with a stated epsilon or the function deleted) →
  OK; **in `evidenceNums`** (already built at **index.ts:1586-1592**) → OK; **year 1900-2100, ordinal,
  or a percentage that resolves against a register ratio** → OK; otherwise → finding.
* Severity: unmatched numbers carrying a people/money/months unit are **blocking**; everything else is
  a warning fed into the correction prompt at **index.ts:1668-1671** but not counted in `blocking`
  (**index.ts:1648**). This preserves the existing deadlock protection.
* Add the money scan that does not exist today: every currency figure in prose must equal a register
  money node, and the register's total money node must equal `total(lines)` from **index.ts:1531**.

The logic inverts. Today: *one scalar, one direction, contradiction only.* After: **every number in
every document must be traceable to a register id.** That is the difference between catching known
failures and catching arithmetic.

**Part 4 — prompt change (cheap, necessary).** `baseCtx()` at **index.ts:1163** should render the
*resolved* register as a labelled table with ids, and instruct: *state register values verbatim by
label; never compute a new total, subtotal, average or per-unit figure — if you need one, it is
missing from the register and you must not invent it.* Raise the sibling-document truncation at
**index.ts:1517** from 12,000 characters or, better, replace it with the register plus the narrative's
headings, which is what "be consistent with it" actually requires.

**Part 5 — correct **index.ts:1068** to describe what the register check actually does.

### a.7 How (a) is tested

Entirely offline, `deno test`, no production project, no orders.

1. **Unit fixtures for `resolveRegister()`** — golden cases: valid DAG; cycle; dangling ref; unit
   mismatch; a `sum` node carrying a contradicting model-supplied `value` (must throw); deep nesting.
2. **Regression fixture for the live failure.** Mirror the existing convention at
   `tests/regression/similarity-gate/`: add `tests/regression/numeric-register/200-vs-216/` holding
   the delivered narrative and its design object. Assert v26's `consistencyFindings` returns `[]`
   (documenting the miss) and the new conformance check returns a blocking finding naming N4.
3. **Mutation harness — the real test.** Take ~15 archived (design, documents) pairs that currently
   pass. Programmatically perturb exactly one number per run: ±1, ±8%, transpose two digits, swap a
   subtotal, understate a total by the sum of one component. Assert **100% of perturbations are
   flagged and 0% of unperturbed runs are.** A checker that cannot pass this is not a checker. The
   one-directional bug at **316**/**326** fails this harness immediately, which is the point.
4. **False-positive corpus.** Run conformance over ~15 unperturbed archived proposals and require
   zero blocking findings. This is what stops the widened unit lexicon from stranding real orders.
5. **Draft-tier guard.** Assert conformance still runs with no `gen:budget` stage present.

No human is in any of this. The mutation harness is the automatic acceptance gate.

---

## (b) COST ACCOUNTING

### b.1 The global and its readers

**index.ts:127-130**:
```ts
127: // Per-stage token accounting (observability; reset per runStage call)
128: const usage = { calls: 0, prompt_tokens: 0, completion_tokens: 0 };
129: function usageReset() { usage.calls = 0; usage.prompt_tokens = 0; usage.completion_tokens = 0; }
130: function usageSnap() { return { ...usage }; }
```

Written in `llmRaw`, **index.ts:151-153**:
```ts
151:  usage.calls++;
152:  usage.prompt_tokens += Number(j.usage?.prompt_tokens ?? 0);
153:  usage.completion_tokens += Number(j.usage?.completion_tokens ?? 0);
```

Reset at **index.ts:1123**, first statement of `runStage`:
```ts
1122: async function runStage(stage: { stage_id: number; proposal_id: string; key: string; attempt?: number }) {
1123:   usageReset();
```

Snapshotted into the persisted stage output at **1326, 1364, 1465, 1508, 1544, 1556, 1683, 1711, 1754, 1865**.

### b.2 How the contamination occurs

`PARALLEL = 3` (**index.ts:44**). The dispatcher, **index.ts:1902-1926**:
```ts
1903:    for (let i = 0; i < PARALLEL; i++) {
1904:      const got = await rpc("claim_next_stage", { p_global_cap: 6 });
...
1909:    await Promise.all(claims.map(async (st) => {
...
1913:        await runStage(st);
```

Up to three `runStage` calls run concurrently **in one isolate, sharing one `usage` object**. Every
`await` inside a stage — `ctx()` at **1125**, `beat()`, every `llmRaw` fetch — yields to the others.

Concrete interleaving, three stages A, B, C claimed in the same tick:

| t | event | `usage.calls` after |
|---|---|---|
| 0 | A: `usageReset()` (1123) | 0 |
| 1 | A awaits `ctx()` → yields | 0 |
| 2 | B: `usageReset()` (1123) — **zeroes the counter A is using** | 0 |
| 3 | B awaits `ctx()` → yields | 0 |
| 4 | C: `usageReset()` | 0 |
| 5 | A: 3 LLM calls (151-153) | 3 |
| 6 | B: 1 LLM call | 4 |
| 7 | A: `done({... usage: usageSnap()})` → **records 4 calls, 1 of them B's** | 4 |
| 8 | C: 2 LLM calls | 6 |
| 9 | B: `usageSnap()` → **records 6**, having made 1 | 6 |

The recorded value is **the running total of every call made by every stage in the isolate since
whichever stage most recently reset it**. It is monotonically wrong in both directions: a stage that
finishes late over-reports (it absorbs its neighbours' calls), and a stage whose neighbour started
mid-flight under-reports (its own earlier calls were zeroed away). It is not noise around a true
value — there is no true value in the record at all.

Second-order damage: `usageReset()` is called only in `runStage`, never in the dispatcher, so the
first stage of a tick also inherits whatever survived the previous loop iteration
(**index.ts:1901-1927** runs `while (Date.now() - start < TIME_BUDGET_MS)`).

The CLAUDE.md note is therefore an understatement — it is not that costs are "cross-contaminated"
and directionally useful; per-stage cost data in `job_stages.output.usage` should be treated as
**unusable and deleted**, not corrected retroactively.

### b.3 Minimum correct fix

**Primary: `AsyncLocalStorage`, ~8 lines, zero call-site changes.**

```ts
import { AsyncLocalStorage } from "node:async_hooks";
type Usage = { calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; generation_ids: string[] };
const USAGE = new AsyncLocalStorage<Usage>();
const newUsage = (): Usage => ({ calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, generation_ids: [] });
function usageSnap(): Usage { return { ...(USAGE.getStore() ?? newUsage()) }; }
```
* In `llmRaw` (**151-153**): `const u = USAGE.getStore(); if (u) { u.calls++; ... }`.
* In the dispatcher (**1913**): `await USAGE.run(newUsage(), () => runStage(st));`.
* Delete `usageReset()` (**129**) and its call at **1123**.

This is correct under arbitrary interleaving and arbitrary await depth, because the store is bound to
the async context, not to wall-clock ordering. `node:async_hooks` is available in the Supabase Edge
Runtime; **probe it at boot** and refuse to start rather than silently degrade.

**Fallback if `AsyncLocalStorage` is unavailable: thread the accumulator explicitly.** Add `u?: Usage`
to `LlmOpts` (**index.ts:134**), create `const u = newUsage()` at the top of `runStage`, and pass
`{ ...opts, u }` at every `llm`/`llmRaw`/`generateValidated` call site. `generateValidated`
(**index.ts:625**) and `visualQA` (**index.ts:961**) also need the parameter. Larger diff, same
correctness, no runtime dependency. Given this project's deploy discipline, the byte-diff cost of the
threaded version is real but bounded; `AsyncLocalStorage` is preferred precisely because it does not
touch 20 call sites.

**Independently: take the numbers from OpenRouter, not from arithmetic on token counts.** Add
`usage: { include: true }` to the request body (**index.ts:142-147**), then record `j.usage.cost` and
`j.id` per call. Storing `generation_ids[]` makes every stage's cost auditable against OpenRouter's
own activity export — that, not a local price table, is the authoritative source, and it survives
model and pricing changes.

**Also stamp what produced the work.** `GENERATOR_VERSION = "worker-v12"` at **index.ts:45** is stamped
onto every delivered narrative at **index.ts:1819** while the deployed worker is **v26**. The model
ids (`MODEL`, `MODEL_STRATEGY`, read at **index.ts:1894-1895**) are stamped nowhere. Cost analysis and
drift attribution both need `{worker_version, model, model_strategy}` on every stage row. This is a
two-line change with disproportionate value for section (d).

### b.4 How (b) is tested

`deno test`, no network, no production.

1. **Interleaving unit test.** Stub `llmRaw`'s fetch with a function that sleeps `random(0,50)ms` and
   returns a fixed usage payload. Run three concurrent tasks under the same dispatcher shape, making
   3, 1 and 7 calls respectively. Assert each snapshot returns exactly `{3}`, `{1}`, `{7}`.
   **This test fails against v26 and passes after the fix** — that is the acceptance criterion.
2. **Deterministic adversarial schedule.** Same test with hand-chosen sleeps reproducing the table in
   b.2 exactly, so the failure is reproducible rather than probabilistic.
3. **Depth test.** One task whose calls happen inside `generateValidated`'s three-attempt repair loop
   (**index.ts:625-673**) and inside `llm`'s continuation loop (**index.ts:156-167**), confirming the
   context survives nested awaits.
4. **Runtime probe test.** Assert the boot-time `AsyncLocalStorage` availability check throws loudly
   rather than falling through to a zeroed store.
5. **Reconciliation check (read-only, staging or the two existing $1 trial orders only).** Sum
   `generation_ids` cost across a proposal and compare against OpenRouter's activity export for the
   same window. Agreement to the cent, or the accounting is still wrong.

---

## (c) CURRENCY

### c.1 Every place currency is set or assumed

| # | Line | What |
|---|---|---|
| 1 | `index.ts:1051` | `GEN_SPECS.budget.brief` hardcodes `{"currency":"USD", ...}` |
| 2 | `index.ts:1529` | the brief actually used by the budget stage hardcodes `"currency":"USD"` again |
| 3 | `index.ts:1177` | analyze schema: `"funding_floor_usd":number\|null,"funding_ceiling_usd":number\|null` |
| 4 | `index.ts:1190` | analyze rule: *"funding floor/ceiling: numeric USD only when the text states amounts"* |
| 5 | `index.ts:1487` | design schema: `"budget_envelope_usd":number\|null` |
| 6 | `index.ts:1494` | design rule pins the envelope to the "donor ceiling", unit unexamined |
| 7 | `index.ts:1503-1507` | design ceiling guard compares `envelope > ceiling` as bare numbers |
| 8 | `index.ts:1533-1542` | budget cap: `Math.min(ceiling, envelope*1.05)`, and the reprompt string *"YOUR PREVIOUS BUDGET TOTALLED USD ${total(lines)}, above the allowed USD ..."* |
| 9 | `index.ts:1544` | persisted as `total_usd`, `ceiling_usd`, `envelope_usd` |
| 10 | `index.ts:334` | finding text: *"budget total USD ... differs from the design's budget envelope USD ..."* |
| 11 | `index.ts:1574` | `dn.budget_total` sourced from `budget_envelope_usd` |
| 12 | `index.ts:1789` | **the delivered spreadsheet**: `["Category","Item","Qty","Unit","Unit cost (USD)","Total (USD)"]` |
| 13 | — | `bj.currency` — the model **does** return it (per the brief at 1051/1529) and **nothing ever reads it**. Grep for `\.currency` returns no consumer. |
| 14 | `migrations/20260820145739_orders_and_job_queue.sql:8-27` | `orders` has **no country and no currency column**. `amount_usd` (line 17) is Ktebli's own price. |
| 15 | `migrations/20260821220921_org_identity_on_orders.sql` | adds only `org_reg`, `org_website` — still no country |
| 16 | `index.ts:1257` | org profile extracts `"geographic_focus":[string]` — a usable country signal, consumed only as an opaque blob inside `baseCtx()` (**1155**) |
| 17 | `index.ts:1180` | analyze extracts `"geography":string\|null` — likewise never read by any code path |
| 18 | `index.ts:1259` | voice guide extracts `"spelling":"British"\|"American"\|null` — same: extracted, never applied deterministically |

Front end (`/home/user/ktebli/index.html`, `/home/user/ktebli/order.html`): zero occurrences of
"country" or "currency". The information is never collected.

### c.2 What actually goes wrong

This is **not** an FX bug — no conversion is attempted anywhere, so no rate can be wrong. It is a
**labelling bug, and it is silent by construction.**

A UK charity applying to a UK funder for £250,000: `analyze` writes `250000` into
`funding_ceiling_usd` (**1177**); `design` writes `240000` into `budget_envelope_usd` (**1487**); the
budget model prices lines in pounds because the grant text is in pounds; `total(lines)` (**1531**)
compares unit-less integers against a unit-less cap and *passes*, because everything is consistently
unit-less. Then **index.ts:1789** stamps "Unit cost (USD) / Total (USD)" across a sterling budget and
ships it. Meanwhile the narrative writes whatever symbol the model chose, and `consistencyFindings`
never scans prose money at all (see a.3 item 6), so a `$`/`£` split *inside the same package* is
invisible.

Submitting a budget spreadsheet whose column headers name the wrong currency is disqualification-grade
on many donor forms. Nothing in v26 can detect it.

### c.3 Minimum fix — resolve once, carry as a field, never convert

**Resolve once, in `analyze`, deterministically.** Add to the analyze schema
`"currency":{"code":string|null,"basis":"donor_stated","evidence":string|null}` — the model's job is
only to report what the grant text states, with a quote, or `null`.

Then a pure TS `resolveCurrency(analysis, orgProfile, order)` applies a fixed precedence:
1. donor-stated code from the grant text (`basis: "donor_stated"`);
2. `orders.currency`, if the order form collected it;
3. ISO country → currency lookup from `orders.country`;
4. country inferred from `analysis.geography` (**1180**) or `org.profile.geographic_focus` (**1257**)
   via the same table (`basis: "inferred_geography"`);
5. `USD` (`basis: "fallback_usd"`), recorded explicitly as a fallback rather than as a fact.

**Schema additions (owned by the migrations track, not this one):** `orders.country text`,
`orders.currency text`. **Front end:** one country `<select>` on `order.html`. This is the only fully
reliable source and it costs the customer one click.

**Carry it, don't rename.** In-flight orders have stage outputs keyed `funding_ceiling_usd`,
`budget_envelope_usd`, `total_usd`. **Add** `currency`, `funding_ceiling_amount`,
`budget_envelope_amount`, `total_amount` and read new-then-old. Renaming would strand every order
mid-pipeline.

**Consume it everywhere in the table above:** the two budget briefs (**1051**, **1529**) take
`${cur.code}`; the xlsx header (**1789**) becomes `Unit cost (${cur.code})` / `Total (${cur.code})`;
the finding text (**334**) and the over-cap reprompt (**1539**) name the resolved code.

**Never convert.** A register (part a.6) carries one currency; `resolveRegister` rejects a `sum` whose
money members disagree. Mixing units is a design defect to be rejected, not an FX problem to be
solved. If the donor states EUR, everything is EUR end to end.

**Surface the fallback rather than blocking on it.** If `basis === "fallback_usd"` and the resolved
geography is non-US, emit a `validate` finding that flows into the existing customer-facing
"Before you submit" certifications document (assembled at **index.ts:1775-1779**). The customer sees
"we could not determine the currency from the guidelines and used USD — confirm before submitting" at
download time. **No human enters the pipeline**; the existing certifications channel already carries
exactly this class of item.

### c.4 How (c) is tested

1. **Table-driven unit tests for `resolveCurrency()`** — ~20 rows: DFID/FCDO in £; EC calls in €;
   US federal in $; UN agencies in $ regardless of applicant country; a Gulf donor stating AED; a
   grant stating no amount at all; conflicting signals (UK applicant, USD-denominated donor → donor
   wins). Each asserts `{code, basis}`.
2. **Golden render test.** Build `Budget.xlsx` from a fixture with `code = "GBP"` and assert the
   header cells read `Unit cost (GBP)` / `Total (GBP)`, and that the same fixture under `USD` reads
   `USD`. Pure `XLSX` round-trip, no network.
3. **Mixed-currency rejection.** A register with a GBP total summing USD members must throw in
   `resolveRegister`.
4. **A grep test that mechanically prevents the regression.** Assert the worker source contains no
   literal `USD` outside the ISO currency table and the Ktebli price constants. Any future hardcode
   fails CI. This is the cheapest and most durable of the four.
5. **Fallback-disclosure test.** Assert a non-US geography with `basis:"fallback_usd"` produces the
   certifications line and does **not** block the stage.

---

## (d) DRIFT BLINDNESS

### d.1 Every signal the system currently records that plausibly correlates with quality

All live in `job_stages.output` (jsonb, `migrations/20260820145739_orders_and_job_queue.sql:54`) or in
`job_stages` columns.

| # | Signal | Where written |
|---|---|---|
| 1 | `attempt`, `error`, `status` | dispatcher, `index.ts:1915-1922`; schema lines 47-55 |
| 2 | stage duration (`started_at`/`finished_at`/`heartbeat_at`) | schema lines 51-53; `index.ts:1124` |
| 3 | `usage {calls, prompt_tokens, completion_tokens}` | `index.ts:128`, `1326`… — **corrupt, see (b)** |
| 4 | `validate.rounds[].{deterministic, grounding_problems, missing_mandatory, review_findings, blocking}` | `index.ts:1651-1654` |
| 5 | `validate.corrected` | `index.ts:1679` |
| 6 | `validate.claim_ledger` (40 rows, classifications) | `index.ts:1613`, persisted `1681` |
| 7 | `validate.coverage` (covered/partial/missing per requirement) | `index.ts:1637` |
| 8 | `validate.review_findings` (reviewer prose) | `index.ts:1638` |
| 9 | `validate.rubric_basis` | `index.ts:1682` |
| 10 | `check.longest_shared_run`, `auto_rewrites`, `compared` | `index.ts:1752-1754` |
| 11 | `package.qa.*` — `word_count`, `estimated_pages_metadata_only`, `visual_qa`, `visual_issues`, `content_validation` | `index.ts:1818-1833`, `1841-1842` |
| 12 | `package.identity_flags` | `index.ts:1865`, from `identityCheck` |
| 13 | `gen:budget.{total_usd, ceiling_usd, envelope_usd}` | `index.ts:1544` |
| 14 | `org.crawl {discovered, fetched, kept, chars, errors}`, `gaps`, `identity_mismatch` | `index.ts:1326` |
| 15 | `strategy.reserved_count_at_selection` | `index.ts:1465` |
| 16 | `design.logic_check.chain_holds` | `index.ts:1508` |
| 17 | `revise.grounding_corrections` | `index.ts:1711` |
| 18 | `revision_requests` rows — customer-initiated changes | `migrations/20260820172956…:12-18` |
| 19 | `orders.status = 'attention'` | schema line 22-23 |
| 20 | `events` table | written **only** by `stripe-webhook/index.ts:186`; the worker never writes it |

Discarded and worth noting: `generateValidated` (**index.ts:625-673**) discovers content violations on
attempts 1 and 2 and **throws them away** unless the third attempt also fails. Repair pressure — the
most sensitive leading indicator in the system — is not recorded anywhere.

### d.2 Would any of them have caught the current failure? No. Here is why, per signal.

The failure: two model families, blind, rated pipeline output no better than a single well-crafted
prompt; **8/8 judgements said "reads machine-generated"**. Every one of those proposals passed every
validator.

* **1, 2** — process signals. A proposal that is fluent, compliant and hollow completes normally, on
  time, first attempt. Zero correlation.
* **4, 5** — `blocking` (**index.ts:1648**) counts `groundingProblems + missingMandatory +
  detFindings` minus the jargon lines. Its deterministic half is a **16-phrase regex**
  (`JARGON_RE`, **index.ts:275**) plus the one-scalar arithmetic check dismantled in (a). A model
  writing smooth generic prose that avoids sixteen specific clichés produces `blocking = 0`, which is
  the loop's break condition at **index.ts:1650**. The metric is maximised by the failure mode.
* **6, 7, 8** — these come from the **same model family as the generator**. The reviewer call at
  **index.ts:1626-1635** uses `model: deep ? (MODEL_STRATEGY || MODEL) : MODEL`, and
  `MODEL_STRATEGY` **defaults to `MODEL`** (**index.ts:1895**). Unless the operator has set a
  distinct strategy model in Vault, *the generator grades its own work* — the exact thing
  CLAUDE.md's testing conventions forbid. A generator does not perceive its own register as
  machine-like; that is what "in-distribution" means.
* **10** — `longest_shared_run` measures overlap with *other Ktebli proposals*. Eight proposals that
  are uniformly machine-sounding but individually reworded score **well**. This is a distinctness
  metric, and the failure mode preserves distinctness. It would have reported green.
* **11** — layout only, and deliberately so: the visualQA prompt at **index.ts:966-968** instructs
  *"You must NOT assess, criticise, or report on the writing, argument, facts, tone, or content
  quality."* `word_count` measures length, not merit.
* **16** — `chain_holds` is asserted by the design call **in the same response that produced the
  design** (**index.ts:1476-1497**). Self-certification.
* **12, 13, 14, 15, 17** — identity, money, crawl yield, exclusivity accounting. Not quality.
* **3** — corrupt (b), and token counts would not distinguish good prose from bad in any case.
* **18, 19** — `revision_requests` is the one genuinely external signal in the list. **Nothing reads
  it.** No aggregate, no threshold, no alert. It is also post-hoc, sparse, and confounded (a customer
  who liked it may still request changes).
* **20** — the worker writes no events at all.

**The structural reason, stated plainly:** every recorded signal is either (i) produced by the same
model that produced the artefact, or (ii) a deterministic rule authored from a *known past* failure.
Category (i) cannot see its own distribution. Category (ii) can only catch what someone already
thought to encode. Neither can surface an unknown failure mode. The 8/8 verdict came from a
**different model family judging blind against a comparator** — and that comparison is the one thing
the pipeline never performs on itself. Adding more validators of either category cannot fix this;
CLAUDE.md P1 item 8 is right that validator-based monitoring is blind *by construction*.

### d.3 What WOULD catch it — automatic, no human reviewer

**A blind paired comparison against a single-prompt comparator, judged by a different model family,
aggregated into a rolling win-rate that can halt the queue.**

This fits the fixed architecture: models come from OpenRouter (a second family is a Vault secret, not
a new service), pg_cron already exists, Resend already exists, stages stay sequential.

**Step 1 — comparator.** Inside the existing `validate` stage (no new stage, no sequence change),
generate a baseline once per proposal: a **single** call with grant text + applicant + evidence ledger
+ "write the proposal", `maxTokens ≈ 4000`, using `MODEL`. This is exactly the comparator the blind
round used. Cost: one call.

**Step 2 — blind judge.** A third model, `MODEL_JUDGE`, read from Vault beside the other two
(**index.ts:1893-1895**), with a **boot-time assertion that its provider prefix differs from both
`MODEL` and `MODEL_STRATEGY`** — refuse to start otherwise. It is shown two unlabelled documents,
side A and B, with the side assignment derived from `sha256(proposal_id)` parity so it is
deterministic per proposal but not constant across the corpus. It is asked: (a) which is more likely
written by a professional grant writer *for this specific organisation*; (b) which reads more
machine-generated; (c) three concrete reasons. It is never told which came from the pipeline.

**Step 3 — record, do not block.** Write `{verdict: win|loss|tie, reasons[], judge_model,
position: A|B}` into the validate output. **A single LLM judgement must not gate a paid order** — it
is too noisy, and blocking on it would strand customers exactly the way the P0-2 ceiling does.

**Step 4 — gate on the rate.** A pg_cron job computes a rolling win-rate over the last N = 30
delivered proposals. When the **Wilson 95% lower bound falls below 0.50** — i.e. the pipeline is
measurably *not* beating a single prompt — it sets a `quality_hold` flag. That flag makes
`claim_next_stage` refuse to claim new `gen:*` work, queues incoming orders, emails the operator via
the existing Resend path (`sendEmail`, **index.ts:1037**), and the order page tells waiting customers
their order is held. Customers are never asked to judge anything.

Why the **rate** and not the instance: the observed failure was **8/8** — a systematic distribution
shift, not one weak document. A rolling rate detects that shape precisely and is robust to judge
noise, whereas per-proposal gating trades a quality problem for an availability problem.

Cost control: run the comparator on a deterministic 1-in-K sample (`hash(proposal_id) % K === 0`).
K = 1 at launch volume; raise K as volume grows. Two extra calls on a $149 order is affordable; the
alternative is shipping blind.

**Two cheaper complements, both nearly free:**

* **Revealed preference (signal 18, already collected, never read).** Rolling revision rate,
  time-to-first-revision, and the distribution of `revision_requests.options[]`. A rising share of
  tone/rewrite options is a real quality signal that costs zero model calls. Wire it into the same
  cron rollup.
* **Repair pressure (currently discarded).** Persist `{attempts, violations_by_attempt}` from
  `generateValidated` (**index.ts:625-673**) and the existing `validate.rounds` (**1651**). A drifting
  model needs more repair rounds *before* the drift is visible in output quality. Not ground truth —
  a tripwire, and a leading one.

**Prerequisite for all three: attribution.** Fix `GENERATOR_VERSION = "worker-v12"` at
**index.ts:45** (the worker is v26) and stamp `{worker_version, model, model_strategy, model_judge}`
on every stage row. Without it a win-rate drop cannot be attributed to a deploy, a model version
change, or a shift in incoming grant mix — and the monitor tells you something broke without telling
you what.

### d.4 How (d) is tested

The gate is a measurement instrument, so it must itself be calibrated before it is trusted.

1. **Judge calibration against known labels.** Assemble ~20 (grant, applicant, narrative) triples:
   10 pipeline outputs the blind round already rated, 10 single-prompt comparators. Run the judge
   harness and require agreement with the recorded blind verdicts above a stated threshold. A judge
   that cannot reproduce the finding that motivated it is not fit to gate on.
2. **Position-bias test — mandatory.** Re-run every pair with A and B swapped. If the judge picks
   position A more than 60% of the time, it is unusable and CI fails. This is the single most common
   way an LLM-judge gate silently becomes a coin flip.
3. **Family-independence assertion.** Unit test the boot check: `MODEL_JUDGE` sharing a provider
   prefix with `MODEL` or `MODEL_STRATEGY` must throw.
4. **Synthetic drift test.** Feed the rolling-window calculator a stream of verdicts that flips from
   70% win to 20% win at index 40, and assert `quality_hold` trips within a bounded number of
   deliveries — and, in the other direction, that a stream held at 65% never trips. False-alarm rate
   matters as much as sensitivity: a monitor that cries wolf gets disabled.
5. **Wilson-bound unit tests** at N = 5, 30, 100 against hand-computed values.
6. **Hold-path integration test on a staging project only** (never `uocauqflcqefgdixbzpf`): set
   `quality_hold`, assert `claim_next_stage` returns no `gen:*` rows, assert the operator email fires
   once and not per tick, assert already-running stages finish rather than being orphaned.
7. **Word counts stay deterministic.** Per CLAUDE.md's own convention — two critics wrongly failed a
   596-word document against a 600-word limit — the judge is never asked to count anything. Anything
   countable is counted by `wordCount()` (**index.ts:555**) and handed to the judge as a fact.

No human sits in the customer workflow at any point: the comparator, the judge, the rollup, the hold
and the operator email are all automatic. A human is notified only when the system halts itself.

---

## Summary of minimum fixes

| § | Defect | Minimum fix | Primary test |
|---|---|---|---|
| a | numbers re-invented per section; checker sums nothing, checks one scalar in one direction (`index.ts:307-336`, `1163`) | Numeric Register in the design object + `resolveRegister()` rejecting bad arithmetic at design time + register-conformance scan replacing `consistencyFindings` | mutation harness: 100% of single-number perturbations flagged, 0% false positives |
| b | module-global `usage` shared by 3 concurrent stages (`128`, `151-153`, `1123`, `1909`) | `AsyncLocalStorage` store bound per `runStage` (threaded accumulator as fallback) + OpenRouter `usage.include` and `generation_ids` | 3-way concurrent test asserting exact per-stage counts; fails on v26, passes after |
| c | USD hardcoded in 12 places; `bj.currency` never read; no country collected | `resolveCurrency()` once in analyze, carried as an added field, consumed everywhere; never convert; fallback disclosed via certifications | table-driven resolution tests + xlsx golden header + CI grep banning literal `USD` |
| d | every quality signal is self-graded or rule-based, so unknown failure modes are invisible | blind paired comparison vs a single-prompt baseline, judged by a different model family, aggregated into a Wilson-bounded rolling win-rate that sets `quality_hold` | judge calibration against the recorded blind verdicts + position-bias < 10% + synthetic drift trip test |
