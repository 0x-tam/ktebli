import { dateOnly, hash } from "./adapters.mjs";
import { allowedUrl, CrawlError } from "./safe-http.mjs";
import {
  countryCodesFromEvidence,
  jsonHttp,
  runPublicCatalog,
  safeEvidenceText,
} from "./public-catalog.mjs";

export const SAM_GOV_SCOPE =
  "SAM.gov public opportunities posted within the stored rolling 365-day query window; archived older notices and non-U.S. catalogues are outside this API slice, and bidder eligibility requires issuer review";
const API = "https://api.sam.gov/opportunities/v2/search";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function validDay(value) {
  return (
    typeof value === "string" &&
    /^20\d\d-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function apiDate(iso) {
  if (!validDay(iso)) throw new CrawlError("invalid_query_date");
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

function queryDateWindow(now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime()))
    throw new CrawlError("invalid_query_time");
  const to = date.toISOString().slice(0, 10);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 364);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export function samSearchUrl({
  apiKey,
  window,
  offset = 0,
  limit = PAGE_SIZE,
}) {
  if (
    typeof apiKey !== "string" ||
    !apiKey.trim() ||
    apiKey.length > 1024 ||
    /[\s&]/.test(apiKey)
  )
    throw new CrawlError("missing_api_key");
  if (
    !window ||
    !validDay(window.from) ||
    !validDay(window.to) ||
    Date.parse(window.to) < Date.parse(window.from) ||
    Date.parse(window.to) - Date.parse(window.from) > 364 * 86_400_000
  )
    throw new CrawlError("invalid_query_window");
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 999_999 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new CrawlError("invalid_search_pagination");
  const url = new URL(API);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("postedFrom", apiDate(window.from));
  url.searchParams.set("postedTo", apiDate(window.to));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return allowedUrl(url.href).href;
}

function cleanApiText(value, max = 2_000) {
  if (value === undefined || value === null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return safeEvidenceText(value, max);
  return safeEvidenceText(JSON.stringify(value), max);
}

export function parseSamSearch(raw, requestedOffset) {
  if (
    !raw ||
    !Number.isSafeInteger(raw.totalRecords) ||
    raw.totalRecords < 0 ||
    !Number.isSafeInteger(raw.offset) ||
    raw.offset !== requestedOffset ||
    !Array.isArray(raw.opportunitiesData)
  )
    throw new CrawlError("sam_search_schema_changed");
  const records = raw.opportunitiesData.map((item) => {
    const id = String(item?.noticeId ?? "");
    if (!/^[a-f\d]{16,64}$/i.test(id) || !item?.title)
      throw new CrawlError("sam_search_record_invalid");
    return { id, data: item };
  });
  if (records.length > PAGE_SIZE)
    throw new CrawlError("sam_page_exceeds_limit");
  const terminal = raw.offset * PAGE_SIZE + records.length >= raw.totalRecords;
  if (!records.length && raw.totalRecords > raw.offset * PAGE_SIZE)
    throw new CrawlError("sam_empty_page_before_total");
  if (!terminal && records.length !== PAGE_SIZE)
    throw new CrawlError("sam_page_row_count_mismatch");
  return {
    records,
    total: raw.totalRecords,
    offset: raw.offset,
    nextCursor: raw.offset + 1,
    terminal,
  };
}

function dateValue(value) {
  const text = String(value ?? "").trim();
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(20\d\d)(?:\s|$)/);
  if (mdy)
    return dateOnly(
      `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`,
    );
  return dateOnly(text);
}

function countryLocation(item, sourceUrl) {
  const place = item.placeOfPerformance || {};
  const country = place.country;
  if (!country) return [];
  const code =
    typeof country === "string" ? "" : cleanApiText(country.code, 20);
  const name =
    typeof country === "string"
      ? cleanApiText(country, 200)
      : cleanApiText(country.name, 200);
  const value = /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : name || code;
  return value
    ? [{ label: "Place of performance country", text: value, url: sourceUrl }]
    : [];
}

function applicationStatus(item, deadline, today) {
  const active = String(item.active ?? "").toLowerCase();
  const type = `${item.type ?? ""} ${item.baseType ?? ""}`.toLowerCase();
  if (
    active === "no" ||
    /award notice|cancelled|canceled|archived|closed/.test(type)
  )
    return "closed";
  if (/pre[- ]?solicitation|forecast/.test(type)) return "needs_verification";
  if (active === "yes" && deadline && deadline < today) return "closed";
  if (active === "yes" && deadline) return "needs_verification";
  return "needs_verification";
}

export function parseSamOpportunity(
  wrapped,
  _detail,
  fetchedAt = new Date().toISOString(),
) {
  const item = wrapped?.data;
  if (!item || String(item.noticeId) !== wrapped.id)
    throw new CrawlError("sam_record_identity_mismatch");
  const id = wrapped.id;
  const sourceUrl = allowedUrl(
    `https://sam.gov/opp/${encodeURIComponent(id)}/view`,
  ).href;
  const title = safeEvidenceText(item.title, 2_000);
  const description = cleanApiText(item.description, 12_000);
  const deadlineText =
    item.reponseDeadLine ?? item.responseDeadLine ?? item.responseDeadline;
  const deadline = dateValue(deadlineText);
  const today = new Date(fetchedAt).toISOString().slice(0, 10);
  const agency = cleanApiText(
    item.fullParentPathName || item.department || item.subtier,
    1_000,
  );
  const evidence = [
    { label: "SAM.gov notice ID", text: id, url: sourceUrl },
    { label: "Opportunity title", text: title, url: sourceUrl },
  ];
  if (agency)
    evidence.push({
      label: "Issuing organization",
      text: agency,
      url: sourceUrl,
    });
  for (const [label, value] of [
    ["Solicitation number", item.solicitationNumber],
    ["Opportunity type", item.type],
    ["Original opportunity type", item.baseType],
    ["Active status", item.active],
    ["Posted date", item.postedDate],
    ["Response deadline", deadlineText],
    ["Set-aside", item.setAside],
    ["NAICS code", item.naicsCode],
    ["Classification code", item.classificationCode],
  ]) {
    const text = cleanApiText(value, 2_000);
    if (text) evidence.push({ label, text, url: sourceUrl });
  }
  if (description)
    evidence.push({
      label: "Opportunity description link",
      text: description,
      url: sourceUrl,
    });
  if (item.data?.pointOfContact?.additionalInfo) {
    const extra = cleanApiText(item.data.pointOfContact.additionalInfo, 6_000);
    if (extra)
      evidence.push({
        label: "Additional opportunity information",
        text: extra,
        url: sourceUrl,
      });
  }
  const locationEvidence = countryLocation(item, sourceUrl);
  const locations = countryCodesFromEvidence(locationEvidence);
  evidence.push(...locationEvidence);
  const content = {
    source: "sam-gov",
    sourceKey: `sam-gov:${id}`,
    sourceUrl,
    title,
    description,
    publishedAt: dateValue(item.postedDate),
    deadline,
    deadlinePrecision: deadline ? "date_only" : "unknown",
    deadlineLocal: null,
    deadlineTimezone: null,
    kind: "procurement",
    evidence,
    locations,
    geography: { status: "unknown", evidence: [] },
    applicationStatus: applicationStatus(item, deadline, today),
  };
  const locale = {
    locale: "en",
    sourceUrl,
    title,
    description,
    publishedAt: content.publishedAt,
    deadline,
    deadlinePrecision: content.deadlinePrecision,
    deadlineTimezone: null,
    evidence,
    detailStatus: "verified",
    detailFetchedAt: fetchedAt,
  };
  return {
    ...content,
    fetchedAt,
    detailStatus: "verified",
    locales: [locale],
    contentHash: hash({ ...content, fetchedAt: undefined }),
  };
}

export async function crawlSamGov({
  state,
  save,
  maxPages = MAX_PAGES,
  refresh = false,
  http,
  apiKey = process.env.SAM_GOV_API_KEY,
  now = () => new Date().toISOString(),
}) {
  const window = !refresh
    ? state.sources?.["sam-gov"]?.window || queryDateWindow(now())
    : queryDateWindow(now());
  const api = jsonHttp(http);
  const scope = `${SAM_GOV_SCOPE} (${window.from} through ${window.to})`;
  return runPublicCatalog({
    sourceId: "sam-gov",
    state,
    save,
    maxPages,
    refresh,
    apiKey,
    scope,
    now,
    initializeSource: () => ({ window, cursorUnit: "page" }),
    async fetchPage(offset, key) {
      const url = samSearchUrl({
        apiKey: key,
        window,
        offset,
        limit: PAGE_SIZE,
      });
      return api.request(url, { keyed: true });
    },
    async fetchDetails() {
      return null;
    },
    parsePage: (raw) =>
      parseSamSearch(raw, state.sources["sam-gov"]?.cursor || 0),
    parseRecord: (summary, _detail) =>
      parseSamOpportunity(summary, null, now()),
  });
}
