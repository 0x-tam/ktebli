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


// ---------------------------------------------------------------------------
// REGRESSION — invariant 3, added 2026-08-27 with the fix for the 25-route
// attack in tests/adversarial/fabricated_identity_test.ts. Each block below is a
// route by which an unsupported identity literal reached a delivered document.
// ---------------------------------------------------------------------------
const f = (md: string) => contactAudit(md, LEDGER).fabricated.length > 0;

console.log("\nthe SEPARATOR must not decide whether a field is read");
ok(f("- **Telephone**: +961 6 431 227"), "colon outside the emphasis");
ok(f("| Telephone | +961 6 431 227 |"), "a markdown table cell");
ok(f("- Tel. +961 6 431 227"), "a full stop");
ok(f("- Telephone — +961 6 431 227"), "an em dash");
ok(f("Reach the coordinator on +961 6 431 227 during office hours."), "no label at all");

console.log("\nidentity fields other than a telephone");
ok(f("- **Company Number:** 09876543"), "company number");
ok(f("- **Charity Number:** 1156742"), "charity number");
ok(f("- **Postcode:** 1300 2041"), "postcode — the ContactKind member nothing produced");
ok(f("- **Registered office:** 42 Rue Riad El Solh, Tripoli 1300"), "street address");
ok(f("- **Date of Incorporation:** 14 March 2011"), "date of incorporation");
ok(f("Further detail is published at www.mashghal-community.org."), "a host with no scheme");

console.log("\nsupport is WHOLE and WITHIN A CLASS — never manufactured");
ok(f("- **Account number:** 14872019"),
  "an invented account is NOT cleared by the registration number 1487/2019");
ok(f("- **Sort code:** 148720"),
  "nor by a digit-substring of one");
ok(contactAudit("- **Telephone:** 20191487", [
  { claim: "Registration number: 1487" }, { claim: "Year: 2019" },
]).fabricated.length === 1, "nor by digits spanning two unrelated ledger rows");

console.log("\nand a detail the ledger really carries still passes");
ok(contactAudit("- **Registration Number:** 1487/2019 (Ministry of Interior)", LEDGER)
  .fabricated.length === 0, "the ledger's own registration number, differently annotated");
ok(contactAudit("- **Contact number:** +961 6 380 000", [{ claim: "Telephone: +961 6 380 000" }])
  .fabricated.length === 0, "a phone the ledger carries under a different phone label");
ok(contactAudit("Write to grants@mashghal.org.", [{ claim: "Email: grants@mashghal.org" }])
  .fabricated.length === 0, "an email the ledger carries");
ok(contactAudit("Further detail is at www.mashghal.org.", [{ claim: "Website: https://mashghal.org/about" }])
  .fabricated.length === 0, "a host the ledger carries, written without its scheme");

console.log(bad ? `\n${bad} FAILURE(S)` : "\nALL CONTACT-CLAIM TESTS PASSED");
if (bad) Deno.exit(1);
