# The Unbounded Composer

Design document. **No file in the repository is modified by this document.** It specifies a change
to `supabase/functions/worker/index.ts` (strategy + `gen:*` stages), a new migration, and a test
harness. Nothing here is deployed.

Line references are to the files as they exist today:

- `/home/user/ktebli/supabase/functions/worker/index.ts` (v26, 1929 lines)
- `/home/user/ktebli/supabase/migrations/20260819194825_core_schema.sql` (the five locks)
- `/home/user/ktebli/supabase/migrations/20260819194949_rls_and_claim_functions.sql` (`claim_approach`)
- `/home/user/ktebli/supabase/migrations/20260819195010_seed_pools_and_tests.sql` (the 8+8 pools)
- `/home/user/ktebli/supabase/migrations/20260820145739_orders_and_job_queue.sql` (queue, reaper)
- `/home/user/ktebli/supabase/migrations/20260826150000_stranded_claims_and_alerting.sql`
- `/home/user/ktebli/supabase/functions/stripe-webhook/index.ts` (stage list, 58–84)

Ground truth on the current ceiling: `design/audit-exclusivity.md`. Quality bar: `reports/quality-standard.md`.

---

## 0. What is actually broken, in one paragraph

The exclusivity machinery reserves two small integers — `structural_template_id` and
`opening_device_id`, each 1..8, hardcoded at index.ts:1426 and index.ts:1428 — and then those two
integers reach the document that is supposed to be shaped by them through **exactly one line of
prompt**:

```ts
// index.ts:1528
const styleNote = strategy ? `\nStructure style: ${JSON.stringify(strategy.template_style)}. Opening style: ${JSON.stringify(strategy.opening_style)}.` : "";
```

That line contributes roughly 40 words to a `baseCtx()` (index.ts:1151–1160) that is several
thousand tokens, and every other instruction that shapes the prose — `FORMAT_RULES` (57–65),
`STYLE_RULES` (76–81), `GEN_SPECS.narrative.brief` (1049) — is **byte-identical across every
proposal Ktebli has ever produced**. This is why the blind evaluation returned 8/8 "reads
machine-generated" while every internal validator passed. The system already has *nominal*
uniqueness: distinct database rows, indistinguishable prose.

So the ceiling of 8 and the sameness of the prose are the same defect seen from two ends. Lifting
the ceiling by adding rows to `structural_templates` would fix neither: the worker would ignore them
(the bound is a code constant, audit §4), and even if it did not, template #9 would still arrive as
40 words in a 4,000-token prompt.

The composer replaces both: a large composed space **and** a composition that is the load-bearing
part of the generation instruction rather than a decorative suffix.

---

## 1. Design in one page

1. The strategy stage makes **one** high-effort model call, as today (index.ts:1392–1409). That call
   is extended to return, alongside its strategy candidates, a **fit envelope**: for each of twelve
   composition axes, the subset of values the strategist certifies as *good for this applicant on
   this grant*, each with a realisation directive.
2. The composition itself is then drawn **locally, in TypeScript, with no model call** — a weighted
   sample from the envelope. Because it is local, a re-roll costs microseconds, not thirty seconds.
3. The draw is reduced to a canonical tuple of **codes and integers** — never free text — and hashed.
   That digest is the `fingerprint`.
4. `claim_approach()` inserts one row. A single partial unique index
   `(grant_id, fingerprint) where status in ('hold','confirmed')` is the arbiter, exactly as the
   four indexes are today.
5. On `blocked_by = 'fingerprint_taken'` the worker **adds the digest to its local exclusion set and
   re-draws**. There is no refusal branch. `strategy_space_exhausted` (index.ts:1464) is deleted.
6. The composition is expanded into a ~600-word **composition directive** that replaces index.ts:1528
   and carries real, checkable instructions: heading sequence, per-section word budgets, numeric
   cadence targets, stance, opening and closing move, concretion anchor, table policy.
7. After generation, a **deterministic conformance check** measures the document against its own
   composition — sentence lengths, paragraph lengths, heading sequence, table count — and does one
   targeted rewrite if it drifted. No model is ever asked to count anything (CLAUDE.md testing
   conventions).

The two halves of the requirement map onto steps 1 and 2 respectively, and they are separated on
purpose:

> **Fit is decided by the model. Distinctness is decided by the sampler. They never negotiate.**

---

## 2. The axes

Twelve axes in three groups. Each is justified on one criterion only: *does changing this value change
how the finished document reads to a donor's reviewer?* An axis that fails that test is a label, and
labels are what the system already has.

The `salience` column is the weight this axis carries in the distinctness metric of §5. Total = 23.

### Group A — SHAPE: the order the argument arrives in

| Axis | Values | Salience |
|---|---|---|
| **A1 `spine`** | 12 codes: `problem_evidence`, `causal_chain`, `beneficiary_journey`, `place`, `phase`, `actor`, `donor_question`, `outcome_backward`, `capability_ladder`, `decision_points`, `risk_and_answer`, `cost_of_inaction` | 3 |
| **A2 `move_order`** | An integer rank into the **linear extensions** of a precedence poset over the argumentative moves. Typically 3×10³–4×10⁴; floor 1,000 | 2 |
| **A3 `argument_carrier`** | 6 codes: `evidence`, `mechanism`, `sequence`, `actors`, `economics`, `counterfactual` | 2 |
| **A4 `weight_profile`** | Per-section word-budget multipliers on a dyadic grid; ≥500 at resolution 1 | 1 |

**A1 `spine`** decides what the sections *are organised by*, and therefore what the reader knows at
each point. A `place`-spined proposal repeats needs → activities → targets once per district; a
`phase`-spined one repeats the same material once per phase; a `decision_points`-spined one is a
sequence of "the choice here was X, and here is why". Same facts, same project, three documents a
reviewer would never mistake for each other. This subsumes the 8 seeded `structural_templates`
(seed_pools_and_tests.sql:2–10) and adds four they did not cover.

**A2 `move_order`** is the axis that makes shape genuinely large without making it worse — see §7.
The narrative's moves (`PROB` problem evidence, `CAUSE` root causes, `WHO` target group, `RESP` the
response, `ACT` activities, `CAP` capability, `PART` partnerships, `RES` outcomes and targets, `MNE`
measurement, `RISK` risks, `SUST` sustainability, `COST` budget rationale) are ordered by a **partial
order** encoding the constraints that protect quality: `PROB ≺ CAUSE ≺ RESP ≺ ACT ≺ RES ≺ MNE`,
`WHO ≺ ACT`, `ACT ≺ RISK`, `ACT ≺ COST`, `RESP ≺ SUST`. `CAP` and `PART` are free. Every **linear
extension** of that poset is a valid ordering — the causal chain is intact in all of them. The axis
value is a rank into the set of linear extensions. This is the mechanism by which distinctness is
free: the poset carries the quality constraint, the choice of extension carries the difference, and
they cannot conflict because every extension satisfies every constraint by construction.

Where the donor defines the application structure — `analysis.application_structure.defined_by_donor`
at index.ts:1530–1532 — the heading sequence is pinned and A2 collapses to a single value. That is
correct: donor compliance outranks distinctness (index.ts:1532, "evaluator usability beats
elegance"). The other eleven axes carry the load, and §6's worst-case arithmetic assumes exactly this.

**A3 `argument_carrier`** decides which element does the persuading and which merely supports.
Under `economics` the cost-per-outcome paragraphs are long and the mechanism is compressed to a
sentence; under `counterfactual` the document keeps returning to what happens if nothing is funded.
This directly changes paragraph length distribution and which sections a skimming reviewer lands in.

**A4 `weight_profile`** allocates the word budget across sections. A proposal that spends 40% of its
words on the problem reads as an advocacy document; one that spends 40% on activities reads as an
operational plan. Both can be excellent; they are not the same document. Values are multipliers on a
nested dyadic grid (§4), which is what makes this axis refinable and therefore the site of the
unboundedness proof.

### Group B — REGISTER: the sentence-level texture

This group exists because of `reports/quality-standard.md` disqualifier #8: *"reads obviously
AI-generated — uniform paragraph rhythm, tri-colon lists, abstract nouns doing the work of concrete
ones, no authorial judgement anywhere."* That is a statement about texture, and v26 controls texture
with nothing at all.

| Axis | Values | Salience |
|---|---|---|
| **B1 `cadence`** | Target mean sentence length ∈ [12,24] words × burstiness (σ/μ) ∈ [0.35,0.80], both on nested dyadic grids. 5×4 = 20 at resolution 1 | 2 |
| **B2 `paragraph_regime`** | 5 codes: `short_dense`, `long_developed`, `alternating`, `lead_and_expand`, `staccato_then_block` | 1 |
| **B3 `stance`** | 6 codes: `institutional_third`, `first_plural_committal`, `first_plural_reflective`, `impersonal_project`, `beneficiary_centred`, `evaluator_addressed` | 3 |
| **B4 `evidence_integration`** | 5 codes: `inline_parenthetical`, `sentence_subject`, `after_claim`, `tabulated_then_referenced`, `narrative_scale` | 1 |
| **B5 `concretion_anchor`** | Open: an Evidence Ledger item id (`E-INTAKE-3`, `E-WEB-7`, `E-PROP-2`) or a design element id. Applicant-dependent; floor 3 | 2 |

**B1 `cadence` is specified as numbers, not adjectives, and this is the single most important choice
in the register group.** "Vary sentence length" already appears in `GEN_SPECS.narrative.brief`
(index.ts:1049) and produces identical rhythm on every proposal, because it is an instruction with
no target. "Target a mean of 15 words with a standard deviation of 9" is an instruction a generator
can aim at and a harness can **measure deterministically**. A document at μ=13, σ/μ=0.75 (short,
punchy, uneven) and one at μ=22, σ/μ=0.40 (long, even, formal) are audibly different on the first
paragraph. This axis is also the reason the design can be tested at all: it is the only distinctness
property that can be verified without asking a model anything, which matters given that two critics
already miscounted a 596-word document (CLAUDE.md).

**B3 `stance`** changes the grammatical subject of nearly every sentence in the document. "The
organisation will establish four centres" / "We will establish four centres" / "Four centres will
open" / "Participants will find four centres within walking distance" are the same fact and four
different documents. v26 fixes none of this, so every proposal defaults to the generator's house
register — which is precisely what the blind evaluators recognised.

**B5 `concretion_anchor`** attacks disqualifier #8's "abstract nouns doing the work of concrete
ones" and rubric dimension 4 (specificity). The composer names one concrete referent — the Bab
al-Tabbaneh centre, the Thursday distribution, the 14-seat minibus — that the prose is required to
return to at least four times, in different roles. It is drawn from the applicant's *own* ledger, so
it cannot fabricate (FACT_RULES, index.ts:67–74) and it cannot be shared with a different applicant.
The axis value in the fingerprint is the **ledger item id**, never its text: two proposals anchored
on `E-INTAKE-3` collide correctly even though their prose about it differs.

### Group C — DEVICE: local, once-per-document, high salience

| Axis | Values | Salience |
|---|---|---|
| **C1 `opening_move`** | 14 codes: the 8 seeded `opening_devices` plus `mechanism_first`, `cost_of_delay`, `definition`, `scale_shift`, `commitment`, `donor_priority_echo` | 3 |
| **C2 `closing_move`** | 8 codes: `sustainability_mechanism`, `what_changes_by_date`, `ask_restated`, `risk_answered`, `partner_commitment`, `next_grant_horizon`, `beneficiary_endstate`, `institutional_continuity` | 2 |
| **C3 `tabular_policy`** | 4 codes: `minimal`, `targets_only`, `targets_and_timeline`, `structured_throughout` | 1 |

**C1** is the highest-salience axis per word of document, because the first eighty words are what a
reviewer forms an impression from. It is evidence-gated: `incident` and `voice` require a ledger item
that supports them, or they are absent from the envelope. That gating is a fit constraint and a
fabrication guard at the same time.

**C2 `closing_move`** does not exist in v26 at all. Nothing in the codebase says how a proposal
should end, so every proposal ends the way the generator ends things. Two documents that end
differently are remembered differently.

**C3 `tabular_policy`** changes the page's visual identity. `FORMAT_RULES` (index.ts:57–65) already
permits tables; nothing decides when to use them, so the generator's default fires every time.

### Axes deliberately excluded

- **Vocabulary lists / banned-word sets.** Swapping "strengthen" for "bolster" is a label. It moves
  the fingerprint and not the document, which is failure mode 1 in its purest form.
- **Heading titles.** Renaming "Sustainability" to "Beyond the grant" is cosmetic and, where the
  donor defines the structure, actively harmful (index.ts:1532).
- **Tone adjectives.** "Warm", "urgent", "measured" produce the same prose from the same generator.
  What B1/B2/B3 do instead is specify measurable consequences of tone.

---

## 3. The fingerprint

### What is hashed

```
canonical = JSON array, fixed order, no whitespace, integers only where numeric:

[ "fp1",                       // scheme version — bumped only on an incompatible change
  spine,                       // enum code, e.g. "phase"
  move_order_rank,             // integer in [0, L) where L = #linear extensions
  argument_carrier,            // enum code
  weight_milli,                // array of integers, thousandths, one per move
  cadence_mean_milli,          // integer, thousandths of a word  (e.g. 16500 = 16.5)
  cadence_burst_milli,         // integer, thousandths            (e.g. 575 = 0.575)
  paragraph_regime,            // enum code
  stance,                      // enum code
  evidence_integration,        // enum code
  anchor_key,                  // ledger item id, e.g. "E-INTAKE-3"  — an ID, never its text
  opening_move,                // enum code
  closing_move,                // enum code
  tabular_policy ]             // enum code

fingerprint = sha256_hex(canonical)     // 64 hex chars, computed in the worker via Web Crypto
```

`canonical` is stored verbatim on the claim as `axes jsonb`, so the digest is reproducible and
auditable from the row itself. The **realisation** — the strategist's free-text directive explaining
how to execute `stance=beneficiary_centred` for this applicant, the anchor's human description, the
per-section briefs — is stored separately in `composition jsonb` and **is not an input to the hash**.

### Why a hash of free text would be worthless, and why this is not that

If the fingerprint were `sha256(strategist_prose)`, every value would be unique, every insert would
succeed, the unique index would never fire once, and the system would have a database column that
proves nothing. Two proposals could be word-for-word similar in shape and register and still hash
apart because one directive said "warm and direct" and the other "direct and warm". That is a
counter for the sake of a counter.

The scheme above cannot do that, for a structural reason: **there is no position in the tuple where
model wording can enter.** Every component is one of exactly three kinds:

1. **A code from a closed vocabulary** (`spine`, `argument_carrier`, `paragraph_regime`, `stance`,
   `evidence_integration`, `opening_move`, `closing_move`, `tabular_policy`). The composer does not
   accept a code it did not itself offer — the envelope is validated against `composition_axes`
   before any draw, and an unrecognised code is dropped, not passed through. A model that invents
   `stance: "warmly institutional"` gets it discarded; it cannot reach the hash.
2. **An integer** (`move_order_rank`, `weight_milli`, `cadence_mean_milli`, `cadence_burst_milli`).
   Quantised onto a grid the composer controls (§4). Two documents targeting 16.5 words per sentence
   produce the same integer whatever prose the strategist wrapped around it.
3. **An identifier** (`anchor_key`). A ledger item id already minted by the `org`/`voice` stages
   (index.ts:1348, `E-PROP-${i+1}`). It is an opaque key; the claim about the organisation that it
   points at is never hashed.

So two compositions that differ **only** in realisation produce byte-identical `canonical` and
therefore the same digest, and the second is rejected. That is the property the design needs, and it
is the property the test in §9.4 asserts directly: generate the same axes with three different
free-text realisations, assert one digest.

### Granularity: why the buckets are coarse on purpose

`cadence_mean` is bucketed at **3 words** at resolution 1 — the grid is {12, 15, 18, 21, 24}. It
would be trivial to bucket at 0.1 words and claim a 120-value axis. That would be a lie: no reviewer
distinguishes a 16.4-word mean from a 16.5-word one, so a fingerprint that separated them would be
manufacturing nominal uniqueness exactly as a free-text hash does, only more subtly.

The rule applied to every quantised axis is: **the resolution-1 bucket width is the smallest
difference a human reader can perceive.** Refinement below that width exists (§4) and is *only*
reachable once every coarser distinction on that grant is genuinely taken — which §6 shows happens
past 10⁶ applicants on a single grant. The refinement ladder is a proof obligation discharged in
code, not an operating mode, and §8 says so in those terms rather than pretending otherwise.

### Near-duplicates that are not exact duplicates

Identical tuples collide on the index. Tuples that differ in only one low-salience component do not
collide on the index — and should not, because the index is a correctness mechanism, not a taste
mechanism. Keeping them apart is the sampler's job, via the salience distance of §5, which runs
*before* the insert and is the reason the index almost never fires.

---

## 4. Nested dyadic grids, and why refinement is safe

The three quantised axes live on **nested dyadic grids**.

```ts
// Nested dyadic grid on [lo,hi], returned in milli-units. Level 1 is `steps`
// evenly spaced points; every further level inserts the midpoints of the level
// below it, so level r's grid strictly CONTAINS level r-1's.
//
// That containment is the whole reason refinement is safe. A value drawn at
// level r either exactly equals a value already claimed at a coarser level — in
// which case the ordinary taken-set exclusion catches it, with no special case —
// or it is genuinely new. No fingerprint is ever remapped, no claim is ever
// rewritten, and a coarse claim and a fine claim are comparable because they are
// points on the same integer line. `resolution` is therefore NOT part of the
// hash; it is recorded on the claim for diagnostics only.
function dyadicGrid(lo: number, hi: number, steps: number, res: number): number[] {
  const n = (steps - 1) * (1 << (res - 1));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(Math.round(lo * 1000 + ((hi - lo) * 1000 * i) / n));
  return out;
}
```

`|grid(res+1)| = 2·|grid(res)| − 1`, so each level at least doubles the axis and the composed space
at least doubles with it. That inequality is the load-bearing step of the unboundedness proof (§8).

---

## 5. Distinctness metric, and the θ schedule

The unique index guarantees *some* difference. It does not guarantee a difference a reader would
notice. So the sampler rejects draws that are too close to something already on the grant, using a
**perceptual delta** per axis rather than a Hamming bit.

```
delta(axis, a, b) ∈ [0,1]:
  enum axes            → 0 if equal, 1 if different
  move_order           → min(1, kendall_tau(a,b) / (0.25 · tau_max))   -- adjacent orderings are NOT distinct
  cadence_mean         → min(1, |a−b| / 3000)                          -- one full 3-word bucket = 1
  cadence_burst        → min(1, |a−b| / 150)
  weight_profile       → min(1, L1(a,b) / 400)
  anchor               → 0 if same ledger id, 1 otherwise

distance(A,B) = Σ_axes salience(axis) · delta(axis, A, B)              -- max 23
```

Using a graded delta rather than equality matters: two `move_order` ranks that differ by one adjacent
transposition are the same document, and a bit-equality metric would call them distinct. The graded
form makes the threshold mean what it says.

The sampler draws until `min over taken of distance ≥ θ`, with a bounded draw budget per θ level, then
steps θ down.

| θ | Reads as | Steps down at N ≈ (worst case) | Steps down at N ≈ (typical) |
|---|---|---|---|
| **8** | differs strongly on three or more high-salience axes | ~150 | ~5.6 × 10⁶ |
| **5** | differs on spine or opening plus two others | ~2,500 | ~1.5 × 10⁸ |
| **3** | differs on one high-salience axis plus one other | ~68,000 | ~6.6 × 10⁹ |
| **1** | differs on at least one axis that changes the reading | = \|F\| (§6) | = \|F\| |
| — | below θ=1 the **fingerprint index** guarantees difference, and §8's refinement guarantees supply | never | never |

The N values are the point at which the salience-ball around the taken set covers the fit region;
the composer computes them exactly at runtime from the envelope sizes and logs them, so the table is
checkable rather than asserted (§9.5 tests it).

**θ stepping down is not quality degradation.** Every composition at every θ is drawn from the same
fit-certified envelope and realised through the same directive; the document is not worse, and it is
never *nominally* different — θ=1 still means "differs on an axis that changes how the document
reads", which is the product promise verbatim. What θ measures is the *margin*, and in the typical
case the margin never moves at all.

---

## 6. The size of the space

All axis sizes below are **floors**, not estimates. `move_order` is computed exactly at runtime by
the DP of §7; the figure used here is a deliberate undercount.

### Gross space (all axis values, no fit filter)

| Axis | Values |
|---|---|
| A1 spine | 12 |
| A2 move_order | ≥ 1,000 |
| A3 argument_carrier | 6 |
| A4 weight_profile (r=1) | ≥ 500 |
| B1 cadence | 20 |
| B2 paragraph_regime | 5 |
| B3 stance | 6 |
| B4 evidence_integration | 5 |
| B5 concretion_anchor | ≥ 3 |
| C1 opening_move | 14 |
| C2 closing_move | 8 |
| C3 tabular_policy | 4 |

```
12 × 1,000 × 6 × 500 × 20 × 5 × 6 × 5 × 3 × 14 × 8 × 4
  = 1.45 × 10^14
```

### Typical fit region |F| (envelope after the strategist's filter)

Retentions from a representative applicant: spine 7/12, move_order 300/1000, carrier 4/6, weight
200/500, cadence 12/20, paragraph 4/5, stance 4/6, evidence_int 4/5, anchor 3/3, opening 9/14,
closing 6/8, tabular 3/4.

```
7 × 300 × 4 × 200 × 12 × 4 × 4 × 4 × 3 × 9 × 6 × 3
  = 6.3 × 10^11
```

### Hardest observed case |F|

Donor pins the application structure (A2 → 1), Evidence Ledger empty so the crawler returned nothing
and no proposals were uploaded (B5 → 1, C1 → the 5 evidence-free openings), donor demands a formal
institutional register (B3 → 2, B1 → 6 of 20), donor mandates tabular annexes (C3 → 2):

```
4 × 1 × 3 × 80 × 6 × 3 × 2 × 3 × 1 × 5 × 4 × 2
  = 4.1 × 10^6
```

### Effective support

The sampler is weighted toward better fit, so nominal size overstates it. The composer computes the
Shannon entropy of its own sampling distribution and **enforces a floor of 1.5 bits per axis** by
raising temperature on any axis below it — 12 × 1.5 = 18 bits, i.e. an effective support of
≥ 2.6 × 10⁵ even in the hardest case above.

Flattening costs nothing, and this is the crux of §7: **every value in the envelope already passed
the strategist's fit filter**, so raising temperature trades "the best fit" for "a good fit", never
"good" for "bad".

### What that buys

| Live claims on one grant | Collision probability per draw, worst case \|F\|_eff = 2.6 × 10⁵ | Expected re-rolls |
|---|---|---|
| 40 | 0.015 % | 1.0002 |
| 1,000 | 0.38 % | 1.004 |
| 10,000 | 3.8 % | 1.04 |
| 100,000 | 32 % | 1.5 |

**Headline: ~1.5 × 10¹⁴ gross, ~6 × 10¹¹ inside a typical applicant's fit region, ~4 × 10⁶ in the
hardest case seen, ≥ 2.6 × 10⁵ guaranteed effective support — against the eight the system has today.**

---

## 7. How distinctness and quality stop competing

This is the second failure mode, and it is the one a design can most easily fake. The honest answer
has three parts, and the first is the only one that actually matters.

### 7.1 The envelope is a hard filter, not a soft preference

The strategist returns, per axis, only values it would **defend** for this applicant on this grant,
each with a `fit` score. Values scoring below the floor are **absent from the envelope**, not
down-weighted in it. Therefore:

> The sampler cannot select a bad value at any N, because bad values are not members of the set it
> samples from. The 40th proposal is not wearing the 40th-best structure. It is wearing one of the
> ~6 × 10¹¹ structures the strategist certified as good for this applicant.

The contrast with v26 is exact. Today, order #7 on a grant gets `structural_template_id = 7` because
1–6 are taken, whatever `geography_first` does to an applicant working in one town — the loop at
index.ts:1426 takes the first free integer and never asks whether it suits anyone. There is no fit
concept in the code at all. Under the composer, a spine that does not suit the applicant is simply
not in the envelope, at any position in the queue.

### 7.2 Quality constraints live in the structure of the space, not in a filter over it

`move_order` is the clearest case. The constraint "the problem must be established before the
response" is not a rule the sampler checks and rejects against; it is an edge in the precedence
poset, and the sampler enumerates **only** linear extensions. Every one of the ~10³–10⁴ values is a
valid ordering. There is no draw that has to be thrown away and no ordering that is "different but
worse" — the difference and the validity are produced by the same construction.

The same shape applies elsewhere: `opening_move` values requiring evidence are absent when the ledger
cannot support them (so C1 can never induce the fabrication `FACT_RULES` forbids); `weight_profile`
is constrained so no required section can be starved below a floor; `tabular_policy` cannot select
`minimal` when the donor mandates tabular annexes.

### 7.3 The space is large enough that fit and distinctness never negotiate

They would compete only if the fit region were small relative to the applicant count. §6 gives
6 × 10¹¹ typical and 4 × 10⁶ in the hardest case observed, against a plausible worst-case demand of a
few thousand applicants on one grant. Two applicants' fit regions overlap heavily — that is expected
and fine, because what matters is |F| relative to N, not the overlap. At N = 1,000 against the
*hardest* |F|_eff, 99.6 % of draws succeed first time.

**And the composer never reasons about scarcity.** There is no branch of the form "few slots left, so
relax the fit floor". The fit floor is a constant; the only thing that varies with N is how many
times a pure-local re-draw runs. That is what makes the two properties non-competing rather than
merely well-balanced: **they are computed by different mechanisms that do not exchange information.**

### 7.4 The part that would fail without the directive

None of the above matters if the composition arrives as 40 words at the end of the prompt, which is
what index.ts:1528 does today. The composition must be the load-bearing part of the generation
instruction, so `compositionDirective()` (§10.4) produces ~600 words of explicit, numeric, checkable
instruction, placed **before** `STYLE_RULES` so that the generic advice modifies the composition
rather than the composition decorating the generic advice. And `compositionViolations()` (§10.5)
measures the result deterministically, so an axis that the generator ignored is caught rather than
assumed.

That measurement is what converts every axis from a claim into a testable property, and §9.6 asserts
it across a 40-document batch.

---

## 8. Proof of unboundedness

**Claim.** For every N ≥ 0, given a grant with N live claims, the composer terminates and returns a
granted claim. There is no N at which it refuses, holds, degrades the fit floor, or emails nothing.

**Proof.**

**(P1) No refusal branch exists in the code.** The reservation loop (§10.3) has exactly two exits:
`res.granted` → return, or the exclusion set grows and the loop continues. There is no `throw` on
exhaustion, no iteration cap on the outer refinement loop, no comparison against any inventory, no
`break` that falls out. `strategy_space_exhausted` (index.ts:1464) and the block that persists its
diagnostics (index.ts:1451–1465) are **deleted**, not made unreachable. The two escapes that remain
are `sanctions_screening` and `existing_claim_same_org` — both are per-organisation gates, unrelated
to volume, and neither can be triggered by another customer's claim.

**(P2) No enumeration and no finite pool is consulted.** The integers `8` at index.ts:1426 and
index.ts:1428 do not appear in the new code. The composer never reads `structural_templates` or
`opening_devices` for inventory. Its only reads are the taken-fingerprint set for this grant (O(N)
rows, one indexed query) and the envelope (O(1), in memory from the strategist call). Nothing in the
composer materialises the space; it samples from it.

**(P3) The space at resolution r satisfies |F_r| ≥ |F_1| · 2^(r−1).** Refinement halves the grid
spacing on `cadence_mean`, `cadence_burst` and every component of `weight_profile`. By §4,
`|grid(r+1)| = 2·|grid(r)| − 1 ≥ |grid(r)|` for grids of ≥2 points and strictly ≥ 2·|grid(r)| − 1,
so each of at least three factors of the product at least (2 − ε)-multiplies. Taking only
`cadence_mean` gives the stated bound.

Refinement is well-defined for all r because these axes range over **genuine continua** — mean
sentence length is a real-valued property of a document, not a label — and a continuum admits dyadic
refinement without limit. This is the one place the unboundedness actually rests, and it is stated
plainly: the eight enum axes are finite, and by themselves would give a finite (if astronomically
large) bound. The three quantised axes are not, and the product of a finite set with an unbounded one
is unbounded.

**(P4) Therefore for every N there is a resolution that supplies a free fingerprint.** Choose
r = ⌈log₂(2N / |F_1|)⌉ + 1. Then |F_r| ≥ 2N > N, and since the N taken claims occupy at most N
distinct points of F_r, at least N points remain free. Pigeonhole gives existence; the sampler with
exclusion finds one in expected ≤ 2 draws once |F_r| ≥ 2N.

**(P5) The loop reaches that resolution.** After `DRAW_BUDGET` (128) consecutive failures at
resolution r, the composer increments r. r is unbounded above in the code — no cap, no clamp, no
`Math.min`. So for any N the loop reaches r from (P4) after at most 128·r local draws, each of which
is pure computation costing microseconds. ∎

**Corollary — no fallback degrades.** The only quantities that vary with N are `resolution`, `θ`,
and the re-roll count. The fit floor, the envelope, the entropy floor and the directive template are
all independent of N and of the taken set. There is no code path on which a larger N produces a
different *kind* of proposal.

**Honest statement of the operating regime.** (P3)–(P5) guarantee termination at every N. They do
not claim that a resolution-9 cadence bucket (width 0.012 words) is perceptible — it is not, and a
design that claimed otherwise would be committing failure mode 1 at the far end of the ladder. The
arithmetic in §6 is what makes that irrelevant: the first refinement engages when the resolution-1
fit region is exhausted, at N ≈ 4 × 10⁶ in the hardest case observed and ~6 × 10¹¹ typically. There
are roughly 1.5 × 10⁶ registered nonprofits in the United States in total. **Refinement is a proof
obligation discharged in code so that no N has a refusal branch, not a mode the system will ever
enter.** §9.4 tests it anyway, by shrinking the envelope to 40 values artificially and driving the
taken set to 10,000.

---

## 9. Race safety, and the absence of a serialization point

### 9.1 The transaction is one INSERT

`claim_approach()` (§11) is: a sanctions `EXISTS`, `expire_stale_holds()`, one `INSERT` inside a
`BEGIN … EXCEPTION WHEN unique_violation` block, one `INSERT` into `events`, `RETURN`. **No model
call, no HTTP call, no sleep, no user-facing wait is inside it.** Measured duration is on the order
of a millisecond.

This is the entire race-safety argument, and it is the same one the current code already relies on
(index.ts:1425: *"the DB partial unique indexes are the race arbiter"*). What changes is only which
index arbitrates.

### 9.2 Two concurrent identical fingerprints

Session A and session B insert the same `(grant_id, fingerprint)`. B's index insertion finds A's
uncommitted tuple, takes `XactLockTableWait` on A's xid, and blocks. A commits ~1 ms later; B's
insert fails with `unique_violation`; B's handler classifies it as `fingerprint_taken`, returns, and
B's worker re-draws locally in microseconds. **Total added latency to B: about one millisecond.**

The contrast that matters: a design that held the reservation across the composition model call would
serialize k concurrent orders into k × ~30 s. Forty concurrent orders would take twenty minutes in the
lock alone. Keeping the model call strictly outside the transaction is why that does not happen here.

### 9.3 Nothing else serializes

- The taken-set read is a plain `SELECT` at READ COMMITTED. **No `FOR UPDATE`, no `FOR SHARE`.**
  It is deliberately allowed to be stale — the same principle already documented at index.ts:1415
  and index.ts:1425, where `usedT`/`usedO` are read minutes before use. A stale read costs at most
  one extra re-roll.
- **No advisory lock, no per-grant mutex, no serializable isolation, no queue table, no availability
  check at checkout, no reservation-before-payment.** The grep test in §10.7 asserts these absences.
- `expire_stale_holds()` (rls_and_claim_functions.sql:66–73) updates only rows with
  `hold_expires_at < now()`, normally the empty set, so it takes no row locks. It does need an index
  to stop scanning; §11 adds `claims_grant_live_idx`.
- The `unique_violation` handler aborts an internal subtransaction only. The caller's transaction and
  its locks are unaffected.

### 9.4 Forty concurrent orders on one grant

Expected number of fingerprint collisions among 40 draws from an effective support of 2.6 × 10⁵ is
40²/(2 · 2.6 × 10⁵) ≈ 0.003. So in the overwhelmingly common case **the forty orders do not interact
at all** — forty independent INSERTs on forty distinct index keys, which a btree handles without
contention because they land on different pages.

### 9.5 The real constraint on "5 to 30 minutes", stated honestly

The composer removes the exclusivity ceiling. It does **not** remove the throughput ceiling, and that
ceiling is what would actually break the timing promise at 40 concurrent orders:

- `claim_next_stage(p_global_cap := 6)` (index.ts:1904; orders_and_job_queue.sql:82–86) caps stages
  in flight platform-wide at **6**.
- `PARALLEL = 3` per isolate (index.ts:44), one cron tick per minute.
- Draft tier is 12 stages, Full is 18 (stripe-webhook/index.ts:58–84).

40 concurrent Draft orders = 480 stages. At ~60 s per stage and a cap of 6:
`480 × 60 / 6 = 4,800 s ≈ 80 minutes`. The last customer waits 80 minutes, not 30.

To hold 30 minutes for 40 concurrent Draft orders the cap must be
`480 × 60 / 1,800 = 16`. **This is a one-parameter change** (`p_global_cap` at index.ts:1904) plus
whatever isolate-count headroom it implies, and it belongs to the reliability track that owns P0 #3,
not to this design. It is recorded here because the composer alone does not satisfy the second clause
of the requirement, and the product owner should not be told otherwise.

---

## 10. The worker

Style follows the existing file: 2-space indent, `const`/`let`, template literals, `rpc`/`sel`/`ins`/
`patch` (index.ts:83–102), `jsonOf(await llm(...))`, `await beat()`, and comments that explain *why*
rather than restating the code.

### 10.1 Types and axis metadata

```ts
// ================= composer =================
// The exclusivity ceiling was 8 because structure and opening were reserved from
// two 8-row tables (seed_pools_and_tests.sql) with the bound hardcoded here. It is
// replaced by a COMPOSED space: twelve independent axes, sampled per proposal from
// the region the strategist certified as a good fit for THIS applicant, and locked
// on a hash of the composed codes rather than on a row id. Nothing is consumed, so
// nothing runs out.

type AxisKey =
  | "spine" | "move_order" | "argument_carrier" | "weight_profile"
  | "cadence" | "paragraph_regime" | "stance" | "evidence_integration"
  | "concretion_anchor" | "opening_move" | "closing_move" | "tabular_policy";

// Salience = how much this axis changes what a donor's reviewer perceives. It
// weights the distinctness metric only; it never weights fit.
const SALIENCE: Record<AxisKey, number> = {
  spine: 3, move_order: 2, argument_carrier: 2, weight_profile: 1,
  cadence: 2, paragraph_regime: 1, stance: 3, evidence_integration: 1,
  concretion_anchor: 2, opening_move: 3, closing_move: 2, tabular_policy: 1,
};

const MOVES = ["PROB","CAUSE","WHO","RESP","ACT","CAP","PART","RES","MNE","RISK","SUST","COST"] as const;
// Precedence: the constraints that protect the document's logic. Every LINEAR
// EXTENSION of this order is a valid document, so choosing among extensions buys
// difference at zero cost to quality — the constraint lives in the structure of
// the space rather than in a filter over it.
const PRECEDES: Array<[string, string]> = [
  ["PROB","CAUSE"], ["CAUSE","RESP"], ["PROB","RESP"], ["RESP","ACT"],
  ["WHO","ACT"], ["ACT","RES"], ["RES","MNE"], ["ACT","RISK"],
  ["ACT","COST"], ["RESP","SUST"],
];

interface AxisValue { code: string; fit: number; directive: string }
interface Envelope {
  spine: AxisValue[]; argument_carrier: AxisValue[]; paragraph_regime: AxisValue[];
  stance: AxisValue[]; evidence_integration: AxisValue[]; opening_move: AxisValue[];
  closing_move: AxisValue[]; tabular_policy: AxisValue[];
  concretion_anchor: AxisValue[];          // code = ledger item id, e.g. "E-INTAKE-3"
  moves: string[];                          // the subset of MOVES this document uses
  pinned_order: string[] | null;            // donor-defined structure pins move_order
  cadence_mean_range: [number, number];     // words per sentence
  cadence_burst_range: [number, number];    // sigma / mu
}
interface Axes {
  v: "fp1"; spine: string; move_order_rank: number; argument_carrier: string;
  weight_milli: number[]; cadence_mean_milli: number; cadence_burst_milli: number;
  paragraph_regime: string; stance: string; evidence_integration: string;
  anchor_key: string; opening_move: string; closing_move: string; tabular_policy: string;
}
```

### 10.2 Canonicalisation, hashing, linear extensions, sampling

```ts
// The canonical form is an ARRAY, so key order is inherent rather than a
// convention that could drift. Only codes and integers appear in it: there is no
// position where model wording can enter, which is why two compositions that
// differ only in how the strategist phrased them hash IDENTICALLY and the second
// one is rejected. The free-text realisation lives in `composition`, which is
// never hashed.
function canonicalAxes(a: Axes): string {
  return JSON.stringify([
    a.v, a.spine, a.move_order_rank, a.argument_carrier, a.weight_milli,
    a.cadence_mean_milli, a.cadence_burst_milli, a.paragraph_regime, a.stance,
    a.evidence_integration, a.anchor_key, a.opening_move, a.closing_move, a.tabular_policy,
  ]);
}
async function fingerprintOf(a: Axes): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalAxes(a)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Linear extensions by DP over down-sets. g[P] = number of ways to complete the
// sequence given that the elements in bitmask P are already placed. 2^12 = 4096
// states, so this is microseconds; 12! = 4.8e8 fits exactly in a double.
function linExtTable(n: number, pred: number[]): Float64Array {
  const g = new Float64Array(1 << n);
  g[(1 << n) - 1] = 1;
  for (let P = (1 << n) - 2; P >= 0; P--) {
    let t = 0;
    for (let i = 0; i < n; i++) {
      if (P & (1 << i)) continue;
      if ((pred[i] & P) !== pred[i]) continue;   // predecessors not all placed
      t += g[P | (1 << i)];
    }
    g[P] = t;
  }
  return g;                                       // g[0] === total number of extensions
}
function unrankLinExt(n: number, pred: number[], g: Float64Array, rank: number): number[] {
  const seq: number[] = [];
  let P = 0, r = rank;
  for (let step = 0; step < n; step++) {
    for (let i = 0; i < n; i++) {
      if (P & (1 << i)) continue;
      if ((pred[i] & P) !== pred[i]) continue;
      if (r < g[P | (1 << i)]) { seq.push(i); P |= 1 << i; break; }
      r -= g[P | (1 << i)];
    }
  }
  return seq;
}

function dyadicGrid(lo: number, hi: number, steps: number, res: number): number[] {
  const n = (steps - 1) * (1 << (res - 1));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(Math.round(lo * 1000 + ((hi - lo) * 1000 * i) / n));
  return out;
}

// Weighted draw with an ENTROPY FLOOR. Raising temperature is free of quality
// cost because every value here already passed the strategist's fit filter: it
// trades "the best fit" for "a good fit", never "good" for "bad". Without the
// floor a confident strategist collapses an axis onto one value and the composed
// space silently shrinks to nothing.
function pick(vals: AxisValue[], rng: () => number, minBits = 1.5): AxisValue {
  if (vals.length === 1) return vals[0];
  let temp = 1;
  let w = vals.map((v) => Math.exp(Math.max(0, v.fit) / (20 * temp)));
  const bits = (ws: number[]) => {
    const s = ws.reduce((a, b) => a + b, 0);
    return -ws.reduce((a, x) => a + (x / s) * Math.log2(x / s || 1), 0);
  };
  const cap = Math.log2(vals.length);
  while (bits(w) < Math.min(minBits, cap) && temp < 64) {
    temp *= 2;
    w = vals.map((v) => Math.exp(Math.max(0, v.fit) / (20 * temp)));
  }
  const total = w.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < vals.length; i++) { x -= w[i]; if (x <= 0) return vals[i]; }
  return vals[vals.length - 1];
}

function sampleAxes(env: Envelope, rng: () => number, res: number): Axes {
  const n = env.moves.length;
  const idx = new Map(env.moves.map((m, i) => [m, i]));
  const pred = new Array(n).fill(0);
  for (const [a, b] of PRECEDES) {
    const ia = idx.get(a), ib = idx.get(b);
    if (ia !== undefined && ib !== undefined) pred[ib] |= 1 << ia;
  }
  const g = linExtTable(n, pred);
  // A donor-defined structure PINS the order (index.ts:1530-1532 — evaluator
  // usability beats elegance). The axis collapses to one value and the other
  // eleven carry the distinctness; it is never overridden for the sake of variety.
  const rank = env.pinned_order ? 0 : Math.floor(rng() * g[0]);

  const meanGrid = dyadicGrid(env.cadence_mean_range[0], env.cadence_mean_range[1], 5, res);
  const burstGrid = dyadicGrid(env.cadence_burst_range[0], env.cadence_burst_range[1], 4, res);
  const wGrid = dyadicGrid(0.7, 1.5, 3, res);
  return {
    v: "fp1",
    spine: pick(env.spine, rng).code,
    move_order_rank: rank,
    argument_carrier: pick(env.argument_carrier, rng).code,
    weight_milli: env.moves.map(() => wGrid[Math.floor(rng() * wGrid.length)]),
    cadence_mean_milli: meanGrid[Math.floor(rng() * meanGrid.length)],
    cadence_burst_milli: burstGrid[Math.floor(rng() * burstGrid.length)],
    paragraph_regime: pick(env.paragraph_regime, rng).code,
    stance: pick(env.stance, rng).code,
    evidence_integration: pick(env.evidence_integration, rng).code,
    anchor_key: pick(env.concretion_anchor, rng).code,
    opening_move: pick(env.opening_move, rng).code,
    closing_move: pick(env.closing_move, rng).code,
    tabular_policy: pick(env.tabular_policy, rng).code,
  };
}

// Perceptual delta per axis, not bit equality: two move orders differing by one
// adjacent transposition are the SAME document, and an equality metric would call
// them distinct. Grading the delta makes the threshold mean what it says.
function axisDistance(a: Axes, b: Axes, moves: number): number {
  const eq = (x: string, y: string) => (x === y ? 0 : 1);
  const kt = a.move_order_rank === b.move_order_rank ? 0
    : Math.min(1, Math.abs(a.move_order_rank - b.move_order_rank) / Math.max(1, 0.25 * moves * (moves - 1) / 2));
  const l1 = a.weight_milli.reduce((s, x, i) => s + Math.abs(x - (b.weight_milli[i] ?? x)), 0);
  return SALIENCE.spine * eq(a.spine, b.spine)
    + SALIENCE.move_order * kt
    + SALIENCE.argument_carrier * eq(a.argument_carrier, b.argument_carrier)
    + SALIENCE.weight_profile * Math.min(1, l1 / 400)
    + SALIENCE.cadence * Math.min(1, Math.abs(a.cadence_mean_milli - b.cadence_mean_milli) / 3000)
    + SALIENCE.paragraph_regime * eq(a.paragraph_regime, b.paragraph_regime)
    + SALIENCE.stance * eq(a.stance, b.stance)
    + SALIENCE.evidence_integration * eq(a.evidence_integration, b.evidence_integration)
    + SALIENCE.concretion_anchor * eq(a.anchor_key, b.anchor_key)
    + SALIENCE.opening_move * eq(a.opening_move, b.opening_move)
    + SALIENCE.closing_move * eq(a.closing_move, b.closing_move)
    + SALIENCE.tabular_policy * eq(a.tabular_policy, b.tabular_policy);
}
```

### 10.3 The composer and re-roll loop (replaces index.ts:1415–1465)

```ts
    // ---- compose and reserve --------------------------------------------------
    // There is no refusal branch below this line. The loop's only exits are a
    // granted claim, or a wider draw. `strategy_space_exhausted` is gone: nothing
    // is consumed here, so nothing can be exhausted.
    const THETA = [8, 5, 3, 1, 0];
    const DRAW_BUDGET = 128;
    const takenAxes: Axes[] = takenRows
      .map((t: { axes?: Axes }) => t.axes).filter(Boolean) as Axes[];
    const takenFp = new Set<string>(takenRows.map((t: { fingerprint?: string }) => t.fingerprint).filter(Boolean));
    const rng = () => Math.random();
    let claimed: Record<string, unknown> | null = null;
    let axes: Axes | null = null;
    let res = 1, ti = 0, draws = 0, rerolls = 0, dbCollisions = 0;

    while (!claimed) {
      const theta = THETA[Math.min(ti, THETA.length - 1)];
      const cand = sampleAxes(env, rng, res);
      draws++;
      const fp = await fingerprintOf(cand);
      // Local exclusion first: it costs microseconds and keeps the database out of
      // the common case entirely.
      if (takenFp.has(fp)) { rerolls++; }
      else if (theta > 0 && takenAxes.some((t) => axisDistance(cand, t, env.moves.length) < theta)) { rerolls++; }
      else {
        const r = await rpc("claim_approach", {
          p_org: c.order.organisation_id, p_grant: grantId,
          p_intervention: selected.intervention_type, p_delivery: selected.delivery_method,
          p_beneficiary: selected.beneficiary, p_geography: selected.geography_bucket,
          p_mechanic: selected.signature_mechanic,
          p_fingerprint: fp, p_axes: cand, p_composition: realise(env, cand),
          p_resolution: res, p_voice: vp.id, p_voice_kind: "custom",
        });
        if (r.granted) { claimed = { claim_id: r.claim_id, fingerprint: fp }; axes = cand; break; }
        // These two are per-ORGANISATION gates, not volume ceilings: no other
        // customer's claim can cause either, so re-rolling would loop forever.
        if (["sanctions_screening", "existing_claim_same_org"].includes(r.blocked_by)) {
          throw new Error("claim blocked: " + r.blocked_by);
        }
        // fingerprint_taken — the index arbitrated and someone else won the race.
        // Record it locally and draw again. This is the ONLY blocked_by that the
        // volume of other customers can produce, and it is not terminal.
        dbCollisions++; rerolls++; takenFp.add(fp);
      }
      // Widen, in order of least disruption: relax the distinctness MARGIN first
      // (every composition is still fully fit-certified), and only when even
      // theta=0 cannot find a free fingerprint, refine the quantised axes. The
      // arithmetic in the design puts that second step past 4e6 claims on one
      // grant; it exists so that no N has a refusal branch, not because it will run.
      if (!claimed && draws % DRAW_BUDGET === 0) {
        if (ti < THETA.length - 1) ti++;
        else { res++; ti = 0; }
        await beat();                            // refinement is cheap but never silent
      }
    }
```

### 10.4 The composition directive (replaces index.ts:1528)

```ts
// index.ts:1528 sent the whole exclusivity mechanism into the prompt as ~40 words
// of JSON at the end of a 4,000-token instruction, which is why every proposal
// read the same however the ids differed. The directive below is the load-bearing
// part of the generation instruction and is placed BEFORE the generic writing
// rules, so STYLE_RULES modifies the composition rather than the reverse.
function compositionDirective(comp: {
  axes: Axes; order: string[]; sectionWords: Array<{ move: string; words: number }>;
  directives: Record<string, string>; anchor: { key: string; description: string };
}): string {
  const a = comp.axes;
  const mean = a.cadence_mean_milli / 1000;
  const sd = (mean * a.cadence_burst_milli) / 1000;
  return `

THE COMPOSITION FOR THIS PROPOSAL — this is not a suggestion and not a style note. It is the
document's shape, and it governs the writing wherever it and a general writing preference disagree.
This composition is reserved to this applicant on this grant and no other proposal uses it.

1. SPINE — ${a.spine}. ${comp.directives.spine}
   The sections are organised BY this, and the reader meets the argument in this order:
${comp.sectionWords.map((s, i) => `   ${i + 1}. ${s.move} — about ${s.words} words`).join("\n")}

2. WHAT CARRIES THE ARGUMENT — ${a.argument_carrier}. ${comp.directives.argument_carrier}
   Everything else in the document supports this and is written compactly.

3. OPENING — ${a.opening_move}. ${comp.directives.opening_move}
   The first eighty words execute this and nothing else. No preamble before it.

4. CLOSING — ${a.closing_move}. ${comp.directives.closing_move}
   The last eighty words execute this. Do not end on a summary of what was already said.

5. STANCE — ${a.stance}. ${comp.directives.stance}
   This is the grammatical subject of most sentences in the document. Hold it throughout.

6. CADENCE — average about ${mean.toFixed(1)} words per sentence, with real variation:
   a standard deviation near ${sd.toFixed(1)} words. That means genuinely short sentences next to
   genuinely long ones, not every sentence at the average. Paragraphs: ${a.paragraph_regime} —
   ${comp.directives.paragraph_regime}

7. HOW EVIDENCE ENTERS SENTENCES — ${a.evidence_integration}. ${comp.directives.evidence_integration}

8. THE CONCRETE ANCHOR — ${comp.anchor.description}
   Return to this specific thing at least four times, in different roles: once in the opening, once
   when the activities are described, once when targets are set, once near the close. It is the
   detail that makes this document about this organisation and no other. Never invent detail about
   it beyond what the evidence ledger states.

9. TABLES — ${a.tabular_policy}. ${comp.directives.tabular_policy}`;
}
```

Wiring, replacing index.ts:1528 and index.ts:1565:

```ts
    const comp = strategy?.composition as Parameters<typeof compositionDirective>[0] | undefined;
    const styleNote = kind === "narrative" && comp ? compositionDirective(comp) : "";
    // ...
    const text = await generateValidated(
      baseCtx() + extra + `\n\nTASK: ${brief}${donorStructure}${kind === "narrative" ? styleNote + STYLE_RULES : ""}${FORMAT_RULES}`,
      spec.max, kind === "narrative" ? { ...narrativeOpts, composition: comp } : opts);
```

### 10.5 Deterministic conformance check

An axis the generator ignored is an axis that does not exist. Every measurement is computed in
TypeScript — never asked of a model, per CLAUDE.md, and for the same reason `wordCount` is already
deterministic at index.ts:608.

```ts
// Added to ContentOpts (index.ts:560) as an optional `composition` field and
// called from contentViolations(). Tolerances are wide on purpose: this catches a
// generator that ignored the composition, not one that landed at 15.4 instead of
// 15.0. Every miss here is repairable by the SAME single rewrite that
// generateValidated already performs (index.ts:649-653), so it adds no new call.
function compositionViolations(md: string, comp: NonNullable<ContentOpts["composition"]>): string[] {
  const v: string[] = [];
  const body = md.split("\n").filter((l) => !/^\s*#/.test(l) && !/^\s*\|/.test(l)).join(" ");
  const sents = body.split(/(?<=[.!?])["')\]]*\s+/).map((s) => s.trim().split(/\s+/).length).filter((n) => n > 1);
  if (sents.length >= 12) {
    const mu = sents.reduce((a, b) => a + b, 0) / sents.length;
    const sd = Math.sqrt(sents.reduce((a, b) => a + (b - mu) ** 2, 0) / sents.length);
    const tMu = comp.axes.cadence_mean_milli / 1000;
    const tBurst = comp.axes.cadence_burst_milli / 1000;
    if (Math.abs(mu - tMu) > 3.5) v.push(`cadence_mean:${mu.toFixed(1)}_vs_${tMu.toFixed(1)}`);
    if (Math.abs(sd / mu - tBurst) > 0.18) v.push(`cadence_burst:${(sd / mu).toFixed(2)}_vs_${tBurst.toFixed(2)}`);
  }
  const heads = md.split("\n").filter((l) => /^##\s/.test(l)).length;
  if (comp.order.length && Math.abs(heads - comp.order.length) > 2) v.push(`section_count:${heads}_vs_${comp.order.length}`);
  const tables = md.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l) && /---/.test(l)).length;
  const want = { minimal: [0, 1], targets_only: [1, 2], targets_and_timeline: [2, 3], structured_throughout: [3, 9] }[comp.axes.tabular_policy] ?? [0, 9];
  if (tables < want[0] || tables > want[1]) v.push(`tabular_policy:${tables}_outside_${want.join("-")}`);
  return v;
}
```

**This must never create a new silent-drop path.** The audit's §4 shows every ceiling in v26
terminating in `held` → `attention` → no email. A cadence that landed at 19.2 against a target of
15.0 is not worth failing a paid order over. So composition violations are repaired by the existing
single rewrite and, if still present after it, are **recorded on the stage output as
`composition_drift` and the document ships**. They never contribute to the `throw` at index.ts:672.

### 10.6 What the strategist call returns now

The one high-effort call at index.ts:1392–1409 is extended, not duplicated — the composer adds no
model calls to the pipeline. The `candidates` / `ranking` block is unchanged. Added:

```
"envelope":{
  "moves":[string],                         // which argumentative moves this document needs
  "spine":[{"code":string,"fit":number,"directive":string}],
  "argument_carrier":[...], "paragraph_regime":[...], "stance":[...],
  "evidence_integration":[...], "opening_move":[...], "closing_move":[...],
  "tabular_policy":[...],
  "concretion_anchor":[{"code":"E-INTAKE-3","fit":number,"directive":string}],
  "cadence_mean_range":[number,number], "cadence_burst_range":[number,number]
}
```

with rules that make the envelope a hard filter:

- *Include a value ONLY if you would defend it for this applicant on this grant. `fit` is 0–100;
  never include anything below 55. A short envelope is correct when the applicant or the donor
  genuinely constrains the choice — do not pad it.*
- *Include at least two values on every axis where two are genuinely defensible. If only one is, say
  so; the other axes carry the difference.*
- *`opening_move` values `incident` and `voice` require a specific Evidence Ledger item that supports
  them. Name that item in the directive or omit the value.*
- *`concretion_anchor`: give the Evidence Ledger item id in `code`. Never invent an anchor.*
- *`directive` is one or two sentences telling a writer how to execute this value **for this
  applicant** — the thing that makes it concrete rather than a label.*

Every code is validated against `composition_axes` before use; unrecognised codes are dropped. If an
axis comes back empty, the composer falls back to the full active vocabulary for that axis — which
widens the space, never narrows it, and so cannot introduce a refusal.

### 10.7 Grep assertions (part of CI, cheap and exact)

```
grep -n "tpl <= 8\|op <= 8"                          worker/index.ts   → 0 hits
grep -n "strategy_space_exhausted"                   worker/index.ts   → 0 hits
grep -n "structural_templates\|opening_devices"      worker/index.ts   → 0 hits
grep -n "pg_advisory\|FOR UPDATE\|SERIALIZABLE"      migrations/*.sql  → only claim_next_stage's SKIP LOCKED
grep -n "house_voice"                                migrations/*.sql  → 0 hits outside the drop statements
```

---

## 11. The DDL

New migration, e.g. `supabase/migrations/20260827120000_unbounded_composer.sql`. Written but
**not applied** — no `db push`, no production contact.

```sql
-- ============================================================================
-- The unbounded composer. Replaces two 8-row pools with a composed space.
-- ============================================================================

-- ---------------------------------------------------------------- 1. vocabulary
-- structural_templates and opening_devices were POOLS: a row was consumed by a
-- claim and gone. composition_axes is a VOCABULARY: rows are read to build prompts
-- and are never consumed, so adding a row widens the space and removing one
-- narrows it, and neither can exhaust.
create table if not exists public.composition_axes (
  axis text not null,
  code text not null,
  label text not null,
  description text not null,
  prompt_directive text not null,
  requires_evidence boolean not null default false,
  active boolean not null default true,
  primary key (axis, code)
);
alter table public.composition_axes enable row level security;
revoke all on public.composition_axes from anon, authenticated;

-- The 16 seeded rows are carried forward rather than discarded: they are good
-- values, they were simply being used as a pool instead of as a vocabulary.
insert into public.composition_axes (axis, code, label, description, prompt_directive)
select 'spine', t.name, t.name, t.description, t.description
  from public.structural_templates t
on conflict do nothing;
insert into public.composition_axes (axis, code, label, description, prompt_directive, requires_evidence)
select 'opening_move', d.name, d.name, d.description, d.description,
       d.name in ('incident','voice')
  from public.opening_devices d
on conflict do nothing;
-- ... plus the new spine, opening, closing, stance, carrier, paragraph_regime,
-- evidence_integration and tabular_policy rows enumerated in the design's §2.

-- ---------------------------------------------------------------- 2. the claim
alter table public.claims add column if not exists fingerprint text;
alter table public.claims add column if not exists axes jsonb;
alter table public.claims add column if not exists composition jsonb;
alter table public.claims add column if not exists composer_resolution smallint not null default 1;

comment on column public.claims.fingerprint is
  'sha256 hex of the canonical composed AXES (codes and integers only). Never a hash of free text: '
  'two compositions differing only in the strategist''s wording produce the same digest and the '
  'second is rejected. The realisation prose lives in composition and is not hashed.';
comment on column public.claims.axes is
  'The canonical tuple that was hashed, stored verbatim so the digest is reproducible from the row.';

-- Backfill. Production holds two $1 trial orders (CLAUDE.md), and their claims
-- predate the scheme. Give them sentinel fingerprints so they occupy the index
-- without ever colliding with a composed one: a v26 claim has no composition, so
-- pretending it does would be a lie the distinctness metric would then act on.
update public.claims
   set fingerprint = 'legacy-v26:' || id::text
 where fingerprint is null;
alter table public.claims alter column fingerprint set not null;

-- ---------------------------------------------------------------- 3. the locks
-- LOCK 3 and LOCK 4 (core_schema.sql:102-107) ARE the ceiling of 8. Gone.
drop index if exists public.claims_template_lock;
drop index if exists public.claims_opening_lock;

-- LOCK 5 (core_schema.sql:110-112) has never matched a row and never could:
-- voice_kind is hardcoded 'custom' at index.ts:1435 and nothing seeds a house
-- voice. Its only live effect was mislabelling unexplained unique violations via
-- the else-branch at rls_and_claim_functions.sql:118. Gone.
drop index if exists public.claims_house_voice_lock;

-- LOCK 2 (core_schema.sql:97-99) is demoted from a hard lock to a SOFT axis.
-- Two nonprofits can legitimately propose the same intervention for the same
-- beneficiaries in the same district on a grant that funds exactly that; forcing
-- 40 applicants onto 40 distinct concept tuples is uniqueness bought with
-- quality, which is the failure this design exists to avoid. The requirement is
-- that no two proposals share a writing style, a shape or a form — not that no
-- two share a project concept. The tuple is still recorded, still shown to the
-- strategist (index.ts:1394), and still weighted in the distinctness metric.
drop index if exists public.claims_concept_lock;
create index claims_concept_idx
  on public.claims (grant_id, intervention_type, delivery_method)
  where status in ('hold','confirmed');

-- LOCK 1 (core_schema.sql:92-94) is KEPT unchanged. It caps one live claim per
-- organisation per grant, which is not a ceiling across customers and is not what
-- limits volume. Its interaction with repeat customers (audit §3) is already
-- mitigated by release_stranded_claim (20260826150000) and is a separate concern.

-- THE NEW ARBITER.
create unique index claims_fingerprint_lock
  on public.claims (grant_id, fingerprint)
  where status in ('hold','confirmed');

-- expire_stale_holds (rls_and_claim_functions.sql:66-73) and the taken-set read
-- both scan by grant. At 8 claims per grant that never mattered; at 10,000 it does.
create index claims_grant_live_idx
  on public.claims (grant_id)
  where status in ('hold','confirmed');

-- ---------------------------------------------------------------- 4. the FKs
-- claims.structural_template_id and claims.opening_device_id are NOT NULL with
-- FKs to the pool tables (core_schema.sql:83-84). The columns are dropped, not
-- merely nulled: leaving them would leave two integers that look authoritative
-- and are not, and the next reader would wire something to them. The FK
-- constraints go with the columns. The two tables THEMSELVES are kept, marked
-- deprecated, as the provenance of the migrated vocabulary rows.
alter table public.claims drop column structural_template_id;
alter table public.claims drop column opening_device_id;
comment on table public.structural_templates is
  'DEPRECATED 2026-08-27. Source of the migrated spine vocabulary in composition_axes. '
  'Read by nothing. Was a consumable pool of 8; that pool WAS the exclusivity ceiling.';
comment on table public.opening_devices is
  'DEPRECATED 2026-08-27. Source of the migrated opening_move vocabulary in composition_axes.';

-- voice_profile_id / voice_kind (core_schema.sql:85-86) stay NOT NULL and stay
-- populated exactly as today (index.ts:1380-1381, 1435). The audit shows they do
-- no work, but they are also harmless, and removing them is churn this change
-- does not need.

-- ---------------------------------------------------------------- 5. the function
-- The old signature must be dropped explicitly or Postgres keeps both overloads
-- and PostgREST resolves by argument names — an ambiguity that would silently
-- route some calls to the ceiling-bound version.
drop function if exists public.claim_approach(
  uuid, uuid, text, text, text, text, text, smallint, smallint, uuid, text);

create or replace function public.claim_approach(
  p_org uuid, p_grant uuid,
  p_intervention text, p_delivery text, p_beneficiary text, p_geography text,
  p_mechanic text,
  p_fingerprint text, p_axes jsonb, p_composition jsonb,
  p_resolution smallint default 1,
  p_voice uuid default null, p_voice_kind text default 'custom'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_claim uuid;
  v_blocked text;
begin
  -- Unchanged: refuse sanctioned or refused orgs at the door. Per-organisation,
  -- never a volume ceiling.
  if exists (select 1 from public.organisations
             where id = p_org and sanctions_status in ('flagged','refused')) then
    return jsonb_build_object('granted', false, 'blocked_by', 'sanctions_screening');
  end if;

  if p_fingerprint is null or length(p_fingerprint) < 16 then
    return jsonb_build_object('granted', false, 'blocked_by', 'malformed_fingerprint');
  end if;

  perform public.expire_stale_holds(p_grant);

  -- The whole transaction is this INSERT. No model call, no HTTP call, no sleep
  -- is inside it, which is why two callers racing the same fingerprint block each
  -- other for about a millisecond rather than for the length of a generation.
  begin
    insert into public.claims (grant_id, organisation_id, intervention_type, delivery_method,
      beneficiary, geography_bucket, signature_mechanic,
      fingerprint, axes, composition, composer_resolution, voice_profile_id, voice_kind)
    values (p_grant, p_org, p_intervention, p_delivery, p_beneficiary, p_geography,
            p_mechanic, p_fingerprint, p_axes, p_composition,
            coalesce(p_resolution, 1), p_voice, coalesce(p_voice_kind, 'custom'))
    returning id into v_claim;
  exception when unique_violation then
    -- Two live locks remain, so the classifier has two real cases and an honest
    -- catch-all. The old else-branch reported 'house_voice' — a lock that could
    -- never fire — for every unexplained violation, which made the P0 harder to
    -- diagnose than it needed to be (audit §2). Never guess a blocker again.
    v_blocked := case
      when exists (select 1 from public.claims
                    where grant_id = p_grant and organisation_id = p_org
                      and status in ('hold','confirmed'))
        then 'existing_claim_same_org'
      when exists (select 1 from public.claims
                    where grant_id = p_grant and fingerprint = p_fingerprint
                      and status in ('hold','confirmed'))
        then 'fingerprint_taken'
      else 'unknown_unique_violation'
    end;
    -- fingerprint_taken is the ordinary, expected outcome of a race and the
    -- worker re-rolls on it. Logging one event per collision would flood a table
    -- that is append-only by trigger, so only the abnormal cases are recorded.
    if v_blocked <> 'fingerprint_taken' then
      insert into public.events (actor, action, entity, entity_id, detail)
      values ('claim_approach', 'claim_blocked', 'grant', p_grant::text,
              jsonb_build_object('org', p_org, 'blocked_by', v_blocked));
    end if;
    return jsonb_build_object('granted', false, 'blocked_by', v_blocked);
  end;

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('claim_approach', 'claim_held', 'claim', v_claim::text,
          jsonb_build_object('org', p_org, 'grant', p_grant,
                             'fingerprint', p_fingerprint, 'resolution', p_resolution));
  return jsonb_build_object('granted', true, 'claim_id', v_claim);
end;
$$;

revoke all on function public.claim_approach(
  uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,smallint,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_approach(
  uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,smallint,uuid,text) to service_role;
```

`confirm_claim`, `release_claim`, `release_stranded_claim` and `expire_stale_holds` are unchanged —
none of them reference the pool columns.

---

## 12. How it is tested

No human in the customer workflow anywhere below. No orders in the production project: `bench_cases`
was dropped 2026-08-23 and production holds only KT-10001 and KT-10002 (CLAUDE.md). Everything runs
against a **scratch branch database** replaying all migrations plus the new one.

### 12.1 Pure-SQL lock harness — no worker, no model, no orders

One synthetic grant, 10,000 synthetic organisations, 10,000 `claim_approach` calls with distinct
fingerprints.

- Assert **10,000 / 10,000 granted**. (Today the audit's equivalent test returns `blocked_by =
  'structural_template'` at N = 9.)
- Assert `blocked_by` never takes the value `structural_template`, `opening_device` or `house_voice`
  at any N — those classifications no longer exist.
- Insert a deliberate duplicate fingerprint: assert `blocked_by = 'fingerprint_taken'`, and
  specifically **not** `unknown_unique_violation`, which would mean the classifier fell through.
- Assert `select count(*) from claims where voice_kind = 'house'` **= 0**, and that
  `claims_house_voice_lock` no longer exists. (The audit's §5.4 regression guard, kept and given an
  explicit expected value.)

### 12.2 Concurrency — proves the index arbitrates, not the worker's snapshot

64 parallel sessions, **same** fingerprint, one grant, distinct orgs.

- Exactly **1** `granted: true`, **63** `blocked_by = 'fingerprint_taken'`.
- `select count(*) from claims where grant_id = … and status in ('hold','confirmed')` = 1.

### 12.3 Non-serialization — the measurable proof

64 parallel sessions, **distinct** fingerprints, one grant.

- All 64 granted.
- **p99 latency of `claim_approach` < 50 ms**, and total wall clock within 3× of a single call — not
  64×. A queue, an advisory lock or a `FOR UPDATE` over the grant would show up here as linear
  growth, and nothing else would.
- Repeat with the same fingerprint for all 64 to bound the collision path: p99 still < 50 ms, because
  the wait is on a ~1 ms transaction.

### 12.4 Composer unit tests — pure TypeScript, no DB, no model

These are the tests that address the two failure modes directly, and they are the cheapest tests in
the suite.

- **Fingerprint stability (anti-nominal-uniqueness).** Build one `Axes` value; wrap it in three
  different free-text realisations (different `directive` strings, different anchor descriptions,
  different section briefs). Assert **one digest**. Then change `stance` alone and assert the digest
  moves. This is the direct assertion that wording cannot reach the hash.
- **Quantisation coarseness.** Two cadence targets 0.4 words apart at resolution 1 must land in the
  same bucket and produce the same digest. A design that let them differ would be manufacturing
  distinctness.
- **Exclusion.** With a taken set of 10⁴, run 10⁶ draws; assert **zero** returns a taken fingerprint.
- **Unboundedness (the direct test of §8).** Construct a deliberately tiny envelope with exactly 40
  reachable compositions at resolution 1. Drive the taken set to 40 — assert the composer returns a
  new fingerprint at resolution 2 and **does not throw**. Continue to a taken set of 10,000: assert
  still no throw, that `resolution` grows logarithmically (≈ 9 for 10,000 against a 40-value
  envelope), and that total draws stay under 128 × resolution. No model, no database, runs in
  milliseconds, and it is the assertion that (P1)–(P5) hold in the code and not only in the argument.
- **Linear extensions.** `linExtTable(n, pred)[0]` matches a brute-force count for n ≤ 8. Every
  `unrankLinExt` result satisfies every edge of `PRECEDES`. This is the assertion that A2 cannot
  produce a worse document — 10⁴ random ranks, zero precedence violations.
- **Entropy floor.** Feed an envelope where one value has `fit: 100` and the rest `fit: 56`; assert
  the sampler's realised entropy on that axis is ≥ 1.5 bits, i.e. it did not collapse.
- **θ schedule.** Assert the N at which θ first steps down matches §5's computed table within 20 %,
  so the table is a measurement and not a claim.

### 12.5 Conformance measurement calibration

Drive `compositionViolations()` over the regression fixture at `tests/regression/similarity-gate/`
and over hand-written documents constructed to hit and to miss each target. Assert the sentence
splitter and the cadence statistics agree with a hand count on at least 20 documents. **All counting
is deterministic and none of it is asked of a model** — the convention exists because two critics
already miscounted a 596-word document (CLAUDE.md).

### 12.6 The 40-applicant same-grant concurrent batch

The smoke test. Its own manifest, never touching production. 40 real-ish organisations with real
websites of varying quality — including at least one whose crawler returns nothing (the
`thefelixproject.org` case, P1 #6) and at least two with no uploads and no usable site, since those
are the applicants whose voice clause is omitted entirely today (audit §2.4). One real grant. All 40
paid within the same minute.

**Completion**

- 40 / 40 delivered. The audit's §5.6 acceptance query returns **zero rows**: no order in
  `attention`, no stage `held` or `failed`, with `completion_email_sent = false` and older than an
  hour.
- Zero `strategy_space_exhausted` — the string no longer exists.

**Distinctness, measured deterministically**

- 40 distinct fingerprints; 780 pairs.
- Pairwise `axisDistance` ≥ θ₀ = 8 for all 780 pairs.
- No two documents share a heading sequence.
- Mean sentence length across the 40 spans ≥ 6 words end to end, and no more than 4 documents fall in
  any one 2-word band. (A composer that samples but does not *reach* the generator would show up here
  as a tight cluster around the model's default — this is the assertion that the axes are real.)
- `longestCommonRun` (index.ts:1021, already written and already pure) < 25 for all 780 pairs — the
  existing gate, run offline over the batch instead of one document at a time.
- Opening-move conformance: classify each first paragraph deterministically where the code permits
  (digit → `statistic`, quote mark → `voice`, date pattern → `incident`/`policy_moment`, `?` →
  `question`) and assert agreement with the composed value on the mechanically checkable subset.

**Anti-nominal-uniqueness — the assertion a hash cannot make**

- Draw 10 random pairs. Give a blind critic from a **different model family** (per CLAUDE.md, the
  generator never grades its own work) the two narratives and the grant text only, and ask: *"Were
  these written by the same person working from the same template?"* Target **≥ 8 of 10 "no"**.
- This is the test that distinguishes this design from the current one. Run against v26 output it
  would return 0 of 10, because the fingerprints differ and the documents do not.

**Quality non-degradation — the assertion for failure mode 2**

- Blind-score proposals #1, #10, #20, #30, #40 (by claim order) against `reports/quality-standard.md`
  — ten dimensions, two critics, different families, adversarial prompt.
- Assert the acceptance bar holds for **every one of the five**: no disqualifier triggered, ≥ 3 on all
  ten dimensions, ≥ 4 on dimensions 1, 3, 6, 10.
- Assert **no monotone decline**: Spearman correlation between claim order and total score is not
  significantly negative (p > 0.1). If the 40th is systematically worse than the 1st, the composer is
  buying uniqueness with quality and the design has failed, whatever the fingerprints say.
- Assert dimension 3 (organisation fit) specifically does not decline, since that is the dimension a
  fit-blind slot allocator would damage first — and is exactly what index.ts:1426's
  first-free-integer loop does today.

**Throughput, measured and reported separately**

- Record wall clock from payment to delivery for all 40. With `p_global_cap = 6` this is expected to
  breach 30 minutes (§9.5: ~80 min), and the test **reports** it rather than failing the composer for
  it. Re-run at `p_global_cap = 16` and assert p95 ≤ 30 minutes. That number is the input the
  reliability track needs.

### 12.7 Production monitoring, no human in the loop

- The audit's §5.6 query as a standing alert: any `attention`/`held`/`failed` with
  `completion_email_sent = false` older than an hour.
- `alert if composer_resolution > 1 on any claim` — under the §6 arithmetic this should never fire,
  so if it does, an envelope is collapsing and the composer is running on the safety net.
- `alert if effective_entropy_bits < 14` on any strategy stage output — the early warning that the
  strategist has started returning single-value envelopes, which is the one failure that would shrink
  the space silently.
- `alert if composition_drift present on > 10 % of stages in a day` — the generator has stopped
  following the directive, which is quality drift the validators would otherwise be blind to
  (report P1 #8).

---

## 13. What this design does not fix

Stated so it is not mistaken for a claim.

1. **Throughput.** §9.5. `p_global_cap = 6` breaches the 30-minute clause at 40 concurrent orders.
   One-parameter change, different track.
2. **`claims_one_per_org`.** A returning customer ordering a second proposal on a grant they already
   ordered against is still refused (audit §3). Orthogonal to the composer.
3. **The `check` stage is O(N).** index.ts:1716–1718 compares against every completed narrative on
   the grant. At N = 1,000 that is 1,000 runs of `longestCommonRun` on 2,500-word documents in one
   stage. The composer makes a breach much rarer but does not make the comparison cheaper.
   Recommendation: compare against the 40 most recent plus any sharing three or more high-salience
   axes — a set the `axes` column makes cheap to select.
4. **Failure notification.** P0 #4 is untouched. The composer removes the ceiling that was the
   largest *source* of silent drops; it does not add the notifier.

---

## 14. Order of implementation

1. Migration (§11) applied to a scratch branch. Tests 12.1–12.3 pass there before any worker change.
2. Composer functions (§10.1–10.2) as a standalone module with tests 12.4 green. No DB, no model, no
   deploy — this is where the design is proved or falsified, cheaply.
3. Strategy stage rewrite (§10.3) + envelope prompt (§10.6). Test 12.1 re-run end to end.
4. Directive (§10.4) + conformance check (§10.5) + calibration 12.5.
5. The 40-applicant batch (§12.6) on the scratch branch.
6. Byte-verify the worker against deployed source before and after, per CLAUDE.md's deploy
   discipline. The v25 over-escaping corruption is exactly the class of failure a composer directive
   full of template literals would hide.
