import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { load } from "cheerio";
import { SafeHttp, CrawlError } from "./safe-http.mjs";

export const PUBLIC_CATALOGS = ["grants-gov", "sam-gov"];
const MAX_PAGES = 10;
const ISO3_TO_ISO2 = new Map(
  Object.entries({
    ARE: "AE",
    ARG: "AR",
    AUS: "AU",
    AUT: "AT",
    BEL: "BE",
    BGD: "BD",
    BRA: "BR",
    CAN: "CA",
    CHE: "CH",
    CHL: "CL",
    CHN: "CN",
    COL: "CO",
    CZE: "CZ",
    DEU: "DE",
    DNK: "DK",
    EGY: "EG",
    ESP: "ES",
    FIN: "FI",
    FRA: "FR",
    GBR: "GB",
    GRC: "GR",
    HKG: "HK",
    IND: "IN",
    IRL: "IE",
    IRQ: "IQ",
    ISL: "IS",
    ISR: "IL",
    ITA: "IT",
    JOR: "JO",
    JPN: "JP",
    KEN: "KE",
    KOR: "KR",
    KWT: "KW",
    LBN: "LB",
    LKA: "LK",
    MAR: "MA",
    MEX: "MX",
    MYS: "MY",
    NGA: "NG",
    NLD: "NL",
    NOR: "NO",
    NPL: "NP",
    NZL: "NZ",
    PAK: "PK",
    POL: "PL",
    PRT: "PT",
    QAT: "QA",
    ROU: "RO",
    RUS: "RU",
    SAU: "SA",
    SGP: "SG",
    SWE: "SE",
    SYR: "SY",
    THA: "TH",
    TUR: "TR",
    UKR: "UA",
    USA: "US",
    ZAF: "ZA",
  }),
);

export function publicCatalogState() {
  return { version: 1, sources: {} };
}

export async function loadPublicCatalogState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (
      state.version !== 1 ||
      !state.sources ||
      typeof state.sources !== "object"
    )
      throw new Error("Unsupported public catalogue state");
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return publicCatalogState();
  }
}

export async function savePublicCatalogState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temp, path);
}

export function publicCatalogStream(sourceId, sourceState) {
  return {
    status: sourceState.status,
    pages: sourceState.pages,
    uniqueRecords: sourceState.seenIds.length,
    expectedTotal: sourceState.expectedTotal,
    cursor: sourceState.cursor,
    cursorUnit: sourceState.cursorUnit || "offset",
    error: sourceState.error ?? null,
  };
}

export function publicCatalogSummary(sourceId, sourceState, scope) {
  const stream = publicCatalogStream(sourceId, sourceState);
  return {
    status: stream.status === "complete" ? "complete" : "incomplete",
    scope,
    uniqueRecords: Object.keys(sourceState.records).length,
    streams: { [sourceId]: stream },
    updatedAt: sourceState.updatedAt,
  };
}

export function jsonHttp(
  http = new SafeHttp({
    contentTypes: /^(?:application\/json|text\/plain)(?:\s*;|$)/i,
    maxBytes: 4_000_000,
  }),
) {
  return {
    async request(url, { method = "GET", body, keyed = false } = {}) {
      const response = await http.raw(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        followRedirects: false,
      });
      try {
        return JSON.parse(response.body);
      } catch {
        throw new CrawlError("invalid_json_response");
      }
    },
  };
}

export function safeEvidenceText(value, max = 12_000) {
  const raw = String(value ?? "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const $ = load(`<div>${raw}</div>`);
  const text = $("div").text().replace(/\s+/g, " ").trim();
  if (text.length > max) throw new CrawlError("source_text_exceeds_contract");
  return text;
}

export function countryCodesFromEvidence(evidence) {
  const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  const iso3166Alpha2 = new Set(
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
      " ",
    ),
  );
  const names = new Map();
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = regionNames.of(code);
      if (iso3166Alpha2.has(code) && name && name !== code)
        names.set(name.toLocaleLowerCase("en"), code);
    }
  }
  const countryEvidence = [];
  const countryCodes = new Set();
  let worldwide = false;
  for (const item of evidence) {
    const label = String(item.label ?? "");
    const text = String(item.text ?? "").trim();
    if (!text) continue;
    if (
      /^(?:place of performance country|performance country|project country|project locations|project location|implementation country|implementation location|opportunity geography|geographic scope)$/i.test(
        label,
      )
    ) {
      const explicit = text.match(
        /\b(?:worldwide|global(?:ly)?|any country(?: worldwide)?|all countries)\b/i,
      );
      if (explicit) {
        worldwide = true;
        countryEvidence.push(item);
        continue;
      }
      const found = [];
      if (/^[A-Za-z]{2}$/.test(text)) {
        const code = text.toUpperCase();
        if (
          iso3166Alpha2.has(code) &&
          names.has(regionNames.of(code).toLocaleLowerCase("en"))
        ) {
          countryCodes.add(code);
          found.push(code);
        }
      }
      if (/^[A-Za-z]{3}$/.test(text)) {
        const code = ISO3_TO_ISO2.get(text.toUpperCase());
        if (code && iso3166Alpha2.has(code)) {
          countryCodes.add(code);
          found.push(text.toUpperCase());
        }
      }
      for (const [name, code] of names) {
        if (
          new RegExp(
            `(?:^|[^\\p{L}])${escapeRegExp(name)}(?:$|[^\\p{L}])`,
            "iu",
          ).test(text)
        ) {
          countryCodes.add(code);
          found.push(name);
        }
      }
      if (found.length) countryEvidence.push(item);
    }
  }
  if (worldwide && countryCodes.size)
    return { countryCodes: [], scope: "unknown", evidence: [] };
  return {
    countryCodes: [...countryCodes].sort(),
    scope: worldwide
      ? "worldwide"
      : countryCodes.size
        ? "countries"
        : "unknown",
    evidence: countryEvidence.map(({ label, text, url }) => ({
      label,
      text,
      url,
    })),
  };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function runPublicCatalog({
  sourceId,
  state,
  save = async () => {},
  maxPages = MAX_PAGES,
  refresh = false,
  apiKey,
  fetchPage,
  fetchDetails,
  parsePage,
  parseRecord,
  initializeSource,
  scope,
  now = () => new Date().toISOString(),
}) {
  if (!PUBLIC_CATALOGS.includes(sourceId))
    throw new Error("Unsupported public catalogue");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES)
    throw new Error(`maxPages must be 1..${MAX_PAGES}`);
  if (!state || state.version !== 1 || !state.sources)
    throw new Error("Valid public catalogue state required");
  let source = state.sources[sourceId];
  if (refresh || !source) {
    source = {
      status:
        sourceId === "sam-gov" && !apiKey
          ? "disabled_missing_api_key"
          : "pending",
      cursor: 0,
      cursorUnit: "offset",
      pages: 0,
      seenIds: [],
      fingerprints: [],
      expectedTotal: null,
      pendingPage: null,
      records: {},
      updatedAt: now(),
      ...(initializeSource ? initializeSource() : {}),
    };
    state.sources[sourceId] = source;
  }
  if (sourceId === "sam-gov" && !apiKey) {
    source.status = "disabled_missing_api_key";
    source.error = "missing_api_key";
    source.updatedAt = now();
    await save(state);
    return resultFor(sourceId, source, scope);
  }
  if (source.status === "complete") return resultFor(sourceId, source, scope);
  source.status = "pending";
  delete source.error;
  let processed = 0;
  while (processed < maxPages && source.status === "pending") {
    try {
      const parsed = await fetchPage(source.cursor, apiKey);
      const page = parsePage(parsed);
      const ids = page.records.map((record) => record.id);
      if (new Set(ids).size !== ids.length)
        throw new CrawlError("duplicate_page_ids");
      if (source.expectedTotal !== null && source.expectedTotal !== page.total)
        throw new CrawlError("listing_changed_during_crawl");
      if (page.offset !== source.cursor)
        throw new CrawlError("pagination_offset_mismatch");
      const fingerprint = ids.join("\u0000");
      if (source.fingerprints.includes(fingerprint))
        throw new CrawlError("pagination_no_progress");
      if (
        source.pendingPage &&
        (source.pendingPage.offset !== page.offset ||
          source.pendingPage.fingerprint !== fingerprint)
      )
        throw new CrawlError("listing_changed_during_resume");
      const resumingPage = Boolean(source.pendingPage);
      source.pendingPage ||= { offset: page.offset, fingerprint };
      const seen = new Set(source.seenIds);
      for (const summary of page.records) {
        if (seen.has(summary.id)) {
          if (resumingPage) continue;
          throw new CrawlError("pagination_duplicate_rows");
        }
        const detail = await fetchDetails(summary.id, apiKey);
        const record = parseRecord(summary, detail);
        if (!record || record.source !== sourceId || !record.sourceKey)
          throw new CrawlError("record_identity_mismatch");
        source.records[record.sourceKey] = record;
        source.seenIds.push(summary.id);
        seen.add(summary.id);
        source.updatedAt = now();
        await save(state);
      }
      if (source.expectedTotal === null) source.expectedTotal = page.total;
      source.pages++;
      processed++;
      source.fingerprints.push(fingerprint);
      source.cursor = page.nextCursor ?? page.offset + ids.length;
      source.pendingPage = null;
      if (page.terminal ?? source.cursor >= page.total) {
        if (source.seenIds.length !== page.total)
          throw new CrawlError("pagination_total_mismatch");
        source.status = "complete";
      } else if (!ids.length) {
        throw new CrawlError("empty_page_before_total");
      }
      source.updatedAt = now();
      await save(state);
    } catch (error) {
      source.status = "incomplete";
      source.error = error.code || "request_failed";
      source.updatedAt = now();
      await save(state);
      break;
    }
  }
  if (source.status === "pending") {
    source.status = "incomplete";
    source.error = "page_limit_reached";
    source.updatedAt = now();
    await save(state);
  }
  return resultFor(sourceId, source, scope);
}

function resultFor(sourceId, source, scope) {
  const coverage = publicCatalogSummary(sourceId, source, scope);
  return {
    records: Object.values(source.records),
    coverage: {
      ...coverage,
      selectedSources: [sourceId],
      selectedStatus: source.status === "complete" ? "complete" : "incomplete",
    },
  };
}
