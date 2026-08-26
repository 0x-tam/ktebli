import { resolveRegister, RegisterError, numbersIn }
  from "../../supabase/functions/worker/numeric_register.ts";

let failures = 0;
function ok(c: boolean, msg: string) {
  if (c) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}
function throws(fn: () => unknown, code: string, msg: string) {
  try { fn(); console.error(`  FAIL ${msg} — did not throw`); failures++; }
  catch (e) {
    const c = (e as RegisterError).code;
    if (c === code) console.log(`  ok  ${msg}`);
    else { console.error(`  FAIL ${msg} — threw ${c}, wanted ${code}\n       ${(e as Error).message}`); failures++; }
  }
}
const NONE = new Set<number>();
const basis = (kind: string, detail: string) => ({ kind, detail } as never);

console.log("THE DELIVERED DEFECT: a stated 200 whose components come to 216");
// 120 young people + 60 parents + 36 peer mentors = 216. The narrative said 200.
// The old checker passed this: it never summed, and 200 > 216*1.01 is false.
const defect = [
  { id: "N1", label: "young people reached", unit: "people", unit_kind: "count", kind: "leaf",
    value: 120, basis: basis("capacity", "4 cohorts of 30 at the Peckham centre") },
  { id: "N2", label: "parents reached", unit: "people", unit_kind: "count", kind: "leaf",
    value: 60, basis: basis("capacity", "2 parent groups of 30") },
  { id: "N3", label: "peer mentors trained", unit: "people", unit_kind: "count", kind: "leaf",
    value: 36, basis: basis("capacity", "3 cohorts of 12") },
  { id: "N4", label: "total direct beneficiaries", unit: "people", unit_kind: "count", kind: "sum",
    of: ["N1", "N2", "N3"], asserted: 200, basis: basis("arithmetic", "sum of the three cohorts") },
];
throws(() => resolveRegister(defect, "GBP", NONE, NONE), "closure_mismatch",
  "the 200-vs-216 document cannot be built");
try { resolveRegister(defect, "GBP", NONE, NONE); } catch (e) {
  const m = (e as Error).message;
  ok(m.includes("216") && m.includes("200"), "the error names both figures");
  ok(m.includes("N1 + N2 + N3"), "and shows the derivation");
}

console.log("\nthe corrected register resolves");
const fixed = defect.map((n) => n.id === "N4" ? { ...n, asserted: 216 } : n);
const r = resolveRegister(fixed, "GBP", NONE, NONE);
ok(r.get("N4")!.value === 216, "the total is recomputed, not believed");
ok(r.get("N4")!.derivation === "N1 + N2 + N3 = 120 + 60 + 36", "derivation is rendered for the prose");

console.log("\na derived node may never assert its own value");
throws(() => resolveRegister(
  [{ id: "N1", label: "morning group", unit: "people", unit_kind: "count", kind: "leaf", value: 5, basis: basis("capacity", "one group of five") },
   { id: "N2", label: "evening group", unit: "people", unit_kind: "count", kind: "leaf", value: 5, basis: basis("capacity", "one group of five") },
   { id: "N3", label: "total attending", unit: "people", unit_kind: "count", kind: "sum", of: ["N1","N2"], value: 99,
     basis: basis("arithmetic", "the two groups") }], "GBP", NONE, NONE),
  "derived_has_value", "a sum cannot carry its own value");

console.log("\narbitrary targets and pseudo-precision cannot enter");
throws(() => resolveRegister(
  [{ id: "N1", label: "people reached", unit: "people", unit_kind: "count", kind: "leaf",
     value: 1250, basis: basis("estimate", "our projection for the period") }], "GBP", NONE, NONE),
  "pseudo_precision", "1,250 as a bare planning estimate is inadmissible");
const round = resolveRegister(
  [{ id: "N1", label: "people reached", unit: "people", unit_kind: "count", kind: "leaf",
     value: 1200, basis: basis("estimate", "planning assumption for the period") }], "GBP", NONE, NONE);
ok(round.get("N1")!.value === 1200, "a two-significant-figure estimate is allowed — it does not pretend");
throws(() => resolveRegister(
  [{ id: "N1", label: "people reached", unit: "people", unit_kind: "count", kind: "leaf", value: 40,
     basis: basis("estimate", "") }], "GBP", NONE, NONE),
  "empty_basis", "a figure with a blank derivation is rejected");

console.log("\nevidence and donor attributions must be real");
throws(() => resolveRegister(
  [{ id: "N1", label: "households served in 2024", unit: "households", unit_kind: "count", kind: "leaf",
     value: 1250, basis: basis("evidence", "E-WEB-7") }], "GBP", NONE, NONE),
  "evidence_basis_unverified", "a figure attributed to the ledger must appear in the ledger");
const cited = resolveRegister(
  [{ id: "N1", label: "households served in 2024", unit: "households", unit_kind: "count", kind: "leaf",
     value: 1250, basis: basis("evidence", "E-WEB-7") }], "GBP", new Set([1250]), NONE);
ok(cited.get("N1")!.value === 1250, "and is accepted when it does");
throws(() => resolveRegister(
  [{ id: "N1", label: "people reached last year", unit: "people", unit_kind: "count", kind: "leaf", value: 40,
     basis: basis("evidence", "our website") }], "GBP", new Set([40]), NONE),
  "evidence_basis_malformed", "the basis must be a ledger id, not a description");

console.log("\nstructural integrity");
throws(() => resolveRegister(
  [{ id: "N1", label: "first total", unit: "people", unit_kind: "count", kind: "sum", of: ["N2","N3"], basis: basis("arithmetic","a sum") },
   { id: "N2", label: "second total", unit: "people", unit_kind: "count", kind: "sum", of: ["N1","N3"], basis: basis("arithmetic","a sum") },
   { id: "N3", label: "one cohort", unit: "people", unit_kind: "count", kind: "leaf", value: 1, basis: basis("capacity","a single cohort") }],
  "GBP", NONE, NONE), "cycle", "a cycle is caught, not looped on");
throws(() => resolveRegister(
  [{ id: "N1", label: "grand total", unit: "people", unit_kind: "count", kind: "sum", of: ["N2","N9"], basis: basis("arithmetic","a sum") },
   { id: "N2", label: "one cohort", unit: "people", unit_kind: "count", kind: "leaf", value: 1, basis: basis("capacity","a single cohort") }],
  "GBP", NONE, NONE), "dangling_ref", "a reference to an undeclared figure is caught");
throws(() => resolveRegister(
  [{ id: "N1", label: "people attending", unit: "people", unit_kind: "count", kind: "leaf", value: 10, basis: basis("capacity","one group of ten") },
   { id: "N2", label: "project duration", unit: "months", unit_kind: "duration", kind: "leaf", value: 12, basis: basis("estimate","one funding year") },
   { id: "N3", label: "nonsense total", unit: "people", unit_kind: "count", kind: "sum", of: ["N1","N2"], basis: basis("arithmetic","adding people to months") }],
  "GBP", NONE, NONE), "sum_unit_mismatch", "people and months cannot be added");
throws(() => resolveRegister(
  [{ id: "B1", label: "cost per session", unit: "USD", unit_kind: "money", kind: "leaf", value: 40, basis: basis("estimate","supplier quote") }],
  "GBP", NONE, NONE), "currency_mismatch", "a USD line in a GBP proposal is rejected");
throws(() => resolveRegister([], "GBP", NONE, NONE), "register_missing", "an empty register is rejected");

console.log("\nnumbersIn");
ok(numbersIn("assisted 1,250 individuals in 2024").has(1250), "commas are handled");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL NUMERIC-REGISTER TESTS PASSED");
if (failures) Deno.exit(1);
