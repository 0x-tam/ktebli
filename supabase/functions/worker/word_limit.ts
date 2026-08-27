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

export type LimitScope = "whole" | "answers";

// Sections a donor names as attached or supplementary. Matched on a heading, never
// on body prose, so a sentence mentioning the budget cannot truncate the count.
const ATTACHED = /^(budget|declaration|annex|appendix|attachment|signator|supporting\s+document)/i;

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

function headingOf(line: string): string | null {
  const l = line.trim();
  if (/^#{1,6}\s/.test(l)) return l.replace(/^#{1,6}\s*/, "").replace(/\*/g, "").trim();
  if (/^\*\*[^*]+\*\*:?$/.test(l)) return l.replace(/\*/g, "").replace(/:$/, "").trim();
  // Some generators write a bare "Q1. ..." or "Budget" line with no marker.
  const bare = l.replace(/\*/g, "").trim();
  if (/^Q?\s*[1-9][.)]\s/.test(bare)) return bare;
  if (bare.length > 0 && bare.length < 60 && ATTACHED.test(bare)) return bare;
  return null;
}

/**
 * Return exactly the text a donor would count. At "whole" scope that is the whole
 * document, unchanged from today.
 */
export function limitedText(md: string, scope: LimitScope): LimitedText {
  if (scope === "whole") return { scope, text: md, excludedHeadings: [] };

  const out: string[] = [];
  const excluded: string[] = [];
  let dropping = false;
  for (const raw of md.split("\n")) {
    const h = headingOf(raw);
    if (h !== null) {
      if (ATTACHED.test(h)) { dropping = true; excluded.push(h.slice(0, 60)); continue; }
      dropping = false;
      continue;                       // the donor's own question text is not the applicant's words
    }
    if (dropping) continue;
    if (/^\s*<!--/.test(raw)) continue;
    out.push(raw);
  }
  return { scope, text: out.join("\n"), excludedHeadings: excluded };
}
