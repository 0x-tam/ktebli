import { contactAudit, contactClaims }
  from "../../supabase/functions/worker/contact_claims.ts";

let bad = 0;
const ok = (c: boolean, m: string) => { c ? console.log(`  ok  ${m}`) : (console.error(`  FAIL ${m}`), bad++); };

// The real ledger from the evidence-poor benchmark case. It carries a registration
// number and an address. It carries no telephone, no email and no bank account.
const LEDGER = [
  { claim: "Organisation name: Mashghal Community Association" },
  { claim: "Registration number: 1487/2019 (Lebanese Ministry of Interior ilm wa khabar), registered 2019." },
  { claim: "Website: none supplied. The applicant has no website." },
  { claim: "Base: Tripoli, Lebanon. Works in the Bab al-Tabbaneh and Qobbe neighbourhoods." },
  { claim: "Staffing: two part-time staff (a coordinator and a bookkeeper) and roughly fifteen volunteers." },
];

console.log("THE OBSERVED FABRICATION — verbatim from real pipeline output");
// out-evidence-poor-A.md, produced by the full pipeline at the current generator.
// Every internal validator passed this document.
const REAL = `## 1. APPLICANT IDENTIFICATION

- **Legal Name of Organisation:** Mashghal Community Association
- **Registration Number:** 1487/2019 (Ministry of Interior and Municipalities *'ilm wa khabar*)
- **Year of Registration:** 2019
- **Physical Address:** Bab al-Tabbaneh, Tripoli, North Governorate, Lebanon
- **Contact Person:** Project Coordinator
- **Telephone:** +961 6 380 000
- **Bank Account Holder Name:** Mashghal Community Association
`;
const a = contactAudit(REAL, LEDGER);
ok(a.fabricated.some((c) => c.kind === "telephone" && c.literal.includes("380 000")),
  "the invented telephone number is caught");
ok(a.findings.length === 1 && a.findings[0].startsWith("FABRICATED CONTACT DETAILS"),
  "one blocking finding is raised");

console.log("\nand the details that ARE evidenced are not flagged");
ok(!a.fabricated.some((c) => c.literal.includes("1487/2019")),
  "the real registration number passes");
ok(!a.fabricated.some((c) => /Coordinator/i.test(c.literal)),
  "a contact PERSON with no digits is not a contact detail");
ok(!a.fabricated.some((c) => /Mashghal/i.test(c.literal)),
  "the bank account HOLDER NAME is a name, not an account number");

console.log("\nformatting must not defeat the comparison");
ok(contactAudit("- Telephone: +9616380000\n", [{ claim: "Phone: +961 6 380 000" }]).fabricated.length === 0,
  "spacing and punctuation are normalised away");
ok(contactAudit("- Tel: +961 6 380 000\n", [{ claim: "Phone: +9616380000" }]).fabricated.length === 0,
  "and in the other direction");

console.log("\nother contact shapes");
ok(contactAudit("Email us at grants@invented-charity.org for details.", LEDGER)
  .fabricated.some((c) => c.kind === "email"), "an invented email is caught");
ok(contactAudit("Account: GB29 NWBK 6016 1331 9268 19", LEDGER)
  .fabricated.some((c) => c.kind === "iban" || c.kind === "account"), "an invented IBAN is caught");
ok(contactAudit("See https://mashghal-invented.org/impact", LEDGER)
  .fabricated.some((c) => c.kind === "url"), "an invented URL is caught");
ok(contactAudit("See https://mashghal.org", [{ claim: "Website: https://mashghal.org" }])
  .fabricated.length === 0, "the real website passes");

console.log("\nno false positives on ordinary proposal prose");
const PROSE = `We will reach 216 people across 18 streets over 24 months, at a cost of
USD 21,000. The 2019 baseline showed 1,250 households affected. Registration 1487/2019.`;
const p = contactAudit(PROSE, LEDGER);
ok(p.fabricated.length === 0,
  `budgets, dates, counts and the real registration number raise nothing (got ${p.fabricated.length})`);

console.log("\na clean document raises nothing");
ok(contactAudit("The project runs in Bab al-Tabbaneh with fifteen volunteers.", LEDGER)
  .findings.length === 0, "silence when there is nothing to say");

console.log("\nthe extractor itself");
ok(contactClaims("- **Telephone:** +961 6 380 000").length === 1, "a labelled phone is one claim");
ok(contactClaims("- **Contact Person:** Project Coordinator").length === 0, "a role is not a claim");

console.log(bad ? `\n${bad} FAILURE(S)` : "\nALL CONTACT-CLAIM TESTS PASSED");
if (bad) Deno.exit(1);
