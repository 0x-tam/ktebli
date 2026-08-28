// ADVERSARIAL round 2 — invariant 4: "every number is derived once. resolveRegister()
// before writing; every figure resolves through it; recomputed at the gate and closing
// exactly, units included."
//
// Round 1 (register_does_not_close_test.ts) closed ten register-INTERNAL classes and
// is assumed shut. This file attacks what round 1 did not:
//
//   A9  — a percentage CORRECT ABOUT THE WRONG DENOMINATOR. PATCH 6 exists to catch
//         "75% of total project cost divided by the grant". Its guard is a naive
//         substring test — `norm(label).includes(norm(den.label))` — so a denominator
//         whose label is any substring of the rate's label satisfies it. Label the
//         grant "cost" (or "project cost") and 81000/108000 = 0.75 closes while the
//         register's OWN total (120000) says the honest share is 0.675. Passes today.
//
//   A10 — a ratio VERIFIED AGAINST A COLLIDING INTEGER. The ratio-as-percent evidence
//         check reads `item.has(asPercent(r.value))`, and numbersIn() does not record
//         which numbers wore a "%". A ledger item that says "11 staff" verifies a 0.11
//         ratio, because asPercent(0.11)=11 is in the pooled integer set. Passes today.
//
//   A11 — THE INVARIANT ITSELF. resolveRegister() is exported and imported by nothing.
//         The worker never calls it before writing; the design stage emits bare model
//         numbers (participants_total, budget_envelope_usd) and the only numeric gate
//         is consistencyFindings(), which is still one-directional (understatement
//         passes — the delivered 200-vs-216 direction) and whose numbersNear() is a
//         no-op `a === b`. "Every figure resolves through it" is false at the wiring.
//
// Every case was run against the real code before it was written; none is hypothetical.
// This file therefore FAILS against current code, by construction, and is the
// specification for the fix in reports/adversarial/invariant-4-numeric.md.
//
// Pure: no I/O beyond reading the worker source (invariant A11), no model, no network.
// Run from the repo root:
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_numeric_test.ts

import { resolveRegister, RegisterError, numbersIn }
  from "../../supabase/functions/worker/numeric_register.ts";
import type { Resolved } from "../../supabase/functions/worker/numeric_register.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}
function throws(fn: () => unknown, code: string, msg: string) {
  try { fn(); console.error(`  FAIL ${msg} — ACCEPTED, no throw`); failures++; }
  catch (e) {
    const c = (e as RegisterError).code;
    if (c === code) console.log(`  ok  ${msg}`);
    else { console.error(`  FAIL ${msg} — threw ${c}, wanted ${code}`); failures++; }
  }
}
const NONE = new Set<number>();
const NO_LEDGER = new Map<string, Set<number>>();
const B = (kind: string, detail: string) => ({ kind, detail } as never);
const solve = (nodes: unknown, cur: string, ev: unknown, dn: unknown, opts?: unknown) =>
  (resolveRegister as unknown as (a: unknown, b: string, c: unknown, d: unknown, e?: unknown) => Map<string, Resolved>)(nodes, cur, ev, dn, opts);

// ---------------------------------------------------------------------------
console.log("A9 — a rate right about the WRONG denominator (substring escape of PATCH 6)");
// The register holds its OWN total project cost, B4 = 120000. R1 is labelled
// "share of total project cost reaching frontline delivery" and is divided by B2,
// the grant (108000), whose label is the single word "cost". 81000/108000 = 0.75
// closes; 81000/120000 = 0.675 is the truth. numeric_register.ts:216-220 accepts it
// because "share of total project cost reaching frontline delivery".includes("cost").
throws(() => solve([
  { id: "B1", label: "frontline delivery costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 81000, basis: B("estimate", "delivery staff and sessions") },
  { id: "B2", label: "cost", unit: "GBP", unit_kind: "money", kind: "leaf", value: 108000, basis: B("estimate", "the grant we request") },
  { id: "B3", label: "match funding", unit: "GBP", unit_kind: "money", kind: "leaf", value: 12000, basis: B("estimate", "reserves") },
  { id: "B4", label: "total project cost", unit: "GBP", unit_kind: "money", kind: "sum", of: ["B2", "B3"], asserted: 120000, basis: B("arithmetic", "grant + match") },
  { id: "R1", label: "share of total project cost reaching frontline delivery", unit: "ratio", unit_kind: "ratio", kind: "rate", of: ["B1", "B2"], asserted: 0.75, basis: B("arithmetic", "frontline over cost") },
], "GBP", NO_LEDGER, NONE), "rate_denominator_label",
  "0.75 'of total project cost' divided by the grant must not close when the register's own total is 120000 (true share 0.675)");

// A9b — no true total present; denominator relabelled "project cost", a substring of
// the rate's "total project cost". This is the round-1 A6 case with one honest-looking
// relabel, and it walks straight through.
throws(() => solve([
  { id: "B1", label: "frontline delivery costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 81000, basis: B("estimate", "delivery staff") },
  { id: "B2", label: "project cost", unit: "GBP", unit_kind: "money", kind: "leaf", value: 108000, basis: B("estimate", "the grant") },
  { id: "R1", label: "frontline as a share of total project cost", unit: "ratio", unit_kind: "ratio", kind: "rate", of: ["B1", "B2"], asserted: 0.75, basis: B("arithmetic", "frontline over cost") },
], "GBP", NO_LEDGER, NONE), "rate_denominator_label",
  "a denominator labelled 'project cost' is a substring of 'total project cost' and defeats the guard");

// CONTROL — a rate that HONESTLY names its denominator must still resolve after the fix.
let honest: number | null = null;
try {
  honest = solve([
    { id: "B1", label: "delivery costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 90000, basis: B("estimate", "delivery staff") },
    { id: "N1", label: "participants", unit: "people", unit_kind: "count", kind: "leaf", value: 120, basis: B("capacity", "4 cohorts of 30") },
    { id: "R1", label: "delivery cost per participants", unit: "GBP/participants", unit_kind: "rate", kind: "rate", of: ["B1", "N1"], asserted: 750, basis: B("arithmetic", "spend over participants") },
  ], "GBP", NO_LEDGER, NONE).get("R1")!.value;
} catch (e) { console.error(`       (control rejected: ${(e as Error).message.slice(0, 90)})`); }
ok(honest === 750, "a rate that names its own denominator ('per participants') still resolves at 750 — the fix must not break it");

// ---------------------------------------------------------------------------
console.log("\nA10 — a ratio 'verified' by a colliding integer in the cited item");
// The item is cited honestly (E-WEB-1 exists and is named), but the only reason 11
// is in it is "11 staff". asPercent(0.11) = 11, so the ratio-as-percent branch at
// numeric_register.ts:318-319 treats the headcount as confirmation of the percentage.
const collide = new Map<string, Set<number>>([
  ["E-WEB-1", numbersIn("Our team of 11 staff runs 3 centres across the borough")],
]);
throws(() => solve([
  { id: "N1", label: "share of referrals converted to sustained engagement", unit: "ratio", unit_kind: "ratio", kind: "leaf", value: 0.11, basis: B("evidence", "E-WEB-1") },
], "GBP", collide, NONE), "evidence_basis_wrong_item",
  "a 0.11 ratio is not verified because the item happens to mention 11 staff; a percentage needs a percentage");

// ---------------------------------------------------------------------------
console.log("\nA11 — INVARIANT 4 at the wiring: resolveRegister() is called before writing, nothing else gates numbers");
// These read the worker source and assert the mechanism the invariant names is
// actually invoked. They FAIL today: the register is dead code relative to the pipeline.
const workerUrl = (f: string) => new URL(`../../supabase/functions/worker/${f}`, import.meta.url);
let indexSrc = "", gateSrc = "";
try { indexSrc = Deno.readTextFileSync(workerUrl("index.ts")); } catch { /* leaves indexSrc empty -> asserts fail loudly */ }
try { gateSrc = Deno.readTextFileSync(workerUrl("delivery_gate.ts")); } catch { /* optional */ }

ok(/\bresolveRegister\s*\(/.test(indexSrc) || /\bresolveRegister\s*\(/.test(gateSrc),
  "resolveRegister() is CALLED somewhere in the worker before a document is written (index.ts:2076 design stage / the gate)");
ok(/from\s+["'][^"']*numeric_register/.test(indexSrc) || /from\s+["'][^"']*numeric_register/.test(gateSrc),
  "the worker IMPORTS numeric_register.ts at all");

// The live numeric gate is consistencyFindings(); it must not be one-directional.
// A one-directional understatement-blind guard is the exact 200-vs-216 defect the
// register was built to retire, and it is still the only thing checking prose numbers.
const oneDirectional = /n\s*>\s*dn\.participants\s*\*\s*1\.01/.test(indexSrc);
const hasUnderstatementGuard = /n\s*<\s*dn\.participants\s*\*\s*0\.9/.test(indexSrc);
ok(!oneDirectional || hasUnderstatementGuard,
  "the live numeric gate catches an UNDERSTATEMENT too (n below the design total), not only overstatement");

// numbersNear() must not be a no-op. `a === b` inside `n > target*1.01 && !numbersNear(n,target)`
// can never change the outcome, so the design's declared 'nearness' tolerance is dead.
ok(!/function\s+numbersNear\s*\([^)]*\)\s*(?::\s*boolean\s*)?\{\s*return\s+a\s*===\s*b\s*;?\s*\}/.test(indexSrc),
  "numbersNear() is a real nearness test, not `return a === b` (dead inside the strict-inequality guard)");

// ===========================================================================
// RE-ATTACK 2026-08-28 (post-fix). A9/A10/A11 above are now GREEN against the
// merged register + wiring. These two cases are the round-2.5 re-attack: genuine
// residual holes in the MECHANISM (resolveRegister/admissible), still open.
// ===========================================================================

console.log("\nA12 — DONOR-branch %-provenance collision (the fix landed in (i) evidence, not (ii) donor)");
// numeric_register.ts:375 still reads `!donorNums.has(Math.round(r.value))`. The
// evidence branch (i) dropped the Math.round term (adv2 A10); the donor branch (ii)
// kept it. For a ratio, Math.round(0.75)=1, and donorNums is numbersIn() over the
// whole analysis JSON (index.ts:2313), where a stray 1 is near-universal — so a
// fabricated "the fund covers 75% of costs", attributed to the donor and stated
// nowhere in the grant, is "verified" by that 1. The fix's own comment cites 0.20,
// which rounds to 0 and hides the bug; every share >= 0.5 rounds to 1.
const donorWith1 = numbersIn("Round 1 applications for projects of up to 12 months, 40 pages");
throws(() => solve([
  { id: "R1", label: "share of project costs the fund will cover", unit: "ratio", unit_kind: "ratio", kind: "leaf", value: 0.75, basis: B("donor", "the fund covers up to three quarters") },
], "GBP", NO_LEDGER, donorWith1), "donor_basis_unverified",
  "a 0.75 donor share stated nowhere in the grant must not be verified by a stray 1 (Math.round(0.75)=1)");
// CONTROL: with no 1 in the grant, 0.29 rounds to 0 and is correctly refused — proof
// the ONLY thing admitting 0.75 above is the Math.round collision, not real provenance.
throws(() => solve([
  { id: "R1", label: "share the fund covers", unit: "ratio", unit_kind: "ratio", kind: "leaf", value: 0.29, basis: B("donor", "just under a third") },
], "GBP", NO_LEDGER, numbersIn("Grants of up to 12 months, 40 pages, 250 words per section")),
  "donor_basis_unverified",
  "control: 0.29 (rounds to 0) is refused, isolating the collision to Math.round -> 1");

console.log("\nA13 — wrong denominator via a connective-SEPARATED content qualifier");
// The revised identity match (numeric_register.ts:249-259) bounds the denominator
// token-run by connectives on both sides, so an ADJACENT content word ("total"/
// "project" before "cost") is refused. But a content qualifier separated from the
// denominator token by a connective is not: "cost" stays bounded by "of"/"of" in
// "share of cost of the whole project", while "of the whole project" reframes it as
// the total. Divides by the grant (108000); the register's own total (B4) is 120000,
// so the honest share is 0.675, and 0.75 closes anyway.
throws(() => solve([
  { id: "B1", label: "frontline delivery costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 81000, basis: B("estimate", "delivery staff") },
  { id: "B2", label: "cost", unit: "GBP", unit_kind: "money", kind: "leaf", value: 108000, basis: B("estimate", "the grant") },
  { id: "B3", label: "match funding", unit: "GBP", unit_kind: "money", kind: "leaf", value: 12000, basis: B("estimate", "reserves") },
  { id: "B4", label: "total project cost", unit: "GBP", unit_kind: "money", kind: "sum", of: ["B2", "B3"], asserted: 120000, basis: B("arithmetic", "grant + match") },
  { id: "R1", label: "share of cost of the whole project reaching frontline delivery", unit: "ratio", unit_kind: "ratio", kind: "rate", of: ["B1", "B2"], asserted: 0.75, basis: B("arithmetic", "frontline over cost") },
], "GBP", NO_LEDGER, NONE), "rate_denominator_label",
  "'share of cost of the whole project' divides by the grant while the register's own total is 120000 (true 0.675)");

// ---------------------------------------------------------------------------
console.log(failures ? `\n${failures} FAILURE(S) — invariant 4 is not upheld` : "\nALL ADV2 NUMERIC TESTS PASSED");
if (failures) Deno.exit(1);
