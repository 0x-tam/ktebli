# The ONE-SYSTEM finding — diagnosis

**Date:** 2026-08-26 · **Inputs:** the four critic transcripts, the eight iteration-1 documents,
`case-ukyouth.json`, `case-evidence-poor.json`, `packet-ukyouth.txt`, `runD/prompt.txt`,
`runD/system.txt`, `supabase/functions/worker/index.ts` (2016 lines, current working copy),
`reports/design/house-style-findings.md`, `reports/design/design-composer.md`.

**Headline:** the finding is real, it is smaller than reported, and the instrument that produced
it cannot measure what it was asked to measure. The residue that survives is not shared *prose*
— there is measurably none — it is shared *project design*, and it is shaped by the call, not by
Ktebli.

---

## 0. Two facts that must be established before anything else

### 0.1 The "unfilled master" is a SINGLE-PROMPT document, not a pipeline document

`mapping-ukyouth.json` decodes `Doc 2 = D` — **single prompt + `anthropic/claude-opus-5`**.

> critic_b: *"Doc 2 is the unfilled master; the others are filled variants."*
> critic_a: *"This is an unfinished template containing placeholders for the locations, partners,
> evidence, delivery scale, budget, evaluator, continuation costs, funding sources, registration
> number, and signatory."*

The document both critics read as the *template* the other three were stamped from never touched
`GEN_SPECS`, `STYLE_RULES`, `FORMAT_RULES`, the eight seeded structural templates, the logframe
JSON schema, or any other scaffolding. It is one message to one model. Whatever "the master"
is, the pipeline does not hold it.

`out-ukyouth-D.md` carries 35 `[INSERT: …]` placeholders against 0 in both pipeline arms. It is
the only document in the set that makes the evidence hole *visible* — and both critics ranked it
**last**. See §2.4.

### 0.2 The "strong single prompt" is not a control for the scaffolding

The brief's premise is that *"the single-prompt arms did NOT go through that scaffolding"*. They
did not go through the *code*. They went through a hand-written near-isomorph of it.
`runD/prompt.txt` and `runD/system.txt` carry, in one message:

| constraint | pipeline (index.ts) | "strong single prompt" (runD/prompt.txt) |
|---|---|---|
| grounding / no invention | `FACT_RULES`, lines 68–74 | rules 1–4 ("An UNKNOWN item is NOT permission to invent") |
| house voice, negative style list | `STYLE_RULES`, lines 77–82 ("Avoid AI-sounding filler… 'groundbreaking', 'transformative'") | STYLE block ("no 'vital lifeline', no 'transformative journey'… no tricolons") |
| word target as a fraction of the cap | `TARGETS = [0.94, …]` line 643; brief rewrite line 1624–1626 | *"Aim for roughly 1,320–1,380 words"* = 0.943–0.986 of 1,400 |
| donor section list imposed verbatim | `donorStructure`, lines 1591–1593 | *"using the funder's five questions as headings, worded exactly as the guidance words them"* |
| budget table architecture | `GEN_SPECS.budget` brief, line 1596–1600 | *"direct costs by category, the overhead line shown separately…"* |
| markdown-only output grammar | `FORMAT_RULES`, lines 58–66 | *"Markdown headings are fine… Return the finished application only"* |

The 2×2 varied **how the constraints were delivered** (staged vs monolithic), not **what the
constraints were**. So "it survived varying the pipeline" licenses exactly one conclusion — *it
is not the staging* — and it does **not** exonerate the constraint set. Candidate (a) has not
been tested by this run at all. §4's E-3 is the experiment that would test it.

---

## 1. What the critics actually named — grouped by cause

Every item below is quoted from the transcripts and assigned to one cause. Where an item is
traceable to a specific clause of the funder's own guidance, that clause is quoted.

### 1.1 GRANT — mandated by the call, would be identical for four unrelated human applicants

| Critic's phrase | The clause that forces it |
|---|---|
| *"formulaic failure thresholds"* (critic_a, ukyouth Q6) | Q4: *"and what you would count as this work not having worked"* — the call **asks for a failure threshold by name** |
| *"written destination verification"*, *"retention checks"* (critic_a) | Priority 2: *"Attendance figures on their own are not an outcome we will fund"* — forces a third-party verification mechanism and a post-placement check |
| *"embedded toolkits"* (critic_a) | Priority 3: *"something a delivery partner keeps doing after the money stops… what it costs to run without us, and who pays"* |
| *"same 15% overhead ritual"* (critic_b) | *"Overhead recovery is capped at 15 per cent of direct costs and must be shown as a separate line"* |
| *"UK Youth as lead"* (critic_b) | *"one organisation must be named as lead and accountable body"* |
| *"fractional FTE roles"* (critic_a) | Arithmetic of *"GBP 40,000 and GBP 120,000, over a period of up to 24 months"* against a delivery model — you cannot buy full-time posts in that envelope |
| *"conspicuous compliance language"*, *"convenient percentages just below caps"* (critic_a, evidence-poor) | Levant grant: *"equipment max 30% of total, administrative overhead capped at 7%"* — the caps are published, so every applicant states its position against them |
| *"same polished architecture"* (critic_a, evidence-poor) | `required_sections` = the seven numbered sections; the Levant guidance says *"the section titles reproduced exactly"* |

**Measured:** all four evidence-poor documents carry the identical seven section headings,
character for character (`1. APPLICANT IDENTIFICATION` … `7. ELIGIBILITY DECLARATION`), in both
arms. The pipeline reaches that through `donorStructure` (index.ts:1591–1593); the single prompt
reaches it by reading the same sentence in the guidance. Same cause, two routes.

### 1.2 LEDGER — the applicant's own identity, shared by construction

critic_b's entire justification on `evidence-poor` is a list of ledger items:

> *"Same legal name, same 1487/2019, same ~USD 21,000 spend, same two part-time posts, same two
> neighbourhoods, same study-room-plus-clean-up origin story, rewritten four times."*

Six claims, six ledger items — `E-INTAKE-1`, `-2`, `-7`, `-5`, `-4`, `-6`. Zero of the six is a
stylistic observation. The same is true of half of critic_b's ukyouth list: *"1911, 9,000
organisations"* = `E-WEB-1`, `E-WEB-2`.

This is not evidence of a house style. It is evidence that four documents written for one client
describe one client. Four independent human consultants would produce the same six agreements.

Also here: *"unnamed network partners"* (critic_a) and *"placeholder geographies"* (critic_b).
Those are the ledger's silence, correctly respected. `E-INTAKE-5` for ukyouth reads *"Customer
directions / project idea supplied with the order: NONE RECORDED"*; ten of the twelve `E-WEB`
items read `UNKNOWN`.

### 1.3 SCAFFOLDING — attributable to Ktebli's code

Genuinely present, and narrower than expected:

- *"uniform phase tables"* — the pipeline arms carry a phase/timeline table on both cases
  (`ukyouth-A`, `evidence-poor-A`, `evidence-poor-B`). Driven by the design JSON's mandatory
  `"phases":[{phase, months}]` array (house-style-findings §5). But **`ukyouth-D`, a
  single-prompt document, also has one**, so the pipeline is sufficient, not necessary.
- *"identical bullet cadence"* — the arm with the flattest rhythm in the whole set is
  `ukyouth-A`, pipeline + current generator, at **σ/μ = 0.35**, exactly the floor of the
  composer's own B1 band. The burstiest is `ukyouth-D`, single prompt, at 0.67. n = 1 per cell:
  suggestive, not proven. E-3 tests it.
- *"template diction"* — critic_a hit this on all four ukyouth documents and three of four
  evidence-poor ones. But see §2.2: there is **no measurable shared diction**. This is the
  critic's prior, not an observation about these texts (§1.5).

### 1.4 GENRE — convention, not authorship

*"staged phases"*, *"three-part parallel constructions"*, *"pseudo-precise figures"*. Grant prose
has had phase tables and tricolons since before language models. The reject list in the critic
prompt (`packet-ukyouth.txt:493–497`) hands the critic this exact vocabulary and asks it to
*"name every hit"*. It cannot distinguish genre from authorship, and neither can this run,
because **no human-written control document was in either packet**. Candidate (d) is untested.

### 1.5 ARTEFACT — produced by the instrument

Four separate defects in `packet-*.txt`:

1. **The question has no available affirmative answer.** `packet-ukyouth.txt:499`: *"would you
   believe they came from four different applicants, or from one system?"* — asked of four
   documents that every one of them signs `UK Youth`, over a packet whose `THE APPLICANT` block
   names one applicant. "Four different applicants" is falsified by the letterhead before a word
   of prose is read. A question whose negative branch is unreachable returns no information.
2. **The sameness vocabulary is supplied.** Q4 (`:492–497`) gives a closed nine-item reject list
   — *absence of proper nouns / uniform phase tables / identical bullet cadence / three-part
   parallel constructions / template diction … / reads machine-generated* — and requires a
   per-document tally against it **before** Q6 is asked. Q6 is answered by a model that has just
   spent 1,000 tokens itemising sameness.
3. **A rejection prior is installed.** *"You have read hundreds of applications. Most are
   mediocre. A high mark must be EARNED."* … *"Be hard to please."*
4. **Side-by-side presentation.** Four documents in one context window, from one client, on one
   call. Nothing in the design lets a critic separate "these share an author" from "these share
   a client and a call".

---

## 2. The cross-cutting test — what is present in BOTH arms

This is the section the brief asks for. Four independent measurements.

### 2.1 Structural features present in all four arms — and they change when the grant changes

Deterministic regex presence across all eight documents:

```
=== ukyouth                     A  B  C  D          (A,B = pipeline; C,D = single prompt)
numeric failure threshold       Y  Y  Y  Y
fractional FTE                  Y  Y  Y  Y
accompanied handover            Y  Y  Y  Y
written third-party verification Y Y  Y  Y
toolkit / codified practice     Y  Y  Y  .
phase or timeline table         Y  .  .  Y

=== evidence-poor               A  B  C  D
phase or timeline table         Y  Y  .  .
numeric failure threshold       .  .  .  .
fractional FTE                  .  .  .  .
accompanied handover            .  .  .  Y
written third-party verification .  .  .  .
toolkit / codified practice     .  .  .  .
```

**This is the decisive result.** Four features are present in every ukyouth document regardless
of arm or generator — and **not one of them survives the change of grant**. On `evidence-poor`
the entire intersection collapses to the applicant's own name.

A house style is a property of the writer and would recur across both cases. This does not
recur. Every member of the ukyouth intersection maps to a clause of the Meridian guidance
(§1.1). The intersection is **grant-shaped**.

### 2.2 There is no shared prose. None.

Verbatim overlap across all four documents in a case, content-bearing 4-grams:

| case | shared by all four | what they are |
|---|---|---|
| ukyouth | 26 | 24 are the funder's five question headings and the four declaration certifications, quoted from the guidance; 2 are `uk youth is a` |
| evidence-poor | 2 | `mashghal community association registration`, `name mashghal community association` |

Content bigrams shared by all four **and absent from the call text**:

- ukyouth: **3** — `have been`, `local authority`, `uk youth`
- evidence-poor: **5** — all five are the applicant's name or `bab al-tabbaneh`

There is no shared idiom, no shared turn of phrase, no shared vocabulary. Whatever produced
"one system", it is not a common voice at the surface, and any fix aimed at diction (a banned-word
list, a synonym swap) is aimed at something that does not exist. The composer design already
says this (`design-composer.md`, "Axes deliberately excluded"); the data now confirms it.

### 2.3 The scaffolding's *unique* lexical contribution is approximately zero

ukyouth 4-gram overlap: pipeline pair (A∩B) = 37; single-prompt pair (C∩D) = 60;
**pipeline ∩ single = 35**. The two scaffolded documents share 2 four-grams with each other that
the two unscaffolded documents do not also share.

And the inversion: novel content bigrams shared *only* within a pair —
**pipeline-only = 6** (`phase months`, `project lead`, `neet status`, `colleges training`,
`authority youth`, `targets young`); **single-prompt-only = 19** (`delivery partners`,
`progression plan`, `youth offending`, `enrolment confirmation`, `per locality`, `carers
support`, …). On `evidence-poor`: pipeline-only 3, single-only 13.

**Two independent single-prompt runs converged on each other more than two scaffolded runs did.**
That is direct evidence for a homogeniser that is not the pipeline — and it is the strongest
support in this whole analysis for the brief's premise that "something ELSE" is at work. What it
points at is the constraint set plus the ledger, which the single prompt re-imposed by hand.

### 2.4 Register convergence — the one measurable residue

| doc | arm | mean sentence length | σ/μ |
|---|---|---|---|
| uk-A | pipeline + flash | 18.5 | **0.35** |
| uk-B | pipeline + opus | 19.1 | 0.59 |
| uk-C | single + flash | 21.9 | 0.44 |
| uk-D | single + opus | 19.5 | **0.67** |
| ev-A | pipeline + flash | 16.7 | 0.70 |
| ev-B | pipeline + opus | 17.8 | 0.58 |
| ev-C | single + flash | 18.9 | 0.53 |
| ev-D | single + opus | 16.5 | 0.67 |

Eight documents, two model families, two arms, two cases — **mean sentence length spans 16.5 to
21.9 words**, a 5.4-word window inside the composer's own 12-word design band [12, 24]. Nothing
in either arm targets a cadence, so this is where the generators default and it is the same place.
`GEN_SPECS.narrative.brief` (index.ts:1110) says *"vary sentence length"*; the single prompt says
*"Short sentences where a short sentence will do"*. Both are instructions with no number, and
`design-composer.md` §B1 already makes the argument that an instruction with no target produces
identical rhythm every time. The data is consistent with that.

This is the residue that is genuinely about *writing* rather than about the call or the client,
and it is **measurable without asking a model anything**.

### 2.5 The starvation trilemma — present in both arms, and the deepest form of the finding

The call demands particulars (Meridian Priority 1: *"in which specific places"*; Q3: *"how many
young people will take part"*). The ledger carries three referents. Grounding forbids invention.
Under those three constraints there are exactly three legal moves, and **all three are on the
critic's reject list**:

| move | who took it | how it reads | rule it satisfies |
|---|---|---|---|
| **write around it** — unnamed generality | uk-A, uk-B, uk-C ("two coastal delivery hubs", "four selected localities", "three towns") | *"swappable: yes"* on all four; *"never named, so reach-beyond-the-door cannot be assessed"* | `FACT_RULES` index.ts:74 — *"If history is unknown, write around it rather than fabricating it"* |
| **bracket it** — visible placeholder | uk-D, ev-C, ev-D | *"an unfinished template"*; ranked **last** in ukyouth by both critics | runD/prompt.txt rule 3 |
| **invent it** | ev-A: telephone `+961 6 380 000`, a street address, `800 linear meters`, `four key residential alleyways`, `1,200 residents` — **none in the ledger** | *"presents exact resident, distance, demographic and infrastructure figures with no explanation of where any of them came from"*; ranked **last** in evidence-poor by both critics | breaks Rule 3. A live grounding failure in the pipeline arm |

The two documents that invented the most and that bracketed the most are the two ranked last.
Neither dodge works. This is not a prose problem with a prose fix.

### 2.6 What the ranking actually tracks

`evidence-poor`, critic_a proper-noun counts and both critics' rank order:

| doc | variant | ledger-backed referents used | rank (both critics) |
|---|---|---|---|
| Doc 1 | B pipeline + opus | 3 (Bab al-Tabbaneh, Qobbe, Municipality of Tripoli) | 1 |
| Doc 2 | D single + opus | 2 | 2 |
| Doc 4 | C single + flash | 2 | 3 |
| Doc 3 | A pipeline + flash | 1 | 4 |

Perfect rank correlation with ledger-backed referent count, under both critic families
independently. On `ukyouth`, all four score zero and all four are refused. The one `fundable:
yes` in sixteen judgements went to the document with the most referents *and* the most explicit
refusal to fabricate (`ev-B`: *"We are not presenting dumping counts we have not yet collected"*).

The critics are not rewarding proper nouns as ornament. They are rewarding **derivability** —
their reject list says *"pseudo-precise figures with no derivation"* and *"arbitrary targets a
reader cannot source"*, not "insufficiently specific". `ev-A` was the most specific document in
the evidence-poor set and came last, because its specifics were unsourceable.

---

## 3. Ranked explanation, with confidence

**1. THE CONSTRAINT SET — the call plus the ledger plus grounding, as a joint system. ~45% of the effect. Confidence: high.**
The call fixes the section inventory verbatim, the word budget, the cap percentages, the
declaration text, and — through Q4 and the three priorities — four of the six recurring
argumentative moves. The ledger supplies three to five referents. Grounding forbids the rest.
The set of documents satisfying all of that is small, and four samples from a small set look
alike. Evidence: §1.1, §2.1 (the intersection dies when the grant changes), §2.2 (26 of 26
shared 4-grams are the call's own words), §2.5. This is candidates (b) and (c) — and they are
not separable, because it is their *conjunction* that shrinks the space.

**2. THE MEASUREMENT — ~25%, and it inflates the other 75% by an unknown amount. Confidence: high that it is defective; low on the size of the inflation.**
Four defects, §1.5. The decisive one is that "four different applicants" is not an available
answer. critic_b's evidence-poor justification is six ledger facts and nothing else — a correct
answer to a question that cannot discriminate. Until E-1 and E-2 run, **the "4/4 unanimous"
figure cannot be used as a launch gate and should not appear in a readiness assessment.**

**3. THE SCAFFOLDING — ~15%, and NOT exonerated by this run. Confidence: medium.**
Its measurable unique lexical contribution is ~zero (§2.3), and the flattest rhythm in the set is
a pipeline arm (§2.4) on n = 1. But §0.2 shows the single-prompt arm re-imposed the same
constraints by hand, so this run never tested the scaffolding — it tested the staging. The
scaffolding is guilty of the phase table, the design JSON's fixed ontology, and (probably) the
flattened cadence; it is *not* guilty of the intersection in §2.1.

**4. GENRE plus the critic's own LLM-prose prior — ~10%. Confidence: low, because untested.**
No human-written control existed in either packet. *"Template diction"* was scored against four
documents with three shared novel bigrams between them; that judgement cannot have come from the
texts. Candidate (d) is a real risk to every quality verdict this project has recorded and it is
answerable for the price of two critic calls (E-1b).

**5. GENERATOR HOUSE REGISTER — ~5%. Confidence: medium.**
Refuted as *sole* cause (it survived two families), present as a contributor: the two opus
documents both volunteer their own evidential weakness (`ev-B` *"We are not presenting dumping
counts we have not yet collected"*; `ev-D` *"We have not run a formal survey and we hold no
baseline data"*) and the two flash documents do not. That is a family trait, and it is the trait
the critics rewarded.

**Verdict on the framing.** The brief says "neither the pipeline nor the model explains it,
because it survived varying both". Correct — but the third thing is not a hidden house voice.
It is that the pipeline and the single prompt were *given the same instructions*, about *the same
client*, against *the same call*, and then compared by an instrument that asked whether they came
from the same client.

---

## 4. Experiments that would distinguish these — all offline, all via the OpenRouter MCP tool

Ordered by information per dollar. Total for all four: **under $15**.

### E-1 · The instrument test — 4 critic calls, ~$1, no generation. RUN FIRST.

Re-critic the **existing eight documents** with three changes:

- **(a) Forced-choice with ground truth.** *"Two of these four were written by one process and
  two by another. Which two go together?"* Ground truth: {A,B} vs {C,D}. Chance on an unordered
  pairing of four is 1/3. 2 critics × 2 cases = 4 trials. **If the critic cannot beat chance at
  identifying which documents actually share a process, then "one system" is not detecting the
  system**, and explanation 2 moves to rank 1.
- **(b) Neutral open question, and no supplied vocabulary.** Delete the nine-item reject list from
  Q4 and delete *"Be hard to please" / "Most are mediocre"*. Ask: *"Name anything these
  documents have in common that you would not expect from four independent applications to this
  call. If nothing, say nothing."* Compare the returned list against §1.1: how much of it is the
  call's own requirements?
- **(c) The negative branch must be reachable.** Do not tell the critic the applicant. Strip
  identity from the packet header and ask *"how many distinct organisations wrote these?"*

Decision rule: if (a) is at chance and (b) returns only call-mandated items, the ONE-SYSTEM
finding as recorded is an artefact and iteration 1 §3's last paragraph must be corrected.

### E-2 · The four-applicant control — the direct test of candidate (e). 4 generations + 2 critic calls, ~$6.

Build **four different synthetic applicants** on **one** grant, each with its own ledger
(`ladder/` already contains one complete synthetic applicant — Halewater Commons Trust,
`fixture-README.md`, deterministically referent-counted by `verify.ts` against
`worker/proper_nouns.ts`; three more of the same shape are cheap to write). Generate one document
each through variant **B** only. Present them exactly as iteration 1 did and ask the identical
Q6.

- Still "one system" → the finding is about Ktebli, and explanation 3 rises.
- "Four applicants" → the iteration-1 unanimity was substantially the shared client, since the
  only variable changed is whether the applicants differ.

This is the cleanest single discriminator available and it is the experiment that should have
been run instead of the iteration-1 Q6.

### E-3 · The constraint ablation — the untested candidate (a). 3 generations, ~$0.70, measured deterministically.

Same applicant, same grant, single-prompt delivery, three prompts:

1. **Bare:** the guidance text + the ledger + `FACT_RULES` only. No style block, no word-budget
   advice, no "what a good answer looks like" block, no structure restatement.
2. **As run:** `runD/prompt.txt` verbatim (the control).
3. **Composed:** bare, plus the composer's axes as *numbers and codes* — a `spine`, a `stance`, a
   `cadence` target (μ, σ/μ), an `opening_move`, a `closing_move`, a `tabular_policy`.

Measure **with no model in the loop**: mean sentence length, σ/μ, paragraph-length distribution,
heading count, table rows, distribution of grammatical subject (`We` / `The organisation` /
passive / beneficiary), opening-move class, and cross-document shared-4-gram count. If (3) moves
those and (1) does not, the composer acts on the surface the critics named — proven without
asking anything to count, which CLAUDE.md requires.

### E-4 · The ledger saturation ladder — candidate (c). 4 generations + 2 critic calls, ~$6. The fixture already exists.

`scratchpad/qloop/ladder/` holds `ledger-n03/n06/n09/n12.json` for one synthetic applicant, with
referent counts verified by the repo's own `properNouns()` (`verify-output.txt`). Generate at each
rung through variant B and plot, against *n*: critic proper-noun count, `swappable: yes/no`, and
`fundable`. **The output is a number: the referent count at which `swappable` flips to `no`.**
That number is the specification for the pre-payment evidence interview, and it replaces the
guess in `challenge-evidence.md` ("6–12, directionally right, an order of magnitude short").

### Not runnable here, and it matters

**A human control.** Every quality verdict this project holds rests on critics that have never
been shown a real, funded, human-written application in the same packet. Until one is, *"reads
machine-generated"* has no calibration and candidate (d) stays open. This needs one real
application text, which outbound access does not currently permit. Flagging it as a standing
gap, not proposing a workaround that fabricates one.

---

## 5. What must change

### 5.1 The MEASUREMENT — the largest change, and a prerequisite for the other two

1. **Retire the ONE-SYSTEM question as asked.** It has no reachable negative branch when all
   documents name one applicant, and it is preceded by a nine-item sameness checklist. Do not
   quote "4/4 said one system" as a gate result again without E-1.
2. **Replace it with a discrimination score against ground truth.** *N* documents from *N*
   distinct applicants on one call; the critic partitions them; score accuracy against chance.
   That yields a number that can move, and a target: a served set is distinct when a hostile
   assessor cannot group it better than chance.
3. **Add a deterministic style panel that never asks a model anything.** Mean sentence length,
   σ/μ, paragraph-length distribution, heading count, table-row count, grammatical-subject
   distribution, opening/closing move class, and shared-4-gram count across every document served
   to the same grant. All eight of those are computed in this report from `.md` files with no
   model involved. They are the measures the critics were gesturing at, and CLAUDE.md already
   requires deterministic verification of anything a model cannot count.
4. **Never again show one critic several documents from the same applicant and ask an identity
   question.** Per-document questions (`swappable`, `fundable`, proper-noun count) are sound —
   `swappable` in particular tracked the ledger perfectly (§2.6) — and should be kept.
5. **Report the intersection, not the impression.** §2.1's table (feature × arm, across two
   grants) is reproducible, mechanical, and it is what actually distinguishes a house style from
   a call requirement.

### 5.2 The COMPOSER

- **It is not wired.** `composition_axes` appears in `supabase/migrations/20260826160000_unbounded_composer.sql`
  and in `tests/exclusivity/ceiling_test.sql` and **in no `.ts` file at all**. The worker still
  calls `claim_approach` at index.ts:1491–1496 with `p_voice_kind: "custom"` and passes
  `strategy.template_style` / `strategy.opening_style` into the prompt as bare JSON at
  index.ts:1589. Until the generation path reads the axes, the composer produces distinct
  database rows and identical prose — the exact failure the brief names.
- **Prioritise the axes this evidence supports, and deprioritise the rest.** The measurements
  above say the sameness is *not* lexical (§2.2) and *is* rhythmic and structural (§2.1, §2.4).
  So: **B1 `cadence` (numeric μ and σ/μ), B3 `stance`, A1 `spine`, C2 `closing_move`, C3
  `tabular_policy`** carry the load. Every one is deterministically verifiable after generation,
  which means an axis the generator ignored can be *caught* rather than assumed.
- **A2 `move_order` collapses on exactly the cases that matter.** `design-composer.md` concedes
  it: where `application_structure.defined_by_donor` is true (index.ts:1591–1593) the heading
  sequence is pinned and A2 has one value. Both iteration-1 grants are donor-structured, and so
  is most of the market. The distinctness budget must be sized assuming A2 contributes nothing.
- **B5 `concretion_anchor` is capped by the ledger, not by the composer.** With three referents
  there are three anchors. E-4 gives the real number.

### 5.3 The SCAFFOLDING — patch specs

The orchestrator applies these; I have not edited `index.ts`.

**PS-1 · `STYLE_RULES` mandates one rhythm for every document in the product.**
File: `supabase/functions/worker/index.ts`, lines 77–82. Applied to every narrative (line 1626),
every validate correction, and every revision.

Anchor (exact, lines 80–82):
```
  "persuasive without sounding promotional, structured around the donor's requirements, easy for an " +
  "evaluator to scan. Avoid AI-sounding filler, excessive adjectives, and empty claims like " +
  "'groundbreaking', 'transformative' or 'revolutionary' unless concretely justified. Do not repeat the " +
  "same argument across sections. Prefer a short paragraph over a long one when it communicates the point.";
```
Replacement:
```
  "persuasive without sounding promotional, structured around the donor's requirements. " +
  "Avoid AI-sounding filler, excessive adjectives, and empty claims like " +
  "'groundbreaking', 'transformative' or 'revolutionary' unless concretely justified. Do not repeat the " +
  "same argument across sections.";
```
Why: *"easy for an evaluator to scan"* and *"Prefer a short paragraph over a long one"* are
unconditional rhythm mandates. They are the only clauses in the product that decide paragraph
shape, they apply identically to every applicant, and they sit in the same prompt as the
applicant-voice segment they contradict (index.ts:1218). Paragraph shape must become a
per-proposal decision (composer B2/B1), and it cannot be while a global string dictates it. The
anti-jargon and no-repetition clauses are retained — they are quality floors, not style choices.
Note: `ukyouth-A`, the arm carrying this string, has the lowest burstiness in the set
(σ/μ = 0.35). n = 1; E-3 is the test.

**PS-2 · `GEN_SPECS.narrative.brief` gives a rhythm instruction with no target.**
File: `index.ts`, line 1110.

Anchor (exact substring):
```
Concrete, specific, human; vary sentence length; no em dashes; no invented anecdotes
```
Replacement:
```
Concrete, specific, human; no em dashes; no invented anecdotes
```
plus, in the composed prompt assembled at line 1626, a cadence directive supplied per proposal
(*"Target a mean sentence length of N words with a standard deviation of M"*) once the composer
is wired. Why: `design-composer.md` §B1 argues that *"vary sentence length"* is an instruction
with no target and therefore produces the same variation pattern on every job; §2.4 measures
eight documents inside a 5.4-word window and is consistent with that. **Do not apply PS-2 before
the composer supplies the replacement directive** — removing the clause with nothing behind it
leaves cadence wholly to the generator's default, which is the state §2.4 measures. PS-1 and
PS-2 are one change in two places.

**PS-3 · The starvation trilemma is an intake problem, and belongs before payment.**
No prose rule can fix §2.5: writing around the hole yields *"swappable"*, bracketing it yields
*"an unfinished template"*, and filling it breaks Rule 3 (and did, in `ev-A`). The only remaining
move is to **not take the order** when the call demands particulars of a kind the ledger cannot
carry — which is Rule 2 (*"No money is taken for an order the system cannot fulfil"*) applied to
evidence sufficiency, and which is exactly where CLAUDE.md's decision 1 already puts the intake
expansion.

The mechanism, stated as a design requirement rather than a finished patch because another agent
owns the evidence layer:

- At `analyze`, extend the JSON schema at index.ts:1242 (alongside `application_structure`) with
  `"required_particulars":[{"kind":"place_below_city"|"venue"|"vendor"|"named_person"|"named_partner"|"dated_prior_result","clause":string,"material":boolean}]`,
  extracted from the guidance the same way `application_structure` is, with the same
  never-invent instruction at line 1249.
- Compare it against the ledger's referent inventory using the existing deterministic counter,
  `worker/proper_nouns.ts` (`properNouns`, `properNounAudit`), which already excludes the
  applicant's own name and genre capitals, and which the `ladder/` fixture already validates.
- The gate **refuses by default**: an order proceeds only when every `material: true` particular
  kind is affirmatively matched by at least one ledger item. No flag disables it. It runs before
  payment, so nothing is taken for an order that cannot be fulfilled; it emits its inputs,
  outputs and decision to the append-only events table (Rule 9); and where it refuses, the
  customer is asked for the missing particulars — an automated interview, no human in the loop
  (Rule 7).
- E-4 sets the threshold. Do not pick a number before it runs.

**PS-4 · One live grounding failure to log now.**
`out-evidence-poor-A.md` (pipeline + current generator) asserts `Telephone: +961 6 380 000`, a
street-level `Physical Address`, `800 linear meters`, `four key residential alleyways` and `1,200
individuals`. None is in `case-evidence-poor.json`'s nine ledger items. This is a Rule 3 breach
in the pipeline arm, produced offline by the replay rather than by deployed v26 — but the prompts
were transcribed verbatim, so it should be reproduced against the real `check` stage and the
Claim Ledger before it is dismissed as a replay artefact. It is also the only case in the set
where a fabricated particular reached a finished document, and both critics ranked that document
last for it.
