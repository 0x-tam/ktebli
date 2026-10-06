import { load } from "cheerio";
import { dateOnly, hash } from "./adapters.mjs";
import { allowedUrl, CrawlError, SafeHttp } from "./safe-http.mjs";

export const WORLD_BANK_SCOPE =
  "Current World Bank procurement notices explicitly assigned to project country Lebanon; bidder eligibility remains unverified";
const TYPES = [
  "Invitation for Bids",
  "Invitation for Prequalification",
  "Request for Expression of Interest",
];
const NOTICE_TYPES = TYPES.join("^");
const DETAIL_ROOT =
  "https://projects.worldbank.org/en/projects-operations/procurement-detail/";
const ID = /^OP\d{8}$/;

function validIsoDate(value) {
  return (
    typeof value === "string" &&
    /^20\d\d-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function worldBankQuery(day, rows = 50, offset = 0) {
  if (!validIsoDate(day)) throw new CrawlError("invalid_query_date");
  const u = new URL("https://search.worldbank.org/api/v2/procnotices");
  for (const [key, value] of Object.entries({
    format: "json",
    rows: String(rows),
    os: String(offset),
    project_ctry_name: "Lebanon",
    notice_type_exact: NOTICE_TYPES,
    deadline_strdate: day,
    srt: "submission_deadline_date",
    order: "asc",
    apilang: "en",
    srce: "both",
  }))
    u.searchParams.set(key, value);
  return allowedUrl(u.href).href;
}

function chunks(text, maximum = 1500) {
  const parts = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maximum, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + maximum / 2) end = space;
    }
    parts.push(text.slice(start, end).trim());
    start = end;
  }
  return parts;
}

export function cleanWorldBankText(html) {
  const $ = load(html);
  $("script,style").remove();
  $("br,hr").replaceWith(" ");
  $("p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,section").append(" ");
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function parseWorldBankNotice(
  raw,
  fetchedAt = new Date().toISOString(),
) {
  if (!raw || !ID.test(raw.id || ""))
    throw new CrawlError("wb_notice_id_changed");
  if (raw.project_ctry_name !== "Lebanon")
    throw new CrawlError("outside_lebanon_scope");
  if (!TYPES.includes(raw.notice_type))
    throw new CrawlError("wb_notice_type_changed");
  if (!["Published", "Revised"].includes(raw.notice_status))
    return { excluded: "not_published", id: raw.id };
  const deadline = raw.submission_deadline_date?.slice(0, 10);
  const publishedAt = dateOnly(raw.noticedate);
  const title = String(raw.bid_description || "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !validIsoDate(deadline) ||
    !publishedAt ||
    !title ||
    title.length > 2000 ||
    typeof raw.notice_text !== "string" ||
    !raw.notice_text
  )
    throw new CrawlError("wb_notice_schema_changed");
  const fullText = cleanWorldBankText(raw.notice_text);
  if (!fullText || fullText.length > 12000)
    throw new CrawlError("wb_notice_text_exceeds_contract");
  const time = raw.submission_deadline_time;
  if (time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new CrawlError("wb_deadline_time_invalid");
  const sourceUrl = `${DETAIL_ROOT}${raw.id}`;
  const evidence = [
    ...chunks(fullText).map((part, index) => ({
      label: `Publisher notice scope and requirements ${index + 1}`,
      text: part,
      url: sourceUrl,
    })),
    { label: "World Bank notice ID", text: raw.id, url: sourceUrl },
    {
      label: "Project country",
      text: raw.project_ctry_name,
      url: sourceUrl,
    },
    { label: "Notice type", text: raw.notice_type, url: sourceUrl },
    { label: "Notice status", text: raw.notice_status, url: sourceUrl },
    {
      label: "Submission deadline date",
      text: raw.submission_deadline_date,
      url: sourceUrl,
    },
    ...(time
      ? [
          {
            label: "Submission deadline time (timezone unstated)",
            text: time,
            url: sourceUrl,
          },
        ]
      : []),
    ...(raw.project_name
      ? [{ label: "Project", text: String(raw.project_name), url: sourceUrl }]
      : []),
    ...(raw.bid_reference_no
      ? [
          {
            label: "Bid reference",
            text: String(raw.bid_reference_no),
            url: sourceUrl,
          },
        ]
      : []),
  ];
  const description = [title, raw.project_name, raw.notice_type]
    .filter(Boolean)
    .join(". ");
  const content = {
    source: "worldbank",
    sourceKey: `worldbank:${raw.id}`,
    sourceUrl,
    title,
    description,
    publishedAt,
    deadline,
    deadlinePrecision: time ? "local_datetime" : "date_only",
    deadlineLocal: time ? `${deadline}T${time}` : null,
    deadlineTimezone: null,
    kind: "procurement",
    evidence,
    geography: {
      status: "lebanon_confirmed",
      evidence: [{ label: "Project country", text: "Lebanon", url: sourceUrl }],
    },
    identityClaim: {
      authority: "worldbank.org",
      reference: raw.id,
      granularity: "notice",
      proofUrl: sourceUrl,
    },
    applicationStatus: "needs_verification",
  };
  return {
    ...content,
    contentHash: hash(content),
    fetchedAt,
    detailStatus: "verified",
    locales: [
      {
        locale: "en",
        sourceUrl,
        title,
        description,
        publishedAt,
        deadline,
        evidence,
        detailStatus: "verified",
        detailFetchedAt: fetchedAt,
      },
    ],
  };
}

export async function crawlWorldBank({
  state,
  save,
  http = new SafeHttp({ contentTypes: /^(application\/json|text\/plain)/i }),
  now = new Date().toISOString(),
  rows = 50,
  maxPages = 10,
  refresh = false,
}) {
  if (state.version !== 1)
    throw new Error("Unsupported World Bank state version");
  const day = now.slice(0, 10);
  if (!validIsoDate(day)) throw new CrawlError("invalid_query_date");
  if (!Number.isInteger(rows) || rows < 1 || rows > 100)
    throw new Error("World Bank rows must be 1..100");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
    throw new Error("World Bank maxPages must be 1..10");
  if (state.queryDate !== day || refresh) {
    Object.assign(state, {
      queryDate: day,
      entries: {},
      excluded: {},
      seen: [],
      total: null,
      nextOffset: 0,
      pages: 0,
      status: "incomplete",
      error: null,
    });
    await save(state);
  }
  while (state.status !== "complete" && state.pages < maxPages) {
    try {
      const url = worldBankQuery(day, rows, state.nextOffset);
      const response = await http.get(url);
      const page = JSON.parse(response.body);
      const total = Number(page.total);
      const offset = Number(page.os);
      if (
        !Number.isInteger(total) ||
        total < 0 ||
        !Number.isInteger(offset) ||
        offset !== state.nextOffset ||
        !Array.isArray(page.procnotices) ||
        page.procnotices.length > rows ||
        (state.total !== null && state.total !== total) ||
        (total > offset && page.procnotices.length === 0)
      )
        throw new CrawlError("wb_pagination_schema_changed");
      const additions = page.procnotices.map((raw) =>
        parseWorldBankNotice(raw, now),
      );
      if (
        additions.some(
          (record) => !("excluded" in record) && record.deadline < day,
        )
      )
        throw new CrawlError("wb_deadline_filter_changed");
      const ids = additions.map((record) =>
        "excluded" in record ? record.id : record.sourceKey.slice(10),
      );
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => state.seen.includes(id)) ||
        offset + ids.length > total
      )
        throw new CrawlError("wb_pagination_duplicate_or_count");
      state.total = total;
      for (const record of additions) {
        if ("excluded" in record) state.excluded[record.id] = record.excluded;
        else state.entries[record.sourceKey] = record;
      }
      state.seen.push(...ids);
      state.nextOffset += ids.length;
      state.pages++;
      state.status = state.seen.length === total ? "complete" : "incomplete";
      state.error = null;
      state.updatedAt = now;
      await save(state);
    } catch (error) {
      state.status = "incomplete";
      state.error = error.code || "wb_request_failed";
      state.updatedAt = now;
      await save(state);
      break;
    }
  }
  const complete = state.status === "complete";
  return {
    records: complete ? Object.values(state.entries) : [],
    coverage: {
      status: complete ? "complete" : "incomplete",
      scope: WORLD_BANK_SCOPE,
      queryDate: day,
      apiTotal: state.total,
      apiSeen: state.seen.length,
      selectedRecords: Object.keys(state.entries).length,
      excludedRecords: Object.keys(state.excluded).length,
      pages: state.pages,
      pendingNotices:
        state.total === null ? null : state.total - state.seen.length,
      error: state.error,
      updatedAt: state.updatedAt ?? null,
    },
  };
}
