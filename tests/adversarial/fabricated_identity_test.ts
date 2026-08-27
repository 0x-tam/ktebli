// ADVERSARIAL — invariant 3: "nothing asserted that the ledger does not carry;
// never manufacture provenance".
//
// The pipeline was caught inventing a telephone number (+961 6 380 000) and
// `contact_claims.ts` was written against that one failure. This test attacks the
// class rather than the instance: the same fabrication written in a different
// markdown shape, under a different donor label, or built out of a word the ledger
// happens to carry.
//
// EVERY assertion below FAILS against the code as it stands on 2026-08-27. That is
// the point: each failure is a route by which a fact no ledger item supports
// reaches a paying customer's document.
//
// Run: npx --yes deno@2.9.5 run --allow-read tests/adversarial/fabricated_identity_test.ts

import { contactAudit } from "../../supabase/functions/worker/contact_claims.ts";
import { properNounAudit, properNouns } from "../../supabase/functions/worker/proper_nouns.ts";

let bad = 0;
const ok = (c: boolean, m: string) => {
  c ? console.log(`  ok   ${m}`) : (console.error(`  FAIL ${m}`), bad++);
};

// The real evidence-poor benchmark ledger. It carries an organisation name, a
// registration number, a base and a headcount. It carries no telephone, no email,
// no address line, no company number, no website, no partner and no named person.
const LEDGER = [
  { claim: "Organisation name: Mashghal Community Association" },
  { claim: "Registration number: 1487/2019 (Lebanese Ministry of Interior ilm wa khabar), registered 2019." },
  { claim: "Website: none supplied. The applicant has no website." },
  { claim: "Base: Tripoli, Lebanon. Works in the Bab al-Tabbaneh and Qobbe neighbourhoods." },
  { claim: "Staffing: two part-time staff (a coordinator and a bookkeeper) and roughly fifteen volunteers." },
];
const ORG = "Mashghal Community Association";

const fab = (md: string) => contactAudit(md, LEDGER).fabricated.length > 0;

// ---------------------------------------------------------------------------
// 1. The same invented number, written differently
// ---------------------------------------------------------------------------
console.log("1. contact detail: shape of the line must not decide whether it is checked");

ok(fab("- **Telephone:** +961 6 431 227"),
  "CONTROL — the one shape the check was written against is caught");
ok(fab("- **Telephone**: +961 6 431 227"),
  "bold label with the colon OUTSIDE the emphasis is caught");
ok(fab("| Telephone | +961 6 431 227 |"),
  "a telephone in a markdown table row is caught");
ok(fab("- Tel. +961 6 431 227"),
  "a label separated by a full stop is caught");
ok(fab("- Telephone — +961 6 431 227"),
  "a label separated by an em dash is caught");
ok(fab("Reach the coordinator on +961 6 431 227 during office hours."),
  "an unlabelled international dialling number in prose is caught");

// ---------------------------------------------------------------------------
// 2. Identity fields the donor form mandates and the label list does not carry
// ---------------------------------------------------------------------------
console.log("\n2. identity fields other than a telephone");

ok(fab("- **Contact number:** 06 431 227"), "an invented 'contact number' is caught");
ok(fab("- **Hotline:** 1564"), "an invented hotline is caught");
ok(fab("- **Company Number:** 09876543"), "an invented company number is caught");
ok(fab("- **Charity Number:** 1156742"), "an invented charity number is caught");
ok(fab("- **Registration Number:** 2011/4457"),
  "a registration number that is NOT the ledger's is caught");
ok(fab("- **Postcode:** 1300 2041"),
  "an invented postcode is caught — ContactKind already declares 'postcode' and nothing produces it");
ok(fab("- **Date of Incorporation:** 14 March 2011"),
  "an invented date of incorporation is caught");
ok(fab("- **Registered office:** 42 Rue Riad El Solh, Tripoli 1300"),
  "an invented street address is caught");
ok(fab("Further detail is published at www.mashghal-community.org."),
  "an invented web address without a scheme is caught, against a ledger that says there is no website");

// ---------------------------------------------------------------------------
// 3. Manufactured provenance — the comparison must not clear a fabrication
// ---------------------------------------------------------------------------
console.log("\n3. never manufacture provenance");

ok(fab("- **Account number:** 14872019"),
  "an invented bank account is NOT cleared by the ledger's registration number 1487/2019");
ok(fab("- **Sort code:** 148720"),
  "an invented sort code is NOT cleared by a digit-substring of a ledger number");

// ---------------------------------------------------------------------------
// 4. Proper nouns: position in the document must not decide visibility
// ---------------------------------------------------------------------------
console.log("\n4. an invented entity must be reported wherever it sits");

const uns = (md: string) => properNounAudit(md, LEDGER, ORG).unsourced;
const names = (md: string, want: string) =>
  uns(md).some((u) => u.toLowerCase().includes(want.toLowerCase()));

ok(names("The work is delivered with Cedar Valley Trust across the district.", "Cedar Valley"),
  "CONTROL — an invented partner mid-sentence is reported");
ok(names("Volunteers are trained locally. Cedar Valley Trust supplies the curriculum.", "Cedar Valley"),
  "an invented partner at a SENTENCE START is reported");
ok(names("The curriculum is supplied by our delivery partner\nCedar Valley Trust, at no cost.", "Cedar Valley"),
  "an invented partner at a WRAPPED LINE start is reported");
ok(names("| Partner | Role |\n| --- | --- |\n| Cedar Valley Trust | Curriculum |", "Cedar Valley"),
  "an invented partner inside a MARKDOWN TABLE is reported");
ok(names("## Recognition: the Beirut Civic Excellence Award\n\nWe describe our record below.", "Beirut Civic Excellence"),
  "an invented award inside a HEADING is reported");
ok(names("The team is small. Rana Haddad has directed the association since 2016.", "Rana Haddad"),
  "an invented named person at a SENTENCE START is reported");
ok(names("Staffing:\n\nRana Haddad, Executive Director\n", "Rana Haddad"),
  "an invented named person in a bullet is reported as the PERSON, not as their job title");
ok(names("\"Before the workshop I had no way to earn,\" said Layla, a 17-year-old participant.", "Layla"),
  "a quotation attributed to an invented beneficiary is reported");

// ---------------------------------------------------------------------------
// 5. A fabrication must never be CREDITED as evidence use
// ---------------------------------------------------------------------------
console.log("\n5. an invented entity must not be counted as a ledger referent");

const credited = (md: string) => properNounAudit(md, LEDGER, ORG).used;
ok(credited("Referrals come from the Qobbe Vocational Institute.") === 0,
  "an invented institute is not credited as use of the ledger referent 'Qobbe'");
ok(credited("Its accounts are filed with the Lebanon Reconstruction Fund.") === 0,
  "an invented fund is not credited as use of the ledger referent 'Lebanon'");
ok(credited("Placements run through the Bab al-Tabbaneh Employers Consortium.") === 0,
  "an invented consortium is not credited as use of 'Bab al-Tabbaneh'");

// ---------------------------------------------------------------------------
// 6. The ledger pass must not invent referents of its own
// ---------------------------------------------------------------------------
console.log("\n6. the denominator must be real");

const ledgerNouns = properNouns(LEDGER.map((e) => String(e.claim)).join("\n"));
ok(!ledgerNouns.some((n) => /^Community Association Registration$/.test(n)),
  "no phantom referent is read across the boundary between two ledger items");
// And the referents it does carry must be recognised when the narrative names
// them. "Base: Tripoli, Lebanon" opens after a colon, so the ledger pass drops
// "Tripoli" — a truthful sentence naming the applicant's own city scores zero
// while an invented "Lebanon Reconstruction Fund" scores one.
ok(properNounAudit("Our workshops sit in Tripoli, minutes from the port.", LEDGER, ORG).used >= 1,
  "naming Tripoli, which the ledger carries, counts as using the ledger");

// ---------------------------------------------------------------------------
// 7. The composite: the whole document
// ---------------------------------------------------------------------------
console.log("\n7. the composite document");

const DOC = `## 1. Applicant identification

| Field | Value |
| --- | --- |
| Legal name | Mashghal Community Association |
| Telephone | +961 6 431 227 |
| Registered office | 42 Rue Riad El Solh, Tripoli 1300 |

- **Registration Number**: 1487/2019 (Lebanese Ministry of Interior)
- **Company Number:** 09876543
- **Date of Incorporation:** 14 March 2011
- **Postcode:** 1300 2041
- **Contact number:** 06 431 227

Further detail is published at www.mashghal-community.org.

## 2. Governance and accreditation

The association has held ISO 9001:2015 certification since 2019 and is audited
annually to BS 8484. Its accounts are filed with the Lebanon Reconstruction Fund
as a condition of prior funding.

## 3. Team

Rana Haddad has directed the association since 2016, supported by a bookkeeper.
Karim Nassar coordinates the workshop timetable.

## 4. Delivery partners

| Partner | Role | Since |
| --- | --- | --- |
| Cedar Valley Trust | Vocational curriculum | 2019 |
| Al-Amal Foundation for Youth | Referrals | 2021 |
| Qobbe Vocational Institute | Assessment | 2020 |

Placements are arranged through the Bab al-Tabbaneh Employers Consortium.

## 5. Voice of participants

"Before the workshop I had no way to earn," said Layla, a 17-year-old
participant.
`;

const ca = contactAudit(DOC, LEDGER);
const pn = properNounAudit(DOC, LEDGER, ORG);

ok(ca.fabricated.length >= 6,
  `the six invented contact/identity literals are caught (got ${ca.fabricated.length})`);

// The exact blocking arithmetic of the validate stage, index.ts:1744-1748.
const ADVISORY = ["repeated development jargon", "heavy development jargon",
                  "UNSOURCED PROPER NOUNS", "SPECIFICITY"];
const blocking = [...pn.findings, ...ca.findings]
  .filter((f) => !ADVISORY.some((a) => f.startsWith(a))).length;
ok(blocking > 0,
  `the validate stage raises at least one BLOCKING deterministic finding on this document (got ${blocking})`);

// Whatever the ledger offers, the document must not reach the D4 threshold on the
// strength of entities that do not exist. delivery_gate.ts:318-324.
const d4Pass = !(pn.ledger_offers >= 3 && pn.used * 2 < pn.ledger_offers);
const realUsed = properNounAudit(
  "- **Registration Number**: 1487/2019 (Lebanese Ministry of Interior)", LEDGER, ORG).used;
ok(!d4Pass || pn.used === realUsed,
  `D4 is not cleared by invented entities: the document credits ${pn.used} referents but only ` +
  `${realUsed} of them are real`);

console.log(bad ? `\n${bad} FAILURE(S) — each is a live route for an unsupported fact` : "\nALL ADVERSARIAL GROUNDING TESTS PASSED");
if (bad) Deno.exit(1);
