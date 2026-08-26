# Design — the deep own-domain crawl

Target: turn the applicant's own website from a source of institutional boilerplate into the
system's primary source of **proper nouns with dates attached** — named places, named partners,
named programmes, named people, real unit costs, dated results — without loosening grounding by
one inch.

Read against the working tree. Line references are to
`/home/user/ktebli/supabase/functions/worker/index.ts` (1995 lines) and
`/home/user/ktebli/supabase/functions/worker/ssrf.ts` (150 lines), and follow
`design-resumability-and-alerts.md` for the yield/checkpoint primitives, which this design
consumes rather than reinvents.

---

## 0. The five things in today's code that cap the yield, and what each becomes

| # | Today | Line | Becomes |
|---|---|---|---|
| 1 | PDFs excluded twice: extension filter, and `safeFetchText`'s `text/*` content-type allow list | `:241`, `ssrf.ts:85` | `safeFetchBytes` + lazy pdfjs text layer, layout-aware line reconstruction, page-level provenance |
| 2 | Discovery is depth 1: `/sitemap.xml` + links on the **homepage only**; the loop at `:249-265` fetches but never re-discovers | `:236-239` | best-first priority frontier, depth 3, robots-declared sitemaps, sitemap indexes, links from every fetched page |
| 3 | `stripHtml` flattens the document to one line and kills every list, table row and heading | `ssrf.ts:142-150` | block-aware line extraction (`li`, `td`, `tr`, `h1-6`, `dt/dd`, `br`) with entity decoding, incl. `&pound;`/`&euro;` |
| 4 | `.filter((p) => p.length > 40)` deletes exactly the proper-noun-dense shapes | `:254` | `keepLine()` — length **or** specificity (digit, currency, non-initial capitalised token) |
| 5 | The ledger item is one untyped English sentence; nothing can ask "what is the venue" | `:1322-1327` | typed items with `kind`, `entities`, `value`, `quote`, `locator{doc,page,line}` — additive, old fields unchanged |

And one thing that does **not** change: the identity gate stays asymmetric. It gets *more* gates,
not fewer (§8).

---

## 1. Where it runs

A new stage, `harvest`, inserted at seq 2, between `analyze` and `org`:

```
analyze → harvest → org → voice → strategy → design → gen:* → validate → check → package → deliver
```

`stagesFor()` in `supabase/functions/stripe-webhook/index.ts:58-83` gains one row (that file is
owned by another track; the change is one line):

```ts
  const base: Array<[string, string]> = [
    ["analyze", "Analysing the opportunity and donor requirements"],
    ["harvest", "Reading your website and published documents"],   // NEW, seq 2
    ["org",     "Reviewing your organisation"],
    …
```

Three reasons for a separate stage rather than a fatter `org`:

1. **It is I/O-bound and long** (§11: 90–210 s), and `org`'s extraction is CPU/LLM-bound and
   short. Merged, every extraction retry re-crawls the site. Split, `org` re-reads
   `crawl_docs` rows and costs nothing to retry.
2. **It must yield across invocations.** Under `design-resumability-and-alerts.md` §A.2, a stage
   that can hand the row back mid-flight (`yield_stage`) is the unit of resumability. A crawl
   whose frontier is checkpointed in `job_stages.progress` after every document is the cleanest
   possible instance of that pattern — it never re-fetches anything.
3. **It runs after `analyze` on purpose.** The Grant Intelligence Object's requirement matrix
   supplies query terms that reweight the frontier (§3.3): a donor that asks about safeguarding
   makes `/policies/safeguarding` a high-value page; a donor that asks for audited accounts
   makes the accounts PDF the highest-value document on the site. Today's `pageValue`
   (`:176-189`) is grant-blind.

Sequencing is unchanged in kind: strictly sequential, each stage consuming the one before it.
`claim_next_stage` (`db/schema.sql:400-436`) already refuses to run a stage while an earlier one
of the same proposal is not `done`, so nothing about the queue changes.

**Backwards compatibility.** `job_stages` rows are seeded at payment
(`stripe-webhook/index.ts:199-200`), so in-flight orders keep the old stage list. `org` therefore
keeps a fallback: if no `harvest` output exists in `c.out`, it runs today's `crawlSite` path
exactly as now. New code is additive; the old path is deleted only after the last pre-change
order drains.

### 1.1 Same-domain concurrency

`PARALLEL = 3` (`:42`) means three stages of three *different* proposals share an isolate. Two
orders from the same organisation (or two organisations on one domain) could crawl the same host
at once and defeat the pacer, which lives in isolate memory. A database-level claim fixes it:

```sql
create unique index crawl_runs_one_live_per_domain
  on public.crawl_runs (domain) where status = 'running';
```

`try_begin_crawl()` (§10) returns `busy` on the unique violation; the second stage does not crawl,
it yields once with a 30 s backoff, and on the next tick finds fresh `crawl_docs` rows and skips
straight to extraction. Cost of the collision is one wasted claim, never a double crawl.

---

## 2. Scope — what "own domain" means, precisely

The owner's rule is *own domain only, no third-party sources*. Written as code, that rule has one
trap: a charity on a shared platform. If the seed is `hopewell.wordpress.com`, "same registrable
domain" is `wordpress.com`, and a naive scope crawls **other people's blogs** and attributes them
to the customer. That is the exact failure the identity gate exists to prevent, arriving through
the front door.

```ts
// ================= harvest: scope =================
// eTLD+1 without a Public Suffix List. Deno edge has no PSL and we will not ship
// one; the table below covers the suffixes that actually appear in this market,
// and anything not in it falls back to last-two-labels. Errors here are
// contained by inScope(), which never widens beyond the seed host unless the
// registrable domain is confidently shared.
const MULTI_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "org.au", "net.au", "asn.au", "co.nz", "org.nz",
  "co.za", "org.za", "com.br", "org.br", "com.tr", "org.tr", "com.ng", "org.ng",
  "co.ke", "or.ke", "co.in", "org.in", "co.il", "org.il", "com.lb", "org.lb",
  "com.eg", "org.eg", "com.jo", "org.jo", "com.pk", "org.pk", "com.bd", "org.bd",
  "com.gh", "org.gh", "com.my", "org.my", "com.ph", "org.ph", "com.sg", "org.sg",
]);
function registrable(host: string): string {
  const h = normDomain(host);                      // reuses :204-206
  const p = h.split(".");
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join(".");
  return MULTI_SUFFIX.has(last2) ? p.slice(-3).join(".") : last2;
}

// Hosts where a subdomain or a path belongs to a DIFFERENT customer of the same
// platform. On these, scope collapses to the exact host — or to the exact path
// prefix where the platform is path-multiplexed.
const PLATFORM_SUFFIX = [
  "wordpress.com", "blogspot.com", "wixsite.com", "squarespace.com", "weebly.com",
  "github.io", "gitlab.io", "notion.site", "webflow.io", "carrd.co", "myshopify.com",
  "godaddysites.com", "sites.google.com", "wordpress.org", "tumblr.com", "substack.com",
  "medium.com", "wix.com", "jimdosite.com", "strikingly.com", "netlify.app", "vercel.app",
  "pages.dev", "onrender.com", "glitch.me", "neocities.org", "over-blog.com", "webs.com",
];
const PATH_MULTIPLEXED = ["sites.google.com", "medium.com", "substack.com", "wordpress.org"];

export type ScopeKind = "domain" | "host" | "path";
export interface Scope {
  kind: ScopeKind; host: string; registrable: string; pathPrefix: string; origin: string;
}
export function scopeFor(seed: URL): Scope {
  const host = normDomain(seed.hostname);
  const reg = registrable(host);
  const platform = PLATFORM_SUFFIX.find((s) => host === s || host.endsWith("." + s));
  if (platform && PATH_MULTIPLEXED.includes(platform)) {
    // sites.google.com/view/hopewell/... — one customer owns one path prefix
    const seg = seed.pathname.split("/").filter(Boolean).slice(0, 2);
    return { kind: "path", host, registrable: reg, pathPrefix: "/" + seg.join("/"), origin: seed.origin };
  }
  if (platform) return { kind: "host", host, registrable: reg, pathPrefix: "/", origin: seed.origin };
  return { kind: "domain", host, registrable: reg, pathPrefix: "/", origin: seed.origin };
}
export function inScope(u: URL, s: Scope): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = normDomain(u.hostname);
  if (s.kind === "host" || s.kind === "path") {
    if (h !== s.host) return false;
    return s.kind === "host" || u.pathname.startsWith(s.pathPrefix);
  }
  return h === s.registrable || h.endsWith("." + s.registrable);
}
```

Under `kind: "domain"` the crawl reaches `www.`, `reports.`, `impact.`, `blog.` — the subdomains
where annual reports actually live. Under `kind: "host"`/`"path"` it reaches nothing but the
customer's own space on a shared platform. The scope decision is recorded on `crawl_runs.scope`
and is visible in the audit trail, because a wrong scope decision is the highest-severity bug this
subsystem can have.

**Off-scope redirect is a hard drop, as today** (`:226`): a fetch whose `finalUrl` leaves scope is
discarded and recorded `offsite_redirect`, never followed. If the *seed itself* redirects off
scope, the scope is recomputed from the final URL **only** when the final registrable domain
still token-matches the applicant name (`orgTokens`, `:441-446`); otherwise the whole crawl ends
`offsite_redirect` with zero evidence. Rationale: `hopewelltrust.org → hopewell-trust.org.uk` is a
rename; `hopewelltrust.org → bigumbrella.org` is a merger into another legal entity whose
achievements are not the applicant's.

---

## 3. Discovery, ranking, and the budget that bounds it

### 3.1 Frontier sources, in order

1. `/robots.txt` — fetched first, always (§4). Its `Sitemap:` directives are frontier seeds.
2. `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`, plus every `Sitemap:` from robots.
   Sitemap **indexes** are followed one level: max `MAX_SITEMAPS = 4` documents, max
   `MAX_SITEMAP_LOCS = 2000` `<loc>` entries in total, then the parser stops and records
   `sitemap_truncated`. A `<lastmod>` newer than the cached `crawl_docs.fetched_at` raises score.
3. Links from **every** fetched HTML document, up to `MAX_DEPTH = 3`. This is the change that
   matters most: annual reports live on `/about/publications/annual-reports/2024`, three hops from
   the homepage, and today's depth-1 discovery cannot see them.
4. A small probe list, used **only** when steps 1–3 produced no report-class URL and robots allows
   it: `/annual-report`, `/annual-reports`, `/reports`, `/publications`, `/impact`,
   `/about/accounts`. Capped at 6 requests, all recorded. Six 404s on a customer's own site is an
   acceptable cost for the single most valuable document class; sixty would not be.

### 3.2 Budgets

```ts
const HARVEST = {
  MAX_DEPTH:        3,
  MAX_HTML:         40,      // documents actually fetched and kept
  MAX_PDF:          8,
  MAX_FETCHES:      70,      // includes 404s, robots, sitemaps, probes, off-scope drops
  MAX_TOTAL_BYTES:  24 * 1024 * 1024,
  MAX_PDF_BYTES:    12 * 1024 * 1024,
  MAX_PDF_PAGES:    60,
  PER_DOC_CHARS:    24_000,  // stored per document (was 9_000 per page, :215)
  CORPUS_CHARS:     260_000, // ceiling on what reaches extraction (was 60_000, :215)
  HTML_TIMEOUT_MS:  12_000,
  PDF_TIMEOUT_MS:   25_000,
  MIN_GAP_MS:       700,     // per host
  MAX_INFLIGHT:     2,       // per host
  FETCH_COST_MS:    3_500,   // wouldOverrun() estimate for one HTML fetch+extract
  PDF_COST_MS:      20_000,  // wouldOverrun() estimate for one PDF fetch+parse
} as const;
```

Runaway is bounded five independent ways — depth, per-type document caps, a total fetch cap that
counts failures, a byte cap, and the invocation deadline. Any one of them tripping ends the crawl
cleanly with `budget_exhausted` and whatever was collected; none of them can produce an unbounded
loop, because the frontier is a `Set`-deduped priority queue and every pop marks the URL seen
before the fetch is attempted.

### 3.3 Ranking — grant-aware, PDF-forward

```ts
// Rebalanced from PAGE_VALUE (:176-183). The classes densest in proper nouns —
// reports, impact, team, projects — now outrank mission pages, which are the
// classes that produced the boilerplate the blind critics rejected.
const URL_VALUE: ReadonlyArray<readonly [RegExp, number]> = [
  [/annual[-_]?report|trustees?[-_]?report|accounts|financial[-_]?statement/i, 26],
  [/impact|evaluation|outcomes?|results?|case[-_]?stud|our[-_]?stories/i, 20],
  [/program|programme|project|our[-_]?work|what[-_]?we[-_]?do|service/i, 16],
  [/publication|research|download|resource|library/i, 14],
  [/team|leadership|staff|trustee|board|governance|who[-_]?we[-_]?are/i, 13],
  [/partner|funder|supporter|network|with[-_]?us/i, 10],
  [/about|history|mission|vision/i, 9],
  [/polic|safeguard|equality|complaint|privacy[-_]?polic/i, 6],   // donor-required certifications
  [/news|blog|stories|events?/i, 5],
  [/donate|shop|basket|cart|login|signup|account|search|tag\/|category\/|page\/\d|\?/i, -30],
  [/terms|cookie|sitemap\.xml$|feed|rss|\.(jpe?g|png|gif|svg|webp|mp4|zip|css|js)$/i, -40],
] as const;

function urlValue(url: string, depth: number, isPdf: boolean, grantTerms: string[]): number {
  let v = 1;
  for (const [re, w] of URL_VALUE) if (re.test(url)) v += w;
  // A PDF on a charity site is nearly always a report, an accounts pack or a
  // policy — the three classes that carry dated, costed, named facts.
  if (isPdf) v += 12;
  // Grant Intelligence supplies its own vocabulary: a donor that asks about
  // safeguarding makes the safeguarding policy a first-class document.
  const lower = url.toLowerCase();
  for (const t of grantTerms) if (t.length > 4 && lower.includes(t)) v += 4;
  // A recent year in the URL is a strong recency signal on report archives.
  const y = url.match(/(20[12]\d)/);
  if (y) v += Math.max(0, 6 - (new Date().getFullYear() - Number(y[1])));
  return v - Math.max(0, depth - 1) * 3;
}

// Grant terms come from the analyze stage's requirement matrix, deterministically:
function grantTermsFrom(analysis: Record<string, unknown> | undefined): string[] {
  const reqs = (analysis?.requirements as Array<{ req?: string }> | undefined) ?? [];
  const words = reqs.flatMap((r) => String(r.req ?? "").toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const stop = new Set(["organisation", "organization", "applicant", "project", "please", "provide",
    "describe", "detail", "details", "including", "should", "which", "grant", "funding", "proposal"]);
  const freq = new Map<string, number>();
  for (const w of words) if (!stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}
```

The frontier is a best-first queue: pop highest score, fetch, extract, push newly-discovered links
with their scores. PDFs are popped against their own budget (`MAX_PDF`) so a site with 300 PDFs
cannot starve the HTML budget and vice versa.

---

## 4. Politeness — robots, pacing, conditional requests

We are fetching a **customer's own site, with their consent** (they typed the URL into the order
form). That consent is exactly why robots.txt must still be obeyed: *the customer may not own the
domain they typed*. Robots compliance is not etiquette here, it is a second, independent check on
the assumption that this domain belongs to this applicant. A crawl that ignores robots on a
mistyped domain is a crawl of a stranger's site.

**Decision: obey robots.txt with no consent override, ever.** If robots disallows, we record
`robots_disallowed` with the exact matched rule and tell the customer on their order page which
line of their own robots.txt blocked us. No human intervenes; the intake answers carry the order.

```ts
// ================= harvest: robots (RFC 9309) =================
export interface RobotsRules {
  allow: string[]; disallow: string[]; crawlDelayMs: number; sitemaps: string[];
  verdict: "rules" | "allow_all" | "disallow_all" | "unavailable";
  raw: string;
}
export function parseRobots(txt: string, ua = "ktebli"): RobotsRules {
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[]; delay: number }> = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const l of lines) {
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "sitemap") { sitemaps.push(v); continue; }
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [], delay: 0 }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === "allow") cur.allow.push(v);
    else if (k === "disallow") cur.disallow.push(v);
    else if (k === "crawl-delay") cur.delay = Math.min(5_000, Math.max(0, Number(v) * 1000 || 0));
  }
  // Most specific agent group wins: our token beats "*". RFC 9309 §2.2.1.
  const mine = groups.find((g) => g.agents.some((a) => a === ua || a.includes("ktebli")));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = mine ?? star;
  if (!g) return { allow: [], disallow: [], crawlDelayMs: 0, sitemaps, verdict: "allow_all", raw: txt.slice(0, 4000) };
  const blanket = g.disallow.includes("/") && !g.allow.length;
  return {
    allow: g.allow, disallow: g.disallow.filter(Boolean), crawlDelayMs: g.delay, sitemaps,
    verdict: blanket ? "disallow_all" : "rules", raw: txt.slice(0, 4000),
  };
}

// Longest match wins; on equal length, Allow wins (RFC 9309 §2.2.2). Supports * and $.
function ruleRe(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + (esc.endsWith("\\$") ? esc.slice(0, -2) + "$" : esc));
}
export function robotsAllows(r: RobotsRules, path: string): { ok: boolean; rule: string } {
  if (r.verdict === "allow_all" || r.verdict === "unavailable") return { ok: true, rule: "" };
  if (r.verdict === "disallow_all") return { ok: false, rule: "Disallow: /" };
  let best: { ok: boolean; rule: string; len: number } = { ok: true, rule: "", len: -1 };
  for (const d of r.disallow) {
    if (ruleRe(d).test(path) && d.length > best.len) best = { ok: false, rule: "Disallow: " + d, len: d.length };
  }
  for (const a of r.allow) {
    if (ruleRe(a).test(path) && a.length >= best.len) best = { ok: true, rule: "Allow: " + a, len: a.length };
  }
  return { ok: best.ok, rule: best.rule };
}
```

**Unavailable robots.** RFC 9309 §2.3.1.4: 4xx means "no restrictions"; a persistent 5xx means
"disallow everything". Implemented exactly that way, and both are recorded — `robots_absent`
(crawl proceeds) versus `robots_unreachable` (crawl stops, `robots_fetch_failed`). A network
timeout on robots is retried once, then treated as 5xx.

**Pacing.**

```ts
class HostPacer {
  private next = 0;
  private inflight = 0;
  constructor(private gapMs: number) {}
  setDelay(ms: number) { this.gapMs = Math.max(this.gapMs, ms); }
  async slot(): Promise<void> {
    while (this.inflight >= HARVEST.MAX_INFLIGHT) await new Promise((r) => setTimeout(r, 120));
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + this.gapMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.inflight++;
  }
  release() { this.inflight--; }
}
```

`gapMs` starts at `HARVEST.MIN_GAP_MS` (700 ms) and is raised to `robots.crawlDelayMs` when
declared. A declared `Crawl-delay` above 5 s is **capped at 5 s and the page budget is cut
proportionally** rather than the crawl stalling — recorded `crawl_delay_capped` with the declared
value, so the decision is visible.

**Backoff.** 429 or 503 → honour `Retry-After` up to 30 s, at most twice per host, then abandon
the host with `blocked_bot`. 403 on more than three consecutive fetches, or an HTML body matching
`/(cf-browser-verification|Just a moment\.\.\.|Checking your browser|Attention Required! \| Cloudflare|Access denied)/i`
→ `blocked_bot` immediately; no evasion, no UA rotation, no retry loops. We do not fight a WAF on
a customer's site.

**Conditional requests.** Re-crawls send `If-None-Match` / `If-Modified-Since` from
`crawl_docs.etag` / `last_modified`. A 304 costs one round trip, no bytes, no re-extraction, and
no LLM call — this is the single largest cost saving in the design (§11) and it is also the most
polite thing we do.

**User agent.**

```ts
const HARVEST_UA =
  "KtebliBot/1.0 (+https://ktebli.com/bot; reads the site owner's own pages at their request; hello@ktebli.com)";
```

`ssrf.ts:86` already defaults to a `KtebliBot/1.0` string; this extends it with a contact address
and a real page must exist at `/bot` explaining who we are and how to block us. That page is the
honest counterpart to obeying robots.

---

## 5. Fetching bytes — the one `ssrf.ts` addition

`safeFetchText` cannot be reused for PDFs: it decodes to a string (`ssrf.ts:139`) and its
content-type allow list is text-only (`ssrf.ts:85`). The additions are deliberately minimal —
every SSRF guard (`assertHostSafe`, redirect walking, byte cap, timeout) is shared.

```ts
// ---- ssrf.ts (additions) ----
export interface SafeFetchBytesResult {
  finalUrl: string; status: number; contentType: string;
  bytes: Uint8Array; truncated: boolean;
  etag: string | null; lastModified: string | null;
}
export interface SafeFetchOpts {
  maxRedirects?: number; timeoutMs?: number; maxBytes?: number;
  allowContentTypes?: RegExp; userAgent?: string;
  accept?: string;                                     // NEW: :103 is hardcoded to text/html
  ifNoneMatch?: string | null;                         // NEW: conditional GET
  ifModifiedSince?: string | null;                     // NEW
}

export async function safeFetchBytes(rawUrl: string, opts: SafeFetchOpts = {}): Promise<SafeFetchBytesResult> {
  // Identical redirect/guard walk to safeFetchText (ssrf.ts:76-138); the only
  // differences are the default allow list, the accept header, the conditional
  // headers, and returning the raw buffer instead of decoding it.
  // 304 is returned as status 304 with bytes.length === 0 and is NOT an error.
  …
}
```

`safeFetchText` gains the same three optional headers and a `status === 304` early return. No
existing call site changes behaviour: the new options are all optional, and the defaults are
today's values.

---

## 6. HTML extraction — keep the short, factual, proper-noun-dense lines

The ground-truth doc's sharpest crawler finding: `stripHtml` flattens the document to one line
(`ssrf.ts:142-150`), so the only splits are sentence punctuation, and then `p.length > 40`
(`:254`) deletes everything short. "Founded 2011", "12 staff", a five-borough list, a table row of
costs, a trustee list — all deleted. The extractor is rebuilt around keeping exactly those.

```ts
// ================= harvest: HTML → structured lines =================
const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€",
  dollar: "$", cent: "¢", yen: "¥", mdash: "—", ndash: "–", hellip: "…", rsquo: "'",
  lsquo: "'", ldquo: '"', rdquo: '"', deg: "°", times: "×", middot: "·", bull: "•",
};
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCp(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[String(n).toLowerCase()] ?? m);
}
function safeCp(n: number): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
}

export interface DocLine { t: string; kind: "h" | "p" | "li" | "row" | "meta"; n: number }

export function htmlToLines(raw: string, cap = 400_000): {
  lines: DocLine[]; title: string; jsonld: unknown[]; spa: boolean;
} {
  const src = raw.slice(0, cap);
  const title = decodeEntities((src.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "")).trim();

  // JSON-LD and framework payloads first — they survive when the visible DOM does not.
  const jsonld: unknown[] = [];
  for (const m of src.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { jsonld.push(JSON.parse(m[1])); } catch { /* malformed ld+json is common; ignore */ }
  }
  const nextData = src.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) { try { jsonld.push(JSON.parse(nextData[1])); } catch { /* ignore */ } }

  let s = src
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // NOTE: nav/header/footer are deliberately NOT stripped. The footer copyright
  // line is often the only place a small charity states its own legal name and
  // registration number, and G2 (§9) needs those anchors. Site chrome is removed
  // later, by frequency across documents (dropChrome, §6), which is the correct unit.

  // Block boundaries BEFORE tag stripping — this is the whole point.
  // Sentinels are control characters that cannot occur in rendered page text.
  const CELL = "\u0002", H = "\u0003", LI = "\u0004", ROW = "\u0005";
  s = s
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|dt|dd|blockquote|figcaption|td|th)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " " + CELL + " ")   // cell separator inside a row
    .replace(/<h([1-6])\b[^>]*>/gi, "\n" + H + "$1 ") // heading marker
    .replace(/<li\b[^>]*>/gi, "\n" + LI + " ")        // list marker
    .replace(/<tr\b[^>]*>/gi, "\n" + ROW + " ")       // row marker
    .replace(/<[^>]+>/g, " ");

  const out: DocLine[] = [];
  let n = 0;
  for (const rawLine of decodeEntities(s).split("\n")) {
    const marker = rawLine.trimStart()[0] ?? "";
    const t = rawLine
      .replace(/[\u0002-\u0005]/g, (ch) => (ch === CELL ? " | " : " "))
      .replace(/\s*\|\s*/g, " | ").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const kind: DocLine["kind"] =
      marker === H ? "h" : marker === LI ? "li" : marker === ROW ? "row" : "p";
    n++;
    if (keepLine(t, kind)) out.push({ t: t.slice(0, 600), kind, n });
  }
  if (title) out.unshift({ t: title, kind: "meta", n: 0 });

  const visible = out.reduce((a, l) => a + l.t.length, 0);
  const spa = visible < 400 && /<div[^>]+id=["'](root|app|__next|__nuxt)["']|window\.__(NUXT|NEXT)__|ng-version=/i.test(src);
  return { lines: out, title, jsonld, spa };
}

// The replacement for `.filter((p) => p.length > 40)` (:254).
// A line survives if it is long ENOUGH, OR if it is SPECIFIC: it carries a
// number, a currency marker, or a proper noun in a non-initial position.
const CURRENCY = /[£$€₪₦₨₹¥]|\b(GBP|USD|EUR|AED|SAR|EGP|KES|NGN|ZAR|INR|LBP|JOD)\b/;
const PROPER_NOUN_MID = /\s(?!The\b|A\b|An\b|We\b|Our\b|In\b|On\b|At\b|And\b|But\b|For\b|This\b|That\b)[A-Z][a-zA-Z'’-]{2,}/;
export function keepLine(t: string, kind: DocLine["kind"]): boolean {
  if (t.length < 3) return false;
  if (/^(home|menu|search|donate|close|back|next|previous|share|skip to (main )?content|cookie)$/i.test(t)) return false;
  if (t.length > 40) return true;
  if (/\d/.test(t) || CURRENCY.test(t)) return true;        // "Founded 2011", "12 staff", "£4,200"
  if (PROPER_NOUN_MID.test(" " + t)) return true;           // "St Anne's Hall", "Southwark Council"
  return kind === "h" || kind === "li" || kind === "row";   // headings/list items/rows are structure
}
```

**Cross-document dedupe** replaces today's first-appearance-wins rule (`:256-261`), which keeps
whichever page's navigation was crawled first and deletes the same text everywhere else. The new
rule is frequency-based and runs **after** all documents are collected:

```ts
// A line appearing on >= 3 documents (or >= 40% of them) is site chrome. A line
// appearing once or twice is content that happens to repeat.
export function dropChrome(docs: Array<{ url: string; lines: DocLine[] }>): void {
  const freq = new Map<string, number>();
  for (const d of docs) for (const k of new Set(d.lines.map((l) => l.t.toLowerCase().slice(0, 120)))) {
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const cut = Math.max(3, Math.ceil(docs.length * 0.4));
  for (const d of docs) d.lines = d.lines.filter((l) => (freq.get(l.t.toLowerCase().slice(0, 120)) ?? 0) < cut);
}
```

**JSON-LD is a real recovery path, not a curiosity.** A Squarespace/Wix charity site that renders
its text in JavaScript still ships `Organization`, `Person`, `Event` and `PostalAddress` objects in
`application/ld+json` — legal name, address, founding date, named events with dates and venues.
Flattened into `kind:"meta"` lines with a `jsonld:` prefix, these are typed proper nouns obtained
without a browser. This is the honest answer to "JS-only" for perhaps a third of such sites; the
other two thirds are `js_only` and are recorded as such (§9).

---

## 7. PDF extraction inside a Deno edge function — what is actually feasible

### 7.1 The honest position

The worker already loads npm packages through `npm:` specifiers at module scope — `docx@8.5.0`,
`xlsx@0.18.5`, `marked@18.0.10`, `fflate@0.8.2` (`:32-37`). PDF **text-layer** extraction is the
same class of problem as `docx` unzipping, and it is feasible in this runtime. What is *not*
feasible is stated first, because it determines the fallbacks:

| Capability | Feasible in a Deno edge function, no new services? | Decision |
|---|---|---|
| Text-layer extraction (born-digital PDF) | **Yes** — pdfjs runs; no canvas needed for `getTextContent()` | Ship it |
| Layout-aware line/column reconstruction from text-item coordinates | **Yes** — pure arithmetic over `getTextContent().items[].transform` | Ship it; this is what makes accounts tables usable |
| Encrypted / password-protected PDFs | No (and we would not) | `extraction_failed:encrypted` |
| Scanned, image-only PDFs (OCR) | **No.** Tesseract-wasm is a 10 MB+ binary plus per-page seconds of CPU inside a 150 s slice; and no new services are permitted | `extraction_failed:image_only` — the document is dropped, honestly and visibly |
| Full table-structure recovery (merged cells, spanning headers) | Partially — column detection by x-gap clustering is good; merged cells are not recovered | Emit rows as `a | b | c`; never assert a total we did not read |
| Embedded fonts with broken/absent ToUnicode maps | Sometimes — output is mojibake | Detected and rejected (§7.3) |

Two other real constraints, stated rather than discovered later:

- **Bundle size and cold start.** pdfjs is large. The import is therefore **lazy and dynamic**, so
  an order whose site has no PDF never pays for it, and the first PDF of an invocation pays once.
- **Memory.** A 12 MB PDF plus pdfjs's page objects is the largest allocation in the worker.
  `MAX_PDF_BYTES` (12 MB) and `MAX_PDF_PAGES` (60) exist for that reason, not for politeness.

### 7.2 The code

```ts
// ================= harvest: PDF text =================
// Lazy, cached, and dual-sourced. `unpdf` is a serverless-targeted repackaging of
// pdfjs (no canvas, no worker thread); pdfjs-dist's legacy build is the fallback.
// Which one loads is recorded on the document row, because a future breakage
// will show up there first.
// deno-lint-ignore no-explicit-any
let PDFLIB: { getDocument: (d: any) => any; via: string } | null = null;
async function pdfLib() {
  if (PDFLIB) return PDFLIB;
  try {
    const m = await import("npm:unpdf@0.12.1");
    PDFLIB = { getDocument: (d) => m.getDocumentProxy(d), via: "unpdf" };
  } catch {
    const m = await import("npm:pdfjs-dist@4.7.76/legacy/build/pdf.mjs");
    // deno-lint-ignore no-explicit-any
    (m as any).GlobalWorkerOptions.workerSrc = "";        // main-thread parse: no worker in edge
    PDFLIB = { getDocument: (d) => m.getDocument({ data: d, useSystemFonts: false, isEvalSupported: false }).promise, via: "pdfjs" };
  }
  return PDFLIB;
}

export type PdfStatus = "ok" | "partial" | "encrypted" | "image_only" | "garbled" | "parse_failed";
export interface PdfText { pages: Array<{ page: number; lines: string[] }>; status: PdfStatus; via: string; pageCount: number }

export async function pdfToLines(bytes: Uint8Array, maxPages = HARVEST.MAX_PDF_PAGES, beat?: () => void): Promise<PdfText> {
  let lib: Awaited<ReturnType<typeof pdfLib>>;
  try { lib = await pdfLib(); } catch { return { pages: [], status: "parse_failed", via: "none", pageCount: 0 }; }
  // deno-lint-ignore no-explicit-any
  let doc: any;
  try {
    doc = await lib.getDocument(bytes);
  } catch (e) {
    const msg = String((e as Error)?.name ?? e);
    return { pages: [], status: /Password/i.test(msg) ? "encrypted" : "parse_failed", via: lib.via, pageCount: 0 };
  }
  const pageCount = Number(doc.numPages ?? 0);
  const take = Math.min(pageCount, maxPages);
  const pages: PdfText["pages"] = [];
  let glyphs = 0;
  for (let i = 1; i <= take; i++) {
    if (i % 5 === 0) beat?.();                       // a 60-page report outruns the reaper otherwise
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const lines = layoutLines(tc.items as PdfItem[]);
      glyphs += lines.reduce((a, l) => a + l.length, 0);
      if (lines.length) pages.push({ page: i, lines });
    } catch { /* one bad page must not lose the other 59 */ }
  }
  try { await doc.cleanup?.(); await doc.destroy?.(); } catch { /* noop */ }

  if (!glyphs) return { pages: [], status: "image_only", via: lib.via, pageCount };
  if (garbled(pages)) return { pages: [], status: "garbled", via: lib.via, pageCount };
  return { pages, status: take < pageCount ? "partial" : "ok", via: lib.via, pageCount };
}

interface PdfItem { str: string; transform: number[]; width?: number; hasEOL?: boolean }

// Group text items into visual lines by baseline y, order by x, and turn a wide
// horizontal gap into a column separator. This is what recovers
//   "Youth programme | 41 | £128,400"
// from an accounts table — the single most valuable shape in the whole crawl.
export function layoutLines(items: PdfItem[]): string[] {
  const rows = new Map<number, PdfItem[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round((it.transform?.[5] ?? 0) / 2) * 2;      // 2pt baseline tolerance
    (rows.get(y) ?? rows.set(y, []).get(y)!).push(it);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a);             // PDF origin is bottom-left
  const out: string[] = [];
  for (const y of ys) {
    const row = rows.get(y)!.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0));
    let line = "";
    let prevEnd = -1;
    for (const it of row) {
      const x = it.transform?.[4] ?? 0;
      const w = it.width ?? it.str.length * 4;
      if (prevEnd >= 0) {
        const gap = x - prevEnd;
        line += gap > 24 ? " | " : gap > 2.5 ? " " : "";         // 24pt gap ⇒ column boundary
      }
      line += it.str;
      prevEnd = x + w;
    }
    const t = line.replace(/\s+/g, " ").replace(/\s*\|\s*/g, " | ").trim();
    if (t) out.push(t.slice(0, 600));
  }
  return out;
}

// A ToUnicode-less embedded font yields high-entropy junk that reads as text to a
// length check and as gibberish to a model. Cheap deterministic detector.
function garbled(pages: PdfText["pages"]): boolean {
  const sample = pages.flatMap((p) => p.lines).join(" ").slice(0, 4000);
  if (sample.length < 200) return false;
  const letters = (sample.match(/[a-zA-Z؀-ۿ]/g) ?? []).length;
  const vowels = (sample.match(/[aeiouAEIOUاوي]/g) ?? []).length;
  const spaces = (sample.match(/ /g) ?? []).length;
  return letters / sample.length < 0.5 || vowels / Math.max(1, letters) < 0.12 || spaces / sample.length < 0.06;
}
```

### 7.3 Fallback ladder when a PDF cannot be parsed

1. **`partial`** (page cap hit): keep what parsed, mark the document `partial`, record
   `pages_read`/`page_count`. Ledger items carry the page number, so a claim from page 7 of a
   60-page report is still exactly located.
2. **`garbled` / `image_only` / `encrypted` / `parse_failed`**: no text, no evidence, no voice.
   The document row is kept with its `extract_status`, so a re-crawl does not retry it and the
   customer-visible coverage note can say *"we could not read `annual-report-2024.pdf` (scanned
   image)"*.
3. **Is there an HTML equivalent?** Before giving up, the frontier is checked for a sibling URL
   with the same slug and an HTML content type (`/reports/annual-2024` next to
   `/reports/annual-2024.pdf`); many CMSes publish both. Score-boosted and fetched. Cheap, and it
   recovers a good fraction of image-only cases.
4. **Never**: no OCR service, no third-party extraction API, no "send the PDF to the model as an
   image". The last one deserves an explicit refusal: multimodal extraction of a scanned report
   would produce claims with no verifiable text layer to anchor a quote against (§8.3), so it
   would break the one mechanism that makes deep crawling safe. Cost is real and accepted.

---

## 8. From documents to typed ledger items

### 8.1 The item shape — additive, so nothing downstream breaks

Every existing consumer reads `{id, claim, source_type, source_ref, status, allowed, date_context,
time_sensitive}` (`:1322-1327`, `:1198`, `:1674`). All of those survive unchanged and keep their
meanings. The new fields are additions:

```ts
export type EvidenceKind =
  | "org_fact" | "programme" | "location" | "venue" | "partner" | "funder" | "funding"
  | "result" | "person" | "asset" | "cost" | "policy" | "accreditation"
  | "beneficiary_count" | "schedule" | "governance";

export interface EvidenceItem {
  // ---- unchanged contract ----
  id: string;                       // E-WEB-n (html) | E-DOC-n (pdf) | E-INTAKE-n | E-PROP-n
  claim: string;                    // one English sentence, <= 300 chars, as today
  source_type: "organisation_website" | "organisation_document" | "user_intake" | "previous_proposal";
  source_ref: string;               // page URL or document URL
  status: "verified" | "historical" | "undated";
  time_sensitive: boolean;
  date_context: string | null;
  allowed: boolean;                 // FINALLY load-bearing: see §8.4
  // ---- new ----
  kind: EvidenceKind;
  subject: string;                  // the entity the claim is ABOUT, copied from the document
  actor_is_applicant: boolean;      // deterministic verdict, not the model's opinion
  entities: {
    people?: string[]; orgs?: string[]; places?: string[]; venues?: string[];
    programmes?: string[]; money?: string[]; dates?: string[];
  };
  value?: { n?: number; unit?: string; currency?: string; period?: string };
  quote: string;                    // VERBATIM from the document, <= 240 chars
  locator: { doc_id: string; url: string; page?: number; line?: number };
  confidence: "quoted" | "derived";
  disallow_reason?: string;         // why allowed=false, for the audit trail
}
```

`entities` is the field that makes the whole exercise mean something: for the first time a
downstream stage can *ask* "what venues does this organisation have evidence for", and the
validate stage can check a proper noun in the narrative against a set instead of against prose
(§12.2).

### 8.2 Extraction — per document, batched, grant-aware

One call per PDF (they are long and each has its own provenance), and HTML pages batched to
~18 k characters per call, preserving `--- DOC <id> :: <url> ---` fences so the model can attribute
every claim to a document. The prompt keeps the existing extraction rules verbatim where they
already work (`:1310-1319`) and adds the typing, the quote and the subject:

```ts
const EXTRACT_PROMPT = (applicant: string, grantTerms: string[], corpus: string) =>
  `Below is text from documents published on ONE organisation's own website. Extract FACTS. Reply strict JSON only:\n` +
  `{"document_subject":{"<doc_id>":{"organisation":string|null,"is_about_applicant":true|false|null}},` +
  `"items":[{"doc_id":string,"page":number|null,"kind":"org_fact|programme|location|venue|partner|funder|funding|result|person|asset|cost|policy|accreditation|beneficiary_count|schedule|governance",` +
  `"subject":string,"claim":string,"quote":string,"date_context":string|null,"status":"current"|"historical"|"undated","time_sensitive":boolean,` +
  `"entities":{"people":[string],"orgs":[string],"places":[string],"venues":[string],"programmes":[string],"money":[string],"dates":[string]},` +
  `"value":{"n":number|null,"unit":string|null,"currency":string|null,"period":string|null}}]}\n` +
  `The applicant is: ${applicant}\n` +
  `Rules (strict):\n` +
  `- quote: copy the sentence or table row VERBATIM from the text, character for character, max 240 chars. An item whose quote is not found in the source text is DISCARDED automatically, so never paraphrase a quote, never merge two sentences, never fix a typo.\n` +
  `- subject: the organisation or person the claim is ABOUT, exactly as the document names it. If a partner delivered the work, the subject is the partner, not the applicant. Never assume the subject is the applicant.\n` +
  `- claim: one plain sentence. Copy faithfully — never strengthen, total up, average, extrapolate, or convert a currency.\n` +
  `- PREFER the specific over the general. A named venue, a named partner, a named town, a dated cohort number, a real unit cost, a named staff member with a role, a named accreditation, a session day and time — each of these is worth more than any statement of mission. Vague mission language is NOT evidence; skip it entirely.\n` +
  `- Table rows and list items are first-class: extract them, keeping the row verbatim as the quote.\n` +
  `- Do not infer. If the document does not state it, it does not exist.\n` +
  `- The funder for this application cares about: ${grantTerms.join(", ")}. Facts touching those topics are higher priority, but never invent one to satisfy them.\n\n` +
  `${U_OPEN}${corpus}${U_CLOSE}`;
```

### 8.3 The quote-anchor check — the deterministic anti-hallucination gate

Every item's `quote` must be findable in the stored text of the document it claims to come from.
This is checked in code, not by a model, and it is the mechanism that makes it safe to ask for
specificity:

```ts
function normQ(s: string): string {
  return s.toLowerCase()
    .replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9£$€%'".,;:|\-\/؀-ۿ ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
export function verifyQuote(quote: string, docText: string): boolean {
  const q = normQ(quote);
  if (q.length < 12) return false;                      // too short to anchor anything
  return normQ(docText).includes(q);
}
```

Strict substring after normalisation. No fuzzy matching, no token-overlap threshold, no second
chance: an item whose quote does not verify is dropped with `disallow_reason:"quote_not_found"`
and counted on the run. The prompt warns the model that this happens, which in practice pushes it
toward copying. The cost of strictness is losing some correct-but-reworded items; the benefit is
that **no item can enter the ledger without a verbatim string that exists in a document we
fetched, whose URL, page and line we recorded**. That trade is the right way round.

### 8.4 Where `allowed:false` finally does work

Today `allowed:false` is never set (`grep`: only `allowed:true` at `:1274-1276`, `:1326`, `:1403`)
and the filter at `:1198` is dead code. Under this design it is set constantly and means exactly
one thing: *this item is real and was extracted, but it may not be used as a fact about the
applicant*. Disallowed items stay in `org_intel.evidence` with their reason. They are excluded
from generation prompts (`:1198` starts working) and **included** in the Claim Ledger auditor's
input, so the auditor can tell "no evidence exists" apart from "evidence exists but is about
somebody else" — a distinction it cannot currently draw.

---

## 9. The identity gate across many documents

This is where the design can do the most damage if it is wrong, so it is built as four gates in
series. **Evidence must pass all four.** Each records what it discarded.

### G0 — Domain custody (deterministic, harvest)

`inScope()` (§2), plus the off-scope redirect drop. No document from outside the applicant's own
space is ever fetched, so no third-party document can reach extraction at all. This is the owner's
"own domain only" rule, mechanised.

### G1 — Does this domain belong to this applicant? (once per domain)

Today: `orgNameMatchesSite(orgName, profile.legal_name, domain)` (`:447-460`), on one LLM-extracted
`legal_name` plus the domain string. It stays, unchanged, as one of four signals. Three signals
that already exist in the order row and are currently unused are added, and each of them is a
*strong* identifier, so the gate becomes more able to say yes without becoming any more willing to
guess:

```ts
export type IdentityConfidence = "conclusive" | "strong" | "weak" | "none";

const FREE_MAIL = new Set(["gmail.com","googlemail.com","yahoo.com","hotmail.com","outlook.com",
  "live.com","icloud.com","aol.com","proton.me","protonmail.com","yandex.com","mail.com","gmx.com","qq.com","163.com"]);

// A registration number printed on the site, NEAR a registration keyword, is the
// strongest identity signal available anywhere in this system: it is issued by a
// regulator, it is unique, and a stranger's site will not carry it.
function regNumberOnSite(reg: string | null, corpus: string): boolean {
  if (!reg) return false;
  const norm = reg.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (norm.replace(/\D/g, "").length < 5) return false;          // too short to be distinctive
  const hay = corpus.replace(/[^0-9A-Za-z]/g, " ").toUpperCase();
  const idx = hay.indexOf(" " + norm + " ");
  if (idx < 0) return false;
  const window = hay.slice(Math.max(0, idx - 80), idx + norm.length + 40);
  return /CHARIT|COMPANY|REGISTERED|REGISTRATION|CIC|NPO|NGO|SIREN|EIN|ABN|VAT|NO\b/.test(window);
}

export function identityConfidence(a: {
  orgName: string; reg: string | null; orderEmail: string; domain: string;
  siteLegalName: unknown; corpus: string;
}): { level: IdentityConfidence; signals: string[] } {
  const sig: string[] = [];
  if (regNumberOnSite(a.reg, a.corpus)) sig.push("registration_number_on_site");
  const emailDomain = normDomain(a.orderEmail.split("@")[1] ?? "");
  if (emailDomain && !FREE_MAIL.has(emailDomain) &&
      (emailDomain === a.domain || registrable(emailDomain) === registrable(a.domain))) sig.push("order_email_domain");
  if (orgNameMatchesSite(a.orgName, a.siteLegalName, a.domain)) sig.push("name_or_domain_token");
  // Name stated verbatim in the site text, not just a shared token.
  const wanted = normQ(a.orgName);
  if (wanted.length > 8 && normQ(a.corpus).includes(wanted)) sig.push("exact_name_in_text");

  const strongCount = sig.filter((s) => s === "registration_number_on_site" || s === "order_email_domain").length;
  if (strongCount >= 1 && sig.length >= 2) return { level: "conclusive", signals: sig };
  if (strongCount >= 1) return { level: "strong", signals: sig };
  if (sig.includes("name_or_domain_token") && sig.includes("exact_name_in_text")) return { level: "strong", signals: sig };
  if (sig.length) return { level: "weak", signals: sig };
  return { level: "none", signals: sig };
}
```

**Thresholds, and they are deliberately unequal:**

| Level | HTML page evidence | PDF/report evidence | Voice guide | Profile |
|---|---|---|---|---|
| `conclusive` | admitted | admitted | admitted | admitted |
| `strong` | admitted | admitted | admitted | admitted |
| `weak` | **discarded** | **discarded** | discarded | discarded |
| `none` | **discarded** | **discarded** | discarded | discarded |

`weak` behaves exactly as a mismatch does today (`:1341-1360`): everything from the site is
emptied and one gap is written. In other words the new signals can only *rescue* a site that
today's gate would already have admitted or that carries regulator-grade proof; nothing that
today's gate rejects is admitted on weaker grounds than today. The asymmetry is preserved by
construction, and the B1 case (`:416-432`) still rejects: `amel.org` carries no Beit Al-Shabab
registration number, no matching email domain, no name token and no verbatim name.

One deliberate tightening: because the deep crawl reaches documents that are *much* more damaging
when misattributed (a 40-page annual report full of another charity's dated results), a site at
`strong` but not `conclusive` still admits PDFs — but every PDF must independently pass G2 with a
first-party anchor **inside that PDF**, not inherited from the site. A report that never names the
applicant is not evidence about the applicant, whatever the domain says.

### G2 — Per-document attribution

The new risk that multi-document crawling introduces: documents legitimately hosted on the
customer's own domain that are *about somebody else*. Real cases, all common:

- a funder's or partner's annual report uploaded to `/downloads/`;
- a consortium evaluation naming six delivery organisations;
- a network member's case study on an umbrella body's site;
- a hosted charity's accounts on its host's domain;
- "our funders" and "who we work with" pages, which are lists of other organisations' names.

```ts
export type Attribution = "first_party" | "mixed" | "third_party" | "unknown";

// Anchors are searched over the doc's RAW text — title, header, footer, copyright
// line included — which is why raw text is stored BEFORE cross-document chrome
// dedupe (§6). The footer copyright line is very often the only place a small
// charity states its own legal name and number.
export function documentAttribution(a: {
  rawText: string; orgName: string; reg: string | null; domain: string;
  modelSubject: string | null; modelIsApplicant: boolean | null;
}): { verdict: Attribution; reasons: string[] } {
  const reasons: string[] = [];
  const nameHit = normQ(a.rawText).includes(normQ(a.orgName)) && a.orgName.length > 6;
  const tokenHit = (() => {
    const want = orgTokens(a.orgName), have = orgTokens(a.rawText.slice(0, 40_000));
    for (const t of want) if (have.has(t)) return true;
    return false;
  })();
  const regHit = regNumberOnSite(a.reg, a.rawText);
  const domainHit = a.rawText.toLowerCase().includes(a.domain);
  if (nameHit) reasons.push("name_verbatim");
  if (regHit) reasons.push("reg_number");
  if (domainHit) reasons.push("domain_mention");
  if (tokenHit) reasons.push("name_token");

  const anchored = nameHit || regHit || (domainHit && tokenHit);
  const subjectIsOther = a.modelSubject != null && a.modelIsApplicant === false;

  if (!anchored) { reasons.push("no_first_party_anchor"); return { verdict: "unknown", reasons }; }
  if (subjectIsOther) { reasons.push("model_subject_other_org"); return { verdict: "third_party", reasons }; }
  if (a.modelIsApplicant === true && (nameHit || regHit)) return { verdict: "first_party", reasons };
  return { verdict: "mixed", reasons };
}
```

Consequences, and this is the conservative part:

| Verdict | Evidence | Voice | Profile |
|---|---|---|---|
| `first_party` | all items eligible, subject to G3 | yes | yes |
| `mixed` | **only** items whose `quote` itself carries a first-party anchor, or whose `kind` is `partner`/`funder` and whose claim is framed as the applicant's relationship | yes | no |
| `third_party` | none | no | no |
| `unknown` | none | no | no |

A `mixed` document is where the gold is — an annual report is *always* mixed, because it names
funders, partners and boroughs on every page. Blanket-dropping `mixed` would throw away the entire
point of the exercise, so the gate moves down a level rather than off a cliff: the unit becomes the
**claim**, not the document.

### G3 — Per-claim actor

```ts
export function claimAllowed(
  it: { subject: string; quote: string; kind: EvidenceKind; entities: EvidenceItem["entities"] },
  applicant: string, docAttr: Attribution,
): { allowed: boolean; reason: string } {
  if (docAttr === "third_party" || docAttr === "unknown") return { allowed: false, reason: "document_" + docAttr };
  const want = orgTokens(applicant);
  const subj = orgTokens(it.subject);
  let subjectMatches = false;
  for (const t of subj) if (want.has(t)) subjectMatches = true;
  if (!subj.size && /^(we|us|our|the (charity|organisation|organization|trust|team))$/i.test(it.subject.trim())) {
    subjectMatches = true;                                    // first-person subject in a first-party doc
  }
  if (subjectMatches) return { allowed: true, reason: "subject_is_applicant" };

  // Not the applicant's own action. It may still be a TRUE FACT ABOUT THE
  // APPLICANT'S RELATIONSHIPS, but only when the applicant appears in the same
  // sentence — "delivered with Southwark Council" is evidence of a partnership;
  // "Southwark Council spent £2m on youth services" is not our customer's fact.
  const quoteHasApplicant = orgTokens(it.quote).size > 0 &&
    [...orgTokens(it.quote)].some((t) => want.has(t));
  if ((it.kind === "partner" || it.kind === "funder") && quoteHasApplicant) {
    return { allowed: true, reason: "relationship_with_applicant_in_quote" };
  }
  return { allowed: false, reason: "actor_not_applicant" };
}
```

### 9.5 Exactly where this design chooses to lose evidence

Stated plainly, because "we lose nothing" would be a lie:

1. **Anything off the applicant's own domain.** Regulator filings, funder announcements, press
   coverage, a partner's write-up of a joint project. Owner's decision; it is also what keeps G1
   meaningful.
2. **Documents with no first-party anchor** (`unknown`). A perfectly genuine "Our Impact 2024"
   page that never names the organisation in title, body or footer contributes nothing. Mitigated
   by searching raw text including `<title>` and footer, which catches the large majority; the
   residual loss is real and accepted.
3. **Claims whose actor is another organisation**, even in a first-party document — unless the
   applicant is named in the same quote and the item is a relationship. Loses genuine context
   ("the borough has 4,000 unemployed young people" is dropped as an applicant fact; it may still
   be used as *grant-side* context by the analyze stage, which has its own sourcing).
4. **Every item whose quote does not verify verbatim** (§8.3). Loses correct paraphrases.
5. **Scanned/image-only, encrypted, garbled PDFs** (§7.3). This is the biggest single loss: on
   small-charity sites a real share of annual reports are scans. Nothing legitimate can be done
   about it inside these constraints, and inventing something from a scan we could not read is
   precisely the outcome the owner calls worst.
6. **robots-disallowed paths**, including cases where a platform's default robots blocks
   `/downloads/` and therefore every report.
7. **Everything, when G1 lands at `weak` or `none`** — unchanged from today's whole-site discard.
8. **Anything beyond depth 3 or past a budget cap.** A large site's fifth-most-valuable report is
   not read.

Every one of these is counted per run (§10, `crawl_runs.discarded`), so the loss is measurable
rather than folkloric, and a monitoring query can show whether gate 2 or gate 3 is eating more
than expected.

---

## 10. Failure taxonomy — replacing the silent zero

Today four distinct failures all end as "zero evidence, no error": bad/absent website
(`:408-409`), `unreachable` (`:232`), zero qualifying pages (`:1332` — the thefelixproject.org
case), identity mismatch (`:1342`). Under this design every terminal state has a code, a row, and
a defined consequence.

| Code | Meaning | Recorded on | Consequence for the order |
|---|---|---|---|
| `ok` | crawl completed within budget | `crawl_runs.outcome` | normal |
| `ok_partial` | completed, but a budget cap or the yield cap truncated it | run + `truncated_by` | normal; coverage note names what was skipped |
| `no_website` | no valid URL supplied (`:409` shape check) | run | gap `non_critical`; intake answers carry the order |
| `bad_url` / `dns_unresolved` | URL malformed, or host does not resolve | run + `error_detail` | gap `important`; customer told the address did not resolve |
| `blocked_private` | `SsrfError` — resolves to a private range | run | gap `important`; never retried |
| `offsite_redirect` | seed leaves scope and the destination fails the name check (§2) | run | **zero web evidence**; gap `important` |
| `robots_disallowed` | robots forbids the seed path or the whole site | run + `robots_rule` | zero web evidence; order page states the exact rule from their own robots.txt |
| `robots_fetch_failed` | robots persistently 5xx/timeout ⇒ RFC 9309 full disallow | run | as above |
| `blocked_bot` | 403/429 storm or WAF challenge page | run + `blocked_status`, `blocked_url` | zero or partial evidence; **operator alert** (§B notifier of the sibling design) because a cluster means our UA is on a blocklist |
| `js_only` | HTML fetched, < 400 visible chars, SPA markers present, no usable JSON-LD | run + per-doc | zero or thin evidence; gap `important` |
| `fetch_failed` | seed reachable but every candidate 4xx/5xx/timeout | run + counts | gap `important` |
| `extraction_failed` (per doc: `encrypted`, `image_only`, `garbled`, `parse_failed`) | document fetched, no text | `crawl_docs.extract_status` | that document contributes nothing; named in the coverage note |
| `nothing_relevant_found` | documents read, but zero items survived §8.3/G2/G3 | run + `discarded` breakdown | gap `important`; distinct from the classes above — *we read the site and it says nothing concrete* |
| `identity_weak` / `identity_none` | G1 below `strong` | run + `identity` | whole-site discard (today's behaviour), gap `important` |
| `busy` | another live crawl holds the domain lock (§1.1) | run | stage yields once and reuses fresh rows |
| `budget_exhausted` | fetch/byte/page cap hit before the frontier emptied | run + `truncated_by` | same as `ok_partial` |
| `yield_cap` | 40 yields without completing (`yield_stage`) | job_stages | stage `failed` → existing terminal notifier |

**Nothing in this table blocks delivery.** The Claim Ledger blocks delivery when a *material
unsupported claim* survives (`:1703`, `:1710-1719`), and a thin ledger produces the honest
empty-ledger branch (`:1207`), not a fabricated one. What the taxonomy changes is that thinness
now has a *name*, which is what makes the quality-drift monitoring gap (launch report P1 #8)
addressable at all: `nothing_relevant_found` rising week over week is a signal no validator can
give, because every one of those proposals passes every validator.

Two of these codes reach a human — but never in the customer's path: `blocked_bot` clustering and
`extraction_failed` clustering raise an operator alert through the existing notifier, because they
mean *our crawler* is broken, not the customer's order. The order proceeds regardless.

---

## 11. DDL

```sql
-- 2026XXXXXXXXXX_deep_own_domain_crawl.sql   (design only — NOT applied here)

-- One row per crawl attempt. The audit trail for every decision in §9 and §10.
create table if not exists public.crawl_runs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  proposal_id     uuid,                       -- order_proposals.id, nullable for refreshes
  domain          text not null,
  seed_url        text not null,
  scope           jsonb not null default '{}'::jsonb,   -- {kind,host,registrable,pathPrefix}
  robots          jsonb not null default '{}'::jsonb,   -- {verdict,crawl_delay_ms,rule,sitemaps:n}
  identity        jsonb not null default '{}'::jsonb,   -- {level,signals[]}
  counters        jsonb not null default '{}'::jsonb,   -- {fetched,html,pdf,bytes,404,redirects,ms,slices}
  discarded       jsonb not null default '{}'::jsonb,   -- {offsite,robots,quote_not_found,g2_unknown,g2_third_party,g3_actor,budget}
  outcome         text not null default 'running',      -- §10 code
  error_detail    text,
  truncated_by    text,                                  -- 'html_cap'|'pdf_cap'|'bytes'|'deadline'|'yield'
  cost_usd        numeric,
  status          text not null default 'running',       -- running|done  (the §1.1 lock lives on this)
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
alter table public.crawl_runs enable row level security;
create unique index if not exists crawl_runs_one_live_per_domain
  on public.crawl_runs (domain) where status = 'running';
create index if not exists crawl_runs_org on public.crawl_runs (organisation_id, started_at desc);

-- One row per document ever fetched. Page-level provenance, the conditional-GET
-- cache, and the per-document extraction cache all live here.
create table if not exists public.crawl_docs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  url             text not null,
  url_hash        text not null,                        -- sha256(url), for the unique index
  doc_type        text not null,                        -- 'html'|'pdf'|'jsonld'
  title           text,
  depth           smallint not null default 0,
  discovered_from text,
  score           integer not null default 0,
  http_status     smallint,
  content_type    text,
  bytes           integer,
  etag            text,
  last_modified   text,
  content_hash    text,                                 -- sha256 of extracted text
  text            text,                                 -- extracted, capped at PER_DOC_CHARS
  raw_text        text,                                 -- pre-chrome-dedupe, for G2 anchors (capped 40k)
  page_count      smallint,
  pages_read      smallint,
  extract_status  text not null default 'ok',           -- ok|partial|encrypted|image_only|garbled|parse_failed|js_only|empty
  extract_via     text,                                 -- 'html'|'unpdf'|'pdfjs'|'jsonld'
  attribution     text,                                 -- first_party|mixed|third_party|unknown
  attribution_reasons jsonb not null default '[]'::jsonb,
  extracted       jsonb,                                -- cached typed items from this doc
  extracted_at    timestamptz,
  fetched_at      timestamptz not null default now()
);
alter table public.crawl_docs enable row level security;
create unique index if not exists crawl_docs_org_url on public.crawl_docs (organisation_id, url_hash);
create index if not exists crawl_docs_org_score on public.crawl_docs (organisation_id, score desc);

-- org_intel gains a harvest summary. Existing columns untouched.
alter table public.org_intel
  add column if not exists harvest jsonb not null default '{}'::jsonb,   -- {outcome,docs,pdfs,items,discarded,identity,ms}
  add column if not exists harvest_version text;

-- Domain lock for §1.1. Returns the run id, or null when another run holds it.
create or replace function public.try_begin_crawl(
  p_org uuid, p_proposal uuid, p_domain text, p_seed text, p_scope jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- a run whose isolate died is not a lock: 10 minutes is 4x the reaper window
  update public.crawl_runs set status = 'done', outcome = coalesce(nullif(outcome,'running'),'yield_cap'),
         finished_at = now()
   where domain = p_domain and status = 'running' and started_at < now() - interval '10 minutes';
  insert into public.crawl_runs (organisation_id, proposal_id, domain, seed_url, scope)
  values (p_org, p_proposal, p_domain, p_seed, p_scope)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  return null;                      -- another live crawl owns this domain
end $$;

create or replace function public.finish_crawl(
  p_run uuid, p_outcome text, p_counters jsonb, p_discarded jsonb,
  p_identity jsonb, p_robots jsonb, p_truncated text, p_error text, p_cost numeric
) returns void language sql security definer set search_path = '' as $$
  update public.crawl_runs
     set outcome = p_outcome, counters = p_counters, discarded = p_discarded,
         identity = p_identity, robots = p_robots, truncated_by = p_truncated,
         error_detail = p_error, cost_usd = p_cost, status = 'done', finished_at = now()
   where id = p_run;
$$;

revoke all on function public.try_begin_crawl(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.finish_crawl(uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,numeric) from public, anon, authenticated;
grant execute on function public.try_begin_crawl(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.finish_crawl(uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,numeric) to service_role;

comment on table public.crawl_runs is 'One row per own-domain crawl attempt: scope, robots verdict, identity confidence, budget counters, discard counts, terminal outcome code. Service-role only.';
comment on table public.crawl_docs is 'One row per document fetched from an applicant own domain: extracted text, page-level provenance, attribution verdict, conditional-GET validators, cached typed extraction. Service-role only.';
```

`job_stages.progress` (from `design-resumability-and-alerts.md` §A.1) carries the frontier, so the
`harvest` stage needs no table of its own for resumption:

```jsonc
{
  "run_id": "…uuid…",
  "crawl_run": "…uuid…",
  "scope": { "kind": "domain", "host": "hopewelltrust.org.uk", "registrable": "hopewelltrust.org.uk", "pathPrefix": "/" },
  "robots": { "verdict": "rules", "crawlDelayMs": 1000, "sitemaps": ["…"] },
  "frontier": [ { "url": "…", "depth": 2, "score": 26, "via": "…", "type": "pdf" } ],   // capped at 400, best-first
  "seen": ["a1b2c3d4", …],                                                             // 8-char url hashes, capped 3000
  "counters": { "fetched": 21, "html": 17, "pdf": 3, "bytes": 5_200_100, "ms": 141_000 },
  "phase": "fetch" | "extract" | "assemble"
}
```

Document text lives in `crawl_docs`, not in `progress`, so the checkpoint stays a few kilobytes
regardless of how much has been crawled.

---

## 12. The driver, and how it yields

```ts
// ================= harvest stage =================
if (stage.key === "harvest") {
  const identity = identityCheck(c.order.org_name, c.order.org_website, c.order.org_reg);   // :392-413, unchanged
  if (!identity.website) {
    return done({ outcome: "no_website", docs: 0, items: 0,
      gaps: [{ gap: "no valid organisation website supplied", severity: "non_critical" }] });
  }
  const seed = new URL(/^https?:\/\//.test(identity.website) ? identity.website : `https://${identity.website}`);
  const scope = scopeFor(seed);
  const grantTerms = grantTermsFrom(analysis);
  const p = (await sel(`job_stages?id=eq.${stage.stage_id}&select=progress`))[0]?.progress ?? {};

  // ---- first slice only: lock the domain, read robots, seed the frontier ----
  let crawlRun: string | null = p.crawl_run ?? null;
  let robots: RobotsRules = p.robots ?? null;
  let frontier: FrontierItem[] = p.frontier ?? [];
  const seen = new Set<string>(p.seen ?? []);
  const counters = p.counters ?? { fetched: 0, html: 0, pdf: 0, bytes: 0, ms: 0, slices: 0 };

  if (!crawlRun) {
    crawlRun = await rpc("try_begin_crawl", {
      p_org: c.order.organisation_id, p_proposal: stage.proposal_id,
      p_domain: scope.host, p_seed: seed.toString(), p_scope: scope });
    if (!crawlRun) {                       // §1.1 — someone else owns this domain right now
      await commit({ backoff_until: Date.now() + 30_000 });
      throw new YieldSignal("harvest:busy");
    }
    robots = await readRobots(scope, port);                       // §4
    if (robots.verdict === "disallow_all" || !robotsAllows(robots, seed.pathname).ok) {
      await rpc("finish_crawl", { p_run: crawlRun, p_outcome: "robots_disallowed", … });
      return done({ outcome: "robots_disallowed", robots_rule: robotsAllows(robots, seed.pathname).rule, docs: 0, items: 0 });
    }
    frontier = await seedFrontier(seed, scope, robots, grantTerms, port);   // §3.1
    await commit({ crawl_run: crawlRun, scope, robots, frontier, seen: [], counters, phase: "fetch" });
  }

  const pacer = new HostPacer(Math.max(HARVEST.MIN_GAP_MS, robots.crawlDelayMs));

  // ---- fetch phase: one document per loop, checkpointed after each ----
  while (frontier.length && counters.html < HARVEST.MAX_HTML) {
    const next = frontier[0];
    const cost = next.type === "pdf" ? HARVEST.PDF_COST_MS : HARVEST.FETCH_COST_MS;
    if (wouldOverrun(cost)) {                                      // sibling design §A.2
      await commit({ frontier, seen: [...seen], counters, phase: "fetch" });
      await rpc("yield_stage", { p_stage: stage.stage_id, p_run: runId, p_advanced: counters.fetched > 0 });
      throw new YieldSignal("harvest:fetch");
    }
    frontier.shift();
    const doc = await fetchOne(next, { scope, robots, pacer, port, orgId: c.order.organisation_id });
    counters.fetched++; counters.ms = Date.now() - stageStart;
    if (doc?.kind === "html") {
      counters.html++; counters.bytes += doc.bytes;
      // re-discovery: the loop at :249-265 never did this, which is why depth was 1
      for (const f of discoverFrom(doc, next.depth + 1, scope, robots, grantTerms, seen)) pushScored(frontier, f);
    } else if (doc?.kind === "pdf") { counters.pdf++; counters.bytes += doc.bytes; }
    seen.add(shortHash(next.url));
    await commit({ frontier: frontier.slice(0, 400), seen: [...seen].slice(-3000), counters, phase: "fetch" });
    if (counters.bytes > HARVEST.MAX_TOTAL_BYTES || counters.fetched >= HARVEST.MAX_FETCHES) break;
  }

  // ---- extract phase: batched LLM calls, cached per document ----
  …  // §8.2, with the same wouldOverrun/yield pattern per batch
  // ---- assemble: G1 → G2 → G3 → quote anchors → ledger ----
  …
  return done({ outcome, docs, pdfs, items, discarded, identity: idc, gaps, usage: usageSnap() });
}
```

`commit_progress` doubles as a heartbeat (sibling design §A.1), so a crawl that spends 25 s inside
one PDF still beats every document boundary, and `pdfToLines` beats every 5 pages — the reaper's
3-minute window is never approached.

### 12.1 What `org` becomes

`org` no longer crawls. It reads `crawl_docs` for the organisation, applies the gates, assembles
the ledger, and makes the one profile/voice synthesis call it makes today. The identity gate
block at `:1341-1360` keeps its exact discard semantics for `weak`/`none`, and the `org_intel`
cache write (`:1362-1372`) is unchanged except for the two new columns. `evidence = [...intakeEvidence,
...webEvidence]` (`:1410`) becomes `[...intakeEvidence, ...docEvidence]` with `docEvidence` sorted
by `kind` priority and `allowed` first.

### 12.2 Two downstream consequences this design creates and must not leave to somebody else

**(a) The ledger no longer fits in every prompt.** `EVIDENCE_NOTE` (`:1199-1203`) stringifies the
whole array into *every* prompt of *every* stage. Today that is 3–9 items. After a good crawl it is
60–150 typed items with quotes — perhaps 60 kB, multiplied by every generation call. That is a real
cost and quality regression (long context dilutes). Fix, deterministic:

```ts
// Compact one-line rendering instead of raw JSON, and a relevance-ranked cut.
export function renderEvidence(e: EvidenceItem): string {
  const loc = e.locator.page ? `${e.source_ref}#p${e.locator.page}` : e.source_ref;
  const v = e.value?.n != null ? ` [${e.value.n}${e.value.unit ? " " + e.value.unit : ""}]` : "";
  return `${e.id} <${e.kind}${e.date_context ? "|" + e.date_context : ""}${e.status === "historical" ? "|historical" : ""}> ${e.claim}${v} — "${e.quote}" (${loc})`;
}
export function selectEvidence(all: EvidenceItem[], want: { terms: string[]; maxItems: number; maxChars: number }): EvidenceItem[] {
  const allowed = all.filter((e) => e.allowed !== false);
  const intake = allowed.filter((e) => e.source_type === "user_intake");          // ALWAYS included
  const rest = allowed.filter((e) => e.source_type !== "user_intake").map((e) => {
    const hay = (e.claim + " " + e.quote + " " + Object.values(e.entities ?? {}).flat().join(" ")).toLowerCase();
    let s = { result: 9, beneficiary_count: 8, cost: 8, programme: 7, venue: 7, location: 6, person: 6,
              partner: 5, funder: 5, funding: 5, accreditation: 4, schedule: 4, asset: 3,
              policy: 3, governance: 2, org_fact: 2 }[e.kind] ?? 1;
    for (const t of want.terms) if (t.length > 4 && hay.includes(t)) s += 3;
    if (e.status === "historical") s -= 1;
    if (e.confidence === "quoted") s += 1;
    return { e, s };
  }).sort((a, b) => b.s - a.s).map((x) => x.e);
  const out = [...intake];
  let chars = out.reduce((a, e) => a + renderEvidence(e).length, 0);
  for (const e of rest) {
    const c = renderEvidence(e).length;
    if (out.length >= want.maxItems || chars + c > want.maxChars) break;
    out.push(e); chars += c;
  }
  return out;
}
```

Generation prompts get `selectEvidence(ledger, {terms: sectionTerms, maxItems: 40, maxChars: 12_000})`.
The **auditor gets the full ledger, including `allowed:false` items** — it must be able to tell
"unsupported" from "supported, but about another organisation".

**(b) The auditor currently cannot see the proper nouns it is judging.** The ground-truth doc §1
found that `org.profile` and `directions` reach the writer (`:1206`, `:1209`) but not the auditor
(`:1674`) — proper nouns visible to the writer and invisible to the auditor are radioactive. Deep
crawl multiplies the proper nouns by an order of magnitude, so this must close in the same release.
The deterministic half is cheap and belongs here:

```ts
// Every capitalised multi-word span in the narrative that is not the applicant,
// the donor, the grant, or a calendar/common word must be traceable to a ledger
// entity or quote. Unmatched spans are handed to the Claim Ledger auditor as
// candidate unsupported claims — deterministically, before any model sees them.
export function unsourcedProperNouns(md: string, ledger: EvidenceItem[], known: string[]): string[] {
  const gaz = new Set([...known.map(normQ), ...MONTHS, ...WEEKDAYS, ...COMMON_TITLE_WORDS]);
  const hay = normQ(ledger.map((e) => e.quote + " " + e.claim + " " + Object.values(e.entities ?? {}).flat().join(" ")).join(" "));
  const spans = new Set<string>();
  for (const m of md.matchAll(/\b([A-Z][a-z'’-]+(?:\s+(?:of|and|the|de|al|bin)\s+|\s+)?){1,4}[A-Z][a-z'’-]+\b/g)) {
    const s = normQ(m[0]);
    if (s.length < 6 || gaz.has(s)) continue;
    if (!hay.includes(s)) spans.add(m[0]);
  }
  return [...spans];
}
```

---

## 13. Cost and time budget per order

**Assumptions, stated so they can be checked:** workhorse model `google/gemini-3.7-flash`
(`:106`), assumed ≈ $0.30 / M input and ≈ $2.50 / M output tokens; 4 chars ≈ 1 token; a typical
small-charity site yields 17 HTML documents (≈ 90 k chars after chrome dedupe) and 3 PDFs (≈ 150 k
chars). Per-stage token accounting in this worker is cross-contaminated by design (launch report
P2 #9, `:127-130`), so real numbers must come from OpenRouter's own accounting; these are estimates
for sizing, not measurements.

| Item | Tokens | Cost | What the money buys |
|---|---|---|---|
| Fetch (48 requests, 24 MB ceiling) | — | $0.00 | edge bandwidth |
| PDF parse (3 docs, ~60 pages) | — | $0.00 | CPU inside the existing isolate |
| Extraction, HTML (2 batches × ~11 k in, ~4 k out) | 22 k in / 8 k out | $0.027 | typed items from pages today's crawler either never fetched (depth) or flattened (`:254`) |
| Extraction, PDFs (3 calls, ~13 k in, ~5 k out each) | 39 k in / 15 k out | $0.049 | **the class of document that carries dated results, real costs, named partners and named staff — structurally unreachable today** |
| Profile + voice synthesis (unchanged `org` call) | 8 k in / 2 k out | $0.008 | as today |
| Verification (deterministic: quotes, gates, dedupe) | — | $0.00 | the safety half of the design costs nothing |
| **Fresh crawl total** | **~69 k in / 25 k out** | **≈ $0.084** | |
| Cached (30-day `org_intel` freshness, `:1266-1268`) or 304-unchanged | 0 | **$0.00** | second and later orders from the same organisation |

Order cost moves from ≈ $0.15 to ≈ $0.23 on a first order and stays ≈ $0.15 on repeats, against a
$149–$449 price. That is roughly 0.15 % of the cheapest tier, and the design deliberately does not
spend the available 10× headroom here: the expensive thing to buy would be more model passes over
the same thin evidence, which is exactly what the blind evaluation showed does not work. The money
that matters is spent on *fetching documents nobody was fetching*.

**Time**, per fresh crawl:

| Phase | Time | Notes |
|---|---|---|
| robots + sitemaps + seed | 3–6 s | one round trip each |
| 17 HTML fetches at 700 ms pacing | 25–45 s | pacing dominates, deliberately |
| 3 PDF fetches + parse | 15–60 s | 12 MB cap; beats every 5 pages |
| 5 extraction calls | 40–90 s | each guarded by `wouldOverrun` |
| gates + assembly | < 1 s | deterministic |
| **Total** | **85–200 s** | **exceeds one 150 s stage slice ⇒ 1–2 yields is the normal case, not the exception** |

That is why `harvest` is built on the resumability primitives from day one rather than retrofitted:
the median crawl spans two invocations. Cached path: < 2 s.

---

## 14. Test plan — no live web access

Everything network-touching goes behind an injected port, and the test suite runs with
`deno test --deny-net`, which is itself the strongest assertion in the plan: *if any code path
reaches the network during tests, the test crashes.*

```ts
// worker/harvest_port.ts
export interface FetchPort {
  text(url: string, o?: SafeFetchOpts): Promise<SafeFetchResult>;
  bytes(url: string, o?: SafeFetchOpts): Promise<SafeFetchBytesResult>;
}
export const LIVE_PORT: FetchPort = { text: safeFetchText, bytes: safeFetchBytes };

// tests/harvest/fixture_port.ts
export function fixturePort(dir: string): FetchPort & { log: string[] } { … }
```

### 14.1 Fixture layout

```
tests/fixtures/harvest/<case>/
  manifest.json      { "seed": "https://…", "org_name": "…", "org_reg": "…", "order_email": "…",
                       "routes": { "<url>": { "status": 200, "headers": {…}, "file": "files/…" } },
                       "expect": { "outcome": "ok", "html": 17, "pdf": 3, "items_min": 34,
                                   "identity": "conclusive", "discarded": { "g3_actor": 6 } } }
  files/…            captured HTML, robots.txt, sitemap.xml, and small hand-built PDFs
  expected/ledger.json
  expected/run.json
tests/fixtures/harvest/_llm/<case>.json     recorded extraction responses (LlmPort)
```

Fixtures are hand-authored or captured once and committed; nothing regenerates them at test time.
PDFs are tiny (< 40 kB each) and built by a committed generator script that is **not** part of the
test run.

### 14.2 Cases

| Case | Fixture | Asserts |
|---|---|---|
| `small-charity-happy` | 19 pages, sitemap, 2024 annual report PDF with a text layer and a costed table | `outcome:ok`; ≥ 30 items; ≥ 8 distinct `entities.places`+`venues`; a `cost` item whose quote is the verbatim table row; every item's `locator.page` present for PDF items |
| `depth-three-report` | annual report only reachable at `/about/publications/2024/report.pdf` | it is fetched (today's depth-1 discovery misses it) and its items appear |
| `js-only-spa` | `<div id="root">`, no visible text, no JSON-LD | `outcome:js_only`, 0 items, gap `important` — **the thefelixproject.org silent zero, now named** |
| `js-only-with-jsonld` | same, plus `Organization` + `Event` JSON-LD | ≥ 3 items, `extract_via:"jsonld"` |
| `robots-disallow-all` | `User-agent: *\nDisallow: /` | `outcome:robots_disallowed`; **`port.log.length === 1`** — only robots.txt was fetched |
| `robots-partial` | `Disallow: /downloads/` + `Allow: /downloads/annual-report.pdf` | longest-match/Allow-wins: the report is fetched, siblings are not |
| `robots-5xx` | robots returns 500 twice | `outcome:robots_fetch_failed`, nothing else fetched (RFC 9309 §2.3.1.4) |
| `cloudflare-challenge` | 403 + "Just a moment…" body | `outcome:blocked_bot`, no retry storm (`port.log.length ≤ 4`) |
| `platform-subdomain` | seed `hopewell.wordpress.com`, fixture also serves `otherchurch.wordpress.com` | scope `kind:"host"`; the other site is **never requested** |
| `path-multiplexed` | seed `sites.google.com/view/hopewell/home`, plus `/view/othergroup/` | scope `kind:"path"`; other path never requested |
| `offsite-redirect` | seed 301 → `bigumbrella.org` | `outcome:offsite_redirect`, zero evidence |
| `renamed-domain` | seed 301 → `hopewell-trust.org.uk`, name tokens match | crawl continues under the new scope; recorded |
| `partner-report-on-own-domain` | `/downloads/southwark-council-annual-review.pdf` hosted by the customer, never naming them | doc `attribution:"third_party"` or `"unknown"`; **zero items from it**; the discard is counted. *This is the B1 case at document granularity and is the single most important test in the suite.* |
| `consortium-report` | joint evaluation naming six delivery orgs incl. the applicant | doc `mixed`; only claims whose quote names the applicant survive; a "Borough X spent £2m" claim is dropped with `actor_not_applicant` |
| `identity-b1` | applicant "Beit Al-Shabab Community Association", site `amel.org` | `identity:"none"`; whole-site discard; regression against `:416-432` |
| `identity-by-reg-number` | site whose footer prints "Registered charity no. 1123456", org name shares no token with the domain | `identity:"strong"`, evidence admitted — the new true-positive path |
| `identity-freemail` | order email `hopewell@gmail.com`, no other signal | free-mail excluded ⇒ `identity:"none"` ⇒ discard |
| `pdf-scanned` | image-only PDF | `extract_status:"image_only"`, 0 items, named in the coverage note, no crash |
| `pdf-encrypted` | password-protected PDF | `extract_status:"encrypted"`, no crash |
| `pdf-garbled` | broken ToUnicode map | `garbled()` fires, 0 items |
| `pdf-61-pages` | 61-page report | `pages_read:60`, `extract_status:"partial"`, items from page 60 have `locator.page:60` |
| `sitemap-index-2000` | sitemap index → 5 sitemaps → 4,000 URLs | frontier capped, `MAX_SITEMAP_LOCS` respected, `outcome:ok_partial`, `truncated_by:"html_cap"`, ≤ 70 fetches |
| `nothing-relevant` | 12 real pages of pure mission language | `outcome:nothing_relevant_found`, distinct from `js_only` and `fetch_failed` |
| `quote-not-found` | recorded LLM response containing 4 paraphrased quotes | all 4 dropped, `discarded.quote_not_found === 4`, ledger clean |
| `crawl-delay-30` | `Crawl-delay: 30` | capped to 5 s, `crawl_delay_capped` recorded, budget cut, run completes |
| `resume-midway` | drive `harvestSlice` with a deadline that expires after 5 documents | yields; second call with a fresh deadline resumes from `progress` and **re-fetches nothing** (`port.log` has no duplicate URLs across the two slices) |
| `domain-busy` | `try_begin_crawl` returns null (stubbed) | one yield, no fetches |

### 14.3 Unit tables (pure functions, no fixtures)

- `registrable()` / `scopeFor()` / `inScope()` — ~40 rows including `co.uk`, `org.uk`, every
  `PLATFORM_SUFFIX`, IDN hosts, and a hostname that is itself a platform suffix.
- `parseRobots()` / `robotsAllows()` — the RFC 9309 §2.2.2 example table, verbatim, plus
  `Allow`-wins-on-tie, `*`, `$`, comments, agent-group merging, and a group for `KtebliBot`
  overriding `*`.
- `keepLine()` — a corpus of 60 real lines with expected verdicts, including the shapes today's
  `p.length > 40` deletes ("Founded 2011", "12 staff", "Peckham · Camberwell · Nunhead",
  "Youth club | 41 | £128,400").
- `layoutLines()` — synthetic `getTextContent().items` arrays with known coordinates: two-column
  table, right-aligned figures, superscript footnote markers, RTL Arabic run.
- `verifyQuote()` — curly quotes, en/em dashes, `&nbsp;`, entity-decoded `£`, Arabic text, and
  four near-miss paraphrases that must fail.
- `identityConfidence()` — the full 4-signal truth table, 16 rows, with the asymmetry assertion
  written as a property: *no input that today's `orgNameMatchesSite` rejects returns
  `strong`/`conclusive` without a registration-number or email-domain hit.*
- `claimAllowed()` — 20 rows across `first_party`/`mixed` documents and every `kind`.
- `selectEvidence()` — a 150-item ledger, asserts intake items always survive, the char cap holds,
  and ordering is stable.

### 14.4 SQL tests

Alongside `tests/exclusivity/run.sh` (same harness): `try_begin_crawl` returns null under a live
lock; the 10-minute staleness sweep releases a dead run; `finish_crawl` is idempotent;
`crawl_docs_org_url` rejects a duplicate URL for one organisation and permits the same URL for two.

---

## 15. What this design deliberately does not change

- Stage sequencing, the queue, `claim_next_stage`, the reaper, `PARALLEL`, the global cap.
- The Claim Ledger's classification set and its blocking rule (`:1683`, `:1703`).
- The exclusivity claims, the five partial unique indexes, `claim_approach()`.
- `identityCheck()` (`:392-413`) and `orgNameMatchesSite()` (`:447-460`) — both kept verbatim;
  the second is now one of four identity signals rather than the only one.
- The whole-site discard on identity failure (`:1341-1360`), including discarding the extracted
  gaps with it.
- The empty-ledger generation branch (`:1207`). A thin crawl still produces an honest proposal.
- No human touches anything. Every gate, every taxonomy code, every consequence is automatic.

---

## 16. Residual risks, named

1. **pdfjs in the edge runtime is the one unproven dependency.** Mitigations: lazy import, dual
   source, per-document `parse_failed` that never fails the stage. First implementation task is a
   spike that parses a 40-page report inside a deployed function and records `extract_via` and
   wall time; if it fails, the design degrades to HTML-only and the failure taxonomy already has a
   code for it.
2. **G2's anchor requirement will drop some genuine pages** on sites that never state their own
   name in text. Measurable from day one: `discarded.g2_unknown` per run.
3. **Ledger size shifts cost into every downstream prompt** unless §12.2(a) ships in the same
   release. It is not optional.
4. **The extraction model will be tempted to paraphrase quotes.** The quote-anchor check makes
   that self-limiting, but if `discarded.quote_not_found` runs above ~20 % the prompt needs the
   verbatim rule restated per item rather than once per call.
5. **Politeness makes crawls slow**, which makes yields normal, which puts real load on the
   resumability work. This design depends on that work; it should not ship first.
