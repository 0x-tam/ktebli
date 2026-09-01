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
//
// 2026-08-27 — the check was written against ONE observed line and caught 1 of 25
// attacks in tests/adversarial/fabricated_identity_test.ts. Two classes of defect:
//
//   * the SEPARATOR decided whether a field was read at all ("**Telephone:** x" was
//     seen, "**Telephone**: x", "Tel. x", "Telephone — x" and "| Telephone | x |"
//     were not), and the label list was one observed failure's worth of fields; and
//   * worse than a miss, the comparison AFFIRMATIVELY CLEARED an invented bank
//     account number, because "14872019" is a digit-substring of the flattened
//     ledger's registration number 1487/2019. That is manufactured provenance,
//     which invariant 3 forbids by name.
//
// Both are closed below. Support is now whole-literal AND kind-aware: a ledger item
// that carries a registration number supports a registration number and nothing else.

export type ContactKind =
  | "telephone" | "email" | "iban" | "account" | "url"
  | "postcode" | "address" | "registration" | "date";

export interface ContactClaim {
  kind: ContactKind;
  literal: string;   // as written in the document
  norm: string;      // comparison form
  context: string;   // the line it appeared on, trimmed
}

// Labels a donor form actually uses. Anchoring on the label is far more precise than
// hunting bare digit runs, which collide with dates, budgets and beneficiary counts.
//
// The label list is the set of identity fields a donor form asks for, not the set of
// fields one observed failure happened to use. `postcode` was already declared in
// ContactKind and nothing ever produced it — that type member was a promise the code
// did not keep.
const LABEL_ALT =
  String.raw`telephone(?:\s+number)?|tele|phone(?:\s+number)?|tel|mobile|cell|whatsapp|fax` +
  String.raw`|contact\s+(?:number|tel(?:ephone)?|phone)|hotline|landline|switchboard` +
  String.raw`|bank\s+account(?:\s+number)?|account\s+number|iban|sort\s+code|routing(?:\s+number)?|swift|bic` +
  String.raw`|compan(?:y|ies)\s+(?:house\s+)?number|charity\s+(?:registration\s+)?number` +
  String.raw`|registration\s+(?:number|no\.?)|registered\s+(?:number|no\.?)|vat\s+(?:registration|number|no\.?)|tax\s+(?:id|identification\s+number)` +
  String.raw`|post\s?code|postal\s+code|zip(?:\s+code)?|p\.?\s?o\.?\s+box` +
  String.raw`|(?:registered\s+)?(?:office|address)|street\s+address|physical\s+address` +
  // The Evidence Ledger records an applicant's premises under the intake's own field
  // names — "Delivery venue: 160 Pitfield Way ...", "Project location: ...". Those are
  // the SAME place literal the narrative prints under an "Address:" heading, so they must
  // extract to the same address claim or the ledger cannot support the document and a
  // GROUNDED address is reported as fabricated (KT-10001's last residual: grounding hit 0
  // and this one asymmetry still held the order). Symmetric by construction — the ledger
  // item and the narrative line now read through the identical extractor.
  String.raw`|(?:delivery\s+)?venue|(?:project\s+|delivery\s+)?location|based\s+(?:at|in)|operat(?:es?|ing)\s+(?:at|from)` +
  String.raw`|date\s+of\s+incorporation|incorporated\s+on|date\s+of\s+registration|established\s+(?:in|on)`;

// The SEPARATOR must not decide whether a field is checked. A generator writes the same
// invented number as "**Telephone:** x", "**Telephone**: x", "Tel. x", "Telephone — x"
// and "| Telephone | x |" with no change of meaning, and the first spelling was the only
// one this check could see. Emphasis marks may sit between the label and its separator;
// the separator itself may be a colon, a full stop, a dash, or the pipe of a markdown
// table cell. Horizontal whitespace only on both sides: a label at the end of one line
// must not reach onto the next one for its value.
const LABELLED = new RegExp(
  String.raw`(?:^|[\s*_|>-])(` + LABEL_ALT + String.raw`)` +
  String.raw`\**[ \t]*(?:[:：.]|[—–-]{1,2}|\|)[ \t]*\**[ \t]*([^\n|*]{3,64})`,
  "gi",
);

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}\b/g;
const URL = /\bhttps?:\/\/[^\s)<>\]]+/gi;
// A domain is a contact detail whether or not the generator typed a scheme. SHAPE, not
// a TLD allow-list, decides: a closed TLD set (org/com/net/...) let a fabricated
// mashghal-project.io or mashghal.ly walk straight through, and invariant 3 does not
// care which registry a fabricated site sits in. The TLD is now any run of >=2 letters;
// what keeps "e.g." and "i.e." out is the FIRST-label rule — [a-z0-9][a-z0-9-]{1,62}
// requires the label before the (first) dot to be at least two characters, which a
// single-letter abbreviation ("e", "i", "a") can never satisfy. Multi-part public
// suffixes (org.uk, com.lb) are still matched through the middle-label repetition. The
// lookbehind keeps the host inside an email address from being reported twice.
// Residual, fail-closed: a filename in prose (budget.xlsx) can be read as a host and
// HELD — the safe direction for a blocking grounding gate; a fabricated site must never
// pass because its TLD was not on a list.
const BARE_HOST =
  /(?<![@\w.-])(?:www\.)?[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9-]{2,63})*\.[a-z]{2,24}\b/gi;
// An international dialling number needs no label to be a contact detail: "Reach the
// coordinator on +961 6 431 227" states one. The leading "+" is required, which is what
// keeps budgets, beneficiary counts and years out of this pattern.
const INTL_PHONE = /\+\d[\d \t().-]{5,}\d/g;

// A DOMESTIC dialling number needs no label and no "+" either: "Call the coordinator on
// 06 431 227" states one, and anchoring detection on a label ("Reception:", "Enquiries",
// "Head office line:") or a separator ("WhatsApp IS 06...") let every un-listed field
// name walk a fabricated number through. So the SHAPE is the anchor, not the label.
// Phone shape = two or more digit groups (2-5 digits each) joined ONLY by spaces, dots,
// dashes or parens, with >= 7 digits in total (enforced by minNorm on push). What this
// deliberately excludes, so ordinary proposal prose raises nothing:
//   * comma-grouped thousands ("USD 21,000", "1,250 households") — comma is not a group
//     separator here, so such a number is a single group and never a phone;
//   * a slashed registration/date ("1487/2019") — "/" is not a separator, and the
//     leading guard refuses a run that begins right after a digit, comma, slash or dot;
//   * a bare year or count ("2019", "216 people", "24 months") — one group, never >= 2.
// Residual, fail-closed: a SPACE-grouped number ("1 500 000") is phone-shaped and would
// be HELD for review — the safe direction for a blocking grounding gate.
const PHONE_SHAPE = /(?<![\d,/.])(?:\(?\d{2,5}\)?[ \t.\-]){1,5}\d{2,5}(?!\d)/g;

// All of the above are module-level and carry /g. `String.prototype.matchAll` iterates
// over an internal clone and never advances the original's lastIndex, so they are safe
// to share between calls; nothing here uses .test() or .exec() on them.

// A contact literal is compared with punctuation and spacing removed, so
// "+961 6 380 000" and "+9616380000" are the same claim.
function normContact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9@.]/g, "");
}

function labelKind(label: string): ContactKind {
  const l = label.toLowerCase();
  if (/iban/.test(l)) return "iban";
  if (/account|sort|routing|swift|bic/.test(l)) return "account";
  if (/post\s?code|postal|zip/.test(l)) return "postcode";
  if (/office|address|box|venue|location|based|operat/.test(l)) return "address";
  // Dates first: "date of registration" is a date, and the registration test below
  // would otherwise swallow it.
  if (/incorporat|established|date\s+of/.test(l)) return "date";
  if (/compan|charity|registration|registered\s+n|vat|tax/.test(l)) return "registration";
  return "telephone";
}

// What a literal is FOR. Support is checked within a class, never across one: an IBAN in
// the ledger may back a bank-account line, and a registration number may not back
// anything but a registration number. This is the difference between reading evidence
// and manufacturing it.
const KIND_CLASS: Record<ContactKind, string> = {
  telephone: "telephone",
  email: "email",
  iban: "bank",
  account: "bank",
  url: "url",
  postcode: "place",
  address: "place",
  registration: "registration",
  date: "date",
};

// A labelled value that carries no digits at all is prose, not a contact detail:
// "Contact Person: Project Coordinator" is a role, and roles are checked elsewhere.
function hasDigits(s: string): boolean { return /\d/.test(s); }

// A parenthetical annotates a value, it is not part of it: "1487/2019 (Ministry of
// Interior)" and "1487/2019 (Lebanese Ministry of Interior ilm wa khabar)" are the same
// registration number written twice, and comparing them whole would report the ledger's
// own number as fabricated.
function labelledValue(raw: string): string {
  const paren = raw.indexOf("(");
  return (paren > 0 ? raw.slice(0, paren) : raw).trim();
}

export function contactClaims(md: string): ContactClaim[] {
  const out: ContactClaim[] = [];
  const seen = new Set<string>();
  // minNorm: a pattern-matched literal must be long enough to be a contact detail at
  // all, because nothing but its shape says it is one. A LABELLED value is different —
  // the donor's own field name says what it is, and "Hotline: 1564" is a real hotline.
  const push = (kind: ContactKind, literal: string, context: string, minNorm = 6) => {
    const lit = literal.trim().replace(/[.,;:\-–—\s]+$/, "");
    if (!lit) return;
    const norm = normContact(lit);
    if (norm.length < minNorm) return;
    const key = kind + ":" + norm;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, literal: lit, norm, context: context.trim().slice(0, 160) });
  };

  for (const m of md.matchAll(LABELLED)) {
    const value = labelledValue(m[2] ?? "");
    if (!hasDigits(value)) continue;
    push(labelKind(m[1]), value, m[0], 3);
  }
  for (const m of md.matchAll(EMAIL)) push("email", m[0], m[0]);
  for (const m of md.matchAll(IBAN)) push("iban", m[0], m[0]);
  for (const m of md.matchAll(URL)) push("url", m[0], m[0]);
  for (const m of md.matchAll(BARE_HOST)) push("url", m[0], m[0]);
  for (const m of md.matchAll(INTL_PHONE)) push("telephone", m[0], m[0]);
  // A domestic number is a phone only if it carries phone-length digits; minNorm 7
  // drops a two-group four-digit accident while keeping "06 431 227" (8 digits).
  for (const m of md.matchAll(PHONE_SHAPE)) push("telephone", m[0], m[0], 7);
  return out;
}

// A host may legitimately be written with or without its scheme or a "www." prefix.
// Nothing else about a contact literal may vary.
function compareForm(c: { kind: ContactKind; norm: string }): string {
  if (c.kind !== "url") return c.norm;
  return c.norm.replace(/^https?/, "").replace(/^www\./, "");
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
  // A contact literal is supported only by a literal the ledger ACTUALLY CARRIES,
  // compared WHOLE and WITHIN ITS CLASS. The previous test — does the claim appear
  // anywhere inside the flattened, separator-stripped ledger — cleared fabrications
  // two ways: "Account number: 14872019" is a substring of the normalised registration
  // number 1487/2019, and joining items with a newline that normalisation then deleted
  // let a claim be "supported" by digits spanning two unrelated evidence rows.
  //
  // Each ledger item is read on its own, by the same extractor that reads the document,
  // so a ledger literal arrives with the kind the ledger itself gave it. Support then
  // requires equality with a literal of the same class. A registration number backs a
  // registration number; it backs no bank account, ever.
  const supported = new Set<string>();
  for (const e of ledger) {
    for (const c of contactClaims(String(e.claim ?? ""))) {
      supported.add(KIND_CLASS[c.kind] + " " + compareForm(c));
    }
  }

  const claims = contactClaims(narrative);
  const fabricated = claims.filter((c) => {
    const cls = KIND_CLASS[c.kind];
    const n = compareForm(c);
    if (supported.has(cls + " " + n)) return false;
    if (c.kind === "url") {
      // A URL the ledger carries may be written with or without a trailing path
      // segment. Hosts only — this leniency never crosses into another class.
      for (const s of supported) {
        if (!s.startsWith("url ")) continue;
        const v = s.slice(4);
        if (v && (n.startsWith(v) || v.startsWith(n))) return false;
      }
    }
    return true;
  });

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
