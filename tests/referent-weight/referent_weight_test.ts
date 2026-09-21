// ============================================================================
// Tests for worker/referent_weight.ts
//
//   npx --yes deno@2.9.5 run --allow-read tests/referent-weight/referent_weight_test.ts
//
// Every excerpt below is VERBATIM from a document in the quality corpus, cited by
// file and line. The evidence-poor documents are output for `Mashghal Community
// Association`, a FICTIONAL benchmark applicant declared as such in
// qloop/case-evidence-poor.json; the ladder documents are output for `Halewater
// Commons Trust`, a synthetic fixture whose organisation, town, partners, venues,
// vendors, people and figures are all invented and are facts about nobody.
//
// Six of these cases are regressions on defects this module had in its FIRST
// calibration pass and which were found by checking its output against the
// blind critics' own referent counts, not by reading the code. They are marked
// REGRESSION and none of them may be deleted without new evidence.
// ============================================================================

import {
  referentWeight,
  refKey,
  WEIGHTS,
  type Mention,
} from "../../supabase/functions/worker/referent_weight.ts";

let failures = 0;
let checks = 0;

function ok(cond: boolean, what: string, detail = "") {
  checks++;
  if (cond) return;
  failures++;
  console.error(`FAIL  ${what}${detail ? "\n      " + detail : ""}`);
}
function eq(actual: unknown, expected: unknown, what: string) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    what,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
function group(name: string) {
  console.log(`\n— ${name}`);
}
function find(ms: Mention[], referent: string, needle: string): Mention | undefined {
  return ms.find((m) => m.referent === referent && m.sentence.includes(needle));
}

// ---------------------------------------------------------------------------
// CASE 1 — a real document: qloop/out-evidence-poor-B.md
// The document both blind critics ranked FIRST on the evidence-poor case
// (reports/quality-iteration-1.md §2; Doc 1 decodes to variant B).
// Lines 1-7, 13, 17, 31, 38, 40, 42, 62, 64, verbatim.
// ---------------------------------------------------------------------------

const EP_B = `## 1. APPLICANT IDENTIFICATION

| Field | Detail |
|---|---|
| Legal name | Mashghal Community Association |
| Registration (ilm wa khabar, Ministry of Interior) | 1487/2019, registered 2019 |
| Address | Tripoli, Lebanon; operating in Bab al-Tabbaneh and Qobbe (street address to be completed by the signatory) |

## 2. PROBLEM STATEMENT

What it lacks is a documented picture of where waste collects in Bab al-Tabbaneh and Qobbe, and a system that responds on a schedule. We are not presenting dumping counts we have not yet collected.

## 3. PROPOSED ACTIVITIES

| 5 | Sign written arrangement with the Municipality of Tripoli for lifting waste | 1-4 | Coordinator |

At month 12 the rota, bin sites and disposal arrangement pass to the Municipality of Tripoli and the named block volunteers. No future donor is assumed: continuing costs rest on local donations, the volunteer base and municipal in-kind lifting.

## 4. BENEFICIARIES AND REACH

Beneficiaries are residents of the 18 streets served by the 12 fixed collection points in Bab al-Tabbaneh and Qobbe, including shopkeepers adjacent to bin sites.

## 6. RISK AND SAFEGUARDING

- **Municipality does not lift reliably.** Written arrangement signed in months 1-4, a named monthly contact, and fallback to phased emptying at fewer points.
`;

// The referent set is the one BOTH critics named for this document, verbatim:
// "proper nouns: 3 — Bab al-Tabbaneh; Qobbe; Municipality of Tripoli".
const EP_REFERENTS = ["Bab al-Tabbaneh", "Qobbe", "Municipality of Tripoli"];

group("CASE 1 — out-evidence-poor-B.md, the top-ranked real document");
{
  const a = referentWeight(EP_B, EP_REFERENTS);

  eq(a.offered, 3, "offers the three referents the critics named");
  eq(a.present, 3, "all three appear");

  // The identification table row names two of them and must contribute nothing:
  // the donor demands an address, so supplying one is compliance, not evidence.
  const addr = a.mentions.filter((m) => m.sentence.startsWith("Tripoli, Lebanon;"));
  ok(addr.length === 2, "both neighbourhoods are found in the address row", `${addr.length}`);
  ok(addr.every((m) => m.zone === "identification" && m.weight === 0),
    "address-row mentions carry zero weight");
  ok(addr.every((m) => m.survivesSwap), "address-row mentions are never load-bearing");

  // The counterparty. Both critics' stated reason for ranking the other three
  // documents below this one was the absence of exactly this: "no municipal lift
  // agreement is signed", "no municipal counterpart".
  const sign = find(a.mentions, "Municipality of Tripoli", "Sign written arrangement");
  ok(sign !== undefined, "the workplan row naming the municipality is found");
  eq(sign?.role, "counterparty", "signing an arrangement WITH a named body is a counterparty role");
  eq(sign?.zone, "table", "…even though it sits in a table cell");
  eq(sign?.survivesSwap, false, "a commitment with an anonymous counterparty is not a commitment");
  eq(sign?.surface, "Municipality of Tripoli",
    "REGRESSION: the span is the whole name, not the bare head 'Tripoli'");

  const handover = find(a.mentions, "Municipality of Tripoli", "At month 12 the rota");
  eq(handover?.role, "counterparty", "handing the asset over to a named body is a counterparty role");
  eq(handover?.survivesSwap, false, "the handover names who receives it");

  // REGRESSION: `properNouns()` drops the first word of a run that opens a
  // sentence. Reusing it here made a subject mention invisible.
  const risk = find(a.mentions, "Municipality of Tripoli", "does not lift reliably");
  ok(risk !== undefined, "REGRESSION: a sentence-initial partial name is still found");
  eq(risk?.role, "subject", "the risk line makes the municipality the actor");
  eq(risk?.survivesSwap, false, "a subject cannot be swapped for a placeholder");

  const muni = a.perReferent.find((r) => r.referent === "Municipality of Tripoli")!;
  eq(muni.verdict, "load_bearing", "the municipality is doing work in this document");
  eq(muni.loadBearing, 3, "three of its mentions do not survive the swap");

  // The two neighbourhood names, by contrast, are named and not depended on.
  for (const n of ["Bab al-Tabbaneh", "Qobbe"]) {
    const r = a.perReferent.find((x) => x.referent === n)!;
    eq(r.loadBearing, 0, `${n}: every mention survives the swap`);
    ok(r.weight > 0, `${n}: still carries weight — it recurs across sections`);
  }
  const waste = find(a.mentions, "Bab al-Tabbaneh", "where waste collects");
  eq(waste?.role, "adjunct", "'where waste collects in X' is an adjunct");
  eq(waste?.survivesSwap, true, "and it reads the same with 'the neighbourhood' in its place");

  ok(a.findings.length === 0,
    "no finding fires: this document has a load-bearing referent",
    JSON.stringify(a.findings));
}

// ---------------------------------------------------------------------------
// CASE 2 — a real document: qloop/out-evidence-poor-A.md, lines 6 and 13.
// Both critics ranked this LAST on the evidence-poor case and both counted ONE
// referent in it. It is the negative control.
// ---------------------------------------------------------------------------

const EP_A = `## 1. APPLICANT IDENTIFICATION

- **Physical Address:** Bab al-Tabbaneh, Tripoli, North Governorate, Lebanon

## 2. PROBLEM STATEMENT

In Bab al-Tabbaneh's high-density alleyways, municipal collection trucks cannot enter, causing domestic waste to accumulate along narrow pedestrian routes. This refuse obstructs transit, attracts vermin, and poses acute public health hazards.
`;

group("CASE 2 — out-evidence-poor-A.md, the bottom-ranked real document");
{
  const a = referentWeight(EP_A, EP_REFERENTS);
  eq(a.present, 1, "the critics counted one referent here and so does this");
  eq(a.loadBearingReferents, 0, "nothing in this document depends on the name");
  eq(a.weightedMentions, 1, "one of its two mentions is the address field");

  // REGRESSION: the run matched by the capitalised-word regex is
  // "In Bab al-Tabbaneh's" — the sentence-opening "In" lands inside the name and
  // the possessive is swallowed, so the mention looked like it opened its clause
  // and the genitive was invisible.
  const gen = find(a.mentions, "Bab al-Tabbaneh", "high-density alleyways")!;
  eq(gen.surface, "Bab al-Tabbaneh", "REGRESSION: the span excludes the sentence-opening 'In'");
  eq(gen.role, "genitive", "REGRESSION: the possessive is visible");
  eq(gen.survivesSwap, true, "a genitive with no figure attached still swaps out cleanly");

  const r = a.perReferent.find((x) => x.referent === "Bab al-Tabbaneh")!;
  eq(r.verdict, "decorative", "one adjunct mention in one section is decoration");
  ok(a.findings.some((f) => f.startsWith("NO LOAD-BEARING REFERENT")),
    "the no-load-bearing finding fires", JSON.stringify(a.findings));
}

// ---------------------------------------------------------------------------
// CASE 3 — a real document: qloop/out-evidence-poor-C.md, lines 29 and 51.
// The contrast test, and the false positive it used to produce.
// ---------------------------------------------------------------------------

const EP_C = `## 3. PROPOSED ACTIVITIES

* Run two organised clean-up rounds each week across designated residential alleys and communal stairways in Bab al-Tabbaneh and Qobbe.

## 4. BENEFICIARIES AND REACH

Beneficiaries were not surveyed through a formal assessment. In Month 1, we will hold two open neighbourhood meetings (one in Bab al-Tabbaneh, one in Qobbe) to agree on exact clean-up routes and confirm study room operating hours with parents.
`;

group("CASE 3 — out-evidence-poor-C.md, contrast");
{
  const a = referentWeight(EP_C, EP_REFERENTS);

  const meetings = find(a.mentions, "Bab al-Tabbaneh", "two open neighbourhood meetings")!;
  eq(meetings.contrastive, true,
    "'one in X, one in Y' distinguishes the two places, so a shared placeholder destroys the sentence");
  eq(meetings.survivesSwap, false, "a contrastive mention is load-bearing");

  // REGRESSION: the contrast test used to run over the whole sentence and fired
  // on "each" in "each week" — a frequency, not a contrast between referents.
  const rounds = find(a.mentions, "Qobbe", "clean-up rounds each week")!;
  eq(rounds.contrastive, false, "REGRESSION: 'each week' is not a contrast");
  eq(rounds.survivesSwap, true, "so that mention stays decorative");
}

// ---------------------------------------------------------------------------
// CASE 4 — REGRESSION: a label is not a form field just because it has a colon.
// Verbatim from qloop/out-evidence-poor-D.md line 41.
// ---------------------------------------------------------------------------

const EP_D_LINE41 =
  "Direct: 12 young people out of work from Bab al-Tabbaneh and Qobbe, paid for clean-up shifts " +
  "and trained on the job. We will reserve at least six of the twelve places for young women and " +
  "will not exclude applicants with disabilities from any role.";

group("CASE 4 — out-evidence-poor-D.md line 41, the field-line guard");
{
  const a = referentWeight(`## 4. BENEFICIARIES AND REACH\n\n${EP_D_LINE41}\n`, EP_REFERENTS);
  const m = find(a.mentions, "Bab al-Tabbaneh", "12 young people out of work")!;
  eq(m.zone, "prose",
    "REGRESSION: 'Direct:' opens a paragraph; treating it as a form field zeroed the whole claim");
  ok(m.weight > 0, "so the mention carries weight");
  eq(m.load.number, true, "the sentence carries a figure");
}

// ---------------------------------------------------------------------------
// CASE 5 — REGRESSION: a demonym is not a name.
// From qloop/out-evidence-poor-A.md; the ledger of case-evidence-poor.json
// yields the referent "Lebanese Ministry of Interior" (E-INTAKE-2).
// ---------------------------------------------------------------------------

group("CASE 5 — a bare partial name in front of a lowercase noun is an adjective");
{
  const refs = ["Lebanese Ministry of Interior", "Municipality of Tripoli"];
  const doc = `## 2. PROBLEM STATEMENT

This infrastructural neglect drives localized tensions between Lebanese host residents and displaced Syrian families over shared space.

## 6. RISK AND SAFEGUARDING

- **Municipality does not lift reliably.** Written arrangement signed in months 1-4.
`;
  const a = referentWeight(doc, refs);
  eq(a.mentions.filter((m) => m.referent === "Lebanese Ministry of Interior").length, 0,
    "REGRESSION: 'Lebanese host residents' is not a mention of the Ministry of Interior");
  const muni = find(a.mentions, "Municipality of Tripoli", "does not lift reliably");
  ok(muni !== undefined,
    "…but 'Municipality does not lift' still is a mention of the Municipality of Tripoli");
  eq(muni?.role, "subject", "because an auxiliary follows it, so it heads a clause");
}

// ---------------------------------------------------------------------------
// CASE 6 — REGRESSION: a counterparty cue must govern THIS phrase.
// Verbatim from qloop/ladder/out-n09-A.md line 12.
// ---------------------------------------------------------------------------

const N09A_LINE12 =
  "Between April 2024 and March 2025, Barrowfield Youth Justice Team referred nine young people " +
  "to our provision, including six residing in Ferry Bank.";

group("CASE 6 — out-n09-A.md line 12, the counterparty cue window");
{
  const a = referentWeight(
    `## Q2. What is the problem you are addressing?\n\n${N09A_LINE12}\n`,
    ["Barrowfield Youth Justice Team", "Ferry Bank", "Marlpit"],
  );
  const yjs = find(a.mentions, "Barrowfield Youth Justice Team", "referred nine young people")!;
  eq(yjs.role, "subject", "the referring body is the subject of its sentence");
  eq(yjs.survivesSwap, false, "and cannot be replaced by 'a partner'");

  const ferry = find(a.mentions, "Ferry Bank", "residing in Ferry Bank")!;
  eq(ferry.role, "adjunct",
    "REGRESSION: 'referred' two commas earlier does not make 'residing in Ferry Bank' a counterparty");
  eq(ferry.survivesSwap, true, "so it is decorative here");
  eq(ferry.load.date, true, "the sentence is dated");
}

// ---------------------------------------------------------------------------
// CASE 7 — identity and hygiene
// ---------------------------------------------------------------------------

group("CASE 7 — identity, purity, and the shape of the result");
{
  eq([...refKey("Municipality of Tripoli")].sort(), ["municipality", "tripoli"],
    "glue words are not part of a referent's identity");
  ok(
    JSON.stringify([...refKey("Tripoli Municipality")].sort()) ===
      JSON.stringify([...refKey("Municipality of Tripoli")].sort()),
    "referent identity is order-insensitive",
  );

  const a1 = referentWeight(EP_B, EP_REFERENTS);
  const a2 = referentWeight(EP_B, EP_REFERENTS);
  eq(JSON.stringify(a1), JSON.stringify(a2), "the measure is deterministic");

  const dup = referentWeight(EP_B, ["Qobbe", "Qobbe", "Bab al-Tabbaneh", "Municipality of Tripoli"]);
  eq(dup.offered, 3, "a duplicated referent is counted once");

  const empty = referentWeight("", EP_REFERENTS);
  eq(empty.present, 0, "an empty document has no mentions");
  eq(empty.weight, 0, "…and no weight");
  eq(empty.findings, [], "…and produces no finding, because there is nothing to find");

  const none = referentWeight(EP_B, []);
  eq(none.offered, 0, "an empty referent list offers nothing");
  eq(none.weightPerOffered, 0, "and does not divide by zero");

  ok(WEIGHTS.zone.identification === 0 && WEIGHTS.zone.field === 0,
    "identification and form-field mentions are worth nothing, by construction");
  ok(WEIGHTS.role.subject > WEIGHTS.role.adjunct && WEIGHTS.role.counterparty > WEIGHTS.role.adjunct,
    "a subject and a counterparty outweigh an adjunct");
}

// ---------------------------------------------------------------------------
// CASE 8 — the calibration result itself, asserted so it cannot drift silently.
// On the ONLY blind ranking available over documents with a non-zero referent
// count (reports/quality-iteration-1.md §2, evidence-poor: B > D > C > A), total
// document weight does NOT reproduce the ranking and referent COUNT does. This
// test exists to stop anyone quietly claiming otherwise.
// ---------------------------------------------------------------------------

group("CASE 8 — the honest calibration result");
{
  const b = referentWeight(EP_B, EP_REFERENTS);
  const a = referentWeight(EP_A, EP_REFERENTS);
  ok(b.weight > a.weight, "weight does separate rank 1 from rank 4");
  eq(b.loadBearingReferents >= 1 && a.loadBearingReferents === 0, true,
    "and the load-bearing test separates them for the reason the critics gave");
  ok(
    referentWeight(EP_C, EP_REFERENTS).loadBearingReferents > 0,
    "but the rank-3 document also has a load-bearing referent — see " +
    "scratchpad qloop/unblocked/referent-weight.md: on the full four documents, " +
    "total weight orders them C > D > B > A against a true order of B > D > C > A",
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILED`);
  Deno.exit(1);
}
