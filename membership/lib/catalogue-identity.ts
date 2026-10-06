import { createHash } from "node:crypto";
import type { Opportunity } from "./contracts";

export type GeographyStatus =
  | "lebanon_confirmed"
  | "regional_includes_lebanon"
  | "unknown"
  | "outside_lebanon";

type Evidence = Opportunity["evidence"][number];
type IdentityClaim = NonNullable<Opportunity["identityClaim"]>;

function normalizedHost(url: string) {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

const authorityHosts: Record<string, readonly string[]> = {
  "ppa.gov.lb": ["ppa.gov.lb"],
  "ungm.org": ["ungm.org"],
  "worldbank.org": ["projects.worldbank.org"],
};

function officialReference(authority: string, url: URL): string | null {
  if (url.search || url.hash) return null;
  const patterns: Record<string, RegExp> = {
    "ppa.gov.lb": /^\/(?:en|ar)\/tenders\/details\/(\d+)$/,
    "ungm.org": /^\/Public\/Notice\/(\d+)$/,
    "worldbank.org": /^\/en\/projects-operations\/procurement-detail\/(OP\d+)$/,
  };
  return url.pathname.match(patterns[authority])?.[1] ?? null;
}

function evidenceHasExactUrl(evidence: Evidence[], expected: string) {
  return evidence.some((item) =>
    (item.text.match(/https:\/\/[^\s<>"']+/g) ?? []).some((token) => {
      try {
        return new URL(token.replace(/[.,;)]+$/, "")).href === expected;
      } catch {
        return false;
      }
    }),
  );
}

function sameEvidence(left: Evidence, right: Evidence) {
  return (
    left.label === right.label &&
    left.text === right.text &&
    left.url === right.url
  );
}

function knownGeography(record: Opportunity): {
  status: GeographyStatus;
  evidence: Evidence[];
} {
  if (record.geography) {
    if (
      record.geography.evidence.some(
        (item) => !record.evidence.some((known) => sameEvidence(item, known)),
      )
    )
      throw new Error("Geography evidence must be copied from the source");
    if (
      record.geography.status !== "unknown" &&
      record.geography.evidence.length === 0
    )
      throw new Error("Geography claim needs source evidence");
    return record.geography;
  }
  if (record.source === "ppa") {
    return {
      status: "lebanon_confirmed",
      evidence: [
        {
          label: "Publisher jurisdiction",
          text: "Lebanon Public Procurement Authority official portal",
          url: record.sourceUrl,
        },
      ],
    };
  }
  if (record.source === "ungm") {
    const field = record.evidence.find((item) =>
      /beneficiary countries or territories/i.test(item.label),
    );
    if (field && /(^|[,;\s])Lebanon($|[,;\s])/i.test(field.text)) {
      const countries = field.text
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      return {
        status:
          countries.length === 1
            ? "lebanon_confirmed"
            : "regional_includes_lebanon",
        evidence: [field],
      };
    }
  }
  if (record.source === "mawred") {
    const field = record.evidence.find(
      (item) =>
        /Applicant origin/i.test(item.label) && /Arab country/i.test(item.text),
    );
    if (field)
      return { status: "regional_includes_lebanon", evidence: [field] };
  }
  return { status: "unknown", evidence: [] };
}

function defaultIdentity(record: Opportunity): IdentityClaim | null {
  if (record.source === "ppa" && /^ppa:\d+$/.test(record.sourceKey)) {
    return {
      authority: "ppa.gov.lb",
      reference: record.sourceKey.slice(4),
      granularity: "notice",
      proofUrl: record.sourceUrl,
    };
  }
  if (record.source === "ungm" && /^ungm:\d+$/.test(record.sourceKey)) {
    return {
      authority: "ungm.org",
      reference: record.sourceKey.slice(5),
      granularity: "notice",
      proofUrl: record.sourceUrl,
    };
  }
  return null;
}

export function exactIdentityKey(record: Opportunity): {
  claim: IdentityClaim | null;
  key: string | null;
} {
  const claim = record.identityClaim ?? defaultIdentity(record);
  if (!claim) return { claim: null, key: null };
  const host = normalizedHost(claim.proofUrl);
  if (!authorityHosts[claim.authority]?.includes(host))
    throw new Error("Identity authority and official proof host differ");
  const proof = new URL(claim.proofUrl);
  if (officialReference(claim.authority, proof) !== claim.reference)
    throw new Error("Identity reference absent from official proof URL");
  if (
    claim.proofUrl !== record.sourceUrl &&
    !evidenceHasExactUrl(record.evidence, claim.proofUrl)
  )
    throw new Error(
      "Cross-source official proof URL absent from source evidence",
    );
  if (claim.granularity === "lot") {
    if (!claim.lotId)
      throw new Error("Exact lot identity requires an explicit lot ID");
    if (
      !record.evidence.some(
        (item) =>
          /^(?:lot|lot id|lot number|lot reference)$/i.test(
            item.label.trim(),
          ) && item.text.trim() === claim.lotId,
      )
    )
      throw new Error("Lot ID absent from source evidence");
  } else if (claim.lotId) {
    throw new Error("Notice identity cannot carry a lot ID");
  }
  const basis = [
    claim.authority,
    claim.reference,
    claim.granularity,
    claim.lotId ?? "",
  ];
  return {
    claim,
    key: createHash("sha256").update(JSON.stringify(basis)).digest("hex"),
  };
}

export function catalogueQualification(record: Opportunity) {
  const geography = knownGeography(record);
  const identity = exactIdentityKey(record);
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify([
        "catalogue-qualification-v1",
        record.contentHash,
        geography.status,
        geography.evidence,
        identity.key,
      ]),
    )
    .digest("hex");
  return {
    geography,
    identity,
    sourceContentHash: record.contentHash,
    contentHash,
  };
}
