import { createHash } from "node:crypto";
import { load } from "cheerio";
import { allowedUrl, blockedBody, CrawlError } from "./safe-http.mjs";
export const clean = (text) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim();
export const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Operational timestamps and refresh bookkeeping must not trigger paid rematching.
export function recordContentHash(locales) {
  return hash(
    locales
      .map((v) => ({
        locale: v.locale,
        sourceUrl: v.sourceUrl,
        title: v.title,
        description: v.description,
        publishedAt: v.publishedAt,
        deadline: v.deadline,
        deadlineLocal: v.deadlineLocal ?? null,
        deadlinePrecision:
          v.deadlinePrecision ?? (v.deadline ? "date" : "unknown"),
        deadlineTimezone: v.deadlineTimezone ?? null,
        evidence: v.evidence,
      }))
      .sort((a, b) => a.locale.localeCompare(b.locale)),
  );
}
export function dateOnly(text) {
  const iso = clean(text).match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) {
    const value = iso.slice(1).join("-");
    return Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
      ? value
      : null;
  }
  const en = clean(text).match(
    /\b(\d{1,2})[ -](January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ -](20\d\d)\b/i,
  );
  if (!en) return null;
  const month =
    [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].findIndex((m) => m.startsWith(en[2].toLowerCase())) + 1;
  return dateOnly(
    `${en[3]}-${String(month).padStart(2, "0")}-${en[1].padStart(2, "0")}`,
  );
}
// PPA renders HTTP pagination URLs even on HTTPS. Upgrade only this known
// publisher's exact pagination path; transport itself never follows downgrades.
export function ppaNext(href, base) {
  const u = new URL(href, base),
    b = new URL(base);
  if (u.hostname !== b.hostname || !/^\/(en|ar)\/tenders$/.test(u.pathname))
    throw new CrawlError("invalid_pagination_url");
  u.protocol = "https:";
  allowedUrl(u);
  const current = Number(b.searchParams.get("page") || 1),
    next = Number(u.searchParams.get("page"));
  if (
    !Number.isInteger(next) ||
    next !== current + 1 ||
    u.pathname !== b.pathname
  )
    throw new CrawlError("invalid_pagination_cursor");
  return u.href;
}
// Only publisher-labelled method/status fields determine competition state.
// Titles and dates are not evidence that an award is open for applications.
export function ppaApplicationStatus(evidence) {
  const fields = evidence.filter((item) =>
    /^(?:Procurement method|Procuring Method|طريقة الشراء|طريقة التلزيم|طريقة التعاقد|Status|Tender status|Procurement status|حالة المناقصة|حالة التلزيم)\s*:?$/i.test(
      clean(item.label),
    ),
  );
  const status = fields
    .filter((item) => /status|حالة/i.test(item.label))
    .map((item) => clean(item.text).toLowerCase());
  if (
    status.some((value) =>
      /^(?:awarded|cancelled|canceled|closed|ملغاة|ملغي|ألغيت|ألغى|منتهية|تم التلزيم|مرساة)$/.test(
        value,
      ),
    )
  )
    return "closed";
  const method = fields
    .filter((item) => /method|طريقة/i.test(item.label))
    .map((item) => clean(item.text).toLowerCase());
  if (
    method.some((value) =>
      /^(?:direct|direct contracting|direct award|consensual|بالتراضي|تعاقد مباشر|تلزيم مباشر)$/.test(
        value,
      ),
    )
  )
    return "not_open_competition";
  return "needs_verification";
}
export function parsePpa(html, url, fetchedAt = new Date().toISOString()) {
  if (blockedBody(html)) throw new CrawlError("access_blocked");
  const $ = load(html),
    locale = new URL(url).pathname.split("/")[1];
  const records = [];
  $("#information-table tbody > tr").each((_, el) => {
    const td = $(el).children("td");
    if (td.length !== 8) return;
    const id = clean(td.eq(0).text()),
      a = td.eq(3).find("a").first();
    if (!/^\d+$/.test(id) || !a.length)
      throw new CrawlError("listing_schema_changed");
    const sourceUrl = allowedUrl(new URL(a.attr("href"), url)).href;
    if (new URL(sourceUrl).pathname !== `/${locale}/tenders/details/${id}`)
      throw new CrawlError("issuer_id_mismatch");
    const title = clean(a.text()).replace(/^→\s*/, "");
    const evidence = [
      "Issuer ID",
      "Procuring entity",
      "Purchase code",
      "Tender title",
      "Procurement method",
      "Announcement date",
      "Opening of offers",
    ].map((label, i) => ({
      label,
      text: clean(td.eq(i).text()),
      url: sourceUrl,
    }));
    const description = `${evidence[1].text}. ${evidence[4].text}. Purchase code: ${evidence[2].text}`;
    // Opening of offers is NOT necessarily the submission deadline.
    const version = {
      locale,
      sourceUrl,
      title,
      description,
      publishedAt: dateOnly(evidence[5].text),
      deadline: null,
      evidence,
      listingEvidence: evidence,
      listingDescription: description,
      listingFetchedAt: fetchedAt,
      listingHash: hash({
        title,
        description,
        publishedAt: dateOnly(evidence[5].text),
        evidence,
      }),
    };
    records.push({
      source: "ppa",
      sourceKey: `ppa:${id}`,
      sourceUrl,
      title,
      description,
      publishedAt: version.publishedAt,
      deadline: null,
      kind: "procurement",
      evidence,
      fetchedAt,
      contentHash: recordContentHash([version]),
      locales: [version],
      detailStatus: "not_fetched",
      applicationStatus: ppaApplicationStatus(evidence),
    });
  });
  if (!$("#information-table").length)
    throw new CrawlError("listing_schema_changed");
  const counts = $(".pagination p.small span")
    .map((_, el) => Number(clean($(el).text()).replace(/,/g, "")))
    .get();
  const expectedTotal =
    counts.length === 3 && counts.every(Number.isFinite) ? counts[2] : null;
  const nextLinks = [
    ...new Set(
      $('.pagination a[rel="next"]')
        .map((_, el) => $(el).attr("href"))
        .get(),
    ),
  ];
  if (nextLinks.length > 1) throw new CrawlError("ambiguous_pagination");
  const next = nextLinks.length ? ppaNext(nextLinks[0], url) : null;
  if (!records.length && expectedTotal !== 0)
    throw new CrawlError("empty_listing_unproven");
  if (expectedTotal === null) throw new CrawlError("pagination_total_missing");
  return {
    records,
    next,
    expectedTotal,
    range: counts.slice(0, 2),
    terminal: !next,
  };
}
export function enrichPpa(
  record,
  html,
  url,
  fetchedAt = new Date().toISOString(),
) {
  if (blockedBody(html)) throw new CrawlError("access_blocked");
  const $ = load(html),
    locale = new URL(url).pathname.split("/")[1];
  if (!$(".article-title").length)
    throw new CrawlError("detail_schema_changed");
  const fields = [];
  $("tr").each((_, el) => {
    const td = $(el).children("td");
    if (td.length === 2 && td.eq(0).find("strong").length)
      fields.push({
        label: clean(td.eq(0).text()),
        text: clean(td.eq(1).text()),
        url,
      });
  });
  const deadline = fields.find((f) =>
    /^(Deadline for submission of offers|الموعد النهائي لتقديم العروض)\s*:/i.test(
      f.label,
    ),
  );
  const description = fields.find((f) =>
    /^(Description|الوصف)\s*:/i.test(f.label),
  );
  const version = record.locales.find((v) => v.locale === locale);
  if (!version) throw new CrawlError("locale_missing");
  version.listingEvidence ||= version.evidence.slice(0, 7);
  version.detailEvidence = fields;
  version.evidence = [...version.listingEvidence, ...fields];
  version.detailFetchedAt = fetchedAt;
  version.detailHash = hash(fields);
  version.detailListingHash = version.listingHash ?? null;
  version.detailNeedsRefresh = false;
  version.detailDescription = description?.text || null;
  version.deadline = deadline ? dateOnly(deadline.text) : null;
  version.deadlineLocal =
    deadline?.text
      ?.match(/20\d\d-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?/)?.[0]
      ?.replace(" ", "T") || null;
  version.deadlinePrecision = version.deadlineLocal
    ? "local_datetime"
    : version.deadline
      ? "date"
      : "unknown";
  version.deadlineTimezone =
    deadline?.text?.match(
      /(?:\b(?:UTC|GMT)(?:[+-]\d{1,2}(?::\d{2})?)?\b|[+-]\d{2}:\d{2})/,
    )?.[0] || null;
  // Null means the issuer did not explicitly state a timezone; never invent one.
  if (description?.text) version.description = description.text;
  version.detailStatus = "verified";
  record.detailStatus = record.locales.every(
    (v) => v.detailStatus === "verified",
  )
    ? "verified"
    : "partial";
  record.fetchedAt = fetchedAt;
  return mergeRecords(record, record);
}
export function mergeRecords(existing, incoming) {
  if (!existing) return incoming;
  if (existing.sourceKey !== incoming.sourceKey)
    throw new CrawlError("merge_key_mismatch");
  const byLocale = new Map(existing.locales.map((v) => [v.locale, v]));
  for (const next of incoming.locales) {
    const old = byLocale.get(next.locale);
    // A listing refresh cannot erase detail facts. Keep their provenance and
    // schedule revalidation if listing content changed or the detail TTL expires.
    if (old?.detailStatus === "verified" && !next.detailStatus) {
      const detailEvidence = old.detailEvidence || old.evidence.slice(7);
      byLocale.set(next.locale, {
        ...old,
        ...next,
        detailEvidence,
        evidence: [
          ...(next.listingEvidence || next.evidence),
          ...detailEvidence,
        ],
        description: old.detailDescription || old.description,
        deadline: old.deadline,
        deadlineLocal: old.deadlineLocal,
        deadlinePrecision: old.deadlinePrecision,
        deadlineTimezone: old.deadlineTimezone,
        detailStatus: "verified",
        detailFetchedAt: old.detailFetchedAt,
        detailHash: old.detailHash,
        detailListingHash: old.detailListingHash,
        detailNeedsRefresh:
          old.detailNeedsRefresh || old.listingHash !== next.listingHash,
      });
    } else byLocale.set(next.locale, next);
  }
  const locales = [...byLocale.values()].sort((a, b) =>
    a.locale.localeCompare(b.locale),
  );
  const primary = locales.find((v) => v.locale === "en") || locales[0];
  const deadlines = [
    ...new Set(locales.map((v) => v.deadline).filter(Boolean)),
  ];
  const localTimes = [
    ...new Set(locales.map((v) => v.deadlineLocal).filter(Boolean)),
  ];
  const zones = [
    ...new Set(locales.map((v) => v.deadlineTimezone).filter(Boolean)),
  ];
  const deadlineConflict =
    deadlines.length > 1 || localTimes.length > 1 || zones.length > 1;
  const detailNeedsRefresh = locales.some(
    (v) =>
      v.detailStatus === "verified" &&
      (v.detailNeedsRefresh ||
        !v.detailFetchedAt ||
        Date.parse(incoming.fetchedAt || existing.fetchedAt) -
          Date.parse(v.detailFetchedAt) >=
          86_400_000),
  );
  return {
    ...existing,
    ...incoming,
    ...primary,
    deadline: deadlineConflict
      ? null
      : primary.deadline || deadlines[0] || null,
    deadlineConflict,
    deadlineLocal: deadlineConflict ? null : (primary.deadlineLocal ?? null),
    deadlinePrecision: deadlineConflict
      ? "unknown"
      : (primary.deadlinePrecision ?? (primary.deadline ? "date" : "unknown")),
    deadlineTimezone: deadlineConflict
      ? null
      : (primary.deadlineTimezone ?? null),
    sourceKey: existing.sourceKey,
    locales,
    evidence: locales.flatMap((v) => v.evidence),
    detailNeedsRefresh,
    detailStatus:
      locales.every((v) => v.detailStatus === "verified") && !detailNeedsRefresh
        ? "verified"
        : locales.some((v) => v.detailStatus === "verified")
          ? "partial"
          : "not_fetched",
    contentHash: recordContentHash(locales),
    applicationStatus:
      existing.source === "ppa"
        ? locales.some((v) => ppaApplicationStatus(v.evidence) === "closed")
          ? "closed"
          : locales.some(
                (v) =>
                  ppaApplicationStatus(v.evidence) === "not_open_competition",
              )
            ? "not_open_competition"
            : "needs_verification"
        : (incoming.applicationStatus ?? existing.applicationStatus),
  };
}
export function parseCdr(html, url, fetchedAt = new Date().toISOString()) {
  if (blockedBody(html)) throw new CrawlError("access_blocked");
  const $ = load(html),
    records = [];
  if (!$("#ProcurmentsTbody").length)
    throw new CrawlError("listing_schema_changed");
  $("#ProcurmentsTbody > tr.content").each((_, el) => {
    const td = $(el).children("td");
    if (td.length !== 10) throw new CrawlError("listing_schema_changed");
    const link = td.eq(3).find("a").first();
    const detail = allowedUrl(new URL(link.attr("href"), url));
    const id = detail.searchParams.get("id"),
      lot = detail.searchParams.get("lot");
    if (!/^\d+$/.test(id || "") || !/^\d+$/.test(lot || ""))
      throw new CrawlError("issuer_id_missing");
    const labels = [
      "CDR procurement ID",
      "Publication date",
      "PPA reference and publication date",
      "Project title and lot",
      "Procurement category",
      "Procurement type",
      "Funding source",
      "Tender document cost",
      "Tender document language",
      "Extended deadline for submission",
    ];
    const evidence = labels.map((label, i) => ({
      label,
      text: clean(td.eq(i).text()),
      url: detail.href,
    }));
    const title = clean(link.text()),
      description = evidence
        .slice(4, 9)
        .map((e) => `${e.label}: ${e.text}`)
        .join(". ");
    const version = {
      locale: "en",
      sourceUrl: detail.href,
      title,
      description,
      publishedAt: dateOnly(evidence[1].text),
      deadline: dateOnly(evidence[9].text),
      evidence,
    };
    const procurementType = evidence[5].text;
    records.push({
      source: "cdr",
      sourceKey: `cdr:${id}:lot:${lot}`,
      sourceUrl: detail.href,
      title,
      description,
      publishedAt: version.publishedAt,
      deadline: version.deadline,
      kind: "procurement",
      evidence,
      fetchedAt,
      contentHash: recordContentHash([version]),
      locales: [version],
      detailStatus: "not_fetched",
      applicationStatus: /consensual|direct|awarded/i.test(procurementType)
        ? "not_open_competition"
        : "needs_verification",
      crossReferences: [
        { source: "ppa", issuerId: clean(td.eq(2).find("a").text()) },
      ],
    });
  });
  const more = $("#LoadMoreWebsiteProcurments");
  return {
    records,
    loadMorePresent: !!more.length,
    loadMoreHidden:
      more.attr("hidden") !== undefined ||
      /display\s*:\s*none/i.test(more.attr("style") || ""),
    terminal: false,
  };
}
