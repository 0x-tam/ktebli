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

console.log("\nALL PROPER-NOUN TESTS PASSED");
