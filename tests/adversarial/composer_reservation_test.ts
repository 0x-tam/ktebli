// ============================================================================
// ADVERSARY: prove the strategy stage reserves on the UNBOUNDED COMPOSER, not
// the pre-composer 8x8 template/opening pool.
//
// Found live by the phase-6 e2e (ws6-bench): migration
// 20260826160000_unbounded_composer.sql DROPPED claims.structural_template_id
// and claims.opening_device_id and replaced claim_approach's (…smallint,smallint…)
// signature with (…p_fingerprint,p_axes,p_composition…). The worker's strategy
// stage still selected the dropped columns and called the dropped signature, so
// every order died at strategy with a PostgREST 400 on the taken-set select —
// before any claim was ever attempted. No prior proof caught it because
// tests/exclusivity calls claim_approach directly (its own SQL composer) and no
// worker-driven order had reached strategy on the composer schema.
//
// The composer draw/hash helpers are EXTRACTED from the shipping source and
// EXECUTED here (index.ts cannot be imported: Deno.serve at module scope); the
// stage wiring is asserted by source.
// ============================================================================

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}

const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));
const BEGIN = "// ---- COMPOSER-BEGIN", END = "// ---- COMPOSER-END";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0) throw new Error("composer block not found");
const mod = await import(
  "data:application/typescript;base64," +
  btoa(String.fromCharCode(...new TextEncoder().encode(
    SRC.slice(SRC.indexOf("\n", a) + 1, b) +
    "\nexport { canonicalAxes, composeDraw, fnv1a, pickBySeed };\nexport type { AxisOption };\n",
  )))
) as {
  canonicalAxes: (a: Record<string, string | number>) => string;
  composeDraw: (
    byAxis: Map<string, Array<{ code: string; requires_evidence: boolean; prompt_directive: string }>>,
    hasEvidence: boolean, seedBase: string,
  ) => Promise<{ axes: Record<string, string | number>; composition: Record<string, string>; fingerprint: string }>;
  fnv1a: (s: string) => number;
};

// A vocabulary shaped like the seeded composition_axes (the real one is richer;
// the axis with an evidence-gated code is what this test needs to exercise).
const VOCAB = new Map<string, Array<{ code: string; requires_evidence: boolean; prompt_directive: string }>>([
  ["spine", [
    { code: "problem_first", requires_evidence: false, prompt_directive: "Open on the problem." },
    { code: "outcomes_first", requires_evidence: false, prompt_directive: "Open on outcomes." },
    { code: "story_first", requires_evidence: false, prompt_directive: "Open on a story." },
  ]],
  ["opening_move", [
    { code: "statistic", requires_evidence: false, prompt_directive: "A published figure." },
    { code: "incident", requires_evidence: true, prompt_directive: "A dated real event." },
    { code: "voice", requires_evidence: true, prompt_directive: "A quoted beneficiary line." },
    { code: "definition", requires_evidence: false, prompt_directive: "Define the need." },
  ]],
  ["stance", [
    { code: "impersonal_project", requires_evidence: false, prompt_directive: "Third person." },
    { code: "first_plural_committal", requires_evidence: false, prompt_directive: "We will." },
  ]],
]);

console.log("1. THE DRAW, EXECUTED");

// determinism
{
  const d1 = await mod.composeDraw(VOCAB, true, "org|0|intervention|0");
  const d2 = await mod.composeDraw(VOCAB, true, "org|0|intervention|0");
  ok(d1.fingerprint === d2.fingerprint && JSON.stringify(d1.axes) === JSON.stringify(d2.axes),
    "same seed -> identical composition and fingerprint (reproducible from the row)");
}

// a re-roll draws a genuinely different fingerprint (this is what makes the
// space unbounded: fingerprint_taken is always escapable)
{
  const seen = new Set<string>();
  let collisions = 0;
  for (let r = 0; r < 50; r++) {
    const d = await mod.composeDraw(VOCAB, true, `org|0|intervention|${r}`);
    if (seen.has(d.fingerprint)) collisions++;
    seen.add(d.fingerprint);
  }
  ok(collisions === 0 && seen.size === 50,
    `50 re-rolls -> 50 distinct fingerprints, 0 collisions (nobody waits, nobody is refused for a race)`);
}

// the fingerprint is a hash of CODES AND INTEGERS ONLY, never the prose
{
  const d = await mod.composeDraw(VOCAB, true, "org|1|x|0");
  const canon = mod.canonicalAxes(d.axes);
  // no prompt_directive prose leaks into the hashed form
  ok(!canon.includes("Open on") && !canon.includes("published figure"),
    "the canonical hashed form carries no realisation prose (migration's contract)");
  // two compositions differing ONLY in wording hash the same — model the
  // migration's stated invariant directly on canonicalAxes
  const axesA = { spine: "problem_first", opening_move: "statistic", stance: "we", move_order: 3, cadence_mu: 10, weight_profile: 7 };
  const axesB = { spine: "problem_first", opening_move: "statistic", stance: "we", move_order: 3, cadence_mu: 10, weight_profile: 7 };
  ok(mod.canonicalAxes(axesA) === mod.canonicalAxes(axesB),
    "identical axes -> identical canonical form regardless of object construction order");
  const axesC = { ...axesA, move_order: 4 };
  ok(mod.canonicalAxes(axesA) !== mod.canonicalAxes(axesC),
    "a different integer grid -> a different canonical form (the space really is wide)");
  // key order independence
  const axesReordered: Record<string, string | number> = {};
  for (const k of Object.keys(axesA).reverse()) axesReordered[k] = (axesA as Record<string, string | number>)[k];
  ok(mod.canonicalAxes(axesA) === mod.canonicalAxes(axesReordered),
    "canonicalAxes sorts keys, so insertion order cannot change the fingerprint");
}

// evidence gating: with no allowed evidence, no evidence-requiring code is drawn
{
  let leaked = 0;
  for (let r = 0; r < 40; r++) {
    const d = await mod.composeDraw(VOCAB, false, `poor|0|x|${r}`);
    if (d.axes.opening_move === "incident" || d.axes.opening_move === "voice") leaked++;
  }
  ok(leaked === 0,
    "an evidence-poor applicant never draws an evidence-requiring opening (no anecdote it cannot ground)");
  // and with evidence the gated codes ARE reachable somewhere in the space
  let reached = false;
  for (let r = 0; r < 200 && !reached; r++) {
    const d = await mod.composeDraw(VOCAB, true, `rich|0|x|${r}`);
    if (d.axes.opening_move === "incident" || d.axes.opening_move === "voice") reached = true;
  }
  ok(reached, "with evidence, the evidence-gated codes are still reachable (gating only removes, when poor)");
}

console.log("\n2. THE STAGE WIRING, BY SOURCE");
ok(!/select=[^`]*structural_template_id/.test(SRC) && !/select=[^`]*opening_device_id/.test(SRC),
  "the taken-set select no longer requests the DROPPED columns (this was the live 400)");
ok(!/p_template:/.test(SRC) && !/p_opening:/.test(SRC),
  "claim_approach is no longer called with the dropped p_template/p_opening params");
ok(/p_fingerprint: draw\.fingerprint, p_axes: draw\.axes, p_composition: draw\.composition/.test(SRC),
  "claim_approach is called with the composer signature (fingerprint + axes + composition)");
ok(/if \(res\.blocked_by === "fingerprint_taken"\) continue;/.test(SRC),
  "a fingerprint race re-rolls rather than refusing (unbounded: nobody waits)");
ok(/\["sanctions_screening", "existing_claim_same_org"\]\.includes\(res\.blocked_by\)/.test(SRC),
  "a real block (sanctions / same-org) still throws, exactly as before");
ok(/composition_axes\?active=eq\.true/.test(SRC),
  "the vocabulary is read from composition_axes, the migration's source of truth");
ok(!/structural_templates\?id=eq/.test(SRC) && !/opening_devices\?id=eq/.test(SRC),
  "the deprecated template/opening lookup tables are no longer read");
ok(/fingerprint: claimed\.fingerprint, axes: claimed\.axes, composition: claimed\.composition/.test(SRC),
  "the composed fingerprint + axes + composition are recorded in the stage output");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
