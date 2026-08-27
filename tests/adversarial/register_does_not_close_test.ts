// ADVERSARIAL — invariant 4: "every number derived once through resolveRegister()".
//
// Each case below is a number that DOES NOT CLOSE and that the register, as
// committed, ACCEPTS. Every one was run against the real function before it was
// written down; none is hypothetical. This file therefore FAILS against current
// code, by construction, and is the specification for the fix in
// scratchpad/qloop/unblocked/patch-numeric-register-closure.md.
//
// Pure: no I/O, no model, no network. Run:
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/register_does_not_close_test.ts

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
const B = (kind: string, detail: string) => ({ kind, detail } as never);
// deliberate: the fix changes this parameter's type, so the call sites are cast.
const solve = (nodes: unknown, cur: string, ev: unknown, dn: unknown, opts?: unknown) =>
  (resolveRegister as unknown as (a: unknown, b: string, c: unknown, d: unknown, e?: unknown) => Map<string, Resolved>)(nodes, cur, ev, dn, opts);

console.log("A1 — the closure check is opt-in: delete `asserted` and 200-vs-216 builds");
// tests/numeric-register/numeric_register_test.ts:23-34 is this register with asserted:200.
// It throws. Remove the one field the model itself chooses to supply, and it does not.
const cohorts = [
  { id: "N1", label: "young people reached", unit: "people", unit_kind: "count", kind: "leaf", value: 120, basis: B("capacity", "4 cohorts of 30") },
  { id: "N2", label: "parents reached", unit: "people", unit_kind: "count", kind: "leaf", value: 60, basis: B("capacity", "2 parent groups of 30") },
  { id: "N3", label: "peer mentors trained", unit: "people", unit_kind: "count", kind: "leaf", value: 36, basis: B("capacity", "3 cohorts of 12") },
];
throws(() => solve([...cohorts,
  { id: "N4", label: "total direct beneficiaries", unit: "people", unit_kind: "count", kind: "sum", of: ["N1","N2","N3"], basis: B("arithmetic", "sum of the three cohorts") },
], "GBP", NONE, NONE), "derived_no_asserted",
  "a derived node must state the total it believes, so it can be contradicted");

console.log("\nA2 — `opts.frozen` is accepted and never read: the register can be revised");
const frozen = solve([
  { id: "B1", label: "venue hire", unit: "GBP", unit_kind: "money", kind: "leaf", value: 12000, basis: B("estimate", "quote from the hall") },
  { id: "B2", label: "staff costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 48000, basis: B("estimate", "0.8 FTE at band 5") },
  { id: "B9", label: "total project budget", unit: "GBP", unit_kind: "money", kind: "sum", of: ["B1","B2"], asserted: 60000, basis: B("arithmetic", "venue + staff") },
], "GBP", NONE, NONE);
throws(() => solve([
  { id: "B1", label: "venue hire", unit: "GBP", unit_kind: "money", kind: "leaf", value: 30000, basis: B("estimate", "revised quote") },
  { id: "B2", label: "staff costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 48000, basis: B("estimate", "0.8 FTE at band 5") },
  { id: "B9", label: "total project budget", unit: "GBP", unit_kind: "money", kind: "sum", of: ["B1","B2"], asserted: 78000, basis: B("arithmetic", "venue + staff") },
], "GBP", NONE, NONE, { frozen }), "register_revised",
  "a figure the design closed on cannot be changed when gen:budget extends the register");
throws(() => solve([
  { id: "B1", label: "venue hire", unit: "GBP", unit_kind: "money", kind: "leaf", value: 12000, basis: B("estimate", "quote from the hall") },
  { id: "B2", label: "staff costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 48000, basis: B("estimate", "0.8 FTE at band 5") },
], "GBP", NONE, NONE, { frozen }), "register_shrank",
  "and cannot be dropped");

console.log("\nA3 — an arbitrary six-figure total walks in through the money door");
// admissible (iii) is limited to unit_kind "count"; (iv) exempts money on the stated
// ground that money leaves are unit costs. Nothing tests that they are.
throws(() => solve([
  { id: "B1", label: "total project cost", unit: "GBP", unit_kind: "money", kind: "leaf", value: 247500, basis: B("estimate", "our costing for the period") },
], "GBP", NONE, NONE), "money_leaf_total",
  "£247,500 as a bare money leaf, decomposed into nothing and used by nothing, is inadmissible");
// This is the CONTROL, and it fails too: 47.5 is snapped to 48 at the leaf, so a
// correct £4,560 line is refused and £4,608 would be blessed. Rounding does not
// only hide a mismatch here — it manufactures one, against a legitimate budget.
let unitCostValue: number | null = null;
try {
  unitCostValue = solve([
    { id: "B1", label: "cost per session", unit: "GBP", unit_kind: "money", kind: "leaf", value: 47.5, basis: B("estimate", "hall hire plus two sessional workers") },
    { id: "N1", label: "sessions delivered", unit: "sessions", unit_kind: "count", kind: "leaf", value: 96, basis: B("capacity", "two per week for 48 weeks") },
    { id: "B2", label: "sessional delivery budget", unit: "GBP", unit_kind: "money", kind: "product", of: ["B1","N1"], asserted: 4560, basis: B("arithmetic", "unit cost x sessions") },
  ], "GBP", NONE, NONE).get("B2")!.value;
} catch (e) { console.error(`       (control rejected: ${(e as Error).message.slice(0, 90)})`); }
ok(unitCostValue === 4560, "a real unit cost of £47.50 x 96 sessions is £4,560 and is still admissible");

console.log("\nA4 — unit_kind is self-declared, and every rule in the module is keyed on it");
throws(() => solve([
  { id: "N1", label: "young people reached", unit: "people", unit_kind: "ratio", kind: "leaf", value: 1247, basis: B("estimate", "our projection for the period") },
], "GBP", NONE, NONE), "unit_kind_mismatch",
  "'people' cannot be declared a ratio to slip past the pseudo-precision rule");
throws(() => solve([
  { id: "B1", label: "software licences", unit: "USD", unit_kind: "count", kind: "leaf", value: 40, basis: B("estimate", "vendor list price") },
  { id: "B2", label: "second tranche", unit: "USD", unit_kind: "count", kind: "leaf", value: 60, basis: B("estimate", "vendor list price") },
  { id: "B3", label: "licence budget", unit: "USD", unit_kind: "count", kind: "sum", of: ["B1","B2"], asserted: 100, basis: B("arithmetic", "two tranches") },
], "GBP", NONE, NONE), "unit_kind_mismatch",
  "a currency code cannot be declared a count to walk past the currency gate");
throws(() => solve([
  { id: "N1", label: "project duration", unit: "months", unit_kind: "count", kind: "leaf", value: 24, basis: B("donor", "the funding period") },
  { id: "N2", label: "sessions per month", unit: "sessions", unit_kind: "count", kind: "leaf", value: 8, basis: B("capacity", "two per week") },
  { id: "N3", label: "sessions delivered", unit: "sessions", unit_kind: "count", kind: "product", of: ["N2","N1"], asserted: 192, basis: B("arithmetic", "sessions x months") },
], "GBP", NONE, new Set([24])), "unit_kind_mismatch",
  "'months' is a duration and must say so, even when the arithmetic happens to be right");

console.log("\nA5 — provenance: the evidence check never opens the item it names");
// A real ledger for this product is identity-only (index.ts:1298-1301): name,
// registration number, website. Every integer in it is pooled into one set.
const ledger = new Map<string, Set<number>>([
  ["E-INTAKE-1", numbersIn("Organisation name: Peckham Youth Trust")],
  ["E-INTAKE-2", numbersIn("Registration number: 1145123")],
  ["E-WEB-1", numbersIn("Founded in 1998, the Trust runs 1 centre on Rye Lane")],
]);
throws(() => solve([
  { id: "N1", label: "young people supported since 2010", unit: "people", unit_kind: "count", kind: "leaf", value: 1145123, basis: B("evidence", "E-INTAKE-1") },
], "GBP", ledger, NONE), "evidence_basis_wrong_item",
  "the registration number cannot be re-served as a service statistic under a different ledger id");
throws(() => solve([
  { id: "N1", label: "meals served", unit: "meals", unit_kind: "count", kind: "leaf", value: 1250, basis: B("evidence", "E-PROP-9") },
], "GBP", ledger, NONE), "evidence_basis_unknown_item",
  "a well-formed id for a ledger item that does not exist is not provenance");
throws(() => solve([
  { id: "N1", label: "share of leavers sustaining employment", unit: "ratio", unit_kind: "ratio", kind: "leaf", value: 0.77, basis: B("evidence", "E-WEB-1") },
], "GBP", ledger, NONE), "evidence_basis_wrong_item",
  "a ratio is not verified by rounding it to 1 and finding a stray 1 in the ledger");

console.log("\nA6 — a rate whose denominator is not the quantity its label names");
throws(() => solve([
  { id: "B1", label: "frontline delivery costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 81000, basis: B("estimate", "delivery staff and sessions") },
  { id: "B2", label: "grant requested", unit: "GBP", unit_kind: "money", kind: "leaf", value: 108000, basis: B("estimate", "the ask") },
  { id: "B3", label: "match funding", unit: "GBP", unit_kind: "money", kind: "leaf", value: 12000, basis: B("estimate", "reserves") },
  { id: "B4", label: "total project cost", unit: "GBP", unit_kind: "money", kind: "sum", of: ["B2","B3"], asserted: 120000, basis: B("arithmetic", "grant + match") },
  { id: "R1", label: "share of total project cost reaching frontline delivery", unit: "ratio", unit_kind: "ratio", kind: "rate", of: ["B1","B2"], asserted: 0.75, basis: B("arithmetic", "frontline over cost") },
], "GBP", NONE, NONE), "rate_denominator_label",
  "a rate labelled 'of total project cost' cannot be divided by the grant (75% vs the true 67.5%)");
throws(() => solve([
  { id: "B1", label: "delivery costs", unit: "GBP", unit_kind: "money", kind: "leaf", value: 90000, basis: B("estimate", "delivery staff") },
  { id: "N1", label: "participants", unit: "people", unit_kind: "count", kind: "leaf", value: 120, basis: B("capacity", "4 cohorts of 30") },
  { id: "R1", label: "proportion of spend on delivery", unit: "ratio", unit_kind: "ratio", kind: "rate", of: ["B1","N1"], asserted: 750, basis: B("arithmetic", "delivery over participants") },
], "GBP", NONE, NONE), "ratio_unit_mismatch",
  "pounds divided by people is not a proportion");

console.log("\nA7 — rounding: the register blesses a wrong total and rejects the right one");
const pence = (asserted: number) => [
  { id: "B1", label: "line one", unit: "GBP", unit_kind: "money", kind: "leaf", value: 1000.5, basis: B("estimate", "supplier quote") },
  { id: "B2", label: "line two", unit: "GBP", unit_kind: "money", kind: "leaf", value: 1000.5, basis: B("estimate", "supplier quote") },
  { id: "B3", label: "line three", unit: "GBP", unit_kind: "money", kind: "leaf", value: 1000.5, basis: B("estimate", "supplier quote") },
  { id: "B4", label: "subtotal", unit: "GBP", unit_kind: "money", kind: "sum", of: ["B1","B2","B3"], asserted, basis: B("arithmetic", "three lines") },
];
let trueTotal = false;
try { trueTotal = solve(pence(3001.5), "GBP", NONE, NONE).get("B4")!.value === 3001.5; } catch { /* rejected today */ }
ok(trueTotal, "3 x £1,000.50 resolves to £3,001.50 — money is not rounded to the pound");
throws(() => solve(pence(3003), "GBP", NONE, NONE), "closure_mismatch",
  "and £3,003, which today's per-leaf rounding produces, is refused");
throws(() => solve([
  { id: "N1", label: "attendance rate", unit: "ratio", unit_kind: "ratio", kind: "leaf", value: 0.77, basis: B("capacity", "observed attendance at the Rye Lane centre") },
  { id: "N2", label: "places offered", unit: "people", unit_kind: "count", kind: "leaf", value: 280, basis: B("capacity", "10 cohorts of 28") },
  { id: "N3", label: "people reached", unit: "people", unit_kind: "count", kind: "product", of: ["N2","N1"], asserted: 216, basis: B("arithmetic", "places x attendance") },
], "GBP", NONE, NONE), "fractional_count",
  "280 x 0.77 is 215.6 people, which is not a number of people; 216 and 215 both close today");

console.log("\nA8 — one meaning, two sources of truth");
throws(() => solve([
  { id: "N1", label: "cohort a", unit: "people", unit_kind: "count", kind: "leaf", value: 60, basis: B("capacity", "two groups of 30") },
  { id: "N2", label: "cohort b", unit: "people", unit_kind: "count", kind: "leaf", value: 60, basis: B("capacity", "two groups of 30") },
  { id: "N3", label: "total beneficiaries", unit: "people", unit_kind: "count", kind: "sum", of: ["N1","N2"], asserted: 120, basis: B("arithmetic", "a + b") },
  { id: "N4", label: "total beneficiaries", unit: "people", unit_kind: "count", kind: "leaf", value: 150, basis: B("estimate", "headline reach") },
], "GBP", NONE, NONE), "duplicate_label",
  "'the phrase the figure is written as in prose' must identify exactly one figure");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL ADVERSARIAL REGISTER TESTS PASSED");
if (failures) Deno.exit(1);
