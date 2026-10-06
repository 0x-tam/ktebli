import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parsePpa,
  parseCdr,
  mergeRecords,
  enrichPpa,
  ppaNext,
  dateOnly,
  ppaApplicationStatus,
} from "../src/adapters.mjs";
import { initialState, acceptPage, summary } from "../src/run.mjs";
import {
  allowedUrl,
  publicIp,
  resolvePublic,
  SafeHttp,
} from "../src/safe-http.mjs";
import { crawlCdrBrowser } from "../src/cdr-browser.mjs";
import {
  crawlUngmCurated,
  parseUngmNotice,
  ungmNoticeUrl,
} from "../src/ungm.mjs";
import {
  crawlMawredAwards,
  MAWRED_URL,
  parseMawredAwards,
} from "../src/mawred.mjs";
import {
  cleanWorldBankText,
  crawlWorldBank,
  parseWorldBankNotice,
  worldBankQuery,
} from "../src/worldbank.mjs";
const fixture = (name) =>
  readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const url = "https://www.ppa.gov.lb/en/tenders";
test("real PPA page captures all 50 records and next cursor; opening is not a deadline", async () => {
  const p = parsePpa(await fixture("ppa-en-first.html"), url);
  assert.equal(p.records.length, 50);
  assert.equal(p.expectedTotal, 1165);
  assert.equal(p.next, `${url}?page=2`);
  assert.equal(p.records[0].deadline, null);
  assert.equal(p.records[0].publishedAt, "2026-10-05");
});
test("Arabic and English issuer IDs merge while retaining both locale evidence", async () => {
  const en = parsePpa(await fixture("ppa-en-first.html"), url).records[0];
  const ar = parsePpa(
    await fixture("ppa-ar-first.html"),
    "https://www.ppa.gov.lb/ar/tenders",
  ).records[0];
  const m = mergeRecords(en, ar);
  assert.equal(m.sourceKey, "ppa:12982");
  assert.deepEqual(
    m.locales.map((v) => v.locale),
    ["ar", "en"],
  );
  assert.equal(m.sourceUrl, en.sourceUrl);
});
test("real PPA detail uses explicit submission date", async () => {
  const record = parsePpa(await fixture("ppa-en-first.html"), url).records[0];
  const p = enrichPpa(
    record,
    await fixture("ppa-en-detail.html"),
    record.sourceUrl,
  );
  assert.equal(p.deadline, "2026-11-02");
  assert.equal(p.detailStatus, "verified");
});
test("PPA competition status follows explicit issuer fields, never title wording", async () => {
  const listing = await fixture("ppa-en-first.html");
  const page = parsePpa(listing, url);
  assert.equal(page.records[0].sourceKey, "ppa:12982");
  assert.equal(page.records[0].applicationStatus, "needs_verification");
  const direct = parsePpa(
    listing.replace(/>\s*Auction\s*<\/td>/, ">Direct</td>"),
    url,
  ).records[0];
  assert.equal(direct.applicationStatus, "not_open_competition");
  assert.equal(
    ppaApplicationStatus([
      { label: "Tender title", text: "Awarded supplier tender" },
      { label: "Procurement method", text: "Open" },
    ]),
    "needs_verification",
  );
  assert.equal(
    ppaApplicationStatus([
      { label: "Procuring Method :", text: "Open" },
      { label: "Tender status :", text: "Cancelled" },
    ]),
    "closed",
  );
  const withAward = enrichPpa(
    page.records[0],
    (await fixture("ppa-en-detail.html")).replace(
      "<tbody>",
      "<tbody><tr><td><strong>Tender status :</strong></td><td>Awarded</td></tr>",
    ),
    page.records[0].sourceUrl,
  );
  assert.equal(withAward.applicationStatus, "closed");
});
test("CDR ignores hidden header rows, retains lot IDs and separate language evidence", async () => {
  const p = parseCdr(
    await fixture("cdr-row.html"),
    "https://www.cdr.gov.lb/en-US/Procurment.aspx",
  );
  assert.equal(p.records.length, 1);
  assert.equal(p.records[0].sourceKey, "cdr:1293:lot:0");
  assert.equal(p.records[0].deadline, "2026-11-05");
  assert.equal(p.terminal, false);
});
test("resume state stays incomplete after first page; rejects duplicates, skips, false terminal", async () => {
  const state = initialState(),
    p = parsePpa(await fixture("ppa-en-first.html"), url);
  acceptPage(state, "ppa:en", p);
  assert.equal(summary(state).status, "incomplete");
  assert.throws(() => acceptPage(state, "ppa:en", p), /pagination_no_progress/);
  const s = initialState();
  assert.throws(
    () => acceptPage(s, "ppa:en", { ...p, next: null }),
    /pagination_total_mismatch/,
  );
  assert.equal(Object.keys(s.records).length, 0);
});
test("unknown zero rows and unrecognised structure cannot declare coverage", () => {
  assert.throws(
    () => parsePpa("<p>No results</p>", url),
    /listing_schema_changed/,
  );
  assert.equal(dateOnly("opening soon"), null);
  assert.equal(dateOnly("2026-02-31"), null);
  assert.equal(dateOnly("12-Oct-2026 06:00"), "2026-10-12");
});
test("official curated UNGM grant detail retains issuer, deadline time, and limited scope", async () => {
  const html = await fixture("ungm-grant-316003.html");
  const url = ungmNoticeUrl("316003");
  const record = parseUngmNotice(html, url, "2026-10-05T12:00:00Z");
  assert.equal(record.sourceKey, "ungm:316003");
  assert.equal(record.kind, "grant");
  assert.equal(record.deadline, "2026-10-12");
  assert.equal(record.deadlineLocal, "2026-10-12T06:00");
  assert.equal(record.deadlineTimezone, "GMT -4.00");
  assert.equal(record.applicationStatus, "needs_verification");
  assert.throws(
    () => parseUngmNotice(html, ungmNoticeUrl("316004")),
    /issuer_id_mismatch/,
  );
  assert.throws(
    () =>
      parseUngmNotice(
        html.replace(
          '<span class="value"> Lebanon</span>',
          '<span class="value"> Syria</span>',
        ),
        url,
      ),
    /outside_lebanon_scope/,
  );
  assert.throws(
    () => parseUngmNotice(html.replace("06:00 (GMT", "99:00 (GMT"), url),
    /invalid_deadline_time/,
  );
  assert.throws(
    () =>
      parseUngmNotice(
        html.replace(
          '<div class="title">Description</div>',
          '<div class="title">Description</div>' + "x".repeat(12001),
        ),
        url,
      ),
    /detail_exceeds_contract/,
  );
  for (const forbidden of [
    "https://www.ungm.org/Public/Notice",
    "https://www.ungm.org/Public/Notice/316003?preview=true",
    "https://www.ungm.org/Public/Notice/316003?page=1",
    "https://www.ungm.org/Public/Notice/316003/extra",
  ])
    assert.throws(() => allowedUrl(forbidden));
  const state = { version: 1, entries: {} };
  let saved = 0;
  const http = { get: async (requested) => ({ body: html, url: requested }) };
  const first = await crawlUngmCurated({
    ids: ["316003"],
    state,
    save: async () => {
      saved++;
    },
    http,
    now: "2026-10-05T12:00:00Z",
    maxDetails: 1,
  });
  assert.equal(first.coverage.status, "complete");
  assert.match(first.coverage.scope, /Curated/);
  assert.equal(saved, 1);
  const stale = await crawlUngmCurated({
    ids: ["316003"],
    state,
    save: async () => {
      saved++;
    },
    http,
    now: "2026-10-07T12:00:00Z",
    maxDetails: 0,
  });
  assert.equal(stale.coverage.status, "incomplete");
  assert.equal(stale.records[0].detailStatus, "partial");
  assert.equal(stale.records[0].locales[0].detailNeedsRefresh, true);
});
test("official Mawred grant requires age, Arab origin, organization exclusion, and Beirut deadline", async () => {
  const html = await fixture("mawred-production-awards.html");
  const record = parseMawredAwards(html, MAWRED_URL, "2026-10-05T12:00:00Z");
  assert.equal(record.sourceKey, "mawred:production-awards:2026");
  assert.equal(record.kind, "grant");
  assert.equal(record.deadline, "2026-10-19");
  assert.equal(record.deadlineLocal, "2026-10-19T16:00");
  assert.equal(record.deadlineTimezone, "Asia/Beirut");
  assert.equal(record.applicationStatus, "needs_verification");
  assert.match(record.description, /support for entities or organizations/);
  assert.match(
    record.description,
    /born between January 1992 and December 2011/,
  );
  const fullPageEvidence = record.evidence
    .filter((item) => item.label.startsWith("Publisher program content"))
    .map((item) => item.text)
    .join(" ");
  assert.match(
    fullPageEvidence,
    /application must be completed entirely in Arabic/i,
  );
  assert.match(fullPageEvidence, /two guarantors/i);
  assert.ok(record.evidence.every((item) => item.text.length <= 1500));
  assert.throws(
    () => parseMawredAwards(html, "https://mawred.org/robots.txt"),
    /unexpected_awards_url/,
  );
  assert.throws(
    () =>
      parseMawredAwards(
        html.replace(
          "Applicants who originate from an Arab country",
          "Applicants who originate from Europe",
        ),
        MAWRED_URL,
      ),
    /award_schema_changed/,
  );
  assert.throws(() =>
    allowedUrl(
      "https://mawred.org/artistic-creativity/production-awards/?lang=ar",
    ),
  );
  assert.throws(() => allowedUrl("https://mawred.org/wp-admin/"));
  assert.throws(() => allowedUrl("https://www.goethe.de/en/kul/foe/int.html"));
  const state = { version: 1 };
  let saved = 0;
  const first = await crawlMawredAwards({
    state,
    save: async () => {
      saved++;
    },
    now: "2026-10-05T12:00:00Z",
    http: { get: async () => ({ body: html, url: MAWRED_URL }) },
  });
  assert.equal(first.coverage.status, "complete");
  assert.equal(saved, 1);
  const stale = await crawlMawredAwards({
    state,
    save: async () => {
      saved++;
    },
    now: "2026-10-07T12:00:00Z",
    http: {
      get: async () => {
        throw Object.assign(new Error("blocked"), { code: "access_blocked" });
      },
    },
  });
  assert.equal(stale.coverage.status, "incomplete");
  assert.equal(stale.coverage.error, "access_blocked");
  assert.equal(stale.records[0].detailStatus, "partial");
});
test("official World Bank notice retains full Lebanon procurement evidence without inventing timezone", async () => {
  const raw = JSON.parse(await fixture("worldbank-lebanon-notice.json"));
  const record = parseWorldBankNotice(raw, "2026-10-06T03:00:00Z");
  assert.equal(record.sourceKey, "worldbank:OP00471722");
  assert.equal(
    record.sourceUrl,
    "https://projects.worldbank.org/en/projects-operations/procurement-detail/OP00471722",
  );
  assert.equal(record.geography.status, "lebanon_confirmed");
  assert.equal(record.geography.evidence[0].text, "Lebanon");
  assert.equal(record.identityClaim.reference, "OP00471722");
  assert.equal(record.deadline, "2026-10-08");
  assert.equal(record.deadlineLocal, "2026-10-08T12:00");
  assert.equal(record.deadlineTimezone, null);
  assert.equal(record.detailStatus, "verified");
  assert.ok(record.description.length < 6000);
  assert.ok(record.evidence.every((item) => item.text.length <= 1500));
  assert.equal(
    record.evidence
      .filter((item) =>
        item.label.startsWith("Publisher notice scope and requirements"),
      )
      .map((item) => item.text)
      .join(" "),
    cleanWorldBankText(raw.notice_text),
  );
  assert.match(record.evidence[0].text, /RECONSTRUCTION BEIRUT/);
  assert.throws(
    () => parseWorldBankNotice({ ...raw, project_ctry_name: "Jordan" }),
    /outside_lebanon_scope/,
  );
  assert.throws(
    () => parseWorldBankNotice({ ...raw, submission_deadline_time: "99:00" }),
    /wb_deadline_time_invalid/,
  );
  assert.throws(
    () => parseWorldBankNotice({ ...raw, notice_text: "x".repeat(12001) }),
    /wb_notice_text_exceeds_contract/,
  );
  assert.equal(
    parseWorldBankNotice({ ...raw, notice_status: "Cancelled" }).excluded,
    "not_published",
  );
});
test("World Bank API guard fixes Lebanon and bounded query; pagination must finish exactly", async () => {
  const raw = JSON.parse(await fixture("worldbank-lebanon-notice.json"));
  const query = worldBankQuery("2026-10-06", 1, 0);
  assert.equal(allowedUrl(query).hostname, "search.worldbank.org");
  for (const bad of [
    query.replace("project_ctry_name=Lebanon", "project_ctry_name=Jordan"),
    query + "&project_ctry_name=Lebanon",
    query.replace("rows=1", "rows=10000"),
    query.replace("deadline_strdate=2026-10-06", "deadline_strdate=2026-13-06"),
    query.replace("search.worldbank.org", "search.worldbank.org.evil"),
    "https://search.worldbank.org/api/v2/procnotices",
  ])
    assert.throws(() => allowedUrl(bad));
  let saved = 0;
  const state = { version: 1 };
  const first = await crawlWorldBank({
    state,
    save: async () => saved++,
    now: "2026-10-06T03:00:00Z",
    rows: 1,
    maxPages: 2,
    http: {
      get: async (url) => ({
        body: JSON.stringify({
          total: 1,
          os: new URL(url).searchParams.get("os"),
          procnotices: [raw],
        }),
        url,
      }),
    },
  });
  assert.equal(first.coverage.status, "complete");
  assert.equal(first.coverage.apiTotal, 1);
  assert.equal(first.records.length, 1);
  assert.ok(saved >= 2);
  const duplicateState = { version: 1 };
  const duplicate = await crawlWorldBank({
    state: duplicateState,
    save: async () => {},
    now: "2026-10-06T03:00:00Z",
    rows: 1,
    maxPages: 2,
    http: {
      get: async (url) => ({
        body: JSON.stringify({
          total: 2,
          os: new URL(url).searchParams.get("os"),
          procnotices: [raw],
        }),
        url,
      }),
    },
  });
  assert.equal(duplicate.coverage.status, "incomplete");
  assert.equal(duplicate.coverage.error, "wb_pagination_duplicate_or_count");
  assert.equal(duplicate.records.length, 0);
  const staleDate = await crawlWorldBank({
    state: { version: 1 },
    save: async () => {},
    now: "2026-10-09T03:00:00Z",
    rows: 1,
    http: {
      get: async (url) => ({
        body: JSON.stringify({ total: 1, os: 0, procnotices: [raw] }),
        url,
      }),
    },
  });
  assert.equal(staleDate.coverage.error, "wb_deadline_filter_changed");
  assert.equal(staleDate.records.length, 0);
});
test("pagination only follows consecutive, same-publisher, same-locale HTTPS links", () => {
  assert.equal(
    ppaNext("http://www.ppa.gov.lb/en/tenders?page=2", url),
    `${url}?page=2`,
  );
  for (const link of [
    "https://evil.example/en/tenders?page=2",
    "https://www.ppa.gov.lb/ar/tenders?page=2",
    `${url}?page=1`,
    `${url}?page=4`,
  ])
    assert.throws(() => ppaNext(link, url));
});
test("SSRF rejects private, mapped, reserved IPs; mixed DNS fails closed", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2001:db8::1",
  ])
    assert.equal(publicIp(ip), false, ip);
  assert.equal(publicIp("1.1.1.1"), true);
  await assert.rejects(
    resolvePublic("www.ppa.gov.lb", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
    /non_public_dns/,
  );
  for (const u of [
    "http://www.ppa.gov.lb/en",
    "https://www.ppa.gov.lb:444/en",
    "https://user:pass@www.ppa.gov.lb/en",
    "https://www.ppa.gov.lb.evil/en",
    "https://www.ppa.gov.lb/en/login",
  ])
    assert.throws(() => allowedUrl(u));
});
test("redirects revalidate destinations and DNS, robots disallow prevents page request", async () => {
  let pages = 0;
  const resolver = async () => [{ address: "1.1.1.1", family: 4 }];
  const http = new SafeHttp({
    resolver,
    minIntervalMs: 0,
    transport: async (u) =>
      u.pathname === "/robots.txt"
        ? {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: "User-agent: *\nDisallow: /en/tenders",
          }
        : (pages++,
          {
            status: 200,
            headers: { "content-type": "text/html" },
            body: "ok",
          }),
  });
  await assert.rejects(http.get(url), /robots_disallowed/);
  assert.equal(pages, 0);
  const redirect = new SafeHttp({
    resolver,
    minIntervalMs: 0,
    transport: async (u) =>
      u.pathname === "/robots.txt"
        ? { status: 404, headers: {}, body: "" }
        : { status: 302, headers: { location: "http://127.0.0.1" }, body: "" },
  });
  await assert.rejects(redirect.get(url), /url_not_allowed/);
});
test("CDR driver refuses unguarded browser; no-progress is incomplete", async () => {
  await assert.rejects(
    crawlCdrBrowser({ driver: {} }),
    /safe_browser_driver_required/,
  );
  const html = await fixture("cdr-row.html");
  const driver = {
    networkPolicy: {
      httpsOnly: true,
      publicIpPinned: true,
      robotsEnforced: true,
    },
    openApprovedStage: async () => {},
    snapshot: async () => ({
      html,
      url: "https://www.cdr.gov.lb/en-US/Procurment.aspx",
      loadMoreVisible: true,
      loadMoreEnabled: true,
    }),
    clickLoadMore: async () => {},
    waitForChange: async () => {},
  };
  const result = await crawlCdrBrowser({ driver, maxLoads: 2 });
  assert.equal(result.status, "incomplete");
  assert.equal(result.error, "pagination_no_progress");
});
test("conflicting locale deadlines remain unresolved", () => {
  const base = {
    sourceKey: "ppa:1",
    locales: [{ locale: "en", deadline: "2026-11-01", evidence: [] }],
  };
  const m = mergeRecords(base, {
    sourceKey: "ppa:1",
    locales: [{ locale: "ar", deadline: "2026-11-02", evidence: [] }],
  });
  assert.equal(m.deadline, null);
  assert.equal(m.deadlineConflict, true);
});
test("CDR page budget never silently completes; settled missing control can finish", async () => {
  const html = await fixture("cdr-row.html");
  const driver = {
    networkPolicy: {
      httpsOnly: true,
      publicIpPinned: true,
      robotsEnforced: true,
    },
    openApprovedStage: async () => {},
    snapshot: async () => ({
      html,
      url: "https://www.cdr.gov.lb/en-US/Procurment.aspx",
      loadMoreVisible: true,
      loadMoreEnabled: true,
    }),
    clickLoadMore: async () => {},
    waitForChange: async () => {},
  };
  const pending = await crawlCdrBrowser({ driver, maxLoads: 0 });
  assert.equal(pending.status, "incomplete");
  assert.equal(pending.error, "page_budget");
  driver.snapshot = async () => ({
    html,
    url: "https://www.cdr.gov.lb/en-US/Procurment.aspx",
    loadMoreVisible: false,
    loadMoreEnabled: false,
  });
  const done = await crawlCdrBrowser({ driver });
  assert.equal(done.status, "complete");
});

test("listing refresh preserves verified details, timestamps do not change content hash, and changed listing requests refresh", async () => {
  const html = await fixture("ppa-en-first.html");
  const original = parsePpa(html, url, "2026-10-05T00:00:00Z").records[0];
  const enriched = enrichPpa(
    original,
    await fixture("ppa-en-detail.html"),
    original.sourceUrl,
    "2026-10-05T01:00:00Z",
  );
  const refresh = parsePpa(html, url, "2026-10-06T00:00:00Z").records[0];
  const merged = mergeRecords(enriched, refresh);
  assert.equal(merged.deadline, enriched.deadline);
  assert.equal(merged.contentHash, enriched.contentHash);
  assert.deepEqual(merged.evidence, enriched.evidence);
  assert.equal(merged.detailStatus, "verified");
  assert.equal(merged.locales[0].detailFetchedAt, "2026-10-05T01:00:00Z");
  assert.equal(merged.locales[0].listingFetchedAt, "2026-10-06T00:00:00Z");
  const { detailDue } = await import("../src/enrich.mjs");
  assert.equal(
    detailDue(merged.locales[0], Date.parse("2026-10-05T02:00:00Z")),
    false,
  );
  assert.equal(
    detailDue(merged.locales[0], Date.parse("2026-10-07T02:00:00Z")),
    true,
  );
  const changed = structuredClone(refresh);
  changed.locales[0].listingHash = "changed";
  assert.equal(
    mergeRecords(merged, changed).locales[0].detailNeedsRefresh,
    true,
  );
  const again = enrichPpa(
    merged,
    await fixture("ppa-en-detail.html"),
    original.sourceUrl,
    "2026-10-07T01:00:00Z",
  );
  assert.equal(again.contentHash, enriched.contentHash);
  assert.equal(again.evidence.length, enriched.evidence.length);
});
test("refresh state only exposes discovered records and preserves previous detail cache", async () => {
  const { refreshState } = await import("../src/run.mjs");
  const old = initialState();
  const parsed = parsePpa(await fixture("ppa-en-first.html"), url);
  acceptPage(old, "ppa:en", parsed);
  const fresh = refreshState(old, ["ppa"]);
  assert.equal(Object.keys(fresh.records).length, 0);
  assert.equal(Object.keys(fresh.previousRecords).length, 50);
  assert.equal(fresh.streams["ppa:en"].status, "pending");
  acceptPage(fresh, "ppa:en", parsed);
  assert.equal(Object.keys(fresh.records).length, 50);
});
test("official watch snapshots are stable, never qualified opportunities, and reject arbitrary links", async () => {
  const { watchSnapshot, watchUrl } = await import("../src/watch.mjs");
  const source = {
    id: "japan-ggp",
    url: "https://www.lb.emb-japan.go.jp/itpr_en/ggpweb.html",
  };
  const html =
    "<html><title>Official program</title><main>" +
    "Application rules and Lebanon eligibility. ".repeat(8) +
    " Applications are closed.</main></html>";
  const a = watchSnapshot(source, html, "2026-10-05T00:00:00Z"),
    b = watchSnapshot(source, html, "2026-10-06T00:00:00Z");
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.opportunityCoverage, "not_qualified");
  assert.equal(a.observedStatus, "closed_statement_present");
  assert.throws(() => watchUrl("https://127.0.0.1/"), /watch_url_not_allowed/);
  assert.throws(
    () => watchUrl(source.url + "?next=https://127.0.0.1"),
    /watch_url_not_allowed/,
  );
});
test("manual CDR capture has all 43 distinct lot-aware IDs and explicit provenance", async () => {
  const capture = JSON.parse(
    await fixture("cdr-ongoing-manual-2026-10-05.json"),
  );
  assert.equal(capture.rows.length, 43);
  assert.equal(new Set(capture.rows.map((r) => `${r.id}:${r.lot}`)).size, 43);
  assert.equal(capture.provenance.transport, "manual_browser");
  assert.equal(capture.provenance.scheduledRefreshStatus, "blocked");
  assert.deepEqual(capture.provenance.batches, [8, 8, 8, 8, 8, 3]);
});

test("AICS Lebanon scope excludes Syria and flags ambiguous geography; past dates override In corso", async () => {
  const { parseAics } = await import("../src/aics.mjs");
  const page = parseAics(
    await fixture("aics-listing.html"),
    undefined,
    "2026-10-05T12:00:00Z",
  );
  assert.equal(page.totalRows, 18);
  assert.equal(page.records.length, 10);
  assert.equal(page.excluded.length, 7);
  assert.equal(page.unresolved.length, 1);
  assert.equal(page.next, null);
  assert.ok(page.records.every((r) => r.applicationStatus === "closed"));
  assert.equal(
    page.records.find((r) => r.sourceKey === "aics:214").deadline,
    "2026-07-07",
  );
});
test("explicit static grants retain closed status and historical deadline", async () => {
  const { staticGrant } = await import("../src/grants.mjs");
  const state = JSON.parse(await fixture("embassy-call-snapshots.json"));
  const au = staticGrant(state["australia-dap"]);
  assert.equal(au.applicationStatus, "closed");
  assert.equal(au.deadline, null);
  const cz = staticGrant(state["czech-ssp"]);
  assert.equal(cz.deadline, "2025-10-19");
  assert.equal(cz.applicationStatus, "closed");
  assert.throws(
    () =>
      staticGrant({
        ...state["australia-dap"],
        text: "Program landing page without a current call",
      }),
    /explicit_call_status_missing/,
  );
});
test("publisher-declared windows1252 decodes without corrupting Italian evidence", async () => {
  const { decodeBody } = await import("../src/safe-http.mjs");
  assert.equal(
    decodeBody(
      Buffer.from([0x53, 0x6f, 0x63, 0x69, 0x65, 0x74, 0xe0]),
      "text/html; charset=windows-1252",
    ),
    "Società",
  );
  assert.throws(
    () => decodeBody(Buffer.from("test"), "text/html; charset=not-an-encoding"),
    /unsupported_character_encoding/,
  );
});
test("same-host disallowed redirect is rejected before target fetch", async () => {
  const fetched = [];
  const http = new SafeHttp({
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    minIntervalMs: 0,
    transport: async (u) => {
      fetched.push(u.pathname);
      return u.pathname === "/robots.txt"
        ? { status: 404, headers: {}, body: "" }
        : { status: 302, headers: { location: "/admin" }, body: "" };
    },
  });
  await assert.rejects(
    http.get("https://www.cdr.gov.lb/en-US/Procurment.aspx"),
    /url_not_allowed/,
  );
  assert.deepEqual(fetched, ["/robots.txt", "/en-US/Procurment.aspx"]);
});

test("failed detail refresh downgrades top-level verification while preserving evidence and matching hash", async () => {
  const { enrich } = await import("../src/enrich.mjs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = parsePpa(
    await fixture("ppa-en-first.html"),
    url,
    "2026-10-05T00:00:00Z",
  ).records[0];
  const verified = enrichPpa(
    base,
    await fixture("ppa-en-detail.html"),
    base.sourceUrl,
    "2026-10-05T01:00:00Z",
  );
  const state = { records: { [verified.sourceKey]: verified } },
    dir = await mkdtemp(join(tmpdir(), "ktebli-crawler-"));
  try {
    await enrich({
      state,
      statePath: join(dir, "state.json"),
      now: Date.parse("2026-10-07T01:00:00Z"),
      http: {
        get: async () => {
          throw new Error("issuer unavailable");
        },
      },
    });
    const stale = state.records[verified.sourceKey];
    assert.equal(stale.detailStatus, "partial");
    assert.equal(stale.detailNeedsRefresh, true);
    assert.equal(stale.contentHash, verified.contentHash);
    assert.deepEqual(stale.evidence, verified.evidence);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recent detail pass advances through unverified notices and reports the wider backlog", async () => {
  const { enrich } = await import("../src/enrich.mjs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const records = parsePpa(
    await fixture("ppa-en-first.html"),
    url,
  ).records.slice(0, 3);
  records[0].locales[0].publishedAt = "2026-10-05";
  records[1].locales[0].publishedAt = "2026-10-06";
  records[2].locales[0].publishedAt = "2026-09-01";
  const state = {
    records: Object.fromEntries(records.map((r) => [r.sourceKey, r])),
  };
  const dir = await mkdtemp(join(tmpdir(), "ktebli-recent-detail-"));
  const fetched = [];
  const http = {
    get: async (sourceUrl) => {
      fetched.push(sourceUrl);
      return { body: await fixture("ppa-en-detail.html"), url: sourceUrl };
    },
  };
  try {
    const options = {
      state,
      statePath: join(dir, "state.json"),
      maxDetails: 1,
      publishedSince: "2026-10-05",
      now: Date.parse("2026-10-06T12:00:00Z"),
      http,
    };
    const first = await enrich(options);
    assert.deepEqual(fetched, [records[1].sourceUrl]);
    assert.equal(first.pendingLocales, 1);
    assert.equal(first.freshVerifiedLocales, 1);
    assert.equal(first.staleVerifiedLocales, 0);
    assert.equal(
      first.freshVerifiedLocales + first.pendingLocales,
      first.scopedLocales,
    );
    assert.equal(first.totalPendingLocales, 2);
    const second = await enrich(options);
    assert.deepEqual(fetched, [records[1].sourceUrl, records[0].sourceUrl]);
    assert.equal(second.status, "complete");
    assert.equal(second.totalPendingLocales, 1);
    assert.equal(second.freshVerifiedLocales, 2);
    assert.equal(
      second.freshVerifiedLocales + second.pendingLocales,
      second.scopedLocales,
    );
    const stale = await enrich({
      ...options,
      maxDetails: 0,
      now: Date.parse("2026-10-08T12:00:00Z"),
    });
    assert.equal(stale.verifiedLocales, 2);
    assert.equal(stale.freshVerifiedLocales, 0);
    assert.equal(stale.staleVerifiedLocales, 2);
    assert.equal(stale.pendingLocales, 2);
    assert.equal(state.records[records[0].sourceKey].detailStatus, "partial");
    assert.equal(state.records[records[1].sourceKey].detailStatus, "partial");
    assert.equal(
      state.records[records[0].sourceKey].locales[0].detailNeedsRefresh,
      true,
    );
    await assert.rejects(enrich({ ...options, publishedSince: "2026-99-99" }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("older detail pass fairly includes future deadlines and backlog, and halts repeated network failure", async () => {
  const { enrich } = await import("../src/enrich.mjs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const records = parsePpa(
    await fixture("ppa-en-first.html"),
    url,
  ).records.slice(0, 4);
  for (const record of records) {
    record.locales[0].publishedAt = "2026-08-01";
    record.publishedAt = "2026-08-01";
  }
  records[0].locales[0].deadline = "2026-11-01";
  records[1].locales[0].deadline = "2026-11-01";
  const state = {
    records: Object.fromEntries(
      records.map((record) => [record.sourceKey, record]),
    ),
  };
  const dir = await mkdtemp(join(tmpdir(), "ktebli-older-details-"));
  const seen = [];
  try {
    const options = {
      state,
      statePath: join(dir, "state.json"),
      maxDetails: 2,
      publishedBefore: "2026-09-01",
      now: Date.parse("2026-10-05T12:00:00Z"),
      http: {
        get: async (sourceUrl) => {
          seen.push(sourceUrl);
          return { body: await fixture("ppa-en-detail.html"), url: sourceUrl };
        },
      },
    };
    const first = await enrich(options);
    assert.equal(first.attempted, 2);
    assert.ok(
      records.slice(0, 2).some((record) => record.sourceUrl === seen[0]),
    );
    assert.ok(records.slice(2).some((record) => record.sourceUrl === seen[1]));
    assert.equal(first.publishedBefore, "2026-09-01");
    assert.equal(first.pendingLocales, 2);
    assert.equal(
      first.freshVerifiedLocales + first.pendingLocales,
      first.scopedLocales,
    );
    await assert.rejects(enrich({ ...options, publishedSince: "2026-09-01" }));
    const failed = await enrich({
      ...options,
      maxDetails: 4,
      now: Date.parse("2026-10-08T12:00:00Z"),
      http: {
        get: async () => {
          throw Object.assign(new Error("DNS unavailable"), {
            code: "ENOTFOUND",
          });
        },
      },
    });
    assert.equal(failed.attempted, 3);
    assert.equal(failed.haltedAfter, "ENOTFOUND");
    assert.equal(failed.pendingLocales, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("completed listing skips crawler startup and still exposes resumable state", async () => {
  const { run, saveState } = await import("../src/run.mjs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "ktebli-complete-listing-"));
  const path = join(dir, "state.json");
  const state = initialState();
  for (const id of ["ppa:en", "ppa:ar"]) {
    state.streams[id].status = "complete";
    state.streams[id].cursor = null;
    state.streams[id].expectedTotal = 0;
  }
  try {
    await saveState(path, state);
    const result = await run({
      statePath: path,
      selectedSources: ["ppa"],
      http: { get: () => assert.fail("No request expected") },
    });
    assert.equal(result.coverage.streams["ppa:en"].status, "complete");
    assert.equal(result.coverage.streams["cdr:Ongoing"].status, "pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
