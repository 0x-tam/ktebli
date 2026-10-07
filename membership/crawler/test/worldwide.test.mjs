import test from "node:test";
import assert from "node:assert/strict";
import { allowedUrl, CrawlError, SafeHttp } from "../src/safe-http.mjs";
import {
  countryCodesFromEvidence,
  publicCatalogState,
  runPublicCatalog,
  safeEvidenceText,
} from "../src/public-catalog.mjs";
import {
  crawlGrantsGov,
  grantsSearchRequest,
  parseGrantsOpportunity,
  parseGrantsSearch,
} from "../src/grants-gov.mjs";
import {
  crawlSamGov,
  parseSamOpportunity,
  parseSamSearch,
  samSearchUrl,
} from "../src/sam-gov.mjs";

const grantsSummary = {
  id: "357305",
  number: "EXAMPLE-26-001",
  title: "Community arts opportunity",
  agencyCode: "EXAMPLE",
  agencyName: "Example Agency",
  openDate: "10/01/2026",
  closeDate: "11/30/2026",
  oppStatus: "posted",
  docType: "synopsis",
  alnist: ["00.000"],
};

const grantsDetail = {
  errorcode: 0,
  data: {
    id: 357305,
    opportunityNumber: grantsSummary.number,
    opportunityTitle: grantsSummary.title,
    synopsis: {
      agencyCode: "EXAMPLE",
      agencyName: "Example Agency",
      synopsisDesc: "A bounded publisher description.",
      postingDate: "Oct 1, 2026 12:00:00 AM EDT",
      postingDateStr: "2026-10-01-00-00-00",
      closeDate: "Nov 30, 2026",
      applicantTypes: [{ id: "01", description: "County governments" }],
      fundingInstruments: [{ id: "G", description: "Grant" }],
      projectCountry: "Lebanon and Jordan",
    },
    alns: [{ alnNumber: "00.000", programTitle: "Example" }],
  },
};

test("Grants.gov pagination requests posted notices and validates search totals", () => {
  assert.deepEqual(grantsSearchRequest(20), {
    rows: 10,
    startRecordNum: 20,
    oppStatuses: "posted",
    searchOnly: false,
  });
  const parsed = parseGrantsSearch(
    {
      errorcode: 0,
      data: {
        hitCount: 21,
        startRecord: 20,
        oppHits: [{ ...grantsSummary, id: "357306" }],
      },
    },
    20,
  );
  assert.equal(parsed.total, 21);
  assert.equal(parsed.terminal, true);
  assert.throws(
    () =>
      parseGrantsSearch(
        { errorcode: 0, data: { hitCount: 1, startRecord: 0, oppHits: [] } },
        0,
      ),
    /empty_page/,
  );
});

test("Grants.gov opportunity keeps eligibility in detail evidence and only explicit project geography in locations", () => {
  const record = parseGrantsOpportunity(
    grantsSummary,
    grantsDetail,
    "2026-10-07T12:00:00.000Z",
  );
  assert.equal(record.source, "grants-gov");
  assert.equal(record.sourceKey, "grants-gov:357305");
  assert.equal(record.publishedAt, "2026-10-01");
  assert.equal(record.deadline, "2026-11-30");
  assert.equal(record.applicationStatus, "needs_verification");
  assert.deepEqual(record.locations.countryCodes, ["JO", "LB"]);
  assert.equal(record.locations.scope, "countries");
  assert.deepEqual(
    record.locations.evidence,
    record.evidence.filter((item) => item.label === "Project country"),
  );
  assert.ok(
    record.evidence.some((item) => item.label === "Applicant eligibility"),
  );
  const applicantOnly = parseGrantsOpportunity(
    grantsSummary,
    {
      ...grantsDetail,
      data: {
        ...grantsDetail.data,
        synopsis: {
          ...grantsDetail.data.synopsis,
          projectCountry: undefined,
          eligibleCountries: "Lebanon",
        },
      },
    },
    "2026-10-07T12:00:00.000Z",
  );
  assert.deepEqual(applicantOnly.locations, {
    countryCodes: [],
    scope: "unknown",
    evidence: [],
  });
});

test("country extraction uses only explicit geographic labels and ISO alpha-2 codes", () => {
  assert.deepEqual(
    countryCodesFromEvidence([
      {
        label: "Eligible countries",
        text: "Lebanon",
        url: "https://www.grants.gov/search-results-detail/1",
      },
    ]),
    { countryCodes: [], scope: "unknown", evidence: [] },
  );
  assert.deepEqual(
    countryCodesFromEvidence([
      {
        label: "Opportunity geography",
        text: "Worldwide implementation",
        url: "https://www.grants.gov/search-results-detail/1",
      },
    ]),
    {
      countryCodes: [],
      scope: "worldwide",
      evidence: [
        {
          label: "Opportunity geography",
          text: "Worldwide implementation",
          url: "https://www.grants.gov/search-results-detail/1",
        },
      ],
    },
  );
  assert.deepEqual(
    countryCodesFromEvidence([
      {
        label: "Project country",
        text: "Lebanon",
        url: "https://www.grants.gov/search-results-detail/1",
      },
      {
        label: "Geographic scope",
        text: "Worldwide",
        url: "https://www.grants.gov/search-results-detail/1",
      },
    ]),
    { countryCodes: [], scope: "unknown", evidence: [] },
  );
  assert.deepEqual(
    countryCodesFromEvidence([
      {
        label: "Project country",
        text: "EU",
        url: "https://www.grants.gov/search-results-detail/1",
      },
    ]),
    { countryCodes: [], scope: "unknown", evidence: [] },
  );
});

test("public evidence text decodes HTML entities without treating source text as markup", () => {
  assert.equal(
    safeEvidenceText("Grant &ndash; opportunity &amp; impact <10%"),
    "Grant – opportunity & impact <10%",
  );
});

test("partial catalog pages checkpoint verified records and resume without recounting them", async () => {
  const state = publicCatalogState();
  let saved = 0;
  const input = {
    sourceId: "grants-gov",
    state,
    save: async () => {
      saved++;
    },
    maxPages: 1,
    scope: "test slice",
    fetchPage: async (offset) => ({
      total: 2,
      offset,
      records: offset === 0 ? [{ id: "one" }] : [{ id: "two" }],
      terminal: offset === 1,
      nextCursor: offset + 1,
    }),
    fetchDetails: async (id) => ({ id }),
    parsePage: (page) => page,
    parseRecord: (_summary, detail) => ({
      source: "grants-gov",
      sourceKey: `grants-gov:${detail.id}`,
    }),
  };
  const first = await runPublicCatalog(input);
  assert.equal(first.coverage.selectedStatus, "incomplete");
  assert.equal(first.coverage.streams["grants-gov"].uniqueRecords, 1);
  assert.equal(first.coverage.streams["grants-gov"].cursor, 1);
  assert.equal(first.records.length, 1);
  const second = await runPublicCatalog(input);
  assert.equal(second.coverage.selectedStatus, "complete");
  assert.equal(second.coverage.streams["grants-gov"].uniqueRecords, 2);
  assert.deepEqual(
    second.records.map((item) => item.sourceKey),
    ["grants-gov:one", "grants-gov:two"],
  );
  assert.ok(saved >= 4);
});

test("SAM.gov query includes only a bounded date window and keyed redirects are excluded", () => {
  const url = samSearchUrl({
    apiKey: "test-only-key",
    window: { from: "2025-10-08", to: "2026-10-07" },
    offset: 2,
    limit: 100,
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://api.sam.gov");
  assert.equal(parsed.searchParams.get("postedFrom"), "10/08/2025");
  assert.equal(parsed.searchParams.get("postedTo"), "10/07/2026");
  assert.equal(parsed.searchParams.get("offset"), "2");
  assert.throws(
    () =>
      samSearchUrl({
        apiKey: "test-only-key",
        window: { from: "2024-01-01", to: "2026-10-07" },
      }),
    /window/,
  );
  assert.throws(
    () => allowedUrl("https://api.sam.gov/other?api_key=test"),
    (error) => error instanceof CrawlError,
  );
});

test("Grants.gov public API robots exception is POST-only; SAM keyed redirects never forward credentials", async () => {
  let grantsCalls = 0;
  const grantsHttp = new SafeHttp({
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async (_url, _address, options) => {
      grantsCalls++;
      assert.equal(options.method, "POST");
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: "{}",
      };
    },
    minIntervalMs: 0,
    contentTypes: /^application\/json/i,
  });
  await assert.rejects(
    grantsHttp.raw("https://api.grants.gov/v1/api/search2"),
    (error) => error.code === "api_method_not_allowed",
  );
  assert.equal(grantsCalls, 0);
  await grantsHttp.raw("https://api.grants.gov/v1/api/search2", {
    method: "POST",
    body: "{}",
  });
  assert.equal(grantsCalls, 1);

  const calls = [];
  const samHttp = new SafeHttp({
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    transport: async (url) => {
      calls.push(url.pathname);
      return url.pathname === "/robots.txt"
        ? { status: 404, headers: { "content-type": "text/plain" }, body: "" }
        : {
            status: 302,
            headers: { location: "https://attacker.example/steal" },
            body: "",
          };
    },
    minIntervalMs: 0,
    contentTypes: /^application\/json/i,
  });
  const samUrl = samSearchUrl({
    apiKey: "test-only-key",
    window: { from: "2025-10-08", to: "2026-10-07" },
  });
  await assert.rejects(
    samHttp.raw(samUrl, { followRedirects: false }),
    (error) => error.code === "redirect_forbidden",
  );
  assert.deepEqual(calls, ["/robots.txt", "/opportunities/v2/search"]);
});

test("SAM.gov pagination uses API page indexes and record data, not its key, in the checkpoint", () => {
  const page = parseSamSearch(
    {
      totalRecords: 101,
      limit: 100,
      offset: 0,
      opportunitiesData: Array.from({ length: 100 }, (_, index) => ({
        noticeId: index.toString(16).padStart(32, "a"),
        title: "Notice",
      })),
    },
    0,
  );
  assert.equal(page.terminal, false);
  assert.equal(page.nextCursor, 1);
  assert.equal(
    parseSamSearch(
      {
        totalRecords: 101,
        offset: 1,
        opportunitiesData: [{ noticeId: "b".repeat(32), title: "Second" }],
      },
      1,
    ).terminal,
    true,
  );
  assert.throws(
    () =>
      parseSamSearch({ totalRecords: 1, offset: 2, opportunitiesData: [] }, 0),
    /schema/,
  );
});

test("SAM.gov location comes from performance country; expired and presolicitation notices are never open", () => {
  const noticeId = "c".repeat(32);
  const base = {
    id: noticeId,
    data: {
      noticeId,
      title: "Research solicitation",
      fullParentPathName: "U.S. Department",
      active: "Yes",
      type: "Solicitation",
      postedDate: "2026-10-01 00:00:00",
      reponseDeadLine: "10/30/2026",
      placeOfPerformance: { country: { code: "LB", name: "Lebanon" } },
      description: "https://api.sam.gov/opportunities/v2/search?id=notice",
    },
  };
  const record = parseSamOpportunity(base, null, "2026-10-07T00:00:00.000Z");
  assert.equal(record.sourceKey, `sam-gov:${noticeId}`);
  assert.deepEqual(record.locations.countryCodes, ["LB"]);
  assert.equal(record.locations.scope, "countries");
  assert.equal(record.locations.evidence[0].text, "LB");
  assert.ok(
    record.evidence.some(
      (item) =>
        item.label === record.locations.evidence[0].label &&
        item.text === record.locations.evidence[0].text &&
        item.url === record.locations.evidence[0].url,
    ),
  );
  assert.equal(record.applicationStatus, "needs_verification");
  const expired = parseSamOpportunity(
    { ...base, data: { ...base.data, reponseDeadLine: "10/01/2026" } },
    null,
    "2026-10-07T00:00:00.000Z",
  );
  assert.equal(expired.applicationStatus, "closed");
  const forecast = parseSamOpportunity(
    { ...base, data: { ...base.data, type: "Pre-Solicitation" } },
    null,
    "2026-10-07T00:00:00.000Z",
  );
  assert.equal(forecast.applicationStatus, "needs_verification");
  const funderOnly = parseSamOpportunity(
    { ...base, data: { ...base.data, placeOfPerformance: undefined } },
    null,
    "2026-10-07T00:00:00.000Z",
  );
  assert.deepEqual(funderOnly.locations, {
    countryCodes: [],
    scope: "unknown",
    evidence: [],
  });
  const alphaThree = parseSamOpportunity(
    {
      ...base,
      data: {
        ...base.data,
        placeOfPerformance: { country: { code: "USA" } },
      },
    },
    null,
    "2026-10-07T00:00:00.000Z",
  );
  assert.deepEqual(alphaThree.locations.countryCodes, ["US"]);
  assert.equal(alphaThree.locations.evidence[0].text, "USA");
});

test("missing SAM.gov key disables only the explicitly selected SAM source", async () => {
  const state = publicCatalogState();
  let requested = false;
  const result = await crawlSamGov({
    state,
    apiKey: undefined,
    http: {
      raw: async () => {
        requested = true;
        throw new Error("should not request");
      },
    },
    save: async () => {},
    now: () => "2026-10-07T00:00:00.000Z",
  });
  assert.equal(requested, false);
  assert.equal(
    result.coverage.streams["sam-gov"].status,
    "disabled_missing_api_key",
  );
  assert.equal(result.coverage.selectedStatus, "incomplete");
  assert.deepEqual(result.records, []);
  assert.equal(JSON.stringify(state).includes("test-only-key"), false);
});
