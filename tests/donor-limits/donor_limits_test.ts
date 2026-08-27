// DONOR-LIMIT LITERAL-FORM FIXTURE SET.
//
// THE BUG THIS FIXTURE SET EXISTS FOR, stated so the test cannot drift off it.
// A donor word limit arriving as the string "1,400 words" -- the literal form the real
// donor text preserved in this repo uses -- parsed to null, because `normalizeFmt`'s
// coercion was, verbatim from `git show b81b3d7^:supabase/functions/worker/index.ts`:
//
//     const num = (x, lo, hi) => (typeof x === "number" && x >= lo && x <= hi ? x : null);
//
// and `jsonOf` is a bare `JSON.parse` with no coercion. A null limit is not a strict
// limit: `contentViolations` guards with `if (opts.maxWords && ...)`, so the gate was
// skipped at generation, at validate and at package, and all three recorded success.
// The claim that Ktebli never shipped over a word limit was true only because no test
// used a comma. HISTORICAL_NUM below is that function, byte for byte, and this file
// runs it over the same corpus to prove the corpus tests the real bug.
//
// WHAT IS ASSERTED. For every literal form, exactly one of:
//   COERCE  -- a confident, correct integer limit
//   REFUSE  -- recorded, with a reason, so the order stops rather than shipping
//              a document whose compliance is unknown
//   ABSENT  -- the donor stated no limit. This is the third outcome and it is
//              DELIBERATE, argued at ABSENT_INPUTS below. It is not a silent null:
//              it is a named state, it is reachable only from a closed and asserted
//              set of inputs, and `decideLimit` refuses it whenever the donor's own
//              guidelines contradict it.
// and NEVER a bare null with no provenance. The closure property at the end asserts
// that directly over the whole corpus.
//
// Pure: no model, no network, no production, no clock. Run:
//   npx --yes deno@2.9.5 run tests/donor-limits/donor_limits_test.ts

import {
  absenceIsSuspicious,
  decideLimit,
  LIMIT_RANGE,
  type LimitField,
  type LimitOutcome,
  parseDonorLimit,
  type RefusalReason,
  resolveDonorLimits,
} from "../../supabase/functions/worker/donor_limits.ts";

let bad = 0;
const ok = (c: boolean, m: string) => {
  c ? console.log(`  ok   ${m}`) : (console.error(`  FAIL ${m}`), bad++);
};

// `normalizeFmt`'s coercion as it stood before 2026-08-27, copied verbatim from the
// parent of commit b81b3d7. Not a paraphrase; the point of keeping it is that the
// corpus below is measured against the real defect and not against a straw man.
const HISTORICAL_NUM = (x: unknown, lo: number, hi: number) =>
  (typeof x === "number" && (x as number) >= lo && (x as number) <= hi ? x as number : null);

type Expect =
  | { verdict: "COERCE"; value: number }
  | { verdict: "REFUSE"; reason: RefusalReason }
  | { verdict: "ABSENT" };

interface Case {
  input: unknown;
  field: LimitField;
  expect: Expect;
  why: string;
}

const C = (input: unknown, field: LimitField, expect: Expect, why: string): Case =>
  ({ input, field, expect, why });
const coerce = (value: number): Expect => ({ verdict: "COERCE", value });
const refuse = (reason: RefusalReason): Expect => ({ verdict: "REFUSE", reason });
const absent: Expect = { verdict: "ABSENT" };

// The inputs -- and the ONLY inputs -- from which a null limit is legitimate. Asserted
// as a closed set at the end of this file: any other corpus entry that resolves to a
// null limit is a silent null and fails the suite.
const ABSENT_INPUTS: unknown[] = [null, undefined, "", "   ", "n/a", "none", "not stated", "no limit"];

const CASES: Case[] = [
  // ---------------------------------------------------------------- the finding
  C("1,400 words", "max_words", coerce(1400),
    "THE BUG. The literal form in the real donor text. Historically null; now 1400."),
  C("1400 words", "max_words", coerce(1400), "the same limit without the comma"),
  C("1400", "max_words", coerce(1400), "a bare numeric string"),
  C(1400, "max_words", coerce(1400), "a real JSON number: the only form that ever worked"),

  // ---------------------------------------------------------------- limit language
  C("up to 1,400 words", "max_words", coerce(1400), "leading limit language"),
  C("max. 1400", "max_words", coerce(1400), "abbreviation and a full stop before the digits"),
  C("Maximum: 1,400 words", "max_words", coerce(1400),
    "a labelled form, where the limit language sits before a colon"),
  C("1400 words max", "max_words", coerce(1400), "trailing limit language"),
  C("no more than 1,400 words", "max_words", coerce(1400),
    "must NOT be mistaken for 'no fewer than' -- the minimum guard is worded to exclude it"),
  C("1,400-word limit", "max_words", coerce(1400), "hyphenated attributive form"),
  C("1,400 words.", "max_words", coerce(1400), "trailing sentence punctuation"),
  C("≤1,400 words", "max_words", coerce(1400), "a mathematical operator instead of words"),
  C("approx 1,400 words", "max_words", coerce(1400),
    "approximate language ENFORCED AS HARD: treating it as advisory would remove the gate, " +
    "and a 1,400-word document satisfies an approximate 1,400 too"),
  C("1,400 words maximum, excluding annexes", "max_words", coerce(1400),
    "the NUMBER is 1400; what the limit COVERS is word_limit.ts's job and is not read here"),
  C("Max 1,400 words per application", "max_words", coerce(1400),
    "'per application' is a total, not a distributive limit -- the distributive guard lists " +
    "section/question/answer/part and does not fire on it"),

  // ---------------------------------------------------------------- non-English forms
  C("1.400 palabras", "max_words", coerce(1400),
    "dot as a thousands separator. A decimal reading gives 1.4 words, which is not a " +
    "limit any donor can mean, so the grouped reading is the only coherent one"),
  C("1 400 mots", "max_words", coerce(1400),
    "ISO/SI space grouping, accepted only because every token before the group is limit " +
    "language -- see 'Question 1 400 words' below for the same shape refused"),
  C("1 400", "max_words", coerce(1400), "space grouping with no unit word at all"),
  C("höchstens 1.400 Wörter", "max_words", coerce(1400), "German: dot grouping plus a German unit"),

  // ---------------------------------------------------------------- the two hard calls
  C("one thousand four hundred words", "max_words", refuse("word_form_number"),
    "REFUSE, argued: an English numeral parser is an unbounded new parsing surface whose " +
    "every bug yields a CONFIDENT WRONG NUMBER -- the exact shape being hunted. No donor " +
    "text in this repo writes a limit in words. Cost of refusing: one held order"),
  C("4 pages or 1,400 words, whichever is shorter", "max_words", refuse("dual_limit"),
    "REFUSE, argued: two constraints, one field. The binding one is unknown without " +
    "rendering, and the page half CANNOT BE VERIFIED AT ALL -- render-service/ is not " +
    "deployed. Coercing to 1400 silently drops the half that blocks delivery"),
  C("1,400 words (2 pages)", "max_words", refuse("dual_limit"),
    "the same dual limit without the word 'whichever'"),
  C("1,400 words (approximately 3 pages)", "max_words", refuse("dual_limit"),
    "DISCLOSED OVER-REFUSAL: here the pages are guidance, not a constraint, and this " +
    "still refuses. Distinguishing needs judgement; refusing costs a held order and " +
    "coercing risks dropping a real page cap. Strict side chosen on purpose"),

  // ---------------------------------------------------------------- wrong unit
  C("two pages", "max_words", refuse("unit_is_pages"),
    "a page count in a word field. Not convertible without font, spacing and margins, " +
    "and not verifiable without a render"),
  C("1,400 characters", "max_words", refuse("wrong_unit"),
    "the most permissive error available: 1,400 characters is roughly 230 words"),
  C("1400 lines", "max_words", refuse("wrong_unit"), "lines are not words"),
  C("no more than 20 minutes", "max_words", refuse("wrong_unit"), "a presentation limit"),
  C("$1,400", "max_words", refuse("currency"), "a budget figure in a limit field"),
  C("1,400 words", "max_pages", refuse("unit_is_words"), "the mirror case, on the page field"),

  // ---------------------------------------------------------------- inverted / scoped wrongly
  C("at least 1,400 words", "max_words", refuse("minimum_not_maximum"),
    "recorded as a maximum this inverts the constraint: the gate would then refuse every " +
    "compliant document and pass none"),
  C("1,400 words minimum", "max_words", refuse("minimum_not_maximum"), "the same, postfixed"),
  C("min 1400", "max_words", refuse("minimum_not_maximum"), "abbreviated minimum"),
  C("1,400 words per section", "max_words", refuse("distributive_limit"),
    "not a document total; using it as one is wrong in whichever direction the section " +
    "count runs"),
  C("500 words for each question", "max_words", refuse("distributive_limit"), "the same, reworded"),

  // ---------------------------------------------------------------- more than one number
  C("1,200-1,400 words", "max_words", refuse("multiple_numbers"),
    "a range. Refused under ONE rule -- more than one candidate number refuses -- which is " +
    "the same rule that makes the dual page/word limit safe. Carving a range exception " +
    "reopens it, so the range pays for the dual limit"),
  C("between 1,200 and 1,400 words", "max_words", refuse("multiple_numbers"), "the same range, spelled out"),
  C("Question 1 400 words", "max_words", refuse("multiple_numbers"),
    "IDENTICAL SHAPE to '1 400 mots' and refused, because 'question' is not limit language: " +
    "the grouping is ambiguous, so it is not joined and two numbers survive"),
  C("Section 2 400 words", "max_words", refuse("multiple_numbers"), "the same trap with a different label"),

  // ---------------------------------------------------------------- page-size digits
  C("A4", "max_pages", refuse("page_size_token"),
    "the page-size field leaking into the page-count field. Its only digit is a paper " +
    "size; reading it as a 4-page limit would be a confident wrong number"),
  C("Letter", "max_pages", refuse("page_size_token"), "the same with no digit at all"),
  C("1,400 words including the cover letter", "max_words", coerce(1400),
    "'letter' is stripped as a page-size token and the real number survives -- the strip " +
    "must not eat the limit"),

  // ---------------------------------------------------------------- wrong type / broken
  C({}, "max_words", refuse("wrong_type"),
    "an object where a number belongs. NOT absent: the schema's absence is null, and an " +
    "empty object is a mangled value, so it stops the order"),
  C({ value: 1400, unit: "words" }, "max_words", refuse("wrong_type"),
    "readable to a human and still refused: reaching into an unspecified object shape is " +
    "new guessing surface, and guessing is what produced this bug"),
  C(["1400"], "max_words", refuse("wrong_type"),
    "an array. Unwrapping a single element is more guessing surface, so it refuses"),
  C(true, "max_words", refuse("wrong_type"),
    "a boolean, which JSON.parse produces happily and typeof rejects only by accident"),
  C(Number.NaN, "max_words", refuse("non_finite"), "NaN survives typeof === 'number'"),
  C(Number.POSITIVE_INFINITY, "max_words", refuse("non_finite"), "so does Infinity"),
  C(1400.5, "max_words", coerce(1400),
    "floored, never rounded: a fractional limit can only be honoured downwards"),
  C(-100, "max_words", refuse("out_of_range"), "a negative number"),
  C("-100 words", "max_words", refuse("out_of_range"),
    "the digit scanner has no sign, so without this guard '-100 words' reads as a clean 100"),
  C("unknown", "max_words", refuse("not_a_number"),
    "'unknown' says the EXTRACTOR could not tell. That is not the donor stating no limit"),
  C("see the guidelines", "max_words", refuse("not_a_number"), "a pointer, not a value"),
  C("TBD", "max_words", refuse("not_a_number"), "not yet known is not absent"),

  // ---------------------------------------------------------------- range
  C("75 words", "max_words", coerce(75),
    "a short-summary limit. Under the old floor of 100 this returned null and the donor " +
    "got NO GATE AT ALL. The floor is 25 now, and out-of-range refuses either way, so " +
    "lowering it can only convert a silent non-gate into a real gate"),
  C("10 words", "max_words", refuse("out_of_range"), "below the floor: refused, not dropped"),
  C("1,400,000 words", "max_words", refuse("out_of_range"), "above the ceiling: refused, not dropped"),
  C("0", "max_words", refuse("out_of_range"), "zero is not a limit"),
  C(1400, "max_pages", refuse("out_of_range"), "1400 pages: refused on the page field"),

  // ---------------------------------------------------------------- page field, working
  C("4", "max_pages", coerce(4), "a bare page count"),
  C("up to 4 pages", "max_pages", coerce(4), "page count with limit language"),
  C("two pages", "max_pages", refuse("word_form_number"),
    "correct unit, unreadable number -- still refuses"),
  C("4 pages (A4)", "max_pages", coerce(4), "the page size is stripped and the count survives"),

  // ---------------------------------------------------------------- absence
  C(null, "max_words", absent, "the schema's own value for 'the donor stated nothing'"),
  C(undefined, "max_words", absent, "the field omitted entirely"),
  C("", "max_words", absent, "an empty string is the same statement"),
  C("   ", "max_words", absent, "whitespace only carries no more information than the empty string"),
  C("n/a", "max_words", absent, "an explicit not-applicable sentinel, matched EXACTLY"),
  C("none", "max_words", absent, "an explicit sentinel, matched exactly and never as a substring"),
  C("not stated", "max_words", absent, "the extractor affirming the donor stated nothing"),
  C("no limit", "max_words", absent, "the donor affirming there is no limit at all"),
  C(null, "max_pages", absent, "the page field, absent"),
];

// ============================================================ 1. every literal form

console.log("EVERY LITERAL FORM RESOLVES TO EXACTLY ONE OF COERCE / REFUSE / ABSENT");
for (const c of CASES) {
  const got = parseDonorLimit(c.input, c.field);
  const label = `${c.field} <- ${typeof c.input === "string" ? JSON.stringify(c.input) : String(c.input)}`;
  if (c.expect.verdict === "COERCE") {
    ok(got.kind === "limit" && got.value === c.expect.value,
      `${label} -> COERCE ${c.expect.value}${got.kind === "limit" && got.value === c.expect.value ? "" : `  [got ${describe(got)}]`}`);
  } else if (c.expect.verdict === "REFUSE") {
    ok(got.kind === "refused" && got.reason === c.expect.reason,
      `${label} -> REFUSE ${c.expect.reason}${got.kind === "refused" && got.reason === c.expect.reason ? "" : `  [got ${describe(got)}]`}`);
  } else {
    ok(got.kind === "absent", `${label} -> ABSENT${got.kind === "absent" ? "" : `  [got ${describe(got)}]`}`);
  }
}

function describe(o: LimitOutcome): string {
  return o.kind === "limit" ? `limit ${o.value}` : o.kind === "absent" ? "absent" : `refused ${o.reason}`;
}

// ============================================================ 2. the closure property
// This is the assertion the whole task turns on: a null limit must have exactly one
// provenance. If any corpus entry outside ABSENT_INPUTS produced a null, that is a
// silent null and the module has the defect it was written to remove.

console.log("\nNO SILENT NULL: a null limit has exactly one provenance");
{
  let leaks = 0;
  for (const c of CASES) {
    const got = parseDonorLimit(c.input, c.field);
    const nulled = got.kind !== "limit";
    const declared = ABSENT_INPUTS.some((a) => Object.is(a, c.input));
    if (nulled && got.kind === "absent" && !declared) {
      console.error(`    leak: ${JSON.stringify(c.input)} resolved absent but is not a declared absent input`);
      leaks++;
    }
    // A refusal is not a null: it carries a reason and a detail, and both must be
    // non-empty or the caller has nothing to record.
    if (got.kind === "refused" && (!got.reason || !got.detail)) {
      console.error(`    empty refusal for ${JSON.stringify(c.input)}`);
      leaks++;
    }
  }
  ok(leaks === 0, `${CASES.length} forms, ${leaks} silent nulls or empty refusals`);
}

// ============================================================ 3. the historical parser
// Proves the corpus tests the real bug rather than a straw man.

console.log("\nAGAINST THE PARSER AS IT STOOD (b81b3d7^): how many of these it silently dropped");
{
  const shouldGate = CASES.filter((c) => c.expect.verdict === "COERCE");
  const old = shouldGate.filter((c) => HISTORICAL_NUM(c.input, 100, 100000) === null);
  ok(HISTORICAL_NUM("1,400 words", 100, 100000) === null,
    "the reported bug reproduces: the old parser returns null for \"1,400 words\"");
  ok(parseDonorLimit("1,400 words", "max_words").kind === "limit",
    "and the new one returns a limit for the same input");
  ok(old.length >= 20,
    `${old.length} of ${shouldGate.length} forms that carry a real donor limit were silently dropped by the old parser`);
  // And every form the old parser DID accept must still be accepted, at the same value:
  // no coercion may be lost while adding coercions.
  let regressed = 0;
  for (const c of CASES) {
    const o = HISTORICAL_NUM(c.input, LIMIT_RANGE[c.field].lo, LIMIT_RANGE[c.field].hi);
    if (o === null) continue;
    const got = parseDonorLimit(c.input, c.field);
    if (!(got.kind === "limit" && got.value === Math.floor(o))) regressed++;
  }
  ok(regressed === 0, "every value the old parser accepted is still accepted, unchanged");
}

// ============================================================ 3b. the parser IN THE REPO NOW
// AUDITING THE BRIEF. The finding this fixture set was commissioned from describes
// `normalizeFmt` as accepting a limit only when `typeof x === "number"`. That is the
// state at b81b3d7^ and it is NOT the state of the working tree: commit b81b3d7 added
// `numLike`, which already strips commas and pulls the first digit run out of a
// string, so `"1,400 words"` reaches 1400 today. Saying otherwise would overstate the
// defect. CURRENT_NUMLIKE below is that function, verbatim from
// `supabase/functions/worker/index.ts` (the numLike + num pair inside normalizeFmt).
//
// What survives, and is the reason this module exists: numLike takes the FIRST digit
// run and asks no questions about it, so on the forms below it does not fail -- it
// succeeds, with a wrong number. That is the same "reports success while doing
// nothing" shape one turn further on, and it is more dangerous than the null was,
// because a wrong limit looks exactly like a right one downstream.

const CURRENT_NUMLIKE = (x: unknown): number | null => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x !== "string") return null;
  const m = x.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const CURRENT_NUM = (x: unknown, lo: number, hi: number): number | null => {
  const n = CURRENT_NUMLIKE(x);
  return n !== null && n >= lo && n <= hi ? n : null; // else -> limitUnparsed, i.e. refuse
};

console.log("\nAGAINST THE PARSER IN THE REPO NOW: forms it accepts with a WRONG number");
{
  // input, field, what numLike yields today, what this module must now do.
  // "REFUSE" means any refusal; a number means that exact coerced value.
  const T: Array<[unknown, LimitField, number | null, "REFUSE" | number, string]> = [
    ["1,400 characters", "max_words", 1400, "REFUSE", "a character limit read as a word limit: ~6x too permissive"],
    ["at least 1,400 words", "max_words", 1400, "REFUSE", "a floor recorded as a ceiling"],
    ["1,400 words per section", "max_words", 1400, "REFUSE", "a per-section limit recorded as a document total"],
    ["1400 words or 4 pages", "max_words", 1400, "REFUSE", "the page half of a dual limit silently dropped"],
    ["1,200-1,400 words", "max_words", 1200, "REFUSE", "the lower end of a range taken as the limit"],
    ["$1,400", "max_words", 1400, "REFUSE", "a budget figure read as a word limit"],
    ["A4", "max_pages", 4, "REFUSE", "a paper size read as a four-page limit"],
    // FIXTURE CORRECTION (2026-08-27): the baseline column holds what CURRENT_NUM
    // returns, not what numLike returns. numLike yields 2 here; the range check then
    // turns it into null, i.e. today this already refuses via limitUnparsed. Recorded
    // as null. Not a weakening -- the required outcome is still REFUSE, and the
    // baseline assertion above is what caught my wrong value.
    ["Section 2 400 words", "max_words", null, "REFUSE", "numLike takes the first digit run, 2; the range check then refuses it"],
    ["1 400 mots", "max_words", null, 1400, "numLike drops the group and yields 1; out of range, so today it refuses. Now read correctly"],
    ["1.400 palabras", "max_words", null, 1400, "numLike yields 1.4; out of range, so today it refuses. Now read correctly"],
  ];
  let violations = 0;
  for (const [input, field, expectedOld, expectNow, why] of T) {
    const before = CURRENT_NUM(input, LIMIT_RANGE[field].lo, LIMIT_RANGE[field].hi);
    const after = parseDonorLimit(input, field);
    // The recorded numLike value is asserted too, so this comparison cannot drift into
    // a claim about a parser that is not the one in the repo.
    if (before !== expectedOld) {
      console.error(`    numLike baseline wrong for ${JSON.stringify(input)}: expected ${expectedOld}, got ${before}`);
      violations++;
    }
    const want = expectNow === null ? "REFUSE" : expectNow;
    const held = want === "REFUSE" ? after.kind === "refused" : after.kind === "limit" && after.value === want;
    if (!held) {
      console.error(`    ${JSON.stringify(input)}: wanted ${String(want)}, got ${describe(after)}`);
      violations++;
    }
    console.log(`       ${JSON.stringify(input)}: numLike -> ${before}; now -> ${describe(after)}   (${why})`);
  }
  ok(violations === 0, `${T.length} forms where numLike is wrong or lossy: ${violations} not corrected`);
  ok(CURRENT_NUM("1,400 characters", 25, 100000) === 1400 &&
    parseDonorLimit("1,400 characters", "max_words").kind === "refused",
    "the sharpest case: numLike accepts \"1,400 characters\" as 1400 words; this refuses it");
  ok(CURRENT_NUM("1 400 mots", 25, 100000) === null &&
    parseDonorLimit("1 400 mots", "max_words").kind === "limit",
    "and the opposite direction: numLike loses \"1 400 mots\" to its range check; this reads 1400");
}

// ============================================================ 4. absence cross-check
// An absence the donor's own guidelines contradict is a refusal. This is what stops
// "the extractor dropped the limit" and "the donor stated no limit" being the same
// observable state.

console.log("\nA CONTRADICTED ABSENCE REFUSES");
const UKY = `Answer the five questions below in order, using each question as a heading,
exactly as written. The five answers together must not exceed 1,400 words. Applications
over the limit are returned unread. A one-page budget table must be attached.`;
{
  const d = decideLimit(null, "max_words", UKY);
  ok(d.kind === "refused" && d.reason === "absence_contradicted",
    "max_words null against a donor that states 1,400 words -> REFUSE");
  ok(decideLimit(null, "max_words", "").kind === "absent",
    "max_words null with no guidelines at all -> ABSENT (nothing to contradict it)");
  ok(decideLimit(null, "max_words", "Tell us about your work. Attach a budget.").kind === "absent",
    "a donor that states no limit -> ABSENT");
  ok(decideLimit(null, "max_words", "There is no word limit for this application.").kind === "absent",
    "a donor that says there is no limit must NOT read as a contradicted absence");
  ok(decideLimit(1400, "max_words", UKY).kind === "limit",
    "the cross-check only ever fires on an absence: a stated limit is untouched");
  ok(absenceIsSuspicious(UKY, "max_pages") === null,
    "a word limit in the guidelines does not make an absent PAGE limit suspicious");
  ok(absenceIsSuspicious("Your answer must fit on 4 pages.", "max_pages") !== null,
    "a stated page limit does");
}

// ============================================================ 5. the caller's contract
// `resolveDonorLimits` is what normalizeFmt delegates to. Its promise: maxWords is
// null if and only if the outcome is `absent`, and every refusal reaches limitUnparsed.

console.log("\nresolveDonorLimits: null if and only if absent, refusals always recorded");
{
  const probes: Array<Record<string, unknown>> = [
    {}, { max_words: "1,400 words" }, { max_words: "two pages" }, { max_words: 1400, max_pages: "A4" },
    { max_words: "one thousand four hundred words", max_pages: 4 },
    { max_words: "4 pages or 1,400 words, whichever is shorter" },
    { max_words: "" }, { max_words: {} }, { max_words: "1.400 palabras", max_pages: "up to 4 pages" },
  ];
  let violations = 0;
  for (const p of probes) {
    const r = resolveDonorLimits(p, "");
    for (const f of ["max_words", "max_pages"] as LimitField[]) {
      const o = r.limitOutcomes[f];
      const v = f === "max_words" ? r.maxWords : r.maxPages;
      if ((v === null) !== (o.kind !== "limit")) violations++;
      if (o.kind === "absent" && v !== null) violations++;
      if (o.kind === "refused" && !r.limitUnparsed.some((s) => s.startsWith(`${f}=`))) violations++;
      if (o.kind === "limit" && v !== o.value) violations++;
    }
  }
  ok(violations === 0, `${probes.length} format_spec probes, ${violations} contract violations`);

  const r = resolveDonorLimits({ max_words: "4 pages or 1,400 words, whichever is shorter" }, "");
  ok(r.maxWords === null && r.limitUnparsed.length === 1 && r.limitUnparsed[0].includes("dual_limit"),
    "the dual limit reaches limitUnparsed, which is what stops the order at package");
  ok(resolveDonorLimits(null, "").limitUnparsed.length === 0 &&
    resolveDonorLimits(null, "").maxWords === null,
    "EMPTY_FMT is unchanged: normalizeFmt(null) still yields no limit and no refusal");
}

// ============================================================ 6. determinism and purity

console.log("\nDETERMINISTIC AND PURE");
{
  let unstable = 0;
  for (const c of CASES) {
    const a = JSON.stringify(parseDonorLimit(c.input, c.field));
    const b = JSON.stringify(parseDonorLimit(c.input, c.field));
    if (a !== b) unstable++;
  }
  ok(unstable === 0, "every form returns an identical outcome on a second call");
  ok(parseDonorLimit("1,400 WORDS", "max_words").kind === "limit" &&
    parseDonorLimit("1,400 Words", "max_words").kind === "limit",
    "case does not change the verdict");
  // Regex state leakage: GROUP_COMMA and friends carry the /g flag, and a /g regex
  // used with .test() advances lastIndex. Running the same input twice above already
  // covers it; this asserts it across alternating inputs too.
  const seq = ["1,400 words", "A4", "1,400 words", "two pages", "1,400 words"];
  ok(seq.every((s) => JSON.stringify(parseDonorLimit(s, "max_words")) ===
    JSON.stringify(parseDonorLimit(s, "max_words"))),
    "no regex lastIndex leakage across alternating inputs");
}

// ============================================================ 7. the corpus itself

console.log("\nFIXTURE-SET HYGIENE (auditing the test, not the code)");
{
  const seen = new Set<string>();
  let dup = 0;
  for (const c of CASES) {
    // Type-aware, because JSON.stringify(NaN) and JSON.stringify(Infinity) are both
    // the string "null" -- the first version of this key collided them with the null
    // fixture and reported three duplicates that do not exist. Corrected, not relaxed:
    // the assertion still demands zero duplicates.
    const k = `${c.field}::${typeof c.input}::${
      typeof c.input === "number" ? String(c.input) : JSON.stringify(c.input) ?? "undefined"
    }`;
    if (seen.has(k)) { console.error(`    duplicate fixture: ${k}`); dup++; }
    seen.add(k);
  }
  ok(dup === 0, `${CASES.length} fixtures, no duplicate input/field pair`);
  ok(CASES.every((c) => c.why.trim().length > 15), "every fixture states why its verdict is the required one");
  const verdicts = new Set(CASES.map((c) => c.expect.verdict));
  ok(verdicts.size === 3, "the corpus exercises all three outcomes");
  const reasons = new Set(CASES.filter((c) => c.expect.verdict === "REFUSE")
    .map((c) => (c.expect as { reason: RefusalReason }).reason));
  const declared: RefusalReason[] = [
    "wrong_type", "non_finite", "not_a_number", "word_form_number", "multiple_numbers",
    "dual_limit", "unit_is_pages", "unit_is_words", "wrong_unit", "currency",
    "minimum_not_maximum", "distributive_limit", "page_size_token", "out_of_range",
    "absence_contradicted",
  ];
  const uncovered = declared.filter((r) => r !== "absence_contradicted" && !reasons.has(r));
  ok(uncovered.length === 0, `every declared refusal reason has a fixture (uncovered: ${uncovered.join(", ") || "none"})`);
  ok(CASES.filter((c) => c.expect.verdict === "COERCE").length >= 20 &&
    CASES.filter((c) => c.expect.verdict === "REFUSE").length >= 20,
    "the corpus is not lopsided: both verdicts are exercised at least 20 times");
}

console.log(bad ? `\n${bad} FAILURE(S)` : `\nALL DONOR-LIMIT TESTS PASSED (${CASES.length} literal forms)`);
if (bad) Deno.exit(1);
