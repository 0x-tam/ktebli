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
    "\nexport { canonicalAxes, composeDraw, composedStyleNote };\n",
  )))
) as {
  canonicalAxes: (a: Record<string, string | number>) => string;
  composeDraw: (
    byAxis: Map<string, Array<{ code: string; requires_evidence: boolean; prompt_directive: string }>>,
    hasEvidence: boolean, seedBase: string,
  ) => Promise<{ axes: Record<string, string | number>; composition: Record<string, string>; fingerprint: string }>;
  // The style the writer ACTUALLY receives, from the shipped composer block. The fix
  // (inv6) routes the WHOLE composition through this, so the test's model of "what the
  // writer sees" is the worker's own function, not a paraphrase — a collision here is a
  // real collision in the generator's style input.
  composedStyleNote: (axes: Record<string, string | number>, composition: Record<string, string>) => string;
};

// ---------------------------------------------------------------------------
// 1. WHAT THE WRITER ACTUALLY RECEIVES (by source). Round-2 UPDATED for the fix:
//    the pre-fix version pinned the DEFECT — only spine + opening_move reached the
//    writer while the fingerprint hashed eleven axes. The consolidation fix routes
//    the WHOLE composition through composedStyleNote(), so these guards now verify
//    the OPPOSITE: the generator's style input is built from every hashed axis. A
//    drift (styleNote no longer built from the composer's own function, or an axis
//    dropped from it) is "cannot verify", not a silent pass.
// ---------------------------------------------------------------------------
console.log("1. WHAT THE WRITER ACTUALLY RECEIVES (by source)");

// The gen:narrative styleNote is now built from the composer's composedStyleNote(),
// fed the FULL stored composition — strategy.axes and strategy.composition — not just
// template_style/opening_style.
guard(/const styleNote = strategy\s*\?\s*[\s\S]{0,400}?composedStyleNote\(/.test(SRC),
  "the generator styleNote is built by composedStyleNote() over the whole composition");
guard(/composedStyleNote\(\s*[\s\S]{0,120}?strategy\.axes[\s\S]{0,120}?strategy\.composition/.test(SRC),
  "… fed BOTH strategy.axes (incl. the integer grids) and strategy.composition (the directives)");

// composedStyleNote itself must NAME every hashed axis. Run it on a real draw and
// require each of the eleven axes to appear in the writer's brief. This is the crux:
// once every axis is in the brief, the visible-style space equals the fingerprint space.
{
  const probeByAxis = new Map<string, Array<{ code: string; requires_evidence: boolean; prompt_directive: string }>>();
  for (
    const [axis, code] of [
      ["spine", "cost_of_inaction"], ["opening_move", "statistic"], ["argument_carrier", "case_study"],
      ["paragraph_regime", "short_blocks"], ["stance", "measured"], ["evidence_integration", "woven"],
      ["closing_move", "call_forward"], ["tabular_policy", "sparing"],
    ] as Array<[string, string]>
  ) probeByAxis.set(axis, [{ code, requires_evidence: false, prompt_directive: `directive:${axis}:${code}` }]);
  const probe = await mod.composeDraw(probeByAxis, true, "probe|0|x|0");
  const note1 = mod.composedStyleNote(probe.axes, probe.composition);
  for (
    const ax of [
      "spine", "opening_move", "argument_carrier", "paragraph_regime", "stance",
      "evidence_integration", "closing_move", "tabular_policy",
    ]
  ) {
    guard(note1.includes(`directive:${ax}:`) || note1.toLowerCase().includes(ax.replace(/_/g, " ")),
      `composedStyleNote carries the ${ax} axis`);
  }
  guard(note1.includes(String(probe.axes["move_order"])) && /move order/i.test(note1),
    "composedStyleNote carries the move_order integer grid as an instruction");
  guard(note1.includes(String(probe.axes["cadence_mu"])) && /cadence/i.test(note1),
    "composedStyleNote carries the cadence_mu integer grid as an instruction");
  guard(note1.includes(String(probe.axes["weight_profile"])) && /weight|emphasis/i.test(note1),
    "composedStyleNote carries the weight_profile integer grid as an instruction");
}

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
// The OLD reader-visible pool, when only spine + opening_move reached the writer. Kept
// as the yardstick the fix must beat: after routing every axis in, the distinct visible
// styles must exceed this pool and track the fingerprint count instead.
const OLD_POOL_SIZE = (codesByAxis.get("spine")?.size ?? 0) * (codesByAxis.get("opening_move")?.size ?? 0);
guard(OLD_POOL_SIZE > 0, `pre-fix pool (|spine| x |opening_move|) = ${OLD_POOL_SIZE} — the finite ceiling the fix must break past`);

// ---------------------------------------------------------------------------
// 3. THE DRAW, EXECUTED: many applicants on ONE grant. Worker seedBase shape is
//    `${organisation_id}|${idx}|${intervention}|${reroll}`. A plain,
//    obviously-un-engineered sequence (idx 0, reroll 0, distinct org uuid +
//    intervention per applicant) — nothing hand-picked to collide.
// ---------------------------------------------------------------------------
console.log("\n3. MANY APPLICANTS ON ONE GRANT (shipped composeDraw, real vocabulary)");

const orgUuid = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
// EXACTLY the bytes the generator receives as its style brief: the worker's own
// composedStyleNote() over the full composition (worker gen:narrative styleNote). Two
// applicants share a visible style iff this string is identical — iff every hashed axis
// matches, iff the fingerprint matches.
const writerStyle = (d: { axes: Record<string, string | number>; composition: Record<string, string> }) =>
  mod.composedStyleNote(d.axes, d.composition);

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
note(distinctStyles === new Set(big.map((r) => r.fp)).size,
  `${distinctStyles} distinct reader-visible styles among ${big.length} served — the visible-style space now tracks the fingerprint space (was capped at the ${OLD_POOL_SIZE}-pool); ${styleSharers} share another's style`);
note(distinctStyles > OLD_POOL_SIZE,
  `distinct visible styles (${distinctStyles}) exceed the old |spine|x|opening_move| pool (${OLD_POOL_SIZE}) — the finite ceiling is gone`);

if (collision) {
  // Should not occur after the fix: a collision now means the writer's style brief is
  // NOT injective in the fingerprint, i.e. an axis the hash carries is again absent
  // from composedStyleNote — the 182-pool defect regressed. Diagnose which axes differ
  // yet produced the same brief.
  const [a, b] = collision;
  const differing = Object.keys(a.axes).filter((k) => String(a.axes[k]) !== String(b.axes[k]));
  console.log(`\n   REGRESSED pair on one grant:`);
  console.log(`     applicant ${a.i}: fp=${a.fp.slice(0, 16)}…`);
  console.log(`     applicant ${b.i}: fp=${b.fp.slice(0, 16)}…`);
  note(a.fp !== b.fp, "their fingerprints DIFFER — the (grant_id, fingerprint) lock blocks neither; both served");
  note(a.style === b.style, "yet their composedStyleNote is BYTE-IDENTICAL — the generator gets the same style from both");
  console.log(`   axes differing but MUTE in the style brief: ${differing.join(", ")}`);
}

// ---------------------------------------------------------------------------
console.log("");
if (setupFail > 0) {
  console.log(`CANNOT VERIFY: ${setupFail} setup guard(s) drifted — the styleNote wiring or the seeded vocabulary changed. ` +
    `Re-derive the reader-visible axis set against a fresh PG17 replay before trusting this test. Treating as failure.`);
  Deno.exit(2);
}
if (broken) {
  console.log(`INVARIANT 6 BROKEN: on one grant, ${styleSharers} of ${big.length} served applicants share a reader-visible style. ` +
    `Distinct fingerprints are bought with axes the writer never sees — uniqueness nominal, not real. ` +
    `Fix spec in reports/adversarial/invariant-6-exclusivity.md.`);
  Deno.exit(1);
}
console.log(`INVARIANT 6 HELD: reader-visible style is as unique as the fingerprint the lock enforces ` +
  `(${distinctStyles} distinct styles for ${big.length} served, past the old ${OLD_POOL_SIZE}-pool). ` +
  `MECHANISM proven (every hashed axis is in the writer's brief); prose-distinctness of the integer grids is UNPROVEN-WITHOUT-E2E.`);
Deno.exit(0);
