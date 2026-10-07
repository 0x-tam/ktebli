import { dateOnly, hash } from "./adapters.mjs";
import { allowedUrl, CrawlError } from "./safe-http.mjs";
import {
  countryCodesFromEvidence,
  jsonHttp,
  runPublicCatalog,
  safeEvidenceText,
} from "./public-catalog.mjs";

export const GRANTS_GOV_SCOPE =
  "Grants.gov posted opportunities returned by its public search2 catalogue; forecasts are excluded, and applicant eligibility still requires issuer-detail review";
const API = "https://api.grants.gov/v1/api";
const SEARCH_URL = allowedUrl(`${API}/search2`).href;
const DETAIL_URL = allowedUrl(`${API}/fetchOpportunity`).href;
const LISTING_URL = "https://www.grants.gov/search-results-detail/";
const ROWS = 10;

export function grantsSearchRequest(offset, rows = ROWS) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 100
  )
    throw new CrawlError("invalid_search_pagination");
  return {
    rows,
    startRecordNum: offset,
    oppStatuses: "posted",
    searchOnly: false,
  };
}

export function parseGrantsSearch(raw, requestedOffset) {
  const data = raw?.data;
  if (
    raw?.errorcode !== 0 ||
    !data ||
    !Array.isArray(data.oppHits) ||
    !Number.isSafeInteger(data.hitCount) ||
    data.hitCount < 0 ||
    !Number.isSafeInteger(data.startRecord) ||
    data.startRecord !== requestedOffset
  )
    throw new CrawlError("grants_search_schema_changed");
  const records = data.oppHits.map((item) => {
    const id = String(item?.id ?? "");
    if (!/^\d{1,12}$/.test(id) || !item?.number || !item?.title)
      throw new CrawlError("grants_search_record_invalid");
    return {
      id,
      number: safeEvidenceText(item.number, 300),
      title: safeEvidenceText(item.title, 2_000),
      agencyCode: safeEvidenceText(item.agencyCode, 200),
      agencyName: safeEvidenceText(item.agencyName, 500),
      openDate: safeEvidenceText(item.openDate, 100),
      closeDate: safeEvidenceText(item.closeDate, 100),
      oppStatus: safeEvidenceText(item.oppStatus, 100).toLowerCase(),
      docType: safeEvidenceText(item.docType, 100),
      alnist: Array.isArray(item.alnist)
        ? item.alnist.slice(0, 100).map((value) => safeEvidenceText(value, 100))
        : [],
    };
  });
  const terminal = data.startRecord + records.length >= data.hitCount;
  if (!records.length && data.hitCount > data.startRecord)
    throw new CrawlError("grants_empty_page_before_total");
  if (!terminal && records.length !== ROWS)
    throw new CrawlError("grants_page_row_count_mismatch");
  return {
    records,
    total: data.hitCount,
    offset: data.startRecord,
    terminal,
  };
}

function dateValue(text) {
  const value = String(text ?? "").trim();
  const mdy = value.match(/^(\d{1,2})\/(\d{1,2})\/(20\d\d)$/);
  if (mdy)
    return dateOnly(
      `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`,
    );
  const monthFirst = value.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d\d)\b/i,
  );
  if (monthFirst)
    return dateOnly(`${monthFirst[2]} ${monthFirst[1]} ${monthFirst[3]}`);
  return dateOnly(value);
}

function appendField(evidence, label, value, url, max = 2_000) {
  if (value === undefined || value === null || value === "") return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  evidence.push({ label, text: safeEvidenceText(text, max), url });
}

function appendLongText(evidence, label, value, url, maximum = 60_000) {
  if (value === undefined || value === null || value === "") return "";
  const text = safeEvidenceText(value, maximum);
  const chunkSize = 10_500;
  const parts = [];
  for (let start = 0; start < text.length; start += chunkSize)
    parts.push(text.slice(start, start + chunkSize));
  parts.forEach((part, index) =>
    evidence.push({
      label:
        parts.length > 1 ? `${label} (${index + 1}/${parts.length})` : label,
      text: part,
      url,
    }),
  );
  return text;
}

function explicitLocationEvidence(detail, url) {
  const synopsis = detail.synopsis || {};
  const evidence = [];
  for (const [key, label] of [
    ["placeOfPerformanceCountry", "Place of performance country"],
    ["projectCountry", "Project country"],
    ["implementationCountry", "Implementation country"],
    ["locationCountries", "Project locations"],
    ["projectLocation", "Project location"],
    ["implementationLocation", "Implementation location"],
    ["opportunityGeography", "Opportunity geography"],
    ["geographicScope", "Geographic scope"],
  ]) {
    const value = synopsis[key] ?? detail[key];
    if (value !== undefined && value !== null && value !== "")
      evidence.push({
        label,
        text: safeEvidenceText(
          Array.isArray(value) ? value.join(", ") : value,
          2_000,
        ),
        url,
      });
  }
  return evidence;
}

export function parseGrantsOpportunity(
  summary,
  raw,
  fetchedAt = new Date().toISOString(),
) {
  if (raw?.errorcode !== 0 || !raw.data || String(raw.data.id) !== summary.id)
    throw new CrawlError("grants_detail_schema_changed");
  const data = raw.data;
  const synopsis = data.synopsis || {};
  const sourceUrl = allowedUrl(
    `${LISTING_URL}${encodeURIComponent(summary.id)}`,
  ).href;
  const title = safeEvidenceText(data.opportunityTitle || summary.title, 2_000);
  const number = safeEvidenceText(
    data.opportunityNumber || summary.number,
    300,
  );
  const synopsisText = safeEvidenceText(synopsis.synopsisDesc, 60_000);
  const applicantTypes = Array.isArray(synopsis.applicantTypes)
    ? synopsis.applicantTypes
    : [];
  const instruments = Array.isArray(synopsis.fundingInstruments)
    ? synopsis.fundingInstruments
    : [];
  const categories = Array.isArray(synopsis.fundingActivityCategories)
    ? synopsis.fundingActivityCategories
    : [];
  const evidence = [
    { label: "Grants.gov opportunity ID", text: summary.id, url: sourceUrl },
    { label: "Funding opportunity number", text: number, url: sourceUrl },
    {
      label: "Opportunity status",
      text: summary.oppStatus || "posted",
      url: sourceUrl,
    },
  ];
  appendField(evidence, "Opportunity title", title, sourceUrl);
  appendField(
    evidence,
    "Offering agency",
    synopsis.agencyName || summary.agencyName,
    sourceUrl,
  );
  appendField(
    evidence,
    "Agency code",
    synopsis.agencyCode || summary.agencyCode,
    sourceUrl,
  );
  appendLongText(evidence, "Opportunity description", synopsisText, sourceUrl);
  appendLongText(
    evidence,
    "Applicant eligibility details",
    synopsis.applicantEligibilityDesc,
    sourceUrl,
  );
  appendField(
    evidence,
    "Applicant eligibility",
    applicantTypes,
    sourceUrl,
    4_000,
  );
  appendField(evidence, "Award floor", synopsis.awardFloor, sourceUrl, 300);
  appendField(evidence, "Award ceiling", synopsis.awardCeiling, sourceUrl, 300);
  appendField(
    evidence,
    "Cost sharing required",
    synopsis.costSharing,
    sourceUrl,
    100,
  );
  appendField(
    evidence,
    "Funding description link",
    synopsis.fundingDescLinkUrl,
    sourceUrl,
    2_000,
  );
  appendField(
    evidence,
    "Funding description link label",
    synopsis.fundingDescLinkDesc,
    sourceUrl,
    2_000,
  );
  appendField(evidence, "Funding instruments", instruments, sourceUrl, 2_000);
  appendField(
    evidence,
    "Funding activity categories",
    categories,
    sourceUrl,
    2_000,
  );
  appendField(
    evidence,
    "Assistance Listing numbers",
    summary.alnist,
    sourceUrl,
    2_000,
  );
  appendField(
    evidence,
    "Opportunity opening date",
    synopsis.openingDate || summary.openDate,
    sourceUrl,
    100,
  );
  appendField(
    evidence,
    "Opportunity closing date",
    synopsis.closeDate || synopsis.responseDate || summary.closeDate,
    sourceUrl,
    100,
  );
  appendField(
    evidence,
    "Additional eligibility and application detail",
    {
      applicantTypes,
      fundingInstruments: instruments,
      fundingActivityCategories: categories,
      alns: data.alns || [],
      synopsisAttachmentFolders: (data.synopsisAttachmentFolders || []).map(
        (folder) => ({
          folderType: folder.folderType,
          folderName: folder.folderName,
          attachments: (folder.synopsisAttachments || []).map((item) => ({
            fileName: item.fileName,
            fileDescription: item.fileDescription,
            mimeType: item.mimeType,
          })),
        }),
      ),
    },
    sourceUrl,
    8_000,
  );
  const closeDate = dateValue(
    synopsis.responseDateStr ||
      synopsis.responseDate ||
      synopsis.closeDate ||
      summary.closeDate,
  );
  const today = new Date(fetchedAt).toISOString().slice(0, 10);
  const status = String(summary.oppStatus || "posted").toLowerCase();
  const applicationStatus =
    status === "forecasted"
      ? "needs_verification"
      : status !== "posted"
        ? "needs_verification"
        : closeDate && closeDate < today
          ? "closed"
          : "needs_verification";
  const locationEvidence = explicitLocationEvidence(data, sourceUrl);
  const locations = countryCodesFromEvidence(locationEvidence);
  evidence.push(...locationEvidence);
  const description =
    synopsisText ||
    [summary.agencyName, summary.docType].filter(Boolean).join(" · ");
  const content = {
    source: "grants-gov",
    sourceKey: `grants-gov:${summary.id}`,
    sourceUrl,
    title,
    description,
    publishedAt: dateValue(
      synopsis.postingDateStr || synopsis.postingDate || summary.openDate,
    ),
    deadline: dateValue(
      synopsis.responseDateStr ||
        synopsis.responseDate ||
        synopsis.closeDate ||
        summary.closeDate,
    ),
    deadlinePrecision: closeDate ? "date_only" : "unknown",
    deadlineLocal: null,
    deadlineTimezone: null,
    kind: "grant",
    evidence,
    locations,
    geography: { status: "unknown", evidence: [] },
    applicationStatus,
  };
  const locale = {
    locale: "en",
    sourceUrl,
    title,
    description,
    publishedAt: content.publishedAt,
    deadline: closeDate,
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

export async function crawlGrantsGov({
  state,
  save,
  maxPages = 10,
  refresh = false,
  http,
  now,
}) {
  const api = jsonHttp(http);
  return runPublicCatalog({
    sourceId: "grants-gov",
    state,
    save,
    maxPages,
    refresh,
    scope: GRANTS_GOV_SCOPE,
    now,
    async fetchPage(offset) {
      const raw = await api.request(SEARCH_URL, {
        method: "POST",
        body: grantsSearchRequest(offset),
      });
      return raw;
    },
    async fetchDetails(id) {
      const raw = await api.request(DETAIL_URL, {
        method: "POST",
        body: { opportunityId: Number(id) },
      });
      return raw;
    },
    parsePage: (raw) =>
      parseGrantsSearch(raw, state.sources["grants-gov"]?.cursor || 0),
    parseRecord: (summary, raw) =>
      parseGrantsOpportunity(
        summary,
        raw,
        typeof now === "function" ? now() : undefined,
      ),
  });
}
