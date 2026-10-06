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
      ].includes(u.hostname)
    );
  }, "An official source URL is required");
const nullableDate = z.iso.date().nullable();
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
