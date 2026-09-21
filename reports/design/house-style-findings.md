# Where the scaffolding — not the model — fixes the shape of the output

All line numbers refer to `/home/user/ktebli/supabase/functions/worker/index.ts` (worker v26)
unless a different file is named.

The question this answers: **if two entirely unrelated applicants — a Beirut youth-sports club
and a Manitoba watershed trust — ordered a Draft proposal for two entirely different grants,
what in the code would still make their documents resemble each other?**

The answer is: a great deal. The pipeline's distinctiveness machinery operates on *concept
tuples* (intervention type, beneficiary, geography) inside a single grant. It does nothing at
all about document shape, section inventory, JSON scaffolding, diction, or paragraph rhythm —
and those are exactly the surfaces a reader uses to judge "this reads machine-generated".

---

## TIER 1 — impositions that produce identical document *inventories*

### 1. The tier fixes the exact document set, identically for every customer
`supabase/functions/stripe-webhook/index.ts` lines 58-84 (`stagesFor`).

Every Competitive order produces, in this order and no other: narrative, concept note, budget,
budget justification, covering email. Every Full order adds workplan, logframe, risk table,
board summary. There is no branch on grant type, donor type, sector, or what the donor actually
asked for. A donor that wants a two-page concept note and nothing else still gets nine documents;
a donor that demands a theory-of-change annex gets none.

```
65:    ["gen:narrative", "Drafting the proposal"],
68:    base.push(["gen:concept_note", "Writing the concept note"]);
69:    base.push(["gen:budget", "Building the budget"]);
70:    base.push(["gen:budget_justification", "Writing the budget justification"]);
71:    base.push(["gen:cover_email", "Preparing your covering email"]);
74:    base.push(["gen:workplan", "Laying out the workplan"]);
75:    base.push(["gen:logframe", "Building the logframe"]);
76:    base.push(["gen:risk_table", "Preparing the risk table"]);
77:    base.push(["gen:board_summary", "Writing your board summary"]);
```

### 2. Four documents are mandated table shapes, with the column headers hardcoded
Lines 1054-1056 (`GEN_SPECS`). The pipe-delimited header rows are literal strings in the brief:

- **line 1054** workplan: `a single well-formed markdown table with a header row: | Month | Activities | Milestone |. One row per month, covering the whole project period.`
- **line 1055** logframe: `a single well-formed markdown table with a header row: | Level | Statement | Indicators | Targets | Means of verification | Assumptions |. Rows: the goal, each outcome, each output.`
- **line 1056** risk_table: `a single well-formed markdown table with a header row: | Risk | Likelihood | Impact | Mitigation |. 6-10 real risks for this project, the way donors expect.`

Every Full-tier customer's Workplan.docx has the same three columns in the same order; every
Logframe.docx has the same six. Two unrelated proposals are byte-identical in their table
headers by construction. `6-10 real risks` also pins the row count of the risk table into a
four-row band. The phrase `the way donors expect` is itself an instruction toward the genre mean.

### 3. Fixed word bands per document, independent of subject
- line 1049 narrative: `(1500-2500 words)` — replaced only when the donor states a limit (lines 1550-1552), otherwise this band is universal.
- line 1050 concept_note: `a 1-page concept note (400-600 words)`
- line 1057 board_summary: `a one-page summary`
- line 1134: `minWords: 450` is applied to every narrative as a hard `suspiciously_short` violation.

### 4. The concept note's section list is dictated, in order
Line 1050: `problem, response, who benefits, why this organisation, cost.` Five beats, that
sequence, for every applicant on every grant. The board summary is the same pattern (line 1057):
`what is being applied for, how much, what it commits them to, decision needed.`

---

## TIER 2 — impositions that force uniform *internal structure*

### 5. The Project Design JSON schema is a fixed logframe ontology
Lines 1477-1490. Every project, everywhere, is forced through one shape:

```
1481: "goal":string,"outcomes":[{"outcome":string,"from_outputs":[number]}],"outputs":[{"output":string,"from_activities":[number]}],
1482: "activities":[{"n":number,"activity":string,"months":string,"leads_to":string}],
1483: "phases":[{"phase":string,"months":string}],"duration_months":number,
1486: "sustainability":{"what_continues":string,"who_owns_it":string,"ongoing_costs":string,"how_paid":string,"capacity_remaining":string},
1487: "risks":[{"risk":string,"mitigation":string}],
1488: "indicators":[{"indicator":string,"type":"output"|"outcome","baseline":string,"target":string,"method":string,"frequency":string}],
```

and line 1493 makes the chain mandatory:
`Enforce the chain problem→causes→activities→outputs→outcomes: every outcome maps to outputs, every output to activities.`

This is the decisive one. **Every document downstream derives from this object** — `baseCtx()`
segment 8, line 1160: `PROJECT DESIGN (the single source of truth — every number, activity,
phase, indicator and cost in every document must derive from this)`. A phases array with
`{phase, months}` guarantees every narrative has a phase paragraph or phase table. A five-field
sustainability object guarantees every narrative has a sustainability section covering the same
five questions. Two unrelated applicants get isomorphic arguments because they are pouring
different nouns into the same mould.

### 6. The strategy schema fixes what a "strategy" may consist of
Lines 1386-1391. Ten fields, always the same ten:
`problem_frame, intervention_type, delivery_method, beneficiary, geography_bucket,
signature_mechanic, partnership_model, sustainability_mechanism, measurement_philosophy,
narrative_thesis`. A grant whose real answer is "we already do this, fund the gap" has no
representable form here — it must still produce a signature mechanic and a measurement philosophy.

Line 1388 also forces `"feasibility":{"score":number,...}` and line 1397 hard-codes the
threshold behaviour: `a simple strategy well matched to the grant should score 60+`. Line 1409
rejects anything under 40. The model is being told what number to produce, then filtered on it.

### 7. Exactly 4 candidates, always
Line 1385: `Generate 4 candidate strategies`. Not "as many as are genuinely distinct" — four.

### 8. Eight structural templates and eight opening devices, and nothing else
`supabase/migrations/20260819195010_seed_pools_and_tests.sql` lines 2-20, injected verbatim into
every narrative prompt at line 1518:

```
1518: const styleNote = strategy ? `\nStructure style: ${JSON.stringify(strategy.template_style)}. Opening style: ${JSON.stringify(strategy.opening_style)}.` : "";
```

and locked one-per-grant at lines 1416-1419 (`for (let tpl = 1; tpl <= 8 ...) for (let op = 1; op <= 8 ...)`).

Two consequences:
- **Within a grant**, the 9th customer cannot be served at all (the P0 ceiling already in the report).
- **Across all grants**, every proposal Ktebli has ever written is one of eight structural
  skeletons opening with one of eight devices. Customer #1 on Grant A and customer #1 on Grant B
  both get `problem_first` + `incident`, because the loops always start at 1. The variation
  budget is 64 combinations for the entire product, and the allocation is not even randomised —
  it is first-come index order.

### 9. Budget line-count bands
Line 1529: `with 10-25 lines` (the live inline brief). Line 1051 (`GEN_SPECS.budget`, dead code
on this path) says `12-25`. Either way every budget sheet lands in the same band, and the xlsx
columns are hardcoded at line 1789: `["Category", "Item", "Qty", "Unit", "Unit cost (USD)", "Total (USD)"]`.

---

## TIER 3 — fixed diction and prose-level instructions

### 10. `STYLE_RULES` prescribes one house voice, and it is the only voice offered
Lines 78-83, applied to every narrative (line 1555), every validate correction (line 1673) and
every revision (line 1697):

```
79:  "\n\nWRITING RULES: write like a professional grant writer — clear, specific, evidence-based, direct, " +
80:  "persuasive without sounding promotional, structured around the donor's requirements, easy for an " +
81:  "evaluator to scan. Avoid AI-sounding filler, excessive adjectives, and empty claims like " +
82:  "'groundbreaking', 'transformative' or 'revolutionary' unless concretely justified. Do not repeat the " +
83:  "same argument across sections. Prefer a short paragraph over a long one when it communicates the point."
```

`easy for an evaluator to scan` and `Prefer a short paragraph over a long one` are direct
instructions toward short, uniform, scannable paragraphs. Every proposal is written to the same
rhythm target. Note the tension with the applicant-voice segment (line 1159), which tells the
model to write in the applicant's authentic voice — the two instructions sit in the same prompt.

### 11. Micro-style rules baked into the narrative brief
Line 1049: `Concrete, specific, human; vary sentence length; no em dashes; no invented anecdotes`
and `Use ## section headings.`

`no em dashes` is a house tic applied globally. `vary sentence length` is an instruction that,
given the same model and the same instruction on every job, produces the *same* variation
pattern. `Use ## section headings` fixes the heading level of every narrative in the product.

### 12. The jargon regex is a fixed 17-term blocklist scored deterministically
Line 274:
```
const JARGON_RE = /\b(transformative|groundbreaking|holistic(?:ally)?|robust framework|catalys(?:e|t|ing|ze)\w* change|leverag\w+ synerg\w+|empower(?:ing|s)? communities|foster(?:ing)? collaboration|sustainable ecosystem|multifaceted approach|paradigm shift|cutting[- ]edge|state[- ]of[- ]the[- ]art|synergist\w+)\b/gi;
```
Lines 281-283 flag at ≥2 repeats of one term or ≥5 total. This is a negative style filter with a
list of 17 forbidden words — so every Ktebli proposal is guaranteed to avoid the same 17 words and
no others. It shapes vocabulary uniformly without improving it: a proposal saturated in
"strengthen resilience", "co-design", "stakeholder engagement", "capacity building" passes clean.

### 13. `FORMAT_RULES` fixes the markdown grammar of every document
Lines 57-66, appended to every prose generation. `## and ### headings, short paragraphs,
- bullet lists, numbered lists, **bold**, *italic*` — a closed set. `If something feels like a
diagram, express it as a numbered sequence, a short bullet list, or a table` funnels all
non-prose content into three shapes. `Every heading must be followed by real content` forbids
the section-with-a-lead-in pattern a human writer uses freely.

### 14. `contentViolations` enforces shape deterministically, and one rule bans a legitimate device
Lines 561-612. `empty_section` (lines 577-585) fires whenever a heading is followed immediately
by a same-or-higher-level heading — so no document in the product may ever use a bare section
header over subsections. `ends_with_bare_heading` (line 596) and `ends_mid_sentence` (line 601)
force every document to end on a full-stopped sentence. `degenerate_table` (line 575) rejects any
single-column table.

### 15. The word-limit ladder rewrites everyone's document the same way
Line 635: `const TARGETS = [0.94, 0.85, 0.78];` and line 1141 targets `maxWords * 0.94` in
`baseCtx()`. Any applicant against a donor word limit is aimed at exactly 94% of it, and if that
overshoots, 85%, then 78%. Documents cluster at identical fractions of the donor's cap.
The attempt-3 shortening prompt (lines 659-664) additionally says `Keep every heading exactly as
written, keep every section` — locking the structure produced by attempt 1 or 2 in place.

### 16. Fixed diction inside the customer-facing deliverables
`reportMd` (lines 1062-1086) is not model-generated at all — it is a hardcoded Full-tier "Review
report" whose four bullets and three headings are literal strings identical for every customer:
```
1066:  md += `- **Requirements coverage.** Every material requirement and question in the grant was cross-checked against your proposal, one by one.\n`;
1067:  md += `- **Factual grounding.** Every statement about your organisation's history and capacity was verified ...
1068:  md += `- **The project itself.** The design was challenged the way an evaluator would ...
1069:  md += `- **Numbers and consistency.** Participant figures, timelines and budget totals were reconciled ...
```
`certificationsMd` (lines 1093-1120) is the same: a fixed "Before you submit" document, same
headings, same paragraphs, only the numbered claim list varies.

### 17. Document titles are a closed list
`GEN_SPECS[kind].title`, lines 1049-1057, becomes the docx filename and the in-document title at
line 1800. Every Full order ships `Proposal-narrative.docx`, `Concept-note.docx`,
`Budget.xlsx`, `Budget-justification.docx`, `Covering-email.docx`, `Workplan.docx`,
`Logframe-and-M-E-plan.docx`, `Risk-table.docx`, `Board-summary.docx`, `Review-report.docx`.

### 18. Layout is one deterministic house design, with donor overrides only for the narrative
`deriveDesign` lines 366-388: default body font `Calibri`, `10.5pt`, line spacing `1.15`,
margins `0.87in`, colours `1F1F1F` / `111111`, table borders `B7B7B7`, header shade `EFEFEF`,
heading scale `1.42 / 1.19 / 1.05`. Line 1809 (`const docFmt = isNarrative ? fmt : EMPTY_FMT;`)
means the donor's format spec is applied to the narrative **only** — every other document in
every order in the product is rendered in the identical Ktebli house design.

---

## Things that are NOT imposed (worth stating, because it changes the diagnosis)

- The narrative's own section list is *not* fixed by the scaffolding when the donor defines none.
  Lines 1521-1523 impose donor sections only when `application_structure.defined_by_donor` is
  true. Absent that, the model chooses headings — constrained by the design object's shape (§5),
  the structural template (§8) and `STYLE_RULES` (§10), but not by an explicit section list.
- The exclusivity machinery *does* work at the level it targets: five partial unique indexes on
  `claims` prevent two customers on one grant sharing a concept tuple, template, opening device
  or voice profile.

## The honest reading

The similarity gate (lines 1744/1751, `worst > 25`) measures **verbatim word runs**. Every imposition
listed above is invisible to it: two proposals can share an identical document inventory,
identical table headers, an identical five-part sustainability argument, identical heading
levels, an identical paragraph rhythm target and identical layout, and still register a longest
common run of four words. The system is instrumented to catch the one kind of sameness it does
not produce, and blind to the eighteen kinds it does. That is consistent with the launch-readiness
finding that 8/8 blind judgements said "reads machine-generated" while every internal validator
passed.
