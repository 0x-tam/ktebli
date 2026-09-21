# Adversarial attack on invariant 5 — "compliance never traded, NEVER satisfied by truncation"

**Date:** 2026-08-27 · **Verdict: BROKEN.** Two routes deliver a document the donor's own
stated rules reject. A third corrupts the word count badly enough to make a paid order fail
terminally, and is one obvious tidy-up away from delivering over-length as well.

Everything below was **run** against the repo's real code with
`npx --yes deno@2.9.5 run --allow-read`. No model was called (the OpenRouter key is capped)
and no network was touched. Every number here is from execution, not from reading.

Failing test: `tests/adversarial/compliance_truncation_test.ts` — 9 assertions fail against
current code, exit 1. Fixes: `patch-compliance-limits.md` in this directory.

---

## What the enforcement path actually is

For a word limit there is exactly one gate, `contentViolations()` at `index.ts:625-627`:

```ts
const counted = limitedText(md, opts.limitScope ?? "whole").text;
if (opts.maxWords && wordCount(counted) > opts.maxWords) v.push("over_word_limit");
```

It runs at generation (`generateValidated`, index.ts:643-691), again on every validate
correction round (index.ts:1778-1789 via `narrativeOpts`), and again at package inside
`buildDoc` (index.ts:928-936). `opts.maxWords` comes from `normalizeFmt(analysis.format_spec)`
at index.ts:1204. The page limit has its own gate at index.ts:1945-1969, including the
correct refusal when no render service is configured.

Three of the four holes below are upstream of that gate: they change what `maxWords` is, or
what text is counted, or what "the donor's section headings are present" means. The gate
itself is sound. It is being fed.

`delivery_gate.ts` also contains a word-limit check (line 303) but is **not imported by
index.ts** — it is another agent's proposed patch, not a live gate, and it inherits hole 4
verbatim.

---

## BREAK 1 — a donor-mandated heading is satisfied by any substring of itself

`index.ts:610-614`:

```ts
if (!headingText.some((h) => h.includes(needle) || needle.includes(h))) v.push("missing_required_section:" + s.slice(0, 40));
```

`needle.includes(h)` accepts a heading that is a **substring of the donor's own wording**.
Run against the real donor guidelines preserved in this repo at
`tests/regression/similarity-gate/fixture.json` (Meridian Foundation, Community Resilience
Fund 2027), whose rule is *"must answer the following five questions, in this order, using
each question as a section heading"*:

| headings in the document | gate |
| --- | --- |
| exactly as the donor wrote them | PASSES |
| `Question 1` … `Question 5` | **PASSES** |
| `Problem`, `Activities`, `Beneficiaries`, `Monitoring`, `Sustainability` | refused (2 of 5) |
| one heading: `Question` | **PASSES** — all five donor questions satisfied at once |
| one heading: `What` | refused (2 of 5) |

Read the shape of that table. **Truncation passes; rewording is refused.** The gate rewards
precisely the move the invariant forbids, and punishes the harmless one.

Nothing downstream catches it. `docxViolations()` (index.ts:893-925) checks that each block's
heading survived into `word/document.xml` — it never compares a heading against the donor.
The comment at index.ts:657-662 records that benchmark B6 "shipped a shortened version of a
donor-mandated heading and failed the docx check"; the docx check contains no such comparison,
so what caught B6 was this substring test failing on a *paraphrase*. A pure prefix truncation
— which is what a model does under length pressure, and index.ts:661 exists because it does —
sails through.

This is delivery. Nothing between here and the customer's download re-checks it.

Fix: **P3** in `patch-compliance-limits.md`.

---

## BREAK 2 — a donor limit that arrives as a string is not a strict limit, it is no limit

`normalizeFmt` (index.ts:355-373) accepts a number and nothing else:

```ts
const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && x >= lo && x <= hi ? x : null);
```

`jsonOf` (index.ts:178-180) is a bare `JSON.parse`. The analyze model is *asked* for
`"max_words":number|null`; it is not made to comply. Measured, on a 2,281-word document
against a stated 1,400-word donor limit:

| `format_spec` from analyze | `maxWords` | `maxPages` | `over_word_limit`? | page gate armed? |
| --- | --- | --- | --- | --- |
| `max_words: 1400, max_pages: 4` | 1400 | 4 | **true** | yes |
| `max_words: "1400", max_pages: "4"` | null | null | **false** | **no** |
| `max_words: "1,400", max_pages: "4 pages"` | null | null | **false** | **no** |
| `max_words: 60` (below the floor) | null | null | **false** | **no** |
| absent | null | null | false | no |

`"1,400"` is not a contrived shape: the real donor text in this repo writes its limit as
**"must not exceed 1,800 words"** — comma and all — and a model asked to lift a number out of
that prose emits the string form routinely.

The consequences run the length of the pipeline. A null `maxWords` means: the generator is
never told there is a limit (`fmtLines`, index.ts:1219 is skipped), the brief keeps its
hardcoded "1500-2500 words" (index.ts:1640), `over_word_limit` can never fire at generation,
validate or package, and `qa.donor_requirements` records `"n/a"`. A null `maxPages` means the
block at index.ts:1962-1969 — *"without a real render there is no verified page count, a hard
donor page limit therefore blocks delivery"*, the single safeguard standing in for the
undeployed render service — never arms. **The page-limit-with-no-render route named in the
brief is defeated not by beating the check but by the check never being constructed.**

A gate that disappears when its input is the wrong type is not refusal by default.

Fix: **P4** in `patch-compliance-limits.md` — coerce what is coercible, and refuse on what is
not, plus a cross-check against the donor's own text for the limit the extractor drops entirely.

---

## BREAK 3 (partial) — the counted span deletes the applicant's own answers

`word_limit.ts` was added to stop the pipeline counting attached budget tables against a
limit that excludes them. At `"answers"` scope it drops far more than that.

### 3a. Ordered lists are not counted at all

`headingOf()` (word_limit.ts:63-72) returns non-null for any line matching
`/^Q?\s*[1-9][.)]\s/`, and `limitedText()` drops every heading line. A markdown ordered list
is therefore erased from the count, item by item. Measured:

```
## Q1. How will you deliver the project?
We will run the programme in three phases over eighteen months.
1. Months one to three: recruit two part-time outreach workers, ... (31 words)
2. Months four to nine: deliver forty weekly sessions, ...          (31 words)
3. Months ten to eighteen: move to a peer-led model, ...            (28 words)
## Q2. What difference will it make?
Fewer young people waiting for support.
```
→ whole document **111 words**, counted **17**, `excludedHeadings` **`[]`**.

This is the mainline shape, not an exotic one: `FORMAT_RULES` (index.ts:60-68) tells the
generator to use "numbered lists" and to express anything diagram-like as "a numbered
sequence", and `generateValidated`'s repair prompt (index.ts:670) repeats the instruction.

Scaled to a full five-answer narrative written with two numbered workplans:
**1,996 words in the file, 1,962 words the donor counts against a 1,400 limit, 126 words the
gate counts.** The gate on that document would not fire until roughly 15,000 real words.

### 3b. A prefix match hands the model a delete key

`ATTACHED = /^(budget|declaration|annex|appendix|attachment|signator|supporting\s+document)/i`
is tested against the heading, anchored at the start. Any heading *beginning* with one of
those words drops the entire section beneath it. "Budget and value for money" is a routine
donor question — the real grant in this repo scores "Value for money — 20 points" — and the
pipeline packages the actual budget as a separate `Budget.xlsx` (index.ts:1899-1908), so a
budget heading inside the narrative is answer prose by construction. Measured: 509 words in
the document, **44 counted**, passing a 300-word limit, with `excludedHeadings:
["Budget justification"]`. The heading text is written by the model. Under the correction
loop's own instruction to "cut at least N words", renaming a section is cheaper than cutting
it.

### Why this is "partial" — and what it costs instead

I could not get 3a or 3b to *deliver*. The package stage rebuilds its own options at
index.ts:1925-1927 and **omits `limitScope`**, so `buildDoc` re-counts the narrative at
`"whole"` scope. A 1,482-word document that the generation gate passed at 672 counted words
is caught at package at 1,516. Invariant 5 holds — by an inconsistency, not by design.

What it costs is invariants 2 and 8. The generation and validate gates never see a length
problem, so the correction loop is never triggered and the document is never shortened; the
package stage then fails it three times and the paid order dies with
`content validation at render: over_word_limit`. The scope feature converts a correctable
over-length into a **guaranteed terminal failure** of a paid order.

And the repair is one line from the break. The comment directly above index.ts:1925 reads:
*"The signoff exemption has to hold at render time too: B9 generated a valid cover email and
then failed the identical check here, because this call did not carry the option the generator
was given."* The next person to notice that `limitScope` is the option the generator was given
and package was not will add it, for exactly the reason the comment states, and 3a and 3b
become delivery routes that afternoon.

Fix: **P1** (correct the span) and **P2** (compute it once, use it everywhere) in
`patch-compliance-limits.md`. P1 must land before P2, or P2 opens the hole.

---

## Also found while attacking, not a break

**The scope decision has never read the donor's words.** index.ts:1208 reads
`analysis.guidelines_text`. The analyze stage returns `done(a)` where `a` is the model's JSON,
and the schema at index.ts:1254-1263 has no `guidelines_text` field — the donor text is written
to the `grants` table (index.ts:1275-1278), never into the stage output. So the field is always
`undefined` and the scope has always been decided from `analysis.summary`, a model-written
paraphrase. The comment above it — *"read from the donor's own words"* — does not describe the
code. Two consequences: the thin-prose fix mostly does not fire, and when it does fire it is
because a model's summary happened to contain two regexes' worth of phrasing. Covered by P4.4.

**Only the narrative is rendered to the donor's format.** `docFmt = isNarrative ? fmt :
EMPTY_FMT` (index.ts:1921). Cover letter, concept note, workplan, logframe and budget
justification render at Calibri 10.5pt, 0.87in margins, A4, whatever the donor mandates. If
the donor's format rules apply to the submission rather than to one file, every other document
in the package is non-compliant on arrival. No truncation involved; it is simply not applied.

**The renderer adds body words the count never sees.** index.ts:812-818 pushes the
organisation name, website, "Registration No. …", document title and grant title into the
document body. They are not in `md`, so `wordCount` never counts them, and Microsoft Word does.
A narrative sitting on the limit ships 10-20 words over it in the file the donor opens.

**`Fmt` models seven things and donors state more.** No character limit, no per-question word
limit, no "sides of A4", no indicator cap. The real donor text in this repo says *"no more than
five indicators"*; nothing deterministic enforces it, and `requirements` rows are checked by a
model for coverage, not for numeric compliance.

**`qa.donor_requirements: "passed"` is asserted, not computed** (index.ts:1935). It is a
literal, chosen by whether a limit exists. It happens to be true today only because `buildDoc`
throws before that object is built. The record should carry the span and the count it was
measured over; P2.5 does that.

---

## Attacks that FAILED — routes I could not open

Reported because a weak attack presented as a pass is worse than a break.

- **Moving prose into a table.** `wordCount` strips `|` and counts cell contents; Word counts
  table text too. No dodge. `limitedText` at `"answers"` scope does not drop table rows.
- **Cutting the last section.** Nothing in the pipeline cuts a section to make a limit. The
  correction loop's last resort (index.ts:681-687) explicitly says *"Do not summarise and do not
  drop a section"*, and `missing_required_section` re-checks afterwards. `ends_mid_sentence`,
  `ends_with_bare_heading`, `ends_mid_table_row` and `empty_section` (index.ts:596-608) all
  catch a document that stops early. This one is genuinely well defended.
- **Page limit with no render.** The refusal at index.ts:1962-1969 is correct and unconditional
  — *when `fmt.maxPages` is non-null*. I could only defeat it by making `maxPages` null, which
  is BREAK 2, upstream.
- **Bullet lists.** `headingOf` does not match `- item`, so bullets are counted. Only ordered
  lists vanish.
- **Hiding words in HTML comments.** Dropped from the count at `"answers"` scope, but they are
  not visible words either. No advantage.
- **Getting the whole-scope count itself to under-read.** `wordCount` strips only `|#*`>` and
  counts every whitespace-separated token containing an alphanumeric. Markdown links and table
  pipes make it over-count, never under-count. I found no input where it reads low.

---

## Measurements marked MISSING

Per the standing rule, these are not opinions I am willing to substitute a verdict for.

- **How often `format_spec` arrives with a string-typed limit — MISSING.** Requires a model
  call; the OpenRouter key returns 403. I established what happens *if* it does (BREAK 2), and
  that the donor's own text writes the number in the string form, and nothing more.
- **How often the scope resolves to `"answers"` in production — MISSING.** It depends on
  `analysis.summary`, which is model-written. On the one real donor text in the repo it
  resolves to `"whole"` (correctly). One sample is not a rate.
- **Whether real generated narratives truncate donor headings, and how much of a real narrative
  sits in ordered lists — MISSING.** No generated narrative is preserved in the repo; the
  referent-ladder packets are not on disk here. BREAK 1 and BREAK 3a are demonstrated on the
  gate, not on live output.
- **Whether the markdown→docx path preserves an ordered list as I assume — read, not run.**
  `toBlocks` needs `npm:marked` and there is no network. The word-limit chain never consults
  blocks, so this does not affect any measurement above.

## Auditing my own audit

Three checks before publishing the numbers, because the last run nearly reported a bug in its
own instrument as a bug in the pipeline.

1. `wordCount` and `normalizeFmt` were **extracted from `index.ts` by `sed`**, not retyped
   (`extracted.ts`, with the source line ranges in its header). The limit decision in
   `attack-truncation.ts` is the two lines of `contentViolations` copied verbatim with the
   citation next to them.
2. The "words the donor counts" figure is computed by a **separate** function from the one
   under test, and excludes only the donor's own question headings — the thing the donor
   plainly does not count. Where I first built a case with a sixth section named "Budget and
   value for money", I rejected it as arguable (the donor asked for five answers) and rebuilt
   it with the heading nested inside answer five, where it is unambiguously answer text.
3. My first "decisive" case was **wrong in the pipeline's favour and I found it by running it**:
   at 126 counted words it would have tripped `minWords: 450` (`suspiciously_short`,
   index.ts:627) and never left generation. The published cases all clear the minimum. The
   consequence is worth stating on its own: under-counting means the floor pushes the generator
   to *add* words to a document that is already over the donor's ceiling.
