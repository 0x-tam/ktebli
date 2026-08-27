# The word-limit question, settled from code

**Date:** 2026-08-27 · **Method:** code reading + independent recount of the 20 replayed documents.
**No model call was made.** No network access was used. Both blockers were respected.

---

## VERDICT

> # ENFORCEMENT NOT EXERCISED

The counting-and-repair half of enforcement ran in every pipeline arm and is recorded call by call
in the meta files. The **deciding** half — the terminal refusal at `worker/index.ts:681` and the
second, independent gate at `worker/index.ts:921-922` in the `package` stage — was **never
exercised**: the replay harness was instructed to produce a deliverable, and the sub-agents
explicitly continued past the throw. `package`/`deliver` were not replayed at all, in any arm.

So the 19-of-20 measurement says the generator overshoots the worker's own counter badly. It says
nothing about whether an order survives enforcement, because the outcome of enforcement was
suppressed by the harness. **The live run is still required** — but for a different question than
the one this evidence was thought to raise. See "What the live run must now answer".

**And the 19-of-20 number itself does not survive recount.** It was measured against the whole
markdown document. Both fixtures state in terms that headings, the budget table and the declaration
are excluded from the limit. Recounted on the donors' own stated rule, **8 of 20** are over, and
**7 of those 8 are single-prompt arms that run no enforcement at all**. Detail in §A3.

---

## (a) Which stages did the replay actually execute?

### The five enforcement sites, and whether each ran

| # | Site | Line | Ran in replay? |
|---|---|---|---|
| 1 | `gen:narrative` → `generateValidated(..., narrativeOpts)` | 1627 | **YES**, all 3 attempts, in all 10 pipeline documents |
| 2 | `validate` correction → `generateValidated(..., narrativeOpts)` | 1762-1771 | **YES** in 9 of 10 (n09-B's correction was refused mid-way) |
| 3 | `revise` → `generateValidated(..., narrativeOpts)` | 1789, 1803 | n/a — no revision requests in either setup |
| 4 | `check` similarity rewrite → `generateValidated(..., narrativeOpts)` | 1843 | **NO** — `check` skipped in every arm ("no sibling proposal on this grant") |
| 5 | `package` → `buildDoc` → `contentViolations` → **throw** | 921-922 | **NO** — every meta records "package/deliver (deterministic, not replayed)" |
| — | the terminal refusal inside `generateValidated` | 681 | **REACHED, THEN OVERRIDDEN** |

### Evidence, quoted from the meta files

The replay was not a 2-call shortcut for the pipeline arms. `calls` and `stages_run` show the real
chain:

- `qloop/meta-evidence-poor-A.json` — `calls: 13`, `stages_run` includes
  `"gen:narrative(3 calls: attempt 1 = 1059w, repair = 891w, length-only shorten = 797w)"` and
  `"validate(round 0: … correction pass returned 862w and needed a further repair to 773w…)"`.
  That is `generateValidated`'s attempt-1 → repair → length-only-shorten ladder, run verbatim.
- `qloop/ladder/meta-n03-A.json` — `calls: 12`, itemised as
  "gen:narrative(1) plus BOTH generateValidated repair attempts (attempt 2 repair, attempt 3
  length-only shorten), validate.claim_ledger + validate.review at round 0, validate.correction,
  validate.claim_ledger at round 1."
- `qloop/ladder/meta-n09-A.json` — `calls: 14`, "gen:narrative 1 plus BOTH generateValidated
  repairs … validate.correction 1 plus BOTH of its generateValidated repairs."

And the sub-agents recorded, unprompted, that the gate **fired**:

- `meta-ukyouth-A.json`: *"generateValidated would have thrown 'content validation failed:
  over_word_limit' at attempt 3, failing the stage. … at round === maxRounds the stage throws
  'validation unresolved'. On a real order this proposal ends in `attention` … **I continued past
  the throw to produce the required deliverable.**"*
- `meta-evidence-poor-B.json`, finding F1: *"THE REPLAY DOES NOT ACTUALLY COMPLETE. … generateValidated
  exhausts its 3 attempts and throws 'content validation failed: over_word_limit'. On the real worker
  gen:narrative would have failed the order into attention. **The document shipped here is the last
  complete draft the chain held.**"*
- `meta-n06-A.json`: *"the attempt-3 pure-shortening call … returned the document BYTE-IDENTICAL …
  Under a strict reading of contentViolations the stage then throws."*
- `meta-n09-A.json`: *"Round 1 of validate was NOT run, and correctly so: the correction pass's own
  generateValidated exhausted all three attempts on over_word_limit and would have thrown."*

**The over-limit documents in both reports are harness artefacts produced by overriding the gate.**
On the real worker they are not documents — they are orders stalled in `attention`.

### The single-prompt arms ran no enforcement whatsoever

`meta-ukyouth-C/D.json` — `stages_run: ["single_prompt_generation"]`, `calls: 2`.
`ladder/meta-n03-D.json` — `calls: 1`, *"No analyze stage, no org research, no voice stage, no
strategy reservation, no design object, no validation loop, no claim ledger."*
`ladder/meta-n03-C.json` — `calls: 2`, and both were the same prompt (the first truncated).

A document produced in 1-2 calls did not run a 10-stage chain, exactly as the task anticipated.
Ten of the twenty documents are in this category.

### A3 — the recount, and the correction to both reports

I recounted all 20 documents myself rather than trust the sub-agents' figures. Script:
`/tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/wl/count3.py` and `count4.py`. Nothing was asked of a model.

Both fixtures state the counting rule explicitly:

- `ladder/grant.json`: *"The five answers together must not exceed 1,200 words. This is a hard limit
  … **Headings, the budget table and the declaration are not counted towards the limit.**"*
- `case-ukyouth.json`: *"The five answers together must not exceed 1,400 words. … **we do not count
  headings, the budget table or the declaration towards the limit.**"*
- `case-evidence-poor.json`: *"The narrative across **sections 2 to 6** must not exceed 800 words in
  total. **Section 1 and Section 7 are not counted.**"*

Recount, donor's own rule (heading lines dropped; budget table and declaration dropped; inline
tables inside answers kept, which is the strict reading):

| doc | limit | `wc -w` whole | worker `wordCount()` whole | **donor rule** | verdict |
|---|---|---|---|---|---|
| n03-A pipeline+flash | 1200 | 1532 | 1395 | **1103** | inside −97 |
| n03-B pipeline+opus | 1200 | 1605 | 1465 | **1216** | over +16 *(disputed: sub-agent measured 1189)* |
| n03-C single+flash | 1200 | 2207 | 2101 | **1760** | **OVER +560** |
| n03-D single+opus | 1200 | 1427 | 1373 | **1172** | inside −28 |
| n06-A pipeline+flash | 1200 | 1406 | 1265 | **973** | inside −227 |
| n06-B pipeline+opus | 1200 | 1520 | 1392 | **1122** | inside −78 |
| n06-C single+flash | 1200 | 1919 | 1844 | **1586** | **OVER +386** |
| n06-D single+opus | 1200 | 1467 | 1411 | **1186** | inside −14 |
| n09-A pipeline+flash | 1200 | 2020 | 1776 | **1410** | **OVER +210** |
| n09-B pipeline+opus | 1200 | 1463 | 1370 | **1042** | inside −158 |
| n09-C single+flash | 1200 | 1935 | 1826 | **1523** | **OVER +323** |
| n09-D single+opus | 1200 | 1690 | 1616 | **1365** | **OVER +165** |
| ukyouth-A pipeline+flash | 1400 | 1658 | 1480 | **1132** | inside −268 |
| ukyouth-B pipeline+opus | 1400 | 1533 | 1443 | **1199** | inside −201 |
| ukyouth-C single+flash | 1400 | 1677 | 1590 | **1295** | inside −105 |
| ukyouth-D single+opus | 1400 | 1779 | 1698 | **1425** | **OVER +25** |
| ev-poor-A pipeline+flash | 800 | 773 | 678 | **614** | inside −186 |
| ev-poor-B pipeline+opus | 800 | 934 | 826 | **729** | inside −71 |
| ev-poor-C single+flash | 800 | 1188 | 1122 | **898** | **OVER +98** |
| ev-poor-D single+opus | 800 | 1073 | 1070 | **905** | **OVER +105** |

**Auditing the auditor.** My figures reproduce the sub-agents' own donor-rule counts exactly where
they published them (n03-A 1103, n03-D 1172, n06-A 973, n06-B 1122, n06-D 1186, n09-A 1410,
n09-B 1042, n09-D 1365, n03-C 1760). The single disagreement is n03-B: I get 1216, the sub-agent got
1189, both within ±30 of a 1200 limit. I mark it disputed rather than pick a side.

**Where the published headline numbers came from.** Iteration 1's "7 of 8" reproduces exactly if you
count `wc -w` over the whole markdown against the bare limit (ukyouth 1658/1533/1677/1779 all >1400;
ev-poor 773 under, 934/1188/1073 all >800). The ladder's "12 of 12" reproduces on the same basis
including its synthetic-fixture HTML header. Both headline numbers are measured against a basis the
donors explicitly exclude. Neither report's own sub-agents believed the headline: every meta file
carries the donor-rule figure alongside it, and several say in terms that the document is compliant.

**By mode, on the donor's rule:**

| | documents | over the donor's real limit |
|---|---|---|
| pipeline arms (A, B) — enforcement present | 10 | **1 firm (n09-A +210) + 1 disputed** |
| single-prompt arms (C, D) — no enforcement | 10 | **7** |

That is the opposite of the story "19 of 20 over" tells. The arms that carry enforcement are 9/10
compliant; the arms that carry none are 3/10 compliant.

---

## (b) Where the word limit is actually enforced — every site, traced

### The limit value: where it comes from

- `analyze` asks a model for `format_spec` (**line 1247**), whose schema is
  `"max_words":number|null` — **a bare integer with no scope field**.
- The extraction rule (**line 1253**) is *"format_spec: ONLY what the donor explicitly states; every
  unstated field null. Never guess."* Nothing asks the model to record what the limit covers.
- `normalizeFmt` (**lines 353-372**) coerces it: `maxWords: num(r.max_words, 100, 100000)` (**369**).
  Values outside 100…100000 become `null`, which silently removes the gate.
- The gen/validate stage reads it once: `const fmt = normalizeFmt(analysis?.format_spec)` (**1182**)
  and builds `narrativeOpts` (**1196**):
  `{ requiredSections: fmt.requiredSections, maxWords: fmt.maxWords, minWords: 450 }`.

### The counter

**Line 564:**
```ts
function wordCount(md: string): number {
  return md.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9؀-ۿ]/.test(w)).length;
}
```
Deterministic. Strips markdown syntax characters, counts alphanumeric-bearing tokens. Its own comment
(lines 555-563) says it is calibrated to approximate a word processor "because that is what a donor
checks against". It is applied to **`md` — the entire markdown document**.

### The gate

**Line 617**, inside `contentViolations`:
```ts
if (opts.maxWords && wordCount(md) > opts.maxWords) v.push("over_word_limit");
```
Comment above it (614-616): *"A donor word limit is a hard limit: never ship over it."*
Strictly greater-than. No tolerance band. Refusal by default — the violation is emitted unless the
count clears, and nothing can assert past it.

### The correction ladder — `generateValidated`, lines 634-682

| step | line | what happens |
|---|---|---|
| attempt 1 | 635-637 | generate, `contentViolations`; clean → return |
| targets | 644-645 | `TARGETS = [0.94, 0.85, 0.78]`; `targetAt(i) = round(maxWords * TARGETS[i])` |
| attempt 2 — repair | 654-664 | a repair prompt carrying `lengthDetail`: *"The draft is {wordCount(t)} words against a hard limit of {maxWords}: cut at least {wordCount(t) − targetAt(1)} words…"* — the numbers in the prompt are **computed by `wordCount`, not by the model**. Re-check; clean → return |
| attempt 3 — length-only shorten | 670-678 | if `over_word_limit` is the ONLY remaining violation, a pure shortening call: *"Shorten the document below to at most {targetAt(2)} words. It is currently {wordCount(repaired)} words. Change NOTHING else. Keep every heading … keep every number, target and commitment … Do not summarise and do not drop a section."* |
| **exhaustion** | **681** | `throw new Error("content validation failed: " + v.join(","))` |

**Rounds: exactly two correction rounds, then refusal.** There is no fourth attempt and no bypass.

### The second, independent gate — `package`

**Lines 1908-1910** rebuild the same options for the render path, **line 1909** calls `buildDoc`,
which at **line 921-922** re-runs `contentViolations` on the final markdown and throws
`content validation at render: over_word_limit`. `deliver` is never reached. Grepping the whole file
for word checks in `deliver` returns nothing.

Note the ordering at 1909-1921: `buildDoc` throws **before** the QA record is written, so
`qa.donor_requirements = "passed"` (line 1919) can only be reached by a document that already
cleared the gate. No stage asserts its own pass. That part of the invariant set holds.

### What happens when it still exceeds after the last round

`gen:narrative` throws → the stage fails → the order lands in `attention`. Per launch-readiness P0-4
there is **no failure notification**, so the customer is never told. That is the true consequence of
the word limit today, and it is what the replay suppressed.

**Where the limit is NOT enforced.** Only the narrative carries `maxWords`. `concept_note`,
`workplan`, `logframe`, `budget_justification` and `cover_email` get `{}` or `{signoff:true}`
(line 1618) — correct, since the donor limit governs the application narrative.

---

## (c) Truncate, or regenerate? — the critical sub-question

**It regenerates. It never truncates. Invariant 5 holds in code.**

Every response to `over_word_limit` is a model rewrite of the complete document (lines 658-662,
671-678, 1762-1771), and every exit is either a clean re-check or a throw. I grepped every
`slice(...)` in the file: all twenty are **prompt-input caps** (`narrative.slice(0, 28_000)` at 1694
and 1716, `text.slice(0, 40_000)` at 1254, and so on). None of them touches a document on the path to
`package`. The only content-removing operation on the delivery path is line 1894,
`.replace(/^#\s+.*\n/, "")`, which strips a single leading H1 title line before rendering — not a
length remedy.

**But there is a real finding here, pointing the other way.** Attempt 3 asks a model to cut to **78%
of the donor's limit** while keeping every heading, section, number, target and commitment. Combined
with the mis-scoped count (§e), that is a destructive rewrite aimed at a limit the document was never
breaking. It is not truncation, so it does not breach invariant 5 — but it is a compliance-shaped
quality loss, and it is measurable:

- `meta-ukyouth-A.json`: three shortening rounds ran; *"the pipeline therefore enforced a limit
  roughly 460 words stricter than the real one, and burned three destructive shortening rounds
  stripping substance out of a document that had 380 words of headroom. **Every cut was a net quality
  loss for no compliance gain.**"*
- `meta-ukyouth-B.json`: *"the repair call then demanded a cut of at least 680 words, the attempt-3
  shortener demanded 1092, and the finished document ends at 1199 donor-counted words — **201 words of
  the donor's allowance thrown away on a limit the document was never breaking.**"*
- `meta-evidence-poor-A.json`: final document is **639** donor-counted words against an 800 limit —
  *"161 words of headroom the applicant paid for and did not get. On a case where the ledger is this
  thin, headroom is the only thing that could have carried more specificity."*

Two of the three sub-agents independently linked this to the proper-noun/particularity failure that
is the project's standing P0. That link is plausible and it is **not established** — it was never
tested, and testing it needs the live run.

**One further defect in the same machinery.** The correction pass at 1762-1771 tells the model *"the
corrected version must not be longer than the current draft"*, and it grows anyway — 797→862 in
evidence-poor-A, 881→1026 in evidence-poor-B (+16%). Grounding fixes cost words; the prompt pretends
they do not, then re-enters `generateValidated`, which spends attempts on a length problem the
correction itself created.

---

## (d) Is the count deterministic?

**Yes at every gate, and no model is ever asked to count anything.**

- The gate (617), the repair-prompt arithmetic (656), the shorten target (673), the correction-prompt
  length line (1768) and the QA record (1920) all call `wordCount()` (564). Pure string function.
- Grepping for any prompt asking a model for a count returns nothing. The CLAUDE.md lesson (two
  critics wrongly calling a 596-word document over 600) is respected in code.

**But the limit *value* is model-supplied**, and that is where the defect is. `max_words` is one
field of a model-extracted JSON object (1247). The model reads *"The five answers together must not
exceed 1,200 words … Headings, the budget table and the declaration are not counted"* and returns
`1200`. The number survives; the scope is discarded, because the schema has nowhere to put it. This is
an **extraction** defect, not a counting defect, and it is the root cause of §e.

Two smaller determinism-adjacent notes:
- `num(r.max_words, 100, 100000)` (369) silently drops any stated limit below 100 words. A donor
  asking for a 75-word summary gets **no gate at all**. Fails "refusal by default".
- `wordCount` treats `1.` in a numbered list as a word and strips table pipes. Fine as an
  approximation, but it means the gate is a few percent above a word processor on list-heavy text.

---

## (e) Does the limit apply to the right text?

**No. It counts the whole markdown document — headings, budget table, declaration, everything — and
both fixtures explicitly exclude all three.** There is no scope-awareness anywhere in the code path:
`Fmt` (349-353) has no scope field, `ContentOpts` (569) has no scope field, and line 617 passes the
raw `md`.

Measured over-count (worker `wordCount()` over the whole document, minus the donor-rule count):

| fixture | over-count range | as a share of the limit |
|---|---|---|
| ladder (1200) | **201 – 366 words** (mean ≈ 281) | **17% – 31%** of the allowance |
| ukyouth (1400) | 244 – 348 words | 17% – 25% |
| evidence-poor (800) | 64 – 224 words | 8% – 28% |

Concretely, the gate on the 1200-word ladder fixture behaves as a limit of roughly **900-1000 words**.
Every pipeline arm was therefore squeezed against a limit ~23% stricter than the donor's.

The consequences run in both directions, and the dangerous one is the first:

1. **False refusals.** A compliant document is refused and the order stalls in `attention` with no
   notification. `meta-evidence-poor-B.json`: *"the pipeline would reject a compliant proposal"*
   (746 donor-counted words against an 800 limit). This is the launch-relevant failure. It touches
   invariant 2 (money taken for an order that cannot be fulfilled) and invariant 8 (no paid order
   fails in silence).
2. **Real over-length can still slip past the donor while passing nothing.** n09-A is 1410
   donor-counted against 1200 — genuinely over. It also measured 1776 whole-document, so the gate
   would still have refused it. No delivered document in this evidence would have gone out over a
   donor limit. **Invariant 1 was not breached anywhere in these 20 documents.**
3. **Paid-for headroom thrown away** — §c.

**Does the whole-document rule ever match a donor?** Yes: a donor stating a bare limit with no
exclusions. That is the case the current code is correct for, and it must stay the default.

---

## The generator-overshoot finding, on its own terms

Stated separately because it is worth knowing regardless of the verdict: it measures how much work
enforcement is doing.

Against the worker's own counter, on the ladder's 1200-word fixture, first-pass generation lands at:

| arm | attempt-1 length | over the worker's gate |
|---|---|---|
| n03-A | 1594 | +33% |
| n06-A | 1619 | +35% |
| n09-A | ~2075 whole-file | +48% |
| n03-B | ~1870 (ukyouth equivalent) | — |
| n03-C / n06-C / n09-C (single, flash) | 2207 / 1919 / 1935 | +60% to +84% |

The repair ladder does close most of that gap — `1594 → 1263 → 1213` at n03-A — but **it misses its
target on every single attempt**, at every rung, in both generators. `meta-n06-A.json` records the
worst case: the attempt-3 pure-shortening call *"returned the document BYTE-IDENTICAL — it cut nothing
at all."* `meta-ukyouth-A.json` records the same thing on a different fixture: *"a fourth shortening
call returned the document byte-identical (zero words cut)."*

That is the finding: **the shortening mechanism is a model asked to hit a numeric target it cannot
measure, and it plateaus.** `generateValidated`'s own comment at 638-643 already knows this —
*"A model cannot count its own words"* — and the `TARGETS` ladder is the mitigation. The ladder shows
the mitigation working partially and stalling out. Fixing the scope (§e) removes most of the pressure,
but it does not fix the plateau: a document genuinely 40% over will still exhaust three attempts and
refuse. Refusal is the correct behaviour there, and it is worthless while P0-4 stands.

One more thing the overshoot data says plainly, and it is a point in the architecture's favour: the
single-prompt arm at the current generator overshoots worst of all (+60% to +84%), and 7 of the 10
enforcement-free documents are over the donor's real limit against 1-2 of 10 for the pipeline. The
`generateValidated` ladder, mis-scoped as it is, is the difference.

---

## What the live run must now answer

The question has changed. It is no longer *"does an over-length document get delivered?"* — code
says no, at two independent gates, and the recount finds no delivered document over a donor limit.
It is:

1. **How often does `gen:narrative` fail the order outright on `over_word_limit`?** In this evidence,
   under a strict reading, it would have failed **at least 5 of 10** pipeline documents. If that rate
   is real, most paid Competitive/Full orders never finish, and nobody is told. That is the launch
   blocker, and it is P0-3 + P0-4 wearing a word-limit costume.
2. **Does fixing the scope (patch below) change that rate?** On these 20 documents it would clear
   9 of 10 pipeline arms.
3. **Does the recovered headroom carry more particularity?** Untested. Do not assume it.

---

## PATCH SPEC — scope the word limit to the text the donor actually counts

Refusal-by-default is preserved throughout: **when the donor states no scope, behaviour is unchanged
byte for byte.** Scope is only ever narrowed by an exclusion the donor's own text states AND that
matches a section the donor itself defined. An unmatched exclusion is discarded, not honoured. No
config flag; no environment-dependent path; no new service.

### Patch 1 — teach `analyze` to record the scope

**File:** `supabase/functions/worker/index.ts`
**Anchor (line 1247), exact:**
```
      `"format_spec":{"font":string|null,"font_size_pt":number|null,"line_spacing":number|null,"margin_inches":number|null,"page_size":string|null,"max_pages":number|null,"max_words":number|null,"required_sections":[string]}}\n` +
```
**Replace with:**
```
      `"format_spec":{"font":string|null,"font_size_pt":number|null,"line_spacing":number|null,"margin_inches":number|null,"page_size":string|null,"max_pages":number|null,"max_words":number|null,"max_words_scope":{"excludes_headings":boolean,"excluded_sections":[string]},"required_sections":[string]}}\n` +
```

**Anchor (line 1253), exact:**
```
      `- format_spec: ONLY what the donor explicitly states; every unstated field null (or empty array). Never guess.\n\n` +
```
**Replace with:**
```
      `- format_spec: ONLY what the donor explicitly states; every unstated field null (or empty array). Never guess.\n` +
      `- format_spec.max_words_scope: a donor word limit is usually SCOPED. Record the scope ONLY if the donor states it in words. Set excludes_headings true only if the donor says headings/question text are not counted. List in excluded_sections the section titles the donor says do NOT count towards the limit (a budget table, a declaration, a cover sheet, annexes, an identification section), copied EXACTLY as they appear in required_sections. If the donor states a bare limit with no scope, return {"excludes_headings":false,"excluded_sections":[]}. Never infer an exclusion the text does not state — an invented exclusion would let an over-length application be submitted.\n\n` +
```
**Why:** the limit is currently extracted as a bare integer and the donor's own scope sentence is
thrown away at the schema boundary (§d). This is the root cause; everything else is downstream.

### Patch 2 — carry the scope through `Fmt`, and gate it against the donor's own section list

**Anchor (lines 349-353), exact:**
```
interface Fmt {
  font: string | null; sizePt: number | null; lineSpacing: number | null;
  marginIn: number | null; pageSize: "A4" | "Letter" | null;
  maxPages: number | null; maxWords: number | null; requiredSections: string[];
}
```
**Replace with:**
```
interface Fmt {
  font: string | null; sizePt: number | null; lineSpacing: number | null;
  marginIn: number | null; pageSize: "A4" | "Letter" | null;
  maxPages: number | null; maxWords: number | null; requiredSections: string[];
  // Donor word limits are scoped. Both are narrowing-only and are accepted only
  // when the donor states them; an exclusion that does not name a section the
  // donor itself defined is discarded, so a hallucinated exclusion cannot widen
  // the allowance. Empty/false reproduces the pre-scope whole-document count exactly.
  excludesHeadings: boolean; excludedSections: string[];
}
```

**Anchor (lines 362-372), the `return {` block of `normalizeFmt`, exact:**
```
  return {
    font,
    sizePt: num(r.font_size_pt, 8, 14),
    lineSpacing: num(r.line_spacing, 1, 3),
    marginIn: num(r.margin_inches, 0.5, 2),
    pageSize,
    maxPages: num(r.max_pages, 1, 200),
    maxWords: num(r.max_words, 100, 100000),
    requiredSections: Array.isArray(r.required_sections) ? (r.required_sections as unknown[]).map(String).filter((s) => s.trim().length > 2).slice(0, 20) : [],
  };
```
**Replace with:**
```
  const requiredSections = Array.isArray(r.required_sections) ? (r.required_sections as unknown[]).map(String).filter((s) => s.trim().length > 2).slice(0, 20) : [];
  const scope = (r.max_words_scope && typeof r.max_words_scope === "object" ? r.max_words_scope : {}) as Record<string, unknown>;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  // An exclusion is honoured only when it names a section the donor's own
  // required_sections list carries. This is the same asymmetry as the website
  // identity gate: anything short of a confident match is discarded, and
  // discarding it makes the limit STRICTER, never looser.
  const excludedSections = (Array.isArray(scope.excluded_sections) ? scope.excluded_sections as unknown[] : [])
    .map(String).map((s) => s.trim()).filter((s) => s.length > 2)
    .filter((s) => requiredSections.some((q) => norm(q).includes(norm(s)) || norm(s).includes(norm(q))))
    .slice(0, 10);
  return {
    font,
    sizePt: num(r.font_size_pt, 8, 14),
    lineSpacing: num(r.line_spacing, 1, 3),
    marginIn: num(r.margin_inches, 0.5, 2),
    pageSize,
    maxPages: num(r.max_pages, 1, 200),
    maxWords: num(r.max_words, 100, 100000),
    requiredSections,
    excludesHeadings: scope.excludes_headings === true,
    excludedSections,
  };
```

### Patch 3 — count the countable text

**Anchor (line 569), exact:**
```
interface ContentOpts { requiredSections?: string[]; maxWords?: number | null; minWords?: number | null; signoff?: boolean }
```
**Replace with:**
```
interface ContentOpts { requiredSections?: string[]; maxWords?: number | null; minWords?: number | null; signoff?: boolean; excludesHeadings?: boolean; excludedSections?: string[] }

// The text a donor's word limit actually covers. A donor that states a bare limit
// gets the whole document, unchanged — countableWords() returns wordCount(md) on
// the identical string in that case, so the gate is bit-for-bit what it was. Only
// an exclusion the donor stated, and that names one of the donor's own sections,
// narrows it. Everything here is deterministic; no model is asked to count or to
// decide what is in scope.
function countableWords(md: string, blocks: Block[], opts: ContentOpts): number {
  const excl = opts.excludedSections ?? [];
  if (!opts.excludesHeadings && !excl.length) return wordCount(md);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const isExcluded = (h: string) => excl.some((s) => norm(h).includes(norm(s)) || norm(s).includes(norm(h)));
  const parts: string[] = [];
  let skipDepth: number | null = null;
  for (const b of blocks) {
    if (b.kind === "forbidden") continue;
    if (b.kind === "heading") {
      // An excluded section runs until the next heading at the same or a higher level.
      if (skipDepth !== null && b.level <= skipDepth) skipDepth = null;
      if (skipDepth === null && isExcluded(plainOf(b.inline))) { skipDepth = b.level; continue; }
      if (skipDepth !== null) continue;
      if (!opts.excludesHeadings) parts.push(plainOf(b.inline));
      continue;
    }
    if (skipDepth !== null) continue;
    if (b.kind === "paragraph") parts.push(plainOf(b.inline));
    else if (b.kind === "bullet_list" || b.kind === "numbered_list") for (const it of b.items) parts.push(plainOf(it.inline));
    else if (b.kind === "table") {
      for (const c of b.header) parts.push(plainOf(c));
      for (const row of b.rows) for (const c of row) parts.push(plainOf(c));
    }
  }
  return wordCount(parts.join("\n"));
}
```

**Anchor (lines 614-618), exact:**
```
  // A donor word limit is a hard limit: never ship over it. wordCount above is
  // calibrated to approximate a word processor's count, so exact enforcement is
  // fair in both directions.
  if (opts.maxWords && wordCount(md) > opts.maxWords) v.push("over_word_limit");
  if (opts.minWords && wordCount(md) < opts.minWords) v.push("suspiciously_short");
```
**Replace with:**
```
  // A donor word limit is a hard limit: never ship over it. wordCount above is
  // calibrated to approximate a word processor's count, so exact enforcement is
  // fair in both directions. It is applied to the text the donor actually counts:
  // measured across 20 replayed documents, counting the whole markdown against a
  // limit the donor scoped to the answers made the gate 17-31% stricter than the
  // donor's own rule, which refused compliant proposals and burned destructive
  // shortening rounds on documents that were already inside the limit.
  if (opts.maxWords && countableWords(md, blocks, opts) > opts.maxWords) v.push("over_word_limit");
  // minWords stays whole-document: it guards against a truncated generation, not
  // against a donor rule, and must not be relaxed by an exclusion.
  if (opts.minWords && wordCount(md) < opts.minWords) v.push("suspiciously_short");
```

### Patch 4 — pass the scope into every options object

Four call sites build a `ContentOpts` carrying `maxWords`; all four must carry the scope, or the
package gate will disagree with the generator gate (this is exactly the B9 class of bug the comment
at 1906-1908 already records).

**Anchor (line 1196), exact:**
```
  const narrativeOpts: ContentOpts = { requiredSections: fmt.requiredSections, maxWords: fmt.maxWords, minWords: 450 };
```
**Replace with:**
```
  const narrativeOpts: ContentOpts = { requiredSections: fmt.requiredSections, maxWords: fmt.maxWords, minWords: 450, excludesHeadings: fmt.excludesHeadings, excludedSections: fmt.excludedSections };
```

**Anchor (line 1910), exact:**
```
          ? { requiredSections: fmt.requiredSections, maxWords: fmt.maxWords }
```
**Replace with:**
```
          ? { requiredSections: fmt.requiredSections, maxWords: fmt.maxWords, excludesHeadings: fmt.excludesHeadings, excludedSections: fmt.excludedSections }
```

### Patch 5 — make the two counts observable (invariant 9)

**Anchor (lines 1920-1921), exact:**
```
            word_count: wordCount(md),
            word_limit: fmt.maxWords,
```
**Replace with:**
```
            word_count: countableWords(md, blocks, { maxWords: fmt.maxWords, excludesHeadings: fmt.excludesHeadings, excludedSections: fmt.excludedSections }),
            word_count_whole_document: wordCount(md),
            word_limit: fmt.maxWords,
            word_limit_excludes_headings: fmt.excludesHeadings,
            word_limit_excluded_sections: fmt.excludedSections,
```
**Why:** the gap between the two numbers is exactly what nobody could see, and it is what made both
reports publish a wrong headline. Recording both makes the next audit self-checking.

### Patch 6 (lower priority, flag before applying) — the silent floor

**Anchor (line 369), exact:** `    maxWords: num(r.max_words, 100, 100000),`
**Replace with:** `    maxWords: num(r.max_words, 25, 100000),`

A donor stating a 75-word summary limit currently gets **no gate at all**, which fails refusal-by-
default. The counter-risk is that a hallucinated small `max_words` would fail every order; the
analyze rule at 1253 already forbids guessing, and a failing order is visible while an unenforced
limit is not. Apply only with an explicit decision.

### Verification the orchestrator must run

1. `npx --yes deno@2.9.5 check supabase/functions/worker/index.ts`
2. A fixture test asserting **no behaviour change** when scope is empty: `countableWords(md, toBlocks(md), {maxWords: N})` must equal `wordCount(md)` for a sample of the 20 replay documents. This is the
   regression that matters — the default path must be untouched.
3. A fixture test on `ladder/out-n09-A.md` (`excludesHeadings: true`, `excludedSections: ["Budget
   table", "Declaration"]`) asserting the count still **exceeds** 1200. The fix must not rescue a
   genuinely over-length document.
4. `tests/replay/run.sh` is unaffected (no migration changes).

### What this patch deliberately does NOT do

- It does not add an attempt, a tolerance band, a truncation, or a bypass. Exhaustion still throws.
- It does not touch the P0-4 notification gap, which is what makes the throw dangerous. Fixing the
  scope reduces how often the pipeline stalls; it does not make a stall safe.
- It does not touch attempt 3's 78% target. That number should be revisited once the gate measures
  the right text — cutting to 78% of a limit you were already inside is the mechanism that threw away
  161-201 words of paid-for allowance — but changing it is a quality decision, not a compliance one,
  and it should not ride along with a compliance patch.

---

## Measurements marked MISSING

- **Whether an order actually completes end to end under the corrected gate.** No live run possible;
  every model call returns HTTP 403. MISSING.
- **Whether recovered headroom raises fundability or particularity.** No critic verdict exists at any
  ladder rung (`reports/referent-ladder.md`: every critic call refused). MISSING. The link between
  over-shortening and the proper-noun P0 is plausible and untested — do not report it as established.
- **The deployed v26 line numbers.** Every line number here is from the local
  `supabase/functions/worker/index.ts`, which CLAUDE.md records as ahead of deployed v26 (stranded-claim
  release, terminal-failure notification, two typing assertions — none in the word-limit path).
  `pipeline-spec.md` cites `generateValidated` at 625-673 and `contentViolations` at 561-612, a
  consistent 9-line offset from local, so the machinery itself is identical. Deployed line numbers not
  verified — diff before applying.

---

## Verification actually performed

The patch code was extracted into a standalone harness with the real declarations of `InlineRun`,
`plainOf`, `Block` and `wordCount` copied verbatim from `worker/index.ts:507-514, 564-566`, and both
type-checked and executed:

```
/tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/wl/patch-check.ts
$ npx --yes deno@2.9.5 check .../patch-check.ts      → Check ... (clean, no diagnostics)
$ npx --yes deno@2.9.5 run   .../patch-check.ts
no scope stated -> identical to wordCount(md): 36 === 36 true
scoped (answers only, headings dropped): 7 expected 7
hallucinated exclusion discarded: ["Budget table (one page, excluded from the word limit)","Declaration"]  excludesHeadings: true
```

Three properties confirmed:
1. **Default path unchanged.** With no scope stated, `countableWords` returns exactly `wordCount(md)`.
2. **Scope narrows correctly.** Headings and the two excluded sections drop out; the answers remain.
3. **A hallucinated exclusion is discarded.** `"Annex Z the donor never mentioned"` does not match any
   entry in the donor's own `required_sections` and is dropped, so it cannot widen the allowance.

The recount in §A3 was produced by `/tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/wl/count3.py`
(ladder) and `count4.py` (iteration 1), both plain Python string operations. No model was asked to
count anything, in line with the CLAUDE.md rule.

`worker/index.ts` was not modified. No migration, front-end file or other agent's file was touched.
