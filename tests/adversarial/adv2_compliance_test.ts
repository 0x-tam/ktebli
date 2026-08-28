// ADVERSARIAL round 2 — invariant 5: "compliance is never traded; a donor word
// limit is verified, never satisfied by an undercount."
//
// Round 1 (compliance_truncation_test.ts) closed two routes by which the model
// could shrink the COUNTED SPAN through how it wrote (ordered-list headings,
// attachment-prefix sections). This file attacks the COUNTER ITSELF: the token
// rule that turns a document into the number the limit is compared against.
//
// Every case below was RUN against the code as it stands on 2026-08-28 before it
// was written down; none is hypothetical. This file therefore FAILS against
// current code by construction, and is the specification for the fixes in
// reports/adversarial/invariant-5-compliance.md.
//
// Pure: no model, no network, no production. Run:
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_compliance_test.ts
//
// The PRIMARY break (Part A) is fully self-contained — it inlines the gate's own
// counter verbatim and needs no import, so it runs and fails in any checkout.
// Part C imports the real donor-limit parser; if the worker module is not present
// in the tree it is reported as "not evaluated" rather than crashing the run.

let bad = 0;
const ok = (c: boolean, m: string) => { c ? console.log(`  ok   ${m}`) : (console.error(`  FAIL ${m}`), bad++); };
const note = (m: string) => console.log(`  --   ${m}`);

// The gate's word-limit counter, VERBATIM. Two independent copies of this exact
// line enforce the donor word limit:
//   * index.ts:539-541          contentViolations() -> "over_word_limit"
//   * delivery_gate.ts:279-281  preflight() line 307 -> "over the donor word limit"
// Both count only tokens containing [A-Za-z0-9؀-ۿ] : Latin, ASCII digits, and the
// Arabic block U+0600-06FF. Nothing else is a "word" to this counter.
const gateWordCount = (md: string): number =>
  md.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9؀-ۿ]/.test(w)).length;

const repeat = (w: string, n: number) => Array.from({ length: n }, () => w).join(" ");

// A conservative floor the document must clear to be over the limit "for real":
// index.ts generation sets minWords:450, delivery_gate preflight rejects <250 as
// "not a proposal". A break must clear BOTH floors and STILL ship over the max.
const GEN_MIN = 450;
const PREFLIGHT_MIN = 250;
const LIMIT = 1400;

console.log("========== A. THE LIMIT COUNTER IS BLIND TO NON-LATIN SCRIPTS ==========");
// A donor word limit applies to the document the donor receives. For every
// space-separated script below, a word processor — and the donor — counts one
// word per whitespace-separated token, exactly as for English. The gate counts 0.
const SCRIPTS: [string, string][] = [
  ["Cyrillic (Ukrainian/Russian)", "програма"],
  ["Greek", "πρόγραμμα"],
  ["Hebrew", "תוכנית"],
  ["Devanagari (Hindi)", "कार्यक्रम"],
];
for (const [label, w] of SCRIPTS) {
  const doc = repeat(w, 2000);           // 2000 whitespace-separated words
  const counted = gateWordCount(doc);
  // TRUTH: 2000 words. The counter must not report fewer than the whitespace
  // token count for a space-separated script.
  ok(counted >= 2000, `${label}: 2000 words counted as ${counted} (a donor/word-processor counts 2000)`);
}
// CJK has no spaces: an arbitrarily long paragraph is one token -> 0 words.
{
  const cjk = "计划项目实施方案".repeat(1000);   // 8000 CJK characters, no whitespace
  const counted = gateWordCount(cjk);
  ok(counted > LIMIT, `CJK: 8000 characters counted as ${counted} (far over a ${LIMIT}-word limit)`);
}

console.log("\n========== A2. MIXED DOCUMENT SHIPS OVER A 1,400-WORD LIMIT ==========");
// The exploitable, floor-clearing case: enough Latin prose to satisfy every
// minimum, plus a large non-Latin body that the counter cannot see.
const latin = repeat("delivery", 500);   // 500 real Latin words -> clears GEN_MIN and PREFLIGHT_MIN
const cyr = repeat("програма", 4000);    // 4000 real Cyrillic words
const mixed =
  "## Executive summary\n\n" + latin +
  "\n\n## Програма діяльності\n\n" + cyr + "\n";
const countedMixed = gateWordCount(mixed);
const trueWords = 500 + 4000;            // 4500 by any word processor
note(`gate counts ${countedMixed}; a word processor counts ${trueWords}; donor limit ${LIMIT}`);
ok(countedMixed >= GEN_MIN, `sanity: mixed doc clears the generation floor (${countedMixed} >= ${GEN_MIN})`);
ok(countedMixed >= PREFLIGHT_MIN, `sanity: mixed doc is "a proposal" to preflight (${countedMixed} >= ${PREFLIGHT_MIN})`);
// THE ASSERTION THAT MUST HOLD: a 4,500-word document is over a 1,400-word limit,
// and the gate must say so. It does not.
ok(countedMixed > LIMIT,
  `over_word_limit MUST fire: ${trueWords}-word document counted as ${countedMixed} against a ${LIMIT}-word limit`);

console.log("\n========== B. ZERO-WIDTH / SOFT-HYPHEN GLUE COLLAPSES THE COUNT ==========");
// Characters a word processor treats as intra-word (invisible) but that JS \s does
// NOT match and the counter does not strip. Each glues the whole document into a
// single token. sanitizeMd() (index.ts:668) removes none of them.
const GLUE: [string, string][] = [
  ["U+200B zero-width space", "​"],
  ["U+2060 word joiner", "⁠"],
  ["U+00AD soft hyphen", "­"],
  ["U+200D zero-width joiner", "‍"],
];
for (const [label, sep] of GLUE) {
  const doc = Array.from({ length: 3000 }, () => "delivery").join(sep);
  const counted = gateWordCount(doc);
  ok(counted > LIMIT, `${label}: 3000 glued words counted as ${counted} (must exceed ${LIMIT})`);
}
// Control: U+00A0 nbsp IS in \s, so it must (and does) count correctly.
ok(gateWordCount(Array.from({ length: 3000 }, () => "delivery").join(" ")) === 3000,
  "control: U+00A0 nbsp counts all 3000 words (as it should)");

console.log("\n========== B2. PIPE-PACKED TABLE UNDERCOUNTS ==========");
// The counter strips '|' globally, gluing cell text with no surrounding space.
const table = Array.from({ length: 100 }, () => "|alpha|beta|gamma|").join("\n");
const countedTbl = gateWordCount(table);
ok(countedTbl >= 300, `100 rows x 3 cells counted as ${countedTbl} (a word processor counts ~300)`);

console.log("\n========== C. PARSER BACKSTOP: A WRAPPED, STATED LIMIT BECOMES null ==========");
// decideLimit(null, guidelines) is the backstop for the exact failure the whole
// donor_limits module exists to remove: the extractor returning null for a limit
// the donor plainly stated. The phase-6 tightening of absenceIsSuspicious now
// requires the digit group and its unit on ONE line. A limit whose NUMBER and
// UNIT wrap across a line, with no "word limit"/"must not exceed ... words" bigram
// on either single line, is missed -> decideLimit returns "absent" -> maxWords is
// null -> NO WORD GATE. The invariant: a stated limit must never resolve to null.
try {
  const mod = await import("../../supabase/functions/worker/donor_limits.ts");
  const decideLimit = mod.decideLimit as (raw: unknown, field: "max_words" | "max_pages", g?: string) => { kind: string };
  const cases: [string, string][] = [
    ["number+unit wrapped",
      "Applicants should keep each submission to 1,400\nwords in total."],
    ["'must not exceed' then wrapped number+unit",
      "Answers must not exceed 1,400\nwords."],
  ];
  for (const [label, g] of cases) {
    const d = decideLimit(null, "max_words", g);
    // MUST refuse (absence_contradicted): the donor stated a limit the field dropped.
    ok(d.kind === "refused",
      `${label}: decideLimit(null) resolved to "${d.kind}" — a stated limit became a null gate (must be "refused")`);
  }
} catch (e) {
  note(`Part C not evaluated: donor_limits.ts not resolvable from this tree (${(e as Error).message.slice(0, 60)}).`);
  note(`Verified separately against /home/jarvis/ktebli/supabase/functions/worker/donor_limits.ts — both cases resolve to "absent".`);
}

console.log(`\n${bad === 0 ? "ALL PASS (unexpected: the gate held)" : `${bad} FAILING ASSERTION(S) — invariant 5 broken as specified`}`);
// Deno is the documented runner; guard so the file also imports cleanly elsewhere.
// deno-lint-ignore no-explicit-any
const _exit = (globalThis as any).Deno?.exit;
if (_exit) _exit(bad === 0 ? 0 : 1);
