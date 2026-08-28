// ============================================================================
// ADVERSARY — INVARIANT 6: "no two proposals to one grant share style, shape or
// form, and nobody ever waits." Round 2, on the freshly-rewired composer
// (worker/index.ts COMPOSER-BEGIN..END; migration 20260826160000; rewire commit
// bfa6b4a).
//
// THE CLAIM UNDER ATTACK (migration header + phase6-eng §11 + composer_reservation
// _test.ts): the lock moved "from a row id to a fingerprint of a composition drawn
// across twelve independent axes", the space is "astronomically larger than any
// grant's applicant count", so every applicant is served with a DISTINCT house
// style and nobody waits.
//
// WHAT THIS TEST PROVES INSTEAD: the fingerprint is hashed over ELEVEN axes, but
// only TWO of them (spine, opening_move) are ever fed to the writer. The other
// nine — paragraph_regime, stance, evidence_integration, argument_carrier,
// closing_move, tabular_policy, and the three integer grids move_order/cadence_mu/
// weight_profile — are hashed and then dropped on the floor: they appear in NO
// generation prompt. So "distinct fingerprint" does NOT imply "distinct writing".
// The reader-visible style space is a FINITE POOL of |spine| x |opening_move|
// = 13 x 14 = 182 combinations, however large the fingerprint space is.
//
// Consequence, proven below with the SHIPPED composeDraw and the REAL vocabulary
// parsed from the migrations:
//   * every applicant is still SERVED (all fingerprints distinct) — the "nobody
//     waits" half holds, which is exactly what hides the defect; and
//   * from ~17 applicants on one grant, two draw the SAME (spine, opening_move)
//     and therefore the SAME template_style + opening_style — the only bytes the
//     generator ever receives — while carrying DISTINCT fingerprints. Two
//     proposals a reader attributes to one writer, both served.
//   * for N > 182 it is a pigeonhole certainty; distinct visible styles saturate
//     at 182 no matter how many applicants arrive.
//
// This is uniqueness that is NOMINAL (distinct hash) and not REAL (distinct
// reading). The end-to-end confirmation through claim_approach() on a replayed
// Postgres — two distinct orgs on one grant, BOTH granted, sharing spine +
// opening_move — is in reports/adversarial/invariant-6-exclusivity.md; this file
// proves the break from the shipped module + schema alone, under --allow-read.
//
// Kept in the suite permanently. It FAILS (exit 1) while two served applicants can
// share a reader-visible style, and turns green only when the composer's
// reader-visible style space is as wide as the fingerprint it locks on.
// ============================================================================

// Three verdicts, kept apart on purpose:
//   note()  — evidence, never gates (a proper fix WILL flip some of these).
//   guard() — the test's own ability to reason; a trip means "cannot verify,
//             re-derive against a fresh replay", not "invariant holds".
//   broken  — the invariant predicate itself; the only reason to exit 1.
let setupFail = 0;
function note(cond: boolean, msg: string) { console.log(`   ${cond ? "•" : "·"}  ${msg}`); }
function guard(cond: boolean, msg: string) { console.log(`  ${cond ? "ok  " : "DRIFT"}  ${msg}`); if (!cond) setupFail++; }

const HERE = new URL(".", import.meta.url);
const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", HERE));

// ---------------------------------------------------------------------------
// 0. Extract and execute the SHIPPED composer (index.ts cannot be imported:
//    Deno.serve runs at module scope). Same extraction composer_reservation_test
//    uses, so this exercises the real draw/hash, not a paraphrase.
// ---------------------------------------------------------------------------
const A = SRC.indexOf("// ---- COMPOSER-BEGIN"), B = SRC.indexOf("// ---- COMPOSER-END");
if (A < 0 || B < 0) throw new Error("composer block not found");
const mod = await import(
  "data:application/typescript;base64," +
  btoa(String.fromCharCode(...new TextEncoder().encode(
    SRC.slice(SRC.indexOf("\n", A) + 1, B) +
    "\nexport { canonicalAxes, composeDraw };\n",
  )))
) as {
  canonicalAxes: (a: Record<string, string | number>) => string;
  composeDraw: (
    byAxis: Map<string, Array<{ code: string; requires_evidence: boolean; prompt_directive: string }>>,
    hasEvidence: boolean, seedBase: string,
  ) => Promise<{ axes: Record<string, string | number>; composition: Record<string, string>; fingerprint: string }>;
};

// ---------------------------------------------------------------------------
// 1. THE ROOT CAUSE, ASSERTED BY SOURCE: only spine and opening_move reach the
//    writer; everything else the fingerprint hashes is mute. These are the bytes
//    the argument rests on, so a change here means the test must be re-derived
//    (guard), not that the invariant silently passed.
// ---------------------------------------------------------------------------
console.log("1. WHAT THE WRITER ACTUALLY RECEIVES (by source)");

guard(/template_style:\s*\{\s*name:\s*claimed\.axes\.spine\b/.test(SRC),
  "template_style is built ONLY from axes.spine");
guard(/opening_style:\s*\{\s*name:\s*claimed\.axes\.opening_move\b/.test(SRC),
  "opening_style is built ONLY from axes.opening_move");
const styleNoteLine = (SRC.match(/const styleNote = strategy \? `[^`]*`/) ?? [""])[0];
guard(/JSON\.stringify\(strategy\.template_style\)/.test(styleNoteLine) &&
      /JSON\.stringify\(strategy\.opening_style\)/.test(styleNoteLine),
  "the generator styleNote carries template_style + opening_style …");
guard(styleNoteLine !== "" &&
      !/paragraph_regime|stance|evidence_integration|argument_carrier|closing_move|tabular_policy|cadence|move_order|weight_profile|strategy\.composition/.test(styleNoteLine),
  "… and NOTHING else — no register, stance, closing, tabular, cadence or the full composition");
// The nine mute axes are named in no prompt anywhere (only in composeDraw's own
// integer lines and history comments). Strip line comments before checking.
const codeNoComments = SRC.replace(/\/\/[^\n]*\n/g, "");
guard(!/paragraph_regime|evidence_integration|argument_carrier|tabular_policy|closing_move/.test(codeNoComments),
  "the six mute categorical axes are named in NO code path at all (never sent to the model)");

// ---------------------------------------------------------------------------
// 2. THE REAL VOCABULARY, parsed from the migrations the composer reads. Derived
//    from schema, cross-checked against the counts a PG17 replay of
//    composition_axes proves (see report). A mismatch is DRIFT, not a pass.
// ---------------------------------------------------------------------------
console.log("\n2. THE COMPOSITION VOCABULARY (parsed from the migrations)");

const POOL = await Deno.readTextFile(new URL("../../supabase/migrations/20260819195010_seed_pools_and_tests.sql", HERE));
const COMP = await Deno.readTextFile(new URL("../../supabase/migrations/20260826160000_unbounded_composer.sql", HERE));

function poolNames(sql: string, table: string): string[] {
  // Bound the value block by the NEXT insert statement, not the next ";": a row
  // description can itself contain a semicolon (geography_first's does), which
  // would truncate the block and silently drop later rows.
  const start = sql.indexOf(`insert into public.${table}`);
  const after = sql.slice(start + 1);
  const nextInsert = after.indexOf("\ninsert into");
  const block = nextInsert >= 0 ? sql.slice(start, start + 1 + nextInsert) : sql.slice(start);
  return [...block.matchAll(/\n\s*\('([a-z_]+)'\s*,/g)].map((m) => m[1]);
}
const explicit = [...COMP.matchAll(/^\s*\('([a-z_]+)'\s*,\s*'([a-z_]+)'/gm)].map((m) => ({ axis: m[1], code: m[2] }));
const codesByAxis = new Map<string, Set<string>>();
const add = (axis: string, code: string) => { (codesByAxis.get(axis) ?? codesByAxis.set(axis, new Set()).get(axis)!).add(code); };
for (const n of poolNames(POOL, "structural_templates")) add("spine", n);      // migrated -> spine
for (const n of poolNames(POOL, "opening_devices")) add("opening_move", n);    // migrated -> opening_move
for (const { axis, code } of explicit) add(axis, code);

const EXPECTED: Record<string, number> = {
  spine: 13, opening_move: 14, argument_carrier: 6, paragraph_regime: 5,
  stance: 6, evidence_integration: 5, closing_move: 8, tabular_policy: 4,
};
for (const [axis, n] of Object.entries(EXPECTED)) {
  guard((codesByAxis.get(axis)?.size ?? 0) === n,
    `axis ${axis}: parsed ${codesByAxis.get(axis)?.size ?? 0} codes (replay baseline ${n})`);
}

// Build byAxis exactly as the worker does from composition_axes rows. We run the
// RICH path (hasEvidence=true) — the largest pool — so the collision is not an
// artefact of a shrunken space. prompt_directive is keyed by code, so two claims
// with the same code get byte-identical directive text, like the real rows.
const byAxis = new Map<string, Array<{ code: string; requires_evidence: boolean; prompt_directive: string }>>();
for (const [axis, codes] of codesByAxis) {
  byAxis.set(axis, [...codes].map((code) => ({ code, requires_evidence: false, prompt_directive: `directive:${axis}:${code}` })));
}
const POOL_SIZE = (codesByAxis.get("spine")?.size ?? 0) * (codesByAxis.get("opening_move")?.size ?? 0);
guard(POOL_SIZE > 0, `reader-visible style pool = |spine| x |opening_move| = ${POOL_SIZE} (finite, independent of the fingerprint space)`);

// ---------------------------------------------------------------------------
// 3. THE DRAW, EXECUTED: many applicants on ONE grant. Worker seedBase shape is
//    `${organisation_id}|${idx}|${intervention}|${reroll}`. A plain,
//    obviously-un-engineered sequence (idx 0, reroll 0, distinct org uuid +
//    intervention per applicant) — nothing hand-picked to collide.
// ---------------------------------------------------------------------------
console.log("\n3. MANY APPLICANTS ON ONE GRANT (shipped composeDraw, real vocabulary)");

const orgUuid = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
// EXACTLY what the strategy stage stores as the writer's style input (worker ~2065-2066).
const writerStyle = (d: { axes: Record<string, string | number>; composition: Record<string, string> }) =>
  JSON.stringify({
    template_style: { name: d.axes.spine, description: d.composition.spine ?? null },
    opening_style: { name: d.axes.opening_move, description: d.composition.opening_move ?? null },
  });

type Row = { i: number; fp: string; style: string; spine: string; open: string; axes: Record<string, string | number>; composition: Record<string, string> };
async function draws(N: number): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < N; i++) {
    const d = await mod.composeDraw(byAxis, true, `${orgUuid(i)}|0|intervention_${i}|0`);
    out.push({ i, fp: d.fingerprint, style: writerStyle(d), spine: String(d.axes.spine), open: String(d.axes.opening_move), axes: d.axes, composition: d.composition });
  }
  return out;
}

console.log("     N    servedDistinctFingerprints    distinctVisibleStyles");
let big: Row[] = [];
for (const N of [20, 40, 182, 1000]) {
  const rows = await draws(N);
  const fps = new Set(rows.map((r) => r.fp)).size;
  const styles = new Set(rows.map((r) => r.style)).size;
  console.log(`  ${String(N).padStart(4)}          ${String(fps).padStart(4)}                       ${String(styles).padStart(4)}`);
  if (N === 1000) big = rows;
}

// ---------------------------------------------------------------------------
// 4. THE INVARIANT PREDICATE — the only pass/fail gate.
//    Broken iff two SERVED applicants (distinct fingerprints) on one grant
//    receive the same reader-visible style. Also require the "nobody waits" half
//    so we are attacking the real regime, not a degraded one.
// ---------------------------------------------------------------------------
console.log("\n4. THE INVARIANT (no two served proposals share style/shape/form)");

const servedAll = new Set(big.map((r) => r.fp)).size === big.length; // every applicant placed, nobody waits
const distinctStyles = new Set(big.map((r) => r.style)).size;
const styleSharers = big.length - distinctStyles;

const byStyle = new Map<string, Row[]>();
for (const r of big) (byStyle.get(r.style) ?? byStyle.set(r.style, []).get(r.style)!).push(r);
const collision = [...byStyle.values()].find((g) => g.length > 1);

const broken = servedAll && collision !== undefined;

note(servedAll, `${big.length}/${big.length} applicants served, all fingerprints distinct — the "nobody waits" half HOLDS`);
note(distinctStyles <= POOL_SIZE, `only ${distinctStyles} distinct reader-visible styles among ${big.length} served (<= the ${POOL_SIZE}-pool): ${styleSharers} applicants reuse another's style`);

if (collision) {
  const [a, b] = collision;
  const differing = Object.keys(a.axes).filter((k) => String(a.axes[k]) !== String(b.axes[k]));
  const MUTE = new Set(["paragraph_regime", "stance", "evidence_integration", "argument_carrier", "closing_move", "tabular_policy", "move_order", "cadence_mu", "weight_profile"]);
  console.log(`\n   concrete pair on one grant:`);
  console.log(`     applicant ${a.i}: fp=${a.fp.slice(0, 16)}…  spine=${a.spine}  opening_move=${a.open}`);
  console.log(`     applicant ${b.i}: fp=${b.fp.slice(0, 16)}…  spine=${b.spine}  opening_move=${b.open}`);
  note(a.fp !== b.fp, "their fingerprints DIFFER — the (grant_id, fingerprint) lock blocks neither; both served");
  note(a.style === b.style, "their template_style + opening_style are BYTE-IDENTICAL — the generator gets the same style from both");
  note(differing.length > 0 && differing.every((k) => MUTE.has(k)), `the only axes separating their fingerprints are MUTE: ${differing.join(", ")}`);
  note(mod.canonicalAxes(a.axes).includes('"move_order"') && !a.style.includes("move_order"),
    "the hashed canonical form carries move_order et al.; the writer's style input does not — the decoupling exactly");
}

// ---------------------------------------------------------------------------
console.log("");
if (setupFail > 0) {
  console.log(`CANNOT VERIFY: ${setupFail} setup guard(s) drifted — the shipped styleNote shape or the seeded vocabulary changed. ` +
    `Re-derive the reader-visible axis set and the pool against a fresh PG17 replay before trusting this test. Treating as failure.`);
  Deno.exit(2);
}
if (broken) {
  console.log(`INVARIANT 6 BROKEN: on one grant, ${styleSharers} of ${big.length} served applicants share a reader-visible style ` +
    `(pool = ${POOL_SIZE}). Distinct fingerprints are bought with ${9} mute axes the writer never sees — uniqueness nominal, not real. ` +
    `Fix spec in reports/adversarial/invariant-6-exclusivity.md.`);
  Deno.exit(1);
}
console.log("INVARIANT 6 HELD: reader-visible style is as unique as the fingerprint the lock enforces.");
Deno.exit(0);
