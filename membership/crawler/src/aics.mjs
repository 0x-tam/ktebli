import { load } from "cheerio";
import { clean, dateOnly, hash } from "./adapters.mjs";
import { SafeHttp, CrawlError, blockedBody } from "./safe-http.mjs";
export const aicsListing =
  "https://trasparenzabeirut.aics.gov.it/index.php?id_sezione=952";
export function aicsUrl(input) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "trasparenzabeirut.aics.gov.it" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new CrawlError("aics_url_not_allowed");
  if (u.pathname === "/robots.txt" && !u.search) return u;
  if (
    /^\/archivio97_concessione-contributi_0_\d+_952_1\.html$/.test(
      u.pathname,
    ) &&
    !u.search
  )
    return u;
  if (
    u.pathname === "/index.php" &&
    u.searchParams.get("id_sezione") === "952" &&
    [...u.searchParams.keys()].every((k) =>
      [
        "id_sezione",
        "id_cat",
        "ordina_oggetto",
        "limite",
        "inizio",
        "ordine",
        "senso",
        "gtp",
      ].includes(k),
    ) &&
    (!u.searchParams.has("limite") || u.searchParams.get("limite") === "20") &&
    (!u.searchParams.has("inizio") ||
      /^\d+$/.test(u.searchParams.get("inizio"))) &&
    (!u.searchParams.has("ordine") || u.searchParams.get("ordine") === "anno")
  )
    return u;
  throw new CrawlError("aics_url_not_allowed");
}
const italianDate = (text) => {
  const m = clean(text).match(/^(\d\d)-(\d\d)-(20\d\d)$/);
  return m ? dateOnly(`${m[3]}-${m[2]}-${m[1]}`) : null;
};
export function parseAics(
  html,
  url = aicsListing,
  fetchedAt = new Date().toISOString(),
) {
  if (blockedBody(html)) throw new CrawlError("access_blocked");
  const $ = load(html),
    table = $('table[summary="Elenco dei bandi"]');
  if (table.length !== 1) throw new CrawlError("aics_schema_changed");
  const rows = table.find('tr[id^="tr_97_"]'),
    records = [],
    excluded = [],
    unresolved = [];
  rows.each((_, el) => {
    const td = $(el).children("td");
    if (td.length !== 5) throw new CrawlError("aics_schema_changed");
    const id = $(el).attr("id").replace("tr_97_", ""),
      title = clean(td.eq(1).text()),
      sourceUrl = aicsUrl(new URL(td.eq(1).find("a").attr("href"), url)).href;
    if (!sourceUrl.includes(`_0_${id}_952_1.html`))
      throw new CrawlError("issuer_id_mismatch");
    if (!/\b(Lebanon|Lebanese|Libano|libanesi)\b/i.test(title)) {
      if (/\b(Siria|siriana|Syria)\b/i.test(title)) excluded.push(id);
      else unresolved.push({ id, title, sourceUrl });
      return;
    }
    const deadline = italianDate(td.eq(2).text()),
      publisherStatus = clean(td.eq(3).text());
    const applicationStatus =
      /Conclusa/i.test(publisherStatus) ||
      (deadline && deadline < fetchedAt.slice(0, 10))
        ? "closed"
        : "needs_verification";
    const evidence = [
      "Reference year",
      "Call title",
      "Application deadline",
      "Publisher procedure status",
      "Eligible proponents",
    ].map((label, i) => ({
      label,
      text: clean(td.eq(i).text()),
      url: sourceUrl,
    }));
    const description = `${title}. Eligible proponents: ${evidence[4].text}. Publisher procedure status: ${publisherStatus}.`;
    const content = {
      source: "aics",
      sourceKey: `aics:${id}`,
      sourceUrl,
      title,
      description,
      publishedAt: null,
      deadline,
      deadlinePrecision: deadline ? "date" : "unknown",
      deadlineTimezone: null,
      kind: "grant",
      applicationStatus,
      evidence,
      countryScope: "Lebanon explicitly named by publisher",
    };
    records.push({
      ...content,
      fetchedAt,
      contentHash: hash(content),
      detailStatus: "not_fetched",
      locales: [
        {
          locale: "it",
          sourceUrl,
          title,
          description,
          publishedAt: null,
          deadline,
          evidence,
        },
      ],
    });
  });
  if (!rows.length) throw new CrawlError("aics_empty_unproven");
  const offset = Number(new URL(url).searchParams.get("inizio") || 0);
  const links = $("a[href]")
    .map((_, e) => $(e).attr("href"))
    .get()
    .flatMap((h) => {
      try {
        const u = aicsUrl(new URL(h, url));
        return u.pathname === "/index.php" &&
          Number(u.searchParams.get("inizio")) > offset
          ? [u.href]
          : [];
      } catch {
        return [];
      }
    });
  const next =
    [...new Set(links)].sort(
      (a, b) =>
        Number(new URL(a).searchParams.get("inizio")) -
        Number(new URL(b).searchParams.get("inizio")),
    )[0] || null;
  if (next && Number(new URL(next).searchParams.get("inizio")) !== offset + 20)
    throw new CrawlError("aics_pagination_gap");
  // A full page without a next link is ambiguous. The observed list has18/20.
  if (!next && rows.length >= 20)
    throw new CrawlError("aics_terminal_unproven");
  return {
    records,
    excluded,
    unresolved,
    next,
    totalRows: rows.length,
    terminal: !next,
  };
}
export async function crawlAics({
  http = new SafeHttp({ urlPolicy: aicsUrl }),
  maxPages = 10,
} = {}) {
  let cursor = aicsListing,
    pages = 0,
    all = [],
    excluded = [],
    unresolved = [],
    seen = new Set(),
    error = null;
  try {
    while (cursor && pages < maxPages) {
      const response = await http.get(cursor),
        page = parseAics(response.body, response.url);
      const ids = [
        ...page.records.map((r) => r.sourceKey),
        ...page.excluded.map((id) => "aics:" + id),
        ...page.unresolved.map((r) => "aics:" + r.id),
      ];
      if (ids.some((id) => seen.has(id)))
        throw new CrawlError("pagination_no_progress");
      ids.forEach((id) => seen.add(id));
      all.push(...page.records);
      excluded.push(...page.excluded);
      unresolved.push(...page.unresolved);
      cursor = page.next;
      pages++;
    }
  } catch (e) {
    error = e.code || "aics_failed";
  }
  const status = !cursor && !error ? "complete" : "incomplete";
  return {
    records: all,
    coverage: {
      status,
      scope:
        "AICS Beirut grant listing; records explicitly naming Lebanon. Ambiguous geography remains excluded and listed for review.",
      uniqueRecords: all.length,
      updatedAt: new Date().toISOString(),
      streams: {
        "aics:it": {
          status,
          pages,
          uniqueRecords: all.length,
          expectedTotal: status === "complete" ? all.length : null,
          cursor,
          error,
          totalPublisherRows: seen.size,
          excludedOtherCountry: excluded.length,
          unresolvedGeography: unresolved,
          terminalVerified: status === "complete",
        },
      },
    },
  };
}
