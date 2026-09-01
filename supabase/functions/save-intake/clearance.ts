// Shared clearance plumbing for the pre-payment sufficiency gate (invariant 2).
//
// TWIN FILE: save-intake/clearance.ts and stripe-webhook/clearance.ts must stay
// byte-identical (same convention as the five http.ts copies). It exists so the
// intake that was SCORED (save-intake) and the intake that is PAID FOR
// (stripe-webhook) are canonicalised by the SAME code path:
//
//   save-intake    builds the pre_intakes row it is about to store, derives the
//                  SufficiencyInput FROM THAT ROW via `inputFromRow`, evaluates,
//                  and records fingerprint(input) with the clearance;
//   stripe-webhook loads the row by checkout token, derives the SufficiencyInput
//                  through the SAME `inputFromRow`, recomputes the fingerprint,
//                  and hands it to consume_checkout_token(), which refuses on
//                  any mismatch.
//
// Because both sides canonicalise through one function over the stored row, the
// fingerprints can only differ when the ROW (or the uploaded-file set) changed
// between clearance and payment — which is precisely the tampering the gate is
// specified to refuse. worker/sufficiency.ts stays the single scoring and
// canonicalisation authority; nothing here re-implements any of it.

import {
  fingerprint,
  SLOTS,
  type IntakeFacts,
  type SlotId,
  type SufficiencyInput,
  type UploadedDoc,
  type VenueEscape,
} from "../worker/sufficiency.ts";

export const KNOWN_TIERS: readonly string[] = ["trial", "draft", "competitive", "full"];
export const VENUE_ESCAPES: ReadonlySet<string> = new Set(["homes", "street", "outdoors", "mobile", "online"]);

/**
 * The uploaded-document set the fingerprint covers: the same three newest files
 * the worker's voice stage reads. Both functions MUST use this exact query —
 * a different set on either side is a fingerprint mismatch, i.e. a refusal.
 */
export function intakeFilesQuery(email: string): string {
  return `intake_files?email=eq.${encodeURIComponent(email)}` +
    `&select=file_name,extracted_text&order=created_at.desc&limit=3`;
}

export function uploadsFromFiles(rows: unknown): UploadedDoc[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const text = row.extracted_text;
    return {
      name: String(row.file_name ?? ""),
      extracted_text: typeof text === "string" && text.length ? text : null,
    };
  });
}

/**
 * Derive the SufficiencyInput from a pre_intakes row (stored or about to be
 * stored). Deterministic: same row + same uploads -> same input -> same
 * fingerprint, on either side of the payment boundary.
 */
export function inputFromRow(row: Record<string, unknown>, uploads: UploadedDoc[]): SufficiencyInput {
  const answers: Partial<Record<SlotId, string>> = {};
  for (const s of SLOTS) {
    const v = row[s.id];
    if (typeof v === "string" && v) answers[s.id] = v;
  }
  const veRaw = typeof row.venue_escape === "string" ? row.venue_escape : "";
  const tier = String(row.tier ?? "");
  const facts = (row.intake_facts && typeof row.intake_facts === "object" && !Array.isArray(row.intake_facts))
    ? row.intake_facts as IntakeFacts
    : null;
  return {
    tier,
    checkoutAvailable: KNOWN_TIERS.includes(tier),
    org: String(row.org_name ?? ""),
    registration: typeof row.org_reg === "string" ? row.org_reg : null,
    website: typeof row.org_website === "string" ? row.org_website : null,
    email: String(row.email ?? ""),
    grant: String(row.grant_input ?? ""),
    grantAnalysisOk: row.grant_analysis_ok === true,
    deadline: typeof row.deadline === "string" ? row.deadline : null,
    answers,
    venueEscape: VENUE_ESCAPES.has(veRaw) ? (veRaw as VenueEscape) : null,
    neverDelivered: row.never_delivered === true,
    uploads,
    facts,
  };
}

/** The fingerprint the clearance is bound to. SHA-256 over canonicalPayload. */
export async function fingerprintOfRow(
  row: Record<string, unknown>,
  uploads: UploadedDoc[],
): Promise<string> {
  return await fingerprint(inputFromRow(row, uploads));
}

/** A single-use checkout authorisation: 48 hex chars, minted only on clearance. */
export function mintCheckoutToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
