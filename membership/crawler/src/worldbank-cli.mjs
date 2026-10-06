import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { crawlWorldBank } from "./worldbank.mjs";
import { saveState } from "./run.mjs";

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at < 0 ? fallback : args[at + 1];
};
const statePath = resolve(get("--state", ".state/worldbank-coverage.json"));
const outputPath = resolve(
  get("--output", ".state/worldbank-opportunities.json"),
);
const rows = Number(get("--rows", "50"));
const maxPages = Number(get("--max-pages", "10"));
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { version: 1 };
}
const result = await crawlWorldBank({
  state,
  save: (next) => saveState(statePath, next),
  rows,
  maxPages,
  refresh: args.includes("--refresh"),
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result.coverage));
if (result.coverage.status !== "complete") process.exitCode = 2;
