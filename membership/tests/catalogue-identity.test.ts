import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { opportunitySchema } from "../lib/contracts";
import { catalogueQualification } from "../lib/catalogue-identity";
import { worldBankBatchSchema } from "../lib/catalogue";

const rawPpa = JSON.parse(
  await readFile("tests/fixtures/ppa-matching.json", "utf8"),
);

test("exact official identity groups a cross-post but never distinct lots", () => {
  const ppa = opportunitySchema.parse(rawPpa);
  const origin = catalogueQualification(ppa);
  assert.equal(origin.geography.status, "lebanon_confirmed");
  assert.ok(origin.identity.key);
  const sourceUrl =
    "https://projects.worldbank.org/en/projects-operations/procurement-detail/OP12345";
  const evidence = [
    { label: "Project country", text: "Lebanon", url: sourceUrl },
    { label: "Original notice", text: ppa.sourceUrl, url: sourceUrl },
    { label: "Lot", text: "Lot 2", url: sourceUrl },
  ];
  const crossPost = opportunitySchema.parse({
    ...rawPpa,
    source: "worldbank",
    sourceKey: "worldbank:OP12345",
    sourceUrl,
    evidence,
    locales: [],
    geography: { status: "lebanon_confirmed", evidence: [evidence[0]] },
    identityClaim: {
      authority: "ppa.gov.lb",
      reference: ppa.sourceKey.slice(4),
      granularity: "notice",
      proofUrl: ppa.sourceUrl,
    },
  });
  assert.equal(
    catalogueQualification(crossPost).identity.key,
    origin.identity.key,
  );
  const lot = opportunitySchema.parse({
    ...crossPost,
    identityClaim: {
      ...crossPost.identityClaim,
      granularity: "lot",
      lotId: "Lot 2",
    },
  });
  assert.notEqual(
    catalogueQualification(lot).identity.key,
    origin.identity.key,
  );
  assert.throws(
    () =>
      catalogueQualification(
        opportunitySchema.parse({
          ...crossPost,
          identityClaim: {
            ...crossPost.identityClaim,
            reference: ppa.sourceKey.slice(4, -1),
          },
        }),
      ),
    /Identity reference absent/,
    "notice ID 123 must not match official path ID 1234",
  );
  assert.throws(
    () =>
      catalogueQualification(
        opportunitySchema.parse({
          ...lot,
          identityClaim: { ...lot.identityClaim, lotId: "Lot 20" },
        }),
      ),
    /Lot ID absent/,
    "lot 1 must not match lot 10 or a prefix",
  );
  assert.throws(
    () =>
      catalogueQualification(
        opportunitySchema.parse({
          ...crossPost,
          evidence: evidence.filter((item) => item.label !== "Original notice"),
          geography: { status: "lebanon_confirmed", evidence: [evidence[0]] },
        }),
      ),
    /Cross-source official proof URL absent/,
  );
});

test("source-backed geography changes matching version; title mention alone proves nothing", () => {
  const sourceUrl =
    "https://projects.worldbank.org/en/projects-operations/procurement-detail/OP12345";
  const record = opportunitySchema.parse({
    ...rawPpa,
    source: "worldbank",
    sourceKey: "worldbank:OP12345",
    sourceUrl,
    title: "Lebanon procurement title",
    evidence: [{ label: "Reference", text: "OP12345", url: sourceUrl }],
    locales: [],
  });
  const unknown = catalogueQualification(record);
  assert.equal(unknown.geography.status, "unknown");
  const countryEvidence = {
    label: "Project country",
    text: "Lebanon",
    url: sourceUrl,
  };
  const qualified = opportunitySchema.parse({
    ...record,
    evidence: [...record.evidence, countryEvidence],
    geography: {
      status: "lebanon_confirmed",
      evidence: [countryEvidence],
    },
  });
  const known = catalogueQualification(qualified);
  assert.notEqual(unknown.contentHash, known.contentHash);
  assert.throws(
    () =>
      catalogueQualification(
        opportunitySchema.parse({
          ...record,
          geography: {
            status: "lebanon_confirmed",
            evidence: [countryEvidence],
          },
        }),
      ),
    /Geography evidence must be copied/,
  );
});

test("official World Bank Lebanon notice passes bounded central import contract", async () => {
  // @ts-expect-error The independently tested crawler adapter is plain JavaScript.
  const { parseWorldBankNotice } = await import("../crawler/src/worldbank.mjs");
  const raw = JSON.parse(
    await readFile("crawler/fixtures/worldbank-lebanon-notice.json", "utf8"),
  );
  const record = opportunitySchema.parse(
    parseWorldBankNotice(raw, "2026-10-06T00:00:00Z"),
  );
  const batch = worldBankBatchSchema.parse({
    records: [record],
    coverage: {
      status: "complete",
      scope:
        "Current World Bank procurement notices explicitly assigned to project country Lebanon; bidder eligibility remains unverified",
      queryDate: "2026-10-06",
      apiTotal: 1,
      apiSeen: 1,
      selectedRecords: 1,
      excludedRecords: 0,
      pages: 1,
      pendingNotices: 0,
    },
  });
  assert.equal(batch.records[0].geography?.status, "lebanon_confirmed");
  assert.ok(catalogueQualification(batch.records[0]).identity.key);
});
