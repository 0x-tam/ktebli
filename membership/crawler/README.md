# Approved Lebanon source crawler

This package produces local JSON artifacts for the membership importer. It does not
publish to the database, call Jev, charge customers, deploy, or schedule itself.
Run with Node 20+ after `npm ci` in this directory.

## Run and resume

```sh
npm run crawl -- --state .state/coverage.json --output .state/opportunities.json --max-pages 60 --sources ppa,cdr
npm run crawl -- --state .state/coverage.json --output .state/opportunities.json --max-pages 60 --sources ppa --enrich --max-details 20
npm run crawl -- --state .state/coverage.json --output .state/opportunities.json --sources ppa --enrich --max-details 40 --published-since 2026-09-28
npm run crawl -- --state .state/coverage.json --output .state/opportunities.json --sources ppa --enrich --max-details 100 --published-before 2026-09-28
npm run crawl -- --state .state/coverage.json --output .state/opportunities.json --refresh --sources ppa --max-pages 60
npm run crawl:supplemental -- --watch-state .state/watches.json --output .state/supplemental-opportunities.json
npm run crawl:ungm-curated -- --state .state/ungm-coverage.json --output .state/ungm-opportunities.json --max-details 12
npm run crawl:mawred -- --state .state/mawred-coverage.json --output .state/mawred-opportunities.json
```

The same state resumes pending cursors. `--retry-blocked` retries a previously
blocked/incomplete stream; it does not solve a challenge or ignore robots.
`--refresh` starts a new listing pass while retaining old detail facts as a cache.
Only records discovered in that pass are emitted for refreshed sources. Without
`--refresh`, a completed listing is not fetched repeatedly. Use one writer per
state file. A caller may run this on its existing scheduler; none is installed here.

Exit 2 means the selected listing streams are incomplete. The artifact still
reports overall `coverage.status` across all streams and a separate
`coverage.selectedStatus` for `--sources`; selecting PPA does not relabel blocked
CDR as complete. A page budget, unknown markup,
repeated page, duplicate row, moving total, missing range or failed request can
never silently count as exhaustion. State saves atomically after each page.
The importer must qualify sources separately: both PPA language streams must
complete with matching ID sets before PPA promotion; blocked CDR must not reject
qualified PPA. An incomplete run must not delete or replace a previously complete
source catalogue. Match inputs treat all source text as untrusted evidence.

Detail enrichment has its own bounded budget and completeness count. PPA listing
“Opening of offers” is not a submission deadline. Explicit submission fields are
fetched separately. A listing refresh preserves verified detail evidence and
marks it for revalidation after content changes; details also expire for refresh
after 24 hours. Least-recently attempted ordering prevents one failing detail from
starving the queue. Failed refreshes preserve the last verified facts and expose
the error. Any stale or failed detail refresh downgrades top-level `detailStatus`
to `partial`, so import and matching cannot treat the preserved facts as current.
`--published-since` limits detail requests to notices published on or after that
date; within that slice, untouched details are attempted before retries, then
newer notices first. `coverage.details` reports both the scoped pending count and
`totalPendingLocales` for the whole catalogue. A completed recent slice does not
mean historical detail coverage is complete. Use `--published-before` with the
same cutoff in a separate bounded pass to advance the older backlog; it alternates
known future-deadline notices with other pending details so both make progress.
The two date scopes are mutually exclusive. Omit both flags for the full backlog.
These options do not relax request guards or source qualification. Three
consecutive DNS, timeout, access, robots or detail-schema failures halt the pass
after checkpointing, report `coverage.details.haltedAfter`, and exit 2; the
source remains incomplete and can be resumed later.
Content hashes exclude fetch/attempt timestamps and refresh bookkeeping,
so an unchanged fetch does not create a new matching version.
`verifiedLocales` counts all locale details last successfully parsed, including
stale details due for another fetch. `freshVerifiedLocales + pendingLocales`
equals `scopedLocales`; `staleVerifiedLocales` is the overlap between
`verifiedLocales` and `pendingLocales`. Counters are recomputed from saved state
after the pass, not from the initial queue.

UNGM's curated runner reads a small, reviewed list of official numeric notice
IDs and fetches only their detail URLs through the same DNS, robots, redirect and
rate guards. Its resumable checkpoint and output are ignored under `.state/`.
Coverage can complete for the curated IDs but does not imply complete UNGM
discovery: the public listing is script-rendered and the official search API
requires agency credentials. Unknown notice types remain `kind: unknown`, and
notices without an explicit Lebanon beneficiary or valid deadline are rejected.
The Mawred runner rechecks one fixed official Production Awards page. It keeps
the full bounded publisher program text in evidence, including age/origin,
organization exclusion, application conditions and the explicit Beirut deadline.
It does not claim broader grant discovery. `--refresh` forces one guarded
recheck when a publisher correction must be qualified before the normal TTL.

## Record contract

Core fields are `source`, `sourceKey`, `sourceUrl`, `title`, `description`,
`publishedAt`, `deadline`, `kind`, `evidence`, `fetchedAt`, `contentHash`.
Extensions include `locales`, `detailStatus`, `applicationStatus`,
`deadlinePrecision`, `deadlineLocal`, `deadlineTimezone`, `deadlineConflict`,
`crossReferences`, and `provenance`. Dates can be `YYYY-MM-DD`; do not coerce these
to invented midnight deadlines. Local times preserve issuer precision, with a
null timezone when the issuer did not state one. Conflicting locale dates/times
remain unresolved. Deadline evidence retains the complete source string.

PPA deduplicates numeric issuer ID and retains English/Arabic versions. Explicit
`Direct` procurement methods are `not_open_competition`; explicit publisher
award/cancellation/closure status is `closed`. No competition status is inferred
from a title. CDR keys
include procurement ID and lot. Cross-source references are evidence for later
merging, not permission to discard a publisher's record. Closed grants and
consensual/direct agreements must not appear as open competitions. Unknown
eligibility or submission conditions remain `needs_verification`.

Output is `{records, coverage}`. `coverage.streams` includes status, pages,
uniqueRecords, expectedTotal, cursor and error. Completeness is scoped discovery,
not a claim that every listed record is still open or fully eligibility-checked.
Supplemental coverage explicitly names its limited scope: two static embassy
calls and AICS titles that explicitly name Lebanon. Watch snapshots are separate
from qualified opportunity records and retain last success on failure.

## Network controls

Only approved HTTPS source paths are accepted. Every request/redirect validates
URL policy, robots, and all resolved addresses, then pins the HTTPS connection to
a public IP while retaining hostname TLS verification. Private, reserved and
mapped addresses, alternate ports and credentials fail closed. Responses are
bounded at 4 MB, requests at 25 seconds, redirects at 4, retries at 3 for 429/5xx.
There is a minimum 1.2 second gap, increased for publisher crawl-delay. Publisher
UTF-8/Windows-1252/Latin-1 text is decoded explicitly. Unsupported encodings fail.

The optional CDR DOM driver (`node src/cdr-cli.mjs`) runs fresh isolated Chromium,
with every accepted resource fulfilled through the same guarded HTTP transport.
It does not change the HTTP client's identity and cannot resolve a 403 that this
transport receives. A dead proxy blocks direct/background browser networking;
workers, service workers, WebSockets and WebRTC are disabled. Resource and session
budgets apply. Native Chromium network passthrough was removed because its redirect
behavior did not preserve per-hop URL/robots checks. No profile cookies, challenge
solutions, stealth plugins, CAPTCHA services or arbitrary domains are used.

## Live qualification — 2026-10-05

- PPA: 24 English + 24 Arabic pages exhausted; 1,165 distinct issuer IDs in each
  locale, 1,165 merged records. Publisher totals, ranges, ID sets and absent next
  links agreed. All 288 locale detail pages published since 2026-09-01 were
  verified on 2026-10-05, yielding 144 fully verified records; 2,042 older
  locale details still need verification. Of the 144, 92 have a deadline
  strictly after 2026-10-05 and a competition method, but eligibility remains
  `needs_verification`.
- CDR Ongoing: public normal-browser capture exhausted 43 records in six batches
  (8+8+8+8+8+3); final Load more control hidden. 17 are consensual agreements.
  Capture time `2026-10-05T13:40:15.815Z`, transport `manual_browser`. Automated
  HTTP and fresh Chromium attempts were blocked; scheduled refresh stays blocked.
  Archive/Others were not included in the requested current-scope capture.
- Australia DAP 2026–27: explicit publisher closure, 1 closed record.
- Czech SSP 2026: 1 closed record, submission deadline 2025-10-19.
- AICS Beirut: 18 publisher rows exhausted on one sub-capacity 20-row page with
  no next link. 10 titles explicitly name Lebanon, all closed/past deadline;
  7 Syria calls excluded. 1 ambiguous ELISSA 2025 geography remains listed for review.
  A stale “In corso” label never overrides an expired application deadline.
- Six official watch pages fetched: Australia, Czech Republic, Canada, EEAS,
  AICS and UNGM. Japan returned 403. UNDP disallowed crawling via robots.
- EEAS exposes a Lebanon facet (28 reported), but its filtered URL is robots
  disallowed; no complete Lebanon dataset is claimed. UNGM's HTML is an empty
  script-rendered shell; its observed required script is robots disallowed.
  Canada's official CFLI index had no Lebanon call link. These remain unqualified.
- Of 1,165 PPA listing records, 78 have the explicit `Direct` method and are
  excluded from competitive matching.
- Official UNGM detail pages: 11 manually curated Lebanon-beneficiary notices
  verified on 2026-10-05 (one explicit grant support-call, eight procurement
  notices, two individual-consultant notices conservatively `unknown`). These
  are a verified subset, not a discovered full UNGM catalogue. A candidate
  detail whose beneficiary did not name Lebanon was excluded.
- Two current arts-funding leads were verified directly from their publishers
- [Culture Resource Production Awards](https://mawred.org/artistic-creativity/production-awards/?lang=en)
  was live-qualified through the guarded crawler as one current grant for
  individual artists/writers from an Arab country born January 1992–December
  2011, deadline 2026-10-19 16:00 Beirut. The publisher expressly excludes
  support for entities or organizations. Its separate import requires a
  reviewed `mawred` source allowlist and remains disabled until then.
- [Goethe International Coproduction Fund](https://www.goethe.de/en/kul/foe/int.html)
  is a publisher-verified manual lead (non-German legal entities with a German
  artistic partner, deadline 2026-10-12 23:59 CET). The guarded client received
  `access_blocked`, so it is not an automated source or imported record.

Local artifacts are ignored under `.state/`. Durable reduced public fixtures and
manual CDR visible-cell provenance are under `fixtures/`. The manual capture is
not an automated source-health success. Recheck freshness before using old calls.

## Checks

```sh
npm test
PLAYWRIGHT_BROWSERS_PATH=/path/to/installed/browsers npm test
```

The second command enables the real isolated-Chromium loopback sentinel test.
Without a configured browser directory it is explicitly skipped. A local server
permission is required in sandboxed environments. Tests cover real publisher
fixtures, locale reconciliation, pagination failures, robots/redirect/SSRF
rejection, refresh preservation, stable hashes, dates, closed-call extraction,
and browser attempts to reach loopback through page/worker requests.
