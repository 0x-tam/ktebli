# Silent gates: the donor limit that parsed to nothing

**Date:** 2026-08-27 · **Method:** code reading, git archaeology, and executed proofs.
**No model call was made. No network fetch was made.** Both session blockers respected.

**Status of the code:** both bugs are **fixed in local source** (commit `b81b3d7`, today) and
**not deployed**. Production still runs worker v26, which contains both.

---

## Executive summary

1. A donor word limit written the way donors actually write it — `1,400 words` — parsed to `null`.
2. `null` is not a strict limit. It is no limit. The gate expression is
   `if (opts.maxWords && wordCount(counted) > opts.maxWords)`, so a null limit reports **clean**
   on a document of any length.
3. It disabled the same gate at three stages that always run — generation, validate, package —
   plus `check` and `revise`, which share the options object.
4. The sibling field failed identically: `"3 pages"` also became `null`, which skips the only
   block standing in for the undeployed render service.
5. Cause: `normalizeFmt` accepted a limit only when `typeof x === "number"`, and `jsonOf` is a bare
   `JSON.parse` with no coercion. The extraction schema *declares* `number|null`; nothing enforces it.
6. Second bug, same shape: a donor-mandated heading was satisfied by any **fragment** of the donor's
   own wording, because the match ran both ways. One heading reading `Question` satisfied all five
   of a donor's five questions. A single letter `Q` did too.
7. Both are proven, not argued. `scratchpad/sg/proof.ts` runs the pre-fix and post-fix predicates
   copied verbatim from both git revisions: 14 assertions, 14 proven.
8. **The published "19 of 20 documents over the limit" number does not belong to these bugs.**
   That number was an over-count against the whole markdown file including the attached budget table
   and declaration, which both donors exclude in terms. On the donors' own rule it is 8 of 20, and
   7 of those 8 are single-prompt arms running no enforcement at all.
9. In all 20 replayed documents the limit parsed correctly to a number — the meta files record
   `max_words 1200` and `max_words=800` being enforced. **These two bugs caused none of the overruns.**
10. So the recount did not dissolve the finding, it relocated it: the over-count was a measurement
    error, and the silent parser is a real hole that was found while chasing it. The second is worse.
11. Severity, honestly: proven reachable at the predicate level, with the exact input form preserved
    in this repo's own fixtures. **Never observed firing.** The rate at which the extraction model
    emits a string is MISSING and nothing here estimates it.
12. A green suite did not catch either bug because no test pointed at either function. `index.ts`
    calls `Deno.serve` at module scope and cannot be imported, so both gates were untested by construction.
13. All three in-repo assertions on these two inline gates are source greps, not behaviour, and one
    of them passes on a comment alone — demonstrated. The tests remain the weaker narrator.
14. The class — a check that reports success while doing nothing — is worse than a check that throws,
    because a throw is a stage failure someone sees and a silent pass is a delivered document.
15. `scratchpad/qloop/audit/parser-audit.md` enumerates 23 more proven instances of this exact shape
    across 3,983 lines of edge-function code and 2,455 lines of SQL, with 8 sites checked and clean.
16. Fixed locally: coerce-or-refuse on both numeric limits; one-way heading containment; one counted
    span shared by generation, validate and package.
17. Not fixed: nothing is deployed (local `index.ts` is 139,960 bytes against v26's 129,431), the QA
    record still stores the whole-document count, and an unparsed limit refuses only at `package`.
18. **Compliance has NOT been confirmed on a real end-to-end run.** The local stack was never stood up,
    every model call returns HTTP 403, and production holds only the two $1 trial orders.
19. What is proven is that the gate now refuses the inputs that previously passed it silently.
20. What is not proven is that an order completes. Do not read this report as a launch clearance.

---

## 1. The finding, in thirty seconds

Ktebli sells grant proposals. Donors impose hard word limits; going over gets an application
returned unread, so the limit is the one thing the product may never trade away.

A donor's limit is extracted from the call text by a model into a JSON field, `max_words`. The
worker then normalises it:

```ts
// supabase/functions/worker/index.ts @ 7f3b7e3, line 357
const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && x >= lo && x <= hi ? x : null);
```

If the model returns `1400`, the limit holds. If it returns `"1,400"` — a string, because that is
the literal form in the donor's own sentence — the check falls to `null`.

And `null` is not a strict limit:

```ts
// index.ts:652 (current numbering)
if (opts.maxWords && wordCount(counted) > opts.maxWords) v.push("over_word_limit");
```

`null && anything` is falsy. The gate emits nothing. It reports a clean document. It does this at
**generation**, at **validate**, and at **package** — every stage that reads the limit — and it
does it without a warning, a log line, or a QA flag. The document goes out.

Nothing was broken. Nothing threw. A hard compliance gate quietly turned itself off, on the exact
way real donors write numbers.

---

## 2. The evidence trail — including how it was nearly missed and nearly misdiagnosed

This finding took three wrong turns before it was right, and two of them were this project's own
published numbers. Both matter more than the finding, because they are the reason it survived.

### Step 1 — dismissed as an artefact

`reports/quality-iteration-1.md` §1, limitation 3:

> *"Seven of eight documents broke the word limit, by 9% to 49%. That is almost certainly a replay
> artefact: the real `validate` stage runs a word-limit correction loop the replay did not reproduce,
> and Ktebli has never shipped over a limit in testing. **Treated as an artefact, not a finding.**"*

The reasoning was: enforcement exists, therefore the overruns are the harness's fault. That is an
argument from the code's intent, not from the code. It was filed under limitations and closed.

### Step 2 — the artefact reading withdrawn

`reports/referent-ladder.md` ran a different fixture, a different grant, a different generator mix,
and measured **12 of 12** over, from +227 to +1053 words. Its original §2 concluded that 19 of 20
across two independent setups is not an artefact, and withdrew the artefact reading.

That was the right instinct on the wrong number.

### Step 3 — the recount, which corrected this project's own headline

Both fixtures state their counting rule in terms:

- `ladder/grant.json`: *"The five answers together must not exceed 1,200 words … **Headings, the
  budget table and the declaration are not counted towards the limit.**"*
- `case-ukyouth.json`: *"…must not exceed 1,400 words … **we do not count headings, the budget table
  or the declaration towards the limit.**"*
- `case-evidence-poor.json`: *"The narrative across **sections 2 to 6** must not exceed 800 words.
  **Section 1 and Section 7 are not counted.**"*

Both headline numbers were measured against the whole markdown file, budget table and declaration
included. Recounted on the donors' own rule (`reports/design/word-limit.md` §A3, all 20 documents,
per-document table published):

| | documents | over the donor's real limit |
|---|---|---|
| pipeline arms (A, B) — enforcement present | 10 | **1 firm (n09-A +210) + 1 disputed (n03-B ±16)** |
| single-prompt arms (C, D) — no enforcement | 10 | **7** |

**8 of 20, not 19 of 20. And 7 of the 8 ran no enforcement at all.** That recount was a correction
to this project's own published figure, made against its own interest — it removed the most dramatic
number in two reports.

*Auditing the auditor.* The two recounts do not fully agree. `referent-ladder.md`'s retraction
reports **0 of 8** pipeline arms over across "all sixteen documents"; `word-limit.md`'s independent
recount of all **twenty** finds one firm overrun (n09-A) and one disputed (n03-B). I could not
reconcile the 16-document basis with the 12 ladder plus 8 iteration-1 documents that exist. The
20-document recount is the one to trust: it publishes a per-document table, it reproduces the
sub-agents' own donor-rule figures at nine of nine points where they published them, and it marks
its single disagreement as disputed rather than picking a side. The direction is identical either
way and neither supports 19 of 20.

### Step 4 — reading the code, which found something else

Only then did anyone read `normalizeFmt`. The two bugs in §3 were found there. They are not what
the 19-of-20 was measuring.

### What the recount did and did not do to the finding

It **relocated** it. It did not dissolve it.

- The over-count was real. It made the gate 17–31% stricter than the donor's rule, refused compliant
  documents into `attention` with no notification (launch-readiness P0-4), and burned destructive
  shortening rounds on prose that was already inside the limit. That is fixed separately by
  `word_limit.ts` and the `limitScope` work.
- The silent parser was also real, and is the serious one, because the over-count fails **strict**
  and the parser fails **open**.

### The part that must not be overstated

**These two bugs caused none of the 20 overruns.** In every replayed pipeline document the limit
parsed to a number and the gate ran. The meta files say so directly:

- `qloop/ladder/meta-n03-B.json`: *"analyze correctly recorded max_words 1200 — but nothing
  downstream knows about the exclusion."*
- `qloop/meta-evidence-poor-A.json`: *"format_spec.max_words=800 is applied by contentViolations to
  the ENTIRE document."*
- `qloop/meta-evidence-poor-B.json`: *"format_spec.max_words=800 is then enforced…"*

Both fixtures write their limits with commas (`1,200 words`, `1,400 words`) and the extraction model
stripped the comma itself on every one of those calls. That is the whole character of this defect:
it is **input-dependent on a nondeterministic formatting choice made by a model**, so it can sit
latent through twenty documents and fire on the twenty-first. The brief I was given states that the
two bugs "explain 19 of 20 documents breaking the limit". They do not, and I am recording that as
the third correction in this chain rather than repeating it.

---

## 3. The two bugs

Line numbers are given for both revisions: `7f3b7e3` is the last commit carrying the bugs, `HEAD`
(`b81b3d7`) is the fix. All numbers are **local** source, which CLAUDE.md records as ahead of
deployed v26. Diff before acting.

### Bug 1 — a stated limit becomes no limit

**`supabase/functions/worker/index.ts:357`** (pre-fix), consumed at **:369-370**:

```ts
const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && x >= lo && x <= hi ? x : null);
...
maxPages: num(r.max_pages, 1, 200),
maxWords: num(r.max_words, 100, 100000),
```

The value arrives through **`index.ts:178-180`**:

```ts
function jsonOf(s: string): Record<string, unknown> {
  return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
}
```

`jsonOf` is a bare `JSON.parse`. It performs no coercion and no schema validation. The `analyze`
prompt at **:1297** declares `"max_words":number|null`, but a prompt is a request, not a type system.

**Exact defeating input**, as the model returns it:

```json
{"max_words":"1,400","max_pages":"3 pages"}
```

**Executed result** (`scratchpad/sg/proof.ts`):

```
ok   jsonOf carries max_words through as string "1,400"
ok   OLD: a 1,400-word donor limit becomes null
ok   OLD: a stated 3-page limit becomes null too (same shape, sibling field)
ok   a null limit reports CLEAN on a 99,999-word document — no gate at all
ok   the same document with the limit parsed is refused
```

**Where the null propagates.** `fmt` is built once at `runStage` and reused:

| site | line (HEAD) | what a null limit does |
|---|---|---|
| generator brief | 1253, 1674-1675 | the model is never told a limit exists |
| `gen:narrative` gate | 1668 → 652 | `over_word_limit` never emitted |
| `generateValidated` repair ladder | 680-691 | no `lengthDetail`, no shortening target |
| `validate` correction | 1817-1822 | no LENGTH instruction in the correction prompt |
| `check` / `revise` | 1843, 1855, 1894 | same `narrativeOpts`, same silence |
| `package` re-check | 1966 → 652 | the independent second gate also passes |
| QA record | 1982-1984 | `donor_requirements: "n/a"`, `word_limit: null` |
| page-limit block | 2013-2016 | with `maxPages` null, the **only** thing standing in for the undeployed render service is skipped |

The last row is the one to sit with. `reports/launch-readiness-report.md` and CLAUDE.md both record
that a donor **page** limit blocks delivery until `render-service/` is deployed. Written as
`"3 pages"`, that block does not exist either.

### Bug 2 — a heading satisfied by a fragment of the donor's own wording

**`supabase/functions/worker/index.ts:610-613`** (pre-fix):

```ts
const headingText = real.filter((b) => b.kind === "heading").map((b) => plainOf(b.inline).toLowerCase());
for (const s of opts.requiredSections ?? []) {
  const needle = s.toLowerCase().trim();
  if (!headingText.some((h) => h.includes(needle) || needle.includes(h))) v.push("missing_required_section:" + s.slice(0, 40));
}
```

The containment runs **both ways**. `needle.includes(h)` means a heading that is any substring of
the donor's required wording satisfies it.

**Exact defeating input:** a document whose only heading is `## Question`, against a donor requiring:

```
Question 1: What specific problem will this project address?
Question 2: What exactly will you do?
Question 3: Who will benefit, how many people?
Question 4: How will you know the project worked?
Question 5: What happens when the grant ends?
```

**Executed result:**

```
ok   OLD: one heading reading 'Question' satisfies all five donor questions
ok   OLD: so does a single letter 'Q'
ok   NEW: 'Question' satisfies none of the five
ok   NEW: reproducing the donor's wording still passes
ok   NEW: a heading carrying MORE than the donor's wording still passes — the check is one-way, not equality
```

This is compliance by truncation, which invariant 5 forbids outright. The donor's instruction in the
ukyouth fixture is *"using each question as a heading, exactly as written"*.

### Both at once

```
ok   OLD: a 4,200-word document under one heading 'Question' passes BOTH gates and is delivered
```

---

## 4. The shared shape, and why it is the dangerous one

Both bugs are the same object: **a check that reports success while doing nothing.**

Not a check that is missing — a reader auditing the file finds `contentViolations`, finds the
comment *"A donor word limit is a hard limit: never ship over it"*, finds `normalizeFmt` clamping
ranges, and concludes the limit is enforced. It is enforced, conditionally, on an input shape nobody
wrote down.

Why this class outranks a check that throws:

1. **A throw is visible.** A stage fails, the order lands in `attention`, the reaper logs it, and
   someone eventually looks. A silent pass produces a delivered `.docx` and a QA record that says
   `content_validation: "passed"`.
2. **Everything downstream trusts it.** `package` re-runs `contentViolations` as an independent
   second gate — but it is independent in *location*, not in *input*. Both gates read the same
   `fmt`, so a null limit defeats them simultaneously. Two gates, one point of failure.
3. **It fails open, and the failure looks like the healthy case.** A donor that states no limit at
   all also yields `maxWords: null`. The system cannot tell "this donor imposed nothing" from "this
   donor imposed 1,400 words and we could not read it". That is precisely the distinction invariant
   5 exists to preserve, and the type had nowhere to record it.
4. **It is input-dependent and nondeterministic.** The defeating value comes from a model. It can be
   absent from twenty consecutive runs and present on the twenty-first, so absence of the symptom is
   not evidence of absence of the bug.

### Why a green test suite did not catch it

This is the uncomfortable half.

- **Until 2026-08-27 no test in the repo so much as mentioned either function.** At commit
  `f04b42f` — the last state before the adversarial suite landed —
  `git grep -l "normalizeFmt\|contentViolations" -- tests/` returns **nothing**. Seven pure Deno
  suites plus the migration replay and the exclusivity harness were the whole suite, and not one of
  them pointed here. The first mention of either name in a test arrives at `7f3b7e3`, in a file
  written to fail.
- **The reason is structural.** `index.ts` calls `Deno.serve` at module scope (line 2049), so it
  cannot be imported by a test. Every gate that lives inline in `index.ts` is untestable by
  construction, and both of these do.
- **A comma was already in the test corpus and still did not reach the parser.**
  `tests/word-limit/word_limit_test.ts:11` asserts on `"The narrative must not exceed 1,200 words."`
  — comma included — but feeds it to `limitScopeFrom`, a *different* function in a *different*
  module. The one importable piece of the word-limit machinery was well tested. The number parser
  next to it had no test at all.
- **The tests that exist for these gates now are greps, not behaviour.** All three assertions in
  `tests/adversarial/compliance_truncation_test.ts` §4 match against `index.ts` as text. Assertion 4b is `/numLike|limit_unparsed|unparsed_limit/.test(SRC)`. The word `numLike`
  appears in a **comment** at `index.ts:359`. I ran it: the assertion passes on a source file where
  the comment survives and the function is reverted to the buggy one-liner.

  ```
  adversarial 4b grep passes on comment-only source: true
  ```

  That is not a weakening introduced by anyone — it is the limit of what a grep can assert — but it
  means the suite's green on this gate is worth less than it looks. The behavioural proof in
  `scratchpad/sg/proof.ts` is the stronger evidence and it is the one to cite.
- **Recommendation, strict direction:** lift `normalizeFmt` and the required-section matcher into an
  importable pure module the way `word_limit.ts` already is, and replace the three source greps with
  behaviour tests. Until then, keep the greps — a weak assertion beats none — but do not count them.
- **In flight, by another agent, not audited here.** `supabase/functions/worker/donor_limits.ts`
  (370 lines, untracked, **imported by nothing**) is exactly that module: a `parseDonorLimit` with a
  three-way `limit | absent | refused` outcome and no quiet null. I did not review it, did not run
  it, and make no claim about it. It is noted so this report is not read as recommending work that
  someone is already doing.

---

## 5. What else has this shape

`scratchpad/qloop/audit/parser-audit.md` went looking for the shape across the whole wired codebase
and found it is not rare. Executed, not asserted: 35 predicate assertions all proven, plus SQL proofs
replayed into throwaway Postgres clusters.

**23 proven silent-pass sites. 0 unproven. 8 sites checked and found clean. 1 of the auditor's own
hypotheses retracted before publication because the proof refuted it.**

The ones that outrank everything else, all of them compliance or grounding gates:

| # | Site | Defeating input | What trusts it |
|---|---|---|---|
| F1 | `index.ts:386` | `"required_sections": "Q1; Q2; Q3"` — a string, not an array | the entire donor-structure gate. **The sibling field of this report's bug, on the same object, and it has no `limitUnparsed` equivalent** |
| F3 | `index.ts:1740, 1774` | `"claims": {…}`; or `"Unsupported"` with a capital U | the Claim Ledger — the project's stated grounding gate |
| F5 | `index.ts:1281-1283` | any fetch failure on a grant URL | every donor requirement, limit, page cap and section, all null. The applicant paid for compliance against a document never read |
| F2 | `word_limit.ts:170-186` | an `## Annex` heading over paragraphs of ≤25 words each | 767 words counted as 3 |
| F4 | `index.ts:1395` | a wrong-org site with no `legal_name` | the website identity gate's *entry condition* |
| F13 | `stripe-webhook:190-192` + deployed schema | the escalation inserts as written | the only operator-alerting mechanism in the system. **Proven: zero rows written, all three call shapes** |

Read that file before fixing anything here — several of its entries are cheaper to fix than this one
was and rank higher on consequence. Its §3 (eight sites checked and clean, including `jsonOf` itself,
which throws loudly on malformed output) and §4 (the retracted hypothesis) are the parts that make
the rest credible.

---

## 6. What is fixed, what is proven, and what is not

### Fixed in local source — commit `b81b3d7`, undeployed

**Bug 1** — `index.ts:361-388`. `numLike` coerces the shapes a model actually emits (`"1,400"`,
`"1800 words"`). Anything still unreadable is pushed onto `Fmt.limitUnparsed` rather than dropped,
and `index.ts:1972-1974` refuses at `package`:

```ts
if (isNarrative && fmt.limitUnparsed.length) {
  throw new Error(`donor limit not parsed, compliance cannot be established: ${fmt.limitUnparsed.join(", ")}`);
}
```

A limit that fails to parse now refuses. It never becomes null. Applied to `max_pages` as well.

**Bug 2** — `index.ts:632-639`. Containment runs one way: `headingText.some((h) => h.includes(needle))`.
The heading may carry more than the donor's wording, never less.

**A third, adjacent** — `index.ts:1966` now spreads `...narrativeOpts` into the package options, so
generation, validate and package compute the counted span from the same inputs. Previously the
package call built its options from scratch and omitted `limitScope`, so one document could be
compliant at generation and terminally failed at render with the correction loop never told there
was a length problem.

### Proven, by execution

- `scratchpad/sg/proof.ts` — 14 assertions, 14 proven, pre-fix and post-fix predicates copied
  verbatim from both git revisions. Deno type-checks clean.
- `tests/adversarial/compliance_truncation_test.ts` — 11 assertions, all held.
- `tests/word-limit/word_limit_test.ts` — all held.
- All 11 pure Deno suites pass on HEAD (proper-nouns, numeric-register, contact-claims,
  crawl-outcome, delivery-gate, sufficiency, word-limit, referent-weight, and all four adversarial).
  `tests/replay` and `tests/exclusivity` were not run — they need Postgres, and `exclusivity` is
  deliberately failing by design.

### NOT fixed, NOT proven — stated plainly

1. **Nothing is deployed.** Local `worker/index.ts` is 139,960 bytes; DEPLOY.md records deployed v26
   at 129,431. **Production runs both bugs today.** It also holds only the two $1 trial orders, so
   no paying customer is currently exposed — but the fix is not in.
2. **Compliance has NOT been confirmed on a real end-to-end run.** The local stack was never stood
   up. Every model call in this session returns HTTP 403 (the key's own spend cap, not the account
   balance). No order has been taken from intake to `deliver` under the corrected gates. Every claim
   in this report is at the predicate level. **MISSING.**
3. **The rate is MISSING.** How often the extraction model emits `max_words` as a string is not
   estimated here and should not be guessed. It was zero across the 24 meta files available, on
   fixtures that do use commas. Zero observations is not a rate.
4. **The unparsed-limit refusal fires only at `package`.** A whole Competitive or Full narrative is
   generated, validated and revised with no limit before the order dies at render. That is correct
   under invariant 5 — it refuses rather than ships — but it burns the full generation cost and,
   with launch-readiness P0-4 still open, the customer is never told. Refusing earlier, at
   `gen:narrative`, is the strictly better shape and is not done.
5. **The QA record still stores the wrong count.** `index.ts:1983` writes `word_count: wordCount(md)`
   — the whole document — while the gate at `:652` counts `limitedText(...)`. The two numbers that
   diverged are still not both recorded. `reports/design/word-limit.md` Patch 5 specifies this and
   it was not applied. It is the observability that would have caught the over-count in step 3.
6. **A required section that normalises to empty is still skipped silently.** `normalizeFmt` keeps
   any string longer than two characters, so `"---"` survives; `normHead("---")` returns `""`; and
   `:638` does `if (!needle) continue`. Verified by execution. That section is never gated. This is
   the parser audit's F21 and it is unfixed.
7. **The new heading matcher normalises punctuation and markdown emphasis.** `Question 1: What…`
   and `Question 1 What…` both match. That is more permissive than exact-string equality. It is
   strictly less permissive than the bidirectional check it replaced, and it does not admit any
   fragment — the donor's full token sequence must be present — but it is a deliberate loosening
   against the donor's literal *"exactly as written"* and is recorded here rather than left implicit.
8. **Fifteen of the parser audit's 23 sites are unfixed**, including F1, which is the same class on
   the same object as Bug 1.

### One thing this report does not claim

No delivered document in the 20-document evidence went out over a donor limit. The recount in
`reports/design/word-limit.md` §e checks this directly: the one genuine overrun (n09-A, 1410 against
1200) also measured 1776 whole-document, so the mis-scoped gate would still have refused it.
Invariant 1 was not breached anywhere in that evidence. The bugs in this report are a hole through
which it could be, not a record of it being.

---

## 7. Reproducing this

```
cd /home/user/ktebli
npx --yes deno@2.9.5 check /tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/sg/proof.ts
npx --yes deno@2.9.5 run   /tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/sg/proof.ts
npx --yes deno@2.9.5 run --allow-read tests/adversarial/compliance_truncation_test.ts
git show 7f3b7e3:supabase/functions/worker/index.ts | sed -n '355,372p;607,615p'   # the bugs
sed -n '359,390p;626,653p;1965,1975p' supabase/functions/worker/index.ts          # the fixes
```

Related reading, in order: `reports/design/word-limit.md` (the scope defect and its patch spec),
`reports/referent-ladder.md` §2 (the retraction), `reports/quality-iteration-1.md` §1 (the original
dismissal), `scratchpad/qloop/audit/parser-audit.md` (23 more of these).

`worker/index.ts` was not modified by this report. No file outside `reports/silent-gates.md` was
created or changed.
