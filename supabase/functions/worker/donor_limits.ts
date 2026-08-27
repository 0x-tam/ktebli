// Donor limits: read the number, or refuse. Never a silent null.
//
// THE DEFECT THIS EXISTS FOR.
// `analyze` asks a model for `format_spec.max_words` and `format_spec.max_pages`.
// Until 2026-08-27 `normalizeFmt` coerced those with, verbatim:
//
//     const num = (x, lo, hi) => (typeof x === "number" && x >= lo && x <= hi ? x : null);
//
// and `jsonOf` is a bare `JSON.parse`, so a model that answered `"1,400 words"` --
// the literal form the real donor text in this repo uses -- produced `maxWords: null`.
// A null limit is not a strict limit. It is NO GATE AT ALL: `contentViolations`
// guards with `if (opts.maxWords && ...)`, so generation, validate and package all
// skipped the word check and every one of them recorded success. That is the shape
// this module exists to remove -- a check that reports success while doing nothing.
//
// WHAT THIS MODULE PROMISES. `parseDonorLimit` returns a three-way discriminated
// outcome and nothing else:
//
//   limit    a confident, correct integer inside the field's range
//   absent   the donor stated no limit -- an explicit, recorded state, and the ONLY
//            provenance from which `Fmt.maxWords` may legally be null
//   refused  the value was stated and could not be read confidently; the caller must
//            push it into `Fmt.limitUnparsed`, which stops the order
//
// There is no fourth outcome and no path that returns null quietly. `decideLimit`
// additionally refuses an `absent` that the donor's own guidelines contradict, so
// "the extractor dropped the limit" and "the donor stated no limit" stop being the
// same observable state.
//
// SAFETY DIRECTION (invariant 5). Compliance is never traded. Where a form could be
// read strictly or permissively, this reads it strictly, and where two readings
// exist at all it refuses. Being wrong toward REFUSE costs one held order, which is
// visible. Being wrong toward a silent null ships a document whose compliance is
// unknown, which is not. Every rule below is chosen on that asymmetry, and the two
// judgement calls that could have gone the other way -- word-form numerals and dual
// page/word limits -- are argued in the comments where they are implemented.
//
// PURE. No I/O, no network, no model call, no clock, no randomness. Same input,
// same output, forever.

export type LimitField = "max_words" | "max_pages";

export type RefusalReason =
  | "wrong_type"            // a boolean, an array, an object where a number belongs
  | "non_finite"            // NaN, Infinity
  | "not_a_number"          // a string with no digits and no numeral words
  | "word_form_number"      // "one thousand four hundred words"
  | "multiple_numbers"      // two or more candidate values in one field
  | "dual_limit"            // a page limit and a word limit in the same breath
  | "unit_is_pages"         // a page count sitting in max_words
  | "unit_is_words"         // a word count sitting in max_pages
  | "wrong_unit"            // characters, lines, minutes, percent, bytes
  | "currency"              // a money figure in a limit field
  | "minimum_not_maximum"   // "at least 1,400 words"
  | "distributive_limit"    // "1,400 words per section"
  | "page_size_token"       // "A4" -- whose only digit is not a count
  | "out_of_range"          // parsed cleanly, outside what a donor can plausibly mean
  | "absence_contradicted"; // field said nothing, guidelines state a limit

export type LimitOutcome =
  | { kind: "limit"; field: LimitField; value: number; source: string; notes: string[] }
  | { kind: "absent"; field: LimitField; source: string }
  | { kind: "refused"; field: LimitField; source: string; reason: RefusalReason; detail: string };

// Plausible bounds for a stated limit. Outside these the value is REFUSED, never
// dropped -- which is the whole change from the old `num()`, whose out-of-range
// branch returned null and therefore removed the gate.
//
// The word floor is 25, not the old 100. Under the old code a donor asking for a
// 75-word summary got no gate at all; under this module an out-of-range value stops
// the order either way, so lowering the floor can only turn a silent non-gate into a
// real gate. It cannot create a refusal that 100 would not also have created.
export const LIMIT_RANGE: Record<LimitField, { lo: number; hi: number }> = {
  max_words: { lo: 25, hi: 100000 },
  max_pages: { lo: 1, hi: 200 },
};

// Values that AFFIRM absence. Exact matches only, after normalisation -- a substring
// rule would let "no limit on annexes; 1,400 words for the answers" read as absent.
// "unknown", "unclear", "tbd" and "see guidelines" are deliberately NOT here: those
// say the extractor could not tell, which is a refusal, not an absence.
const ABSENT_SENTINELS = new Set([
  "n/a", "n.a.", "na", "none", "no limit", "no word limit", "no page limit",
  "not stated", "not specified", "not applicable", "unspecified", "unstated",
  "not given", "no maximum", "null", "nil", "-", "--", "—",
]);

// Alphabetic tokens that may legitimately sit before a number in a limit field. Used
// only to decide whether a space- or dot-separated digit group is one number
// ("1 400 mots") or two ("Section 2 400 words"). An unrecognised token means the
// grouping is ambiguous, the group is NOT joined, and two candidate numbers survive
// into the multiple_numbers refusal. Unknown context therefore refuses.
const GROUPING_PREFIX_OK = new Set([
  "max", "maximum", "maximal", "maximo", "máximo", "up", "to", "upto", "no", "more",
  "than", "not", "exceed", "exceeding", "limit", "limited", "of", "at", "most",
  "approx", "approximately", "about", "around", "circa", "roughly", "word", "words",
  "count", "total", "in", "under", "below", "within", "please", "keep", "answer",
  "answers", "must", "be", "hasta", "jusqu", "jusqua", "environ", "bis", "hoechstens",
  "höchstens", "etwa", "und", "the", "a", "an",
]);

const NUMERAL_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/;

const WORD_UNIT =
  /\b(words?|wordcount|mots?|palabras?|w[oö]rter|worte|parole|palavras?|slov)\b/;
const PAGE_UNIT =
  /\b(pages?|sides?|sheets?|seiten|p[aá]ginas?|feuillets?|folios?)\b/;
const OTHER_UNIT =
  /\b(characters?|chars?|character|signs?|bytes?|kb|mb|keystrokes?|lines?|paragraphs?|sentences?|slides?|minutes?|mins?|hours?|zeichen|caracteres?|caract[eè]res?)\b|%/;
const CURRENCY = /[$£€¥₹]|\b(usd|eur|gbp|chf|aed|sar|cad|aud|jpy|dollars?|euros?|pounds?)\b/;
const MINIMUM = /\b(at least|minimum|minimo|mínimo|no fewer than|no less than|not less than|not fewer than|at a minimum|lower limit|min)\b\.?/;
const DISTRIBUTIVE =
  /\b(per|for each|for every)\s+(section|question|answer|response|part|heading|item|criterion|criteria|page|chapter|box|field|attachment)\b|\b(each|every)\s+(section|question|answer|response|part|heading|item)\b/;
const WHICHEVER = /\bwhichever\b|\bwhatever is (shorter|smaller|less)\b/;
const NEGATIVE = /(^|[\s(=:])[-−]\s*\d/;
const PAGE_SIZE_TOKEN = /\b(a[3-6]|b[45]|letter|legal|foolscap|tabloid)\b/g;
const APPROX = /\b(approx|approximately|about|around|circa|roughly|ca)\b\.?|~/;
const SCOPE_LANGUAGE = /\b(exclud\w*|includ\w*|excepting|other than|not count\w*|counts? towards?)\b/;

// Digit groups. Comma grouping is unconditional -- "1,400" is the literal form in the
// real donor text and a comma is never a separator between two distinct numbers in a
// limit field. Dot and space grouping are conditional (see groupDigits) because
// "2.4" and "Section 2 400" are real and would otherwise be misread as one number.
const GROUP_COMMA = /\b\d{1,3}(?:,\d{3})+\b/g;
const GROUP_DOT = /\b\d{1,3}(?:\.\d{3})+\b(?!\.?\d)/g;
const SEP_SPACE = "[ \\u00A0\\u202F\\u2009]";
const GROUP_SPACE = new RegExp(`\\b\\d{1,3}(?:${SEP_SPACE}\\d{3})+\\b(?!\\d)`, "g");
const ANY_NUMBER = /\d+(?:\.\d+)?/g;

const normSentinel = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Join a conditional digit group only when everything before it in the string is
 * limit language. Returns the rewritten text; an ambiguous group is left alone so it
 * decomposes into two numbers and refuses.
 */
function groupDigits(text: string, re: RegExp, strip: RegExp): { text: string; ambiguous: boolean } {
  let ambiguous = false;
  const out = text.replace(re, (m, offset: number) => {
    const before = text.slice(0, offset);
    const tokens = before.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
    if (/\d/.test(before)) { ambiguous = true; return m; }
    if (!tokens.every((t) => GROUPING_PREFIX_OK.has(t))) { ambiguous = true; return m; }
    return m.replace(strip, "");
  });
  return { text: out, ambiguous };
}

function refuse(
  field: LimitField, source: string, reason: RefusalReason, detail: string,
): LimitOutcome {
  return { kind: "refused", field, source, reason, detail };
}

/**
 * Read one donor limit value. The value is whatever `analyze` put in
 * `format_spec.max_words` / `format_spec.max_pages` -- a model-written JSON field, so
 * it may be any JSON type at all.
 */
export function parseDonorLimit(raw: unknown, field: LimitField): LimitOutcome {
  const { lo, hi } = LIMIT_RANGE[field];
  const source = raw === undefined ? "undefined" : JSON.stringify(raw) ?? "undefined";

  if (raw === null || raw === undefined) return { kind: "absent", field, source };

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return refuse(field, source, "non_finite", `${raw}`);
    const notes: string[] = [];
    let v = raw;
    if (!Number.isInteger(v)) {
      // Floor, never round: a fractional limit can only be honoured downwards
      // without risking a document one word over what the donor allows.
      v = Math.floor(v);
      notes.push("non_integer_floored");
    }
    if (v < lo || v > hi) return refuse(field, source, "out_of_range", `${v} outside ${lo}..${hi}`);
    return { kind: "limit", field, value: v, source, notes };
  }

  if (typeof raw !== "string") {
    return refuse(field, source, "wrong_type", `typeof ${Array.isArray(raw) ? "array" : typeof raw}`);
  }

  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "absent", field, source };

  const sent = normSentinel(trimmed);
  if (ABSENT_SENTINELS.has(sent)) return { kind: "absent", field, source };

  const lower = sent;

  // --- guards that do not need a number, most informative first ---------------

  // A conditional limit ("whichever is shorter") is two constraints. It is refused
  // even when both halves parse, because only one of them can be recorded in this
  // field and dropping the other silently is exactly the defect being removed.
  if (WHICHEVER.test(lower)) return refuse(field, source, "dual_limit", "conditional limit");

  // MINIMUM is tested BEFORE OTHER_UNIT on purpose: OTHER_UNIT's `\bmins?\b` also
  // matches the abbreviation in "min 1400", and would report a unit problem where the
  // real defect is an inverted constraint. Both refuse; only the reason changes, and
  // the reason is the only thing the operator reads.
  if (MINIMUM.test(lower)) {
    // "at least 1,400 words" recorded as maxWords inverts the constraint: the gate
    // would then refuse every compliant document and pass none.
    return refuse(field, source, "minimum_not_maximum", (lower.match(MINIMUM) ?? [""])[0]);
  }
  if (OTHER_UNIT.test(lower)) {
    // A character limit is roughly a sixth of the word count it implies. Reading
    // "1,400 characters" as 1,400 words would be the single most permissive error
    // this module could make.
    return refuse(field, source, "wrong_unit", (lower.match(OTHER_UNIT) ?? [""])[0]);
  }
  if (CURRENCY.test(lower)) return refuse(field, source, "currency", (lower.match(CURRENCY) ?? [""])[0]);
  // ANY_NUMBER has no sign, so "-100" would otherwise read as a clean 100. A negative
  // limit is a broken extraction, not a limit.
  if (NEGATIVE.test(lower)) return refuse(field, source, "out_of_range", "negative value");
  if (DISTRIBUTIVE.test(lower)) {
    // "1,400 words per section" is not a document total. Using it as one is wrong in
    // both directions depending on section count, so it refuses rather than guesses.
    return refuse(field, source, "distributive_limit", (lower.match(DISTRIBUTIVE) ?? [""])[0]);
  }

  const hasWordUnit = WORD_UNIT.test(lower);
  const hasPageUnit = PAGE_UNIT.test(lower);
  if (hasWordUnit && hasPageUnit) {
    // "4 pages or 1,400 words". Both halves bind and the binding one is unknown
    // without rendering. The page half cannot be verified at all: `render-service/`
    // is not deployed, and `renderService()` already refuses loudly when a page limit
    // exists and the service is unreachable. Coercing to the word half would drop the
    // half that stops delivery -- a permissive read of a compliance constraint.
    return refuse(field, source, "dual_limit", "page and word limit in one value");
  }
  if (field === "max_words" && hasPageUnit) {
    // A page count cannot be converted to a word count without knowing the font, the
    // spacing and the margins the donor mandates, and even with them the count is only
    // verifiable by rendering. "two pages" therefore refuses regardless of numerals.
    return refuse(field, source, "unit_is_pages", (lower.match(PAGE_UNIT) ?? [""])[0]);
  }
  if (field === "max_pages" && hasWordUnit) {
    return refuse(field, source, "unit_is_words", (lower.match(WORD_UNIT) ?? [""])[0]);
  }

  // --- number extraction ------------------------------------------------------

  // Page-size tokens carry a digit that is not a count. "A4" in max_pages must not
  // become a four-page limit. Strip them first; if nothing numeric survives, the
  // value was a page size and refuses under its own reason.
  let sawPageSize = false;
  let work = lower.replace(PAGE_SIZE_TOKEN, () => { sawPageSize = true; return " "; });

  work = work.replace(GROUP_COMMA, (m) => m.replace(/,/g, ""));
  const dot = groupDigits(work, GROUP_DOT, /\./g);
  work = dot.text;
  const space = groupDigits(work, GROUP_SPACE, new RegExp(SEP_SPACE, "g"));
  work = space.text;

  const found = work.match(ANY_NUMBER) ?? [];
  const values = [...new Set(found.map(Number))].filter((n) => Number.isFinite(n));

  if (values.length === 0) {
    if (sawPageSize) return refuse(field, source, "page_size_token", "page size, not a count");
    if (NUMERAL_WORDS.test(lower)) {
      // JUDGEMENT CALL, argued rather than assumed. An English numeral parser is a new
      // unbounded parsing surface -- scale words, "and", hyphenation, ordinals, and
      // "hundred thousand" -- and every bug in it yields a CONFIDENT WRONG NUMBER,
      // which is a worse failure than a held order and is the exact shape being hunted.
      // No donor text in this repository writes a limit in words; the real one writes
      // "1,400 words". Refusing costs one held order in a form never yet observed.
      // Revisit only with a corpus of real donor pages that use it.
      return refuse(field, source, "word_form_number", "limit written in words");
    }
    return refuse(field, source, "not_a_number", "no digits");
  }
  if (values.length > 1) {
    const why = dot.ambiguous || space.ambiguous ? "ambiguous digit grouping" : "candidates";
    return refuse(field, source, "multiple_numbers", `${why}: ${values.join(", ")}`);
  }

  const notes: string[] = [];
  let value = values[0];
  if (!Number.isInteger(value)) { value = Math.floor(value); notes.push("non_integer_floored"); }
  if (sawPageSize) notes.push("page_size_token_ignored");
  if (APPROX.test(lower)) {
    // "approx 1,400 words" is enforced as a hard 1,400. That is the strict reading:
    // treating it as advisory would remove the gate, and a document at 1,400 satisfies
    // an approximate limit too.
    notes.push("approximate_language_enforced_as_hard_limit");
  }
  if (SCOPE_LANGUAGE.test(lower)) {
    // e.g. "1,400 words maximum, excluding annexes". The NUMBER is 1,400. What the
    // limit COVERS is decided by word_limit.ts from the donor's guidelines, and is not
    // read from this field -- a scope narrowed on the strength of one model-written
    // string would be the one change here that could loosen the gate.
    notes.push("scope_language_present_scope_decided_elsewhere");
  }
  if (!hasWordUnit && !hasPageUnit && /[a-zà-ÿ]/.test(lower.replace(PAGE_SIZE_TOKEN, " "))) {
    notes.push("unit_not_stated");
  }
  if (value < lo || value > hi) return refuse(field, source, "out_of_range", `${value} outside ${lo}..${hi}`);
  return { kind: "limit", field, value, source, notes };
}

/**
 * Does the donor's own text state a limit for this field? Used to catch the case the
 * whole module is downstream of: the extractor returning null for a limit the donor
 * plainly stated. Deliberately narrow -- it looks for a stated limit, not for the
 * topic -- and it never fires on text that says there is no limit.
 */
export function absenceIsSuspicious(guidelines: string, field: LimitField): string | null {
  const g = (guidelines || "").toLowerCase();
  if (!g.trim()) return null;
  if (/\bno (word|page)?\s*(limit|maximum)\b|\bthere is no limit\b|\bunlimited\b/.test(g)) return null;
  const numeric = field === "max_words"
    ? /\b\d[\d,.\u0020\u00A0\u202F]*\s*(words?|mots?|palabras?|w[oö]rter)\b/
    : /\b\d[\d,. ]*\s*(pages?|sides?|seiten|p[aá]ginas?)\b/;
  const phrase = field === "max_words"
    ? /\bword (limit|count|maximum)\b|\b(must not exceed|no more than|not exceeding|maximum of|up to)\b[^.]{0,40}\bwords?\b/
    : /\bpage (limit|maximum)\b|\b(must not exceed|no more than|not exceeding|maximum of|up to)\b[^.]{0,40}\bpages?\b/;
  const m = g.match(numeric) ?? g.match(phrase);
  return m ? m[0].trim().slice(0, 80) : null;
}

/**
 * The whole decision for one field: parse, then cross-check an absence against the
 * donor's own words. This is the only function `normalizeFmt` needs.
 */
export function decideLimit(raw: unknown, field: LimitField, guidelines = ""): LimitOutcome {
  const out = parseDonorLimit(raw, field);
  if (out.kind !== "absent") return out;
  const hit = absenceIsSuspicious(guidelines, field);
  if (hit) {
    // The field said nothing and the donor said something. One of the two is wrong and
    // the pipeline cannot tell which, so it stops. This is the assertion that makes
    // `maxWords === null` mean "the donor stated no limit" rather than "nobody knows".
    return refuse(field, out.source, "absence_contradicted", hit);
  }
  return out;
}

/** The string the caller pushes into `Fmt.limitUnparsed`. Stable and greppable. */
export function unparsedLabel(o: LimitOutcome): string {
  return o.kind === "refused" ? `${o.field}=${o.source} (${o.reason}: ${o.detail})` : "";
}

/**
 * Everything `normalizeFmt` needs, in one call. Returns the two numeric limits, the
 * unparsed labels that must stop the order, and a per-field record of how each value
 * was resolved (invariant 9: nothing decides silently).
 *
 * `maxWords`/`maxPages` are null ONLY when the corresponding outcome is `absent`.
 * That is asserted here rather than left to the caller.
 */
export function resolveDonorLimits(
  raw: unknown,
  guidelines = "",
): {
  maxWords: number | null;
  maxPages: number | null;
  limitUnparsed: string[];
  limitOutcomes: Record<LimitField, LimitOutcome>;
} {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const words = decideLimit(r.max_words, "max_words", guidelines);
  const pages = decideLimit(r.max_pages, "max_pages", guidelines);
  const limitUnparsed = [words, pages].filter((o) => o.kind === "refused").map(unparsedLabel);
  return {
    maxWords: words.kind === "limit" ? words.value : null,
    maxPages: pages.kind === "limit" ? pages.value : null,
    limitUnparsed,
    limitOutcomes: { max_words: words, max_pages: pages },
  };
}
