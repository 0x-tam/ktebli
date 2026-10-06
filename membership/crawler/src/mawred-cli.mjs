import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { crawlMawredAwards } from "./mawred.mjs";
import { saveState } from "./run.mjs";

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const statePath = resolve(get("--state", ".state/mawred-coverage.json"));
const outputPath = resolve(get("--output", ".state/mawred-opportunities.json"));
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { version: 1 };
}
const result = await crawlMawredAwards({
  state,
  save: (next) => saveState(statePath, next),
  ttlMs: args.includes("--refresh") ? 1 : undefined,
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result.coverage, null, 2));
if (result.coverage.status !== "complete") process.exitCode = 2;
