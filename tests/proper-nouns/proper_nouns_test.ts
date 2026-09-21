import { properNouns, properNounAudit } from "../../supabase/functions/worker/proper_nouns.ts";

function eq(a: unknown, b: unknown, msg: string) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) { console.error(`FAIL ${msg}\n  got ${x}\n  want ${y}`); Deno.exit(1); }
  console.log(`  ok  ${msg}`);
}
function ok(c: boolean, msg: string) {
  if (!c) { console.error(`FAIL ${msg}`); Deno.exit(1); }
  console.log(`  ok  ${msg}`);
}

const LEDGER = [
  { claim: "Organisation name: Mashghal Community Association" },
  { claim: "Runs a weekly lunch club at St Anne's Hall in Bab al-Tabbaneh since March 2019" },
  { claim: "Partnered with Tripoli Municipality on waste collection in 2023" },
  { claim: "Employs Rana Haddad as programme coordinator" },
  { claim: "Served 1,250 households in the Qobbeh district during 2024" },
];
const NAME = "Mashghal Community Association";

console.log("proper-noun extraction");
const pn = properNouns("The weekly lunch club at St Anne's Hall in Bab al-Tabbaneh has run since 2019.");
ok(pn.some((p) => p.includes("St Anne")), "multi-word venue with an apostrophe");
ok(pn.some((p) => p.includes("Bab al-Tabbaneh")), "place with a lowercase connective");
ok(!pn.includes("The"), "bare article is not a proper noun");

console.log("\nthe swappable document — uses none of its own evidence");
const generic = `## Problem
The organisation has identified a structural problem affecting vulnerable groups in the region.
## Response
Through capacity transfer and civic backing, the project will deliver measurable outcomes.
## Sustainability
The community will take ownership and further funding will be sought.`;
const a1 = properNounAudit(generic, LEDGER, NAME);
ok(a1.ledger_offers >= 5, `ledger offers ${a1.ledger_offers} named referents`);
eq(a1.used, 0, "the generic document uses none of them");
ok(a1.findings.some((f) => f.startsWith("SPECIFICITY")), "SPECIFICITY finding raised");
eq(a1.unsourced.length, 0, "and it invents nothing — generic prose is not fabrication");

console.log("\nthe particular document — uses its evidence");
const good = `## Problem
Since March 2019 the weekly lunch club at St Anne's Hall in Bab al-Tabbaneh has been the only
hot meal many households in Qobbeh get. In 2024 it served 1,250 households.
## Response
Rana Haddad will run the expansion, building on the waste-collection work done with
Tripoli Municipality in 2023.`;
const a2 = properNounAudit(good, LEDGER, NAME);
ok(a2.used >= 4, `uses ${a2.used} of ${a2.ledger_offers} ledger referents`);
eq(a2.findings.filter((f) => f.startsWith("SPECIFICITY")).length, 0, "no SPECIFICITY finding");
eq(a2.unsourced.length, 0, "nothing unsourced");

console.log("\nfabrication — a proper noun no ledger item supports");
const fabricated = good + `\nThe project is endorsed by the Cedar Valley Trust and delivered with Beirut Rotary Club.`;
const a3 = properNounAudit(fabricated, LEDGER, NAME);
ok(a3.unsourced.some((u) => u.includes("Cedar Valley")), "catches the invented funder");
ok(a3.unsourced.some((u) => u.includes("Beirut Rotary")), "catches the invented partner");
ok(a3.findings.some((f) => f.startsWith("UNSOURCED")), "UNSOURCED finding raised");

console.log("\nthin ledger — the applicant is not punished for evidence nobody has");
const thin = [{ claim: "Organisation name: Mashghal Community Association" }];
const a4 = properNounAudit(generic, thin, NAME);
eq(a4.ledger_offers, 0, "a name-only ledger offers nothing beyond the name");
eq(a4.findings.length, 0, "so no SPECIFICITY finding — that would be a demand nobody can meet");

console.log("\nthe applicant's own name is not particularity");
const selfNamed = "Mashghal Community Association will deliver the project. Mashghal Community Association is well placed.";
const a5 = properNounAudit(selfNamed, LEDGER, NAME);
eq(a5.used, 0, "repeating your own name earns no credit");
eq(a5.unsourced.length, 0, "and is never flagged as unsourced");

// ---------------------------------------------------------------------------
// REGRESSION — invariant 3, added 2026-08-27 with the fix for the attack in
// tests/adversarial/fabricated_identity_test.ts. Each block is a route by which
// an invented entity was either invisible to this audit or CREDITED by it.
// ---------------------------------------------------------------------------

console.log("\nposition in the document must not decide visibility");
const seen = (md: string, want: string) =>
  properNounAudit(md, LEDGER, NAME).unsourced.some((u) => u.toLowerCase().includes(want.toLowerCase()));

ok(seen("Volunteers are trained locally. Cedar Valley Trust supplies the curriculum.", "Cedar Valley"),
  "an invented partner opening a SENTENCE keeps its first word");
ok(seen("The curriculum is supplied by our delivery partner\nCedar Valley Trust, at no cost.", "Cedar Valley"),
  "and so does one that markdown soft-wrapped onto a new LINE");
ok(seen("| Partner | Role |\n| --- | --- |\n| Cedar Valley Trust | Curriculum |", "Cedar Valley"),
  "a TABLE ROW is read, not deleted — it is where a proposal lists its partners");
ok(seen("## Recognition: the Beirut Civic Excellence Award\n\nWe describe our record.", "Beirut Civic Excellence"),
  "a HEADING is read, not deleted — it is where a proposal announces an award");
ok(seen("The team is small. Karim Nassar coordinates the workshop timetable.", "Karim Nassar"),
  "an invented person opening a sentence is reported as the PERSON, first name included");
ok(properNounAudit("The team is small. Rana Haddad has directed the association since 2016.", LEDGER, NAME)
  .used >= 1, "while a person the ledger DOES employ is credited, not flagged");
ok(seen("\"I had no way to earn,\" said Layla, a 17-year-old participant.", "Layla"),
  "a single name INSIDE a sentence is a name, and is reported");
ok(!properNounAudit("## Governance\n\n| Field | Value |\n| --- | --- |\n| Role | Coordinator |", LEDGER, NAME)
  .unsourced.some((u) => /^(Governance|Field|Value|Role|Coordinator)$/.test(u)),
  "but a single word at a heading, a cell or a line start is furniture, and is not");

console.log("\ncontainment runs ONE WAY — the document may say no more than the ledger");
const credit = (md: string) => properNounAudit(md, LEDGER, NAME).used;
ok(credit("Referrals come from the Qobbeh Vocational Institute.") === 0,
  "an entity built out of a ledger word is NOT credited as use of that word");
ok(seen("Referrals come from the Qobbeh Vocational Institute.", "Qobbeh Vocational Institute"),
  "and it is reported as unsourced");
ok(credit("Our waste work continues with Tripoli Municipality.") >= 1,
  "naming a referent the ledger carries is still credited");
ok(credit("We work with the Municipality.") >= 1,
  "and so is naming less than the ledger says — that claims less, not more");

console.log("\nthe denominator must be real");
ok(!properNouns(LEDGER.map((e) => String(e.claim)).join("\n")).includes("Mashghal Community Association Runs"),
  "no referent is read across the boundary between two ledger items");
ok(properNounAudit("The lunch club sits in Qobbeh.", LEDGER, NAME).used >= 1,
  "a referent that follows a colon in its ledger item is still a referent");

console.log("\ndesign-object provenance: a name the pipeline authored is not unsourced");
const NEW_PROJECT = "The Progression Pathways Initiative will run three cohorts.";
ok(seen(NEW_PROJECT, "Progression Pathways"),
  "with no design object it is reported — provenance must be affirmative");
ok(properNounAudit(NEW_PROJECT, LEDGER, NAME, ["Progression Pathways Initiative"]).unsourced.length === 0,
  "with the design object that authored it, it is not");
ok(properNounAudit(NEW_PROJECT, LEDGER, NAME, ["Progression Pathways Initiative"]).used === 0,
  "and naming your own new project earns no evidence credit");
ok(properNounAudit("Delivered with the Cedar Valley Trust.", LEDGER, NAME, ["Progression Pathways Initiative"])
  .unsourced.some((u) => u.includes("Cedar Valley")),
  "a design object does not clear anything else");

console.log("\nALL PROPER-NOUN TESTS PASSED");
