import { parseCdr, mergeRecords, hash } from "./adapters.mjs";
import { CrawlError } from "./safe-http.mjs";

// Driver contract deliberately has no arbitrary JS, URL or credentials surface.
// A production implementation MUST enforce HTTPS/public-IP pinning for every
// request, redirect and browser subresource; a user browser session is not a
// substitute. This module does not launch an unguarded browser.
// driver: { openApprovedStage(stage), snapshot(), clickLoadMore(), waitForChange(hash) }
// snapshot: { html, url, loadMoreVisible, loadMoreEnabled, challenge, loading }
export async function crawlCdrBrowser({
  driver,
  stage = "Ongoing",
  checkpoint = null,
  maxLoads = 100,
  onCheckpoint = async () => {},
}) {
  if (!["Ongoing", "Archive", "Others"].includes(stage))
    throw new CrawlError("invalid_stage");
  if (
    !driver?.networkPolicy?.httpsOnly ||
    !driver.networkPolicy.publicIpPinned ||
    !driver.networkPolicy.robotsEnforced
  )
    throw new CrawlError("safe_browser_driver_required");
  let state = checkpoint || {
    stage,
    status: "pending",
    loads: 0,
    records: {},
    fingerprints: [],
    error: null,
  };
  if (state.stage !== stage) throw new CrawlError("checkpoint_stage_mismatch");
  await driver.openApprovedStage(stage);
  // The site exposes no stable cursor in its DOM. Resume replays the bounded
  // number of clicks and checks the saved cumulative issuer-ID fingerprint.
  for (let i = 0; i < state.loads; i++) {
    const before = await driver.snapshot();
    if (before.challenge) throw new CrawlError("access_blocked");
    if (!before.loadMoreVisible || !before.loadMoreEnabled)
      throw new CrawlError("source_changed_on_resume");
    await driver.clickLoadMore();
    await driver.waitForChange(hash(before.html));
  }
  let consumed = 0;
  while (true) {
    const snapshot = await driver.snapshot();
    if (snapshot.challenge) {
      state.status = "blocked";
      state.error = "access_blocked";
      break;
    }
    if (snapshot.loading) {
      state.status = "incomplete";
      state.error = "pagination_still_loading";
      break;
    }
    const parsed = parseCdr(snapshot.html, snapshot.url);
    const fingerprint = hash(parsed.records.map((r) => r.sourceKey));
    if (
      consumed === 0 &&
      checkpoint &&
      state.fingerprints.length &&
      state.fingerprints.at(-1) !== fingerprint
    ) {
      state.status = "incomplete";
      state.error = "source_changed_on_resume";
      break;
    }
    if (consumed > 0 && state.fingerprints.includes(fingerprint)) {
      state.status = "incomplete";
      state.error = "pagination_no_progress";
      break;
    }
    if (!parsed.records.length) {
      state.status = "incomplete";
      state.error = "empty_listing_unproven";
      break;
    }
    const prior = new Set(Object.keys(state.records));
    if (
      consumed > 0 &&
      parsed.records.some((r) => !prior.has(r.sourceKey)) === false
    ) {
      state.status = "incomplete";
      state.error = "pagination_no_progress";
      break;
    }
    for (const record of parsed.records)
      state.records[record.sourceKey] = mergeRecords(
        state.records[record.sourceKey],
        record,
      );
    if (state.fingerprints.at(-1) !== fingerprint)
      state.fingerprints.push(fingerprint);
    // Only observed removal/hiding of the control after a settled page is an
    // exhaustion signal. A disabled/spinning button alone is never completion.
    if (!snapshot.loadMoreVisible) {
      state.status = "complete";
      state.error = null;
      break;
    }
    if (!snapshot.loadMoreEnabled) {
      state.status = "incomplete";
      state.error = "pagination_control_disabled";
      break;
    }
    if (consumed >= maxLoads) {
      state.status = "incomplete";
      state.error = "page_budget";
      break;
    }
    state.status = "pending";
    await onCheckpoint(state);
    await driver.clickLoadMore();
    await driver.waitForChange(hash(snapshot.html));
    state.loads++;
    consumed++;
  }
  await onCheckpoint(state);
  return state;
}
