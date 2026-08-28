// ============================================================================
// ADVERSARY: defeat a compliance or grounding gate with a malformed-but-
// plausible model output — the WS4a silent-pass class, now wired closed in
// worker/index.ts (reports/phase4-compliance.md §6 fix-specs: WS4a-1/-2/-3/-4/
// -5/-6/-15/-16/-17/-18/-20).
//
// index.ts calls Deno.serve at module scope and cannot be imported, so the
// fixed predicates live in MARKED blocks that this suite extracts from the
// real source and executes as TypeScript modules (data: URL import). What runs
// here is the shipping code, byte for byte — not a copy that can drift.
// ============================================================================

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}
const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));

function slice(begin: string, end: string): string {
  const a = SRC.indexOf(begin), b = SRC.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error(`marker block not found: ${begin}`);
  return SRC.slice(SRC.indexOf("\n", a) + 1, b);
}
async function mod(code: string): Promise<Record<string, unknown>> {
  const url = "data:application/typescript;base64," +
    btoa(String.fromCharCode(...new TextEncoder().encode(code)));
  return await import(url);
}

// ---------------------------------------------------------------------------
// 1. normalizeFmt (WS4a-1/F1 + WS4a-15): extracted from `interface Fmt` to
//    EMPTY_FMT, executed against the donor_limits module it now delegates to.
// ---------------------------------------------------------------------------
console.log("1. normalizeFmt: LIMITS RESOLVE OR REFUSE, SECTIONS NEVER SILENTLY []");
const fmtStart = SRC.indexOf("interface Fmt {");
const fmtEnd = SRC.indexOf("const EMPTY_FMT = normalizeFmt(null);");
if (fmtStart < 0 || fmtEnd < 0) throw new Error("normalizeFmt block not found");
const donorLimitsUrl = new URL("../../supabase/functions/worker/donor_limits.ts", import.meta.url).href;
const fmtMod = await mod(
  `import { resolveDonorLimits, type LimitField, type LimitOutcome } from "${donorLimitsUrl}";\n` +
  SRC.slice(fmtStart, fmtEnd) + "\nexport { normalizeFmt };\n",
);
// deno-lint-ignore no-explicit-any
const normalizeFmt = fmtMod.normalizeFmt as (raw: unknown, guidelines?: string) => any;

{
  const f = normalizeFmt({ required_sections: "Q1; Q2; Q3", max_words: 1400 });
  ok(f.requiredSections.length === 0 && f.limitUnparsed.some((u: string) => u.startsWith("required_sections=")),
    "required_sections as a STRING lands in limitUnparsed (the refusal channel), never a silent []");
  ok(f.maxWords === 1400, "a clean numeric max_words still resolves (1400)");
}
ok(normalizeFmt({ required_sections: ["Problem statement", "Budget narrative"] }).requiredSections.length === 2,
  "a real required_sections array survives");
ok(normalizeFmt({ max_words: "1,400 words" }).maxWords === 1400, '"1,400 words" resolves to 1400');
{
  const f = normalizeFmt({ max_words: "1,400 characters" });
  ok(f.maxWords === null && f.limitUnparsed.length === 1,
    '"1,400 characters" REFUSES (numLike used to read it as 1400 words — 6x permissive)');
}
{
  const f = normalizeFmt({ max_words: "at least 1,400 words" });
  ok(f.maxWords === null && f.limitUnparsed.length === 1, '"at least 1,400 words" REFUSES (a floor is not a ceiling)');
}
{
  const f = normalizeFmt({ max_words: "1400 words or 4 pages" });
  ok(f.maxWords === null && f.limitUnparsed.length === 1, "a dual word/page limit REFUSES (the page half no longer silently drops)");
}
{
  const f = normalizeFmt({ max_pages: "A4" });
  ok(f.maxPages === null && f.limitUnparsed.length === 1, '"A4" REFUSES (numLike used to read a paper size as a 4-page limit)');
}
{
  const f = normalizeFmt({ max_words: "1,200-1,400 words" });
  ok(f.maxWords === null && f.limitUnparsed.length === 1, "a range REFUSES (the lower end is not the limit)");
}
{
  const f = normalizeFmt({}, "Applications must be no more than 1,400 words.");
  ok(f.maxWords === null && f.limitUnparsed.length === 1,
    "an ABSENT field contradicted by the guidelines REFUSES (absence_contradicted)");
}
{
  const f = normalizeFmt({});
  ok(f.maxWords === null && f.maxPages === null && f.limitUnparsed.length === 0,
    "a genuinely absent limit stays null with an empty refusal list");
  ok(f.limitOutcomes && f.limitOutcomes.max_words.kind === "absent",
    "and the per-field outcome is RECORDED (invariant 9)");
}

// ---------------------------------------------------------------------------
// 2. normalizeClaims (WS4a-2/-3, F3): the Claim Ledger cannot be defeated by
//    shape or by case.
// ---------------------------------------------------------------------------
console.log("\n2. normalizeClaims: THE GROUNDING GATE CANNOT PASS VACUOUSLY");
const claimsMod = await mod(
  slice("// ---- CLAIM-NORMALISE-BEGIN", "// ---- CLAIM-NORMALISE-END") +
  "\nexport { normalizeClaims, CLAIM_CLASSES };\n",
);
const normalizeClaims = claimsMod.normalizeClaims as (c: unknown) => Array<Record<string, unknown>>;

for (const [input, label] of [
  [{ a: 1 }, "an object"], ["claims", "a string"], [undefined, "a missing field"], [null, "null"],
] as Array<[unknown, string]>) {
  let threw = false;
  try { normalizeClaims(input); } catch { threw = true; }
  ok(threw, `${label} where the claims array belongs THROWS (used to become [] and pass)`);
}
{
  const out = normalizeClaims([{ claim: "x", classification: "Unsupported", material: true }]);
  ok(out[0].classification === "unsupported", '"Unsupported" (capital U) now blocks: normalised to "unsupported"');
}
{
  const out = normalizeClaims([{ claim: "x", classification: "verified", material: true }]);
  ok(out[0].classification === "unsupported" && out[0].classification_raw === "verified",
    "an out-of-enum classification becomes \"unsupported\" with the raw value recorded");
}
{
  const out = normalizeClaims([{ claim: "x", classification: "Supported", material: false }]);
  ok(out[0].classification === "supported" && out[0].material === false,
    "case normalisation does not invent blocking where the enum genuinely matches");
}

// ---------------------------------------------------------------------------
// 3. normalizeVisualIssues (WS4a-6): the layout gate cannot be defeated by a
//    missing array or a near-miss type name.
// ---------------------------------------------------------------------------
console.log("\n3. normalizeVisualIssues: NO SILENT 'passed'");
const vtStart = SRC.indexOf("const VISUAL_TYPES = new Set([");
const visMod = await mod(
  SRC.slice(vtStart, SRC.indexOf("// ---- VISUAL-NORMALISE-END")) +
  "\nexport { normalizeVisualIssues };\n",
);
// deno-lint-ignore no-explicit-any
const normalizeVisualIssues = visMod.normalizeVisualIssues as (i: unknown) => any[];

for (const [input, label] of [
  [undefined, "issues missing"], [{}, "issues as an object"], ["none", "issues as a string"],
] as Array<[unknown, string]>) {
  let threw = false;
  try { normalizeVisualIssues(input); } catch { threw = true; }
  ok(threw, `${label} THROWS into the retry (used to read as status "passed")`);
}
{
  const out = normalizeVisualIssues([{ type: "text_overflow", page: 2, severity: "blocking", note: "spills" }]);
  ok(out.length === 1 && out[0].type === "unreadable_content" && out[0].severity === "blocking" &&
    out[0].note.includes("text_overflow"),
    "a BLOCKING report under an unknown type survives as unreadable_content (was silently dropped)");
}
ok(normalizeVisualIssues([{ type: "sparkles", severity: "warning" }]).length === 0,
  "an unknown NON-blocking type is still dropped");
ok(normalizeVisualIssues([{ type: "clipping", severity: "warning" }])[0].severity === "blocking",
  "an always-blocking type cannot be downgraded to a warning");

// ---------------------------------------------------------------------------
// 4. requiredSectionFindings (WS4a-16): non-Latin donor structure is checked.
// ---------------------------------------------------------------------------
console.log("\n4. requiredSectionFindings: NON-LATIN HEADINGS ARE NO LONGER INVISIBLE");
const headMod = await mod(
  slice("// ---- HEADING-GATE-BEGIN", "// ---- HEADING-GATE-END") +
  "\nexport { requiredSectionFindings };\n",
);
const requiredSectionFindings = headMod.requiredSectionFindings as (h: string[], r: string[]) => string[];

const AR_SECTION = "ملخص المشروع"; // "project summary" in Arabic
ok(requiredSectionFindings([AR_SECTION, "Budget"], [AR_SECTION]).length === 0,
  "an Arabic required section present as a heading passes");
{
  const out = requiredSectionFindings(["Introduction", "Budget"], [AR_SECTION]);
  ok(out.length === 1 && out[0].startsWith("missing_required_section:"),
    "an Arabic required section MISSING from the document now fires (was silently skipped, zero findings)");
}
{
  const out = requiredSectionFindings(["Anything"], ["!!!"]);
  ok(out.length === 1 && out[0].startsWith("required_section_unreadable:"),
    "a section name empty under BOTH rules is a recorded violation, never a silent skip");
}
ok(requiredSectionFindings(["Q1. What problem will this project address, and for whom?"],
  ["Q1. What problem will this project address, and for whom?"]).length === 0,
  "ASCII behaviour unchanged: the donor's own wording as a heading passes");
ok(requiredSectionFindings(["Question"],
  ["Q1. What problem will this project address, and for whom?"]).length === 1,
  "ASCII behaviour unchanged: a truncated heading still fails the donor's wording");

// ---------------------------------------------------------------------------
// 5. The wiring around the predicates, by source.
// ---------------------------------------------------------------------------
console.log("\n5. THE WIRING, BY SOURCE");
ok(/grant page unreachable/.test(SRC) && !/text = text\.slice\(0, 80_000\);\s*\}\s*\}/.test(SRC.slice(SRC.indexOf('stage.key === "analyze"'), SRC.indexOf('stage.key === "analyze"') + 1200)),
  "WS4a-5 (F5): a failed grant fetch THROWS — the URL string no longer becomes the grant text");
ok(/kind === "narrative" && limitUnparsedAll\.length/.test(SRC),
  "an unparsed donor limit stops the order at gen:narrative, BEFORE the generation spend");
ok(/isNarrative && limitUnparsedAll\.length/.test(SRC),
  "and the package backstop still refuses the same refusal list");
ok(/limit_unparsed: lr\.limitUnparsed, limit_outcomes: lr\.limitOutcomes/.test(SRC),
  "analyze records the full-text limit resolution in its output (invariant 9)");
ok(/const siteDerived = !!\(webEvidence\.length \|\| profile\.legal_name \|\|\s*Object\.keys\(profile\)\.length \|\| Object\.keys\(voiceGuide\)\.length\);/.test(SRC),
  "WS4a-17: the identity gate's ENTRY covers any site-derived output (WS3's fix, verified present)");
ok(/ranking_unparsed/.test(SRC), "WS4a-18: a refusal to rank is recorded, not silently discarded");
ok(/word_count_whole/.test(SRC) && /word_count_counted/.test(SRC),
  "WS4a-20: the QA record carries BOTH word counts (whole document and counted span)");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
