// ADVERSARIAL round 2 — invariant 3: "nothing is asserted that the Evidence
// Ledger does not carry; never manufacture provenance; never attribute another
// organisation's achievements to the applicant."
//
// Round 1 (tests/adversarial/fabricated_identity_test.ts) closed nine routes
// through the deterministic grounding auditors. It closed the SHAPES it thought
// of. This round attacks the same three auditors along shapes it did not:
//
//   1. contact_claims.ts  — the ONLY blocking guard for a fabricated contact
//      detail. Its own header records why: the Claim Ledger's
//      "donor_required_certification" class is DESIGNED to permit administrative
//      self-statements, so a fabricated phone/website has no other gate. The
//      guard anchors on a CLOSED label list and a CLOSED separator set, or on a
//      leading "+". Swap the label, swap the separator, drop the "+", or use a
//      TLD outside the closed set, and the same invented "+961 6 380 000" — the
//      failure this module exists for — walks straight through.
//
//   2. proper_nouns.ts    — the self-naming exemption (properNounAudit, the
//      `ownKeys.some(... every(w => key.has(w)))` branch) exonerates ANY
//      capitalised run whose token set is a superset of the applicant's own
//      name. A fabricated award/fund/fellowship that embeds the org name — or
//      even wraps fabricated tokens around it — is swallowed whole and never
//      reported. This re-opens the exact class round 1 closed ("position /
//      vocabulary must not decide visibility"), now keyed on the applicant's
//      own words.
//
//   3. orgNameMatchesSite  — the website identity gate. It admits a crawled site
//      on ANY single shared non-generic token, or on a distinctive applicant
//      token appearing as a bare SUBSTRING of the domain. One common English
//      word ("grace", "bright") or a coincidental substring ("arts" inside
//      "smartsdata") is treated as a confident match — and the whole of a
//      stranger's site (its history, its numbers, its partners) enters the
//      Evidence Ledger as the applicant's own. This is B1 (Amel vs Beit
//      Al-Shabab) reopened by near-match instead of by wholesale mismatch.
//
// EVERY non-CONTROL assertion below FAILS against the code as it stands. Each
// failure is a live route by which a fact no ledger item supports reaches a
// paying customer's document. CONTROL assertions pass and document the baseline.
//
// Run: npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_grounding_test.ts
// (Must run against the worker tree that carries contact_claims.ts /
//  proper_nouns.ts — i.e. the current worker, not a pre-round-1 checkout.)

import { contactAudit } from "../../supabase/functions/worker/contact_claims.ts";
import { properNounAudit } from "../../supabase/functions/worker/proper_nouns.ts";

let bad = 0;
const ok = (c: boolean, m: string) => {
  c ? console.log(`  ok   ${m}`) : (console.error(`  FAIL ${m}`), bad++);
};

// The real evidence-poor benchmark ledger. It carries an organisation name, a
// registration number, a base and a headcount. It carries NO telephone, NO
// email, NO website, NO bank detail — so any of those in a document is invented.
const LEDGER = [
  { claim: "Organisation name: Mashghal Community Association" },
  { claim: "Registration number: 1487/2019 (Lebanese Ministry of Interior ilm wa khabar), registered 2019." },
  { claim: "Website: none supplied. The applicant has no website." },
  { claim: "Base: Tripoli, Lebanon. Works in the Bab al-Tabbaneh and Qobbe neighbourhoods." },
  { claim: "Staffing: two part-time staff (a coordinator and a bookkeeper) and roughly fifteen volunteers." },
];
const ORG = "Mashghal Community Association";

// ===========================================================================
// 1. contact_claims.ts — the sole blocking guard for a fabricated contact detail
// ===========================================================================
console.log("1. a fabricated contact detail must be caught whatever its label, separator or TLD");

const fab = (md: string) => contactAudit(md, LEDGER).fabricated.length > 0;

ok(fab("- **Telephone:** +961 6 431 227"),
  "CONTROL — the labelled international shape round 1 closed is still caught");
ok(fab("- **Contact number:** 06 431 227"),
  "CONTROL — the 'Contact number' domestic shape round 1 closed is still caught");

// A domestic number the ledger has no digit run for, under a label the closed
// LABEL_ALT list does not carry. A donor form asks for a phone under a hundred
// different field names; the guard knows a dozen.
ok(fab("- **Reception:** 06 431 227"),
  "a domestic phone under an unlisted label 'Reception' is caught");
ok(fab("| Enquiries | 06 431 227 |"),
  "a domestic phone in a table cell under 'Enquiries' is caught");
ok(fab("- Head office line: 06 431 227"),
  "a domestic phone under 'Head office line' is caught");
// A listed label, but joined to its value by a WORD instead of a colon/dash/pipe.
ok(fab("Our WhatsApp is 06 431 227."),
  "a listed label ('WhatsApp') with a word separator ('is') is caught");
// No label at all, no leading '+': INTL_PHONE cannot see it and no label anchors it.
ok(fab("Call the coordinator on 06 431 227 during office hours."),
  "a bare domestic dialling number in prose is caught");

// A fabricated website. 'website'/'homepage'/'web' are NOT in LABEL_ALT, and the
// bare-host TLD set is closed (org/com/net/... — not .io/.ly/.me), so a fabricated
// domain under either gap escapes, against a ledger that says there is no website.
ok(fab("- **Website:** mashghal-project.io"),
  "a fabricated .io website under a 'Website' label is caught");
ok(fab("More detail is published at mashghal-project.io for partners."),
  "a bare fabricated .io host in prose is caught");
ok(fab("- Homepage: mashghal.ly"),
  "a fabricated .ly website under a 'Homepage' label is caught");

// ===========================================================================
// 2. proper_nouns.ts — the self-naming exemption swallows org-name-embedded fabrications
// ===========================================================================
console.log("\n2. an invented entity must be reported even when it embeds the applicant's own name");

const uns = (md: string) => properNounAudit(md, LEDGER, ORG).unsourced;
const reported = (md: string, want: string) =>
  uns(md).some((u) => u.toLowerCase().includes(want.toLowerCase()));

ok(reported("In 2023 we received the Beirut Civic Excellence Award for our work.", "Beirut Civic Excellence"),
  "CONTROL — an invented award with no org-name embedding is reported");

ok(reported("In 2023 the Mashghal Community Association Excellence Prize honoured our literacy work.", "Excellence Prize"),
  "an invented award that EMBEDS the applicant name is reported");
ok(reported("Delivery is underwritten by the Mashghal Community Association Endowment, established in 2015.", "Endowment"),
  "an invented endowment that embeds the applicant name is reported");
ok(reported("Our flagship Golden Cedar Mashghal Community Association Fellowship trains fifty teachers a year.", "Golden Cedar"),
  "fabricated tokens WRAPPED AROUND the applicant name (Golden Cedar / Fellowship) are reported");

// ===========================================================================
// 3. orgNameMatchesSite — a near-match must not import a stranger's website
// ===========================================================================
console.log("\n3. the identity gate must reject anything short of a confident match");

// The gate is not exported. Extract the three definitions from the real source
// and import them via a data: URL, so the test exercises the deployed logic and
// tracks any fix automatically. (Requires nothing beyond --allow-read.)
const idxSrc = await Deno.readTextFile(
  new URL("../../supabase/functions/worker/index.ts", import.meta.url),
);
const gStart = idxSrc.indexOf("const ORG_GENERIC_WORDS");
const gEnd = idxSrc.indexOf("\n}", idxSrc.indexOf("function orgNameMatchesSite")) + 2;
if (gStart < 0 || gEnd < 2) throw new Error("could not locate the identity gate in index.ts");
const gateSrc = idxSrc.slice(gStart, gEnd) + "\nexport { orgNameMatchesSite };\n";
const { orgNameMatchesSite } = await import(
  "data:application/typescript," + encodeURIComponent(gateSrc)
) as { orgNameMatchesSite: (o: string, s: unknown, d: string) => boolean };

const admits = (org: string, legal: string, domain: string) => orgNameMatchesSite(org, legal, domain);

ok(!admits("Beit Al-Shabab Community Association", "Amel Association International", "amel.org"),
  "CONTROL — the B1 wholesale mismatch (zero shared distinctive tokens) is rejected");

ok(!admits("Grace Kitchen", "W. R. Grace and Company", "grace.com"),
  "a single shared common word 'grace' does not admit an unrelated multinational's site");
ok(!admits("Bright Futures Youth Club", "Bright Horizons Family Solutions", "brighthorizons.com"),
  "a single shared common word 'bright' does not admit an unrelated corporation's site");
ok(!admits("Community Arts Reach", "Smarts Data Analytics Limited", "smartsdata.io"),
  "a coincidental domain substring ('arts' inside 'smartsdata') does not admit an unrelated company's site");

// SINGLE-DISTINCTIVE-TOKEN org names (Shelter, Mind, Scope, Sense, Refuge — a large
// real charity class). For a one-token want, a domain-substring test IS a bare
// includes(); it must instead require a whole-label match, and a single shared name
// token must not admit on its own.
ok(!admits("Shelter", "ShelterLogic Inc", "shelterlogic.com"),
  "single-token 'Shelter' does not admit shelterlogic.com (carports) — substring is not a match");
ok(!admits("Mind", "", "mindbodygreen.com"),
  "single-token 'Mind' does not admit mindbodygreen.com — 'mind' buried in a longer label");
ok(!admits("Scope", "Scopely Inc", "scopely.com"),
  "single-token 'Scope' does not admit scopely.com (games) — 'scope' inside 'scopely'");
ok(!admits("The Bright Foundation", "Bright Ltd", "brightltd.com"),
  "one shared common word ('bright') with an unrelated single-token legal name does not admit");
// … and the REAL single-token applicant, whose token is a whole DNS label, still admits.
ok(admits("Shelter", "Shelter", "shelter.org.uk"),
  "the real 'Shelter' at shelter.org.uk still admits (whole-label match) — the gate is asymmetric, not blind");
ok(admits("Mind", "", "mind.org.uk"),
  "the real 'Mind' at mind.org.uk still admits (whole DNS label)");

console.log(
  bad
    ? `\n${bad} FAILURE(S) — each is a live route for an unsupported fact reaching a customer`
    : "\nALL ADVERSARIAL GROUNDING TESTS PASSED",
);
if (bad) Deno.exit(1);
