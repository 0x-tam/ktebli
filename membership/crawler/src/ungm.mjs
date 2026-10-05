import { load } from "cheerio";
import { clean, dateOnly, hash } from "./adapters.mjs";
import { allowedUrl, blockedBody, CrawlError, SafeHttp } from "./safe-http.mjs";

export function ungmNoticeUrl(id) {
  if (!/^\d{1,10}$/.test(String(id))) throw new CrawlError("invalid_notice_id");
  return allowedUrl(`https://www.ungm.org/Public/Notice/${id}`).href;
}

export function parseUngmNotice(
  html,
  url,
  fetchedAt = new Date().toISOString(),
) {
  if (blockedBody(html)) throw new CrawlError("access_blocked");
  const sourceUrl = allowedUrl(url).href;
  const id = new URL(sourceUrl).pathname.match(
    /^\/Public\/Notice\/(\d+)$/,
  )?.[1];
  if (!id) throw new CrawlError("invalid_notice_url");
  const $ = load(html);
  const panel = $(".ungm-panel");
  if (panel.length !== 1) throw new CrawlError("detail_schema_changed");
  const pageId = panel
    .find("input[data-noticeid]")
    .first()
    .attr("data-noticeid");
  if (pageId !== id) throw new CrawlError("issuer_id_mismatch");
  const title = clean(panel.find(".ungm-col-lg-9 > span.title").first().text());
  const type = clean(panel.find(".status-tag").first().text());
  const items = panel.children(".ungm-list-item");
  const fields = items
    .first()
    .find(".row")
    .map((_, row) => ({
      label: clean($(row).find(".label").first().text()).replace(/:$/, ""),
      text: clean($(row).find(".value").first().text()),
      url: sourceUrl,
    }))
    .get()
    .filter((field) => field.label && field.text);
  const value = (label) => fields.find((field) => field.label === label)?.text;
  const countries = value("Beneficiary countries or territories");
  const publishedAt = dateOnly(value("Published on"));
  const deadlineText = value("Deadline on");
  const deadline = dateOnly(deadlineText);
  const description = clean(items.eq(1).text()).replace(/^Description\s*/, "");
  if (
    !title ||
    !type ||
    !countries ||
    !publishedAt ||
    !deadline ||
    !description
  )
    throw new CrawlError("detail_schema_changed");
  // The importer accepts 12,000 characters per evidence item. A longer issuer
  // description needs a separately reviewed representation, never truncation.
  if (description.length > 12000 || title.length > 2000)
    throw new CrawlError("detail_exceeds_contract");
  if (!/(?:^|[,;\s])Lebanon(?:$|[,;\s])/i.test(countries))
    throw new CrawlError("outside_lebanon_scope");
  const time = deadlineText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!time && /\b\d{1,2}:\d{2}\b/.test(deadlineText))
    throw new CrawlError("invalid_deadline_time");
  const deadlineLocal = time
    ? `${deadline}T${time[1].padStart(2, "0")}:${time[2]}`
    : null;
  const deadlineTimezone =
    deadlineText.match(/\b(?:GMT|UTC)\s*[+-]\s*\d{1,2}(?:[:.]\d\d)?/i)?.[0] ??
    null;
  const evidence = [
    { label: "Notice type", text: type, url: sourceUrl },
    ...fields,
    { label: "Description", text: description, url: sourceUrl },
  ];
  const kind = /^Grant support-call for proposal$/i.test(type)
    ? "grant"
    : /^(?:Request for proposal|Request for quotation|Invitation to bid|Expression of interest|Request for information|Invitation for pre-qualification|Request for proposals|Invitation to tender)/i.test(
          type,
        )
      ? "procurement"
      : "unknown";
  const applicationStatus =
    /^(?:awarded|cancelled|canceled|closed)$/i.test(type) ||
    deadline < fetchedAt.slice(0, 10)
      ? "closed"
      : "needs_verification";
  const content = {
    source: "ungm",
    sourceKey: `ungm:${id}`,
    sourceUrl,
    title,
    description,
    publishedAt,
    deadline,
    deadlineLocal,
    deadlinePrecision: deadlineLocal ? "local_datetime" : "date",
    deadlineTimezone,
    kind,
    evidence,
    applicationStatus,
  };
  return {
    ...content,
    fetchedAt,
    contentHash: hash(content),
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

// This is an editorial set of known official detail URLs, not an UNGM discovery
// feed. Persist after every attempt so a bounded run resumes without repeating it.
export async function crawlUngmCurated({
  ids,
  state,
  save,
  maxDetails = 12,
  now = new Date().toISOString(),
  ttlMs = 24 * 60 * 60 * 1000,
  http = new SafeHttp(),
}) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw new Error("Unique notice IDs required");
  ids.forEach(ungmNoticeUrl);
  if (!Number.isInteger(maxDetails) || maxDetails < 0 || maxDetails > 25)
    throw new Error("maxDetails must be 0..25");
  const entries = (state.entries ||= {});
  const due = ids.filter((id) => {
    const old = entries[id];
    return (
      !old?.record ||
      Date.parse(now) - Date.parse(old.record.fetchedAt) >= ttlMs
    );
  });
  // Unfetched IDs before rechecks; within each class, oldest attempt first.
  due.sort(
    (a, b) =>
      Number(Boolean(entries[a]?.record)) -
        Number(Boolean(entries[b]?.record)) ||
      (Date.parse(entries[a]?.attemptedAt) || 0) -
        (Date.parse(entries[b]?.attemptedAt) || 0),
  );
  for (const id of due.slice(0, maxDetails)) {
    const old = entries[id];
    try {
      const response = await http.get(ungmNoticeUrl(id));
      entries[id] = {
        attemptedAt: now,
        record: parseUngmNotice(response.body, response.url, now),
      };
    } catch (error) {
      entries[id] = {
        ...old,
        attemptedAt: now,
        error: error.code || "request_failed",
      };
    }
    await save(state);
  }
  const fresh = ids.filter((id) => {
    const record = entries[id]?.record;
    return record && Date.parse(now) - Date.parse(record.fetchedAt) < ttlMs;
  });
  const records = ids.flatMap((id) => {
    const record = entries[id]?.record;
    if (!record) return [];
    return [
      fresh.includes(id)
        ? record
        : {
            ...record,
            detailStatus: "partial",
            locales: record.locales.map((locale) => ({
              ...locale,
              detailNeedsRefresh: true,
            })),
          },
    ];
  });
  return {
    records,
    coverage: {
      status: fresh.length === ids.length ? "complete" : "incomplete",
      scope:
        "Curated official UNGM notice detail URLs only; public discovery coverage is unavailable",
      selectedNoticeIds: ids.length,
      freshVerifiedNotices: fresh.length,
      pendingNotices: ids.length - fresh.length,
      attemptedThisRun: Math.min(due.length, maxDetails),
      errors: Object.fromEntries(
        ids
          .filter((id) => entries[id]?.error)
          .map((id) => [id, entries[id].error]),
      ),
      updatedAt: now,
    },
  };
}
