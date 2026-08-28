# Phase 5 — the six-site live crawl (WS5)

Status: **live run pending.** `stack/live-run.sh` refuses to run until
`worker/index.ts` delegates to `crawl_outcome.ts`, and that wiring belongs to WS3
(worker/index.ts is read-only for this workstream). Everything that does not need
the network is done: the six sites are chosen and committed, the offline
silent-failure audit of the crawler is complete with fixes and regression tests,
and the full test suite is green. The outcome table below fills in when the run
is unblocked.

## The refusal, verbatim

```
==> checking that this measures the pipeline's own crawl path

FATAL: worker/index.ts does not import crawl_outcome.ts.
  The crawler patch has not been applied yet, so a run now would measure a module
  the pipeline does not call. Apply the patch spec first (qloop/inv/patch-crawl.md).
```

This check is correct and was not weakened: a run today would measure a module
the pipeline does not call. Two notes for whoever wires it: the referenced patch
spec `qloop/inv/patch-crawl.md` does not exist in the repo (the directory was
never committed), and per RUNLOG the wiring is scheduled as wave-2 index.ts work
after the WS3 merge. All three egress guards passed before the refusal
(production blackholed in /etc/hosts, no Supabase host in the sites file; the
`--deny-net` and live-probe guards sit later in the script).

## The six sites

Format matches `stack/sites-phase5.txt` (committed). Names are the organisations'
real working names, never derived from the domain — deriving them would make the
identity gate pass by construction.

| # | URL | Organisation | Why chosen / criterion covered |
|---|-----|--------------|-------------------------------|
| 1 | https://thefelixproject.org | The Felix Project | **The documented prior silent-failure case** (CLAUDE.md P1.6: zero evidence, no error). Known crawler-blocker candidate (WAF class). |
| 2 | https://www.sufra-nwlondon.org.uk | Sufra NW London | Ordinary WordPress-class charity site, rich in local nouns (food bank + community kitchen, Brent). The buyer archetype. |
| 3 | https://www.themagpieproject.org | The Magpie Project | Small Newham charity (mothers and under-5s in temporary accommodation); thin ordinary-CMS site. |
| 4 | https://www.glassdoor.org.uk | Glass Door Homeless Charity | Ordinary CMS; also a deliberate identity-gate exercise — the working name ("Glass Door") differs in shape from the registered name, and the domain collides with a famous commercial brand. |
| 5 | https://www.nourishcommunityfoodbank.org.uk | Nourish Community Foodbank | Squarespace/Wix-class small site (Tunbridge Wells food bank). |
| 6 | https://watsi.org | Watsi | **JS-rendered candidate** — historically a client-side React app with content absent from raw HTML. The least community-shaped of the six, chosen because genuinely client-rendered small-nonprofit sites are rare and this is the one that can be named with confidence. If it now ships server-rendered HTML, the criterion is recorded as missed, not massaged. |

Offline sanity (pure functions, no network): all six org/domain pairings clear
`identityVerdict()` both with the site's stated name and with no stated name at
all (domain-token fallback). So if the live run reports `identity_mismatch` for
any of them, that is a genuine finding — an offsite redirect, a parked domain —
and not a mispairing in the sites file.

## Outcome table

**Pending the live run.** To be filled from `stack/live-run.sh stack/sites-phase5.txt`:
outcome per site (BLOCKED / JS_ONLY / EXTRACTION_FAILED / NOTHING_RELEVANT /
OK(n)), pages fetched/parsed, referents extracted and surviving the identity
gate, and the failure point where it failed. Per-site ledgers go to
`stack/out/phase5-ledgers/<slug>.json` for the phase-6 mini-benchmark.

The identity gate stays asymmetric. An empty surviving-referents column for a
site that cannot be confidently attributed to the applicant is the correct
result and will not be softened to make this table look better.

## Offline silent-failure audit (done before the run)

The reference defect is a **discarded status**: thefelixproject.org produced
`pages: []`, a `meta` with no error key, and one useless sentence, because
`crawlSite()` fetched the HTTP status and threw it away. `crawl_outcome.ts`
fixed that layer. The audit looked for the same class recurring in the layers
that remain — (a) fetch errors swallowed into empty results, (b) outcomes that
misdescribe what happened, (c) permissive defaults on malformed inputs, (d)
matchers satisfiable by fragments. Eight findings, all fixed in WS5-owned files
and each pinned by a canned-response regression test
(`tests/crawl-outcome/crawl_outcome_test.ts` §13). Contract bumped 1.0.0 → 1.1.0.

1. **(b) The content-type gate swallowed the refusal status** (`ssrf.ts`). A
   403/429 served with a non-text or missing `content-type` threw plain
   `bad_content_type` before any caller saw the status, and classified
   `fetch_failed` — "did not answer", which is false; the server answered with a
   refusal. This is the reference defect class recurring one layer down. Fix:
   the error reason carries the status (`bad_content_type_http_403`) and the
   traversal recovers it into the observation, so it classifies `blocked_bot`
   (a 5xx variant stays `fetch_failed` and names the status). Tests: §13a.
2. **(c) Charset ignored.** Bodies were always decoded as UTF-8; a
   windows-1252/iso-8859-1 site (disproportionately the small-charity CMS
   estate) mis-decoded into replacement-character junk and a false
   `extraction_failed`. Fix: `decodeBody()` honours the content-type charset,
   sniffs `<meta charset>` when the header names none, and falls back to UTF-8
   on unknown labels. Tests: §13d.
3. **(c) Numeric entities survived `stripHtml` as residue** (`St Aidan&#8217;s`),
   polluting referents and dragging `letter_ratio` toward false
   `extraction_failed`. Fix: numeric, hex and common named entities decode;
   unknown named entities strip to a space as before. Tests: §13d.
4. **(d) Challenge matchers satisfiable by prose fragments.** Bare `forbidden`,
   `rate limit`, `you have been blocked`, and `just a moment` (the regex
   required zero of the three dots) could reclassify a thin *served* 2xx page as
   `blocked_bot`. Fix: markers split into STRONG (branded challenge signatures,
   CAPTCHA walls — may flag a 200/503/202 with almost no prose) and WEAK
   (ordinary English — may only *name* a refusal whose status already proves
   it). A page whose prose says "dogs are forbidden inside the hall" now
   classifies on its content; the end-to-end fixture flips from `blocked_bot`
   to `succeeded`. Accepted trade: a 503 whose body says "rate limit" now
   reports as `fetch_failed` HTTP 503 — less specific, never false. Tests: §13b.
5. **(d) A mount-point div with no script is not a JS shell.** A static page
   using `id="app"` as markup, with zero `<script>` elements, was called
   `js_only` ("draws its text with JavaScript" — false). Fix: mount-point
   markers additionally require the page to load any script at all. Tests: §13c.
6. **(c) A malformed empty `User-agent:` line fabricated a robots block.** The
   empty string became a group key, and every crawler's UA contains the empty
   string, so the group matched everyone — a broken robots.txt read as
   `blocked_robots` for the whole site. Fix: token-less UA lines name no
   crawler and are ignored. Also: where several groups match (`bot` and
   `kteblibot`), the most specific token now wins, not whichever the file
   stated first. Tests: §13f.
7. **(b, boundary) Parsed-page counting disagreed with the traversal** — the
   classifier counted `kept_chars >= 120` as parsed while the extraction keeps
   a page only when `> 120` (the worker/index.ts:1272 threshold). At exactly
   120 a report described a page as parsed that the crawl never kept. Aligned.
   Tests: §13e.
8. **(b) `nothing_relevant` hid refused subpages.** A rate limiter that serves
   the homepage and 429s everything after it read as "thin site". The reason
   now appends "N further page(s) were refused by the server", so "the site is
   thin" and "we were only shown one page of it" are distinguishable findings.
   Tests: §13g.

Verified not present (class a): every fetch attempt in the traversal — robots,
homepage, sitemap, subpages, offsite hops, budget exhaustion — records a
`PageObservation`; no catch discards an error.

## What the crawler still cannot do (by design, stated plainly)

- **No JavaScript engine.** A client-rendered site is reported `js_only`, never
  worked around — the architecture is eight edge functions with no browser, and
  that stays true. `stack/ground-truth.sh` (real browser) exists to tell
  "crawler got nothing" apart from "there was nothing to get".
- **No PDFs.** The traversal skips `.pdf` links; the owner's deep-crawl decision
  (annual reports, accounts) is future work, not this phase.
- **robots.txt is honoured, not negotiated.** A site that forbids automated
  readers is `blocked_robots` and nothing is read; the customer is told to paste
  the text instead.
- **One name candidate for the harness gate.** The live-run driver hands the
  identity gate the single most authoritative name the homepage states — never
  "whichever candidate clears".

## Test status

- `tests/crawl-outcome/crawl_outcome_test.ts`: all 13 sections pass (the 8
  original taxonomy sections plus the §13 audit regressions).
- `bash tests/run-all.sh`: **ALL SUITES PASSED** (exit 0), including migration
  replay (REPLAY OK), the stranded-claim test, and the exclusivity probe — which
  now reports UNBOUNDED (40/40 applicants served; the ceiling fix from another
  workstream is in this branch, so the deliberately-failing test has turned
  green). Host note: this machine has Postgres 17/18, not the scripts' default
  16 — run with `PGBIN=/usr/lib/postgresql/17/bin`, or the two DB suites fail
  on a missing `initdb` before testing anything.
- `deno check` clean on `crawl_outcome.ts`, `ssrf.ts`, and the test file
  (deno 2.9.5 via npx).

## Deploy note

These fixes change `supabase/functions/worker/ssrf.ts`, which deployed v26 also
bundles. Production is unaffected until the next worker deploy; whoever deploys
next should know that the old in-repo `crawlSite()` path in `index.ts` still
discards `status` — the ssrf change makes a 4xx-with-untyped-body *throw with a
status-bearing reason* rather than a bare `bad_content_type`, which the old path
records into `meta.errors` exactly as before. Nothing about the old path gets
worse; it simply stays wrong until the wave-2 wiring replaces it.
