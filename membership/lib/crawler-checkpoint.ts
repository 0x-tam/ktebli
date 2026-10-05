import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export type CrawlSource = "ppa" | "ungm-curated" | "mawred";
export type CrawlPhase = "listing" | "backlog" | "imported";

export function ppaNeedsListingRefresh(
  phase: CrawlPhase,
  lastRunAt: Date,
  now: Date,
): boolean {
  return (
    phase === "imported" ||
    (phase === "backlog" &&
      lastRunAt.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10))
  );
}
export const MAX_RAW_STATE_BYTES = 256 * 1024 * 1024;
export const MAX_GZIP_STATE_BYTES = 32 * 1024 * 1024;

export function validCrawlerState(
  source: CrawlSource,
  state: unknown,
): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const value = state as Record<string, unknown>;
  if (value.version !== 1) return false;
  if (source === "mawred")
    return (
      !value.record ||
      (typeof value.record === "object" && !Array.isArray(value.record))
    );
  if (source === "ungm-curated")
    return Boolean(
      value.entries &&
      typeof value.entries === "object" &&
      !Array.isArray(value.entries),
    );
  const streams = value.streams as Record<string, unknown> | undefined;
  return Boolean(
    value.records &&
    typeof value.records === "object" &&
    !Array.isArray(value.records) &&
    streams &&
    ["ppa:en", "ppa:ar"].every((name) => {
      const stream = streams[name] as Record<string, unknown> | undefined;
      return (
        stream &&
        Array.isArray(stream.seen) &&
        typeof stream.status === "string"
      );
    }),
  );
}

export function encodeCrawlerState(source: CrawlSource, state: unknown) {
  if (!validCrawlerState(source, state))
    throw new Error("Invalid crawler checkpoint state");
  const raw = Buffer.from(JSON.stringify(state), "utf8");
  if (raw.length > MAX_RAW_STATE_BYTES)
    throw new Error("Crawler state exceeds decoded limit");
  const gzip = gzipSync(raw, { level: 6 });
  if (gzip.length > MAX_GZIP_STATE_BYTES)
    throw new Error("Crawler state exceeds checkpoint limit");
  return { gzip, sha256: createHash("sha256").update(raw).digest("hex") };
}

export function decodeCrawlerState(
  source: CrawlSource,
  gzip: Buffer,
  expectedSha256: string,
) {
  if (gzip.length < 1 || gzip.length > MAX_GZIP_STATE_BYTES)
    throw new Error("Invalid compressed checkpoint size");
  const raw = gunzipSync(gzip, { maxOutputLength: MAX_RAW_STATE_BYTES });
  if (createHash("sha256").update(raw).digest("hex") !== expectedSha256)
    throw new Error("Crawler checkpoint digest mismatch");
  const state: unknown = JSON.parse(raw.toString("utf8"));
  if (!validCrawlerState(source, state))
    throw new Error("Invalid crawler checkpoint state");
  return state;
}

export function ppaStreamsComplete(state: unknown): boolean {
  if (!validCrawlerState("ppa", state)) return false;
  const streams = (
    state as {
      streams: Record<
        string,
        {
          status: string;
          cursor: unknown;
          seen: string[];
          expectedTotal: number | null;
        }
      >;
    }
  ).streams;
  const en = streams["ppa:en"],
    ar = streams["ppa:ar"];
  const arabicIds = new Set(ar.seen);
  return (
    [en, ar].every(
      (stream) =>
        stream.status === "complete" &&
        stream.cursor === null &&
        stream.expectedTotal === stream.seen.length &&
        new Set(stream.seen).size === stream.seen.length,
    ) &&
    en.seen.length === ar.seen.length &&
    en.seen.every((id) => arabicIds.has(id))
  );
}
