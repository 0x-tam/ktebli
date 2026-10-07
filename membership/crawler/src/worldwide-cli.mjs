import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPublicCatalogState,
  savePublicCatalogState,
  PUBLIC_CATALOGS,
} from "./public-catalog.mjs";
import { crawlGrantsGov } from "./grants-gov.mjs";
import { crawlSamGov } from "./sam-gov.mjs";

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at < 0 ? fallback : args[at + 1];
};
const selected = get("--sources", "grants-gov")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (
  !selected.length ||
  selected.some((source) => !PUBLIC_CATALOGS.includes(source))
)
  throw new Error("--sources must contain grants-gov and/or sam-gov");
const maxPages = Number(get("--max-pages", "10"));
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
  throw new Error("--max-pages must be 1..10");

const statePath = resolve(get("--state", ".state/worldwide-coverage.json"));
const outputPath = resolve(
  get("--output", ".state/worldwide-opportunities.json"),
);
const refresh = args.includes("--refresh");
const state = await loadPublicCatalogState(statePath);
async function samApiKey() {
  if (process.env.SAM_GOV_API_KEY) return process.env.SAM_GOV_API_KEY;
  try {
    const path = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../.env.local",
    );
    const local = await readFile(path, "utf8");
    const line = local
      .split(/\r?\n/)
      .find((value) => /^\s*(?:export\s+)?SAM_GOV_API_KEY\s*=/.test(value));
    if (!line) return undefined;
    return (
      line
        .slice(line.indexOf("=") + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "") || undefined
    );
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
const crawler = {
  "grants-gov": crawlGrantsGov,
  "sam-gov": crawlSamGov,
};
const results = [];
for (const sourceId of selected) {
  const result = await crawler[sourceId]({
    state,
    save: (next) => savePublicCatalogState(statePath, next),
    maxPages,
    refresh,
    ...(sourceId === "sam-gov" ? { apiKey: await samApiKey() } : {}),
  });
  results.push(result);
}

const streams = Object.assign(
  {},
  ...results.map((result) => result.coverage.streams),
);
const records = results.flatMap((result) => result.records);
const complete = Object.values(streams).every(
  (stream) => stream.status === "complete",
);
const coverage = {
  status: complete ? "complete" : "incomplete",
  scope:
    "Selected official public-source catalogue slices; each source reports its own search window and completeness",
  selectedSources: selected,
  selectedStatus: complete ? "complete" : "incomplete",
  uniqueRecords: records.length,
  streams,
  updatedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({ records, coverage }, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(coverage));
if (!complete) process.exitCode = 2;
