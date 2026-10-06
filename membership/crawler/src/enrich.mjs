import { enrichPpa, mergeRecords } from "./adapters.mjs";
import { SafeHttp } from "./safe-http.mjs";
import { saveState } from "./run.mjs";
export function detailDue(
  locale,
  now = Date.now(),
  ttlMs = 24 * 60 * 60 * 1000,
) {
  return (
    locale.detailStatus !== "verified" ||
    locale.detailNeedsRefresh ||
    !locale.detailFetchedAt ||
    now - Date.parse(locale.detailFetchedAt) >= ttlMs
  );
}
// Bound each pass; least-recently attempted first prevents a broken detail page
// from starving every later record. A verified detail is rechecked within a day.
export async function enrich({
  state,
  statePath,
  maxDetails = 20,
  publishedSince = null,
  publishedBefore = null,
  http = new SafeHttp(),
  now = Date.now(),
  ttlMs = 24 * 60 * 60 * 1000,
}) {
  const validDate = (value) =>
    /^20\d\d-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (publishedSince && publishedBefore)
    throw new Error("Use one publication-date scope per pass");
  if (publishedSince && !validDate(publishedSince))
    throw new Error("publishedSince must be YYYY-MM-DD");
  if (publishedBefore && !validDate(publishedBefore))
    throw new Error("publishedBefore must be YYYY-MM-DD");
  // A limited request budget must not leave TTL-expired detail facts marked
  // verified merely because their recheck has not yet reached the queue.
  let expired = false;
  for (const [key, record] of Object.entries(state.records)) {
    if (record.source !== "ppa") continue;
    let changed = false;
    for (const locale of record.locales) {
      if (
        locale.detailStatus === "verified" &&
        detailDue(locale, now, ttlMs) &&
        !locale.detailNeedsRefresh
      ) {
        locale.detailNeedsRefresh = true;
        changed = true;
      }
    }
    if (changed) {
      state.records[key] = mergeRecords(record, record);
      expired = true;
    }
  }
  if (expired) await saveState(statePath, state);
  const all = Object.values(state.records)
    .filter((r) => r.source === "ppa")
    .flatMap((r) =>
      r.locales.map((v) => ({
        key: r.sourceKey,
        locale: v.locale,
        publishedAt: v.publishedAt ?? r.publishedAt,
        value: v,
      })),
    );
  const inScope = (item) =>
    (!publishedSince || item.publishedAt >= publishedSince) &&
    (!publishedBefore || item.publishedAt < publishedBefore);
  const scoped = all.filter(inScope);
  const due = scoped
    .filter((item) => detailDue(item.value, now, ttlMs))
    .sort(
      (a, b) =>
        (Date.parse(a.value.detailAttemptedAt) || 0) -
          (Date.parse(b.value.detailAttemptedAt) || 0) ||
        (b.publishedAt || "").localeCompare(a.publishedAt || "") ||
        a.key.localeCompare(b.key) ||
        a.locale.localeCompare(b.locale),
    );
  // Older notices with a known future submission deadline deserve prompt
  // rechecking, but reserve half the pass for previously unseen backlog so
  // repeated daily TTL refreshes cannot starve archive coverage indefinitely.
  let queue;
  if (publishedSince) queue = due.slice(0, maxDetails);
  else {
    const today = new Date(now).toISOString().slice(0, 10);
    const future = due.filter((item) => item.value.deadline > today);
    const other = due.filter((item) => !(item.value.deadline > today));
    queue = [];
    while (queue.length < maxDetails && (future.length || other.length)) {
      const take = queue.length % 2 === 0 ? future : other;
      queue.push((take.length ? take : future.length ? future : other).shift());
    }
  }
  let attempted = 0;
  let consecutiveGuardFailures = 0;
  let haltedAfter = null;
  const guardFailures = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "request_timeout",
    "non_public_dns",
    "access_blocked",
    "robots_disallowed",
    "robots_unavailable",
    "detail_schema_changed",
  ]);
  for (const item of queue) {
    attempted++;
    const record = state.records[item.key],
      locale = record.locales.find((v) => v.locale === item.locale);
    locale.detailAttemptedAt = new Date(now).toISOString();
    try {
      const response = await http.get(locale.sourceUrl);
      state.records[item.key] = enrichPpa(
        record,
        response.body,
        response.url,
        new Date(now).toISOString(),
      );
      delete locale.detailError;
      consecutiveGuardFailures = 0;
    } catch (error) {
      // Preserve last verified details while surfacing failed refresh separately.
      if (locale.detailStatus !== "verified")
        locale.detailStatus = "incomplete";
      locale.detailNeedsRefresh = true;
      locale.detailError = error.code || "detail_fetch_failed";
      state.records[item.key] = mergeRecords(record, record);
      consecutiveGuardFailures = guardFailures.has(locale.detailError)
        ? consecutiveGuardFailures + 1
        : 0;
    }
    await saveState(statePath, state);
    if (consecutiveGuardFailures >= 3) {
      haltedAfter = locale.detailError;
      break;
    }
  }
  // Recount the saved records: mergeRecords replaces locale objects during the
  // pass, so the initial queue may still point at superseded versions.
  const current = Object.values(state.records)
    .filter((r) => r.source === "ppa")
    .flatMap((r) =>
      r.locales.map((v) => ({
        publishedAt: v.publishedAt ?? r.publishedAt,
        value: v,
      })),
    );
  const currentScoped = current.filter(inScope);
  const pending = currentScoped.filter((item) =>
    detailDue(item.value, now, ttlMs),
  ).length;
  const verified = currentScoped.filter(
    (item) => item.value.detailStatus === "verified",
  ).length;
  const staleVerified = currentScoped.filter(
    (item) =>
      item.value.detailStatus === "verified" &&
      detailDue(item.value, now, ttlMs),
  ).length;
  return {
    attempted,
    publishedSince,
    publishedBefore,
    haltedAfter,
    scopedLocales: currentScoped.length,
    verifiedLocales: verified,
    freshVerifiedLocales: verified - staleVerified,
    staleVerifiedLocales: staleVerified,
    pendingLocales: pending,
    totalLocales: current.length,
    totalPendingLocales: current.filter((item) =>
      detailDue(item.value, now, ttlMs),
    ).length,
    status: currentScoped.length && !pending ? "complete" : "incomplete",
  };
}
