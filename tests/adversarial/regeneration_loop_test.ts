// ADVERSARIAL — the regeneration loop in supabase/functions/worker/delivery_gate.ts.
//
// Target: the guards that are supposed to stop a runaway regeneration —
// materialChange() ("regenerating something near-identical and hoping for a better
// verdict is the loop's favourite failure", delivery_gate.ts:1037-1039), the per-order
// dollar cap (delivery_gate.ts:1004, 1461-1478), and the stored-verdict replay path
// (delivery_gate.ts:1300-1305).
//
// Every case below was RUN against the real functions before it was written down.
// None is hypothetical. This file therefore FAILS against current code, by
// construction, and is the specification for the fixes in
// scratchpad/qloop/unblocked/patch-regeneration-loop.md.
//
// Pure: no I/O, no model, no network. Run:
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/regeneration_loop_test.ts

import {
  materialChange, MIN_MATERIAL_CHANGE, newSpend, addSpend, loopAction,
  runDeliveryGate, JUDGE_GATE_VERSION, LOOP_LIMITS,
} from "../../supabase/functions/worker/delivery_gate.ts";
import type {
  GateInput, GateDeps, GateOutcome, LoopAttempt,
} from "../../supabase/functions/worker/delivery_gate.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

// A realistic narrative, of the kind the gate actually sees.
const DRAFT = [
  "Meadow Hill Youth Trust has worked in Bramall ward for eleven years.",
  "In 2024 we supported 180 young people into training, education or employment,",
  "of whom 112 were referred by the Youth Justice Service.",
  "The project will run for 24 months and will reach 300 participants across three sites.",
  "Our keyworkers hold a caseload of no more than 15.",
  "Outcomes are reported quarterly to the board against six agreed indicators.",
].join(" ").repeat(6);

const refused = (label: string, next: string) => {
  const r = materialChange(DRAFT, next);
  ok(!r.material,
    `${label} is not a rewrite (changed_fraction=${r.changed_fraction.toFixed(3)}, floor=${MIN_MATERIAL_CHANGE})`);
};

console.log("L1 — a padded copy is not a rewrite");
// The generator returns the previous draft VERBATIM with boilerplate appended. Not one
// word of the held document was changed, and the loop is told it was rewritten.
refused("the previous draft + 20 copies of one filler sentence",
  DRAFT + " " + "We remain committed to sustainable partnership working. ".repeat(20));

console.log("\nL2 — a copy padded with its OWN sentences is not a rewrite");
// Cheaper still: no new text at all, just the draft's own first sentence repeated.
refused("the previous draft + its own first sentence x10",
  DRAFT + " " + (DRAFT.split(". ")[0] + ". ").repeat(10));

console.log("\nL3 — an interleaved copy is not a rewrite");
// The strongest form. Every content word of the previous draft survives, in order, and
// changed_fraction reads 1.000 — a PERFECT rewrite score for a document that changed
// nothing. No n-gram measure can see this; it needs a content-retention check.
refused("the previous draft with one filler word inserted every four words",
  DRAFT.split(/\s+/).flatMap((w, i) => i % 4 === 3 ? [w, "indeed"] : [w]).join(" "));

console.log("\nL4 — a genuine rewrite must still clear the floor (the fix must not over-refuse)");
{
  const PARAPHRASE = [
    "For over a decade Meadow Hill Youth Trust has been rooted in Bramall ward.",
    "Last year 180 local teenagers moved on to a course, a job or an apprenticeship with our help;",
    "112 of them came to us through the Youth Justice Service.",
    "Over the next two years we intend to work alongside 300 participants from three bases.",
    "No member of staff carries more than fifteen cases at once,",
    "and every three months the board reviews six measures of how we are doing.",
  ].join(" ").repeat(6);
  const r = materialChange(DRAFT, PARAPHRASE);
  ok(r.material, `a real paraphrase clears the floor (changed_fraction=${r.changed_fraction.toFixed(3)})`);
}

console.log("\nL5 — the dollar cap must act on the hole it records");
{
  // addSpend() counts an unmeasured call rather than pricing it at zero, and says so:
  // "An unmeasured call is a hole in the cap, and the cap must know it has a hole."
  // loopAction() then tests `spend.usd >= cap` and never reads unmeasured_calls, so an
  // order whose provider returns no cost accounting has no cap at all. deps.judge is
  // OPTIONAL (GateDeps:205-208) and without it EVERY call is unmeasured.
  const s = newSpend();
  for (let i = 0; i < 400; i++) addSpend(s, "z-ai/glm-5.3-flash", null);
  const held: LoopAttempt = {
    doc_hash: "h", decision: "hold", cause: "judgement_unavailable",
    hold_class: "INFRA_HOLD", score: null, changed_fraction: null,
  };
  const d = loopAction([held], s);
  ok(d.action === "hold_alert",
    `400 unmeasured calls stop the loop (spend.usd=$${s.usd.toFixed(2)}, ` +
    `unmeasured_calls=${s.unmeasured_calls}, cap=$${LOOP_LIMITS.spendCapUsd}) — got "${d.action}"`);
}

console.log("\nL6 — the cap must not be overshot by a whole cycle");
{
  // The cap is tested BEFORE the next call but AFTER the current one has landed, and
  // nothing reserves the cost of the call it is about to authorise. One cent under the
  // cap authorises another full gate run and another full regeneration.
  const s = { ...newSpend(), usd: LOOP_LIMITS.spendCapUsd - 0.01 };
  const held: LoopAttempt = {
    doc_hash: "h", decision: "hold", cause: "bar_not_cleared",
    hold_class: "QUALITY_HOLD", score: 20, changed_fraction: null,
  };
  const d = loopAction([held], s);
  ok(d.action !== "regenerate",
    `$${s.usd.toFixed(2)} against a $${LOOP_LIMITS.spendCapUsd} cap does not authorise another ` +
    `unpriced generation — got "${d.action}"`);
}

console.log("\nL7 — a stored verdict from a different gate version is not a verdict");
await (async () => {
  // "The gate version is inside the hash on purpose. If the bar changes, every stored
  // verdict was reached against a different standard, and replaying it would be the one
  // way to smuggle a document past the new bar without judging it." (delivery_gate.ts:229)
  // The hash carries the version, but runDeliveryGate() never CHECKS the version on the
  // record it gets back; it trusts the store's key. A v1 record replays as a v2 verdict.
  const v1pass: GateOutcome = {
    decision: "pass", cause: null, gate_version: "delivery-gate-v1", doc_hash: "old",
    sticky: true, retryable: false, findings: [], critics: [], preflight: [],
    from_record: false, model_calls: 2,
  };
  const input = {
    narrative: "word ".repeat(400), fmt: { maxWords: null }, grantText: "g",
    applicantName: "A", applicantLine: "A",
    generatorModel: "anthropic/claude-opus-5", evidence: [],
  } as unknown as GateInput;
  const deps: GateDeps = { chat: async () => "{}", storedVerdict: async () => v1pass };
  const out = await runDeliveryGate(input, deps);
  ok(out.decision !== "pass" || out.gate_version === JUDGE_GATE_VERSION,
    `a record stamped "${v1pass.gate_version}" does not deliver under ${JUDGE_GATE_VERSION} ` +
    `— got decision="${out.decision}" gate_version="${out.gate_version}" model_calls=${out.model_calls}`);
  ok(out.decision === "pass" ? out.hold_class === null : out.hold_class != null,
    `a replayed record carries a hold class (got ${String(out.hold_class)}) rather than undefined`);
})();

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL ADVERSARIAL LOOP TESTS PASSED");
if (failures) Deno.exit(1);
