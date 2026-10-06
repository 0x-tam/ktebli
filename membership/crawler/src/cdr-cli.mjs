import { readFile, writeFile } from "node:fs/promises";
import { crawlCdrBrowser } from "./cdr-browser.mjs";
import { createGuardedCdrDriver } from "./guarded-browser.mjs";
import { saveState } from "./run.mjs";
const path = process.argv[2] || ".state/cdr-Ongoing.json";
let checkpoint = null;
try {
  checkpoint = JSON.parse(await readFile(path, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let driver;
let result;
try {
  driver = await createGuardedCdrDriver();
  result = await crawlCdrBrowser({
    driver,
    checkpoint,
    stage: "Ongoing",
    maxLoads: 100,
    onCheckpoint: (s) => saveState(path, s),
  });
} catch (e) {
  try {
    checkpoint = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  result = {
    ...(checkpoint || {
      stage: "Ongoing",
      loads: 0,
      records: {},
      fingerprints: [],
    }),
    status: e.code === "access_blocked" ? "blocked" : "incomplete",
    error: e.code || "browser_unavailable",
  };
  await saveState(path, result);
} finally {
  if (driver) await driver.close();
}
console.log(
  JSON.stringify(
    {
      stage: result.stage,
      status: result.status,
      records: Object.keys(result.records).length,
      loads: result.loads,
      error: result.error,
    },
    null,
    2,
  ),
);
if (result.status !== "complete") process.exitCode = 2;
