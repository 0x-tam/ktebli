// Contact-detail fabrication check.
//
// THE FAILURE THIS EXISTS FOR, observed in real pipeline output. The evidence-poor
// document produced by the full pipeline opened with:
//
//     - **Registration Number:** 1487/2019 (Ministry of Interior ...)   <- in the ledger
//     - **Physical Address:** Bab al-Tabbaneh, Tripoli ...              <- in the ledger
//     - **Telephone:** +961 6 380 000                                   <- INVENTED
//
// The ledger contains no digit run of six or more anywhere. The donor's form mandates a
// telephone field, the applicant never supplied one, and the model filled the gap with
// something plausible. Every internal validator passed it.
//
// This is the most dangerous shape of fabrication precisely because it is boring. It is
// not a claim about the organisation's achievements, so the Claim Ledger's
// "donor_required_certification" class is designed to permit exactly this kind of
// administrative self-certification -- and the proper-noun audit cannot see it either,
// because a phone number is not a proper noun.
//
// So: any contact-shaped literal in the document must appear in the Evidence Ledger.
// Deterministic, no model, and BLOCKING rather than advisory -- there is no legitimate
// reason to state a contact detail that no evidence carries. Where the applicant never
// supplied one, the correct output is to leave the field marked as not supplied, which is
// what an honest form does.

export type ContactKind = "telephone" | "email" | "iban" | "account" | "url" | "postcode";

export interface ContactClaim {
  kind: ContactKind;
  literal: string;   // as written in the document
  norm: string;      // comparison form
  context: string;   // the line it appeared on, trimmed
}

// Labels a donor form actually uses. Anchoring on the label is far more precise than
// hunting bare digit runs, which collide with dates, budgets and beneficiary counts.
const LABELLED = new RegExp(
  String.raw`(?:^|[\s*_|>-])(telephone|tele|phone|tel|mobile|cell|whatsapp|fax|bank\s+account(?:\s+number)?|account\s+number|iban|sort\s+code|routing(?:\s+number)?|swift|bic)` +
  String.raw`\s*[:：]\s*\*{0,2}\s*([^\n|*]{3,48})`,
  "gi",
);

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}\b/g;
const URL = /\bhttps?:\/\/[^\s)<>\]]+/gi;

// A contact literal is compared with punctuation and spacing removed, so
// "+961 6 380 000" and "+9616380000" are the same claim.
function normContact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9@.]/g, "");
}

function labelKind(label: string): ContactKind {
  const l = label.toLowerCase();
  if (/iban/.test(l)) return "iban";
  if (/account|sort|routing|swift|bic/.test(l)) return "account";
  return "telephone";
}

// A labelled value that carries no digits at all is prose, not a contact detail:
// "Contact Person: Project Coordinator" is a role, and roles are checked elsewhere.
function hasDigits(s: string): boolean { return /\d/.test(s); }

export function contactClaims(md: string): ContactClaim[] {
  const out: ContactClaim[] = [];
  const seen = new Set<string>();
  const push = (kind: ContactKind, literal: string, context: string) => {
    const lit = literal.trim().replace(/[.,;]+$/, "");
    if (!lit) return;
    const norm = normContact(lit);
    if (norm.length < 6) return;                 // too short to be a real contact detail
    const key = kind + ":" + norm;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, literal: lit, norm, context: context.trim().slice(0, 160) });
  };

  for (const m of md.matchAll(LABELLED)) {
    const value = m[2] ?? "";
    if (!hasDigits(value)) continue;
    push(labelKind(m[1]), value, m[0]);
  }
  for (const m of md.matchAll(EMAIL)) push("email", m[0], m[0]);
  for (const m of md.matchAll(IBAN)) push("iban", m[0], m[0]);
  for (const m of md.matchAll(URL)) push("url", m[0], m[0]);
  return out;
}

export interface ContactAudit {
  claims: ContactClaim[];
  fabricated: ContactClaim[];
  findings: string[];
}

/**
 * Every contact-shaped literal in the document must appear in the Evidence Ledger.
 * Blocking by design: this is invariant 3, not a style preference.
 */
export function contactAudit(
  narrative: string,
  ledger: Array<Record<string, unknown>>,
): ContactAudit {
  const hay = ledger.map((e) => String(e.claim ?? "")).join("\n");
  const hayNorm = normContact(hay);

  const claims = contactClaims(narrative);
  const fabricated = claims.filter((c) => !hayNorm.includes(c.norm));

  const findings = fabricated.length
    ? [
      `FABRICATED CONTACT DETAILS: ${
        fabricated.map((c) => `${c.kind} "${c.literal}"`).join("; ")
      } — no Evidence Ledger item carries these. A donor form mandating a field is not ` +
      `evidence that the applicant supplied one. Remove the value and state plainly that it ` +
      `was not supplied, or use the value the ledger carries.`,
    ]
    : [];

  return { claims, fabricated, findings };
}
