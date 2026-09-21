// ============================================================================
// ADVERSARY: make a re-invoked worker PAY AGAIN for narrative work it already
// finished, or resume from a partial document it never checked (phase 6.5).
//
// Competitive/Full narratives can outlive a single edge invocation
// (launch-readiness P0.3). The gen:* stage now persists per-section progress
// in its own stage output and resumes: persisted sections are skipped ONLY
// after re-passing the deterministic material check, assembly adds the donor's
// headings byte-exact by construction, and the finished document is persisted
// before done(). Marked UNPROVEN ON DEPLOYED RUNTIME in the source — the local
// stack cannot reproduce production invocation limits; what IS proven here is
// the helpers (extracted from the shipping source and executed) and the
// wiring (by source).
// ============================================================================

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}
const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));
const BEGIN = "// ---- RESUMABLE-GEN-BEGIN", END = "// ---- RESUMABLE-GEN-END";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0) throw new Error("resumable-gen block not found");
const mod = await import(
  "data:application/typescript;base64," +
  btoa(String.fromCharCode(...new TextEncoder().encode(
    SRC.slice(SRC.indexOf("\n", a) + 1, b) + "\nexport { sectionPlan, assembleSections };\n",
  )))
);
// deno-lint-ignore no-explicit-any
const sectionPlan = mod.sectionPlan as (t: string, s: any, m: number | null) => any;
// deno-lint-ignore no-explicit-any
const assembleSections = mod.assembleSections as (p: any, s: any, c: (m: any) => boolean) => string | null;

console.log("1. THE PLAN: SECTIONING ONLY WHERE IT IS CORRECT BY CONSTRUCTION");
const donor5 = { defined_by_donor: true, sections_or_questions: ["Q1. Problem", "Q2. Response", "Q3. Who benefits", "Q4. Capability", "Q5. Cost"] };
ok(sectionPlan("draft", donor5, 1400) === null, "draft tier never sections (single-shot path unchanged)");
ok(sectionPlan("trial", donor5, 1400) === null, "trial tier never sections");
ok(sectionPlan("competitive", { defined_by_donor: false, sections_or_questions: ["a", "b", "c"] }, 1400) === null,
  "no donor-defined structure, no sectioning (a split we invent would change the document)");
ok(sectionPlan("competitive", { defined_by_donor: true, sections_or_questions: ["a", "b"] }, 1400) === null,
  "fewer than 3 sections stays single-shot");
ok(sectionPlan("full", { defined_by_donor: true, sections_or_questions: Array.from({ length: 21 }, (_, i) => `Q${i}`) }, null) === null,
  "more than 20 sections stays single-shot");
const plan = sectionPlan("competitive", donor5, 1400);
ok(plan !== null && plan.sections.length === 5, "competitive + donor structure + limit -> 5 keyed sections");
ok(plan.sections.every((s: { key: string }, i: number) => s.key === `s${i}`), "sections are position-keyed (stable across invocations)");
{
  const sum = plan.sections.reduce((acc: number, s: { targetWords: number }) => acc + s.targetWords, 0);
  ok(sum <= Math.round(1400 * 0.94) && plan.sections.every((s: { targetWords: number }) => s.targetWords >= 60),
    `per-section targets sum to ${sum} <= 94% of the donor limit, none squeezed under 60 words`);
}
ok(sectionPlan("full", donor5, null)!.sections.every((s: { targetWords: unknown }) => s.targetWords === null),
  "no donor limit -> no invented per-section number");

console.log("\n2. ASSEMBLY: DONOR HEADINGS BY CONSTRUCTION, NO PARTIAL DOCUMENT");
const complete = (md: unknown) => typeof md === "string" && md.length > 10;
{
  const sections = Object.fromEntries(plan.sections.map((s: { key: string }, i: number) => [s.key, `Body of section ${i} with enough words.`]));
  const doc = assembleSections(plan, sections, complete);
  ok(doc !== null, "all sections complete -> assembled");
  const headings = [...doc!.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  ok(JSON.stringify(headings) === JSON.stringify(donor5.sections_or_questions),
    "every donor heading present, byte-exact, in the donor's order — added deterministically, not by model reproduction");
  ok(doc!.indexOf("Body of section 0") < doc!.indexOf("Body of section 4"), "bodies in order under their headings");
}
{
  const sections = Object.fromEntries(plan.sections.slice(0, 4).map((s: { key: string }, i: number) => [s.key, `Body ${i} long enough.`]));
  ok(assembleSections(plan, sections, complete) === null, "one section missing -> NO document (partials are never assembled)");
}
ok(assembleSections(plan, Object.fromEntries(plan.sections.map((s: { key: string }) => [s.key, "x"])), complete) === null,
  "a section failing the caller's material check -> NO document (persisted content is re-checked, never trusted)");

console.log("\n3. THE WIRING, BY SOURCE");
ok(/UNPROVEN ON DEPLOYED RUNTIME/.test(SRC), "the code carries the required UNPROVEN ON DEPLOYED RUNTIME marker");
const genAt = SRC.indexOf('if (stage.key.startsWith("gen:"))');
const genBlock = SRC.slice(genAt, SRC.indexOf('if (stage.key === "validate")'));
ok(/if \(sectionComplete\(progress\.sections\[sec\.key\]\)\) continue;/.test(genBlock),
  "a persisted section is SKIPPED (no re-payment) only after re-passing the deterministic check");
ok(/progress\.sections\[sec\.key\] = body;\s*\n\s*await saveProgress\(\);/.test(genBlock),
  "every section is persisted the moment it checks out — a re-invoked worker resumes exactly there");
ok(/if \(progress\.text\) \{\s*\n\s*const v = contentViolations\(progress\.text/.test(genBlock),
  "a persisted finished document is re-VERIFIED (contentViolations) before the zero-call resume");
ok(/progress\.text = text;\s*\n\s*await saveProgress\(\); \/\/ finished document persisted BEFORE done\(\)/.test(genBlock),
  "the finished sectioned document is persisted before done()");
ok(/progress\.text = text;\s*\n\s*await saveProgress\(\);\s*\n\s*return done\(\{ text, usage/.test(genBlock),
  "the single-shot path checkpoints its document too");
ok(/function sectionComplete[\s\S]{0,200}contentViolations\(md, toBlocks\(md\), \{\}\)/.test(SRC),
  "the material check is the real content validator, not a length heuristic alone");
ok(/gen_progress && ownRow\.output\.gen_progress\.kind === kind/.test(genBlock),
  "progress is keyed by gen kind — one stage's progress can never resume another's");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
