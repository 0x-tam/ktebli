import { load } from "cheerio";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { sources } from "./sources.mjs";
import { SafeHttp, CrawlError } from "./safe-http.mjs";
import { clean, hash } from "./adapters.mjs";
const watchSources = sources.filter(
  (source) => source.status === "watchlist_only",
);
const urls = new Set(watchSources.map((source) => source.url));
const hosts = new Set([...urls].map((url) => new URL(url).hostname));
export function watchUrl(input) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new CrawlError("watch_url_not_allowed");
  if (
    urls.has(url.href) ||
    (hosts.has(url.hostname) && url.pathname === "/robots.txt" && !url.search)
  )
    return url;
  throw new CrawlError("watch_url_not_allowed");
}
export function watchSnapshot(
  source,
  html,
  fetchedAt = new Date().toISOString(),
) {
  const $ = load(html);
  $("script,style,nav,header,footer,noscript").remove();
  const root = $('main,article,[role="main"]').first();
  const text = clean((root.length ? root : $("body")).text());
  if (text.length < 100) throw new CrawlError("watch_content_unavailable");
  const closedEvidence =
    text.match(
      /.{0,80}(?:round has now closed|applications? (?:are |is )?closed|call.{0,30}closed).{0,100}/i,
    )?.[0] || null;
  return {
    source: source.id,
    sourceUrl: source.url,
    fetchedAt,
    contentHash: hash(text),
    title: clean($("title").text()),
    text: text.slice(0, 100_000),
    textTruncated: text.length > 100_000,
    scope:
      "official-page watch; opportunity extraction and pagination not qualified",
    opportunityCoverage: "not_qualified",
    observedStatus: closedEvidence
      ? "closed_statement_present"
      : "needs_review",
    evidence: closedEvidence
      ? [
          {
            label: "Publisher closure statement",
            text: closedEvidence,
            url: source.url,
          },
        ]
      : [],
  };
}
export async function runWatches({
  path,
  http = new SafeHttp({ urlPolicy: watchUrl }),
  selected = watchSources.map((s) => s.id),
} = {}) {
  let state = { version: 1, sources: {} };
  try {
    state = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  for (const source of watchSources.filter((s) => selected.includes(s.id))) {
    const previous = state.sources[source.id];
    try {
      const response = await http.get(source.url);
      const snapshot = watchSnapshot(source, response.body);
      state.sources[source.id] = {
        status: "watch_only",
        changed: previous?.snapshot
          ? previous.snapshot.contentHash !== snapshot.contentHash
          : null,
        lastSuccessAt: snapshot.fetchedAt,
        lastAttemptAt: snapshot.fetchedAt,
        error: null,
        snapshot,
      };
    } catch (e) {
      state.sources[source.id] = {
        ...previous,
        status: ["access_blocked", "robots_disallowed"].includes(e.code)
          ? "blocked"
          : "incomplete",
        lastAttemptAt: new Date().toISOString(),
        error: e.code || "watch_failed",
        opportunityCoverage: "not_qualified",
      };
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  return Object.fromEntries(
    Object.entries(state.sources).map(([id, value]) => [
      id,
      {
        status: value.status,
        changed: value.changed,
        lastSuccessAt: value.lastSuccessAt ?? null,
        error: value.error ?? null,
        opportunityCoverage: "not_qualified",
        observedStatus: value.snapshot?.observedStatus ?? null,
      },
    ]),
  );
}
if (process.argv[1]?.endsWith("/watch.mjs"))
  console.log(
    JSON.stringify(
      await runWatches({ path: process.argv[2] || ".state/watches.json" }),
      null,
      2,
    ),
  );
