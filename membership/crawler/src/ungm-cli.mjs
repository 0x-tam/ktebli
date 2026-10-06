import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { crawlUngmCurated } from "./ungm.mjs";
import { saveState } from "./run.mjs";

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const statePath = resolve(get("--state", ".state/ungm-coverage.json"));
const outputPath = resolve(get("--output", ".state/ungm-opportunities.json"));
const seedsPath = resolve(get("--seeds", "fixtures/ungm-curated-seeds.json"));
const maxDetails = Number(get("--max-details", "12"));
const ids = JSON.parse(await readFile(seedsPath, "utf8"));
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { version: 1, entries: {} };
}
if (state.version !== 1) throw new Error("Unsupported UNGM state version");
const result = await crawlUngmCurated({
  ids,
  state,
  save: (next) => saveState(statePath, next),
  maxDetails,
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result.coverage, null, 2));
if (result.coverage.status !== "complete") process.exitCode = 2;
