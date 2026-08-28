# Phase 5 — the six-site live crawl (WS5)

Status: **complete.** The run was first attempted before WS3's merge and was
refused by live-run.sh's own guard (worker/index.ts did not yet delegate to
crawl_outcome.ts — refusal preserved verbatim in §6); after the merge the wiring
check passed and the crawl ran three times: once to observe, once to verify the
first fix round, once to produce the committed ledgers. All three egress guards
held on every run (production blackholed, `--deny-net`, live probe refused).

One large truthfulness defect was found **by** the live run and fixed
(§3, finding 9), on top of eight found by the offline audit that preceded it
(§3, findings 1–8). Every fix is in WS5-owned files and pinned by a
canned-response regression test. Contract version 1.0.0 → 1.2.0.

## 1. The six sites

Real small nonprofits, buyer-shaped; names are the organisations' real working
names, never derived from the domain (deriving them would make the identity gate
pass by construction). File: `stack/sites-phase5.txt`.

| # | URL | Organisation | Criterion covered |
|---|-----|--------------|-------------------|
| 1 | thefelixproject.org | The Felix Project | The documented prior silent-failure case (CLAUDE.md P1.6); blocks-crawlers candidate |
| 2 | www.sufra-nwlondon.org.uk | Sufra NW London | Ordinary WordPress-class charity site, rich local nouns |
| 3 | www.themagpieproject.org | The Magpie Project | Thin ordinary-CMS site, very small org |
| 4 | www.glassdoor.org.uk | Glass Door Homeless Charity | Ordinary CMS; identity-gate exercise (working name ≠ registered shape; domain collides with a famous commercial brand) |
| 5 | www.nourishcommunityfoodbank.org.uk | Nourish Community Foodbank | Squarespace/Wix-class small site |
| 6 | watsi.org | Watsi | JS-rendered candidate (historically client-side React) |

Offline sanity before the run: all six org/domain pairings clear
`identityVerdict()` with and without a stated site name, so any live
`identity_mismatch` would have been a genuine finding, not a mispairing.

## 2. Outcomes (final run, contract 1.2.0)

| Site | Outcome | Fetched | Parsed | Referents surviving | Failure point / cause |
|------|---------|---------|--------|---------------------|----------------------|
| thefelixproject.org | **FETCH_FAILED** | 1 | 0 | 0 | Homepage 301s **offsite** to `https://felix.org/`. The traversal refuses to read a cross-domain redirect as the applicant's site (identity asymmetry); the offsite target is named in the reason. See §5. |
| sufra-nwlondon.org.uk | **OK(178)** | 10 | 8 | 178 | — |
| themagpieproject.org | **OK(53)** | 8 | 8 | 53 | — (4 of 8 parsed pages read as prose; the rest are short) |
| glassdoor.org.uk | **OK(152)** | 9 | 8 | 152 | — |
| nourishcommunityfoodbank.org.uk | **OK(117)** | 9 | 9 | 117 | — |
| watsi.org | **OK(130)** | 10 | 10 | 130 | — (not JS_ONLY: the site now server-renders; see §5) |

Identity gate: `cleared` on all five OK sites, `not_run` on Felix (nothing was
site-derived, so there was nothing to gate). robots.txt allowed the crawl on all
six. No outcome is silent: the one failure carries its exact cause and the
offsite target.

Sample surviving referents (full lists in the ledgers):

- **Sufra NW London** — St. Raphael's Estate, London Borough of Brent, SALIENT
  Consortium, University of Hertfordshire, British Empire Medal, Community
  Kitchens, Fresh Meal Service
- **The Magpie Project** — Grassroots Resouce Centre (the site's own spelling),
  Newham, Magpie Mums, National Insurance, Money Advice Service
- **Glass Door** — Duke of York Square, Chelsea, Team Glass Door, TCS London
  Marathon, Sleep Out, Ace of Clubs, Women's Night Shelter, named guests (Samir,
  Bruna, Jaromir, Rodrigo)
- **Nourish** — Tunbridge Wells, Tonbridge, Tunbridge Wells Borough Council,
  Business Supporters' Club, Country Housing Group, Dawn Stanford
- **Watsi** — AIC Kijabe Hospital (Kenya), Nkhoma Hospital, Dedza District
  (Malawi), African Mission Healthcare, named patients

## 3. Silent failures found, fixes, regression tests

The reference defect (thefelixproject.org, P1.6) was a **discarded status**.
Findings 1–8 came from the offline audit of the remaining layers before the run;
finding 9 came from the live run itself. All fixes are in
`supabase/functions/worker/crawl_outcome.ts` / `ssrf.ts`; all regressions are in
`tests/crawl-outcome/crawl_outcome_test.ts` (§§13–14, from canned responses).

1. **Content-type gate swallowed refusal statuses** (ssrf.ts). A 403/429 served
   with a missing or non-text content-type threw plain `bad_content_type` and
   classified `fetch_failed` ("did not answer" — false). The reason now carries
   the status (`bad_content_type_http_403`), the traversal recovers it, and the
   crawl classifies `blocked_bot`. A 5xx variant stays `fetch_failed` and names
   the status. Tests §13a.
2. **Charset ignored** — UTF-8-only decoding turned windows-1252 sites into
   replacement-character junk → false `extraction_failed`. `decodeBody()`
   honours the content-type charset, sniffs `<meta charset>`, falls back to
   UTF-8. Tests §13d.
3. **Numeric entities survived stripping as residue** ("St Aidan&#8217;s"),
   polluting referents and dragging the prose signal down. Entities now decode.
   Tests §13d.
4. **Challenge markers satisfiable by prose fragments** — bare "forbidden",
   "rate limit", "you have been blocked", "just a moment" (zero dots required)
   could reclassify a thin served 2xx page as `blocked_bot`. Markers split
   STRONG (branded challenge signatures, CAPTCHA walls — may flag a 200/503/202
   with almost no prose) / WEAK (ordinary English — may only *name* a refusal
   whose status already proves it). Accepted trade: a 503 whose body says "rate
   limit" now reports `fetch_failed` HTTP 503 — less specific, never false.
   Tests §13b.
5. **A mount-point div with no script is not a JS shell** — a static page using
   `id="app"` as markup was called `js_only` ("draws its text with JavaScript",
   false). Mount-point markers now require the page to load any script. §13c.
6. **A malformed empty `User-agent:` line fabricated a robots block** (the empty
   string matched every crawler's UA); and group selection was file-order, not
   most-specific-token. Both fixed. Tests §13f.
7. **Parsed-page boundary off by one** vs the traversal's own `> 120` threshold.
   Aligned. Tests §13e.
8. **`nothing_relevant` hid refused subpages** — a rate limiter that serves the
   homepage and 429s the rest read as "thin site". The reason now counts the
   refusals. Tests §13g.
9. **Site furniture counted as referents** — found by the live run. On every OK
   site, roughly two-thirds of "referents" were navigation glued into giant
   capitalised runs ("Sufra NW London Volunteer Donate Get Help Menu Home About
   About", a 30-language selector, card-grid labels), because `stripHtml`
   flattened all markup into one space-joined line and the proper-noun counter
   (correctly, for narrative text) reads consecutive capitalised words as one
   name. A `succeeded(308)` whose 308 are mostly menu labels misdescribes the
   crawl, and these counts feed the sufficiency gate and the phase-6 benchmark.
   Fixed in four layers, all WS5-owned; furniture never *was* the applicant's
   prose, so removing it cannot lose evidence:
   - `stripHtml` removes furniture elements (`nav`, `aside`, `menu`, `select`,
     `button`, `iframe`, `svg`, `noscript`, comments) and emits a real line
     break per block element (via a sentinel, so pretty-printed source newlines
     still collapse). `<header>`/`<footer>`/`<form>` are deliberately kept —
     footers carry charity numbers and addresses;
   - `keepParagraphs` splits per line and drops *furniture*: a paragraph with no
     sentence punctuation anywhere and a capitalised-word majority. An
     unpunctuated lowercase mission line is untouched;
   - `siteReferents` refuses any "name" longer than six words, trims connective
     glue dangling at phrase edges ("Board of Trustees" → stop-word trim →
     "of Trustees" → "Trustees"), and drops a single-word referent whose
     lowercase form also occurs in the corpus ("However", "Please") — a true
     proper noun is capitalised wherever it appears; corpus-driven, no
     dictionary, errs toward counting fewer.
   Effect on the live sites: Sufra 308→178, Magpie 157→53, Glass Door 348→152,
   Nourish 276→117, Watsi 299→130 — and the survivors are the real names in §2.
   Tests §14 (three layer tests + end-to-end: the furnished fixture page yields
   exactly its six real referents and no menu label).

## 4. Residual noise, stated plainly

A small residue of single-word sentence-openers survives on thin corpora
("However", "Fortunately", "Please") — they survive only when the word never
occurs lowercase in the ~10 crawled pages, so the corpus-driven filter cannot
prove them grammar. Phrase-level referents are unaffected. Chasing these with a
hardcoded adverb list would be a dictionary arms race inside the wrong module
(the counter belongs to proper_nouns.ts, which is outside WS5 ownership); the
proposal-time audit resolves them by ledger containment anyway. Counts in §2
should be read as "at most this many names", accurate to within a handful.

## 5. What the run proved about the taxonomy, and what it could not

- **No BLOCKED and no JS_ONLY occurred in the wild.** The blocks-crawlers
  candidate (thefelixproject.org — the 2026 launch-readiness failure) no longer
  blocks: the domain now 301s to `felix.org`. The JS candidate (watsi.org) now
  server-renders its content. Both paths are exercised by fixture regressions
  (§13 and the original §1–§3 suites), but this run provides no in-the-wild
  confirmation of either. That is a coverage gap of the sample, stated rather
  than papered over.
- **The offsite refusal is the identity gate doing its job.** thefelixproject.org
  redirecting to felix.org was refused even though it is almost certainly the
  same charity after a rebrand — a cross-domain redirect *from* the supplied
  domain is exactly the parked-domain shape the rule exists for, and the reason
  names the target so a human can act. A follow-up probe
  (`stack/sites-phase5-followup.txt`, ledger `felix.org.json`) crawled the
  redirect target as its own site: **OK(271)** — trustee bios, Waitrose,
  national locations — with the gate cleared on the stated name "Felix" and the
  domain token. If a real order supplied the old domain, the customer-facing gap
  line would say the site did not answer and nothing was used; the operator
  detail carries the redirect target.
- **Fetch/parse honesty held everywhere**: every page attempt on every site is
  recorded with a status or an error; robots.txt was read and honoured on all
  seven crawls; no observation was swallowed.

## 6. The pre-merge refusal (history)

Before WS3's merge, the run refused at live-run.sh's pipeline-delegation check:

```
FATAL: worker/index.ts does not import crawl_outcome.ts.
  The crawler patch has not been applied yet, so a run now would measure a module
  the pipeline does not call. Apply the patch spec first (qloop/inv/patch-crawl.md).
```

The check was correct and was not weakened. (Note: the referenced
`qloop/inv/patch-crawl.md` never existed in the repo; the wiring arrived with
the WS3 merge instead.) index.ts was read-only for WS5 throughout.

## 7. What the crawler still cannot do (by design)

- **No JavaScript engine.** A client-rendered site is `js_only`, never worked
  around — eight edge functions, no browser. `stack/ground-truth.sh` exists to
  separate "crawler got nothing" from "there was nothing to get"; it was NOT run
  in this phase because WS5's network permission covers only the crawler's own
  fetches via live-run.sh, and a Chromium render is a different fetch path.
  With five OK sites and no js_only verdict, nothing in this run *required*
  ground truth to interpret.
- **No PDFs.** The traversal skips `.pdf`; the owner's deep-crawl decision is
  future work.
- **robots.txt is honoured, not negotiated.**
- **The harness identity gate uses ONE stated-name candidate** (og:site_name
  first), never "whichever clears".
- **MAX_PAGES=10 / MAX_FETCHES=14 / 60k chars** — a large site is sampled, not
  exhausted; budget exhaustion is recorded when it happens (it did not here).

## 8. Ledgers for phase 6

`stack/out/phase5-ledgers/<slug>.json`, committed — public website facts only.
Each carries the site, the organisation, the stated site name, the full
CrawlReport (outcome, counts, per-URL statuses, robots verdict, elapsed), the
surviving referents, and per-page URL + kept-char counts:

- `sufra-nwlondon.org.uk.json` — OK(178)
- `themagpieproject.org.json` — OK(53)
- `glassdoor.org.uk.json` — OK(152)
- `nourishcommunityfoodbank.org.uk.json` — OK(117)
- `watsi.org.json` — OK(130)
- `thefelixproject.org.json` — FETCH_FAILED (offsite → felix.org), kept as the
  negative fixture it is
- `felix.org.json` — OK(271), the follow-up probe of the redirect target

## 9. Test status

- `tests/crawl-outcome/crawl_outcome_test.ts`: **203 checks, all pass** — the
  original 12 taxonomy sections plus §13 (offline audit regressions) and §14
  (furniture regressions).
- `bash tests/run-all.sh` (with `PGBIN=/usr/lib/postgresql/17/bin`, as root):
  every suite green — REPLAY OK, BYTEMATCH OK, 555 delivery-gate checks, all
  adversarial suites. In the combined run the exclusivity suite failed to START
  its throwaway Postgres — another workstream's concurrent test run held the
  suite's fixed `/tmp/ktebli-exclusivity` dir and port 5434 — and a re-run with
  a private `RUNDIR`/`PORT` passed cleanly: STRANDED-CLAIM PASSED, ceiling probe
  UNBOUNDED (40/40). Two host hazards for whoever runs this next: (1) Postgres
  16 is the scripts' default and is not installed here — set
  `PGBIN=/usr/lib/postgresql/17/bin` or both DB suites die on a missing
  `initdb`; (2) the DB suites use fixed /tmp paths and ports, so two worktrees
  running them concurrently collide — pass private `RUNDIR`/`PORT` when
  parallel agents are active.
- `deno check` clean on `crawl_outcome.ts` and `ssrf.ts` (deno 2.9.5 via npx).
  (`deno check` on index.ts fails in this environment on an unrelated npm
  specifier, `npm:fflate@0.8.2`, needing `deno install`/node_modules — WS3's
  file, predates this workstream's changes; live-run.sh's own driver typecheck
  against the crawl module passes.)

## 10. Deploy note

These changes touch `ssrf.ts` and `crawl_outcome.ts`, which the worker bundles.
Production stays on v26 until the next deploy; `stripHtml`'s output is now
line-structured and entity-decoded, which also feeds the analyze stage's grant
fetch — strictly less junk in prompts, but worth knowing when diffing the next
deploy. Cached `org_intel` rows hash differently under 1.2.0, so first crawls
after deploy will re-crawl rather than reuse — by design (`hasRecordedOutcome`
already refuses pre-contract rows).
