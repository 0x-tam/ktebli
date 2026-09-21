// Tests for intake_answers -> Evidence Ledger (E-INTAKE-4+).
//
//   npx deno@2.9.5 run tests/intake-ledger/intake_ledger_test.ts
//
// No network, no database, no model. The mapping is pure and deterministic, and
// its whole job is to make the customer's structured answers GROUND the
// narrative — so the decisive test runs the real proper-noun audit over the real
// mapping and proves the names come back sourced. This is the wiring KT-10001
// was missing: without it the audit flags the DSL, the programmes and the venue
// as unsourced and grounding holds the order.

import { intakeAnswerLedger } from "../../supabase/functions/worker/intake_ledger.ts";
import { properNounAudit } from "../../supabase/functions/worker/proper_nouns.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok  ${msg}`);
  else {
    console.error(`  FAIL ${msg}`);
    failures++;
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ok  ${msg}`);
  else {
    console.error(`  FAIL ${msg}\n       actual:   ${a}\n       expected: ${e}`);
    failures++;
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

// The shape stripe-webhook assembles into orders.intake_answers: the six slots +
// escapes, the admin certifications, and the named org facts. Modelled on the
// exact facts KT-10001's grounding check found missing (reports/phase8-intake.md).
const ANSWERS = {
  site_place: "Harlesden, Brent",
  site_venue: "the New Horizons Centre on Hazel Road",
  site_activity: "a weekly asylum-support drop-in with hot food and casework",
  last_delivery_what: "the OpenARMS winter appeal",
  last_delivery_when: "winter 2024",
  local_trigger: "the council closed the Stonebridge advice service in April",
  venue_escape: null,
  never_delivered: false,
  legal_form: "Charitable Incorporated Organisation",
  annual_income: "£240,000",
  income_band: "£100,000–£500,000",
  accounts_period: "year ending 31 March 2025",
  safeguarding_policy: true,
  bank_account_own_name: true,
  public_liability_insurance: true,
  board_independent: true,
  no_conflicting_grant: true,
  safeguarding_lead_name: "Amina Yusuf",
  safeguarding_lead_role: "Deputy Chair",
  safeguarding_lead_training: "Level 3 safeguarding",
  lived_experience_governance: "three trustees are former service users",
  key_people: [
    { name: "Grace Mbeki", role: "Chair" },
    { name: "Daniel Okoro", role: "OpenARMS coordinator" },
  ],
  programmes: [
    { name: "OpenARMS", what: "asylum-seeker support and casework" },
    { name: "the Advice Service", what: "benefits, housing, debt and income maximisation" },
  ],
  results: [
    { what: "people supported through the Advice Service", when: "2024", figure: "412" },
  ],
  partnerships: ["Brent Citizens Advice"],
  extra_links: ["https://example.org/annual-report"],
};

// ===========================================================================
section("1. EVERY NON-EMPTY FIELD BECOMES A VERIFIED, ALLOWED E-INTAKE ITEM");
// ===========================================================================
{
  const items = intakeAnswerLedger(ANSWERS, { startAt: 3, haveRegistration: true });
  ok(items.length > 0, "the interview produces ledger items");
  ok(items.every((i) => i.status === "verified" && i.allowed === true), "every item is verified and allowed");
  ok(
    items.every((i) => i.source_type === "user_intake" && i.source_ref === "evidence interview"),
    "and carries its real provenance: the evidence interview",
  );
  ok(items[0].id === "E-INTAKE-4", "numbering continues after the three identity items (starts at E-INTAKE-4)");
  const ids = items.map((i) => i.id);
  eq(ids.length, new Set(ids).size, "ids are unique");

  const claims = items.map((i) => i.claim);
  const has = (frag: string) => claims.some((c) => c.includes(frag));
  ok(has("Designated Safeguarding Lead: Amina Yusuf, Deputy Chair, Level 3 safeguarding"), "the DSL is one item, name + role + training");
  ok(has("Programme: OpenARMS — asylum-seeker support and casework"), "a named programme with its scope");
  ok(has("Key person: Grace Mbeki — Chair"), "a named key person with role");
  ok(has("Delivery venue: the New Horizons Centre on Hazel Road"), "the named venue");
  ok(has("412 people supported through the Advice Service (2024)"), "a dated result as <figure> <what> (<when>)");
  ok(has("The organisation has a safeguarding policy in place."), "the safeguarding-policy certification");
  ok(has("The organisation holds Public Liability Insurance."), "the PLI certification");
  ok(has("Partnership: Brent Citizens Advice"), "a named partnership");
  ok(has("Annual income band: £100,000–£500,000"), "the income band");
  ok(has("Most recent delivery: the OpenARMS winter appeal (winter 2024)"), "the dated last delivery");
}

// ===========================================================================
section("2. BLANKS AND FALSE CERTIFICATIONS CONTRIBUTE NOTHING (invariant 3)");
// ===========================================================================
{
  const items = intakeAnswerLedger({
    site_place: "Leeds",
    safeguarding_policy: false, // not ticked -> asserts nothing
    public_liability_insurance: false,
    legal_form: "", // blank -> nothing
    key_people: [{ name: "", role: "Chair" }], // no name -> nothing
    programmes: [], // empty
    partnerships: ["", "  "], // whitespace -> nothing
  }, { startAt: 3 });
  const claims = items.map((i) => i.claim);
  eq(claims, ["Project location: Leeds"], "only the one real answer is emitted; nothing is defaulted or invented");
  ok(!claims.some((c) => /safeguarding|insurance|Chair/i.test(c)), "a false certification and a nameless person add nothing");
}

// ===========================================================================
section("3. REGISTRATION IS NOT DUPLICATED WHEN IDENTITY ALREADY CARRIES IT");
// ===========================================================================
{
  const withId = intakeAnswerLedger({ registration_number: "1187734" }, { startAt: 3, haveRegistration: true });
  eq(withId.length, 0, "haveRegistration=true suppresses the registration item (E-INTAKE-2 already has it)");

  const noId = intakeAnswerLedger({ registration_number: "1187734" }, { startAt: 3, haveRegistration: false });
  eq(noId.map((i) => i.claim), ["Registration number: 1187734"], "but it is emitted when identity did not build E-INTAKE-2");
}

// ===========================================================================
section("4. THE VENUE ESCAPE IS A STATED ABSENCE, NOT A MANUFACTURED VENUE");
// ===========================================================================
{
  const items = intakeAnswerLedger({ venue_escape: "street", never_delivered: true }, { startAt: 3 });
  const claims = items.map((i) => i.claim);
  ok(claims.includes("Delivery is street-based outreach, not at a fixed venue."), "the venue escape records a stated absence");
  ok(claims.some((c) => c.startsWith("The organisation has not yet delivered a project")), "'never delivered' is recorded as the fact it is");
  ok(!claims.some((c) => c.startsWith("Delivery venue:")), "and no venue is invented");
}

// ===========================================================================
section("5. THE DECISIVE PROOF: THE MAPPED LEDGER GROUNDS THE NARRATIVE");
// ===========================================================================
{
  // The org identity items the worker builds (E-INTAKE-1/2/3) ...
  const identity = [
    { id: "E-INTAKE-1", claim: "Organisation name: New Beginnings Brent", status: "verified", allowed: true },
    { id: "E-INTAKE-2", claim: "Registration number: 1187734", status: "verified", allowed: true },
    { id: "E-INTAKE-3", claim: "Website: newbeginningsbrent.org", status: "verified", allowed: true },
  ];
  // ... plus the E-INTAKE-4+ items this module builds from the interview.
  const ledger = [
    ...identity,
    ...intakeAnswerLedger(ANSWERS, { startAt: 3, haveRegistration: true }),
  ] as Array<Record<string, unknown>>;

  // A narrative that names exactly the facts the customer gave — the names that
  // read as unsourced on the three-item ledger (KT-10001).
  const narrative =
    "New Beginnings Brent runs its weekly drop-in from the New Horizons Centre on Hazel Road in " +
    "Harlesden. Its OpenARMS programme and the Advice Service supported 412 people in 2024. " +
    "Amina Yusuf, the Deputy Chair, is the Designated Safeguarding Lead, and Grace Mbeki chairs " +
    "the board. We work in partnership with Brent Citizens Advice.";

  const audit = properNounAudit(narrative, ledger, "New Beginnings Brent");
  ok(
    !audit.unsourced.includes("New Horizons Centre"),
    "the named venue is ledger-backed by the interview (was unsourced on the 3-item ledger)",
  );
  ok(!audit.unsourced.includes("OpenARMS"), "the named programme is ledger-backed");
  ok(!audit.unsourced.includes("Amina Yusuf"), "the named safeguarding lead is ledger-backed");
  ok(!audit.unsourced.includes("Grace Mbeki"), "the named chair is ledger-backed");
  ok(!audit.unsourced.some((u) => /Brent Citizens Advice|Advice Service|Hazel Road|Harlesden/.test(u)), "and so are the partner, service, street and place");
  eq(audit.unsourced, [], "NOTHING in the narrative is unsourced — grounding would pass, not hold");

  // Control: without the interview items, the SAME narrative is riddled with
  // unsourced nouns — which is exactly the KT-10001 failure this fixes.
  const starved = properNounAudit(narrative, identity as Array<Record<string, unknown>>, "New Beginnings Brent");
  ok(starved.unsourced.length >= 4, `the 3-item ledger leaves ${starved.unsourced.length} names unsourced (the starvation the fix removes)`);
}

console.log();
if (failures === 0) console.log("ALL INTAKE-LEDGER TESTS PASSED");
else console.error(`${failures} FAILURE(S)`);
Deno.exit(failures === 0 ? 0 : 1);
