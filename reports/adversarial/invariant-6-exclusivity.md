# Invariant 6 — exclusivity / uniqueness — **BROKEN**

**Invariant.** *"No two proposals to one grant share style, shape or form, and nobody ever
waits."* Any number of applicants against one grant, all served, no queue / slot / availability
check; the composer unbounded by construction; the lock on a fingerprint of what was composed;
collisions re-roll with taken fingerprints excluded.

**Attacker verdict: BROKEN.** The composer serves everyone (the "nobody waits" half holds), but
it does **not** keep two proposals from sharing style/shape/form. Fingerprint uniqueness is
**nominal, not real**: the fingerprint is hashed over eleven axes while only **two** of them ever
reach the writer, so the reader-visible style space is a **finite pool of 182** — and two
applicants on one grant share their entire writer-visible style from as few as ~17 applicants, a
pigeonhole certainty past 182. Both are served; the lock waves both through.

Target under attack: the WS6-bench rewire, commit `bfa6b4a`, on
`supabase/functions/worker/index.ts` (COMPOSER-BEGIN..END + the strategy stage) against migration
`20260826160000_unbounded_composer.sql`.

---

## 1. The claim, and where it is true

The migration header sells "a composition drawn across **twelve independent axes**" whose space is
"astronomically larger than any grant's applicant count." That is true **of the fingerprint**. The
seeded `composition_axes` vocabulary (proven by a PG17 replay of all migrations) is:

| axis | codes | reaches the writer? |
|------|------:|---------------------|
| **spine** | **13** | **YES** → `template_style` |
| **opening_move** | **14** | **YES** → `opening_style` |
| argument_carrier | 6 | no |
| paragraph_regime | 5 | no |
| stance | 6 | no |
| evidence_integration | 5 | no |
| closing_move | 8 | no |
| tabular_policy | 4 | no |
| move_order (integer, % 997) | ~997 | no |
| cadence_mu (integer, 8–27) | 20 | no |
| weight_profile (integer, % 997) | ~997 | no |

The fingerprint hashes all eleven, so distinct fingerprints are cheap and everyone is placed. But
"style, shape or form" is what a **reader** sees, and the reader only ever sees the two axes that
are wired into a generation prompt.

## 2. Root cause — nine of eleven hashed axes are mute (file:line)

`composeDraw` (`worker/index.ts:1532-1548`) builds two things: `composition` (a prose directive
per **categorical** axis) and `axes` (the same categorical codes **plus** three integer grids
`move_order`/`cadence_mu`/`weight_profile`, lines 1544-1546). Only `axes` is hashed
(`canonicalAxes` → `sha256Hex`, 1520-1526). The integers are **never** placed in `composition`.

The strategy stage then stores, and forwards to generation, only a two-axis slice:

- `worker/index.ts:2065` — `template_style: { name: claimed.axes.spine, description: claimed.composition.spine }`
- `worker/index.ts:2066` — `opening_style: { name: claimed.axes.opening_move, description: claimed.composition.opening_move }`

and the **only** carrier of composed style into any generator prompt is the `styleNote`:

- `worker/index.ts:2130` — `` const styleNote = strategy ? `\nStructure style: ${JSON.stringify(strategy.template_style)}. Opening style: ${JSON.stringify(strategy.opening_style)}.` : "" ``

used at `2205` (sectioned path) and `2231` (single-shot path). The full `composition` object and
the six mute categorical axes (`paragraph_regime`, `stance`, `evidence_integration`,
`argument_carrier`, `closing_move`, `tabular_policy`) are named in **no** generation prompt
anywhere in the worker — confirmed by grep: their only appearances are the strategy-stage output
row (`2064`) and the `claim_approach` argument (`2025`), i.e. storage and hashing, never a writer
input.

So the writer receives exactly `(spine, opening_move)`. Reader-visible style space = **13 × 14 =
182**, no matter how large the fingerprint space is.

> Corollary (re-opens launch P0 #1). The migration introduced Group B/C axes —
> `paragraph_regime`, `stance`, `closing_move`, `tabular_policy` — *specifically* to cure the
> "reads machine-generated" house-register default (migration lines 77-79, 115-118). They are
> hashed and dropped. The register cure the composer was built to deliver is **inert**: every
> proposal still defaults to the generator's house register in six of eight style dimensions.

## 3. Proof A — the shipped `composeDraw`, real vocabulary (module logic)

Extracting the shipped composer block and feeding it the real vocabulary (parsed from the
migrations), for a plain, un-engineered sequence of applicants on one grant
(`seedBase = ${orgUuid(i)}|0|intervention_${i}|0`, exactly the worker's seed shape):

```
   N    servedDistinctFingerprints    distinctVisibleStyles
   20            20                         18
   40            40                         37
  182           182                        113
 1000          1000                        181     ← saturates at the 182 pool
```

Every applicant is served (all fingerprints distinct — "nobody waits" holds), while the
reader-visible style space **saturates at 182**. At N = 1000, **819 of 1000 served applicants
reuse another applicant's entire writer-visible style.** Concrete first-collision pair at N = 40:
applicants 7 and 11 both draw `spine=cost_of_inaction, opening_move=cost_of_delay` — byte-identical
`template_style` **and** `opening_style` — with distinct fingerprints. The axes that separate their
fingerprints are all mute: `closing_move, evidence_integration, paragraph_regime, stance,
tabular_policy, move_order, weight_profile`.

## 4. Proof B — end-to-end through `claim_approach()` on a replayed Postgres

Replaying all migrations into a throwaway PG17 and calling the **real** `claim_approach()` for that
concrete pair — two **distinct** organisations on **one** grant, with the fingerprints/axes the
shipped `composeDraw` actually produced:

```
NOTICE:  applicant 7  granted=true   spine=cost_of_inaction  opening_move=cost_of_delay
NOTICE:  applicant 11 granted=true   spine=cost_of_inaction  opening_move=cost_of_delay
NOTICE:  INVARIANT-6 BROKEN: two applicants on ONE grant BOTH SERVED sharing
         spine=cost_of_inaction + opening_move=cost_of_delay (the only axes fed to the writer)

 live_claims | distinct_fingerprints | distinct_visible_styles
-------------+-----------------------+-------------------------
           2 |                     2 |                       1
```

The `claims_fingerprint_lock` unique index `(grant_id, fingerprint)` sees two distinct keys and
blocks neither. Two live claims on one grant, **one** reader-visible style. The invariant's own
enforcement point admits the violation.

## 5. The break, stated exactly

- **Input / count.** Any grant, ≥ ~17 applicants → a birthday collision on the 182-pool; ≥ 183
  applicants → a pigeonhole certainty. Deterministic first pair at N = 40: applicants **7 and 11**,
  both `spine=cost_of_inaction, opening_move=cost_of_delay`.
- **Symptom.** Both applicants' proposals are generated from a **byte-identical** style directive
  (`template_style` + `opening_style`); everything else about their form is uncontrolled and
  defaults to house register for both. A reader attributes the two to one writer. Both are served,
  paid, and delivered.
- **Why the existing tests missed it.** `tests/exclusivity/ceiling_test.sql` and
  `composer_reservation_test.ts` both assert **fingerprint** distinctness and explicitly treat "a
  different integer grid → a different canonical form" as proof "the space really is wide"
  (`composer_reservation_test.ts:102-104`). Neither ever asks whether the varying dimensions are
  visible to a reader. `phase6-eng §11` measured **4** applicants — below the collision threshold —
  and reported "4 distinct fingerprints, no collision" as unboundedness proven.

## 6. Fix spec (do NOT apply here — shared code is read-only to this attacker)

The invariant holds only when **the fingerprint hashes exactly the set of dimensions the generator
receives** — no mute padding above it, nothing rendered below it. Two coordinated changes:

- **F1 — feed the whole composition to the writer.** `worker/index.ts:2130` (and the
  `template_style`/`opening_style` slice at `2065-2066`): inject the directive for **every**
  categorical axis in `strategy.composition`, not just `spine` and `opening_move`, into the
  `styleNote` used at `2205`/`2231`. This lifts the reader-visible categorical space from 182 to
  13×6×14×5×6×5×8×4 = **5,241,600** — unbounded for any real grant — **and** delivers the register
  control the migration promised (closes the P0 #1 corollary).
- **F2 — no hashed dimension the reader cannot perceive.** `worker/index.ts:1544-1546`: the three
  integer grids are pure fingerprint padding. Either give each a reader-visible realization written
  into `composition` and the prompt (e.g. `cadence_mu` → target mean sentence length; `move_order`
  → the order argument-moves appear in; `weight_profile` → relative section emphasis), **or remove
  them from `axes` before hashing** so the fingerprint is a function only of what the writer sees.
  Leaving them hashed-but-mute keeps a smaller-scale version of this exact defect (identical
  categorical directives, different integers, distinct fingerprint) that reappears at
  ~√5.2M ≈ 2,300 applicants.

Acceptance = the invariant predicate in the test below: for any N, every **served** applicant's
writer-visible style is distinct. Note this is compatible with unboundedness — the fix widens the
*visible* space, it does not cap the served count. (Making the *lock* enforce visible-style
uniqueness instead — hashing only `spine`+`opening_move` — would re-impose the 182 ceiling and
break "nobody waits"; that is the wrong fix.)

## 7. What was attacked and HELD (conceded)

- **(a) Force REFUSE / WAIT / DEGRADE — is the 50-reroll cap a real ceiling?** No. Across N = 1000
  and N = 5000 draws the fingerprint space produced **zero** fingerprint collisions; the re-roll
  branch (`worker/index.ts:2017-2032`) essentially never fires, and the fingerprint space is
  ~10¹⁴, so hitting 50 taken fingerprints in a row is unreachable. The cap is a race bound, not a
  count ceiling. The composer never refuses, waits, or degrades on count. **Held** — and this is
  precisely what conceals the §3–§5 break.
- **(c) A collision that does not re-roll.** The only unique arbiters left are
  `claims_fingerprint_lock` and `claims_one_per_org`. `claim_approach`'s classifier
  (`migration:265-289`) maps them to `fingerprint_taken` (→ re-roll) and `existing_claim_same_org`
  (→ throw, correct: one org, one live claim per grant — not an invariant-6 count). No path lets a
  genuine fingerprint duplicate slip the unique index. **Held.**
- **(d) Canonicalization flaw.** `canonicalAxes` (`1520-1522`) sorts keys and emits codes/integers
  only; JSON distinguishes `42` from `"42"`; the digest reproduces from the stored `jsonb` row.
  No two logically-equal axis sets hash differently, and no two different sets collide (sha256).
  **Held.** (The canonical form's *inclusion of mute integer axes* is not a hash bug — it is the
  §2 decoupling, reported above.)
- **(e) Finite-pool residue.** Found — this **is** the break: the reader-visible pool is a finite
  **182** (§1–§3). The FK columns into the old 8-row pools are genuinely dropped
  (`migration:217-218`); the residue is not a column but the two-axis writer wiring.

## 8. The failing test

`tests/adversarial/adv2_exclusivity_test.ts` — imports the shipped `composeDraw`, parses the real
vocabulary from the migrations (cross-checked against the PG17 replay baseline), and gates on the
invariant predicate: *every served applicant's writer-visible style is distinct.*

```
npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_exclusivity_test.ts
# → INVARIANT 6 BROKEN … 819 of 1000 served applicants share a reader-visible style (pool = 182)
# → exit 1
```

It exits 1 while two served applicants on one grant can share a reader-visible style, and turns
green only once the reader-visible style space is as wide as the fingerprint the lock enforces
(F1+F2). Setup guards (`ok`) verify the shipped `styleNote` shape and the seeded vocabulary counts,
so a drift shows as **CANNOT VERIFY (exit 2)** rather than a silent pass. Reproduction of Proof B
(the `claim_approach` replay) followed the `tests/exclusivity/run.sh` pattern with
`sudo`, `PGBIN=/usr/lib/postgresql/17/bin`.

---

# RE-ATTACK 2026-08-28 (post-fix) — **CONCEDED**

The fix was merged to trunk (`41b25d7` / `86ef9b1`). It adds `composedStyleNote(axes,
composition)` inside the COMPOSER block (`worker/index.ts:1684`) and routes its output through the
sole `styleNote` at `worker/index.ts:2354-2358`, reaching **both** generation paths — the
section-by-section path (`:2445`) and the single-shot / whole-doc path (`:2471`).
`composedStyleNote` emits a line for **all eight** categorical axes (each as `Label [code]:
directive`) **and** the three integer grids as concrete instructions (`cadence_mu` → target mean
sentence length; `move_order` → a keyed ordering; `weight_profile` → a keyed emphasis weighting).
The fingerprint hash was deliberately **not** narrowed — narrowing would re-impose a ceiling — so
the visible space was widened to match the hash rather than the reverse. The committed test was
updated in the same change to import `composedStyleNote` as its model of the writer's input, so it
now measures the real thing.

**Re-run of the committed test against the merged code** (`npx --yes deno@2.9.5 run --allow-read
tests/adversarial/adv2_exclusivity_test.ts`): **exit 0** — `1000/1000` served applicants now
produce `1000` distinct reader-visible styles (was capped at the 182-pool). The finite ceiling is
gone.

**One more genuine attempt** — merged `composeDraw` + `composedStyleNote` imported and executed on
the REAL directive text (dumped from a PG17 replay of `composition_axes`), $0:

1. **Injectivity across 2000 applicants on one grant.** 2000 distinct fingerprints **and** 2000
   distinct `composedStyleNote` strings — zero style collisions. Every axis value survives into the
   brief verbatim (`[code]` for categoricals, the interpolated number for the grids), so the string
   is injective in the axes tuple, hence in the fingerprint. **Held.**
2. **Same eight categorical codes, different integer grids.** Forced a pair identical on all eight
   categorical axes but differing on the integers (mo/cad/wp `65/25/659` vs `557/27/445`): distinct
   fingerprints **and** distinct style briefs — the integer grids do reach the writer as bytes.
   **Held.** (This is the pre-fix mute case; it is now wired.)
3. **Canonicalization / integer-line collapse.** A one-unit change in `move_order`, `weight_profile`
   or `cadence_mu` changes the style string every time (no two integer values collapse to one
   line); `canonicalAxes` remains key-order independent, codes/integers only. No logically-equal
   set hashes two ways, no two different sets collide. **Held.**
4. **Refuse / wait / degrade.** N = 5000 → 5000 distinct fingerprints, zero collisions; the
   50-reroll cap is never approached. The composer still serves everyone; nobody waits. **Held.**

**Verdict: CONCEDED.** For the shipped vocabulary the visible-style space now equals the
fingerprint space (visible == fingerprint), the finite 182-pool is closed, unboundedness and
"nobody waits" are preserved, and I could not produce a collision, a canonicalization flaw, or a
refusal/wait count. The §1–§8 break is fixed.

Two honest caveats, neither a break:

- **Prose-distinctness of the integer grids is UNPROVEN-WITHOUT-E2E.** `move_order` and
  `weight_profile` reach the model only as opaque keyed instructions ("ordering keyed 557",
  "weighting profile 445") with no defined mapping to an actual arrangement; `cadence_mu` is a real
  sentence-length target and is the perceivable one. Whether two applicants who differ *only* in
  `move_order`/`weight_profile` produce prose a human reads as different — rather than two identical
  documents generated from two differently-numbered but semantically-equivalent instructions —
  cannot be settled deterministically at $0. The fix's own comment marks this
  UNPROVEN-WITHOUT-E2E; I confirm it. The mechanism (distinct bytes to the writer) holds; the
  *effect* (distinct reading) is the untested half, and it is the one most likely to hide a
  residual near-duplicate at scale. Not claimed as a break — flagged as the open risk.
- **Latent residue (hardening, not a live break).** `composedStyleNote` enumerates a **hardcoded**
  eight-name categorical list, while `composeDraw` hashes **every** axis present in
  `composition_axes` — a table the migration designed as an extensible vocabulary ("adding a row
  widens the space", migration lines 21-23). Demonstrated directly: two axis sets identical on the
  eight listed axes + three integers but differing on a hypothetical ninth categorical axis
  (`register_energy`) hash **differently** (`canonicalAxes` differs) yet yield a **byte-identical**
  `composedStyleNote` — the exact 182-class defect, one axis smaller. It cannot fire under today's
  schema (the eight listed axes are exactly the eight seeded), so it is not a break now; but a
  future `insert into composition_axes` of a new categorical axis silently re-opens it.
  Recommendation: derive the categorical loop from the axis keys actually present (all keys minus
  the known integer grids `move_order`/`cadence_mu`/`weight_profile`) so writer coverage can never
  fall behind the hash the lock enforces.
