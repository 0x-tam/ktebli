// ============================================================================
// CRAWL OUTCOMES — the crawler must say what happened, always
// ============================================================================
//
// THE DEFECT THIS REPLACES. `crawlSite()` (worker/index.ts:219-274) fetches every
// page through `safeFetchText`, which returns `{ finalUrl, status, contentType,
// body }` (ssrf.ts:70-75) — and then **discards `status`**. Repo-wide no caller
// ever reads it. So a Cloudflare interstitial, a 404 and a 503 maintenance page
// are all treated as a successful fetch of the organisation's own prose. Two
// failure shapes follow, both silent:
//
//   * a long block page is crawled, extracted and fed to the extraction call at
//     index.ts:1318 as if the organisation had written it;
//   * a short block page fails the `text.length > 120` floor at index.ts:1272,
//     the page is dropped, and because `home !== null` the crawl does NOT return
//     `error: "unreachable"` — it returns `pages: []` with a `meta` that has no
//     `error` key at all.
//
// Twelve distinct paths could reach `pages: []` and nine of them recorded nothing
// distinguishing (reports/design/audit-reliability.md section (d).2). All of them
// collapsed into one customer-facing line at index.ts:1341:
//
//     "website unreachable or empty — no public organisational evidence available"
//
// which is true, useless, and not actionable. It cost nothing when the product
// was a generic proposal. It now costs a sale or forces a refund, because the
// pre-payment sufficiency gate and the six-site live run both read this result.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE IS
// ---------------------------------------------------------------------------
//
// One closed set of outcomes, one classifier, and the pure helpers the classifier
// needs. Every crawl ends in exactly one outcome and carries the counts behind
// it: pages fetched, pages parsed, referents extracted, referents surviving the
// identity gate, and a human-readable reason.
//
//   blocked_robots     the site's robots.txt forbids us; we did not read it
//   blocked_bot        the server refused a non-browser reader (403/401/429, or
//                      a challenge interstitial)
//   fetch_failed       no usable HTTP response: DNS, TLS, timeout, SSRF refusal,
//                      4xx/5xx that is not a bot block
//   js_only            2xx, but the page is an application shell — the text is
//                      drawn by JavaScript, which a Deno edge function has no
//                      engine for
//   extraction_failed  2xx with a body we could not turn into prose
//   nothing_relevant   prose extracted, but it names nothing
//   identity_mismatch  the site does not belong to the applicant, so everything
//                      from it was discarded
//   succeeded          named referents survived the identity gate
//
// ---------------------------------------------------------------------------
// REFUSAL BY DEFAULT
// ---------------------------------------------------------------------------
//
// `succeeded` is not a fallthrough. `classifyCrawl()` reaches it only by clearing
// every prior test, and `assertReportConsistent()` re-derives the necessary
// conditions from the counts and throws if the outcome and the counts disagree.
// Nothing can pass this gate by asserting that it passed: the outcome is computed
// from observations, never supplied.
//
// The identity gate is NOT softened to avoid an empty result. It stays asymmetric
// (invariant 3): anything short of a confident match discards the site entirely,
// and an identity gate that did not run over site-derived output is classified as
// `identity_mismatch`, not waved through. `js_only` is likewise recorded and
// reported, never worked around — the architecture is eight edge functions with
// no JavaScript engine, and that stays true.
//
// ---------------------------------------------------------------------------
// PURITY
// ---------------------------------------------------------------------------
//
// Everything above `crawlSiteObserved()` is pure: no network, no clock, no model,
// no database. That is what lets tests/crawl-outcome/crawl_outcome_test.ts drive
// the whole taxonomy from fixtures on a machine with no outbound access — which
// is the machine this was written on. `crawlSiteObserved()` is the one function
// that touches the network, and it takes its fetcher as a parameter defaulting to
// the production `safeFetchText`, so fixtures exercise the real traversal.
//
// Nothing here asks a model to count anything.

import { normPN, properNouns } from "./proper_nouns.ts";
import { safeFetchText, stripHtml } from "./ssrf.ts";

export const CRAWL_OUTCOME_CONTRACT_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrawlOutcome =
  | "blocked_robots"
  | "blocked_bot"
  | "js_only"
  | "fetch_failed"
  | "extraction_failed"
  | "nothing_relevant"
  | "identity_mismatch"
  | "succeeded";

export const CRAWL_OUTCOMES: readonly CrawlOutcome[] = [
  "blocked_robots", "blocked_bot", "js_only", "fetch_failed",
  "extraction_failed", "nothing_relevant", "identity_mismatch", "succeeded",
] as const;

/** Only `succeeded` means the ledger gained anything. Everything else is a miss. */
export function isFailure(o: CrawlOutcome): boolean {
  return o !== "succeeded";
}
/** The customer can act on these three; the rest are ours to fix or to accept. */
export function isCustomerActionable(o: CrawlOutcome): boolean {
  return o === "blocked_bot" || o === "blocked_robots" || o === "js_only" ||
    o === "identity_mismatch";
}

export type PageRole = "home" | "page" | "sitemap" | "robots";

export interface PageObservation {
  url: string;
  role: PageRole;
  /** HTTP status, or null when no HTTP response was obtained at all. */
  status: number | null;
  /** SsrfError reason or thrown message, capped. Null on a clean response. */
  error: string | null;
  content_type: string | null;
  /** Raw body length in characters. */
  html_chars: number;
  /** Length after stripHtml — what a text-only reader can see. */
  text_chars: number;
  /** Length after paragraph filtering and cross-page dedupe — what is usable. */
  kept_chars: number;
  /** Characters inside <script> elements. High ratio + no text is an app shell. */
  script_chars: number;
  /** Capped head of the body, kept only so the classifier can see challenge markers. */
  body_sample: string;
}

export interface RobotsObservation {
  /** True when an HTTP response was obtained for /robots.txt, any status. */
  fetched: boolean;
  status: number | null;
  /** Whether the site's own rules permit us to read the root. */
  allowed: boolean;
  /** The matching directive, verbatim, when we are disallowed. */
  rule: string | null;
  error: string | null;
}

export interface CrawlObservations {
  website: string;
  domain: string | null;
  bad_url: boolean;
  robots: RobotsObservation;
  pages: PageObservation[];
  /** MAX_FETCHES was hit — a starved crawl is not the same as a thin site. */
  fetch_budget_exhausted: boolean;
  discovered: number;
  elapsed_ms: number;
}

export type IdentityGateState = "cleared" | "rejected" | "not_run";

export interface ClassifyInput extends CrawlObservations {
  /** Distinct named referents in the crawled corpus, deterministic. */
  referents_extracted: number;
  /** Of those, how many survive the identity gate. Zero when it rejects. */
  referents_surviving: number;
  identity_gate: IdentityGateState;
  /**
   * Whether the extraction produced ANY site-derived output — profile, voice
   * guide or evidence. This is what makes the gate mandatory: a site that yields
   * a mission and a voice but no legal name and no evidence used to skip the gate
   * entirely (the index.ts:1349 trigger hole) and drove strategy and design from
   * another organisation's words.
   */
  site_derived_output: boolean;
}

export interface CrawlReport {
  outcome: CrawlOutcome;
  pages_fetched: number;
  pages_parsed: number;
  referents_extracted: number;
  referents_surviving: number;
  reason: string;
  domain: string | null;
  detail: {
    contract: string;
    robots: RobotsObservation;
    statuses: Array<{ url: string; status: number | null; error: string | null }>;
    discovered: number;
    kept_chars: number;
    text_chars: number;
    fetch_budget_exhausted: boolean;
    identity_gate: IdentityGateState;
    elapsed_ms: number;
  };
}

// ---------------------------------------------------------------------------
// Pure helper: domain normalisation (same rule as worker/index.ts:210-212)
// ---------------------------------------------------------------------------

export function normDomain(d: string): string {
  return String(d ?? "").toLowerCase().replace(/^www\./, "");
}

// ---------------------------------------------------------------------------
// Pure helper: robots.txt
// ---------------------------------------------------------------------------
//
// The crawler has never read robots.txt. A site that forbids us is currently
// crawled anyway and, when its WAF then answers 403, the result is indistinguish-
// able from "no content". Reading the file makes the refusal explicit, attributes
// it to the site's own instruction, and gives the customer something to change.

export const CRAWLER_UA_TOKEN = "ktebliBot";

export interface RobotsRules {
  /** user-agent token (lowercased) -> directives, in file order */
  groups: Map<string, Array<{ allow: boolean; path: string; line: string }>>;
}

export function parseRobots(txt: string): RobotsRules {
  const groups = new Map<string, Array<{ allow: boolean; path: string; line: string }>>();
  let active: string[] = [];
  let sawDirective = false;
  for (const rawLine of String(txt ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") {
      // A new user-agent line after directives starts a new group.
      if (sawDirective) { active = []; sawDirective = false; }
      active.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    sawDirective = true;
    for (const ua of active) {
      const arr = groups.get(ua) ?? [];
      arr.push({ allow: field === "allow", path: value, line });
      groups.set(ua, arr);
    }
  }
  return { groups };
}

function robotsPathMatches(pattern: string, path: string): boolean {
  if (pattern === "") return false;              // empty Disallow means "allow all"
  // Support the two wildcards every major crawler honours: * and $.
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const re = "^" + esc.replace(/\*/g, ".*").replace(/\\\$$/, "$");
  try { return new RegExp(re).test(path); } catch { return path.startsWith(pattern); }
}

/**
 * Longest-match wins; an Allow beats a Disallow of equal length (the rule every
 * major crawler implements). A group naming our token wins over `*` outright.
 */
export function robotsAllows(
  rules: RobotsRules,
  path: string,
  ua: string = CRAWLER_UA_TOKEN,
): { allowed: boolean; rule: string | null } {
  const uaLower = ua.toLowerCase();
  let group: Array<{ allow: boolean; path: string; line: string }> | undefined;
  for (const [name, directives] of rules.groups) {
    if (name !== "*" && uaLower.includes(name)) { group = directives; break; }
  }
  if (!group) group = rules.groups.get("*");
  if (!group || !group.length) return { allowed: true, rule: null };

  let best: { allow: boolean; path: string; line: string } | null = null;
  for (const d of group) {
    if (!robotsPathMatches(d.path, path)) continue;
    if (!best || d.path.length > best.path.length ||
        (d.path.length === best.path.length && d.allow && !best.allow)) best = d;
  }
  if (!best) return { allowed: true, rule: null };
  return { allowed: best.allow, rule: best.allow ? null : best.line };
}

// ---------------------------------------------------------------------------
// Pure helper: bot blocks and challenge interstitials
// ---------------------------------------------------------------------------

const CHALLENGE_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/just a moment\s*\.{0,3}/i, "Cloudflare 'Just a moment' interstitial"],
  [/attention required.{0,20}cloudflare/i, "Cloudflare 'Attention Required'"],
  [/checking your browser before accessing/i, "Cloudflare browser check"],
  [/cf-browser-verification|__cf_chl_|cf_chl_opt|cdn-cgi\/challenge-platform/i, "Cloudflare challenge platform"],
  [/enable javascript and cookies to continue/i, "JavaScript-and-cookies challenge"],
  [/(sorry, )?you have been blocked/i, "explicit block page"],
  [/access denied|403 forbidden|forbidden/i, "access denied page"],
  [/request unsuccessful.{0,40}incapsula/i, "Imperva/Incapsula block"],
  [/pardon our interruption/i, "Distil/Imperva interruption page"],
  [/(h|re)?captcha|are you a robot|verify you are human/i, "CAPTCHA challenge"],
  [/rate limit|too many requests/i, "rate limiting"],
];

/**
 * A refusal aimed at non-browser readers. Statuses 401/403/429 are conclusive on
 * their own. A 200 or 503 is only a block when a marker is present AND there is
 * almost no prose — otherwise a page that happens to discuss captchas would be
 * misread as a block.
 */
export function looksLikeBotChallenge(
  status: number | null,
  body: string,
  textChars: number,
): { blocked: boolean; marker: string | null } {
  const sample = String(body ?? "").slice(0, 20_000);
  let marker: string | null = null;
  for (const [re, name] of CHALLENGE_MARKERS) if (re.test(sample)) { marker = name; break; }
  if (status === 401 || status === 403 || status === 429) {
    return { blocked: true, marker: marker ?? `HTTP ${status}` };
  }
  if (marker && textChars < 3000 && (status === 200 || status === 503 || status === 202)) {
    return { blocked: true, marker };
  }
  return { blocked: false, marker: null };
}

// ---------------------------------------------------------------------------
// Pure helper: JavaScript-only application shells
// ---------------------------------------------------------------------------

const SHELL_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<div[^>]+id=["'](root|app|__next|__nuxt|___gatsby)["'][^>]*>\s*<\/div>/i, "empty framework mount point"],
  [/<div[^>]+id=["'](root|app|__next|__nuxt|___gatsby)["']/i, "framework mount point"],
  [/data-reactroot|window\.__NUXT__|window\.__NEXT_DATA__|ng-version=|window\.__INITIAL_STATE__/i, "client-side framework bootstrap"],
  [/you need to enable javascript to run this app/i, "explicit enable-JavaScript notice"],
  [/<noscript>[^<]{0,200}javascript/i, "noscript JavaScript notice"],
];

export function scriptChars(html: string): number {
  let n = 0;
  for (const m of String(html ?? "").matchAll(/<script[\s\S]*?<\/script>/gi)) n += m[0].length;
  return n;
}

/**
 * Is this a shell whose text is drawn by JavaScript? Two independent signals:
 * a framework marker, or a body that is mostly script and carries no prose. Both
 * additionally require that there is essentially no readable text — a rendered
 * React page is a normal page and must not be classified as js_only.
 */
export function looksLikeJsShell(
  html: string,
  textChars: number,
): { shell: boolean; marker: string | null; script_ratio: number } {
  const h = String(html ?? "");
  const sc = scriptChars(h);
  const ratio = h.length ? sc / h.length : 0;
  if (textChars >= 600) return { shell: false, marker: null, script_ratio: ratio };
  for (const [re, name] of SHELL_MARKERS) {
    if (re.test(h)) return { shell: true, marker: name, script_ratio: ratio };
  }
  if (ratio > 0.4 && h.length > 500) {
    return { shell: true, marker: "body is mostly script with no prose", script_ratio: ratio };
  }
  return { shell: false, marker: null, script_ratio: ratio };
}

// ---------------------------------------------------------------------------
// Pure helper: paragraph extraction
// ---------------------------------------------------------------------------
//
// Lifted verbatim from worker/index.ts:1268-1273 so that the thresholds that
// decide "parsed" have exactly one implementation and a test can drive it.

export const PARA_MIN_CHARS = 40;
export const PAGE_MIN_CHARS = 120;
export const PER_PAGE_CHARS = 9_000;

export function keepParagraphs(rawText: string, seen: Set<string>): string[] {
  const paras = String(rawText ?? "")
    .split(/(?<=[.!?])\s+(?=[A-Z؀-ۿ])/)
    .map((p) => p.trim())
    .filter((p) => p.length > PARA_MIN_CHARS);
  const kept: string[] = [];
  for (const p of paras) {
    const k = p.toLowerCase().slice(0, 120);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(p);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Pure helper: building one observation from one HTTP result
// ---------------------------------------------------------------------------

export interface ObservePageInput {
  url: string;
  role: PageRole;
  status?: number | null;
  error?: string | null;
  contentType?: string | null;
  body?: string;
  keptChars?: number;
}

export function observePage(i: ObservePageInput): PageObservation {
  const body = i.body ?? "";
  const text = body ? stripHtml(body, 40_000) : "";
  return {
    url: i.url,
    role: i.role,
    status: i.status ?? null,
    error: i.error ? String(i.error).slice(0, 120) : null,
    content_type: i.contentType ?? null,
    html_chars: body.length,
    text_chars: text.length,
    kept_chars: i.keptChars ?? 0,
    script_chars: scriptChars(body),
    body_sample: body.slice(0, 4_000),
  };
}

// ---------------------------------------------------------------------------
// Pure helper: referents
// ---------------------------------------------------------------------------
//
// The same deterministic counter the proper-noun audit uses, so the number in
// this report and the number in `properNounAudit` mean the same thing, and so
// stack/ground-truth.sh can compare "what a browser shows" against "what the
// crawler got" on one scale.

export function crawlCorpus(pages: ReadonlyArray<{ url: string; text: string }>): string {
  return pages.map((p) => p.text).join("\n\n");
}

/**
 * Distinct named referents in crawled text, excluding the applicant's own name —
 * using your own name is not particularity (worker/proper_nouns.ts:104-105).
 */
export function siteReferents(corpus: string, applicantName: string): string[] {
  const own = new Set<string>();
  for (const p of properNouns(String(applicantName ?? ""))) own.add(normPN(p));
  const seen = new Map<string, string>();
  for (const p of properNouns(String(corpus ?? ""))) {
    if (p === p.toUpperCase()) continue;   // UNKNOWN / NOT RECORDED scaffolding
    const k = normPN(p);
    if (!k || own.has(k)) continue;
    if (!seen.has(k)) seen.set(k, p);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Pure helper: the identity gate
// ---------------------------------------------------------------------------
//
// Semantics identical to `orgNameMatchesSite` (worker/index.ts:455-467), moved
// here so there is one implementation, so it is testable, and so the classifier
// cannot be handed a gate verdict that no code produced. It is DELIBERATELY
// ASYMMETRIC: default-deny, and no signal is added that would make clearing it
// easier. Discarding good evidence is the correct trade (invariant 3).

const ORG_GENERIC_WORDS = new Set([
  "the", "of", "for", "and", "a", "an", "association", "foundation", "trust", "society",
  "project", "projects", "international", "community", "group", "organisation", "organization",
  "charity", "charitable", "fund", "funds", "network", "centre", "center", "institute",
  "council", "alliance", "collective", "partners", "partnership", "initiative", "services",
  "service", "ltd", "limited", "inc", "incorporated", "nonprofit", "non", "profit", "ngo",
  "national", "global", "development", "welfare", "aid", "relief", "union",
]);

export function orgTokens(raw: string): Set<string> {
  return new Set(
    String(raw ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
      .filter((t) => t.length > 2 && !ORG_GENERIC_WORDS.has(t)),
  );
}

export function orgNameMatchesSite(orgName: string, siteLegalName: unknown, domain: string): boolean {
  const want = orgTokens(orgName);
  if (!want.size) return false; // nothing distinctive to match on: do not admit
  const site = orgTokens(String(siteLegalName ?? ""));
  for (const t of want) if (site.has(t)) return true;
  for (const t of site) if (want.has(t)) return true;
  // A site may never state a legal name. The domain is then the only signal, and
  // a distinctive token appearing in it is a real one (amel.org would NOT match
  // "Beit Al-Shabab Community Association", which is the case that matters).
  const host = String(domain ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const t of want) if (t.length > 3 && host.includes(t)) return true;
  return false;
}

export function identityVerdict(
  orgName: string,
  siteLegalName: unknown,
  domain: string,
): IdentityGateState {
  return orgNameMatchesSite(orgName, siteLegalName, domain) ? "cleared" : "rejected";
}

/**
 * Names a site states about itself. Harness-only: this feeds stack/live-run.sh so
 * a live run can exercise the gate without a model call. It is NOT wired into the
 * pipeline gate — adding candidate names to match against could only make the
 * gate EASIER to clear, and the gate's asymmetry is the point.
 */
export function siteNameCandidates(html: string): string[] {
  const h = String(html ?? "");
  const out: string[] = [];
  const push = (s: string | undefined) => {
    const t = String(s ?? "").replace(/\s+/g, " ").trim();
    if (t && t.length < 160) out.push(t);
  };
  push(h.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]);
  push(h.match(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)?.[1]);
  for (const m of h.matchAll(/"(?:legalName|name)"\s*:\s*"([^"]{2,120})"/g)) push(m[1]);
  const title = h.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1];
  if (title) for (const part of title.split(/\s[|–—-]\s/)) push(part);
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// THE CLASSIFIER
// ---------------------------------------------------------------------------

function contentPages(pages: ReadonlyArray<PageObservation>): PageObservation[] {
  return pages.filter((p) => p.role === "home" || p.role === "page");
}

function httpReason(p: PageObservation): string {
  if (p.status === null) return `no HTTP response from ${p.url}: ${p.error ?? "unknown transport failure"}`;
  return `${p.url} returned HTTP ${p.status}`;
}

/**
 * One outcome per crawl, derived from observations only. `succeeded` is reached
 * only by clearing every test above it; every other branch is a refusal.
 */
export function classifyCrawl(input: ClassifyInput): CrawlReport {
  const content = contentPages(input.pages);
  const fetched = content.filter((p) => p.status !== null && p.status >= 200 && p.status < 300);
  const parsed = content.filter((p) => p.kept_chars >= PAGE_MIN_CHARS);
  const keptChars = content.reduce((a, p) => a + p.kept_chars, 0);
  const textChars = content.reduce((a, p) => a + p.text_chars, 0);

  const base = {
    pages_fetched: fetched.length,
    pages_parsed: parsed.length,
    referents_extracted: input.referents_extracted,
    referents_surviving: input.referents_surviving,
    domain: input.domain,
    detail: {
      contract: CRAWL_OUTCOME_CONTRACT_VERSION,
      robots: input.robots,
      statuses: input.pages.map((p) => ({ url: p.url, status: p.status, error: p.error })),
      discovered: input.discovered,
      kept_chars: keptChars,
      text_chars: textChars,
      fetch_budget_exhausted: input.fetch_budget_exhausted,
      identity_gate: input.identity_gate,
      elapsed_ms: input.elapsed_ms,
    },
  };
  const report = (outcome: CrawlOutcome, reason: string): CrawlReport => {
    const r: CrawlReport = { outcome, reason, ...base };
    assertReportConsistent(r);
    return r;
  };

  // 1. Nothing usable was supplied.
  if (input.bad_url || !input.domain) {
    return report("fetch_failed", `the supplied website "${input.website}" is not a usable URL`);
  }

  // 2. The site's own rules forbid us. We do not read it, and we say so.
  if (!input.robots.allowed) {
    return report(
      "blocked_robots",
      `${input.domain}/robots.txt forbids automated readers${input.robots.rule ? ` (${input.robots.rule})` : ""}` +
        `; nothing was read from the site`,
    );
  }

  const home = input.pages.find((p) => p.role === "home");

  // 3. No HTTP response at all for the homepage.
  if (!home || home.status === null) {
    const err = home?.error ?? "the homepage was never fetched";
    return report("fetch_failed", `${input.domain} could not be reached: ${err}`);
  }

  // 4. A refusal aimed at non-browser readers.
  const challenge = looksLikeBotChallenge(home.status, home.body_sample, home.text_chars);
  if (challenge.blocked) {
    return report(
      "blocked_bot",
      `${input.domain} refused an automated reader (HTTP ${home.status}, ${challenge.marker}); ` +
        `no page of the site could be read`,
    );
  }

  // 5. Any other non-2xx homepage.
  if (home.status < 200 || home.status >= 300) {
    return report("fetch_failed", httpReason(home));
  }

  // 6. 2xx, but nothing was parsed out of any page.
  if (parsed.length === 0) {
    const shell = content
      .map((p) => ({ p, s: looksLikeJsShell(p.body_sample, p.text_chars) }))
      .find((x) => x.s.shell);
    if (shell) {
      return report(
        "js_only",
        `${input.domain} draws its text with JavaScript (${shell.s.marker}); ` +
          `${fetched.length} page(s) fetched, ${textChars} characters of readable text. ` +
          `Ktebli reads HTML directly and runs no browser, so nothing could be read`,
      );
    }
    if (input.fetch_budget_exhausted && fetched.length === 0) {
      return report("fetch_failed", `${input.domain}: the fetch budget was exhausted before any page was read`);
    }
    return report(
      "extraction_failed",
      `${input.domain} answered HTTP ${home.status} but no prose could be extracted: ` +
        `${fetched.length} page(s) fetched, ${textChars} characters of text, ` +
        `none of it forming a paragraph over ${PARA_MIN_CHARS} characters` +
        (home.content_type ? ` (content-type ${home.content_type})` : ""),
    );
  }

  // 7. The identity gate. Mandatory over ANY site-derived output — the old
  //    trigger only fired on evidence or a stated legal name, so a site with a
  //    mission and a voice but neither of those was admitted unchecked.
  if (input.site_derived_output || input.referents_extracted > 0) {
    if (input.identity_gate === "rejected") {
      return report(
        "identity_mismatch",
        `the website supplied (${input.domain}) does not appear to belong to the applicant; ` +
          `${input.referents_extracted} referent(s) from it were discarded`,
      );
    }
    if (input.identity_gate !== "cleared") {
      return report(
        "identity_mismatch",
        `the identity gate did not run over site-derived output from ${input.domain}; ` +
          `the site is discarded rather than trusted`,
      );
    }
  }

  // 8. Prose, but it names nothing.
  if (input.referents_extracted === 0 || input.referents_surviving === 0) {
    return report(
      "nothing_relevant",
      `${input.domain}: ${parsed.length} page(s) parsed and ${keptChars} characters of prose, ` +
        `but no named referent (place, partner, venue, programme or dated result) was found`,
    );
  }

  // 9. Cleared everything above.
  return report(
    "succeeded",
    `${input.domain}: ${fetched.length} page(s) fetched, ${parsed.length} parsed, ` +
      `${input.referents_extracted} referent(s) extracted, ${input.referents_surviving} surviving the identity gate`,
  );
}

// ---------------------------------------------------------------------------
// The consistency assertion — no outcome may contradict its own counts
// ---------------------------------------------------------------------------

export class CrawlReportError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
    this.name = "CrawlReportError";
  }
}

/**
 * Re-derives the necessary conditions for each outcome from the counts. This is
 * what stops a report being trusted because it says so: a `succeeded` with no
 * parsed page, or an `identity_mismatch` that still carries surviving referents,
 * throws instead of being delivered.
 */
export function assertReportConsistent(r: CrawlReport): void {
  const bad = (code: string, msg: string) => { throw new CrawlReportError(code, msg); };
  if (!CRAWL_OUTCOMES.includes(r.outcome)) bad("unknown_outcome", `unknown outcome ${r.outcome}`);
  if (!r.reason || r.reason.length < 20) bad("no_reason", `outcome ${r.outcome} carries no readable reason`);
  for (const [k, v] of Object.entries({
    pages_fetched: r.pages_fetched, pages_parsed: r.pages_parsed,
    referents_extracted: r.referents_extracted, referents_surviving: r.referents_surviving,
  })) {
    if (!Number.isInteger(v) || v < 0) bad("bad_count", `${k} is not a count: ${v}`);
  }
  if (r.referents_surviving > r.referents_extracted) {
    bad("surviving_exceeds_extracted",
      `${r.referents_surviving} referents survived the gate but only ${r.referents_extracted} were extracted`);
  }
  if (r.pages_parsed > r.pages_fetched) {
    bad("parsed_exceeds_fetched", `${r.pages_parsed} pages parsed but only ${r.pages_fetched} fetched`);
  }
  if (r.outcome === "succeeded") {
    if (r.pages_parsed < 1) bad("succeeded_without_pages", "succeeded with no parsed page");
    if (r.referents_surviving < 1) bad("succeeded_without_referents", "succeeded with no surviving referent");
    if (r.detail.identity_gate !== "cleared") {
      bad("succeeded_without_gate", `succeeded with identity gate "${r.detail.identity_gate}"`);
    }
  }
  if (r.outcome === "identity_mismatch" && r.referents_surviving !== 0) {
    bad("mismatch_with_survivors", "identity_mismatch must discard every referent");
  }
  if (r.outcome === "blocked_robots" && r.pages_fetched !== 0) {
    bad("robots_with_fetches", "blocked_robots must not have read any page");
  }
  if ((r.outcome === "js_only" || r.outcome === "extraction_failed" ||
       r.outcome === "blocked_bot" || r.outcome === "fetch_failed") && r.pages_parsed !== 0) {
    bad("failure_with_parsed_pages", `${r.outcome} must not carry parsed pages`);
  }
  if (r.outcome === "nothing_relevant" && r.pages_parsed < 1) {
    bad("nothing_relevant_without_pages", "nothing_relevant means prose WAS parsed and named nothing");
  }
}

// ---------------------------------------------------------------------------
// What the customer is told
// ---------------------------------------------------------------------------
//
// Replaces the one string at worker/index.ts:1341. Each line is specific enough
// to act on, and none of them invites us to soften the identity gate.

export function crawlGap(r: CrawlReport): { gap: string; severity: string } | null {
  const domain = r.domain ?? "the website supplied";
  switch (r.outcome) {
    case "succeeded":
      return null;
    case "blocked_robots":
      return { severity: "important", gap:
        `we could not read ${domain}: its robots.txt asks automated readers to stay out, and we honour that. ` +
        `Nothing from the site was used. Paste the relevant text or upload a document instead.` };
    case "blocked_bot":
      return { severity: "important", gap:
        `${domain} blocked our reader (its protection layer answered with a challenge rather than the page). ` +
        `Nothing from the site was used. Paste the relevant text or upload a document instead.` };
    case "js_only":
      return { severity: "important", gap:
        `${domain} builds its pages with JavaScript in the visitor's browser, so there is no text for us to read. ` +
        `Nothing from the site was used. Paste the relevant text or upload a document instead.` };
    case "fetch_failed":
      return { severity: "important", gap:
        `${domain} did not answer when we tried to read it. Nothing from the site was used. ` +
        `Check the address, or paste the relevant text instead.` };
    case "extraction_failed":
      return { severity: "important", gap:
        `${domain} answered, but we could not extract readable text from it. Nothing from the site was used. ` +
        `Paste the relevant text or upload a document instead.` };
    case "nothing_relevant":
      return { severity: "important", gap:
        `we read ${domain} but found nothing concrete about your work — no places, partners, venues or dated results. ` +
        `Nothing from the site could be used as evidence.` };
    case "identity_mismatch":
      return { severity: "important", gap:
        `the website supplied (${domain}) does not appear to belong to your organisation, so nothing from it was used. ` +
        `We never attribute another organisation's work to you.` };
  }
}

export const CRAWL_EVENT_ACTION = "crawl_outcome";

/** The append-only events row (invariant 9). Small, flat, and query-friendly. */
export function crawlEventDetail(r: CrawlReport): Record<string, unknown> {
  return {
    outcome: r.outcome,
    domain: r.domain,
    pages_fetched: r.pages_fetched,
    pages_parsed: r.pages_parsed,
    referents_extracted: r.referents_extracted,
    referents_surviving: r.referents_surviving,
    identity_gate: r.detail.identity_gate,
    robots_allowed: r.detail.robots.allowed,
    kept_chars: r.detail.kept_chars,
    text_chars: r.detail.text_chars,
    elapsed_ms: r.detail.elapsed_ms,
    reason: r.reason.slice(0, 400),
    contract: CRAWL_OUTCOME_CONTRACT_VERSION,
  };
}

/** One line for the operator table and for stack/live-run.sh. */
export function reportLine(site: string, r: CrawlReport): string {
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
  return [
    pad(site, 30), pad(r.outcome, 18),
    pad(String(r.pages_fetched), 7), pad(String(r.pages_parsed), 7),
    pad(String(r.referents_extracted), 6), pad(String(r.referents_surviving), 6),
    r.reason,
  ].join(" ");
}

// ============================================================================
// THE ONE IMPURE FUNCTION
// ============================================================================
//
// Everything above is offline-testable. This is the traversal, ported from
// worker/index.ts:219-274 with four corrections:
//
//   1. robots.txt is read and honoured (it never was);
//   2. `status` is READ — a 4xx/5xx is recorded and is never treated as content,
//      which is the bug that produced the silent failure;
//   3. every attempt, successful or not, produces a PageObservation;
//   4. an exhausted fetch budget and a failed sitemap are recorded rather than
//      swallowed.
//
// The fetcher is a parameter so fixtures can drive the real traversal offline. It
// defaults to the production `safeFetchText`; there is no separate local path.

export interface FetchResult { finalUrl: string; status: number; contentType: string; body: string }
export interface FetchOpts {
  maxRedirects?: number; timeoutMs?: number; maxBytes?: number; allowContentTypes?: RegExp;
}
export type Fetcher = (url: string, opts: FetchOpts) => Promise<FetchResult>;

export interface CrawlPage { url: string; text: string }
export interface ObservedCrawl {
  pages: CrawlPage[];
  hash: string;
  observations: CrawlObservations;
}

const PAGE_VALUE: ReadonlyArray<readonly [RegExp, number]> = [
  [/about|who-we-are|mission|vision|history/i, 10],
  [/program|project|our-work|what-we-do|service|impact|result|achiev/i, 9],
  [/annual-report|report|publication|case-stud/i, 7],
  [/team|leadership|staff|board|partner/i, 6],
  [/news|stories|blog/i, 3],
  [/privacy|terms|cookie|contact|donate|login|signup|careers|tag\/|page\/|\?/i, -10],
];

export function pageValue(url: string): number {
  let v = 1;
  for (const [re, w] of PAGE_VALUE) if (re.test(url)) v += w;
  const depth = (url.replace(/^https?:\/\//, "").match(/\//g) ?? []).length;
  return v - Math.max(0, depth - 2);
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of String(html ?? "").matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)) {
    try {
      const u = new URL(m[1], baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = ""; u.search = "";
      out.add(u.toString().replace(/\/$/, ""));
    } catch { /* skip */ }
  }
  return [...out];
}

async function contentHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const MAX_PAGES = 10;
export const MAX_FETCHES = 14;
export const TOTAL_CHARS = 60_000;

export async function crawlSiteObserved(
  website: string,
  fetcher: Fetcher = safeFetchText,
  now: () => number = Date.now,
): Promise<ObservedCrawl> {
  const started = now();
  const root = /^https?:\/\//.test(website) ? website : `https://${website}`;
  const observations: PageObservation[] = [];
  const robots: RobotsObservation = { fetched: false, status: null, allowed: true, rule: null, error: null };
  const empty = (domain: string | null, badUrl: boolean, discovered = 0): ObservedCrawl => ({
    pages: [], hash: "",
    observations: {
      website, domain, bad_url: badUrl, robots, pages: observations,
      fetch_budget_exhausted: false, discovered, elapsed_ms: now() - started,
    },
  });

  let rootUrl: URL;
  try { rootUrl = new URL(root); } catch { return empty(null, true); }
  const domain = normDomain(rootUrl.hostname);

  // ---- robots.txt, read before anything else -----------------------------
  const robotsUrl = `${rootUrl.origin}/robots.txt`;
  let rules: RobotsRules = { groups: new Map() };
  try {
    const res = await fetcher(robotsUrl, {
      timeoutMs: 6_000, maxBytes: 200_000, allowContentTypes: /^text\//i,
    });
    robots.fetched = true;
    robots.status = res.status;
    observations.push(observePage({ url: robotsUrl, role: "robots", status: res.status, contentType: res.contentType }));
    if (res.status >= 200 && res.status < 300) {
      rules = parseRobots(res.body);
    } else if (res.status >= 500) {
      // The standard treats an unreadable robots.txt served by a working server
      // as a full disallow. Recorded explicitly, never silently.
      robots.allowed = false;
      robots.rule = `robots.txt returned HTTP ${res.status}`;
    }
  } catch (e) {
    // A transport error on robots.txt usually means the site itself is down; let
    // the homepage fetch produce that finding rather than mislabelling it.
    robots.error = String((e as Error).message ?? e).slice(0, 120);
    observations.push(observePage({ url: robotsUrl, role: "robots", error: robots.error }));
  }
  if (robots.allowed) {
    const v = robotsAllows(rules, rootUrl.pathname || "/");
    robots.allowed = v.allowed;
    robots.rule = v.rule;
  }
  if (!robots.allowed) return empty(domain, false);

  // ---- traversal ---------------------------------------------------------
  const fetchedHtml = new Map<string, string>();
  let budgetExhausted = false;
  const get = async (u: string, role: PageRole): Promise<string | null> => {
    if (fetchedHtml.has(u)) return fetchedHtml.get(u)!;
    if (fetchedHtml.size >= MAX_FETCHES) { budgetExhausted = true; return null; }
    try {
      const res = await fetcher(u, { maxRedirects: 3, timeoutMs: 9_000, maxBytes: 900_000 });
      if (normDomain(new URL(res.finalUrl).hostname) !== domain) {
        observations.push(observePage({ url: u, role, status: res.status, error: `offsite:${res.finalUrl}`.slice(0, 120), contentType: res.contentType }));
        return null;
      }
      // THE FIX. `status` used to be fetched and discarded, so a 403 block page
      // and a 404 were crawled as if they were the organisation's own prose.
      if (res.status >= 400 || res.status < 200) {
        observations.push(observePage({ url: u, role, status: res.status, contentType: res.contentType, body: res.body }));
        return null;
      }
      observations.push(observePage({ url: u, role, status: res.status, contentType: res.contentType, body: res.body }));
      fetchedHtml.set(u, res.body);
      return res.body;
    } catch (e) {
      observations.push(observePage({ url: u, role, error: String((e as Error).message ?? e) }));
      return null;
    }
  };

  const home = await get(rootUrl.toString(), "home");
  if (home === null) {
    return {
      pages: [], hash: "",
      observations: {
        website, domain, bad_url: false, robots, pages: observations,
        fetch_budget_exhausted: budgetExhausted, discovered: 0, elapsed_ms: now() - started,
      },
    };
  }

  // ---- discovery ---------------------------------------------------------
  const candidates = new Set<string>();
  const sitemapUrl = `${rootUrl.origin}/sitemap.xml`;
  try {
    const sm = await fetcher(sitemapUrl, {
      timeoutMs: 6_000, maxBytes: 400_000, allowContentTypes: /^(text\/|application\/(xml|xhtml))/i,
    });
    observations.push(observePage({ url: sitemapUrl, role: "sitemap", status: sm.status, contentType: sm.contentType }));
    if (sm.status >= 200 && sm.status < 300) {
      for (const m of sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) candidates.add(m[1].replace(/\/$/, ""));
    }
  } catch (e) {
    observations.push(observePage({ url: sitemapUrl, role: "sitemap", error: String((e as Error).message ?? e) }));
  }
  for (const l of extractLinks(home, rootUrl.toString())) candidates.add(l);

  const rootKey = rootUrl.toString().replace(/\/$/, "");
  const sameSite = [...candidates].filter((u) => {
    try {
      const url = new URL(u);
      if (normDomain(url.hostname) !== domain) return false;
      if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|zip|docx?|xlsx?|pptx?)$/i.test(u)) return false;
      return robotsAllows(rules, url.pathname || "/").allowed;
    } catch { return false; }
  });
  sameSite.sort((a, b) => pageValue(b) - pageValue(a));
  const picked = [rootKey, ...sameSite.filter((u) => u !== rootKey).slice(0, MAX_PAGES - 1)];

  // ---- extraction --------------------------------------------------------
  const seenPara = new Set<string>();
  const pages: CrawlPage[] = [];
  let total = 0;
  for (const u of picked) {
    if (total >= TOTAL_CHARS) break;
    const html = (u === rootKey || u === rootUrl.toString()) ? home : await get(u, "page");
    if (html === null) continue;
    const raw = stripHtml(html, 40_000);
    const text = keepParagraphs(raw, seenPara).join(" ").slice(0, PER_PAGE_CHARS);
    const obs = observations.find((o) => o.url === u && (o.role === "home" || o.role === "page"));
    if (obs) obs.kept_chars = text.length;
    if (text.length > PAGE_MIN_CHARS) { pages.push({ url: u, text }); total += text.length; }
  }

  return {
    pages,
    hash: await contentHash(pages.map((p) => p.text).join("\n")),
    observations: {
      website, domain, bad_url: false, robots, pages: observations,
      fetch_budget_exhausted: budgetExhausted, discovered: candidates.size, elapsed_ms: now() - started,
    },
  };
}
