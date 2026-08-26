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
  keepParagraphs,
  looksLikeBotChallenge,
  looksLikeJsShell,
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
  const fn = async (url: string, _opts: FetchOpts): Promise<FetchResult> => {
    seen.push(url);
    const key = url.replace(/\/$/, "");
    const e = table[url] ?? table[key] ?? table[key + "/"];
    if (!e) throw new Error("dns_unresolved");   // nothing else exists on this fixture host
    if ("throws" in e) throw new Error(e.throws);
    await Promise.resolve();
    return {
      finalUrl: e.finalUrl ?? url,
      status: e.status,
      contentType: e.contentType ?? "text/html; charset=utf-8",
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
console.log(`\n${failures === 0 ? "ALL CRAWL-OUTCOME CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures) Deno.exit(1);
