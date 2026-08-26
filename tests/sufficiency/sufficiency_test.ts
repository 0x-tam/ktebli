// Tests for the pre-payment sufficiency gate.
//
//   npx deno@2.9.5 run --allow-read tests/sufficiency/sufficiency_test.ts
//
// `--allow-read` is required: one test scans the module's own source to prove
// the threshold really is in one place, which is a claim no behavioural test can
// make on its own.
//
// No network, no database, no model. The gate is deterministic by design and so
// is its test suite.

import {
  activeScorer,
  assertVerdictConsistent,
  canonicalPayload,
  countScorer,
  effectiveThreshold,
  evaluateSufficiency,
  fingerprint,
  gapLines,
  ladderVerdictNote,
  referentsIn,
  SLOTS,
  specificityScorer,
  SUFFICIENCY_THRESHOLD,
  thresholdSource,
} from "../../supabase/functions/worker/sufficiency.ts";
import type {
  Referent,
  Scorer,
  SufficiencyInput,
  Threshold,
  Verdict,
} from "../../supabase/functions/worker/sufficiency.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok  ${msg}`);
  else {
    console.error(`  FAIL ${msg}`);
    failures++;
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual);
  const e = typeof expected === "string" ? expected : JSON.stringify(expected);
  if (a === e) console.log(`  ok  ${msg}`);
  else {
    console.error(`  FAIL ${msg}\n       actual:   ${a}\n       expected: ${e}`);
    failures++;
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}
function gapCodes(v: Verdict): string[] {
  return v.gaps.map((g) => g.code).sort();
}
function gap(v: Verdict, code: string) {
  const g = v.gaps.find((x) => x.code === code);
  if (!g) throw new Error(`no gap ${code}; have ${gapCodes(v).join(", ")}`);
  return g;
}

const FUTURE = new Date("2026-08-26T12:00:00Z");

// The ledger that clears: one small charity, answering the six recall questions
// the way a fundraiser would answer them from memory.
const CLEARING: SufficiencyInput = {
  tier: "draft",
  checkoutAvailable: true,
  org: "Mashghal Community Association",
  registration: "1187734",
  website: "mashghal.org",
  email: "rana@mashghal.org",
  grant: "x".repeat(4000),
  grantAnalysisOk: true,
  grantIssuer: "The Felix Trust",
  deadline: "2026-11-30",
  answers: {
    site_place: "Bab al-Tabbaneh, Tripoli",
    site_venue: "the Old Bakehouse on Ashfield Road",
    site_activity: "a Thursday evening drop-in with hot food and a homework hour",
    last_delivery_what: "the Qobbe school-bag distribution",
    last_delivery_when: "winter 2024",
    local_trigger: "the youth centre on Syria Street closed in April",
  },
};

// Today's ledger, exactly as reports/design/ground-evidence.md section 4
// describes it: organisation name, registration number, website URL, and
// nothing else in the world.
const TODAY: SufficiencyInput = {
  tier: "draft",
  checkoutAvailable: true,
  org: "Mashghal Community Association",
  registration: "1187734",
  website: "mashghal.org",
  email: "rana@mashghal.org",
  grant: "x".repeat(4000),
  grantAnalysisOk: true,
  deadline: "2026-11-30",
  answers: {},
};

// ===========================================================================
section("1. A LEDGER THAT CLEARS");
// ===========================================================================
{
  const v = evaluateSufficiency(CLEARING, { now: FUTURE });
  ok(v.cleared, "six answered recall slots clear the gate");
  eq(v.blockers.length, 0, "no fulfilment blockers");
  eq(v.gaps.length, 0, "no gaps");
  eq(v.score, 6, "six distinct referents scored");
  eq(v.threshold, 1, "against the hard floor of 1");
  eq(v.scorer, "referent-count-v1", "the count scorer is active while the ladder is pending");

  const texts = v.referents.map((r) => r.text).sort();
  eq(
    texts,
    ["Ashfield Road", "Bab al-Tabbaneh", "Old Bakehouse", "Qobbe", "Syria Street", "Tripoli"],
    "and they are the messy local nouns the blind critics asked for",
  );

  // Invariant 3: nothing manufactures provenance. Applicant answers are
  // assertions, and they say so.
  const asks = v.ledger.filter((l) => l.id.startsWith("E-ASK-"));
  eq(asks.length, 6, "six E-ASK ledger items, one per answered slot");
  ok(asks.every((l) => l.status === "asserted"), "every E-ASK item is `asserted`, never `verified`");
  ok(
    asks.every((l) => l.assertion === "applicant_asserted" && l.source_ref === "order form (pre-payment questions)"),
    "and carries its real provenance: the customer said so, on the order form",
  );
  const intake = v.ledger.filter((l) => l.id.startsWith("E-INTAKE-"));
  eq(intake.length, 3, "the three identity items are still built exactly as the worker builds them");

  // The website is present and deliberately worth nothing.
  eq(v.detail.website_unscored, "mashghal.org", "the un-crawled website is recorded");
  ok(
    !v.referents.some((r) => r.text.toLowerCase().includes("mashghal")),
    "and contributes no referents: the crawl and the identity gate are post-payment",
  );

  // Naming yourself, or naming the donor, is not particularity.
  const selfNamer: SufficiencyInput = {
    ...CLEARING,
    answers: {
      ...CLEARING.answers,
      site_place: "Mashghal",
      site_venue: "the Felix Trust building",
      last_delivery_what: "Mashghal Community Association's work",
      local_trigger: "we needed more money",
    },
  };
  const sv = evaluateSufficiency(selfNamer, { now: FUTURE });
  ok(!sv.cleared, "an applicant who only names itself and the donor does not clear");
  ok(
    !sv.referents.some((r) => /mashghal|felix/i.test(r.text)),
    "the applicant's own name and the donor's name are both excluded from the score",
  );
}

// ===========================================================================
section("2. A LEDGER THAT DOES NOT CLEAR — today's production intake");
// ===========================================================================
{
  const v = evaluateSufficiency(TODAY, { now: FUTURE });
  ok(!v.cleared, "the intake as it ships today does NOT clear the gate");
  eq(v.score, 0, "it carries zero referents beyond the applicant's own name");
  eq(
    gapCodes(v),
    [
      "last_delivery_what_missing",
      "last_delivery_when_missing",
      "local_trigger_missing",
      "site_activity_missing",
      "site_place_missing",
      "site_venue_missing",
      "too_thin",
    ],
    "and names all six unanswered slots plus the score, not one lump",
  );
  eq(v.blockers.length, 0, "nothing is unfulfillable — the evidence is simply not there");
  eq(v.ledger.filter((l) => l.id.startsWith("E-ASK-")).length, 0, "no E-ASK items are invented");

  // Escapes are honest answers, not a way through.
  const escaped: SufficiencyInput = {
    ...TODAY,
    answers: {
      site_place: "our local area",
      site_activity: "we support people",
      local_trigger: "there is a lot of need",
    },
    venueEscape: "online",
    neverDelivered: true,
  };
  const e = evaluateSufficiency(escaped, { now: FUTURE });
  ok(!e.cleared, "taking every escape and naming nothing still refuses");
  eq(e.score, 0, "because an escape adds an honest statement, not a referent");
  const absence = e.ledger.filter((l) => l.status === "asserted").map((l) => l.claim);
  ok(
    absence.includes("The applicant states delivery happens online, not at a fixed venue."),
    "the venue escape records a stated absence rather than manufacturing a venue",
  );
  ok(
    absence.some((c) => c.startsWith("The applicant states it has not yet delivered a project.")),
    "and 'never delivered' is recorded as the fact it is",
  );
  ok(gapCodes(e).includes("site_place_unnamed"), "'our local area' is an answer with no name in it");

  // Fulfilment blockers: money must not move for an order that cannot be built.
  const dead = evaluateSufficiency({ ...CLEARING, deadline: "2026-08-01" }, { now: FUTURE });
  ok(!dead.cleared, "a passed deadline refuses even with perfect evidence");
  eq(dead.blockers[0].code, "deadline_passed", "and says which deadline");
  ok(dead.blockers[0].message.includes("2026-08-01"), "naming the date back to the customer");

  const thin = evaluateSufficiency({ ...CLEARING, grant: "help pls", grantAnalysisOk: false }, { now: FUTURE });
  eq(thin.blockers[0].code, "grant_unreadable", "an unreadable grant with 8 characters of text blocks");
  ok(thin.blockers[0].message.includes("8 characters"), "and counts the characters deterministically");

  const noTier = evaluateSufficiency({ ...CLEARING, checkoutAvailable: false }, { now: FUTURE });
  eq(noTier.blockers[0].code, "tier_unavailable", "a tier with no working checkout blocks before the form does");

  const junk = evaluateSufficiency({ ...CLEARING, org: "test" }, { now: FUTURE });
  eq(junk.blockers[0].code, "org_placeholder", "a placeholder organisation name blocks");

  // Uploads: the .pdf trap, and the B1 / Amel Association case.
  const pdf = evaluateSufficiency(
    { ...TODAY, uploads: [{ name: "Annual-Report-2024.pdf", extracted_text: null }] },
    { now: FUTURE },
  );
  ok(gapCodes(pdf).includes("upload_unreadable"), "an unparsed .pdf is scored as the nothing it is");

  const someoneElse = evaluateSufficiency(
    {
      ...TODAY,
      uploads: [{
        name: "amel-annual-report.docx",
        extracted_text:
          ("Amel Association International operates 40 centres and reached 101,581 people " +
            "across 187 sites, including a centre in Tyre operating since 1984. ").repeat(4),
      }],
    },
    { now: FUTURE },
  );
  ok(!someoneElse.cleared, "another organisation's annual report does not clear the gate");
  eq(someoneElse.score, 0, "not one of its referents is credited to this applicant");
  ok(
    gapCodes(someoneElse).includes("upload_not_attributable"),
    "the same asymmetry as orgNameMatchesSite: unattributable evidence is discarded whole",
  );

  const ours = evaluateSufficiency(
    {
      ...TODAY,
      uploads: [{
        name: "our-report.docx",
        extracted_text:
          ("Mashghal Community Association ran the Qobbe school-bag distribution from " +
            "the Old Bakehouse on Ashfield Road throughout 2024. ").repeat(4),
      }],
    },
    { now: FUTURE },
  );
  ok(ours.score > 0, "a readable document that names the applicant does contribute referents");
  ok(!ours.cleared, "though it still does not clear while six required slots are unanswered");
}

// ===========================================================================
section("3. THE EXACT GAP MESSAGE");
// ===========================================================================
{
  const v = evaluateSufficiency(TODAY, { now: FUTURE });

  // "Insufficient evidence" is a failure of this design. Prove it never appears.
  const everything = JSON.stringify(v.message) + JSON.stringify(v.gaps) + gapLines(v).join("\n");
  ok(!/insufficient/i.test(everything), "the word 'insufficient' appears nowhere");
  ok(!/\bevidence ledger\b/i.test(everything), "and no internal vocabulary leaks into the customer's copy");

  eq(
    v.message.headline,
    "We are not taking your payment yet — 7 things are missing.",
    "the headline states the refusal and the count",
  );
  ok(
    v.message.reassurance.startsWith("Your answers are saved."),
    "and the customer is told nothing has been charged",
  );

  const place = gap(v, "site_place_missing");
  eq(place.ask, "Which town, city or neighbourhood will this project work in?", "the place gap asks the real question");
  eq(
    place.why,
    "Funders fund somewhere. Without a place name the proposal can only say \"the local " +
      "community\", and reviewers read that as a template.",
    "and says exactly why it blocks",
  );
  eq(place.example, "Bab al-Tabbaneh, Tripoli — or Tower Hamlets, London.", "with a concrete example");

  const thin = gap(v, "too_thin");
  eq(
    thin.why,
    "Across everything you have given us we found 0 named things specific to you, and we need " +
      "at least 1. Every fact in your proposal has to trace back to something you told us, so " +
      "with nothing specific in hand we would be writing a document that could belong to any " +
      "organisation — and that is the document funders reject.",
    "the score gap quotes the actual score and the actual bar",
  );

  // A named-slot answer with no name in it echoes the customer's own words back.
  const vague = evaluateSufficiency(
    { ...CLEARING, answers: { ...CLEARING.answers, site_venue: "the community centre" } },
    { now: FUTURE },
  );
  const unnamed = gap(vague, "site_venue_unnamed");
  eq(unnamed.echo, "the community centre", "the customer's own words come back verbatim, in `echo`");
  ok(
    unnamed.why.endsWith("We read your answer and could not find a name in it."),
    "and the explanation says what was wrong with it",
  );
  ok(
    !unnamed.why.includes("the community centre") && !unnamed.ask.includes("the community centre"),
    "customer text stays out of `ask`/`why`, so the copy can be rendered without escaping it",
  );
  ok(
    (unnamed.escape ?? "").startsWith("If there is no fixed venue"),
    "and the honest way out is offered next to the question, not hidden",
  );

  // Every required slot can produce a message; no slot can gap without copy.
  for (const s of SLOTS) {
    const g = evaluateSufficiency({ ...TODAY }, { now: FUTURE }).gaps.find((x) => x.scope === s.id);
    ok(!!g && g.ask.length > 20 && g.why.length > 40 && g.example.length > 10, `slot ${s.id} has real copy`);
  }
}

// ===========================================================================
section("4. THE THRESHOLD IS IN ONE PLACE");
// ===========================================================================
{
  const modUrl = new URL("../../supabase/functions/worker/sufficiency.ts", import.meta.url);
  let src = "";
  try {
    src = Deno.readTextFileSync(modUrl);
  } catch (e) {
    console.error(`  FAIL cannot read the module source (run with --allow-read): ${e}`);
    failures++;
  }

  if (src) {
    // Exactly one declaration of the threshold object, and one hard floor.
    eq((src.match(/^export const SUFFICIENCY_THRESHOLD/gm) ?? []).length, 1, "SUFFICIENCY_THRESHOLD is declared once");
    eq((src.match(/hardFloor:\s*\d/g) ?? []).length, 1, "the hard floor has exactly one value in the file");
    eq((src.match(/^export function effectiveThreshold/gm) ?? []).length, 1, "effectiveThreshold is defined once");

    // Every comparison of a score against a bar takes that bar from
    // effectiveThreshold(), directly or through the verdict field it produced.
    const cmps = [...src.matchAll(/\bscore\w*\s*>=\s*([^;\n]+)/g)].map((m) => m[1].trim());
    eq(cmps.length, 2, "there are exactly two score-vs-bar comparisons in the module");
    eq(
      cmps.sort(),
      ["effectiveThreshold(t)", "v.threshold"],
      "one is effectiveThreshold(), the other re-derives from the verdict it produced",
    );
    ok(
      !cmps.some((c) => /^\d/.test(c)),
      "no score is ever compared against a bare number",
    );
  }

  // Behaviour: the provisional arm can raise the bar...
  const raised: Threshold = { hardFloor: 1, ladder: 9, ladderStatus: "count" };
  eq(effectiveThreshold(raised), 9, "a ladder answer above the floor raises the bar");
  const rv = evaluateSufficiency(CLEARING, { now: FUTURE, threshold: raised });
  ok(!rv.cleared, "and a ledger that cleared at 1 stops clearing at 9");
  eq(gap(rv, "too_thin").why.includes("we need at least 9"), true, "with the new bar quoted to the customer");

  // ...and it can never lower it. This is why it is not an escape hatch.
  for (const ladder of [0, -5, 1]) {
    const lowered: Threshold = { hardFloor: 1, ladder, ladderStatus: "count" };
    eq(effectiveThreshold(lowered), 1, `a ladder answer of ${ladder} cannot lower the bar below the hard floor`);
  }
  const zeroed = evaluateSufficiency(TODAY, {
    now: FUTURE,
    threshold: { hardFloor: 1, ladder: 0, ladderStatus: "count" },
  });
  ok(!zeroed.cleared, "an empty ledger refuses even with the provisional arm set to zero");

  // The one place also reports itself honestly.
  eq(SUFFICIENCY_THRESHOLD.ladder, null, "the shipped threshold has NO ladder value — it is not yet known");
  eq(SUFFICIENCY_THRESHOLD.ladderStatus, "pending", "and says so");
  ok(thresholdSource().startsWith("hard_floor_only(1)"), "every verdict records which arm set the bar");
  ok(
    ladderVerdictNote().includes("does not yet stop orders that are merely thin"),
    "and the module states, in the verdict, what it cannot yet know",
  );
  ok(
    ladderVerdictNote({ hardFloor: 1, ladder: null, ladderStatus: "flat" })
      .includes("This gate's scoring rule is therefore WRONG"),
    "a FLAT ladder makes the design say its own scoring rule is wrong",
  );
}

// ===========================================================================
section("5. THE SCORER IS PLUGGABLE — a count rule AND a specificity rule");
// ===========================================================================
{
  const refs = evaluateSufficiency(CLEARING, { now: FUTURE }).referents;

  // The count rule: distinct referents, nothing else.
  const c = countScorer.score(refs);
  eq(c.rule, "count", "countScorer declares a count rule");
  eq(c.value, refs.length, "and its value is the number of distinct referents");

  // The specificity rule: the same referents, weighted by what anchors them.
  const s = specificityScorer.score(refs);
  eq(s.rule, "specificity", "specificityScorer declares a specificity rule");
  ok(s.value > c.value, "an anchored ledger scores higher under specificity than under count");
  const w = (s.detail.weights as Record<string, number>);
  eq(w["Qobbe"], 1.75, "a dated prior project scores base 1 + dated 0.75");
  eq(w["Old Bakehouse"], 2, "a venue named alongside a street, with an activity, scores 1 + 0.5 + 0.5");

  // The two rules genuinely disagree — which is why the ladder has to choose.
  // Three bare referents beat one heavily anchored one on count, and lose on
  // specificity.
  const bare: Referent[] = [
    { text: "Alpha Street", key: "alpha street", slot: "site_place", anchors: [] },
    { text: "Beta Road", key: "beta road", slot: "site_place", anchors: [] },
  ];
  const anchored: Referent[] = [
    {
      text: "Delta Hall",
      key: "delta hall",
      slot: "site_venue",
      anchors: ["dated", "compound", "activity", "documented"],
    },
  ];
  ok(countScorer.score(bare).value > countScorer.score(anchored).value, "count prefers two bare names to one anchored one");
  ok(
    specificityScorer.score(anchored).value > specificityScorer.score(bare).value,
    "specificity prefers one anchored name — the rules order the same two ledgers oppositely",
  );

  // Selecting a rule changes the verdict, at one and the same bar.
  const bar4: Threshold = { hardFloor: 1, ladder: 4, ladderStatus: "count" };
  const bar4spec: Threshold = { hardFloor: 1, ladder: 4, ladderStatus: "specificity" };
  eq(activeScorer(bar4).id, "referent-count-v1", "ladderStatus 'count' selects the count scorer");
  eq(activeScorer(bar4spec).id, "referent-specificity-v1", "ladderStatus 'specificity' selects the other");
  eq(activeScorer({ hardFloor: 1, ladder: null, ladderStatus: "flat" }).id, "referent-count-v1", "a flat ladder falls back to count");

  const oneAnchored: SufficiencyInput = {
    ...CLEARING,
    answers: {
      site_place: "Tripoli",
      site_venue: "the Old Bakehouse",
      site_activity: "a Thursday evening drop-in with hot food and a homework hour",
      last_delivery_what: "the Qobbe distribution",
      last_delivery_when: "winter 2024",
      local_trigger: "the centre closed",
    },
  };
  const byCount = evaluateSufficiency(oneAnchored, { now: FUTURE, threshold: bar4 });
  const bySpec = evaluateSufficiency(oneAnchored, { now: FUTURE, threshold: bar4spec });
  eq(byCount.rule, "count", "the count run used the count rule");
  eq(bySpec.rule, "specificity", "the specificity run used the specificity rule");
  eq(byCount.score, 3, "three referents");
  ok(!byCount.cleared, "at a bar of 4, three lightly-anchored referents refuse under the count rule");
  ok(bySpec.cleared, "and the same ledger clears under the specificity rule — the choice is load-bearing");

  // An arbitrary third rule plugs in without touching the gate.
  const alwaysZero: Scorer = {
    id: "test-null-scorer",
    rule: "count",
    describe: "scores nothing, ever",
    score: (r) => ({ scorer: "test-null-scorer", rule: "count", value: 0, referents: [...r], detail: {} }),
  };
  const nulled = evaluateSufficiency(CLEARING, { now: FUTURE, scorer: alwaysZero });
  ok(!nulled.cleared, "a pluggable scorer that finds nothing refuses a ledger that otherwise clears");
  eq(nulled.scorer, "test-null-scorer", "and the verdict records which scorer decided");
}

// ===========================================================================
section("6. THE GATE CANNOT BE PASSED BY ASSERTING IT PASSED");
// ===========================================================================
{
  const v = evaluateSufficiency(TODAY, { now: FUTURE });
  const forged: Verdict = { ...v, cleared: true };
  let threw = false;
  try {
    assertVerdictConsistent(forged);
  } catch (e) {
    threw = true;
    ok(String(e).includes("claims cleared=true"), "and the error says what was forged");
  }
  ok(threw, "a verdict whose `cleared` flag disagrees with its own parts throws");

  const good = evaluateSufficiency(CLEARING, { now: FUTURE });
  assertVerdictConsistent(good);
  ok(true, "a genuine clearance re-derives cleanly");
}

// ===========================================================================
section("7. THE CHARGE IS BOUND TO WHAT WAS SCORED");
// ===========================================================================
{
  const a = canonicalPayload(CLEARING);
  const b = canonicalPayload({
    ...CLEARING,
    answers: { ...CLEARING.answers, site_venue: "  the Old Bakehouse on Ashfield Road  " },
  });
  eq(a, b, "whitespace does not change the canonical payload");

  const c = canonicalPayload({
    ...CLEARING,
    answers: { ...CLEARING.answers, site_venue: "somewhere local" },
  });
  ok(a !== c, "editing a scored answer does change it");

  const f1 = await fingerprint(CLEARING);
  const f2 = await fingerprint({ ...CLEARING, answers: { ...CLEARING.answers, site_venue: "somewhere local" } });
  eq(f1.length, 64, "the fingerprint is a SHA-256 hex digest");
  ok(f1 !== f2, "and a downgraded answer produces a different fingerprint, so the webhook can refuse it");

  ok(
    a.includes("\"grant_len\":4000") && !a.includes("xxxx"),
    "the canonical payload carries the grant's LENGTH, never its text",
  );
}

// ===========================================================================
section("8. REFERENT EXTRACTION — form fields are not sentences");
// ===========================================================================
{
  eq(referentsIn("Old Bakehouse on Ashfield Road"), ["Old Bakehouse", "Ashfield Road"], "a field that starts with a name keeps that name");
  eq(referentsIn("St Anne's Hall. Peckham."), ["St Anne's Hall", "Peckham"], "internal full stops do not eat the next name");
  eq(referentsIn("the community centre"), [], "a description with no name yields nothing");
  eq(referentsIn("we run a youth club"), [], "and neither does a sentence of pure category words");
  eq(referentsIn("Bab al-Tabbaneh, Tripoli"), ["Bab al-Tabbaneh", "Tripoli"], "a hyphenated Arabic place name stays one referent");
  eq(referentsIn(""), [], "an empty answer yields nothing");
}

console.log();
if (failures === 0) console.log("ALL SUFFICIENCY TESTS PASSED");
else console.error(`${failures} FAILURE(S)`);
Deno.exit(failures === 0 ? 0 : 1);
