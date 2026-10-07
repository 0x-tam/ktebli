import { z } from "zod";
const shortText = z.string().trim().min(1).max(100);
export const profileSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(160),
    organizationType: z.enum(["company", "ngo", "individual", "public_body"]),
    sectors: z.array(shortText).min(1).max(12),
    capabilities: z.string().trim().max(4000),
    locations: z.array(shortText).min(1).max(10),
    alertsEnabled: z.boolean(),
    pastWork: z.string().trim().max(2000).default(""),
    teamCapacity: z.string().trim().max(500).default(""),
    languages: z.array(shortText).max(12).default([]),
    budgetMin: z
      .number()
      .int()
      .nonnegative()
      .max(2147483647)
      .nullable()
      .default(null),
    budgetMax: z
      .number()
      .int()
      .nonnegative()
      .max(2147483647)
      .nullable()
      .default(null),
    qualifications: z.array(shortText).max(20).default([]),
    interests: z.array(shortText).max(20).default([]),
    excludedWork: z.array(shortText).max(20).default([]),
    opportunityTypes: z
      .array(z.enum(["procurement", "grant"]))
      .min(1)
      .max(2)
      .default(["procurement", "grant"]),
  })
  .strict()
  .refine(
    (p) =>
      p.budgetMin === null ||
      p.budgetMax === null ||
      p.budgetMax >= p.budgetMin,
    "Maximum budget must be at least the minimum",
  );
export type Profile = z.infer<typeof profileSchema>;
export const sourceUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      [
        "cdr.gov.lb",
        "www.cdr.gov.lb",
        "ppa.gov.lb",
        "www.ppa.gov.lb",
        "www.lb.emb-japan.go.jp",
        "lebanon.embassy.gov.au",
        "mzv.gov.cz",
        "www.international.gc.ca",
        "www.eeas.europa.eu",
        "trasparenzabeirut.aics.gov.it",
        "procurement-notices.undp.org",
        "www.ungm.org",
        "mawred.org",
        "projects.worldbank.org",
        "grants.gov",
        "www.grants.gov",
        "sam.gov",
        "www.sam.gov",
      ].includes(u.hostname)
    );
  }, "An official source URL is required");
const nullableDate = z.iso.date().nullable();
// ISO 3166-1 alpha-2 allowlist. A two-letter regex would accept reserved or
// invented values that cannot identify a country in a filter.
export const ISO_COUNTRY_CODES = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
] as const;
export const isoCountryCodeSchema = z.enum(ISO_COUNTRY_CODES);
const evidenceSchema = z.object({
  label: z.string().max(200),
  text: z.string().max(12000),
  url: sourceUrlSchema,
});
export const opportunitySchema = z
  .object({
    source: z.enum([
      "cdr",
      "ppa",
      "japan-ggp",
      "australia-dap",
      "czech-ssp",
      "canada-cfli",
      "eeas",
      "aics",
      "undp",
      "ungm",
      "mawred",
      "worldbank",
      "grants-gov",
      "sam-gov",
    ]),
    sourceKey: z.string().min(1).max(250),
    sourceUrl: sourceUrlSchema,
    title: z.string().min(1).max(2000),
    description: z.string().max(60000),
    publishedAt: nullableDate,
    deadline: nullableDate,
    kind: z.enum(["procurement", "grant", "unknown"]),
    evidence: z.array(evidenceSchema).max(100),
    geography: z
      .object({
        status: z.enum([
          "lebanon_confirmed",
          "regional_includes_lebanon",
          "unknown",
          "outside_lebanon",
        ]),
        evidence: z.array(evidenceSchema).max(20),
      })
      .strict()
      .optional(),
    locations: z
      .object({
        countryCodes: z.array(isoCountryCodeSchema).max(250),
        scope: z.enum(["countries", "worldwide", "unknown"]),
        evidence: z.array(evidenceSchema).max(100),
      })
      .strict()
      .optional(),
    identityClaim: z
      .object({
        authority: z.string().regex(/^[a-z0-9.-]{3,100}$/),
        reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/),
        granularity: z.enum(["notice", "lot"]),
        lotId: z.string().min(1).max(120).optional(),
        proofUrl: sourceUrlSchema,
      })
      .strict()
      .optional(),
    fetchedAt: z.string().datetime({ offset: true }),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    detailStatus: z
      .enum(["not_fetched", "partial", "verified"])
      .default("not_fetched"),
    deadlineConflict: z.boolean().default(false),
    applicationStatus: z
      .enum(["needs_verification", "not_open_competition", "closed"])
      .default("needs_verification"),
    locales: z
      .array(
        z.object({
          locale: z.string().max(10),
          detailNeedsRefresh: z.boolean().default(false),
          sourceUrl: sourceUrlSchema,
          title: z.string().max(2000),
          description: z.string().max(60000),
          evidence: z.array(evidenceSchema).max(100),
          publishedAt: nullableDate,
          deadline: nullableDate,
        }),
      )
      .max(4)
      .default([]),
  })
  .refine(
    (o) =>
      validSourcePair(o.source, o.sourceUrl) &&
      (["grants-gov", "sam-gov"].includes(o.source)
        ? o.locations !== undefined
        : true) &&
      (o.locations?.countryCodes.length ?? 0) ===
        new Set(o.locations?.countryCodes ?? []).size &&
      (o.locations?.scope === "countries"
        ? o.locations.countryCodes.length > 0 && o.locations.evidence.length > 0
        : o.locations?.scope === "worldwide"
          ? o.locations.countryCodes.length === 0 &&
            o.locations.evidence.length > 0
          : o.locations?.scope === "unknown"
            ? o.locations.countryCodes.length === 0 &&
              o.locations.evidence.length === 0
            : true) &&
      (o.locations?.evidence.every((e) =>
        o.evidence.some(
          (known) =>
            known.label === e.label &&
            known.text === e.text &&
            known.url === e.url,
        ),
      ) ??
        true) &&
      o.evidence.every((e) => validSourcePair(o.source, e.url)) &&
      o.locales.every(
        (l) =>
          validSourcePair(o.source, l.sourceUrl) &&
          l.evidence.every((e) => validSourcePair(o.source, e.url)),
      ),
    "Source and issuer hostname must match",
  )
  .transform((o) => ({
    ...o,
    detailStatus: o.locales.some((l) => l.detailNeedsRefresh)
      ? ("partial" as const)
      : o.detailStatus,
  }));
const sourceHosts: Record<string, string[]> = {
  cdr: ["cdr.gov.lb", "www.cdr.gov.lb"],
  ppa: ["ppa.gov.lb", "www.ppa.gov.lb"],
  "japan-ggp": ["www.lb.emb-japan.go.jp"],
  "australia-dap": ["lebanon.embassy.gov.au"],
  "czech-ssp": ["mzv.gov.cz"],
  "canada-cfli": ["www.international.gc.ca"],
  eeas: ["www.eeas.europa.eu"],
  aics: ["trasparenzabeirut.aics.gov.it"],
  undp: ["procurement-notices.undp.org"],
  ungm: ["www.ungm.org"],
  mawred: ["mawred.org"],
  worldbank: ["projects.worldbank.org"],
  "grants-gov": ["grants.gov", "www.grants.gov"],
  "sam-gov": ["sam.gov", "www.sam.gov"],
};
export function validSourcePair(source: string, url: string) {
  try {
    return sourceHosts[source]?.includes(new URL(url).hostname) === true;
  } catch {
    return false;
  }
}
export type Opportunity = z.infer<typeof opportunitySchema>;
export const uuidSchema = z.string().uuid();
export const TIERS = { draft: 14900, competitive: 29900, full: 44900 } as const;
export function creditQuote(tier: keyof typeof TIERS) {
  return {
    listCents: TIERS[tier],
    creditCents: 2000,
    totalCents: TIERS[tier] - 2000,
    currency: "usd" as const,
  };
}
export function checkOrigin(request: Request, configuredOrigin: string) {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(configuredOrigin).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new Error("Invalid request origin");
}
export function isMembershipActive(
  state: string,
  paidUntil: string | Date | null,
  now = new Date(),
) {
  return state === "active" && paidUntil !== null && new Date(paidUntil) > now;
}
