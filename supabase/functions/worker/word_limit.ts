// What a donor's word limit actually covers.
//
// THE DEFECT THIS EXISTS FOR. `wordCount()` counts the whole markdown document and
// `contentViolations()` compares that against the donor's limit. But donors scope
// their limits. Both benchmark fixtures say, in terms:
//
//   "Answer the five questions below in order, using each question as a heading,
//    exactly as written. The five answers together must not exceed 1,400 words."
//   "A one-page budget table must be attached..."
//
// The budget table is ATTACHED. The declaration is separate. Neither is part of "the
// five answers". Counting them makes the document look far longer than the donor
// would measure it, and the correction loop then instructs the generator to "cut at
// least N words" from prose that was already inside the limit.
//
// Measured across the 16 benchmark documents: the pipeline arms used 43-70% of the
// words they were allowed, while the single-prompt arms used 94-120%. A proposal
// spending 43% of its allowance has thrown away more than half the room it had to be
// specific in -- and thin, generic prose is the headline quality complaint. This is
// not the only cause, but it is a mechanical one and it is cheap to remove.
//
// SAFETY DIRECTION. Invariant 5 says compliance is never traded, so this must never
// become more permissive than the donor allows. The scope therefore defaults to
// WHOLE -- today's behaviour, the strict reading -- and narrows only when the
// donor's own guidelines say attachments sit outside the limit. Being wrong here
// ships an over-length document, so the default is the safe one.
//
// SECOND DEFECT, closed 2026-08-27 (invariant 5, patch-compliance-limits.md P1).
// The first version of this file let the DOCUMENT decide what left the count:
//   * any line matching /^Q?\s*[1-9][.)]\s/ was treated as a heading and dropped, so
//     the markdown ordered list FORMAT_RULES tells the generator to use for phased
//     delivery vanished from the count in full -- an 86-word answer counted as 0;
//   * the attachment test matched on a PREFIX, so a heading beginning "Budget",
//     "Annex", "Appendix" or "Declaration" swallowed every word beneath it until the
//     next heading. "Budget and value for money" is a routine donor question and the
//     pipeline already packages the real budget as a separate Budget.xlsx.
// Both routes let the model shorten the counted span by choosing how it wrote, which
// is compliance by truncation. Both are gone. Every change here counts MORE text
// than before, never less.

export type LimitScope = "whole" | "answers";

// A paragraph longer than this inside a section named as an attachment is prose, and
// prose is part of the application whatever the section is called.
const PROSE_LINE_WORDS = 25;

// The only section names that may leave the count without the donor naming them.
// EXACT normalised matches, never prefixes: "budget table" is an attachment,
// "budget and value for money" is a donor question and is counted. Extending this
// list makes the counter more permissive, so it stays short and literal.
const DEFAULT_ATTACHMENTS = [
  "budget",
  "budget table",
  "budget summary",
  "attached budget table",
  "declaration",
  "declarations",
  "annex",
  "annexes",
  "appendix",
  "appendices",
  "attachment",
  "attachments",
  "signature",
  "signatures",
  "signatory",
  "signatories",
  "supporting document",
  "supporting documents",
  "supporting information",
];

// Normalise a heading for comparison. Markdown, punctuation and the donor's own
// leading numbering come off both sides, so "## Q3. Budget table" and the donor's
// "Budget table" are the same heading, while "Budget and value for money" is not.
const norm = (s: string) =>
  s.toLowerCase().replace(/^#{1,6}\s*/, "").replace(/[*_`]/g, "")
    .replace(/^(q|question|section|part)\s*\d+\s*[.):-]?\s*/i, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const wordsIn = (s: string) =>
  s.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/**
 * Read the donor's own words to decide what the limit covers.
 * Conservative: returns "whole" unless the guidelines actually say otherwise.
 */
export function limitScopeFrom(guidelines: string): LimitScope {
  const g = (guidelines || "").toLowerCase();
  // "The five answers together must not exceed N words" scopes the limit to answers.
  const answersScoped =
    /\b(answers?|responses?|questions?)\b[^.]{0,80}\b(must not exceed|no more than|within|limited to|maximum of)\b/.test(g) ||
    /\b(must not exceed|no more than)\b[^.]{0,40}\bwords?\b[^.]{0,60}\b(answers?|responses?)\b/.test(g);
  // An explicit exclusion also scopes it.
  const explicitlyExcluded =
    /\b(excluded from|does not count towards|not counted towards|outside)\b[^.]{0,40}\b(word )?(limit|count)\b/.test(g) ||
    // "The word count excludes the budget table and the declaration."
    /\b(word )?(count|limit)\b[^.]{0,40}\bexclud\w*\b[^.]{0,60}\b(budget|declaration|annex|appendix|table|attachment)\b/.test(g);
  // A budget or declaration described as attached is supplementary by construction.
  const attachedTable =
    /\b(budget table|budget)\b[^.]{0,60}\b(must be )?attach(ed)?\b/.test(g) ||
    /\battach\b[^.]{0,40}\bbudget\b/.test(g);

  return (answersScoped && attachedTable) || explicitlyExcluded ? "answers" : "whole";
}

export interface LimitedText {
  scope: LimitScope;
  text: string;          // exactly the text the limit covers
  excludedHeadings: string[];
}

// A heading is a markdown ATX heading or a whole-line bold label. It is NEVER an
// ordered-list item: "1. Months one to three: recruit two outreach workers..." is
// answer prose, and treating it as a heading deleted it from the count. It is never
// a bare unmarked line either -- that let a model type the word "Budget" on its own
// line and delete everything after it.
function headingOf(line: string): string | null {
  const l = line.trim();
  if (/^#{1,6}\s/.test(l)) return l.replace(/^#{1,6}\s*/, "").replace(/\*/g, "").trim();
  if (/^\*\*[^*]+\*\*:?$/.test(l)) return l.replace(/\*/g, "").replace(/:$/, "").trim();
  return null;
}

/**
 * Return exactly the text a donor would count. At "whole" scope that is the whole
 * document, unchanged.
 *
 * At "answers" scope the ONLY things that leave the count are
 *   (a) heading lines that reproduce the donor's own wording -- `donorHeadings`,
 *       taken from analysis.format_spec.required_sections and
 *       application_structure.sections_or_questions. Those are the donor's words,
 *       not the applicant's, so the heading LINE is dropped; the answer beneath it
 *       is counted in full.
 *   (b) sections whose heading is an EXACT normalised match for a named attachment
 *       -- the donor's own attachments_required list, plus DEFAULT_ATTACHMENTS --
 *       and those only while they stay non-prose. The first paragraph longer than
 *       PROSE_LINE_WORDS words inside such a section puts the whole section back
 *       into the count and removes it from excludedHeadings, because an attachment
 *       that contains prose is a section of the application wearing an
 *       attachment's name.
 *
 * Any heading that is neither is the applicant's own words and is COUNTED. Nothing
 * leaves the count without appearing in `excludedHeadings` (invariant 9).
 */
export function limitedText(
  md: string,
  scope: LimitScope,
  donorHeadings: string[] = [],
  attachments: string[] = [],
): LimitedText {
  if (scope === "whole") return { scope, text: md, excludedHeadings: [] };

  const donor = new Set(donorHeadings.map(norm).filter((s) => s.length > 2));
  const attach = new Set(
    [...DEFAULT_ATTACHMENTS, ...attachments].map(norm).filter((s) => s.length > 2),
  );
  // With nothing at all to match against there is nothing the pipeline can prove
  // sits outside the limit, so the scope degrades to "whole": refusal by default,
  // in the direction invariant 5 runs. DEFAULT_ATTACHMENTS keeps `attach`
  // non-empty in practice; the branch stands so that emptying it cannot silently
  // turn this function into a no-op that drops headings.
  if (donor.size === 0 && attach.size === 0) {
    return { scope: "whole", text: md, excludedHeadings: [] };
  }

  const out: string[] = [];
  const excluded: string[] = [];
  let dropping = false;
  let held: string[] = [];        // lines withheld from this attachment section so far
  let para: string[] = [];        // the paragraph currently being judged
  let headRaw = "";               // the attachment heading line, restored with its section

  const isTableLine = (s: string) => /^\s*\|/.test(s);

  // Prose is measured over the PARAGRAPH, not the line. A per-line test is defeated
  // by hard-wrapping, which is a formatting choice the model makes, and no gate may
  // depend on one. A block of table rows is not prose however long it runs.
  const paraIsProse = () => {
    const nb = para.filter((l) => l.trim().length > 0);
    if (nb.length === 0) return false;
    if (nb.every(isTableLine)) return false;
    return nb.reduce((n, l) => n + wordsIn(l), 0) > PROSE_LINE_WORDS;
  };

  // An attachment that carries prose is not an attachment. Put the section back into
  // the count from its heading onwards, and withdraw the exclusion record.
  const restore = () => {
    dropping = false;
    excluded.pop();
    out.push(headRaw, ...held, ...para);
    headRaw = "";
    held = [];
    para = [];
  };
  const settleParagraph = () => {
    if (paraIsProse()) restore();
    else { held.push(...para); para = []; }
  };

  for (const raw of md.split("\n")) {
    const h = headingOf(raw);
    if (h !== null) {
      if (dropping) settleParagraph();
      const n = norm(h);
      if (attach.has(n)) {
        dropping = true;
        headRaw = raw;
        held = [];
        para = [];
        excluded.push(h.slice(0, 60));
        continue;
      }
      dropping = false;
      headRaw = "";
      held = [];
      para = [];
      if (donor.has(n)) continue;   // the donor's own question text, not the applicant's
      out.push(raw);                // any other heading is the applicant's words: count it
      continue;
    }
    if (dropping) {
      if (raw.trim() === "") {
        settleParagraph();
        (dropping ? held : out).push(raw);
      } else {
        para.push(raw);
      }
      continue;
    }
    if (/^\s*<!--/.test(raw)) continue;
    out.push(raw);
  }
  if (dropping) settleParagraph();
  return { scope, text: out.join("\n"), excludedHeadings: excluded };
}
