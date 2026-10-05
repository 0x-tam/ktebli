import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { enrich } from "./enrich.mjs";
import { readFile } from "node:fs/promises";
import { run } from "./run.mjs";
const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : args[i + 1];
};
const maxPages = Number(get("--max-pages", "60"));
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500)
  throw new Error("--max-pages must be 1..500");
const statePath = resolve(get("--state", ".state/coverage.json"));
const output = resolve(get("--output", ".state/opportunities.json"));
const selectedSources = get("--sources", "ppa,cdr").split(",");
const result = await run({
  statePath,
  maxPages,
  refresh: args.includes("--refresh"),
  retryBlocked: args.includes("--retry-blocked"),
  selectedSources,
});
if (args.includes("--enrich")) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const maxDetails = Number(get("--max-details", "20"));
  if (!Number.isInteger(maxDetails) || maxDetails < 1 || maxDetails > 500)
    throw new Error("--max-details must be 1..500");
  const publishedSince = get("--published-since", null);
  const publishedBefore = get("--published-before", null);
  result.coverage.details = await enrich({
    state,
    statePath,
    maxDetails,
    publishedSince,
    publishedBefore,
  });
  result.records = Object.values(state.records);
}
const selectedStreams = Object.entries(result.coverage.streams).filter(([id]) =>
  selectedSources.some((source) => id.startsWith(`${source}:`)),
);
const selectedIncomplete =
  !selectedStreams.length ||
  selectedStreams.some(([, stream]) => stream.status !== "complete");
result.coverage.selectedSources = selectedSources;
result.coverage.selectedStatus = selectedIncomplete ? "incomplete" : "complete";
await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result.coverage, null, 2));
if (selectedIncomplete || result.coverage.details?.haltedAfter)
  process.exitCode = 2;
