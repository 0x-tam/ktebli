// Deterministic proper-noun audit.
//
// The blind critics' most-repeated criticism was the absence of "messy local
// nouns" — place names, venues, vendors, named staff, named partners, dated prior
// results. Diagnosis showed the ledger usually cannot supply them. But filling the
// ledger is only half the fix: nothing made the generator USE what was there, and
// no validator failed a narrative that used none of it.
//
// So the floor is a FUNCTION OF THE LEDGER, not a constant. If the ledger offers
// ten usable proper nouns and the narrative uses one, that is a failure the
// generator can fix. If the ledger offers one, using one is the ceiling and the
// document is as particular as honesty permits — the applicant is not punished for
// evidence nobody has.
//
// The same pass catches the opposite failure: a proper noun in the narrative that
// is in NO ledger item is either fabricated or lifted from another organisation.
// That is the worse outcome and it is reported separately, as blocking.
//
// Nothing here asks a model to count anything (CLAUDE.md: language models cannot
// count words).
//
// 2026-08-27 — four defects closed, all of them routes by which an invented entity
// reached a delivered document (tests/adversarial/fabricated_identity_test.ts):
//
//   * whole headings and whole table rows were DELETED before the audit looked, and
//     a proposal names its partners, its staff and its awards in exactly those two
//     places. An invented partner in a partner table was not merely unflagged, it
//     was never read;
//   * a run that began after ".", ":", ";" or a newline lost its first word, so
//     "Cedar Valley Trust" became "Valley" and "Rana Haddad" became "Haddad" — both
//     then below the multi-word reporting threshold. Markdown soft-wrapping alone
//     decided whether an invented partner was visible;
//   * the capitalised-run regex read across a newline, fusing the tail of one ledger
//     item to the head of the next and inventing referents ("Community Association
//     Registration") that inflated the denominator of the specificity floor; and
//   * THE METRIC INVERTED: containment ran in both directions, so a document that
//     built "Qobbe Vocational Institute" out of the ledger's "Qobbe" was scored as
//     USING that ledger referent and was never reported, while naming the
//     applicant's real city scored nothing.
//
// Containment now runs ONE WAY. A document phrase is supported when the LEDGER
// contains it, never when it contains the ledger.

// Words that are capitalised for grammar or genre, not because they name anything.
const PN_STOP = new Set([
  "The","This","That","These","Those","A","An","And","But","Or","If","When","While","Where",
  "We","Our","It","Its","They","Their","There","In","On","At","For","To","From","By","With",
  "As","After","Before","During","Over","Under","Between","Each","Every","All","Both","Most",
  "January","February","March","April","May","June","July","August","September","October",
  "November","December","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
  "Year","Month","Week","Day","Phase","Output","Outcome","Goal","Objective","Activity","Activities",
  "Indicator","Indicators","Target","Targets","Budget","Risk","Risks","Mitigation","Assumptions",
  "Level","Statement","Means","Verification","Milestone","Total","Subtotal","Note","Notes",
  "Project","Programme","Program","Proposal","Organisation","Organization","Foundation","Fund",
  "Trust","Grant","Donor","Beneficiaries","Participants","Staff","Board","Annex","Appendix",
  "Introduction","Background","Summary","Conclusion","Sustainability","Methodology","Approach",
  // The neutral extraction stem used by sufficiency.ts and referent_weight.ts to read a
  // form field as prose ("Recorded in the intake form <answer>"). It is scaffolding, and
  // now that a run is never truncated it would otherwise survive as a referent.
  "Recorded",
]);

// A run of capitalised words. Three continuations are allowed, because real names
// are messier than "Two Capitalised Words":
//   ... of/the/de/van ... Capitalised      -> "Church of St Mark"
//   al-Tabbaneh, d'Ivoire                   -> a lowercase particle bound by a
//                                              hyphen or apostrophe to a capital
//   plain Capitalised                       -> "Tower Hamlets"
//
// HORIZONTAL whitespace only between the words of a run. With `\s+` the regex read
// straight across a line break, so joining two ledger items with a newline produced
// referents that exist in neither: "Organisation name: Mashghal Community Association"
// followed by "Registration number: …" yielded "Mashghal Community Association
// Registration". A name that a generator soft-wrapped is worth losing to keep the
// denominator of the specificity floor real.
const PN_RUN =
  /([A-Z][\w'’-]*(?:[ \t]+(?:of|the|de|al|bin|van|von|du|la|le|el)[ \t]+[A-Z][\w'’-]*|[ \t]+[a-z]{1,3}[-'’][A-Z][\w'’-]*|[ \t]+[A-Z][\w'’-]*)*)/g;

/** Where a capitalised run sat, which decides how much of it is grammar. */
export interface PNRun {
  phrase: string;
  /** true if some occurrence opened a line, a heading, a bullet or a table cell. */
  lineStart: boolean;
  /** true if some occurrence opened a sentence (followed ". ", ": ", "; " …). */
  sentenceStart: boolean;
  /** true if some occurrence sat INSIDE a sentence, where a capital means a name. */
  midSentence: boolean;
}

// Everything a markdown line can carry before its first word: bullets, quote marks,
// hashes, emphasis, an ordered-list number, a table pipe already turned into a line.
const LINE_FURNITURE = /^[\s>#*_+|-]*(?:\d+[.)][\s>#*_+|-]*)?$/;
const SENTENCE_END = /[.!?:;]["'”’)\]]*[\s*_]*$/;

function properNounRuns(md: string): PNRun[] {
  // Strip markdown FURNITURE — the hashes, the pipes, the rule row — and keep what was
  // written inside it. Deleting whole headings and whole table rows made the audit blind
  // to the two places a proposal actually names its partners, its staff and its awards.
  // Each heading and each cell is terminated with a full stop and put on its own line, so
  // its first word reads as an opener rather than as a continuation of the row before it.
  // Column labels survive as single capitalised words at a line start, and those are
  // never reported (see `midSentence` below), so the noise this admits costs nothing.
  const text = md
    .replace(/^[ \t]*\|[\s:|-]*\|[ \t]*$/gm, "\n")            // table rule row: no content
    .replace(/^[ \t]*#{1,6}[ \t]+(.*?)[ \t]*$/gm, "\n$1.\n")  // heading text, terminated
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) => // table cells, terminated
      "\n" + row.split("|").map((c) => c.trim()).filter(Boolean).join(".\n") + "\n")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  const out = new Map<string, PNRun>();
  for (const m of text.matchAll(PN_RUN)) {
    let words = m[1].trim().split(/\s+/);

    // English capitalises the first word of every sentence, so a run that opens one MAY
    // carry a word of pure grammar — "Employs Rana Haddad" is a verb plus a person. It
    // may equally be a name that simply opens the sentence, or that markdown happened to
    // wrap onto a new line: "Cedar Valley Trust supplies the curriculum."
    //
    // Discarding the first word unconditionally, as this did, resolved that ambiguity in
    // favour of the fabricator: every invented two-word name at a line start became a
    // single word, and single words are not reported. The run is now kept WHOLE and the
    // position is recorded instead. The grammar reading is tried against the ledger at
    // the call site, where evidence can settle it; if nothing settles it, the name is
    // reported under its full spelling. Ambiguity resolves toward reporting, never
    // toward silence.
    const before = text.slice(0, m.index ?? 0);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const lineStart = LINE_FURNITURE.test(line);
    const sentenceStart = !lineStart && SENTENCE_END.test(before);

    while (words.length && PN_STOP.has(words[0])) words = words.slice(1);
    while (words.length && PN_STOP.has(words[words.length - 1])) words = words.slice(0, -1);
    if (!words.length) continue;

    const phrase = words.join(" ");
    if (phrase.length < 3) continue;

    const prev = out.get(phrase);
    out.set(phrase, {
      phrase,
      lineStart: lineStart || (prev?.lineStart ?? false),
      sentenceStart: sentenceStart || (prev?.sentenceStart ?? false),
      midSentence: (!lineStart && !sentenceStart) || (prev?.midSentence ?? false),
    });
  }
  return [...out.values()];
}

function properNouns(md: string): string[] {
  return properNounRuns(md).map((r) => r.phrase);
}

function normPN(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Order-insensitive key: "Municipality of Tripoli" and "Tripoli Municipality" are
// the same referent, and a ledger written one way must match prose written the
// other. Short connectives are dropped so they cannot make two spellings differ.
const PN_GLUE = new Set(["of", "the", "de", "la", "le", "du", "el", "al"]);
function pnKey(s: string): Set<string> {
  return new Set(normPN(s).split(" ").filter((w) => w && !PN_GLUE.has(w)));
}

// Containment runs ONE WAY: the document may say no more than the ledger says.
// "Tower Hamlets" in the narrative against "Tower Hamlets Council" in the ledger is the
// applicant naming a referent the ledger carries, and word order is irrelevant.
// "Qobbe Vocational Institute" against a ledger that carries only "Qobbe" is a DIFFERENT
// entity that the narrative has introduced — an institute the evidence knows nothing
// about — and treating it as a match both hid the fabrication and credited it toward the
// specificity floor that gates delivery.
function pnContains(docKey: Set<string>, ledgerKey: Set<string>): boolean {
  if (!docKey.size || !ledgerKey.size) return false;
  for (const w of docKey) if (!ledgerKey.has(w)) return false;
  return true;
}

// TWO-WAY, and deliberately so. This is used for ONE purpose: recognising the applicant
// naming itself inside a longer phrase. Self-naming is never particularity and never
// fabrication, in either spelling, so the asymmetry above does not apply to it. Do not
// reuse this for evidence support — that is what pnContains() is for.
function pnOverlap(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

interface PNAudit {
  ledger_offers: number;      // distinct proper nouns the ledger could supply
  used: number;               // of those, how many the narrative actually uses
  unsourced: string[];        // proper nouns in the narrative that no ledger item supports
  findings: string[];
}

// applicantName is always legitimate and is excluded from both counts: using your
// own name is not particularity, and it is never unsourced.
//
// designNames are the names THIS pipeline authored for the proposed project. They are a
// second, closed provenance source: a legitimately named new project ("the Progression
// Pathways Initiative") is in no evidence ledger and reads as unsourced to a string
// matcher. Provenance is therefore affirmative and closed — ledger, or design object, or
// it is unsourced — rather than the gate being switched off. Naming your own new project
// earns no evidence credit, so a design match skips the candidate without counting it.
function properNounAudit(
  narrative: string,
  ledger: Array<Record<string, unknown>>,
  applicantName: string,
  designNames: string[] = [],
): PNAudit {
  // Read the ledger's CONTENT, not its scaffolding. Evidence ids and
  // all-caps placeholders ("UNKNOWN", "NOT RECORDED") are how a ledger says it
  // knows nothing, and counting them as named referents inflates the denominator
  // and invents a specificity failure that is really an evidence failure.
  //
  // ONE ITEM AT A TIME. Joined with a newline, the capitalised-run regex read straight
  // across the boundary and produced referents that no item carries.
  const ledgerNouns = new Map<string, string>();
  for (const e of ledger) {
    const item = String(e.claim ?? "").replace(/\bE-(?:INTAKE|WEB|PROP|ASK)-\d+\b/g, " ");
    for (const p of properNouns(item)) {
      if (p === p.toUpperCase()) continue;        // UNKNOWN / NOT RECORDED / NOT SUPPLIED
      ledgerNouns.set(normPN(p), p);
    }
  }

  const own = new Set<string>();
  for (const p of properNouns(applicantName || "")) own.add(normPN(p));
  for (const k of own) ledgerNouns.delete(k);

  const inNarrative = properNounRuns(narrative);
  const used = new Set<string>();
  const unsourced: string[] = [];
  const ledgerKeys = [...ledgerNouns.keys()].map((k) => [k, pnKey(k)] as const);
  const ownKeys = [...own].map((k) => pnKey(k));
  const designKeys = designNames.flatMap((d) => properNouns(String(d ?? ""))).map((d) => pnKey(d));

  for (const run of inNarrative) {
    const p = run.phrase;
    const n = normPN(p);
    if (!n) continue;
    const key = pnKey(p);
    // Containment in EITHER direction: "Mashghal Community Association In Bab
    // al-Tabbaneh's" is still the applicant naming itself, and crediting it as a
    // named referent inflates exactly the metric this is meant to measure.
    if (own.has(n) || ownKeys.some((o) => pnOverlap(key, o) || [...o].every((w) => key.has(w)))) continue;

    let hit = ledgerKeys.find(([k, kk]) => k === n || pnContains(key, kk));
    // The grammar reading, tried only where grammar could actually have capitalised the
    // first word, and only against the ledger. "Employs Rana Haddad" opening a ledger-ish
    // sentence is the verb plus the person the ledger records. This can only ever DROP a
    // leading word, so it cannot credit a document that says more than the ledger does.
    if (!hit && (run.lineStart || run.sentenceStart)) {
      const words = p.split(/\s+/);
      if (words.length > 1) {
        const tail = pnKey(words.slice(1).join(" "));
        hit = ledgerKeys.find(([, kk]) => pnContains(tail, kk));
      }
    }
    if (hit) { used.add(hit[0]); continue; }

    // Names this pipeline authored for the proposed project are provenance too, and
    // they earn no evidence credit.
    if (designKeys.some((d) => pnContains(key, d))) continue;

    // A SINGLE capitalised word is reported only where it sits INSIDE a sentence. At a
    // line start, a heading, a bullet or a table cell, English and markdown capitalise
    // for reasons that have nothing to do with naming ("Problem", "Role", "Since"), and
    // flagging those buries the real signal. Inside a sentence a capital is a name:
    // "said Layla" is a person this document invented. All-caps runs are headings.
    const words = p.split(/\s+/);
    if (words.length < 2 && !run.midSentence) continue;
    if (p === p.toUpperCase()) continue;
    unsourced.push(p);
  }

  const offers = ledgerNouns.size;
  const findings: string[] = [];

  if (unsourced.length) {
    findings.push(
      `UNSOURCED PROPER NOUNS: ${unsourced.slice(0, 8).join(", ")}` +
      (unsourced.length > 8 ? ` (+${unsourced.length - 8} more)` : "") +
      ` — no evidence ledger item supports these. Remove them or replace them with a ledger-backed referent.`,
    );
  }

  // The floor: use most of what exists. Below half, with at least three on offer,
  // the generator is writing around its own evidence.
  if (offers >= 3 && used.size * 2 < offers) {
    findings.push(
      `SPECIFICITY: the evidence ledger offers ${offers} concrete named referents and the narrative uses only ${used.size}. ` +
      `Name the places, partners, people and prior results the ledger already supports, in the body of the argument rather than in a list.`,
    );
  }

  return { ledger_offers: offers, used: used.size, unsourced, findings };
}

export { properNounAudit, properNounRuns, properNouns, normPN };
export type { PNAudit };
