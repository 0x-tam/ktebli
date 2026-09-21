# PATCH SPEC — donor limits coerce or refuse, never a silent null

**Date:** 2026-08-27 · **No model call. No network fetch.** Both blockers respected.
**`worker/index.ts` was NOT modified.** Every hunk below is anchor/replacement for the orchestrator
to apply serially.

New files created by this task (already in the tree, already type-checked and run):

```
supabase/functions/worker/donor_limits.ts       the pure parser (no I/O)
tests/donor-limits/donor_limits_test.ts         71 literal forms, 97 assertions, all passing
```

```
$ npx --yes deno@2.9.5 check supabase/functions/worker/donor_limits.ts   -> clean
$ npx --yes deno@2.9.5 check tests/donor-limits/donor_limits_test.ts     -> clean
$ npx --yes deno@2.9.5 run   tests/donor-limits/donor_limits_test.ts     -> ALL DONOR-LIMIT TESTS PASSED (71 literal forms)
```

---

## 0. AUDIT THE BRIEF FIRST — the finding is real, its stated form is one commit out of date

The brief says `normalizeFmt` accepted a limit only when `typeof x === "number"`. That is exact for
`git show b81b3d7^:supabase/functions/worker/index.ts:357`, verbatim:

```ts
const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && x >= lo && x <= hi ? x : null);
```

It is **not** the working tree. Commit `b81b3d7` added `numLike`, which strips commas and takes the
first digit run, so `"1,400 words"` already reaches `1400` today, and out-of-range values already
reach `limitUnparsed` and throw at `package` (`index.ts:1972-1973`). Reporting the null as live
would overstate it.

Two further corrections to the record, both from the repo's own reports, both of which the brief
repeats:

- **"19 of 20 documents broke the limit" is RETRACTED** — twice, independently, by
  `reports/referent-ladder.md` §2 and `reports/design/word-limit.md` §A3. Both headline numbers
  counted the whole markdown file against a limit the donors explicitly scope to the answers.
  Recounted on the donors' own rule it is **8 of 20**, and **7 of those 8 are single-prompt arms
  that run no enforcement at all**. The comma bug cannot be the explanation for a number that does
  not survive its own recount, and this patch does not claim it is.
- **The over-limit documents were harness artefacts.** `word-limit.md` §(a) shows the deciding half
  of enforcement was never exercised: the replay sub-agents recorded, in terms, *"I continued past
  the throw to produce the required deliverable."*

**What survives, and is the reason for this patch.** `numLike` takes the first digit run and asks no
questions about it. On the forms below it does not fail — it **succeeds, with a wrong number**:

| value in `max_words` | `numLike` today | what it means |
|---|---|---|
| `"1,400 characters"` | **1400** | a character limit enforced as a word limit — roughly 6x too permissive |
| `"at least 1,400 words"` | **1400** | a floor recorded as a ceiling |
| `"1,400 words per section"` | **1400** | a per-section limit recorded as a document total |
| `"1400 words or 4 pages"` | **1400** | the page half of a dual limit silently dropped |
| `"1,200-1,400 words"` | **1200** | the lower end of a range taken as the limit |
| `"$1,400"` | **1400** | a budget figure read as a word limit |
| `"A4"` (in `max_pages`) | **4** | a paper size read as a four-page limit |
| `"1 400 mots"` | 1 → null | a real limit lost entirely |
| `"1.400 palabras"` | 1.4 → null | a real limit lost entirely |

That is the same *"reports success while doing nothing"* shape one turn further on, and it is worse
than the null was: a wrong limit is indistinguishable from a right one at every gate downstream.
Every row is asserted in `tests/donor-limits/donor_limits_test.ts` §3b against `CURRENT_NUMLIKE`,
copied verbatim from the working tree, so the comparison cannot drift into a straw man.

---

## 1. The contract the patch installs

`parseDonorLimit(raw, field)` returns a three-way discriminated union and nothing else:

| outcome | meaning | what the caller does |
|---|---|---|
| `limit` | a confident, correct integer inside the field's range | sets `fmt.maxWords` / `fmt.maxPages` |
| `refused` | stated and unreadable, with a `reason` and a `detail` | pushes into `fmt.limitUnparsed` → the order stops |
| `absent` | the donor stated no limit | the **only** provenance from which the limit may be null |

**On `absent`, which the task's two-outcome rule does not cover — argued, not assumed.**
`analyze`'s own extraction rule (`index.ts:1303`) is *"every unstated field null. Never guess."*, so
`null` is the normal, expected value for the large majority of grants, which state no word limit at
all. Making `null` a refusal would halt nearly every order. So absence stays a legal outcome — but
it is no longer *silent*:

1. it is a named state carried in `fmt.limitOutcomes`, not an untyped `null`;
2. it is reachable only from a closed set — `null`, `undefined`, `""`, whitespace, and exact-match
   sentinels (`"n/a"`, `"none"`, `"not stated"`, `"no limit"`, …) — asserted as closed by the test;
3. `"unknown"`, `"unclear"`, `"TBD"`, `"see the guidelines"` are **not** in that set. Those say the
   *extractor* could not tell, which is a refusal;
4. `decideLimit` refuses an absence the donor's own guidelines contradict
   (`absence_contradicted`). That is what stops *"the extractor dropped the limit"* and *"the donor
   stated no limit"* being the same observable state — the exact failure the original bug was.

**Cost, chosen deliberately.** A wrong REFUSE costs one held order, which is visible and
recoverable. A wrong silent null ships a document whose compliance is unknown, which is neither.
Every ambiguous form below therefore refuses.

---

## 2. Hunks — apply in order

### Hunk 1 — import (anchor is `index.ts:39`)

**Anchor, exact:**
```
import { limitScopeFrom, limitedText, type LimitScope } from "./word_limit.ts";
```
**Replace with:**
```
import { limitScopeFrom, limitedText, type LimitScope } from "./word_limit.ts";
import { type LimitField, type LimitOutcome, resolveDonorLimits } from "./donor_limits.ts";
```

### Hunk 2 — `Fmt` carries how each limit was resolved

**Anchor, exact:**
```
  maxPages: number | null; maxWords: number | null; requiredSections: string[];
  limitUnparsed: string[];
}
```
**Replace with:**
```
  maxPages: number | null; maxWords: number | null; requiredSections: string[];
  limitUnparsed: string[];
  // How each limit was resolved: a value, an absence the donor stated, or a refusal
  // with a reason. maxWords/maxPages are null if and ONLY if the matching outcome is
  // "absent" -- donor_limits.ts guarantees it and tests/donor-limits proves it over 71
  // literal forms. A null with any other provenance is the defect this replaced.
  limitOutcomes: Record<LimitField, LimitOutcome>;
}
```

### Hunk 3 — `normalizeFmt` may see the donor's own words

**Anchor, exact:**
```
function normalizeFmt(raw: unknown): Fmt {
```
**Replace with:**
```
// `guidelines` is the donor's own text and is used for exactly ONE thing: refusing an
// absent limit that the donor's text contradicts. Passing "" -- which every existing
// caller does until Hunk 6 -- reproduces today's behaviour on that path exactly.
function normalizeFmt(raw: unknown, guidelines = ""): Fmt {
```

### Hunk 4 — resolve the two count limits through the new module

**Anchor, exact:**
```
  const ps = String(r.page_size ?? "");
  const pageSize = /letter/i.test(ps) ? "Letter" as const : /a4/i.test(ps) ? "A4" as const : null;
  return {
```
**Replace with:**
```
  const ps = String(r.page_size ?? "");
  const pageSize = /letter/i.test(ps) ? "Letter" as const : /a4/i.test(ps) ? "A4" as const : null;
  // The two COUNT limits only. `num()` above still handles font size, line spacing and
  // margin, and must: those are measurements, where "1.500" is the decimal 1.5, while
  // in a count field "1.400" is the group 1,400. One parser cannot be right for both,
  // and merging them would silently turn a 1.5in margin into 1500.
  const lim = resolveDonorLimits(r, guidelines);
  return {
```

**Anchor, exact:**
```
    maxPages: num(r.max_pages, 1, 200, "max_pages"),
    maxWords: num(r.max_words, 100, 100000, "max_words"),
```
**Replace with:**
```
    maxPages: lim.maxPages,
    maxWords: lim.maxWords,
```

**Anchor, exact:**
```
    limitUnparsed: unparsed,
```
**Replace with:**
```
    // `unparsed` is now always empty -- nothing passes `field` to num() any more. It is
    // kept, and concatenated rather than dropped, because parser-audit F17 wants the
    // same refusal for a stated-but-unreadable font, size, spacing or page size, and
    // that fix is a one-line change to the three num() calls above once someone owns it.
    limitUnparsed: [...unparsed, ...lim.limitUnparsed],
    limitOutcomes: lim.limitOutcomes,
```

### Hunk 5 — the call site passes the donor's text, and fails early

**Anchor, exact (5 lines, `index.ts:1230-1234`):**
```
  const fmt = normalizeFmt((analysis as { format_spec?: unknown } | undefined)?.format_spec);
  // What the donor's limit COVERS, read from the donor's own words. Defaults to the
  // whole document, so this can only ever narrow when the guidelines say attachments
  // sit outside the limit -- never the other way round (invariant 5).
  const limitScope = limitScopeFrom(String((analysis as { guidelines_text?: unknown } | undefined)?.guidelines_text ?? "") ||
    String((analysis as { summary?: unknown } | undefined)?.summary ?? ""));
```
**Replace with:**
```
  const guidelinesText = String((analysis as { guidelines_text?: unknown } | undefined)?.guidelines_text ?? "") ||
    String((analysis as { summary?: unknown } | undefined)?.summary ?? "");
  const fmt = normalizeFmt((analysis as { format_spec?: unknown } | undefined)?.format_spec, guidelinesText);
  // What the donor's limit COVERS, read from the donor's own words. Defaults to the
  // whole document, so this can only ever narrow when the guidelines say attachments
  // sit outside the limit -- never the other way round (invariant 5).
  const limitScope = limitScopeFrom(guidelinesText);
  // A donor limit the extractor could not read is not an absent limit. The package gate
  // at :1972 already refuses it; this refuses it at the FIRST stage that sees it. Same
  // outcome -- the order cannot ship either way -- but it happens before `strategy`
  // reserves an exclusivity claim, so no per-grant slot is burned on an order that was
  // always going to stop, and it costs nine fewer model calls. It also closes the hole
  // parser-audit F15 records, where an empty finalNarrative() skips the package throw
  // entirely and `deliver` still emails.
  if (stage.key !== "analyze" && fmt.limitUnparsed.length) {
    throw new Error(`donor limit not parsed, compliance cannot be established: ${fmt.limitUnparsed.join(", ")}`);
  }
```

> **FLAG FOR THE ORCHESTRATOR.** The `if` block is a real behaviour change: a mangled limit that
> today fails at `package` will now fail at `org`. It is strictly safer and strictly cheaper, it
> touches no other stage, and it is the only hunk here that changes *when* something fails rather
> than *whether*. Drop it if you want a pure parser change; keep it if you want F15 closed. The
> package throw at :1972 stays either way and is untouched.

### Hunk 6 — make both resolutions observable (invariant 9)

**Anchor, exact:**
```
            word_limit: fmt.maxWords,
            page_limit: fmt.maxPages,
```
**Replace with:**
```
            word_limit: fmt.maxWords,
            word_limit_source: fmt.limitOutcomes.max_words,
            page_limit: fmt.maxPages,
            page_limit_source: fmt.limitOutcomes.max_pages,
```

**Why:** a null `word_limit` in the QA record is currently unreadable — it could mean the donor
stated no limit or that the extractor lost one. `word_limit_source` says which, in the record, for
every order. That is what nobody could see.

### Hunk 7 — the suite

**File:** `tests/run-all.sh`
**Anchor, exact:**
```
run "donor-scoped word limit"              $DENO run "$REPO/tests/word-limit/word_limit_test.ts"
```
**Replace with:**
```
run "donor-scoped word limit"              $DENO run "$REPO/tests/word-limit/word_limit_test.ts"
run "donor limit literal forms"            $DENO run "$REPO/tests/donor-limits/donor_limits_test.ts"
```

---

## 3. Verification actually performed

`deno check supabase/functions/worker/index.ts` **cannot run in this environment** — it needs
`jsr.io/@supabase/functions-js/meta.json` and outbound HTTPS is refused (`403 Forbidden` at the
proxy). **This is true of the unpatched file as well**: I ran it on the untouched working tree
first and it fails identically, so the failure is environmental and not caused by this patch.
**`deno check` on the patched `index.ts` is therefore MISSING and must be run by the orchestrator.**

What was run instead, and what it proves:

1. All eight hunks were applied to a **copy** of `index.ts` at
   `scratchpad/qloop/audit/patchcheck/index.ts`. Every anchor matched **exactly once** — asserted,
   not eyeballed; a zero-or-multiple match aborts.
2. The whole `donor format spec` block was **sliced out of the patched copy** (from
   `// ================= donor format spec =================` to `const EMPTY_FMT = normalizeFmt(null);`)
   into `patchcheck/normalize_patched.ts` and re-checked: **`lines not verbatim in patched index.ts: 0`**.
   It imports the real `donor_limits.ts` from the repo, not a copy.
3. `deno check normalize_patched.ts` → clean. `deno run normalize_patched.ts` → all assertions pass:

```
  ok   EMPTY_FMT.maxWords still null
  ok   EMPTY_FMT.limitUnparsed still empty
  ok   EMPTY_FMT records an absent word limit
  ok   THE BUG: "1,400 words" now reaches maxWords as 1400
  ok   and produces no refusal
  ok   required_sections untouched
  ok   the dual limit yields no maxWords
  ok   and exactly one limitUnparsed entry, which stops the order
  ok   an absence the donor's own text contradicts refuses
  ok   an uncontradicted absence does not
  ok   font, size, spacing, margin and page size are byte-identical in behaviour
  ok   1.500 line spacing stays the decimal 1.5, NOT the group 1500
```

4. `tests/donor-limits/donor_limits_test.ts` — 71 literal forms, 97 assertions, all passing.

---

## 4. Fixture corrections made during this task, and why none is a weakening

Stated out loud, as the standing rule requires. Four assertions failed on first run; **in three of
the four the code was right and my expected value was wrong**, and in the fourth the test's own
helper was wrong.

1. **`"min 1400"` expected `minimum_not_maximum`, got `wrong_unit`.** `OTHER_UNIT`'s `\bmins?\b`
   (for "20 minutes") also matches the abbreviation "min". Both outcomes REFUSE, so no compliance
   behaviour changed — only the reason the operator reads. **Fixed in the code**, by testing
   `MINIMUM` before `OTHER_UNIT`, with the ordering and its reason written into the source. Not a
   weakening: no input's verdict moved from REFUSE to COERCE; `"no more than 20 minutes"` still
   refuses as `wrong_unit`, and that case is in the corpus.
2. **The duplicate-fixture key collided `NaN`, `Infinity` and `null`.** `JSON.stringify` renders all
   three as the string `"null"`, so the hygiene assertion reported three duplicates that do not
   exist. **Fixed in the test**, with a type-aware key. Not a weakening: the assertion still demands
   **zero** duplicates; only the identity function was corrected, and the corrected key is strictly
   more discriminating than the one it replaced.
3. **Seven fixtures carried a one-or-two-word `why`** ("explicit", "an array") and failed the
   corpus-hygiene assertion that every fixture must justify its verdict. **Fixed in the test**, by
   writing the justifications. The assertion caught my own laziness, which is what it is for.
4. **`"Section 2 400 words"` baseline recorded as `2`; it is `null`.** The baseline column holds
   what `CURRENT_NUM` returns, not what `numLike` returns: `numLike` yields 2, and the range check
   then turns it into `null`, so today this input already refuses. **Fixed in the test.** Not a
   weakening: the required outcome for that row is still REFUSE and is unchanged; only the recorded
   description of today's behaviour was corrected, and the assertion that caught it is the one that
   pins the baseline so the comparison cannot drift.
5. **`normalize_patched.ts` asserted `line_spacing: "1.500"` → `null`; it is `1.5`.** My expectation
   was wrong and the code is right — `num()` reads it as the decimal, which is the correct reading
   for a measurement. **Fixed in the harness**, and the corrected assertion is *stricter*: it pins
   the exact value 1.5 where the original merely demanded "not 1500".

---

## 5. Stated limitations — MISSING, not clean

1. **`deno check` on the patched `index.ts`.** Blocked at the network, blocked identically before
   the patch. **MISSING.** The orchestrator must run it.
2. **The guidelines text the absence cross-check reads is not the donor's text.** Parser-audit F19
   establishes that `analysis.guidelines_text` is **not a field `analyze` emits**, so
   `guidelinesText` falls through to the model-written `summary`. `absenceIsSuspicious` therefore
   runs against a summary, which is a weaker source than the donor's own page. This is
   strict-direction safe — a summary that mentions a limit still triggers the refusal, and a
   summary that omits one leaves behaviour exactly as it is today — but the cross-check is
   **weaker than it reads**. The fix is F19's: carry `guidelines_text` through `analyze`'s output;
   it is already written to `grants.guidelines_text`, the stage output simply does not carry it.
   Until then, treat `absence_contradicted` as a bonus catch, not as coverage.
3. **How often each literal form actually occurs.** Nothing here estimates the rate at which a real
   generator emits `"1,400 characters"` or `"at least 1,400 words"` in `max_words`. No model call
   was possible (`403 Key limit exceeded`) and no donor page could be fetched. Every finding is at
   the **predicate** level, with the model's own plausible output as the input — the same level at
   which the `"1,400 words"` finding itself was established. **The rate is MISSING** and no number
   in this document should be read as one.
4. **The word floor moves from 100 to 25.** `word-limit.md` Patch 6 flagged this as needing an
   explicit decision, because a hallucinated small `max_words` would fail every order. **The
   argument has changed and I am taking the decision:** under this module an out-of-range value
   REFUSES rather than returning null, so a hallucinated `5` halts the order at either floor.
   Lowering the floor can therefore only convert a *silent non-gate* on a legitimate 75-word summary
   limit into a real gate. It cannot create a refusal that 100 would not also have created. If the
   orchestrator disagrees, change one line — `LIMIT_RANGE.max_words.lo` in `donor_limits.ts` — and
   the `"75 words"` fixture will fail loudly, which is the correct way to reverse it.
5. **Deployed line numbers are not verified.** Every line number here is from the local
   `supabase/functions/worker/index.ts`, which CLAUDE.md records as ahead of deployed v26. Anchors
   are text, not line numbers, so they are robust to the offset — but **diff before deploying**.
6. **This patch does not touch the heading-fragment half of the finding.** Parser-audit proof `B9`
   records that `index.ts:630` is already fixed one-way (`headingText.some(h => h.includes(needle))`),
   so `## Question` no longer satisfies five donor questions. F21 — a required section that
   normalises to empty is skipped by `if (!needle) continue` — is still open and belongs to whoever
   owns `required_sections`.
7. **`qa.word_count` still counts the whole document** while the gate counts `limitedText(...)`.
   Not in scope here, not changed, and worth someone's attention: the QA record and the gate report
   different numbers for the same document.
