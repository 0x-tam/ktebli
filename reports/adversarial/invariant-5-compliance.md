# Adversarial round 2 — invariant 5 (compliance is never traded)

**Verdict: BROKEN.**

The donor **word limit** is enforced by a counter that is blind to every non-Latin,
non-Arabic script. A document a donor would return unread as far over its word limit
passes every gate — generation, `validate`, `check`, `package`, and the delivery gate
that is the "last place it can be caught." The parser that reads the limit *string* is
sound; the counter that measures the *document* against it is not. Compliance is
verified for Latin/Arabic prose and silently unenforced for the rest.

Failing test: `tests/adversarial/adv2_compliance_test.ts` (11 failing assertions, exit 1).
Deterministic, no model, no network:

```
npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_compliance_test.ts
```

Part A/B are self-contained (they inline the gate's counter verbatim) and fail in any
checkout. Part C imports the real `donor_limits.ts`; in a bare worktree snapshot without
the worker modules it reports "not evaluated" instead of crashing, and was verified
directly against `/home/jarvis/ktebli/supabase/functions/worker/donor_limits.ts`.

---

## Finding 1 (PRIMARY) — the word-limit counter under-measures non-Latin scripts to ~0

**Location.**
- `supabase/functions/worker/index.ts:539-541` — `wordCount()`
- `supabase/functions/worker/delivery_gate.ts:279-281` — `gateWordCount()` (a deliberate
  verbatim copy of the above; the comment at :275-278 says "if that function changes,
  this one changes with it")
- Enforced at `index.ts:658` (`contentViolations` → `over_word_limit`) and at
  `delivery_gate.ts:307-309` (`preflight` → "over the donor word limit", "the last place
  it can be caught before the file is sent").

Both are, verbatim:

```ts
md.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9؀-ۿ]/.test(w)).length
```

A token is a "word" only if it contains a character in `[A-Za-z0-9؀-ۿ]` — Latin letters,
ASCII digits, and the Arabic block U+0600–U+06FF. **Cyrillic, Greek, Hebrew, Devanagari,
Armenian, Georgian, Thai, and all CJK contain none of these**, so tokens in those scripts
count as zero.

**Defeating input (parsed count vs. truth).** For every space-separated non-Latin script,
a word processor — and the donor — counts one word per whitespace token, exactly as for
English. The gate counts 0:

| document | gate count | truth (word-processor) | donor limit | `over_word_limit`? |
|---|---|---|---|---|
| 2000 Cyrillic words | **0** | 2000 | 1400 | not fired |
| 2000 Greek / Hebrew / Devanagari words | **0** | 2000 | 1400 | not fired |
| 8000-char CJK paragraph (no spaces) | **0** | thousands | 1400 | not fired |
| `## Executive summary`\ + 500 Latin words\ + `## Програма`\ + 4000 Cyrillic words | **502** | 4500 | 1400 | **not fired** |

The mixed case is the floor-clearing exploit. 500 Latin words clear the generation floor
(`index.ts` sets `minWords:450`) and the delivery-gate "not a proposal" floor
(`delivery_gate.ts:301`, `words < 250`). The 4000-word Cyrillic body is invisible. The
document is 4,500 words against a 1,400-word limit and **the delivery-gate preflight —
which counts the whole document, unscoped — passes it** (502 ≥ 250, 502 ≤ 1400). Nothing
downstream re-measures length.

**Why this is a bug, not a scope decision.** The codebase already treats non-Latin donors
as in-scope and fixed two *other* gates for them, using Unicode-aware rules — but left the
word-limit counter behind:

- `index.ts:578` `normHeadU` normalises donor headings with `\p{L}` (any-script letters),
  added by WS4a-16 precisely because "an Arabic donor's entire required structure went
  unchecked."
- `delivery_gate.ts:1128` `wordCounts()` (repetition/similarity) tokenises with
  `/[^\p{L}\p{N}\s]/gu` — Unicode-aware — in the **same file** whose limit gate at :280
  is not.

So `delivery_gate.ts` contains two counters: a Unicode-aware one it uses for repetition,
and a Latin+Arabic-only one it uses to enforce the hard word limit. The Arabic block was
bolted onto the limit counter; no other non-Latin script was. That is the oversight.

**Fix spec.** Make the token predicate Unicode-aware in **both** copies:

```ts
// index.ts:539-541 and delivery_gate.ts:279-281
md.replace(/[|#*`>]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
```

`\p{L}\p{N}` counts a token that carries a letter or number of *any* script. For any
input this counts **≥** the current rule (Latin/digits/Arabic are subsets of
`\p{L}\p{N}`), so the change is monotonic-safe: it can only turn a silent non-gate into a
real one, never create a new permissive error — the same asymmetry `word_limit.ts` is
built on ("Every change here counts MORE text than before, never less").

Caveat for scriptio-continua (CJK, Thai, Lao, Khmer): whitespace tokenisation still
undercounts a spaceless paragraph (it becomes one token → counts as 1, not 0). The
`\p{L}\p{N}` change stops the 0-count, but a faithful count needs
`Intl.Segmenter(locale, {granularity:"word"})`, **or** the gate must refuse to certify a
word limit for a non-segmented script (push `limitUnparsed`) rather than assert a count it
cannot compute. A word limit that cannot be measured must block, not pass.

**Direction of harm.** Permissive. An over-length document ships; the donor's own fixture
says "Applications over the limit are returned unread."

---

## Finding 2 (SECONDARY) — zero-width / soft-hyphen / pipe glue collapses the count

**Location.** Same counter (`index.ts:539-541`, `delivery_gate.ts:279-281`).
`sanitizeMd()` (`index.ts:668`) strips code fences and horizontal rules only — none of the
characters below.

**Defeating input (count vs. truth).**

| document | gate count | truth |
|---|---|---|
| 3000 "delivery" joined by U+200B (zero-width space) | **1** | 3000 |
| …joined by U+2060 (word joiner) | **1** | 3000 |
| …joined by U+00AD (soft hyphen) | **1** | 3000 |
| …joined by U+200D (ZWJ) | **1** | 3000 |
| 100 rows of `\|alpha\|beta\|gamma\|` | **100** | ~300 |
| control: 3000 joined by U+00A0 (nbsp) | 3000 | 3000 |

`\s` matches U+00A0 (so nbsp counts correctly) but not U+200B/200C/200D/2060 or U+00AD —
all of which render invisibly and glue neighbouring words into one token. The pipe case is
the counter stripping `|` to `""`, gluing adjacent cell contents.

**Fix spec.** Before counting: (a) delete zero-width / default-ignorable code points —
`w.replace(/[\p{Default_Ignorable_Code_Point}­]/gu, "")` — so glue characters cannot
merge tokens; (b) replace `|` with a space, not the empty string, so table cells tokenise;
(c) split on `\p{White_Space}` rather than `\s`. Lower realism than Finding 1 (a grounded
generator is unlikely to emit U+200B), but the gate genuinely fails and the fix is cheap.
Direction of harm: permissive.

---

## Finding 3 (SECONDARY, author-acknowledged) — a wrapped stated limit resolves to `null`

**Location.** `donor_limits.ts:326-333` (`absenceIsSuspicious` numeric/phrase regexes),
consumed by `decideLimit:340-351` and `resolveDonorLimits:366-385`; a resulting refusal is
what blocks the order at `index.ts:2124` and `:2710`.

The phase-6 tightening (donor_limits.ts:320-325) now requires the digit group and its unit
within three whitespace chars on **one line**, to kill a footer false-positive
("...in 2024\n\n\n\nPage 5"). New blind spot: a limit whose **number and unit wrap across
a line**, with no `word limit`/`must not exceed … words` bigram on either single line, is
missed.

**Defeating input (verdict vs. truth).** With the extractor returning `null` for
`format_spec.max_words`:

| donor guidelines | `absenceIsSuspicious` | `decideLimit(null,…)` | resulting `maxWords` |
|---|---|---|---|
| `keep each submission to 1,400\nwords in total.` | `null` | **absent** | **null (no gate)** |
| `Answers must not exceed 1,400\nwords.` | `null` | **absent** | **null (no gate)** |
| (control) `no more than 1,400 words` | `"1,400 words"` | refused / `absence_contradicted` | blocked ✓ |

Truth: the donor stated a 1,400-word limit. Per the invariant, "a null limit is a bug by
definition" — and here a *stated* limit became null.

**Scope of the harm.** This fires only when the extractor **independently** returns `null`
for the field (the exact failure `donor_limits.ts` exists to backstop). The authors
document the trade at :320-325 and argue a miss "only returns that text to the pre-check
state." That is true but incomplete: the backstop's whole purpose is that pre-check state
is unsafe, so a hole in it is a live route to a null gate, not a no-op.

**Fix spec.** The backstop must tolerate a single line break between number and unit
without re-introducing the `\s*` footer bridge. Run the `numeric`/`phrase` match against a
copy of the guidelines with single newlines collapsed to spaces **but blank lines and
sentence boundaries preserved as hard stops** (e.g. collapse `/(?<!\n)\n(?!\n)/` → space,
keep `\n\n` and `.` as barriers). That catches "1,400\nwords" while still refusing the
"...2024\n\n\n\nPage 5" footer that motivated the phase-6 change. Direction of harm:
permissive (null gate on a stated limit).

---

## What refused correctly (invariant 5 holds here)

The **page-limit** route is closed. `renderService()` (`index.ts:1043-1069`) returns
`not_configured`/`unavailable` when the render service is unset or unreachable, and the
package gate (`index.ts:2751-2759`) **throws** whenever `fmt.maxPages` is set and the
render did not return `ok`. `estimatePages()` is recorded as
`estimated_pages_metadata_only` (:2729) and is never compared to the limit. There is no
estimate fallback: no real render, no page-limited delivery.

The donor-limit **parser** (`parseDonorLimit`) is solid. Every ambiguous or wrong-unit
input I threw at it refused rather than guessing a number or dropping to null:

| input | outcome |
|---|---|
| `1,400-1,600 words` (range) | REFUSE `multiple_numbers` |
| `at least 1400 words` | REFUSE `minimum_not_maximum` |
| `1,400 characters` | REFUSE `wrong_unit` |
| `1,400 words per section` | REFUSE `distributive_limit` |
| `4 pages or 1,400 words` | REFUSE `dual_limit` |
| `Section 2 400 words` (ambiguous grouping) | REFUSE `multiple_numbers` |
| `١٤٠٠ words` (Arabic-Indic digits) | REFUSE `not_a_number` (safe) |
| `approx 1400`, `1 400 words`, `1.400 words` | LIMIT 1400 (strict) |
| `1,400 words maximum, excluding annexes` | LIMIT 1400 (scope decided elsewhere) |

No input to `parseDonorLimit` produced a confident wrong number or a silent null. The break
is entirely downstream of the parse: the counter (Findings 1–2) and the absence backstop
(Finding 3).

---

## Strongest single statement

Ship a proposal whose body is written in Ukrainian, Greek, Hebrew, Hindi, or Chinese — or
an English proposal with a substantial quoted passage in any of them — against a donor word
limit, and the limit is not enforced: `gateWordCount` reads 4,500 words as 502 (or 0), the
delivery gate's "last catch" passes it, and the donor receives a document it returns unread.
The fix is one predicate, `/[\p{L}\p{N}]/u`, changed in two mirrored copies.
