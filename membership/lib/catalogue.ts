import { z } from "zod";
import { opportunitySchema } from "./contracts";
const stream = z
  .object({
    status: z.string(),
    uniqueRecords: z.number().int().nonnegative(),
    expectedTotal: z.number().int().nonnegative().nullable(),
    cursor: z.unknown(),
    cursorUnit: z.enum(["offset", "page"]).optional(),
  })
  .passthrough();
export const catalogueBatchSchema = z
  .object({
    records: opportunitySchema.array().max(20000),
    coverage: z
      .object({ status: z.string(), streams: z.record(z.string(), stream) })
      .passthrough(),
  })
  .refine((batch) => {
    const ppa = batch.records.filter((r) => r.source === "ppa");
    for (const source of new Set(batch.records.map((r) => r.source))) {
      if (source === "ppa") continue;
      const records = batch.records.filter((r) => r.source === source);
      const streams = Object.entries(batch.coverage.streams)
        .filter(([name]) => name === source || name.startsWith(source + ":"))
        .map(([, value]) => value);
      if (source === "grants-gov" || source === "sam-gov") {
        const s = streams[0];
        const uniqueKeys = new Set(records.map((r) => r.sourceKey));
        const validCursor =
          s?.status === "incomplete"
            ? (s.cursorUnit === "offset" || s.cursorUnit === "page") &&
              Number.isSafeInteger(s.cursor) &&
              Number(s.cursor) >= 0
            : s?.status === "complete" &&
              s.expectedTotal !== null &&
              Number.isSafeInteger(s.cursor) &&
              (s.cursorUnit === "page"
                ? s.cursor === Math.ceil(s.expectedTotal / 100)
                : s.cursorUnit === "offset" && s.cursor === s.expectedTotal);
        const validCoverage =
          (s?.status === "complete" &&
            batch.coverage.status === "complete" &&
            s.expectedTotal === s.uniqueRecords) ||
          (s?.status === "incomplete" &&
            batch.coverage.status === "incomplete" &&
            (s.expectedTotal === null || s.uniqueRecords <= s.expectedTotal));
        if (
          streams.length !== 1 ||
          !validCursor ||
          !validCoverage ||
          !s ||
          batch.coverage.uniqueRecords !== records.length ||
          !Array.isArray(batch.coverage.selectedSources) ||
          batch.coverage.selectedSources.length !== 1 ||
          batch.coverage.selectedSources[0] !== source ||
          batch.coverage.selectedStatus !== s.status ||
          s.uniqueRecords !== records.length ||
          records.length !== uniqueKeys.size ||
          records.some(
            (r) => r.source !== source || r.detailStatus !== "verified",
          )
        )
          return false;
        continue;
      }
      if (
        !streams.length ||
        streams.some(
          (s) =>
            s.status !== "complete" ||
            (s.cursor !== null &&
              !(
                ["grants-gov", "sam-gov"].includes(source) &&
                Number.isSafeInteger(s.cursor) &&
                s.cursor === s.expectedTotal
              )) ||
            s.expectedTotal !== s.uniqueRecords,
        ) ||
        streams.reduce((total, s) => total + s.uniqueRecords, 0) !==
          records.length ||
        new Set(records.map((r) => r.sourceKey)).size !== records.length
      )
        return false;
    }
    if (!ppa.length) return true;
    return (
      ["ppa:en", "ppa:ar"].every((name) => {
        const s = batch.coverage.streams[name];
        return (
          s &&
          s.status === "complete" &&
          s.cursor === null &&
          s.expectedTotal === s.uniqueRecords &&
          s.uniqueRecords === ppa.length
        );
      }) &&
      new Set(ppa.map((o) => o.sourceKey)).size === ppa.length &&
      ppa.every((o) =>
        ["en", "ar"].every((locale) =>
          o.locales.some((l) => l.locale === locale),
        ),
      )
    );
  }, "Imports need complete source streams and matching counts; PPA requires both locales");

export function ungmCuratedBatchSchema(seedIds: string[]) {
  const expected = new Set(seedIds.map((id) => `ungm:${id}`));
  return z
    .object({
      records: opportunitySchema.array().max(25),
      coverage: z
        .object({
          status: z.literal("complete"),
          scope: z.literal(
            "Curated official UNGM notice detail URLs only; public discovery coverage is unavailable",
          ),
          selectedNoticeIds: z.number().int().nonnegative(),
          freshVerifiedNotices: z.number().int().nonnegative(),
          pendingNotices: z.literal(0),
        })
        .passthrough(),
    })
    .refine(
      ({ records, coverage }) =>
        expected.size > 0 &&
        records.length === expected.size &&
        coverage.selectedNoticeIds === expected.size &&
        coverage.freshVerifiedNotices === expected.size &&
        new Set(records.map((record) => record.sourceKey)).size ===
          expected.size &&
        records.every(
          (record) =>
            record.source === "ungm" &&
            record.detailStatus === "verified" &&
            expected.has(record.sourceKey),
        ),
      "Curated UNGM import needs every allowlisted official notice freshly verified",
    );
}

export const mawredPageBatchSchema = z
  .object({
    records: opportunitySchema.array().length(1),
    coverage: z
      .object({
        status: z.literal("complete"),
        scope: z.literal(
          "One official Culture Resource Production Awards page; no wider grant discovery claim",
        ),
        selectedPages: z.literal(1),
        freshVerifiedRecords: z.literal(1),
        pendingPages: z.literal(0),
      })
      .passthrough(),
  })
  .refine(
    ({ records }) =>
      records[0].source === "mawred" &&
      records[0].sourceKey === "mawred:production-awards:2026" &&
      records[0].sourceUrl ===
        "https://mawred.org/artistic-creativity/production-awards/?lang=en" &&
      records[0].kind === "grant" &&
      records[0].detailStatus === "verified",
    "Mawred import needs the one reviewed official Production Awards 2026 page",
  );

export const worldBankBatchSchema = z
  .object({
    records: opportunitySchema.array().max(1000),
    coverage: z
      .object({
        status: z.literal("complete"),
        scope: z.literal(
          "Current World Bank procurement notices explicitly assigned to project country Lebanon; bidder eligibility remains unverified",
        ),
        queryDate: z.iso.date(),
        apiTotal: z.number().int().nonnegative().max(10000),
        apiSeen: z.number().int().nonnegative().max(10000),
        selectedRecords: z.number().int().nonnegative().max(1000),
        excludedRecords: z.number().int().nonnegative().max(10000),
        pages: z.number().int().positive().max(200),
        pendingNotices: z.literal(0),
      })
      .passthrough(),
  })
  .refine(
    ({ records, coverage }) =>
      coverage.apiSeen === coverage.apiTotal &&
      coverage.selectedRecords + coverage.excludedRecords ===
        coverage.apiTotal &&
      records.length === coverage.selectedRecords &&
      new Set(records.map((record) => record.sourceKey)).size ===
        records.length &&
      records.every(
        (record) =>
          record.source === "worldbank" &&
          record.kind === "procurement" &&
          record.detailStatus === "verified" &&
          record.geography?.status === "lebanon_confirmed" &&
          record.geography.evidence.some(
            (item) =>
              item.label === "Project country" && item.text === "Lebanon",
          ) &&
          record.identityClaim?.authority === "worldbank.org" &&
          record.identityClaim.reference === record.sourceKey.slice(10),
      ),
    "World Bank import needs complete API counts and exact Lebanon notice evidence",
  );
