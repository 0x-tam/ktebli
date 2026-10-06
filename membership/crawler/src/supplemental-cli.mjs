import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runWatches } from "./watch.mjs";
import { staticGrantArtifact } from "./grants.mjs";
import { crawlAics } from "./aics.mjs";
const args = process.argv.slice(2),
  get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i < 0 ? fallback : args[i + 1];
  };
const watchPath = resolve(get("--watch-state", ".state/watches.json"));
const output = resolve(
  get("--output", ".state/supplemental-opportunities.json"),
);
const maxPages = Number(get("--max-pages", "10"));
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20)
  throw new Error("--max-pages must be1..20");
const health = await runWatches({ path: watchPath });
const grants = staticGrantArtifact(
  JSON.parse(await readFile(watchPath, "utf8")),
);
const aics = await crawlAics({ maxPages });
const records = [...grants.records, ...aics.records],
  streams = { ...grants.coverage.streams, ...aics.coverage.streams };
const coverage = {
  status: Object.values(streams).every((s) => s.status === "complete")
    ? "complete"
    : "incomplete",
  scope:
    "Explicit embassy calls and AICS Lebanon-title calls; remaining sources monitored but not qualified as full opportunity catalogues",
  uniqueRecords: records.length,
  updatedAt: new Date().toISOString(),
  streams,
  watchHealth: health,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ records, coverage }, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(coverage, null, 2));
if (coverage.status !== "complete") process.exitCode = 2;
