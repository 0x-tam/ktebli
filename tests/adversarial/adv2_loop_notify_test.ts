// ADVERSARIAL round 2 — the regeneration loop's MATERIAL-CHANGE floor in
// supabase/functions/worker/delivery_gate.ts.
//
// Loop rule under attack: "material diff required between attempts"
// (reports/phase3-gate.md §"Loop limits in code": "Material diff required
// (materialChange between consecutive attempts)").
//
// THE SEAM. materialChange() returns FOUR fields:
//     { changed_fraction, retention, identical, material }
// and it computes `material` from BOTH a 5-gram measure (changed_fraction) AND
// an insertion-robust word-retention measure (retention <= MAX_CONTENT_RETENTION).
// The author added `retention` on purpose, and says why in delivery_gate.ts:1102:
//   "Word-5-grams cannot see the strongest form of the non-rewrite: insert one
//    filler word every four words and every 5-gram breaks while every content
//    word survives in order, which scores 0.990 on the shingle measure.
//    Retention is insertion-robust."
//
// BUT the loop never reads `material` or `retention`. runGateLoop() (line 1880)
// keeps ONLY the scalar:
//     changed = materialChange(previous, narrative).changed_fraction;
// and loopAction() (line 1622) refuses a regeneration only when
//     last.changed_fraction < limits.minMaterialChange
// The robust verdict materialChange() computed is thrown away. So a "regeneration"
// that keeps 100% of the previous document's words and inserts filler between them
// reports changed_fraction ~= 0.99 (WELL above the 0.20 floor) with retention 1.000,
// and the loop accepts it as a material rewrite.
//
// WHY ROUND 1 DID NOT CATCH THIS. tests/adversarial/regeneration_loop_test.ts L1-L3
// assert `!materialChange(...).material` — they test the FUNCTION, which is correct.
// tests/delivery-gate/delivery_gate_test.ts "a document that did not materially
// change stops the loop" feeds loopAction a SYNTHETIC changed_fraction of 0.03 —
// a LOW number the loop does refuse. No test ever derives a REAL changed_fraction
// from a padded document and pushes it THROUGH the loop. This file crosses that
// seam: it takes the padded document round 1 proved non-material, and drives
// loopAction() and runGateLoop() with it.
//
// Every case was RUN against the real functions before it was written down. This
// file FAILS against current code, by construction, and is the specification for
// the fix (see reports/adversarial/invariant-8-loop-and-notify.md).
//
// Pure: no I/O, no model, no network. Run:
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_loop_notify_test.ts

import {
  materialChange, MIN_MATERIAL_CHANGE, MAX_CONTENT_RETENTION,
  newSpend, loopAction, runGateLoop,
  LOOP_LIMITS, JUDGE_GATE_VERSION,
  DIMENSIONS, CRITIC_DISQUALIFIERS,
} from "../../supabase/functions/worker/delivery_gate.ts";
import type {
  GateInput, GateDeps, LoopAttempt, JudgeReply, CriticRequest, GateLoopHooks,
} from "../../supabase/functions/worker/delivery_gate.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok   ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

// A realistic narrative, of the kind the gate actually sees. ~480 words, so it
// clears preflight's floor and carries no placeholder text.
const BASE = [
  "Meadow Hill Youth Trust has worked in Bramall ward for eleven years.",
  "In 2024 we supported 180 young people into training, education or employment,",
  "of whom 112 were referred by the Youth Justice Service.",
  "The project will run for 24 months and will reach 300 participants across three sites.",
  "Our keyworkers hold a caseload of no more than 15.",
  "Outcomes are reported quarterly to the board against six agreed indicators.",
].join(" ");
const DRAFT = (BASE + " ").repeat(8).trim();

// The interleave attack: insert one filler word after every fourth word. Every
// content word of the input survives, in order; only 5-grams are disturbed.
// This is round 1's L3 document, the one it proved has material === false.
function pad(md: string): string {
  return md.split(/\s+/).flatMap((w, i) => (i % 4 === 3 ? [w, "indeed"] : [w])).join(" ");
}

// A QUALITY hold attempt, as the loop records it.
function q(over: Partial<LoopAttempt>): LoopAttempt {
  return {
    doc_hash: "h", decision: "hold", cause: "bar_not_cleared",
    hold_class: "QUALITY_HOLD", score: 30, changed_fraction: null, ...over,
  };
}

// ===========================================================================
console.log("A1 — the function is right: a padded copy is NOT a material rewrite");
const PADDED = pad(DRAFT);
const mc = materialChange(DRAFT, PADDED);
// These two PASS — they establish the ground truth the loop is about to ignore.
ok(mc.material === false,
  `materialChange says non-material: retention=${mc.retention.toFixed(3)} > ${MAX_CONTENT_RETENTION} ` +
  `(every original word survives)`);
ok(mc.changed_fraction >= MIN_MATERIAL_CHANGE,
  `yet its changed_fraction is ${mc.changed_fraction.toFixed(3)}, above the ${MIN_MATERIAL_CHANGE} floor — ` +
  `this is the scalar the loop keeps and the verdict it drops`);

// ===========================================================================
console.log("\nA2 — loopAction accepts the padded regeneration as material (the break)");
{
  // Attempt 1: the original draft, held on the merits. Attempt 2: the PADDED copy,
  // held on the merits, with the REAL changed_fraction the loop would compute for
  // it (materialChange(prev,next).changed_fraction) and an improving score, so the
  // score-divergence guard cannot mask the material-change question.
  const attempts: LoopAttempt[] = [
    q({ score: 30, changed_fraction: null }),
    q({ score: 40, changed_fraction: mc.changed_fraction }),
  ];
  const d = loopAction(attempts, newSpend());
  console.log(`       loopAction decided: action=${d.action} event=${d.event}`);
  // SAFE expectation (the fix): a regeneration that retained 100% of the previous
  // document's words is not a rewrite and must be refused with the loop's own
  // no-material-change outcome. FAILS today: the loop returns "regenerate".
  ok(d.action === "refund" && d.event === "gate.no_material_change",
    `a content-identical (retention 1.000) regeneration must stop the loop as no_material_change, ` +
    `not be spent as a real attempt — got action="${d.action}" event="${d.event}"`);
}

// ===========================================================================
console.log("\nA3 — end-to-end: runGateLoop spends its WHOLE budget on padded copies");
await (async () => {
  // A judge that always fails the bar (specificity 2 < floor 3) with a strictly
  // improving score, so the loop keeps going for exactly one reason: it believes
  // each padded copy is a material rewrite worth re-judging.
  let judgeCalls = 0;
  const verdict = (n: number) => {
    const scores: Record<string, number> = {};
    for (const dim of DIMENSIONS) {
      scores[dim.key] =
        dim.key === "specificity" ? 2 :                       // the one failing dimension
        dim.key === "persuasiveness" ? Math.min(5, 3 + n) :   // rises each call -> score improves
        dim.weighted ? 4 : 3;
    }
    const disq: Record<string, boolean> = {};
    for (const dq of CRITIC_DISQUALIFIERS) disq[dq.key] = false;
    return JSON.stringify({
      scores, disqualifiers: disq, verdict: "fails_bar",
      reasons: ["specificity is thin"], weakest_thing: "the specificity is thin", fix_instructions: [],
    });
  };
  const judge = async (_req: CriticRequest): Promise<JudgeReply> => {
    const n = judgeCalls++;
    return { text: verdict(n), usd: 0.01 };   // priced, tiny — the spend cap never fires
  };

  const spend = newSpend();
  const deps: GateDeps = { chat: async () => "{}", judge, spend };
  const input: GateInput = {
    narrative: DRAFT,
    applicantName: "Meadow Hill Youth Trust",
    applicantLine: "Meadow Hill Youth Trust",
    grantText: "A youth opportunities fund.",
    fmt: { maxWords: null },
    evidence: [],                              // no ledger referents -> preflight D4 cannot fire
    generatorModel: "anthropic/claude-opus-5",
  };
  // Every regeneration returns the previous document PADDED — no content changes,
  // ever. A loop that honoured retention would refuse the first one.
  let regens = 0;
  const hooks: GateLoopHooks = {
    regenerate: async (_brief, previous) => { regens++; return pad(previous); },
  };

  const result = await runGateLoop(input, deps, hooks);
  console.log(
    `       runGateLoop: regenerations=${result.regenerations}, judge_calls=${judgeCalls}, ` +
    `final action=${result.decision.action}, event=${result.decision.event}, ` +
    `spend=$${result.spend.usd.toFixed(2)}`);

  // Sanity (PASSES): the padded regenerations really were non-material.
  ok(materialChange(DRAFT, pad(DRAFT)).material === false && regens >= 1,
    `regeneration produced a content-identical document (materialChange.material === false)`);

  // SAFE expectation (the fix): the loop must halt at the FIRST padded regeneration
  // with no_material_change, having spent at most one extra judge call — never run
  // the full two-regeneration budget on documents whose content never changed.
  // FAILS today: regenerations === 2, event gate.regeneration_budget_exhausted.
  ok(result.regenerations <= 1 && result.decision.event === "gate.no_material_change",
    `the loop must stop on the first non-material regeneration — got regenerations=${result.regenerations}, ` +
    `event="${result.decision.event}" (it re-judged padded copies ${judgeCalls} times)`);
})();

// ===========================================================================
// CONTROL — the loop is not wholly broken; it does catch a LOW changed_fraction.
// This PASSES and is here to show the defect is specifically the insertion seam,
// not the floor in general.
console.log("\nA4 — control: a low-changed_fraction edit is still correctly refused");
{
  const d = loopAction([q({ score: 30, changed_fraction: null }), q({ score: 40, changed_fraction: 0.03 })], newSpend());
  ok(d.action === "refund" && d.event === "gate.no_material_change",
    `a 3% edit is refused as before (the fix must preserve this) — action="${d.action}"`);
}

console.log(
  `\nJUDGE_GATE_VERSION under test: ${JUDGE_GATE_VERSION}; ` +
  `regeneration budget: ${LOOP_LIMITS.maxRegenerations}.`);
console.log(failures ? `\n${failures} FAILURE(S) — loop material-change floor is DEFEATED by padding` : "\nALL PASSED");
if (failures) Deno.exit(1);
