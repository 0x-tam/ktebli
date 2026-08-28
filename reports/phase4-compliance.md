# Phase 4 — compliance audit (WS4a)

**Date:** 2026-08-28 · **Branch:** `claude/supabase-audit-verify-77v56v` (audited at `809d532`; fixes committed on top).
**Method:** code reading plus executed proofs — TypeScript predicates copied verbatim from source and run under Deno 2.9.5, and SQL proofs run against a throwaway Postgres built by replaying all 15 migrations (`tests/replay/run.sh --keep`). **No model call was made. No network call left this machine** except localhost (render-service) and package installs.

**TRANSCRIPTION CAVEAT — read before deploying anything from §6.** Per CLAUDE.md, the seven non-worker
edge functions were transcribed from API output and never byte-verified. Every fix this report makes to
`save-intake`, `analyze-grant`, `order-status`, `request-revision`, `stripe-webhook`,
`upload-intake-file` (http.ts) is a fix **to the transcribed copy**. Before deploying any of them:
`supabase functions download <slug>`, diff against the pre-fix repo copy, reconcile, then deploy and
diff again. Do not skip this; the v25 corruption incident is why the rule exists.

This report carries the audit sections. **The end-to-end order section is added by a later
workstream — append it after §7 without renumbering §1–§7.**

---

## 1. Donor-limit fixtures — 8/8

The required fixture set, executed (suite `tests/donor-limits/donor_limits_test.ts`, plus the
standalone check in `scratchpad/ws4a/eight_forms.ts`). Every form resolves to a correct limit or a
loud refusal; **none resolves to a silent null**:

| # | literal form | field | outcome |
|---|---|---|---|
| 1 | `"1,400 words"` | max_words | **limit 1400** |
| 2 | `"1400 words"` | max_words | **limit 1400** |
| 3 | `"1.400 palabras"` | max_words | **limit 1400** (Spanish thousands-dot, grouped only under limit language) |
| 4 | `"up to 1,400 words"` | max_words | **limit 1400** |
| 5 | `"max. 1400"` | max_words | **limit 1400** |
| 6 | `"two pages"` | max_pages | **refused** `word_form_number` — argued in `donor_limits.ts`: a numeral-word parser is a new unbounded surface whose bugs yield confident wrong numbers; refusing costs one held order |
| 6b | `"two pages"` | max_words | **refused** `unit_is_pages` — a page count is not convertible to words without a render |
| 7 | `"1,400-word limit"` | max_words | **limit 1400** |
| 8 | `"no more than 1,400 words"` | max_words | **limit 1400** (the minimum-guard wording excludes it from `no fewer than`) |

All eight forms were **already covered** in `tests/donor-limits/donor_limits_test.ts` with executed
assertions (not greps) — the suite runs 71 literal forms, asserts a closed provenance set for null
(the "no silent null" closure property), replays the historical `num()` and the current `numLike`
against the same corpus, and covers all 15 declared refusal reasons. No change to
`worker/donor_limits.ts` was needed: `parseDonorLimit` handles all eight correctly. Suite result:
**ALL DONOR-LIMIT TESTS PASSED (71 literal forms)**.

The open problem is not the parser — it is that **nothing calls it** (finding WS4a-14).

---

## 2. Parser re-audit

The prior audit's 23-site enumeration is gone; this is a fresh sweep of the class over the whole
pipeline: all 7 non-worker functions (+ their `http.ts`/`ssrf.ts` copies), all 11 `worker/*.ts`
modules, `db/schema.sql`, and all 15 migrations. The class: **(a)** null/empty/permissive default on
malformed input, **(b)** matchers satisfiable by a fragment, **(c)** checks that report success while
doing nothing.

Every finding below is **proven by execution**: predicates copied verbatim from source into
`scratchpad/ws4a/predicate_proofs.ts` (20 assertions, 20 held) and `postfix_proofs.ts` (13
assertions, 13 held), plus SQL proofs in `scratchpad/ws4a/sql_proofs.sql` (self-contained, re-run end to end after a send-back correction: 9 PROOF-OK — P1, P2, P3a–c, P4, P5, P6a, P6b —
0 unexpected). The scratch files are session-local; the load-bearing predicate and result for each
finding is recorded in the tables here so the finding survives the scratchpad.

### 2.1 Proven findings

Severity: **P0** defeats a compliance/grounding gate or loses money/alerting silently; **P1**
silently degrades a paid deliverable or an abuse control; **P2** quality/observability.

| id | site | class | defeating input | what trusts it | sev | proof | state |
|---|---|---|---|---|---|---|---|
| WS4a-1 | `worker/index.ts:387` (`normalizeFmt`) | a | `"required_sections": "Q1; Q2; Q3"` — a string, not an array — silently becomes `[]` | the entire donor-structure gate (`missing_required_section` can never fire) **and** the QA record, which then reads `donor_requirements: "n/a"` (index.ts:1982) | **P0** | A1 | **OPEN** — old F1, unfixed. Spec §6 |
| WS4a-2 | `worker/index.ts:1745,1753` (validate) | a | `"claims": {…}` (object) → `claimLedger=[]` → zero grounding problems | the Claim Ledger — the project's stated grounding gate passes vacuously | **P0** | A2a | **OPEN** — old F3. Spec §6 |
| WS4a-3 | `worker/index.ts:1753` | b | `"classification": "Unsupported"` (capital U) not in the lowercase enum | same gate — a material unsupported claim does not block | **P0** | A2b | **OPEN** — old F3. Spec §6 |
| WS4a-4 | `worker/index.ts:1769` (validate) + `:1850` (revise, same shape) | a | non-array `coverage` → `missingMandatory=[]`; an empty array also passes with no cross-check against `reqRows` | requirement-coverage gate passes vacuously | **P0** | A2c | **OPEN**. Spec §6 |
| WS4a-5 | `worker/index.ts:1277–1284` (analyze) | c | any fetch failure on a grant URL → the **URL string itself** becomes the grant text (`text.slice(0, 80_000)` of a 44-char URL); no guard before the extraction call | every donor requirement, limit, page cap and section extracts as null; the proposal is written against a document never read, and §1's `absence_contradicted` cross-check has no guidelines text to fire on | **P0** | A3 | **OPEN** — old F5, unchanged. Spec §6 |
| WS4a-6 | `worker/index.ts:1027–1040` (`visualQA`) | a | parseable reply with `issues` missing/non-array → status **"passed"**, not a parse failure; a blocking report under a near-miss type name (`"text_overflow"`) is silently dropped → passed | the layout gate at package (a *failed* verdict throws; a defeated parse reads as clean) | **P1** | A4a–c | **OPEN**. Spec §6 |
| WS4a-7 | `http.ts` (all 5 copies), `rateLimit` | c | any `rl_hit` failure (500, network, RPC absent) → `return true` — allowed | every per-IP/per-email limit in save-intake, analyze-grant (paid model call per request), upload-intake-file, order-status, request-revision | **P1** | A5a/b | **FIXED** (this WS) — fails closed + logs; post-fix proofs |
| WS4a-8 | `http.ts` (all 5 copies), `clientIp` | b | `x-forwarded-for: <invented>, …` — the FIRST entry is client-supplied (proxies append); per-IP limit keyed on an attacker-chosen string per request | same limits — unbounded buckets defeat them | **P1** | A5c | **FIXED** (this WS) — keys on the LAST (edge-appended) entry |
| WS4a-9 | `request-revision/index.ts` (pre-fix: unchecked `revision_requests` insert after `claim_revision`) | c | a failed insert (RLS, constraint, 5xx) → slot already burned; worker `index.ts:1836` falls back to `"General improvement pass."` | the customer's paid revision: consumed, and their instructions silently ignored | **P1** | code path shown §2.1-note; worker fallback string at index.ts:1834–1837 | **FIXED** (this WS) — request stored + verified BEFORE claiming, with explicit token→proposal ownership check (the naive reorder would let any valid token write instructions onto another order's proposal) |
| WS4a-10 | `analyze-grant/index.ts` (pre-fix `...parsed` spread) | a | page-induced model output `{"ok":false}` / `{"source":…}` overrides the response envelope | the intake wizard UI | **P2** | A6 | **FIXED** (this WS) — declared fields only, typed |
| WS4a-11 | `stripe-webhook/index.ts` price gate (pre-fix) | a | `amount_total: 14900, currency: "aed"` (~USD 40) satisfies the USD 149 draft check — currency never read | the only server-side price authority; work is queued on it | **P1** | A7 | **FIXED** (this WS) — `currency === "usd"` required; non-USD parks exactly like a mismatch. Reachable only if a payment link/adaptive pricing ever presents non-USD; fixed because the gate's *claim* is currency-blind |
| WS4a-12 | `stripe-webhook/index.ts` (pre-fix) | a | a checkout session with no customer email → order accepted, undeliverable, nobody signalled | delivery + all notification | **P1** | code read; parked path now shared with price gate | **FIXED** (this WS) — parks as `attention` + escalation |
| WS4a-13 | `order-status/index.ts` (pre-fix `signUrl` null → file dropped) | c | a storage-sign failure → the delivered file silently absent from the customer's order page, response still `ok:true` | the customer's only download path | **P1** | code read (pre-fix `if (signed)` with no else) | **FIXED** (this WS) — `files_unavailable` count disclosed (additive field) + logged |
| WS4a-14 | `worker/index.ts:37–41` imports | c | — | **6 of 10 worker modules are wired to nothing**: `donor_limits.ts`, `delivery_gate.ts`, `numeric_register.ts`, `sufficiency.ts`, `referent_weight.ts`, `crawl_outcome.ts` all exist, all pass their suites, and none is imported by `index.ts`. The pipeline still runs the weaker inline logic each was written to replace (`numLike` instead of `parseDonorLimit`; no pre-delivery gate stage; `consistencyFindings` instead of the register; the silent crawl paths `crawl_outcome.ts`'s own header enumerates) | **P0** | `grep 'from "./'` — 4 imports: proper_nouns, contact_claims, word_limit, ssrf | **OPEN** — wiring is index.ts + stage-list work, owned elsewhere. Spec §6 |
| WS4a-15 | `worker/index.ts:361–366` (`numLike`) | a→wrong-number | `"1,400 characters"` → **1400 words** (≈6× permissive); `"1400 words or 4 pages"` → 1400 and the delivery-blocking page half dropped; `"$1,400"` → 1400; `"A4"` → 4 pages; `"at least 1,400 words"` → ceiling 1400; `"1,200-1,400"` → 1200 | the word/page gates run **with a confidently wrong limit** — worse than the null it replaced, because a wrong limit looks exactly like a right one downstream | **P0** | executed in `tests/donor-limits` §3b (10 forms, baselines asserted against the real `CURRENT_NUM`) | **OPEN** — the fix exists (`resolveDonorLimits`), unwired. Spec §6 |
| WS4a-16 | `worker/index.ts:632–639` heading gate | a | any required section that normalises to empty is skipped (`if (!needle) continue`) — and `normHead` strips `[^a-z0-9 ]`, so **every non-Latin-script donor heading normalises to empty**. An Arabic donor's entire required structure is unchecked; zero findings | `missing_required_section` for non-Latin donors (Ktebli's plausible market) | **P1** | A10 | **OPEN**. Spec §6 |
| WS4a-17 | `worker/index.ts:1400` identity-gate entry | c | wrong-org crawl yielding profile fields but **zero evidence rows and no `legal_name`** → gate skipped; wrong org's `profile` + `voice_guide` survive into prompts | the website identity gate (its *entry*, not its verdict — the verdict itself is fixed, see F4 in §3) | **P1** | A9c | **OPEN**. Spec §6 |
| WS4a-18 | `worker/index.ts:1524` (strategy) | a | `"ranking": "1,2"` (string) → silently identity order `[0,1]` — the model's stated preference discarded without record | strategy candidate selection (quality, not compliance) | **P2** | A11 | OPEN, recorded |
| WS4a-19 | `worker/index.ts:2036–2042` (deliver) | c | Resend failure → `ok=false`, `completion_email_sent` stays false, stage returns `delivered: true`; deliver never re-runs, no escalation | the customer learning their paid order is done | **P1** | code read (the only consumer of `ok` is the patch guard) | **OPEN**. Spec §6 |
| WS4a-20 | `worker/index.ts:1983` QA record | c | `word_count: wordCount(md)` records the whole document while the gate at `:652` counts `limitedText(...)` — the two numbers whose divergence caused the 19-of-20 over-count are still not both recorded | drift observability (silent-gates §6.5, unfixed) | **P2** | code read; divergence mechanism proven in silent-gates.md step 3 | **OPEN**. Spec §6 |
| WS4a-21 | `supabase/migrations/20260826180000:177–183` | c (SQL) | the migration drops and re-creates `escalations_kind_check` **without** `gate_hold`/`gate_refund`/`gate_refund_failed`, which `20260826170000` added and whose `gate_refund_order()` inserts two of. On migration head, `gate_refund_order(...)` **raises `check_violation` unconditionally** — a confirmed Stripe refund cannot be recorded (the whole function aborts, rolling back the order-status update), and the `gate_refund_failed` "customer is out of pocket" alert can never be written | invariant 2's record of every refund, and the single alert for a failed refund | **P0** | SQL proofs P3a/P3b/P3c/P4 (executed against the replayed head; P4 calls the real function on a real order graph) | **OPEN** — migrations are not this WS's path. Spec §6. Not yet live anywhere: nothing calls `gate_refund_order` (delivery_gate unwired, WS4a-14) and none of these migrations are deployed — but wiring the gate without this fix bricks its refund path |

Adjacent note on WS4a-9: the pre-fix code also patched `orders.status` and inserted stages with
unchecked responses; the stage insert *was* checked. The fix leaves stage/PATCH semantics unchanged.

### 2.2 Sites checked and clean (16)

Executed or read to a conclusion, no defect of the class found:

1. `worker/index.ts:178` `jsonOf` — throws loudly on malformed model output (the loud half of every A2-class site; the defect is always in the *caller's* shape handling).
2. `worker/delivery_gate.ts` `parseJudgement`/`parseAssertedVerdict` — genuinely strict: non-integer scores, missing disqualifiers, missing `weakest_thing`, non-array `fix_instructions`, unknown verdicts all **refuse** and refusals become holds. Executed by `tests/delivery-gate` (green).
3. `worker/numeric_register.ts` — every malformed shape throws `RegisterError`; the closure check is compulsory (`derived_no_asserted`); executed by `tests/numeric-register` + `tests/adversarial/register_does_not_close` (green).
4. `worker/word_limit.ts` — see F2 in §3; executed by `tests/word-limit` (green). One deliberate residual recorded: a table-only section under an attachment heading is excluded *however long it runs* (asserted as desired at `word_limit_test.ts:198`); prose disguised as a ≥2-column table under `## Annex` could hide words. A 1-column fake trips `degenerate_table`. Left as designed — real budget tables may be long — recorded rather than silently accepted.
5. `worker/proper_nouns.ts` — one-way containment, closed provenance; suites green. Call-site note: index.ts:1725 does not pass `designNames` (the module supports it) and keeps UNSOURCED advisory — the reasoning is written at index.ts:1777–1780 and delivery_gate's header; recorded, not a silent pass.
6. `worker/contact_claims.ts` — blocking at the validate call site; suite green.
7. `worker/ssrf.ts` (+ analyze-grant copy, identical modulo comments) — fail-closed on scheme, host, IP literal, DNS, redirect hops, content type, size. The one class-adjacent item — callers discarding `status` — is the documented raison d'être of `crawl_outcome.ts` (unwired: WS4a-14).
8. `stripe-webhook` signature verification — constant-time compare; a NaN timestamp defeats the tolerance guard (`NaN > 300` is false) but the HMAC covers `t.payload`, so it is not a bypass (proof A8). Multiple `v1` entries: `Object.fromEntries` keeps the last; fail-strict at worst.
9. `stripe-webhook` `stripe_event_seen` fail-open — disclosed in a comment and backstopped by the `orders.stripe_session_id` unique constraint + explicit select; a genuine second gate, unlike the F13 pattern.
10. `rl_hit()` (SQL) — atomic upsert, no permissive branch.
11. `claim_revision()` (SQL) — row-locked, cap enforced atomically, every failure returns a reason.
12. `stripe_event_seen()` (SQL) — unique-violation → true; no silent path.
13. `release_stranded_claim()` (SQL, 20260826150000) — both branches require ownership or aged orphanhood; age guard closes the claim/patch race; events row written in-transaction.
14. `order-status` token/session validation — anchored regexes, safe charset into the query string, encode on the session path.
15. `upload-intake-file` — magic-byte + extension allowlist, zip-bomb cap, size floor/ceiling; `docxText` failure is disclosed via `analysed:false`. Residual (recorded, not fixed): the final `intake_files` metadata insert response is unchecked — a failure loses the E-PROP evidence silently while reporting `ok:true`; low, since `analysed` still reflects extraction, but the row is what the voice stage reads. Left for a follow-up rather than risk the transcribed copy twice in one pass; spec in §6.
16. `tests/exclusivity/run.sh` exit-code path — verified it genuinely exits non-zero on failure and 0 on pass; on this branch it now **passes** ("UNBOUNDED: all 40 applicants served on one grant") because `20260826160000_unbounded_composer.sql` removed the ceiling. CLAUDE.md's "deliberately failing" note is stale in the good direction. (One earlier flaky run showed 1/39 refused from its throwaway Postgres failing to start; a clean run passes; run twice.)

### 2.3 Count

**21 proven findings** (7 fixed in this workstream, 14 open with specs) · **16 sites checked clean** ·
**0 unproven claims in §2.1** — every row cites an executed proof or the exact source lines of a
single-branch code path.

---

## 3. The six surviving F-items from reports/silent-gates.md §5

| F | original claim | current state | proof |
|---|---|---|---|
| **F1** | `index.ts:386` required_sections as string → whole donor-structure gate off, no `limitUnparsed` equivalent | **STILL OPEN**, now at `index.ts:387`, byte-for-byte the same guard | A1 (executed): five sections as one string → `[]`, and QA reads `donor_requirements:"n/a"` |
| **F2** | `word_limit.ts:170-186` — `## Annex` over ≤25-word paragraphs hid 767 words as 3 | **FIXED** — prose is cumulative over the section, plus an independent 250-word cap; the Enter-press defeat is a regression test | `tests/word-limit` green, incl. "prose relabelled as an annex is still counted (N/N)" and the table-only carve-out asserted deliberately |
| **F3** | `index.ts:1740,1774` — `"claims": {…}` or `"Unsupported"` defeats the Claim Ledger | **STILL OPEN**, now at `:1745/:1753` (validate) and `:1850` (revise) — same non-array default, same case-sensitive enum | A2a/A2b/A2c (executed) |
| **F4** | `index.ts:1395` — wrong-org site with no `legal_name` defeats the identity gate's entry | **FIXED at the verdict** — `orgNameMatchesSite` now refuses when nothing distinctive matches, including the no-legal-name/wrong-domain B1 case. **Residual at the entry** (`:1400`): zero evidence rows + profile without `legal_name` skips the gate and keeps the wrong org's profile/voice_guide | A9a/A9b (fixed), A9c (residual), all executed against the verbatim current function |
| **F5** | `index.ts:1281-1283` — grant-URL fetch failure → everything null, applicant paid for compliance against a document never read | **STILL OPEN**, now at `:1277–1284` — the catch substitutes the URL string as the grant text and proceeds | A3 (executed) |
| **F13** | stripe-webhook escalation insert proven to write zero rows | **THREE-STATE.** (1) **Production: still broken** — the original constraint has no `price_mismatch` and `due_at` has no default; the webhook shape fails on either alone, swallowed by `.catch(() => {})` (proofs P6a, P6b). (2) **Migration head: fixed** for the webhook + worker shapes — `price_mismatch`/`stage_failed`/`stage_held` write rows (proofs P1, P2). (3) **New regression at head:** `20260826180000` re-created the constraint without the delivery-gate kinds → WS4a-21 (proofs P3a–c, P4: `gate_refund_order()` on a real order graph raises `check_violation`) |

---

## 4. Render service — verified with a real render

`render-service/` (Dockerfile + `server.mjs`) built and run locally. **No bugs found preventing a
render; no changes to render-service/ were needed.**

**Contract** (from `server.mjs`, confirmed by execution):

- `POST /render` — headers `Authorization: Bearer <RENDER_SECRET>`, body **raw .docx bytes**
  (ZIP magic enforced; not multipart, not JSON). ≤12 MB, ≤120 pages, ≤2 concurrent.
- `200 {ok:true, pages:<int>, images:[<base64 PNG, 70dpi, first ≤15 pages>], images_truncated:<bool>}`
- errors: `401 unauthorized`, `422 invalid_docx | conversion_failed | pdf_info_failed | raster_failed | too_many_pages`, `413 too_large`, `429 busy`, `504 timeout`, `500 internal`
- `GET /healthz` → `ok`. Logs are content-free (`{"m","s","ms"}` only — confirmed in `docker logs`).

**Verification run** (sample built from `tests/ladder/documents/out-n12-B.md`, 1,622 words, converted
to a minimal A4/11pt .docx by `scratchpad/ws4a/make_docx.py` — stdlib zip + WordprocessingML, since
the box has no pandoc/pip):

| probe | result |
|---|---|
| `GET /healthz` | `ok` |
| POST without auth | `401 {"ok":false,"code":"unauthorized"}` |
| POST non-docx bytes | `422 {"ok":false,"code":"invalid_docx"}` |
| POST the real sample | `200 {"ok":true, "pages":4, "images":4, "images_truncated":false}` — **measured page count: 4**; ~2.1 s; page-1 PNG decoded and visually confirmed as the rendered n12-B document |

Caveat on the number: 4 pages verifies the **service** (docx→pdf→count→raster round trip), not the
pipeline's own typography — the sample was built by the test script above, not by `renderDoc()`.

**Running now:** container `ktebli-render`, image `ktebli-render-service`, **port 8790**,
secret `ws4a-local-test-secret`. To start it again:

```
docker build -t ktebli-render-service render-service/
docker run -d --name ktebli-render -p 8790:8080 -e RENDER_SECRET=<secret> ktebli-render-service
curl -s localhost:8790/healthz
```

**Production deployment remains on the operator list** (CLAUDE.md "Standing user-side items"):
deploy the container somewhere real, set Vault secrets `render_service_url` and
`render_service_secret`. Until then `renderService()` returns `not_configured` and any donor **page**
limit correctly blocks delivery at package (index.ts:2012–2018 — that refusal was re-read this pass
and is loud).

---

## 5. Fixes made by this workstream (owned paths)

Commit `fb7f30d`, all six functions `deno check` clean, all suites green after:

1. **`*/http.ts` (5 copies, now byte-identical):** `rateLimit` fails **closed** on any `rl_hit`
   failure and logs the reason (was: silent allow — WS4a-7). Consequence accepted deliberately: if
   `rl_hit` breaks, pre-payment endpoints refuse with 429 until it is fixed — visible, retryable,
   and the same asymmetry `donor_limits.ts` argues. `clientIp` keys on the **last** XFF entry
   (was: first, client-forgeable — WS4a-8).
2. **`save-intake`:** a supplied-but-malformed `deadline` refuses `400 bad_deadline` (was: silent
   null — the customer's stated deadline discarded with no signal).
3. **`analyze-grant`:** response built from declared, typed fields only (was: `...parsed` spread let
   page-induced model output override `ok`/`source` — WS4a-10).
4. **`request-revision`:** explicit token→proposal ownership check, then the revision request is
   stored and **verified**, then the slot is claimed (was: unchecked insert after the claim —
   WS4a-9).
5. **`order-status`:** failed storage-signs surface as `files_unavailable` (additive response field)
   and are logged (was: file silently missing — WS4a-13).
6. **`stripe-webhook`:** price gate requires `currency === "usd"`; missing customer email parks the
   order as `attention` with the same no-work/no-worker path as a price mismatch; escalation
   `detail` is structured jsonb (WS4a-11, WS4a-12). The escalation insert still writes zero rows on
   the **production** schema (F13 state 1) — the comment in the code says so; deploy the migrations
   with it.

## 6. Fix specs for owners of read-only / out-of-scope paths

**`worker/index.ts`** (owning workstream):

- **WS4a-14/-15 (subsumes F1):** replace `normalizeFmt`'s `numLike`/`num` with
  `resolveDonorLimits(r, guidelinesText)` from `./donor_limits.ts` (drop-in: returns
  `{maxWords, maxPages, limitUnparsed, limitOutcomes}`; store `limitOutcomes` in the analyze output
  for invariant 9). For `required_sections`: when the field is present and **not** an array, push
  `"required_sections=<json>"` onto `limitUnparsed` instead of defaulting to `[]` — same refusal
  channel, already enforced at package. Move the `limitUnparsed` refusal from package
  (`index.ts:1972`) up to `gen:narrative` so it stops before the generation spend (silent-gates
  §6.4).
- **WS4a-2/-3/-4 (F3):** in validate and revise, `if (!Array.isArray(ledgerOut.claims)) throw new
  Error("claim ledger unparsed")` (same for `revOut.coverage` when `reqRows.length > 0`);
  lowercase `classification` before the enum test and treat any value outside the documented enum
  as `"unsupported"` (refuse-toward-blocking, matching the module's own asymmetry).
- **WS4a-5 (F5):** in analyze, when `grant_input` is a URL and `safeFetchText` throws, **fail the
  stage** (`throw new Error("grant page unreachable: " + reason)`) instead of substituting the URL
  string. A retry tick is the correct cost; a proposal against nothing is not.
- **WS4a-6:** in `visualQA`, `if (!Array.isArray(parsed.issues)) throw` inside the try (routing to
  the existing retry → `unavailable`); count an unknown `type` with `severity:"blocking"` as a
  finding (`unreadable_content`) rather than dropping it.
- **WS4a-16:** in the heading gate, when `normHead(s)` is empty but `s.trim()` is not, fall back to
  a Unicode-aware normalisation (`s.toLowerCase().normalize("NFKC").replace(/[\p{P}\p{S}]+/gu," ")…`)
  for both needle and headings instead of `continue`; only a needle empty under *that* rule may be
  skipped, and then push a recorded `limitUnparsed`-style note.
- **WS4a-17:** entry condition at `:1400` →
  `if (domain && (webEvidence.length || Object.keys(profile).length || Object.keys(voiceGuide).length))`.
- **WS4a-19:** in deliver, when `sendEmail` returns false, `ins("escalations", {kind:
  "delivery_failed", …})` and do **not** mark the stage done on the email path alone (or record
  `email_failed: true` in the stage output so ops can re-trigger).
- **WS4a-20:** QA record: store both `word_count_whole: wordCount(md)` and
  `word_count_counted: wordCount(limitedText(...).text)` (silent-gates §6.5 / word-limit.md Patch 5).
- **WS4a-18 (P2):** treat a non-array `ranking` as a refusal to rank (record it), or at minimum log.

**Migrations owner — WS4a-21 (P0 before the delivery gate is wired):** new migration:

```sql
alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','gate_hold','gate_refund',
                  'gate_refund_failed','payment_ungated','sufficiency_refund_failed','other'));
```

(the union of 20260826170000 and 20260826180000 — each of those drops/re-creates the same
constraint, so **last writer wins**; any future kind addition must re-state the full union). Run
`tests/replay/run.sh` after; `expected-fingerprint.txt` will legitimately change — regenerate it
from the replay per that file's own rule, never hand-edit.

**`upload-intake-file` follow-up (this WS's path, deliberately deferred):** check the `intake_files`
insert response; on failure return `{ok:false, reason:"store_failed"}` so the wizard retries and the
E-PROP evidence is not silently lost.

---

## 7. Test status

`sudo env PGBIN=/usr/lib/postgresql/17/bin bash tests/run-all.sh` (this box has PG 17/18, not the
script's default 16): **ALL SUITES PASSED** — migration replay + schema parity (and it correctly
reports the schema categories still undeployed to production), exclusivity (now genuinely green:
40/40 applicants served on one grant, stranded-claim test passing), ladder blinding byte-match,
proper-nouns, numeric-register, delivery-gate, sufficiency, contact-claims, crawl-outcome,
word-limit, referent-weight, **donor-limits (71 literal forms incl. the required 8)**, and all four
adversarial suites. No previously-green suite regressed; the seven edge functions additionally
type-check under `deno check`.

Proof artefacts (session scratchpad, results mirrored above):
`scratchpad/ws4a/predicate_proofs.ts` (20/20), `postfix_proofs.ts` (13/13), `eight_forms.ts` (8/8 +
no-silent-null), `sql_proofs.sql` + captured run output `sql_proofs.out` (9 PROOF-OK in one transaction against the replayed head and the
reproduced production shape), `make_docx.py` + `sample-n12-B.docx` + `render-page1.png`.

<!-- END OF AUDIT SECTIONS — the end-to-end order section is appended below by a later workstream. -->
