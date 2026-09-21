# Parser and matcher audit — every site with the "reports success while doing nothing" shape

**Date:** 2026-08-27 · **Method:** code reading + executed proofs. **No model call was made.
No network fetch was made.** Both blockers respected.

**Result: 23 proven silent-pass hits. 0 unproven. 8 sites checked and found clean.
1 hypothesis of mine RETRACTED before publication because the proof refuted it.**

Everything below was executed. `prove.ts` runs 35 assertions against the repository's own
code and prints `35/35 assertions proven`; `sql-prove.sh` / `sql-prove-prod.sh` replay the
migrations into throwaway Postgres 16 clusters and run the SQL proofs.

---

## 0. How the proofs are wired, and why they are the real code

`audit/real.ts` is **not a transcription**. `audit/extract.sh` copies exact line ranges out of
`supabase/functions/worker/index.ts` (`sed -n '350,391p'` and so on) and concatenates them.
A checker then asserts that every one of the 283 extracted lines appears verbatim in the
worker: **`lines NOT present verbatim in worker/index.ts: 0`**. `word_limit.ts`,
`proper_nouns.ts`, `contact_claims.ts` and `analyze-grant/http.ts` are imported directly —
they are pure modules and need no extraction.

Where a gate is an inline expression inside `runStage` rather than a named function
(the strategy distinctness gate, the Claim Ledger gate, the coverage gate, the package
skip, the `check` stage's donor stripper), the predicate is reproduced in `prove.ts` with
the worker line number cited beside it, and — for `A10` — the assertion compares against
`worker/index.ts` read from disk at run time, so the source cannot drift out from under it.

```
$ audit/extract.sh && deno check real.ts                 -> EXTRACT_OK
$ deno run --allow-read prove.ts                         -> 35/35 assertions proven
$ audit/sql-prove.sh                                     -> 15 migrations replayed, S1-S5
$ audit/sql-prove-prod.sh                                -> deployed-era schema, S6
```

---

## 1. The enumerated table

`SP` = silent pass (the gate returns "no violation"). `LR` = loud refusal.
Line numbers are **local** `supabase/functions/`, which CLAUDE.md records as ahead of
deployed v26. Diff before acting.

| # | File:line | Shape | Smallest input that defeats it | What downstream trusts it | Verdict | Proof |
|---|---|---|---|---|---|---|
| **F1** | `worker/index.ts:386` | A | `"required_sections": "Q1; Q2; Q3"` — a string, not an array | `contentViolations` missing-section loop; `constraintsAt()`; `check`'s `donorLines`; `limitedText`'s `donorHeadings`; `qa.donor_requirements` | **SP** | A1, A1b |
| **F2** | `worker/word_limit.ts:170-186` | B | a `## Annex` heading followed by paragraphs of **≤25 words each** | the donor word limit at generation, validate and package | **SP** | B7, B7b |
| **F3** | `worker/index.ts:1740, 1774` | A+B | `"claims": {…}` (object); or `"Unsupported"`; or `"status":"not_covered"` | `blocking === 0` → validate breaks out → delivery | **SP** | A5, A5b, A5c, A5d |
| **F4** | `worker/index.ts:1395` | B | a wrong-org site with **no** `legal_name` and **no** concrete evidence claims | `org.profile` + `voice_guide` enter `baseCtx()` as ORGANISATION PROFILE | **SP** | B1 |
| **F5** | `worker/index.ts:1281-1283` | A | any fetch failure on a grant URL | every donor requirement, limit, page cap and section, all null | **SP** | A10, A10b |
| **F6** | `worker/index.ts:1540-1541` | A | omit `distinctness`; or `"Same"`; or `"score":"low"` | `claim_approach` reservation — exclusivity and feasibility | **SP** | A4, A4b, A4c |
| **F7** | `worker/contact_claims.ts` `hasDigits` | B | `**Registered office:** Cedar House, Elm Street, Tripoli.` | the only BLOCKING deterministic grounding check in the wired pipeline | **SP** | B3 |
| **F8** | `worker/contact_claims.ts` fabricated filter | B | ledger `ukyouth.org` vs document `ukyouth.org.donations.example.com` | same blocking gate | **SP** | B4 |
| **F9** | `worker/contact_claims.ts` `INTL_PHONE` | B | drop the `+`: `Call the team on 020 7946 0000` | same blocking gate | **SP** | B5 |
| **F10** | `worker/index.ts:474-491` | B | one shared non-generic token; or a 4-char token as a substring of the host | the website identity gate | **SP** | B2, B2b |
| **F11** | `worker/proper_nouns.ts` `p === p.toUpperCase()` | B | write the invented partner in CAPITALS | the unsourced-proper-noun finding (advisory) | **SP** | B6 |
| **F12** | `*/http.ts` `rateLimit` (both copies) | A | make `rl_hit` return any non-2xx, or fail | 4 public edge functions' abuse and cost control | **SP** | A8 |
| **F13** | `stripe-webhook:190-192`, `worker:1150-1156` + deployed schema | A (SQL) | the inserts as written | the only operator-alerting mechanism in the system | **SP** | S6 |
| **F14** | `claim_approach` sanctions gate | B (SQL) | the `'pending'` default — i.e. every organisation | "refuse sanctioned orgs at the door" | **SP** | S2 |
| **F15** | `worker/index.ts:1938-1939` | A | `finalNarrative()` returns `""` | `limitUnparsed` throw and `buildDoc` are both skipped; `deliver` still emails | **SP** (competitive/full) / **LR** (draft) | A11, A11b |
| **F16** | `worker/index.ts:975-977` | A | a transient failure of `rpc("get_secret")` | `not_configured` is indistinguishable from a real outage | **SP** when no page limit | A12, A12b |
| **F17** | `worker/index.ts:381-384` | A | donor states Palatino / 16pt / 2.5in / Legal | `docxViolations` then skips `donor_font_not_applied` because `fmt.font` is null | **SP** | A3 |
| **F18** | `worker/word_limit.ts:95-99` | B | the sentence *"Nothing is excluded from the word limit."* | scope narrows to `answers` — the only direction that loosens | **SP** | A7, A7b |
| **F19** | `worker/index.ts:1229-1230` | A | always: `analysis.guidelines_text` is not a field `analyze` emits | scope decided from a model-written `summary` | **SP** (strict-direction miss) | A6 |
| **F20** | `worker/index.ts:1885-1891` | B | a prose line that CONTAINS a donor question | the exclusivity similarity measure | **SP** | B8 |
| **F21** | `worker/index.ts:386` + `:630` | A | `"required_sections": ["---"]` | that section is never gated: passes `length>2`, then `if (!needle) continue` | **SP** | A2 |
| **F22** | `stripe-webhook:46` | A | `t=abc` → `NaN > 300` is false | the 300-second replay window | **SP** (shape only — HMAC covers `t`, so not independently exploitable) | A9 |
| **F23** | `worker/index.ts:428` | B | `aaab` | `identityCheck` org flags | **SP** | B10 |

---

## 2. Ranked fix list

Ranking is by consequence, exactly as instructed: a hit that disables a compliance gate
outranks one that degrades a log line.

### P0 — a compliance or grounding gate that silently reports success

**1. F1 — `required_sections` as a string erases the whole donor-structure gate.**
This is the *sibling field* of the one that produced the current finding, on the same object,
and it has no `limitUnparsed` equivalent. `numLike` + `limitUnparsed` were added for
`max_words` and `max_pages` and stop at the array boundary.
*Fix, strict direction:* coerce a string to an array by splitting on `;` / newline, and where
`required_sections` is present but neither an array nor a splittable string, push
`required_sections=<json>` into `limitUnparsed` so `package` refuses. An unreadable donor
structure is not an absent donor structure.

**2. F2 — the word limit is defeated by pressing Enter.** 767 words counted as 3.
*Fix, strict direction:* make the prose test cumulative over the section, not per paragraph —
sum `wordsIn` across every held line and restore the whole section once the running total
crosses `PROSE_LINE_WORDS`. Also cap the total words any single excluded section may remove
(a real attached budget table is short). Both changes count MORE, never less.

**3. F3 — the Claim Ledger and coverage gates.** Four independent defeating inputs on the
project's stated "actual grounding gate".
*Fix, strict direction:* refuse rather than default. If `ledgerOut.claims` or `revOut.coverage`
is not an array, treat the round as unresolved and throw — a review that did not return a
readable verdict has not cleared anything. Compare classifications case-insensitively against
the closed set, and treat any classification outside the set as `unsupported`, not as clear.

**4. F5 — a failed grant fetch is analysed as the URL.** The applicant paid for compliance
against a document the pipeline never read.
*Fix, strict direction:* on catch, throw. A grant page that could not be fetched is not a
grant page. (`analyze-grant` — the pre-payment sibling — already does this correctly:
it returns `{ok:false, reason:"unreachable"}`.)

**5. F4 — the identity gate's trigger condition.** Run the gate whenever `domain` is set and
**anything at all** was extracted from the site — `Object.keys(profile).length || webEvidence.length` —
not only when `legal_name` survives. The gate is documented as asymmetric; its *entry
condition* is not.

**6. F6 — the strategy gate's permissive defaults.** `?? "clear"` → `?? "same"`;
`?? 0` is already strict, but guard the comparison with `Number.isFinite(feas)` so a
non-numeric score rejects rather than passing through NaN.

### P1 — a blocking check with a fragment hole

**7. F7** — drop the `hasDigits` precondition for the `address` / `office` label kinds, or
compare the whole labelled value against the ledger regardless of digits.
**8. F8** — require host equality, or equality plus a leading path segment; never a bare
`startsWith` in either direction on a hostname.
**9. F9** — add a labelled-free national-format phone pattern, or accept the miss explicitly
in the module comment as a stated limitation rather than a silent one.
**10. F10** — require two shared non-generic tokens, or one token of length ≥ 6, before
admitting a site; and make the domain-substring test a label-boundary test, not `includes`.
**11. F11** — drop the `p === p.toUpperCase()` skip for multi-word runs; keep it only for
single words.
**12. F20** — strip a donor question by *replacing the matched span* inside the line, not by
deleting the whole line.

### P2 — silent pass with a non-compliance consequence

**13. F13** — deploy migration `20260826150000`. Until then every escalation insert in the
repository fails and is swallowed; **proven, zero rows written for all three call shapes.**
Then remove the `.catch(() => {})` around the escalation write, or log the failure.
**14. F12** — `rateLimit` must fail CLOSED on a 5xx and on a throw; and `clientIp` must not
trust the first `X-Forwarded-For` value unless the platform is known to overwrite it.
**15. F14** — either screen sanctions or delete the gate. A gate that has never fired and
cannot fire is worse than no gate, because the code reads as if screening happens.
**16. F15** — move `if (!md.trim()) continue;` to `if (isNarrative && !md.trim()) throw …`.
**17. F16** — distinguish "secret absent" from "secret lookup failed"; the second must not
read as `not_configured`.
**18. F17** — pass a `field` name to `num()` for `font_size_pt`, `line_spacing`,
`margin_inches`, and record an unrecognised `font` and `page_size` too, so a stated-but-unreadable
format requirement refuses at `package` like a stated-but-unreadable limit already does.
**19. F18** — require the exclusion regex to be preceded by a positive assertion, and add a
negative lookbehind for `nothing is`/`no `/`not `.
**20. F19** — carry the donor's guidelines text through `analyze`'s output (it is already
written to `grants.guidelines_text`; the stage output simply does not carry it).
**21. F21** — after `normHead`, if a required section normalises to empty, push it into
`limitUnparsed` instead of `continue`.
**22. F22** — `if (!Number.isFinite(Number(t))) return false;`
**23. F23** — raise the org minimum length, or require two tokens or a digit-free dictionary word.

---

## 3. Checked and found CLEAN — stated so the coverage is honest

| Site | Why it is clean |
|---|---|
| `jsonOf` (12 call sites) | throws on empty, brace-less and truncated model output. **Loud, not silent.** Proof `A13` (3/3 threw). No call site wraps it in a swallowing catch. |
| required-heading matcher, `index.ts:630` | the archetype fix holds one-way: `headingText.some(h => h.includes(needle))`. `## Question` no longer satisfies `Question 1: describe the need`. Proof `B9`. |
| `limitedText(md, "whole", …)` | returns `md` unchanged; the default path is byte-identical to the pre-scope counter. |
| `contentViolations` `maxWords` | strict `>`, no tolerance band, refusal by default. |
| `generateValidated` | every exit is a clean re-check or a throw; nothing truncates. Invariant 5 holds. |
| `renderService` + `fmt.maxPages` | **loud refusal** when the page count cannot be verified. Proof `A12b`. |
| `claims` lock columns | `fingerprint`, `grant_id`, `organisation_id`, `voice_kind`, `voice_profile_id`, `status` are **all NOT NULL** (proof `S5`), so no NULL slips past a partial unique index. |
| `worker/delivery_gate.ts` | **the counter-example.** `parseJudgement` refuses a string `"4"`, a `4.5`, a non-boolean disqualifier, an empty `weakest_thing`, a non-array `fix_instructions`; `applyBar` does no averaging; a critic without a valid judgement produces `hold`, never a pass; a document's own claimed `"verdict"` is read and discarded. This is what the fixes above should look like. **It is imported by nothing.** |

---

## 4. RETRACTED before publication — one of my own hypotheses

I predicted that `rollup_statuses()` marks a proposal with **zero** `job_stages` as
`complete`, because `not exists (… and s.status <> 'done')` is vacuously true, and that the
`orders` half carries a missing-rows guard the `order_proposals` half lacks. That reading is
correct for the **original** definition at `20260820145739_orders_and_job_queue.sql:127-137`.

**It is wrong for the code that ships.** `20260820172956_revisions_order_ids_and_intake_files.sql:38`
redefines the function and adds `where exists (select 1 from public.job_stages s where
s.proposal_id = p.id)`. Proof `S1`, on the replayed schema, returns
`proposal_status = queued | stages = 0 | order_status = processing` — not `complete`.
**The finding is withdrawn.** I am recording it because the instruction to audit the auditor
is what caught it: the hypothesis was plausible from one migration and false against the
replay, and a table row asserting it would have been a fabricated defect.

What `S1` *does* show, and what is not a parser shape: that proposal stays `queued` and its
order stays `processing` **forever**, with no stage to reap and no alert. That is the P0-4
notification gap wearing a different costume, and it belongs to whoever owns that item.

---

## 5. One cross-check that is not a shape but must not be lost

`20260826160000_unbounded_composer.sql` **drops** `claim_approach(uuid,uuid,text,text,text,
text,text,smallint,smallint,uuid,text)` and drops `claims.structural_template_id` /
`claims.opening_device_id`. Proof `S4`: after replaying every migration, the **only**
signature that exists is the 13-argument composer one. `worker/index.ts:1553-1559` still
calls the 11-argument version with `p_template` / `p_opening`. Applying that migration against
the deployed worker breaks every strategy stage. This fails **loudly** (`rpc()` throws on
`!r.ok`), so it is not a hit under either shape — but it is a deploy-order trap.

---

## 6. Coverage — what I reached and what I did not

**Reached and audited, line by line:**

- **3,983 lines** of wired edge-function code: all 8 functions plus the 4 worker modules
  `index.ts` actually imports (`proper_nouns`, `contact_claims`, `word_limit`, `ssrf`) and
  the two `http.ts` copies.
- **2,455 lines** of SQL: all 15 migrations, replayed and queried, plus the production
  schema dump `db/schema.sql`.

**Candidate sites enumerated across the wired code** (every one read; the table above is what
survived):

| construct | sites |
|---|---|
| `.includes(` | 30 |
| `.startsWith(` | 21 |
| `.some(` | 14 |
| `.test(` | 75 |
| `??` | 202 |
| `\|\|` | 120 |
| `catch` | 61 |
| `Number(` / `parseInt` / `parseFloat` | 9 |
| `.match(` | 8 |
| `jsonOf(` call sites | 12 |

**NOT reached — stated as MISSING, not as clean:**

1. **4,888 lines in five worker modules that nothing imports** — `delivery_gate.ts`,
   `sufficiency.ts`, `crawl_outcome.ts`, `numeric_register.ts`, `referent_weight.ts`.
   `index.ts` imports only four local modules; these five are dead code today. I **scanned**
   them and read the gate paths in `delivery_gate.ts` and `sufficiency.ts` in full, but did
   not prove them, because a latent defect in unwired code cannot rank against a live one.
   Two latent hits noted for whoever wires them:
   - `sufficiency.ts:433` `documentIsAttributable` — one shared non-generic token anywhere in
     the text returns true. Same shape as F10.
   - `sufficiency.ts:441` `hasDate` — `MONTHS` matches the bare word **"may"**, so
     *"we may deliver"* satisfies the `dated` anchor; and `/\b(19|20)\d{2}\b/` reads
     *"2000 participants"* as a year.
   - `sufficiency.ts:668` `activityRich` — twelve characters of anything clears it.
2. **Live end-to-end behaviour.** No model call and no network fetch was possible. Every
   model-dependent hit above is proved at the **predicate** level, with the model's own output
   as the input — which is exactly where these defects live, and is the same level at which
   the `1,400 words` finding was established. What is genuinely MISSING is the *rate*: how
   often a real generator emits `"required_sections"` as a string, or `"Unsupported"` with a
   capital U. Nothing here estimates that, and nothing here should.
3. **The deployed v26 worker and the deployed schema.** Every line number is local.
   CLAUDE.md records `supabase/functions/worker/` as ahead of deployed v26 and
   `supabase/migrations/` as ahead of production from `20260826150000`. F13's proof is run
   deliberately against the **deployed-era** schema for that reason; every other finding is
   against local source. **Diff before deploying.**
4. **`index.html` / `order.html` / `render-service/`.** Out of the stated scope
   (`supabase/functions/` and `supabase/migrations/`). Not audited.

---

## 7. Fixture corrections made during this audit, and why none is a weakening

Two assertions failed on the first run because **my predicted value was wrong**, not because
the finding was. Both are annotated inline in `prove.ts`.

1. **B6.** I expected `unsourced: ["Cedar Valley Trust"]`; the code returns `["Cedar Valley"]`,
   because `"Trust"` is in `PN_STOP` and is stripped as a trailing stopword. I corrected the
   expected value. **Not a weakening:** the assertion still requires the lower-case spelling to
   report a non-empty unsourced list and the ALL-CAPS spelling to report an empty one, which is
   the entire claim. Only my guess at the exact phrase changed.
2. **B8.** I expected the stripped run to be `0`; it is `1`, because
   `longestCommonRun("","")` returns 1 — `"".split(/\s+/)` is `[""]`, one empty token that
   matches itself. I corrected the expected value. **Not a weakening:** the claim is that 17
   measurable shared words fall to the floor, and 17 → 1 is that claim. Tightening it to 0
   would have required changing the code under test, which is not what a fixture is for.
3. **A10.** My first version asserted on `src.slice(1274, 1281)` — an off-by-four slice that
   tested lines the catch is not on, so it failed against text that was never there. Re-anchored
   on the exact 1-based source lines 1281-1283 and it now compares the literal catch body.
   **Not a weakening:** the corrected assertion is strictly more specific than the one it
   replaced — it demands three exact source lines where the original demanded a substring.

A fourth correction, in the SQL harness: my `orders` fixture omitted `grant_input`, which is
`NOT NULL`. Adding it is a fixture fix with no bearing on what S1 measures.

---

## 8. Files

```
audit/extract.sh        builds real.ts from exact worker line ranges; prints nothing on success
audit/real.ts           283 lines, all verified present verbatim in worker/index.ts
audit/prove.ts          35 assertions, 35 proven
audit/sql-prove.sh      throwaway PG16, all 15 migrations, proofs S1-S5
audit/sql-prove-prod.sh throwaway PG16, deployed-era migrations only, proof S6
audit/proofs.sql        S1-S5
audit/helper.sql        escalation_kind_ok() — evaluates the CHECK without leaving a row
audit/parser-audit.md   this file
```

No file under `/home/user/ktebli` was created or modified by this audit.
