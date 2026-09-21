// ============================================================================
// intake_answers -> Evidence Ledger (E-INTAKE-4+)
// ============================================================================
//
// KT-10001 held at `validate` on grounding because the narrative asserted org
// facts — a safeguarding policy and a named Designated Safeguarding Lead, named
// programmes and services, a named venue — that NO ledger item carried. The
// intake now collects those facts (pre-payment, structured, fingerprinted), and
// they travel to the order as `orders.intake_answers`. This module is the wiring
// the gap report named: it turns every NON-EMPTY intake answer into one clear
// factual E-INTAKE item, so generation can draw on it and the Claim Ledger
// classifies the matching narrative claim as `supported` rather than
// `unsupported`, and the proper-noun audit finds the names ledger-backed.
//
// Rules that follow from the invariants:
//   * a blank field contributes NOTHING — nothing is defaulted or invented
//     (invariant 3). A boolean certification asserts only when it is exactly
//     `true`.
//   * these are the applicant's own structured answers, collected before payment
//     and part of what the sufficiency gate fingerprints; they are recorded as
//     verified intake facts, the same status the three identity items carry
//     (worker/index.ts E-INTAKE-1/2/3). Nothing here is a website or a document
//     claim — those keep their own provenance (E-WEB / E-PROP).
//   * one factual claim per item; objects and arrays expand to one item each,
//     so a single name never rides inside a paragraph the audit cannot resolve.
// ============================================================================

export interface IntakeLedgerItem {
  id: string;
  claim: string;
  source_type: string;
  source_ref: string;
  status: string;
  allowed: boolean;
}

// deno-lint-ignore no-control-regex
const CTRL = /[\u0000-\u001f\u007f]+/g;
function clean(v: unknown, max = 300): string {
  return String(v ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const VENUE_ESCAPE_CLAIM: Record<string, string> = {
  homes: "Delivery happens in participants' own homes, not at a fixed venue.",
  street: "Delivery is street-based outreach, not at a fixed venue.",
  outdoors: "Delivery happens outdoors, not at a fixed venue.",
  mobile: "Delivery is mobile, from a vehicle, not at a fixed venue.",
  online: "Delivery happens online, not at a fixed venue.",
};

export interface IntakeLedgerOptions {
  /** Continue E-INTAKE numbering after the identity items (org/reg/website = 3). */
  startAt?: number;
  /** True when org_reg already produced E-INTAKE-2 — avoids a duplicate registration item. */
  haveRegistration?: boolean;
}

/**
 * Build E-INTAKE ledger items from `orders.intake_answers`. Pure and
 * deterministic: same answers -> same items, in a stable order.
 */
export function intakeAnswerLedger(raw: unknown, opts: IntakeLedgerOptions = {}): IntakeLedgerItem[] {
  const a = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: IntakeLedgerItem[] = [];
  let n = opts.startAt ?? 3;
  const push = (claim: string) => {
    const c = clean(claim);
    if (!c) return;
    out.push({
      id: `E-INTAKE-${++n}`,
      claim: c,
      source_type: "user_intake",
      source_ref: "evidence interview",
      status: "verified",
      allowed: true,
    });
  };
  const s = (k: string, max = 300) => clean(a[k], max);

  // ---- particularity slots (the six E-ASK answers) ------------------------
  if (s("site_place")) push(`Project location: ${s("site_place")}`);
  if (s("site_venue")) push(`Delivery venue: ${s("site_venue")}`);
  else {
    const ve = clean(a.venue_escape, 20).toLowerCase();
    if (ve && VENUE_ESCAPE_CLAIM[ve]) push(VENUE_ESCAPE_CLAIM[ve]);
  }
  if (s("site_activity")) push(`Main activity: ${s("site_activity")}`);
  if (a.never_delivered === true) {
    push("The organisation has not yet delivered a project; there is no track record to draw on, and the proposal must not imply one.");
  } else if (s("last_delivery_what")) {
    const when = s("last_delivery_when", 100);
    push(`Most recent delivery: ${s("last_delivery_what")}${when ? ` (${when})` : ""}`);
  }
  if (s("local_trigger")) push(`Local trigger for this work: ${s("local_trigger")}`);

  // ---- admin facts (self-certified) ---------------------------------------
  // Registration travels through the identity channel (org_reg -> E-INTAKE-2);
  // only emit it here if that item was not built, so there is never a duplicate.
  if (!opts.haveRegistration && s("registration_number", 100)) {
    push(`Registration number: ${s("registration_number", 100)}`);
  }
  if (s("legal_form", 120)) push(`Legal form: ${s("legal_form", 120)}`);
  if (s("annual_income", 60)) push(`Latest annual income: ${s("annual_income", 60)}`);
  if (s("income_band", 60)) push(`Annual income band: ${s("income_band", 60)}`);
  if (s("accounts_period", 80)) push(`Latest filed accounts cover the period: ${s("accounts_period", 80)}`);
  if (s("lived_experience_governance", 400)) {
    push(`People with lived experience are involved in governance: ${s("lived_experience_governance", 400)}`);
  }

  // Named Designated Safeguarding Lead — one item, name + role + training.
  const dsl = s("safeguarding_lead_name", 120);
  if (dsl) {
    const role = s("safeguarding_lead_role", 120);
    const training = s("safeguarding_lead_training", 120);
    const parts = [dsl, role, training].filter(Boolean);
    push(`Designated Safeguarding Lead: ${parts.join(", ")}`);
  }

  // Certifications — asserted only when exactly true.
  if (a.safeguarding_policy === true) push("The organisation has a safeguarding policy in place.");
  if (a.bank_account_own_name === true) push("The organisation holds a bank account in its own name, with unrelated signatories.");
  if (a.public_liability_insurance === true) push("The organisation holds Public Liability Insurance.");
  if (a.board_independent === true) push("The organisation is independent, with its Board in full control.");
  if (a.no_conflicting_grant === true) push("The organisation has no conflicting live grant running with this funder.");

  // ---- named org facts (one item each) ------------------------------------
  for (const p of asArray(a.key_people)) {
    const o = p as Record<string, unknown>;
    const name = clean(o?.name, 120);
    if (!name) continue;
    const role = clean(o?.role, 120);
    push(`Key person: ${name}${role ? ` — ${role}` : ""}`);
  }
  for (const p of asArray(a.programmes)) {
    const o = p as Record<string, unknown>;
    const name = clean(o?.name, 120);
    if (!name) continue;
    const what = clean(o?.what, 300);
    push(`Programme: ${name}${what ? ` — ${what}` : ""}`);
  }
  for (const r of asArray(a.results)) {
    const o = r as Record<string, unknown>;
    const what = clean(o?.what, 200);
    const figure = clean(o?.figure, 60);
    const when = clean(o?.when, 60);
    if (!what && !figure) continue;
    const head = [figure, what].filter(Boolean).join(" ");
    push(`${head}${when ? ` (${when})` : ""}`);
  }
  for (const p of asArray(a.partnerships)) {
    const name = clean(p, 160);
    if (name) push(`Partnership: ${name}`);
  }

  return out;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
