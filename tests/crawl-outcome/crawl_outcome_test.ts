// Tests for the crawl outcome taxonomy.
//
//   npx deno@2.9.5 run tests/crawl-outcome/crawl_outcome_test.ts
//
// NO NETWORK, and no permissions of any kind. Every case is a FIXTURE: a table of
// URL -> HTTP result (or thrown error) handed to `crawlSiteObserved` in place of
// `safeFetchText`. The traversal, the paragraph filter, the robots parser, the
// challenge detector and the classifier that run here are the production ones —
// only the socket is replaced. That matters because the machine this was written
// on cannot reach any external site, and because the six-site live run must not
// be the first time this code is exercised.
//
// The defect being pinned: `crawlSite` fetched `status` and discarded it, so a
// 403 block page, a 404 and a JS shell were indistinguishable from a site with
// nothing to say — `pages: []`, `meta` with no `error` key, and one useless
// customer-facing sentence for all of them.

import {
  assertReportConsistent,
  classifyCrawl,
  CRAWL_OUTCOMES,
  CrawlReportError,
  crawlCorpus,
  crawlEventDetail,
  crawlGap,
  crawlSiteObserved,
  hasRecordedOutcome,
  identityVerdict,
  isFurniture,
  keepParagraphs,
  looksLikeBotChallenge,
  looksLikeJsShell,
  PAGE_MIN_CHARS,
  parseRobots,
  proseSignals,
  reclassifyCached,
  robotsAllows,
  siteNameCandidates,
  siteReferents,
} from "../../supabase/functions/worker/crawl_outcome.ts";
import type {
  ClassifyInput, CrawlOutcome, CrawlReport, FetchOpts, FetchResult,
} from "../../supabase/functions/worker/crawl_outcome.ts";
import {
  ctRefusalReason, decodeBody, stripHtml,
} from "../../supabase/functions/worker/ssrf.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}
function eq(actual: unknown, want: unknown, msg: string) {
  const good = actual === want;
  ok(good, `${msg}${good ? "" : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(want)}`}`);
}
function throwsCode(fn: () => unknown, code: string, msg: string) {
  try { fn(); console.error(`  FAIL ${msg} — did not throw`); failures++; }
  catch (e) {
    const c = (e as CrawlReportError).code;
    if (c === code) console.log(`  ok  ${msg}`);
    else { console.error(`  FAIL ${msg} — threw ${c}, wanted ${code}`); failures++; }
  }
}
function section(t: string) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------------
// The fixture fetcher
// ---------------------------------------------------------------------------

type FixtureEntry =
  | { status: number; contentType?: string; body?: string; finalUrl?: string }
  | { throws: string };

function fixtureFetcher(table: Record<string, FixtureEntry>) {
  const seen: string[] = [];
  const fn = async (url: string, opts: FetchOpts): Promise<FetchResult> => {
    seen.push(url);
    const key = url.replace(/\/$/, "");
    const e = table[url] ?? table[key] ?? table[key + "/"];
    if (!e) throw new Error("dns_unresolved");   // nothing else exists on this fixture host
    if ("throws" in e) throw new Error(e.throws);
    const contentType = e.contentType ?? "text/html; charset=utf-8";
    // Enforce the caller's content-type allowlist exactly as safeFetchText does,
    // so fixtures exercise the real refusal path (machine files, untyped blocks).
    if (opts?.allowContentTypes && !opts.allowContentTypes.test(contentType)) {
      throw new Error(ctRefusalReason(e.status));
    }
    await Promise.resolve();
    return {
      finalUrl: e.finalUrl ?? url,
      status: e.status,
      contentType,
      body: e.body ?? "",
    };
  };
  return Object.assign(fn, { seen });
}

const ROBOTS_OPEN = { status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /wp-admin/\n" };

/** A page with no navigation: link labels strip into the text like any other word. */
function plain(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function html(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>` +
    `<nav><a href="/about">About</a><a href="/our-work">Our work</a></nav>${body}</body></html>`;
}

/** Run the whole production path over a fixture, exactly as the org stage will. */
async function run(
  site: string,
  table: Record<string, FixtureEntry>,
  opts: { org: string; legalName?: string | null; siteDerived?: boolean },
): Promise<{ report: CrawlReport; referents: string[] }> {
  const crawl = await crawlSiteObserved(site, fixtureFetcher(table));
  const corpus = crawlCorpus(crawl.pages);
  const referents = siteReferents(corpus, opts.org);
  const gate = crawl.observations.domain && (referents.length || opts.siteDerived)
    ? identityVerdict(opts.org, opts.legalName ?? null, crawl.observations.domain)
    : "not_run";
  const input: ClassifyInput = {
    ...crawl.observations,
    referents_extracted: referents.length,
    referents_surviving: gate === "cleared" ? referents.length : 0,
    identity_gate: gate,
    site_derived_output: opts.siteDerived ?? referents.length > 0,
  };
  return { report: classifyCrawl(input), referents };
}

// ===========================================================================
section("1. blocked_bot — a 403 aimed at non-browser readers");
// ===========================================================================

// The reported signature, byte for byte: a 77-character text/plain 403. It used
// to fail `text.length > 120`, be dropped, and leave `meta` with no error key.
{
  const body = "Forbidden: automated access to this site is not permitted. Contact the owner.";
  eq(body.length, 77, "the regression fixture is the 77-byte block page");
  const { report } = await run("https://blockedcharity.org", {
    "https://blockedcharity.org/robots.txt": ROBOTS_OPEN,
    "https://blockedcharity.org/": { status: 403, contentType: "text/plain", body },
  }, { org: "Blocked Charity" });
  eq(report.outcome, "blocked_bot", "a 77-byte 403 is blocked_bot, not an empty crawl");
  eq(report.pages_fetched, 0, "nothing was fetched");
  eq(report.pages_parsed, 0, "nothing was parsed");
  ok(report.reason.includes("403"), "the reason names the status code");
  ok((crawlGap(report)?.gap ?? "").includes("blocked our reader"), "the customer is told the site blocked us");
}

// The other half of the same defect: a LONG block page, which used to be crawled
// and fed to the extraction call as if the organisation had written it.
{
  const wall = html("Attention Required! | Cloudflare",
    "<h1>Sorry, you have been blocked</h1><p>You are unable to access this website. " +
    "This website is using a security service to protect itself from online attacks. " +
    "The action you just performed triggered the security solution. " +
    "Cloudflare Ray ID: 8b2c4d9e0f1a2b3c</p>");
  const { report } = await run("https://walledtrust.org", {
    "https://walledtrust.org/robots.txt": ROBOTS_OPEN,
    "https://walledtrust.org/": { status: 403, body: wall },
  }, { org: "Walled Trust" });
  eq(report.outcome, "blocked_bot", "a long 403 block wall is blocked_bot, not content");
  eq(report.referents_extracted, 0, "no referent is taken from a block page");
}

// A challenge served with HTTP 200 — the case a status check alone cannot catch.
{
  const jm = `<!doctype html><html><head><title>Just a moment...</title></head><body>` +
    `<div class="cf-browser-verification">Checking your browser before accessing the site.</div></body></html>`;
  const { report } = await run("https://interstitial.org", {
    "https://interstitial.org/robots.txt": ROBOTS_OPEN,
    "https://interstitial.org/": { status: 200, body: jm },
  }, { org: "Interstitial Trust" });
  eq(report.outcome, "blocked_bot", "a 200 Cloudflare interstitial is blocked_bot");
}

// And the inverse: a real page that merely mentions captchas is NOT a block.
{
  const r = looksLikeBotChallenge(200, "our volunteers help older people solve captcha puzzles online. ".repeat(80), 4800);
  eq(r.blocked, false, "a long page mentioning captchas is not a block");
  eq(looksLikeBotChallenge(429, "", 0).blocked, true, "429 is a block on the status alone");
  eq(looksLikeBotChallenge(401, "", 0).blocked, true, "401 is a block on the status alone");
}

// ===========================================================================
section("2. blocked_robots — the site's own rules forbid us");
// ===========================================================================

{
  const { report } = await run("https://politeaboutit.org", {
    "https://politeaboutit.org/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /\n" },
    "https://politeaboutit.org/": { status: 200, body: html("Home", "<p>Never read, because robots.txt says not to.</p>") },
  }, { org: "Polite About It" });
  eq(report.outcome, "blocked_robots", "a full disallow is blocked_robots");
  eq(report.pages_fetched, 0, "and no page of the site was read");
  eq(report.detail.robots.allowed, false, "the robots verdict is recorded");
  ok(report.reason.includes("robots.txt"), "the reason names robots.txt");
}

// A disallow aimed at us by name, with an open `*` group — the named group wins.
{
  const { report } = await run("https://namedban.org", {
    "https://namedban.org/robots.txt": {
      status: 200, contentType: "text/plain",
      body: "User-agent: *\nDisallow:\n\nUser-agent: KtebliBot\nDisallow: /\n",
    },
    "https://namedban.org/": { status: 200, body: html("Home", "<p>Not read.</p>") },
  }, { org: "Named Ban Trust" });
  eq(report.outcome, "blocked_robots", "a group naming our user-agent wins over the wildcard group");
}

// Parser truth table.
{
  const r = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/public-report.pdf\n");
  eq(robotsAllows(r, "/about").allowed, true, "an unlisted path is allowed");
  eq(robotsAllows(r, "/private/board").allowed, false, "a disallowed prefix is refused");
  eq(robotsAllows(r, "/private/public-report.pdf").allowed, true, "a longer Allow beats a shorter Disallow");
  eq(robotsAllows(parseRobots("User-agent: *\nDisallow:\n"), "/").allowed, true, "an empty Disallow allows everything");
  eq(robotsAllows(parseRobots("# nothing here\n"), "/").allowed, true, "a commented-out file allows everything");
  eq(robotsAllows(parseRobots("User-agent: *\nDisallow: /*/drafts$\n"), "/2026/drafts").allowed, false,
    "the * and $ wildcards are honoured");
}

// A robots.txt that 404s means "allowed"; a 5xx means "disallowed" (the standard).
{
  const { report } = await run("https://norobots.org", {
    "https://norobots.org/robots.txt": { status: 404, contentType: "text/plain", body: "not found" },
    "https://norobots.org/": { status: 200, body: html("Home",
      "<p>Norobots Trust runs a food pantry on Waverley Street in Dundee. " +
      "The pantry opened in 2019 and serves about forty households a week.</p>") },
  }, { org: "Norobots Trust" });
  ok(report.outcome !== "blocked_robots", "a 404 robots.txt does not block the crawl");

  const { report: r5 } = await run("https://brokenrobots.org", {
    "https://brokenrobots.org/robots.txt": { status: 503, contentType: "text/plain", body: "" },
    "https://brokenrobots.org/": { status: 200, body: html("Home", "<p>Not read.</p>") },
  }, { org: "Broken Robots Trust" });
  eq(r5.outcome, "blocked_robots", "a 5xx robots.txt is a full disallow, and is recorded as one");

  // A transport error on robots.txt must NOT be reported as a robots block: the
  // site is probably down, and fetch_failed is the honest finding.
  const { report: rErr } = await run("https://deadhost.org", {
    "https://deadhost.org/robots.txt": { throws: "dns_unresolved" },
    "https://deadhost.org/": { throws: "dns_unresolved" },
  }, { org: "Dead Host Trust" });
  eq(rErr.outcome, "fetch_failed", "an unreachable robots.txt does not masquerade as a robots block");
}

// ===========================================================================
section("3. js_only — a shell with no text");
// ===========================================================================

{
  const shell = `<!doctype html><html><head><title>Riverside</title>` +
    `<script src="/static/js/main.8f2c.js"></script>` +
    `<script>${"window.__NEXT_DATA__={props:{pageProps:{}}};".repeat(40)}</script>` +
    `</head><body><div id="root"></div>` +
    `<noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
  const { report } = await run("https://spa-charity.org", {
    "https://spa-charity.org/robots.txt": ROBOTS_OPEN,
    "https://spa-charity.org/": { status: 200, body: shell },
  }, { org: "SPA Charity" });
  eq(report.outcome, "js_only", "an empty React/Next mount point is js_only");
  eq(report.pages_fetched, 1, "the page WAS fetched — that is the distinction from fetch_failed");
  eq(report.pages_parsed, 0, "and nothing could be parsed out of it");
  ok(report.reason.includes("JavaScript"), "the reason says the text is drawn by JavaScript");
  ok((crawlGap(report)?.gap ?? "").includes("JavaScript"), "and so does the customer-facing line");
}

// A rendered page that happens to ship React must NOT be called js_only.
{
  const shipped = looksLikeJsShell(
    `<html><body><div id="root"><p>Real prose lives here.</p></div><script>var a=1;</script></body></html>`, 2400);
  eq(shipped.shell, false, "a page with real text is never js_only, framework markers or not");
}

// ===========================================================================
section("4. extraction_failed — a 200 whose body cannot be turned into prose");
// ===========================================================================

// (a) mis-encoded body: long enough to pass the paragraph filter, not text.
{
  const junk = "��PK".repeat(60) + " " + "�".repeat(400);
  const { report } = await run("https://mojibake.org", {
    "https://mojibake.org/robots.txt": ROBOTS_OPEN,
    "https://mojibake.org/": { status: 200, contentType: "text/html", body: junk },
  }, { org: "Mojibake Trust" });
  eq(report.outcome, "extraction_failed", "a body that does not read as text is extraction_failed");
  eq(report.detail.prose_pages, 0, "no page read as prose");
  ok(report.reason.includes("reads as text"), "the reason says the body is not text");
}

// (b) a splash page: 200, real HTML, but under the paragraph floor.
{
  const { report } = await run("https://splash.org", {
    "https://splash.org/robots.txt": ROBOTS_OPEN,
    "https://splash.org/": { status: 200, body: `<html><body><h1>Splash</h1><a href="/enter">Enter</a></body></html>` },
  }, { org: "Splash Trust" });
  eq(report.outcome, "extraction_failed", "a page under the paragraph floor is extraction_failed");
  eq(report.pages_fetched, 1, "it was fetched");
  eq(report.pages_parsed, 0, "and yielded no paragraph");
}

{
  eq(proseSignals("a b c").is_prose, false, "three words are not prose");
  ok(proseSignals("The pantry on Waverley Street opens twice a week. ".repeat(6)).is_prose,
    "ordinary English is prose");
}

// ===========================================================================
section("5. nothing_relevant — prose that names nothing");
// ===========================================================================

{
  const vague = "<p>we support young people across the area to build confidence and skills. " +
    "our work is led by the people we serve, and we believe in listening first. " +
    "every year we help hundreds of families to feel less alone in their struggles. " +
    "we are proud of the difference our volunteers make in their own neighbourhoods.</p>";
  const { report, referents } = await run("https://vaguetrust.org", {
    "https://vaguetrust.org/robots.txt": ROBOTS_OPEN,
    "https://vaguetrust.org/": { status: 200, body: plain("vague trust", vague) },
  }, { org: "Vague Trust", legalName: "Vague Trust", siteDerived: true });
  eq(referents.length, 0, "the fixture genuinely names nothing");
  eq(report.outcome, "nothing_relevant", "prose that names nothing is nothing_relevant");
  ok(report.pages_parsed >= 1, "and it is recorded as PARSED — the site was read");
  ok(report.detail.prose_pages >= 1, "the prose count proves the text was readable");
  ok(report.reason.includes("no named referent"), "the reason says what was missing");
}

// ===========================================================================
section("6. identity_mismatch — the site belongs to someone else");
// ===========================================================================

// The case the gate was built for: Beit Al-Shabab supplied amel.org.
{
  const amel = "<p>Amel Association International was founded in 1979 and runs twenty-four centres " +
    "across Lebanon, including Ain el-Remmaneh and Kamed el-Loz. " +
    "The organisation was awarded the Aurora Prize in 2019 for its work in the Bekaa Valley.</p>";
  const { report, referents } = await run("https://amel.org", {
    "https://amel.org/robots.txt": ROBOTS_OPEN,
    "https://amel.org/": { status: 200, body: html("Amel Association International", amel) },
  }, { org: "Beit Al-Shabab Community Association", legalName: "Amel Association International" });
  ok(referents.length >= 3, `the site does carry referents (${referents.length}) — they are discarded anyway`);
  eq(report.outcome, "identity_mismatch", "another organisation's site is identity_mismatch");
  eq(report.referents_surviving, 0, "and every referent is discarded");
  ok(report.referents_extracted >= 3, "while the extracted count records what was thrown away");
  ok((crawlGap(report)?.gap ?? "").includes("does not appear to belong"), "the customer is told plainly");
}

// The trigger hole from audit-reliability §d.3: site-derived output but no legal
// name and no evidence. The gate used never to run. It must now REFUSE.
{
  const thin = "<p>We work with families who need a hand at the hardest moments of their lives. " +
    "our approach is patient, practical and rooted in the places we serve every single week.</p>";
  const { report } = await run("https://unrelated-domain.org", {
    "https://unrelated-domain.org/robots.txt": ROBOTS_OPEN,
    "https://unrelated-domain.org/": { status: 200, body: html("Home", thin) },
  }, { org: "Bramley Hall Youth Project", legalName: null, siteDerived: true });
  eq(report.outcome, "identity_mismatch",
    "site-derived output with no matching name is discarded, not admitted");
}

// The gate is not softened to avoid an empty result: a gate that did not run over
// site-derived output is a mismatch, never a pass.
{
  const base: ClassifyInput = {
    website: "https://x.org", domain: "x.org", bad_url: false,
    robots: { fetched: true, status: 200, allowed: true, rule: null, error: null },
    pages: [{
      url: "https://x.org/", role: "home", status: 200, error: null, content_type: "text/html",
      html_chars: 900, text_chars: 800, kept_chars: 800, script_chars: 0, prose: true, body_sample: "",
    }],
    fetch_budget_exhausted: false, discovered: 3, elapsed_ms: 10,
    referents_extracted: 5, referents_surviving: 5, identity_gate: "not_run", site_derived_output: true,
  };
  eq(classifyCrawl(base).outcome, "identity_mismatch", "identity_gate 'not_run' can never yield succeeded");
  eq(classifyCrawl({ ...base, identity_gate: "cleared" }).outcome, "succeeded", "a cleared gate can");
}

// The gate's own truth table, unchanged from worker/index.ts:455-467.
{
  eq(identityVerdict("Beit Al-Shabab Community Association", "Amel Association International", "amel.org"),
    "rejected", "Beit Al-Shabab / amel.org is rejected");
  eq(identityVerdict("Riverside Community Trust", "Riverside Community Trust", "riversidetrust.org"),
    "cleared", "an exact legal-name match clears");
  eq(identityVerdict("Riverside Community Trust", null, "riversidetrust.org"),
    "cleared", "a distinctive token in the domain clears when no legal name is stated");
  eq(identityVerdict("Community Foundation Trust", null, "somecharity.org"),
    "rejected", "a name of nothing but generic words can never clear");
  eq(identityVerdict("Riverside Community Trust", null, "somecharity.org"),
    "rejected", "no shared token anywhere is rejected");
}

// ===========================================================================
section("7. succeeded — n referents survive the gate");
// ===========================================================================

{
  const homeBody = "<p>Riverside Community Trust runs a food pantry from St Aidan's Church Hall on " +
    "Bramley Road, in the Kirkstall ward of Leeds. " +
    "The pantry opened in March 2019 and now serves about ninety households each week. " +
    "We work with Leeds City Council and with the Real Junk Food Project on surplus collections.</p>";
  const aboutBody = "<p>Our trustees include Farida Suleiman, who chairs the board, and Tom Whitcombe. " +
    "The Trust was registered with the Charity Commission in 2016 and reports annually. " +
    "Our holiday clubs run from Hawksworth Primary School during the summer break.</p>";
  const table = {
    "https://riversidetrust.org/robots.txt": ROBOTS_OPEN,
    "https://riversidetrust.org/": { status: 200, body: html("Riverside Community Trust", homeBody) },
    "https://riversidetrust.org/about": { status: 200, body: html("About", aboutBody) },
    "https://riversidetrust.org/our-work": { status: 404, body: "not found" },
    "https://riversidetrust.org/sitemap.xml": {
      status: 200, contentType: "application/xml",
      body: "<urlset><url><loc>https://riversidetrust.org/about</loc></url></urlset>",
    },
  };
  const { report, referents } = await run("https://riversidetrust.org", table,
    { org: "Riverside Community Trust", legalName: "Riverside Community Trust" });
  eq(report.outcome, "succeeded", "a real site with real nouns succeeds");
  eq(report.pages_fetched, 2, "two pages were fetched (the 404 is not one of them)");
  eq(report.pages_parsed, 2, "and both parsed");
  ok(report.referents_extracted >= 6,
    `six or more referents extracted (${report.referents_extracted}: ${referents.slice(0, 8).join(", ")})`);
  eq(report.referents_surviving, report.referents_extracted, "all of them survive a cleared gate");
  eq(crawlGap(report), null, "a success adds no gap to the customer's page");
  ok(referents.some((r) => /Bramley Road/i.test(r)), "the street name is among them");
  ok(!referents.some((r) => /^Riverside Community Trust$/i.test(r)), "the applicant's own name is not counted");
  ok(report.detail.statuses.some((s) => s.status === 404), "the 404 sub-page is recorded in the statuses");
}

// ===========================================================================
section("8. fetch_failed — no usable HTTP response");
// ===========================================================================

{
  const cases: Array<[string, FixtureEntry, string]> = [
    ["dns", { throws: "dns_unresolved" }, "a DNS failure"],
    ["ssrf", { throws: "resolves_to_private" }, "an SSRF refusal"],
    ["timeout", { throws: "The signal has been aborted" }, "a timeout"],
    ["ct", { throws: "bad_content_type" }, "a disallowed content type"],
    ["notfound", { status: 404, body: "<html><body><h1>Not Found</h1></body></html>" }, "a 404 homepage"],
    ["servererr", { status: 500, body: "<html><body><h1>Internal Server Error</h1></body></html>" }, "a 500 homepage"],
  ];
  for (const [name, entry, label] of cases) {
    const { report } = await run(`https://${name}-case.org`, {
      [`https://${name}-case.org/robots.txt`]: ROBOTS_OPEN,
      [`https://${name}-case.org/`]: entry,
    }, { org: "Case Trust" });
    eq(report.outcome, "fetch_failed", `${label} is fetch_failed`);
    ok(report.reason.length > 25, `  and carries a reason: ${report.reason.slice(0, 70)}`);
  }
}

// A malformed website value never reaches the network at all.
{
  const { report } = await run("not a url at all", {}, { org: "Case Trust" });
  eq(report.outcome, "fetch_failed", "an unusable URL is fetch_failed");
  eq(report.domain, null, "with no domain");
}

// An offsite redirect is recorded and does not become content.
{
  const { report } = await run("https://parked.org", {
    "https://parked.org/robots.txt": ROBOTS_OPEN,
    "https://parked.org/": {
      status: 200, finalUrl: "https://domainparking.example.com/parked",
      body: html("For sale", "<p>This domain is for sale. Enquire within for pricing details today.</p>"),
    },
  }, { org: "Parked Trust" });
  eq(report.outcome, "fetch_failed", "a homepage that redirects offsite is fetch_failed");
  ok(report.detail.statuses.some((s) => (s.error ?? "").startsWith("offsite:")), "and the offsite hop is recorded");
}

// ===========================================================================
section("9. every outcome is distinguishable, and none is silent");
// ===========================================================================

{
  const seen = new Set<CrawlOutcome>();
  const fixtures: Array<[CrawlOutcome, () => Promise<CrawlReport>]> = [
    ["blocked_robots", async () => (await run("https://r.org", {
      "https://r.org/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /" },
    }, { org: "R Trust" })).report],
    ["blocked_bot", async () => (await run("https://b.org", {
      "https://b.org/robots.txt": ROBOTS_OPEN, "https://b.org/": { status: 403, body: "no" },
    }, { org: "B Trust" })).report],
    ["fetch_failed", async () => (await run("https://f.org", {
      "https://f.org/robots.txt": ROBOTS_OPEN, "https://f.org/": { throws: "dns_unresolved" },
    }, { org: "F Trust" })).report],
    ["js_only", async () => (await run("https://j.org", {
      "https://j.org/robots.txt": ROBOTS_OPEN,
      "https://j.org/": { status: 200, body: `<html><body><div id="app"></div><script>window.__NUXT__={}</script></body></html>` },
    }, { org: "J Trust" })).report],
    ["extraction_failed", async () => (await run("https://e.org", {
      "https://e.org/robots.txt": ROBOTS_OPEN, "https://e.org/": { status: 200, body: "<html><body>hi</body></html>" },
    }, { org: "E Trust" })).report],
    ["nothing_relevant", async () => (await run("https://n.org", {
      "https://n.org/robots.txt": ROBOTS_OPEN,
      "https://n.org/": { status: 200, body: plain("n",
        "<p>we help people who need help, every week of the year, " +
        "with kindness and patience and a cup of tea when that is what is wanted most.</p>") },
    }, { org: "Nithsdale Welfare Trust", legalName: "Nithsdale Welfare Trust", siteDerived: true })).report],
    ["identity_mismatch", async () => (await run("https://m.org", {
      "https://m.org/robots.txt": ROBOTS_OPEN,
      "https://m.org/": { status: 200, body: html("Other",
        "<p>Other Charity works in Hackney and in Tower Hamlets. " +
        "It has run the Chatsworth Road drop-in since 2014 with Hackney Council.</p>") },
    }, { org: "Bramley Hall Youth Project", legalName: "Other Charity" })).report],
    ["succeeded", async () => (await run("https://s.org", {
      "https://s.org/robots.txt": ROBOTS_OPEN,
      "https://s.org/": { status: 200, body: plain("Fenton Pantry Trust",
        "<p>Fenton Pantry Trust runs the Fenton Street pantry in Salford. " +
        "It opened in 2018 and works with Salford City Council on referrals every week.</p>") },
    }, { org: "Fenton Pantry Trust", legalName: "Fenton Pantry Trust" })).report],
  ];
  for (const [want, make] of fixtures) {
    const r = await make();
    eq(r.outcome, want, `fixture for ${want} classifies as ${want}`);
    seen.add(r.outcome);
    ok(r.reason.trim().length >= 20, `  ${want} carries a human-readable reason`);
    assertReportConsistent(r);
    const d = crawlEventDetail(r);
    eq(d.outcome, want, `  ${want} reaches the events row`);
    ok(typeof d.pages_fetched === "number" && typeof d.referents_surviving === "number",
      `  ${want} carries its counts into the events row`);
    if (want !== "succeeded") ok(crawlGap(r) !== null, `  ${want} produces a customer-facing gap line`);
  }
  eq(seen.size, CRAWL_OUTCOMES.length, "all eight outcomes are reachable from fixtures");

  const stub = (o: CrawlOutcome): CrawlReport => ({
    outcome: o, reason: "a reason long enough to be readable by a person",
    pages_fetched: 0, pages_parsed: 0, referents_extracted: 0, referents_surviving: 0, domain: "d.org",
    detail: {
      contract: "1.0.0", robots: { fetched: true, status: 200, allowed: true, rule: null, error: null },
      statuses: [], discovered: 0, kept_chars: 0, text_chars: 0, fetch_budget_exhausted: false,
      prose_pages: 0, identity_gate: "not_run", elapsed_ms: 0,
    },
  });
  const gaps = new Set(CRAWL_OUTCOMES.filter((o) => o !== "succeeded").map((o) => crawlGap(stub(o))?.gap));
  eq(gaps.size, CRAWL_OUTCOMES.length - 1, "and each failing outcome has its OWN customer sentence");
}

// ===========================================================================
section("10. a report cannot pass by asserting that it passed");
// ===========================================================================

{
  const good: CrawlReport = {
    outcome: "succeeded", reason: "a reason long enough to be readable by a person",
    pages_fetched: 2, pages_parsed: 2, referents_extracted: 5, referents_surviving: 5, domain: "d.org",
    detail: {
      contract: "1.0.0", robots: { fetched: true, status: 200, allowed: true, rule: null, error: null },
      statuses: [], discovered: 4, kept_chars: 900, text_chars: 1200, fetch_budget_exhausted: false,
      prose_pages: 2, identity_gate: "cleared", elapsed_ms: 20,
    },
  };
  assertReportConsistent(good);
  console.log("  ok  a consistent report passes");
  throwsCode(() => assertReportConsistent({ ...good, pages_parsed: 0 }),
    "succeeded_without_pages", "succeeded with no parsed page throws");
  throwsCode(() => assertReportConsistent({ ...good, referents_surviving: 0 }),
    "succeeded_without_referents", "succeeded with no surviving referent throws");
  throwsCode(() => assertReportConsistent({ ...good, detail: { ...good.detail, identity_gate: "not_run" } }),
    "succeeded_without_gate", "succeeded without a cleared identity gate throws");
  throwsCode(() => assertReportConsistent({ ...good, referents_surviving: 9 }),
    "surviving_exceeds_extracted", "more survivors than extractions throws");
  throwsCode(() => assertReportConsistent({ ...good, outcome: "identity_mismatch" }),
    "mismatch_with_survivors", "an identity_mismatch that kept referents throws");
  throwsCode(() => assertReportConsistent({
    ...good, outcome: "blocked_robots", referents_surviving: 0, referents_extracted: 0, pages_parsed: 0,
  }), "robots_with_fetches", "blocked_robots that fetched pages throws");
  throwsCode(() => assertReportConsistent({ ...good, reason: "too short" }),
    "no_reason", "a report with no readable reason throws");
  throwsCode(() => assertReportConsistent({
    ...good, outcome: "nothing_relevant", referents_extracted: 0, referents_surviving: 0,
    detail: { ...good.detail, prose_pages: 0 },
  }), "nothing_relevant_without_prose", "nothing_relevant with no prose page throws");
}

// ===========================================================================
section("11. paragraph filter, referents and the name signal");
// ===========================================================================

{
  const seen = new Set<string>();
  const first = keepParagraphs("The pantry opened in 2019 and serves ninety households. Short bit. " +
    "It is staffed entirely by volunteers from the surrounding streets of Kirkstall.", seen);
  eq(first.length, 2, "paragraphs under 40 characters are dropped");
  const second = keepParagraphs("The pantry opened in 2019 and serves ninety households. " +
    "A wholly different sentence about the Bramley Road holiday club that follows it.", seen);
  eq(second.length, 1, "a paragraph already seen on another page is deduped away");

  eq(siteReferents("Riverside Community Trust works on Bramley Road.", "Riverside Community Trust")
    .some((r) => /Riverside/.test(r)), false, "the applicant's own name is excluded from referents");
  eq(siteReferents("UNKNOWN NOT RECORDED", "X Trust").length, 0, "all-caps scaffolding is not a referent");

  const cands = siteNameCandidates(
    `<html><head><title>Home | Riverside Community Trust</title>` +
    `<meta property="og:site_name" content="Riverside Community Trust"></head><body></body></html>`);
  ok(cands.includes("Riverside Community Trust"), "the site name signal reads og:site_name and <title>");
}


// ===========================================================================
section("12. cached crawls — the identity gate is re-applied, never inherited");
// ===========================================================================

{
  const cached: CrawlReport = {
    outcome: "succeeded", reason: "riversidetrust.org: 2 page(s) fetched, 2 parsed, 7 referents",
    pages_fetched: 2, pages_parsed: 2, referents_extracted: 7, referents_surviving: 7,
    domain: "riversidetrust.org",
    detail: {
      contract: "1.0.0", robots: { fetched: true, status: 200, allowed: true, rule: null, error: null },
      statuses: [], discovered: 9, kept_chars: 1800, text_chars: 2400, fetch_budget_exhausted: false,
      prose_pages: 2, identity_gate: "cleared", elapsed_ms: 900,
    },
  };
  eq(hasRecordedOutcome(cached), true, "a report-shaped cache row is reusable");
  eq(hasRecordedOutcome({ domain: "x.org", fetched: 3, kept: 2 }), false,
    "a legacy cache row carrying no outcome is NOT reusable — the caller re-crawls");
  eq(hasRecordedOutcome(null), false, "and neither is an absent one");

  const good = reclassifyCached(cached, "hit",
    { identity_gate: "cleared", referents_extracted: 7, referents_surviving: 7, site_derived_output: true });
  eq(good.outcome, "succeeded", "a cache hit that re-clears the gate still succeeds");
  ok(good.reason.includes("cache"), "and says the referents came from cache");

  const rejected = reclassifyCached(cached, "hit",
    { identity_gate: "rejected", referents_extracted: 7, referents_surviving: 0, site_derived_output: true });
  eq(rejected.outcome, "identity_mismatch", "a cached crawl whose gate now REJECTS is a mismatch");
  eq(rejected.referents_surviving, 0, "and keeps nothing");

  const empty = reclassifyCached(cached, "content_unchanged",
    { identity_gate: "cleared", referents_extracted: 0, referents_surviving: 0, site_derived_output: true });
  eq(empty.outcome, "nothing_relevant", "an unchanged site that carries no referent is nothing_relevant");

  const notRun = reclassifyCached(cached, "hit",
    { identity_gate: "not_run", referents_extracted: 7, referents_surviving: 7, site_derived_output: true });
  eq(notRun.outcome, "identity_mismatch", "a cached crawl may never skip the gate");
}

// ===========================================================================
section("13. silent-failure audit (phase 5) — the status survives every layer");
// ===========================================================================
//
// The reference defect (thefelixproject.org, CLAUDE.md P1.6) was a DISCARDED
// STATUS: a refusal indistinguishable from an empty site. This section pins the
// places the same class could recur one layer down, each from a canned response.

// 13a. A refusal whose content-type is unreadable. safeFetchText refuses to read
// the body and throws — but the refusal status rides out in the error reason,
// and the observation must recover it. Before this fix, a WAF 403 served with a
// missing or non-text content-type was classified fetch_failed ("did not
// answer"), which is false: the server answered, with a refusal.
{
  const { report } = await run("https://untypedblock.org", {
    "https://untypedblock.org/robots.txt": ROBOTS_OPEN,
    "https://untypedblock.org/": { throws: "bad_content_type_http_403" },
  }, { org: "Untyped Block Trust" });
  eq(report.outcome, "blocked_bot", "a 403 with an unreadable content-type is blocked_bot, not fetch_failed");
  ok(report.reason.includes("403"), "and the reason carries the status");
  eq(report.pages_fetched, 0, "no page was read");
  ok(report.detail.statuses.some((s) => s.status === 403), "the recovered status is recorded");
}
{
  const { report } = await run("https://untypedlimit.org", {
    "https://untypedlimit.org/robots.txt": ROBOTS_OPEN,
    "https://untypedlimit.org/": { throws: "bad_content_type_http_429" },
  }, { org: "Untyped Limit Trust" });
  eq(report.outcome, "blocked_bot", "a 429 with an unreadable content-type is blocked_bot");
}
{
  const { report } = await run("https://untypederror.org", {
    "https://untypederror.org/robots.txt": ROBOTS_OPEN,
    "https://untypederror.org/": { throws: "bad_content_type_http_500" },
  }, { org: "Untyped Error Trust" });
  eq(report.outcome, "fetch_failed", "a 500 with an unreadable content-type stays fetch_failed");
  ok(report.reason.includes("500"), "and names the status rather than a generic transport failure");
}
{
  eq(ctRefusalReason(200), "bad_content_type", "a 2xx with a bad content-type keeps the plain reason");
  eq(ctRefusalReason(403), "bad_content_type_http_403", "a refusal status is carried in the reason");
}

// 13b. Weak markers are prose. A page the server actually served (2xx) can no
// longer be reclassified as a block by ordinary English — the words "forbidden",
// "rate limit" or "you have been blocked" appearing in a thin page's text.
{
  eq(looksLikeBotChallenge(200, "Dogs are forbidden inside the hall itself.", 300).blocked, false,
    "'forbidden' in prose does not block a served 200");
  eq(looksLikeBotChallenge(200, "It takes just a moment to donate online.", 300).blocked, false,
    "'just a moment' without the ellipsis is a sentence, not a Cloudflare title");
  eq(looksLikeBotChallenge(200, "<title>Just a moment...</title>", 40).blocked, true,
    "the Cloudflare title with its ellipsis still blocks a 200");
  eq(looksLikeBotChallenge(403, "Access denied", 0).marker, "access denied page",
    "a weak marker still NAMES a refusal whose status already proves it");
  // A 503 whose body merely says "rate limit" is now reported by its status
  // (fetch_failed, HTTP 503) — less specific, never false. The old behaviour
  // let two words of prose reclassify any thin 503 maintenance page.
  eq(looksLikeBotChallenge(503, "rate limit exceeded", 30).blocked, false,
    "'rate limit' alone no longer flags a 503");
}
// End to end: a real page whose prose contains "forbidden" — with named
// referents and a matching identity — is succeeded. It used to be blocked_bot.
{
  const body = "<p>The food hall on Maldon Road opens every Tuesday and Friday morning. " +
    "Dogs are forbidden inside the hall itself, though guide dogs are always welcome, " +
    "and volunteers meet visitors at the Maldon Road entrance from nine.</p>";
  const { report } = await run("https://fenwickpantry.org", {
    "https://fenwickpantry.org/robots.txt": ROBOTS_OPEN,
    "https://fenwickpantry.org/": { status: 200, body: plain("fenwick pantry", body) },
  }, { org: "Fenwick Pantry", legalName: "Fenwick Pantry" });
  eq(report.outcome, "succeeded", "a served page whose prose says 'forbidden' classifies on its content");
  ok(report.referents_surviving >= 1, "and its referents survive");
}

// 13c. A mount-point div with no script is markup, not an application shell.
// "Draws its text with JavaScript" must never be said of a page that loads none.
{
  const staticApp = `<html><head><title>hall</title></head><body><div id="app"><h1>Hall</h1></div></body></html>`;
  eq(looksLikeJsShell(staticApp, 12).shell, false,
    "a scriptless page using id=\"app\" as markup is not a JS shell");
  eq(looksLikeJsShell(`<div id="root"></div>`, 0).shell, false,
    "an empty mount point with zero script characters is markup too");
  const { report } = await run("https://scriptless.org", {
    "https://scriptless.org/robots.txt": ROBOTS_OPEN,
    "https://scriptless.org/": { status: 200, body: staticApp },
  }, { org: "Scriptless Hall Trust" });
  eq(report.outcome, "extraction_failed", "and the crawl classifies it extraction_failed, never js_only");
}

// 13d. Entities and charsets: mis-decoded prose used to strip into junk that
// the prose detector then (correctly) refused — a false extraction_failed with
// a true-looking reason.
{
  const t = stripHtml("<p>St Aidan&#8217;s Hall on Bramley&nbsp;Road &amp; the caf&eacute; &#x2014; open daily</p>");
  ok(t.includes("St Aidan’s Hall"), "numeric entities decode instead of surviving as residue");
  ok(t.includes("Road & the café"), "named entities decode to their characters");
  ok(t.includes("—"), "hex entities decode");
  ok(!/&#\d+;|&#x[0-9a-f]+;/i.test(t), "no numeric residue remains in the text");
}
{
  const cafe1252 = new Uint8Array([0x63, 0x61, 0x66, 0xE9]); // "café" in windows-1252
  eq(decodeBody(cafe1252, "text/html; charset=iso-8859-1"), "café", "the declared charset is honoured");
  const meta = `<meta charset="windows-1252">café`;
  const metaBytes = new Uint8Array([...meta].map((c) => c.charCodeAt(0)));
  eq(decodeBody(metaBytes, "text/html").endsWith("café"), true,
    "a meta charset is sniffed when the header names none");
  eq(decodeBody(new Uint8Array([0x68, 0x69]), "text/html; charset=x-klingon"), "hi",
    "an unknown charset label falls back to UTF-8 rather than failing the fetch");
}

// 13e. The parsed-page boundary matches the traversal's own threshold. The
// extraction keeps a page only when text.length > 120; a classifier counting
// >= 120 could describe a page as parsed that the crawl would never have kept.
{
  const page = (kept: number) => ({
    url: "https://edge.org/", role: "home" as const, status: 200, error: null,
    content_type: "text/html", html_chars: 900, text_chars: 400, kept_chars: kept,
    script_chars: 0, prose: true, body_sample: "",
  });
  const base = (kept: number): ClassifyInput => ({
    website: "https://edge.org", domain: "edge.org", bad_url: false,
    robots: { fetched: true, status: 200, allowed: true, rule: null, error: null },
    pages: [page(kept)], fetch_budget_exhausted: false, discovered: 1, elapsed_ms: 5,
    referents_extracted: 0, referents_surviving: 0, identity_gate: "not_run",
    site_derived_output: false,
  });
  eq(classifyCrawl(base(PAGE_MIN_CHARS)).pages_parsed, 0,
    "exactly 120 kept characters is NOT a parsed page — the traversal would not have kept it");
  eq(classifyCrawl(base(PAGE_MIN_CHARS)).outcome, "extraction_failed", "and the outcome says so");
  eq(classifyCrawl(base(PAGE_MIN_CHARS + 1)).pages_parsed, 1, "one character over the floor is parsed");
}

// 13f. Malformed robots.txt cannot fabricate a block, and the most specific
// group wins. Every crawler's UA contains the empty string, so an empty
// User-agent line used to create a group that matched EVERYONE.
{
  eq(robotsAllows(parseRobots("User-agent:\nDisallow: /\n"), "/").allowed, true,
    "a User-agent line with no token cannot fabricate a robots block");
  const r = parseRobots("User-agent: bot\nDisallow: /\n\nUser-agent: kteblibot\nDisallow: /private/\n");
  eq(robotsAllows(r, "/").allowed, true,
    "the most specific matching group wins, not the first stated");
  eq(robotsAllows(r, "/private/x").allowed, false, "and its own rules still apply");
}

// 13g. nothing_relevant no longer hides refused subpages. A rate limiter that
// serves the homepage and 429s everything after it is not "a thin site".
{
  const vague = "<p>we support people gently and patiently across the town, every week of the year, " +
    "whatever the weather brings to the door, and we are glad of every pair of hands offered.</p>";
  const { report } = await run("https://ratelimited.org", {
    "https://ratelimited.org/robots.txt": ROBOTS_OPEN,
    "https://ratelimited.org/": {
      status: 200,
      body: `<!doctype html><html><head><title>quiet trust</title></head><body>` +
        `<nav><a href="/about">about</a><a href="/our-work">our work</a></nav>${vague}</body></html>`,
    },
    "https://ratelimited.org/about": { status: 429, contentType: "text/plain", body: "too many requests" },
    "https://ratelimited.org/our-work": { status: 429, contentType: "text/plain", body: "too many requests" },
  }, { org: "Quiet Trust", legalName: "Quiet Trust", siteDerived: true });
  eq(report.outcome, "nothing_relevant", "the served homepage still classifies on its own content");
  ok(report.reason.includes("2 further page(s) were refused"),
    "but the refused subpages are named in the reason");
}

// ===========================================================================
section("14. site furniture is not evidence (phase 5 live-run finding)");
// ===========================================================================
//
// On every real charity site the live run crawled, two-thirds of the extracted
// "referents" were navigation glued into giant capitalised runs: "Sufra NW
// London Volunteer Donate Get Help Menu Home About About", a 30-language
// selector, card-grid labels ("Donate Learn More"). A succeeded(308) whose 308
// are mostly menu labels misdescribes the crawl, and those counts feed the
// sufficiency gate and the phase-6 benchmark. This section pins the fix at all
// three layers from one canned page.

// A realistic small-charity page: nav menu, language selector, all-caps banner,
// card grid, footer link list — and two real paragraphs of prose.
const FURNISHED_PAGE = `<!doctype html>
<html><head><title>riverbank pantry</title></head><body>
<header>
  <nav><ul>
    <li><a href="/">Home</a></li><li><a href="/about">About Us</a></li>
    <li><a href="/our-work">Our Work</a></li><li><a href="/donate">Donate</a></li>
    <li><a href="/volunteer">Volunteer</a></li><li><a href="/news">News And Events</a></li>
    <li><a href="/contact">Contact Us</a></li>
  </ul></nav>
  <select><option>English</option><option>Arabic</option><option>Polish</option>
  <option>Romanian</option><option>Urdu</option></select>
  <div>WE ARE CLOSED OVER THE BANK HOLIDAY</div>
</header>
<main>
  <div class="cards">
    <div class="card"><h3>Food Aid</h3><a href="/food">Learn More</a></div>
    <div class="card"><h3>Advice Service</h3><a href="/advice">Learn More</a></div>
    <div class="card"><h3>Community Garden</h3><a href="/garden">Learn More</a></div>
  </div>
  <p>Riverbank Pantry has run a weekly food club from St Cuthbert's Church Hall on
  Weaver Street since 2017, serving about sixty households across the Deeside ward.</p>
  <p>We work with Chester Foodshare and with Cheshire West Council on referrals, and
  our growing plot behind Hoole Community Centre supplies the club each summer.</p>
</main>
<footer>
  <ul><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms</a></li>
  <li><a href="/safeguarding">Safeguarding Policy</a></li></ul>
  <p>Registered charity number 1180000. Riverbank Pantry, Weaver Street, Chester.</p>
</footer>
</body></html>`;

// Layer 1: stripHtml removes furniture elements and emits real block boundaries.
{
  const t = stripHtml(FURNISHED_PAGE);
  ok(!t.includes("Volunteer"), "nav menu content is removed entirely");
  ok(!t.includes("Romanian"), "the language selector is removed entirely");
  ok(t.includes("\n"), "block elements produce real line boundaries");
  ok(!/Learn More[ \t]+(Advice|Community)/.test(t),
    "card labels no longer share a line with the next card's title");
  ok(t.includes("Registered charity number 1180000"),
    "the footer's charity number and address SURVIVE — footers carry real facts");
  const pretty = stripHtml("<p>The pantry opened\n  in 2017 and serves\n  sixty households.</p>");
  eq(pretty, "The pantry opened in 2017 and serves sixty households.",
    "pretty-printed source newlines do NOT become line boundaries");
}

// Layer 2: keepParagraphs refuses unpunctuated capitalised-majority link runs.
{
  eq(isFurniture("Home About Us Our Work Donate Volunteer News And Events Contact Us"), true,
    "a menu run with no punctuation and capitalised words is furniture");
  eq(isFurniture("we support families across the Deeside ward whatever the season"), false,
    "an unpunctuated lowercase-majority mission line is NOT furniture");
  eq(isFurniture("The pantry opened in 2017 and serves sixty households."), false,
    "punctuated prose is never furniture, whatever its capitalisation");
  const seen = new Set<string>();
  const kept = keepParagraphs(
    "Food Aid Advice Service Community Garden Winter Appeal Business Partners Programme\n" +
    "St Cuthbert's flooded in January 2021 and the club moved to Hoole Community Centre for a year.",
    seen);
  eq(kept.length, 1, "the link run is dropped, the prose paragraph is kept");
  ok(/flooded in January/.test(kept[0] ?? ""), "and it is the right one");
}

// Layer 3: siteReferents refuses seven-word runs outright, and a single word
// that also occurs in lowercase in the corpus is position, not a name.
{
  const refs = siteReferents(
    "Sufra NW London Volunteer Donate Get Help Menu Home About Mission Principles Annual Reports. " +
    "The club runs from St Cuthbert's Church Hall on Weaver Street.", "Riverbank Pantry");
  ok(!refs.some((r) => r.split(/\s+/).length > 6), "no referent is longer than six words");
  ok(refs.some((r) => /Weaver Street/.test(r)), "real referents still come through");

  const refs2 = siteReferents(
    "However the club kept going. Volunteers said, however, that Brent needed more. " +
    "Deliveries reach Kilburn each week.", "Riverbank Pantry");
  ok(!refs2.includes("However"), "a sentence-opener that occurs lowercase elsewhere is not a referent");
  ok(refs2.includes("Brent") && refs2.includes("Kilburn"),
    "single-word names with no lowercase occurrence are kept");

  // The counter trims its stop words at phrase edges, which can leave a
  // dangling connective ("Board of Trustees" -> "of Trustees"). Edge glue is
  // debris; internal glue ("London Borough of Brent") is structure.
  const refs3 = siteReferents(
    "Board of Trustees meets quarterly. Deliveries reach the London Borough of Brent weekly.",
    "Riverbank Pantry");
  ok(!refs3.some((r) => /^(of|the|and|for)\s/.test(r)), "no referent starts with dangling glue");
  ok(refs3.some((r) => r === "London Borough of Brent"), "internal connectives are untouched");
}

// End to end: the furnished page yields the real referents and only those.
{
  const { report, referents } = await run("https://riverbankpantry.org", {
    "https://riverbankpantry.org/robots.txt": ROBOTS_OPEN,
    "https://riverbankpantry.org/": { status: 200, body: FURNISHED_PAGE },
  }, { org: "Riverbank Pantry", legalName: "Riverbank Pantry" });
  eq(report.outcome, "succeeded", "the page still succeeds on its actual prose");
  ok(referents.some((r) => /St Cuthbert/.test(r)), "the church hall is a referent");
  ok(referents.some((r) => /Chester Foodshare/.test(r)), "the named partner is a referent");
  ok(referents.some((r) => /Cheshire West Council/.test(r)), "the council is a referent");
  ok(!referents.some((r) => /Donate|Learn More|Privacy|Menu/i.test(r)),
    `no menu label survives as a referent (got: ${referents.join(" | ").slice(0, 120)})`);
  ok(!referents.some((r) => r.split(/\s+/).length > 6), "and nothing longer than six words");
  ok(report.referents_extracted <= 12,
    `the count is a count of NAMES, not of furniture (${report.referents_extracted})`);
}

// ===========================================================================
section("15. machine files are not pages (critic finding)");
// ===========================================================================
//
// Child sitemaps (sitemap-1.xml, image-sitemap-1.xml) and /wp-json passed the
// extension filter, were fetched as role "page" through the default
// content-type allowlist (which must admit XML for robots and sitemaps), and
// their machine tokens were stripped as HTML and counted as referents in three
// of the seven live crawls. Two independent fixes are pinned here: page
// discovery skips machine-file URLs, and content fetches accept only HTML-ish
// content types.
{
  const prose = "<p>Riverbank Pantry runs a weekly food club from St Cuthbert's Church Hall on " +
    "Weaver Street since 2017, serving about sixty households across the Deeside ward.</p>";
  const table = {
    "https://wp-site.org/robots.txt": ROBOTS_OPEN,
    "https://wp-site.org/": {
      status: 200,
      body: `<html><head><title>riverbank pantry</title></head><body>` +
        `<a href="/about">about</a><a href="/wp-json/">api</a><a href="/feed">feed</a>` +
        `<a href="/sitemap-1.xml">sitemap</a>${prose}</body></html>`,
    },
    "https://wp-site.org/sitemap.xml": {
      status: 200, contentType: "application/xml",
      body: "<sitemapindex><sitemap><loc>https://wp-site.org/sitemap-1.xml</loc></sitemap>" +
        "<sitemap><loc>https://wp-site.org/image-sitemap-1.xml</loc></sitemap></sitemapindex>",
    },
    // If these WERE fetched as pages, their tokens would poison the corpus.
    "https://wp-site.org/sitemap-1.xml": {
      status: 200, contentType: "application/xml",
      body: "<urlset><url><loc>https://wp-site.org/QWtpY0P</loc></url>" +
        "<url><loc>https://wp-site.org/MviZ3SLG</loc></url></urlset>",
    },
    "https://wp-site.org/image-sitemap-1.xml": {
      status: 200, contentType: "application/xml",
      body: "<urlset><url><loc>https://wp-site.org/Backup-Helper-Script.png</loc></url></urlset>",
    },
    "https://wp-site.org/wp-json": {
      status: 200, contentType: "application/json",
      body: `{"name":"Backup Helper Script","description":"Arbitrary Machine Tokens QWtpY0P"}`,
    },
    "https://wp-site.org/feed": {
      status: 200, contentType: "application/xml",
      body: "<rss><channel><title>Arbitrary Feed Tokens</title></channel></rss>",
    },
    "https://wp-site.org/about": { status: 200, body: plain("about riverbank",
      "<p>Our trustees meet at Hoole Community Centre, and Chester Foodshare collects surplus every Friday morning before the club opens its doors to the first families of the day.</p>") },
  };
  const fetcher = fixtureFetcher(table);
  const crawl = await crawlSiteObserved("https://wp-site.org", fetcher);
  const pageUrls = crawl.pages.map((p) => p.url);
  ok(!pageUrls.some((u) => /\.xml|wp-json|\/feed/.test(u)),
    `no machine file is a content page (pages: ${pageUrls.join(", ")})`);
  ok(!fetcher.seen.some((u) => /sitemap-1\.xml|image-sitemap/.test(u)),
    "child sitemaps are not even fetched — the page budget is not spent on them");
  const referents = siteReferents(crawlCorpus(crawl.pages), "Riverbank Pantry");
  ok(!referents.some((r) => /QWtpY0P|MviZ3SLG|Backup|Arbitrary/i.test(r)),
    "no machine token reaches the referent list");
  ok(referents.some((r) => /Chester Foodshare/.test(r)), "real referents still come through");

  // The content-type backstop stands on its own: a machine URL that dodges the
  // URL filter (no extension) is still refused by content type, with the
  // refusal recorded, and the crawl is not poisoned.
  const table2 = {
    "https://api-link.org/robots.txt": ROBOTS_OPEN,
    "https://api-link.org/": {
      status: 200,
      body: `<html><head><title>api link</title></head><body><a href="/about">about</a>${prose}</body></html>`,
    },
    "https://api-link.org/about": {
      status: 200, contentType: "application/json",
      body: `{"machine":"Arbitrary Backup Helper Script Tokens"}`,
    },
  };
  const crawl2 = await crawlSiteObserved("https://api-link.org", fixtureFetcher(table2));
  ok(!crawl2.pages.some((p) => p.url.endsWith("/about")),
    "a JSON body never becomes a content page, whatever its URL looks like");
  const aboutObs = crawl2.observations.pages.find((p) => p.url.endsWith("/about"));
  eq(aboutObs?.error, "bad_content_type", "and the refusal is recorded, not swallowed");
  const refs2 = siteReferents(crawlCorpus(crawl2.pages), "Riverbank Pantry");
  ok(!refs2.some((r) => /Backup|Arbitrary/i.test(r)), "its tokens never reach the referents");
}

// B (critic finding): the identity gate's name candidates must not carry entity
// residue — and the en dash hiding inside &#8211; must still split the <title>.
{
  const cands = siteNameCandidates(
    `<html><head><title>Cart &#8211; The Magpie Project</title></head><body></body></html>`);
  ok(cands.includes("The Magpie Project"),
    `the real site name is a candidate despite the encoded separator (got: ${cands.join(" / ")})`);
  ok(!cands.some((c) => /&#|&\w+;/.test(c)), "no candidate carries entity residue");
  const og = siteNameCandidates(
    `<meta property="og:site_name" content="S&#252;fra NW London">`);
  ok(og.includes("S\u00fcfra NW London"), "og:site_name is decoded too");
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CRAWL-OUTCOME CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures) Deno.exit(1);
