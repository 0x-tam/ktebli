# Adversarial round 2 — INVARIANT 1: nothing unfundable is ever delivered

**Date:** 2026-08-28 · **Target:** the pre-delivery quality gate (`supabase/functions/worker/delivery_gate.ts` v2 `runDeliveryGate` / `runGateLoop`) and its wiring (`worker/index.ts` package gate ~2485, deliver guard ~2776) · **Verdict: CONCEDED.** No deterministic, attacker-controlled path was found that delivers an unfundable document. One genuine **latent defect** in the re-judge/stickiness invariant was found and is documented below with a fix; its reach to an actual delivery is contingent (judge non-determinism + an unproven production trigger), so it is not claimed as a break.

Test: `tests/adversarial/adv2_delivery_gate_test.ts` — **72 checks, all green** (10 attack families that failed to break the gate + probe 13 pinning the latent defect). Runs offline: `npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_delivery_gate_test.ts`. Typechecks clean under deno 2.9.5. Baseline unit suite (`tests/delivery-gate/`) still 555/555.

---

## 1. The structural reason INVARIANT 1 is hard to break

Delivery has a **hard backstop that does not trust the pipeline**: the `deliver`
stage recomputes `documentHash(deliveredText, JUDGE_GATE_VERSION)` over the exact
bytes it is about to send (`index.ts:2781-2786`) and refuses unless
`gate_verdict_for(proposal, thatHash)` returns a **sticky `pass` row under the
current gate version**. A pass row is written only by `record_gate_verdict`
(migration `20260826170000`), only from a genuine `runDeliveryGate` `pass`
outcome, and the table's `delivery_gate_verdicts_shape` / `_sticky_cause` CHECK
constraints make a "pass with a cause" or a non-sticky pass **unrepresentable**.

Consequence: to deliver an unfundable document you must get a `pass` **recorded
against the exact delivered bytes**. Every desync I could construct upstream
(revision reads, gate_text resumption, the `finalNarrative` fallback) either
keeps delivered bytes == judged bytes, or makes the guard **fail closed** (a hash
miss throws). The guard can never fail *open*: a hash miss cannot invent a pass.

I verified the delivered/judged/hashed bytes coincide on every pass path:
`package.text = gateText = gate.narrative` when the gate regenerated, and the
`finalNarrative(c.out)` fallback otherwise — and `finalNarrative` reads
byte-stable persisted stage rows in both `package` and `deliver`.

So the only real question is: **can a `pass` be recorded on an unfundable
document?** That requires the judge model to affirmatively clear it. Everything
below is an attempt to force that, or to smuggle a pass without it.

## 2. Attacks that FAILED (the defenses that held) — `adv2/1`–`adv2/12`

Each is an executed probe against the real module, not an argument.

1. **Structured-output field manipulation** (`adv2/1`). All-clearing scores with
   one disqualifier `true`; a below-floor dimension plus a bogus `"overall":"pass"`;
   a near-miss verdict token `"passes"`; string scores; `0/1` for booleans.
   `parseJudgeReply`→`parseJudgement` (delivery_gate.ts:375-427, 1274-1293) is
   strict — integers 1-5, real booleans, enum verdict — and `applyBar`
   (432-445) reads every dimension and condition separately. Every one **holds**.
2. **Decoy JSON object** planted before the real verdict (`adv2/2`). The
   first-`{`..last-`}` slice then spans two objects and is unparseable → INFRA no-
   judgement, never a pass. The clean object is the control that passes.
3. **Hold-biased posture** (`adv2/3`). Step 8 (delivery_gate.ts:1490-1518)
   requires `verdictAttempt.clears` **and** `asserted_verdict === "clears_bar"`.
   Clearing numbers + asserted `fails_bar` → hold; clearing assertion + a below-
   floor number → hold; only agreement passes. The assertion can veto, never
   rescue.
4. **Gate-version replay** (`adv2/4`). A forged v1-version `pass` keyed on the v2
   hash is refused (`stored_verdict_stale` alert, `from_record:false`), and
   `verdictFromRecord` surfaces the stale version so the deliver guard's
   `gate_version !== JUDGE_GATE_VERSION` throw (index.ts:2785) fires too.
5. **True-whitespace re-roll** (`adv2/5`). Trailing tabs, CRLF, surrounding
   whitespace, and blank-line runs of ≥1 all normalise away; a held document
   edited that way **replays the hold with zero model calls**. A one-word change
   correctly earns a fresh judgement. (The narrow exception is defect §4.)
6. **Preflight poison** (`adv2/6`). `[TODO]` placeholder and a sub-250-word stub
   are held by the deterministic preflight (delivery_gate.ts:292-331) **before**
   any judge call — a generous judge is never consulted.
7. **Family exclusion, obfuscated** (`adv2/7`). Generator ids with casing,
   whitespace, and no `/` still drop a same-family judge (`modelFamily` lower-
   cases/trims/splits); both-in-family → misconfigured hold, never a self-judge.
8. **Family exclusion, end-to-end** (`adv2/8`). Both rungs forced into the
   generator's family → `judge_misconfigured` INFRA hold, `0` model calls.
9. **Whole-loop delivery only on pass** (`adv2/9`). A fixed always-fail judge
   drives `runGateLoop` to `refund`, never `deliver`; `loopAction` never returns
   `deliver` off a hold.
10. **Stale-version pass seeding** (`adv2/10`). `loopAttemptFromRecord` returns
    `null` for a v1 pass row — it seeds nothing into the v2 budget.
11. **Content vs whitespace under the hash** (`adv2/11`). A one-digit change is a
    different document; case and punctuation survive normalisation.
12. **Judge config integrity** (`adv2/12`). Primary `google/gemini-3.7-flash`,
    fallback `z-ai/glm-5.3-flash`, two families; the schema stays generated from
    the bar.

Also checked and sound by reading (not re-tested here, covered by the 555-check
suite): `judgeCall` (index.ts:1192) sends `req.model`, not the generator model,
so the family rule is real; the INFRA/QUALITY partition is total and disjoint;
INFRA never refunds and never reaches the customer; the spend cap holds before
the call; SHA-256 collision is infeasible.

## 3. The residual the project already discloses (not my finding)

`reports/phase3-gate.md §2`: the wired judge is **LOW-AGREEMENT**. Against blind
ground truth gemini-3.7-flash scored 77.8% (below the 80% bar) and **passed
every opus-generated document it saw, including both not-fundable ones**; glm
sat at the always-hold baseline and its verdicts are **not reproducible even at
temperature 0** (it flipped 4/22 documents between identical runs). Production's
generator is `anthropic/claude-opus-5`. So an unfundable **opus-grade** document
can receive a recorded pass and be delivered — but this is a property of the
judge's *accuracy*, openly flagged by the owners, not a mechanism bug, and it is
not deterministically demonstrable without a live, non-deterministic model call.
I did not spend the model budget reproducing a documented result.

## 4. Strongest attempt — a genuine latent defect (`adv2/13`)

**Where.** `normaliseDocument` (delivery_gate.ts:221-230), used by
`documentHash` (235-239). Its re-judge comment (218-220) states: *"A regeneration
that only reflows blank lines has not changed the document and must not earn a
fresh roll of the dice."* The migration echoes it: *"the DB hash separately makes
an unchanged doc unreplayable into a fresh roll."*

**The defect.** The normaliser collapses trailing whitespace, CRLF, and
`\n{3,}→\n\n` — but **not** the `\n`↔`\n\n` boundary. Verified exactly
(`adv2/13`, and a standalone probe):

| reflow | hash |
|---|---|
| 0 blank lines (`\n`) ↔ 1 blank line (`\n\n`) | **DIFFERENT** |
| 1 blank line ↔ 2 blank lines ↔ 4 blank lines (`\n\n\n\n\n`) | same |

So toggling a single line-break into a paragraph-break (or back) on a
**semantically identical** document produces a different `doc_hash`. The sticky
verdict is keyed on that hash, so the held verdict is **not replayed** and the
judge **rolls again** — the exact "re-roll on an unchanged document" the
stickiness layer claims to forbid. `adv2/13` drives this end-to-end: a held
document, re-presented with one fewer blank line, is judged afresh
(`from_record:false`, judge consulted) and — with a generous judge — passes.

**Defeating input.** Any held narrative `N` and its twin
`N.replace(/\n\n/, "\n")` (or the reverse): same words, `documentHash(N) ≠
documentHash(twin)`.

**Why I do NOT claim this as a break (reach is contingent, not deterministic).**
For this to deliver an unfundable document, a blank-line twin of an already-held
document must reach `runDeliveryGate` as a *fresh* narrative and the re-roll must
land on pass. In production every route I traced blocks it:

- **The loop's first-line defense is newline-insensitive and refunds cosmetic
  regenerations.** `materialChange` (1134-1157) measures on `shingleCounts`,
  which normalises and splits on whitespace, so a blank-line-only regeneration
  scores `changed_fraction = 0 < 0.20` → `loopAction` returns **refund**
  (1622-1628), not a re-roll. The stickiness hole is only exposed where
  `materialChange` does not run (the loop's *first* judgement), which is guarded
  by `storedVerdict`.
- **The narrative sources are byte-stable.** The first narrative is
  `gate_text ?? finalNarrative(c.out)`. `gate_text` is persisted verbatim and a
  reaped-and-reclaimed invocation resumes on the same bytes (index.ts:2160-2177);
  `finalNarrative` reads persisted stage rows. Nothing in the pipeline re-flows
  blank lines between two reads.
- **The attacker controls no narrative bytes.** The order submitter supplies
  intake identity only; the pipeline generates and regenerates the narrative.
- **The deliver guard can only fail closed on a hash mismatch** — the hole never
  invents a pass, it can only *miss* one.

The one conceivable trigger is a loop that *oscillates* — regenerates a blank-
line twin of a **non-consecutive** earlier held draft (so `materialChange`
against the *previous* draft still reads material) and a non-deterministic judge
that flips to pass. That is not attacker-controlled and depends on the disclosed
glm instability. Real reliability risk; not a deterministic reach. Hence
**CONCEDED**, with the defect pinned rather than dressed up as a break.

**Fix (defense-in-depth, closes the stated-vs-actual gap).**
In `normaliseDocument` (delivery_gate.ts:228) collapse **all** blank-line runs,
not only 3+:

```ts
// was: .replace(/\n{3,}/g, "\n\n")
.replace(/\n{2,}/g, "\n")
```

This makes the hash invariant to *any* blank-line reflow (0, 1, or many), which
is exactly what the comment already promises, so the fix is a one-line
tightening with no behavioural surprise beyond honouring the documented
contract. Paragraph structure is not part of a grant narrative's fundability and
the judge reads the prose regardless, so collapsing it for hashing is aligned
with intent. Then update `adv2/13`'s two `DEFECT` assertions (they will flip:
0-blank and 1-blank must then share a hash and the twin must **replay**), and add
the twin case to `tests/delivery-gate/` re-judge coverage. `materialChange`
should stay newline-insensitive as it is — it remains the primary defense.

Residual risk if unfixed: bounded. The stickiness layer is *one* of two defenses
against loop oscillation and the weaker of them here; the primary
`materialChange` defense and the byte-stable sources carry the load, and the
deliver guard fails closed. The value of the fix is making the DB-level backstop
actually as strong as its own comment claims, so a future call site that leans
on it (as the migration warns is the whole point of putting the rule in the DB)
is not silently weaker than documented.

## 5. What I did not attempt, and why

- **Live model injection** of the blind judge via `<untrusted_source>` narrative
  text to force all-5s + `clears_bar`. This is the disclosed LOW-AGREEMENT
  residual (§3), non-deterministic, needs a model call, and would demonstrate a
  known property rather than a mechanism flaw. Out of proportion to its value.
- **v1 `runGate`.** Exported and unit-tested but not on any delivery path
  (`index.ts` wires only `runGateLoop`→`runDeliveryGate`); not a reach to
  delivery.

## 6. Bottom line

The delivery gate's mechanism holds INVARIANT 1 against every deterministic,
attacker-controlled probe I could construct: strict parsing, the hold-biased
double-signal, the family rule, gate-version and sticky-hash replay rules, and a
deliver guard that fails closed on the exact delivered bytes. The one genuine
defect — the re-judge rule's blank-line robustness being false at the 0↔1
boundary — is real and worth the one-line fix, but its reach to an actual
delivery is blocked in production by a newline-insensitive `materialChange` and
byte-stable narrative sources, and is contingent on the separately-disclosed
judge non-determinism. **CONCEDED**, with the strongest attempt characterized and
fixed above.
