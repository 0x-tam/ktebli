import { BasicCrawler, Configuration } from "@crawlee/basic";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { SafeHttp, CrawlError } from "./safe-http.mjs";
import { parsePpa, parseCdr, mergeRecords, hash } from "./adapters.mjs";
export function initialState() {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    updatedAt: null,
    records: {},
    streams: {
      "ppa:en": {
        source: "ppa",
        locale: "en",
        cursor: "https://www.ppa.gov.lb/en/tenders",
        status: "pending",
        pages: 0,
        seen: [],
        fingerprints: [],
        expectedTotal: null,
      },
      "ppa:ar": {
        source: "ppa",
        locale: "ar",
        cursor: "https://www.ppa.gov.lb/ar/tenders",
        status: "pending",
        pages: 0,
        seen: [],
        fingerprints: [],
        expectedTotal: null,
      },
      ...Object.fromEntries(
        ["Ongoing"].map((stage) => [
          `cdr:${stage}`,
          {
            source: "cdr",
            locale: "en",
            stage,
            cursor: `https://www.cdr.gov.lb/en-US/Procurment.aspx?stage=${stage}`,
            status: "pending",
            pages: 0,
            seen: [],
            fingerprints: [],
            expectedTotal: null,
          },
        ]),
      ),
    },
  };
}
export function acceptPage(state, streamId, parsed) {
  const stream = state.streams[streamId];
  if (
    stream.expectedTotal !== null &&
    stream.expectedTotal !== parsed.expectedTotal
  )
    throw new CrawlError("listing_changed_during_crawl");
  const ids = parsed.records.map((r) => r.sourceKey),
    fingerprint = hash(ids);
  if (stream.fingerprints.includes(fingerprint))
    throw new CrawlError("pagination_no_progress");
  const seen = new Set(stream.seen),
    added = ids.filter((id) => !seen.has(id));
  if (ids.length && !added.length)
    throw new CrawlError("pagination_no_progress");
  if (parsed.range[0] !== stream.seen.length + 1 && parsed.expectedTotal !== 0)
    throw new CrawlError("pagination_range_gap");
  if (
    parsed.range[1] - parsed.range[0] + 1 !== ids.length &&
    parsed.expectedTotal !== 0
  )
    throw new CrawlError("pagination_row_count_mismatch");
  // Each locale is checked separately. Duplicates within/between pages are not
  // silently swallowed because that could mask offset-pagination movement.
  if (new Set(ids).size !== ids.length || added.length !== ids.length)
    throw new CrawlError("pagination_duplicate_rows");
  const totalSeen = stream.seen.length + added.length;
  if (!parsed.next && totalSeen !== parsed.expectedTotal)
    throw new CrawlError("pagination_total_mismatch");
  for (const record of parsed.records)
    state.records[record.sourceKey] = mergeRecords(
      state.records[record.sourceKey] ||
        state.previousRecords?.[record.sourceKey],
      record,
    );
  stream.pages++;
  stream.expectedTotal = parsed.expectedTotal;
  stream.seen.push(...added);
  stream.fingerprints.push(fingerprint);
  stream.cursor = parsed.next;
  stream.status = parsed.next ? "pending" : "complete";
  delete stream.error;
}
export function summary(state) {
  const streams = Object.fromEntries(
    Object.entries(state.streams).map(([id, s]) => [
      id,
      {
        status: s.status,
        pages: s.pages,
        uniqueRecords: s.seen.length,
        expectedTotal: s.expectedTotal,
        cursor: s.cursor,
        error: s.error ?? null,
      },
    ]),
  );
  const complete = Object.values(streams).every((s) => s.status === "complete");
  return {
    status: complete ? "complete" : "incomplete",
    scope:
      "listing discovery; detailed eligibility and submission dates require detail enrichment",
    uniqueRecords: Object.keys(state.records).length,
    streams,
    updatedAt: state.updatedAt,
  };
}
export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temp, path);
}
export function refreshState(state, selectedSources = ["ppa", "cdr"]) {
  const fresh = initialState();
  for (const [id, stream] of Object.entries(state.streams)) {
    if (!selectedSources.includes(stream.source)) fresh.streams[id] = stream;
  }
  fresh.previousRecords = { ...state.previousRecords, ...state.records };
  fresh.records = Object.fromEntries(
    Object.entries(state.records).filter(
      ([, r]) => !selectedSources.includes(r.source),
    ),
  );
  return fresh;
}
export async function run({
  statePath,
  maxPages = 60,
  http = new SafeHttp(),
  retryBlocked = false,
  refresh = false,
  selectedSources = ["ppa", "cdr"],
} = {}) {
  if (!statePath) throw new Error("statePath required");
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = initialState();
  }
  if (state.version !== 1) throw new Error("Unsupported state version");
  if (refresh) state = refreshState(state, selectedSources);
  const jobs = Object.entries(state.streams).filter(
    ([, s]) =>
      s.cursor &&
      selectedSources.includes(s.source) &&
      (s.status === "pending" || retryBlocked),
  );
  if (!jobs.length) {
    state.updatedAt = new Date().toISOString();
    await saveState(statePath, state);
    return { records: Object.values(state.records), coverage: summary(state) };
  }
  const config = new Configuration({
    persistStorage: false,
    purgeOnStart: true,
  });
  const crawler = new BasicCrawler(
    {
      maxConcurrency: 1,
      maxRequestRetries: 0,
      maxRequestsPerCrawl: maxPages,
      requestHandlerTimeoutSecs: 150,
      async requestHandler({ request }) {
        const id = request.userData.streamId,
          stream = state.streams[id];
        try {
          const response = await http.get(request.url);
          if (stream.source === "cdr") {
            parseCdr(response.body, response.url);
            throw new CrawlError("browser_pagination_required");
          }
          const parsed = parsePpa(response.body, response.url);
          acceptPage(state, id, parsed);
          if (stream.cursor)
            await crawler.addRequests([
              {
                url: stream.cursor,
                uniqueKey: `${id}:${stream.cursor}`,
                userData: { streamId: id },
              },
            ]);
        } catch (error) {
          stream.status = [
            "access_blocked",
            "robots_disallowed",
            "robots_unavailable",
          ].includes(error.code)
            ? "blocked"
            : "incomplete";
          stream.error = error.code || "request_failed";
        } finally {
          state.updatedAt = new Date().toISOString();
          await saveState(statePath, state);
        }
      },
      async failedRequestHandler({ request }, error) {
        const s = state.streams[request.userData.streamId];
        s.status = "incomplete";
        s.error = error.code || "handler_failed";
        await saveState(statePath, state);
      },
    },
    config,
  );
  await crawler.run(
    jobs.map(([id, s]) => ({
      url: s.cursor,
      uniqueKey: `${id}:${s.cursor}`,
      userData: { streamId: id },
    })),
  );
  state.updatedAt = new Date().toISOString();
  await saveState(statePath, state);
  return { records: Object.values(state.records), coverage: summary(state) };
}
