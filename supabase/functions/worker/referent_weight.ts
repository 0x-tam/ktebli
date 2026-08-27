// ============================================================================
// REFERENT WEIGHT — how much work a named referent actually does in a document
// ============================================================================
//
// `worker/proper_nouns.ts` answers "is the referent THERE?". The referent ladder
// (reports/referent-ladder.md §1) then showed that presence is nearly a linear
// function of supply: ledgers offering 7 / 10 / 13 referents produced 5 / 8 / 11
// used, in every arm, with almost no variance — 71% / 80% / 82%. A generator that
// consumes a fixed fraction of whatever it is given is not starved. It is also
// not, on that evidence alone, doing anything USEFUL with what it consumed.
//
// A name can be present and still be decorative. "We work in Bab al-Tabbaneh and
// Qobbe" survives the substitution of "the neighbourhood" without losing a single
// assertion — which is exactly the reject-list item "any paragraph that survives
// swapping the organisation name", applied one level down, to the referent.
//
// This module measures WEIGHT: how much of the document's argument would be lost
// if a named referent were replaced by a generic placeholder of the same kind.
//
// ---------------------------------------------------------------------------
// WHAT IT IS AND IS NOT
// ---------------------------------------------------------------------------
//
//   * Deterministic. No model is asked anything. CLAUDE.md is explicit that
//     language models cannot count, and a measure that calls a model can be
//     prompt-injected by the text it is scoring and fails open when the provider
//     is down.
//   * Pure. No I/O, no clock, no globals. The same inputs give the same numbers
//     on any machine, in production and in a test.
//   * A MEASUREMENT, not a gate. It returns numbers and findings. It does not
//     decide anything and it cannot pass anything. Whatever consumes it must be
//     a refusal by default that this measurement can only ever fail to clear.
//
// ---------------------------------------------------------------------------
// CALIBRATION STATUS — READ THIS BEFORE THRESHOLDING ANYTHING
// ---------------------------------------------------------------------------
//
// The only fundability signal that exists for this project is the pair of blind
// rankings in reports/quality-iteration-1.md §2: eight documents, two cases, two
// critic families that agreed exactly within each case.
//
//   * On the `ukyouth` case BOTH critics counted ZERO named referents in ALL FOUR
//     documents. Referent weight is therefore zero for all four and cannot order
//     them. Neither can referent count. That ranking is driven by something else
//     (the last-placed document carried 35 `[INSERT: …]` placeholders).
//   * On the `evidence-poor` case this module reproduces the critics' referent
//     counts and names EXACTLY, on all four documents (3 / 2 / 2 / 1). But those
//     counts already order the blind ranking almost perfectly, and total weight
//     does not order it at all:
//
//         Kendall tau-b against the blind ranking, n = 4
//           referent count ............ 0.913
//           counterparty referents .... 0.707
//           weighted mentions ......... 0.333
//           load-bearing referents .... 0.183
//           DOCUMENT WEIGHT ........... 0.000   <- at chance
//
// So on the only fundability data that exists, weight is LESS predictive than the
// count it was meant to improve on. The numbers below are a scale, not a validated
// threshold, and no pass mark may be set from them. Nothing here licenses moving
// `sufficiency.ts` `activeScorer()` off `countScorer`.
//
// The measure still earns its place as an OBSERVATION: over the 12 ladder
// documents it shows that referent presence scales 1:1 with supply (3/6/9 offered,
// 3.00/5.75/8.75 used) while load-bearing use does not (2.00/2.50/4.25), and that
// 85% of all mentions survive the swap. See scratchpad qloop/unblocked/referent-weight.md.
// ============================================================================

import { normPN } from "./proper_nouns.ts";

// ---------------------------------------------------------------------------
// Tunables, in one inspectable place
// ---------------------------------------------------------------------------

export const WEIGHTS = {
  /** Base weight by where the mention sits. */
  zone: {
    prose: 1,
    list: 0.4,
    table: 0.25,
    /** A "Label: value" line. The donor demands an address; giving one is
     *  compliance, not particularity. */
    field: 0,
    /** Section 1 / identification / declaration blocks, whatever the zone. */
    identification: 0,
    heading: 0,
  } as Record<Zone, number>,

  /** Multiplier by grammatical role. */
  role: {
    subject: 2,
    counterparty: 2,
    genitive: 1.3,
    adjunct: 1,
    listing: 0.6,
  } as Record<Role, number>,

  /** Additive, for a sentence that carries something checkable. Sum is capped. */
  load: { number: 0.3, date: 0.3, causal: 0.2, cap: 0.6 },

  /** The sentence distinguishes this referent from another named one. */
  contrastive: 0.5,

  /** Threading through the argument: +25% per extra section, capped. */
  distributionPerSection: 0.25,
  distributionCap: 2,

  /** A referent with no load-bearing mention needs this much accumulated
   *  weight before it counts as more than decoration. */
  supportingFloor: 2,
} as const;

export type Zone = "prose" | "list" | "table" | "field" | "identification" | "heading";
export type Role = "subject" | "counterparty" | "genitive" | "adjunct" | "listing";
export type ReferentVerdict = "load_bearing" | "supporting" | "decorative" | "absent";

export interface Mention {
  referent: string;
  /** Verbatim name as it appears in the document. */
  surface: string;
  sentence: string;
  sectionIndex: number;
  sectionTitle: string;
  zone: Zone;
  role: Role;
  load: { number: boolean; date: boolean; causal: boolean };
  contrastive: boolean;
  /** TRUE means the sentence still says everything it said with the name
   *  replaced by a generic placeholder — i.e. the referent is decorative here. */
  survivesSwap: boolean;
  weight: number;
}

export interface ReferentScore {
  referent: string;
  mentions: number;
  /** Mentions that carry weight; identification/field/heading mentions do not. */
  weightedMentions: number;
  sections: number;
  loadBearing: number;
  weight: number;
  verdict: ReferentVerdict;
}

export interface WeightAudit {
  /** Distinct ledger-backed referents on offer. */
  offered: number;
  /** Of those, how many appear anywhere in the document. */
  present: number;
  /** Of those, how many have at least one mention that does not survive the swap. */
  loadBearingReferents: number;
  /** Total mentions that carry weight. */
  weightedMentions: number;
  /** Document weight: the sum over referents. */
  weight: number;
  /** weight / offered. Comparable across documents with different ledgers. */
  weightPerOffered: number;
  perReferent: ReferentScore[];
  decorative: string[];
  mentions: Mention[];
  findings: string[];
}

// ---------------------------------------------------------------------------
// Referent identity — same rules as worker/proper_nouns.ts
// ---------------------------------------------------------------------------

const PN_GLUE = new Set(["of", "the", "de", "la", "le", "du", "el", "al"]);

/** Order-insensitive key: "Municipality of Tripoli" == "Tripoli Municipality". */
export function refKey(s: string): Set<string> {
  return new Set(normPN(s).split(" ").filter((w) => w && !PN_GLUE.has(w)));
}

/** Every word of the shorter name appears in the longer one. */
function contains(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Document segmentation
// ---------------------------------------------------------------------------

/** Sections whose content is administration, not argument. */
const IDENTIFICATION_SECTION =
  /\b(applicant\s+identification|identification|applicant\s+details|organisation\s+details|organization\s+details|contact\s+details|eligibility\s+declaration|declaration|signator|cover\s+sheet)\b/i;

/** `## 2. PROBLEM STATEMENT`, `2. PROBLEM STATEMENT`, `**Q3. What will you do?**` */
function isSectionHeading(line: string): string | null {
  const md = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (md) return md[1].replace(/\*+/g, "").trim();

  const raw = line.trim().replace(/^\*\*(.*)\*\*$/, "$1").trim();
  if (!raw || raw.length > 120) return null;
  if (!/^(?:Q\s?)?\d{1,2}\s*[.):]\s+\S/i.test(raw)) return null;
  if (/[.]\s*$/.test(raw) && !/\?\s*$/.test(raw)) {
    // A numbered list item ending in a full stop is prose, not a heading —
    // unless it is shouted, which is how these donors write section titles.
    const letters = raw.replace(/[^A-Za-z]/g, "");
    const upper = raw.replace(/[^A-Z]/g, "");
    if (!letters || upper.length / letters.length < 0.6) return null;
  }
  return raw;
}

/**
 * `- **Physical Address:** …`, `* Address: …`, `Areas of work: …`
 *
 * A form field, not a paragraph that happens to open with a label. Two guards,
 * both added after the first calibration pass zeroed a real prose sentence —
 * `Direct: 12 young people out of work from Bab al-Tabbaneh and Qobbe, paid for
 * clean-up shifts …` — and cost the document its whole beneficiary claim:
 *   * the line must be short, and
 *   * it must be a single sentence.
 * A value that runs to a second sentence is prose with a label on it.
 */
const FIELD_LABEL =
  /^\s{0,4}(?:[-*+]\s+|\d{1,2}[.)]\s+)?(?:\*\*)?[A-Z][A-Za-z][A-Za-z /&'-]{1,40}(?:\*\*)?\s*:\s*\S/;
const FIELD_MAX_CHARS = 140;
function isFieldLine(line: string): boolean {
  const t = line.trim();
  if (!FIELD_LABEL.test(line)) return false;
  if (t.length > FIELD_MAX_CHARS) return false;
  if (/[.!?]["'\u2019)\]]?\s+[A-Z]/.test(t)) return false;
  return true;
}

interface Block {
  text: string;
  zone: Zone;
  sectionIndex: number;
  sectionTitle: string;
}

function segment(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let sectionIndex = 0;
  let sectionTitle = "";
  let identification = false;

  for (const line of lines) {
    const heading = isSectionHeading(line);
    if (heading !== null) {
      // Sub-headings (### inside a section) do not open a new top-level section,
      // but they do not matter for weight either: headings are genre, not claims.
      sectionIndex++;
      sectionTitle = heading;
      identification = IDENTIFICATION_SECTION.test(heading);
      out.push({ text: heading, zone: "heading", sectionIndex, sectionTitle });
      continue;
    }
    if (!line.trim()) continue;

    if (/^\s{0,3}\|/.test(line)) {
      // One block per table cell: a cell is its own unit of claim.
      const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
      for (const c of cells) {
        const t = c.trim();
        if (!t || /^:?-{2,}:?$/.test(t)) continue;
        out.push({
          text: t,
          zone: identification ? "identification" : "table",
          sectionIndex,
          sectionTitle,
        });
      }
      continue;
    }

    const isList = /^\s{0,4}(?:[-*+]|\d{1,2}[.)])\s+\S/.test(line);
    const isField = isFieldLine(line);
    const zone: Zone = identification ? "identification" : isField ? "field" : isList ? "list" : "prose";
    out.push({ text: line.trim(), zone, sectionIndex, sectionTitle });
  }
  return out;
}

const ABBREV = /\b(?:e\.g|i\.e|etc|no|vs|approx|dr|mr|mrs|ms|st|fig|cf|al|usd|gbp|eur)\.$/i;

function sentences(text: string): string[] {
  const t = text.replace(/\*\*/g, "").replace(/`+/g, "");
  const parts: string[] = [];
  let start = 0;
  const re = /[.!?]["'’)\]]?\s+(?=[A-Z"'(\[£$€])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const head = t.slice(start, m.index + 1);
    if (ABBREV.test(head.trimEnd())) continue;
    parts.push(t.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  const tail = t.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Finding a known referent inside a sentence
// ---------------------------------------------------------------------------
//
// This deliberately does NOT reuse `properNouns()` for the document side.
// `properNouns()` drops the first word of a run that starts at a sentence
// boundary, because English capitalises sentence openers — which is right for
// discovering unknown names and fatal here, because the one thing we most want
// to detect is a referent standing as the SUBJECT of its sentence, and a subject
// is very often the sentence opener. We already know which names we are looking
// for, so we look for them directly.

const CAP_RUN =
  /[A-Z][\w'’]*(?:[\s-]+(?:of|the|de|al|el|la|le|du|van|von|bin)[\s-]+[A-Z][\w'’]*|[\s-]+[a-z]{1,3}[-'’][A-Z][\w'’]*|-[A-Z][\w'’]*|\s+[A-Z][\w'’]*)*/g;

interface Hit { surface: string; index: number; referent: string }

/** The referent's leading non-glue token — the distinctive part of a real name. */
function leadToken(name: string): string {
  return normPN(name).split(" ").filter((w) => w && !PN_GLUE.has(w))[0] ?? "";
}

/**
 * Shrink a capitalised run down to the smallest contiguous span that still
 * identifies the referent, then drop a trailing possessive.
 *
 * Without this, `In Bab al-Tabbaneh's high-density alleyways …` yields the run
 * `In Bab al-Tabbaneh's`: the sentence-initial `In` lands inside the name, so the
 * mention looks like it opens its clause, and the `'s` is swallowed so the
 * genitive is invisible. Both were wrong in the first calibration pass.
 */
function alignSpan(run: string, offset: number, rk: Set<string>): { surface: string; index: number } | null {
  const toks: Array<{ t: string; i: number }> = [];
  const wre = /[A-Za-z][\w'\u2019-]*/g;
  for (const w of run.matchAll(wre)) toks.push({ t: w[0], i: (w.index ?? 0) + offset });
  if (!toks.length) return null;

  let lo = 0, hi = toks.length - 1;
  const spanKey = (a: number, b: number) => refKey(toks.slice(a, b + 1).map((x) => x.t).join(" "));
  // Shrink only while the span still carries EVERY word of the referent. Testing
  // the symmetric `contains()` here shrank "Municipality of Tripoli" to "Tripoli"
  // — a different offered referent — which is how a counterparty mention was
  // silently re-attributed in the first calibration pass.
  const holdsAll = (a: number, b: number) => {
    const k = spanKey(a, b);
    for (const w of rk) if (!k.has(w)) return false;
    return true;
  };
  if (holdsAll(lo, hi)) {
    while (lo < hi && holdsAll(lo + 1, hi)) lo++;
    while (hi > lo && holdsAll(lo, hi - 1)) hi--;
  } else if (!contains(spanKey(lo, hi), rk)) return null;

  const startTok = toks[lo], endTok = toks[hi];
  let end = endTok.i + endTok.t.length;
  let surface = run.slice(startTok.i - offset, end - offset);
  const poss = surface.match(/['\u2019]s$/);
  if (poss) { surface = surface.slice(0, -poss[0].length); end -= poss[0].length; }
  void end;
  return { surface, index: startTok.i };
}

function hitsIn(sentence: string, keys: ReadonlyArray<readonly [string, Set<string>]>): Hit[] {
  const out: Hit[] = [];
  CAP_RUN.lastIndex = 0;
  for (const m of sentence.matchAll(CAP_RUN)) {
    const run = m[0];
    const k = refKey(run);
    if (!k.size) continue;
    let best: { referent: string; score: number; size: number; rk: Set<string>; first: string } | null = null;
    for (const [name, rk] of keys) {
      if (!contains(k, rk)) continue;
      const score = overlapCount(k, rk);
      // Prefer the referent that shares the most words; break ties towards the
      // SHORTER ledger name, so a bare "Tripoli" resolves to the referent
      // "Tripoli" rather than to "Municipality of Tripoli" when both are offered.
      if (!best || score > best.score || (score === best.score && rk.size < best.size)) {
        best = { referent: name, score, size: rk.size, rk, first: leadToken(name) };
      }
    }
    if (!best) continue;
    const span = alignSpan(run, m.index ?? 0, best.rk);
    if (!span) continue;

    // A PARTIAL match — the run carries only some of the referent's words — is
    // an attributive adjective whenever a lowercase word follows it that is not
    // a finite verb. Without this test the run "Lebanese" in "Lebanese host
    // residents" matched the ledger referent "Lebanese Ministry of Interior"
    // four times in one document and produced a load-bearing SUBJECT mention out
    // of a demonym. "Municipality does not lift reliably" survives, because
    // "does" is finite and a bare partial standing in front of a finite verb is
    // the subject of a clause, not a modifier.
    const isFull = [...best.rk].every((w) => k.has(w));
    if (!isFull) {
      // A partial must keep the referent's LEADING token, which in a real name is
      // the distinctive one: "Dunmore" for Dunmore Sixth Form College, "Municipality"
      // for the Municipality of Tripoli. Without this, the bare city name "Tripoli"
      // in an address line was read as a mention of the Municipality of Tripoli, and
      // the bottom-ranked document in the calibration corpus was credited with two
      // referents where both blind critics counted one.
      //
      // The cost is stated rather than hidden: an anaphor built from the tail of a
      // name — "the College", "Raval" without the first name — is not counted. That
      // under-counts weight, which is the safer direction for a measure whose whole
      // purpose is to detect names that are doing less work than they appear to.
      if (!k.has(best.first)) continue;
      const after = sentence.slice(span.index + span.surface.length);
      if (/^\s+[a-z]/.test(after) && !AUX_AFTER.test(after)) continue;
    }
    out.push({ surface: span.surface, index: span.index, referent: best.referent });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grammatical role
// ---------------------------------------------------------------------------

const PREP_AT_END =
  /\b(in|at|on|from|of|with|to|for|across|along|around|near|throughout|between|within|into|onto|towards?|by|through|about|over|under|among|amongst|via|beyond|outside|inside|serving|covering|including)\b(?:\s+(?:the|our|its|their|these|those|both|all|two|three|four|a|an|each|every|other|adjacent|neighbouring))*\s*$/i;

/** Words that turn a prepositional object into a party to a commitment. */
const COUNTERPARTY_CUE =
  /\b(sign|signs|signed|signing|signature|signatory|agree|agrees|agreed|agreement|arrangement|arrangements|partner|partners|partnership|contract|contracted|memorandum|mou|refer|refers|referral|referrals|referred|hand|handed|handover|pass|passes|passed|transfer|transferred|host|hosted|hosting|provided|supplied|supply|funded|delivered|jointly|confirm|confirms|confirmed|commissioned|accredited|employed|seconded|subcontract|letter|endorsement|permission|licence|license|approval|approved|lease|leased|donated|collected|negotiat\w*|liaise\w*|coordinat\w* with|counterpart)\b/i;

const FINITE_AFTER =
  /^\s*(?:is|are|was|were|has|have|had|does|do|did|will|would|shall|should|can|could|may|might|must|agrees?|agreed|provides?|provided|runs?|ran|operates?|operated|holds?|held|lifts?|lifted|collects?|collected|employs?|employed|hosts?|hosted|refers?|referred|funds?|funded|owns?|owned|manages?|managed|delivers?|delivered|supplies|supplied|maintains?|maintained|confirms?|confirmed|signs?|signed|takes?|took|gives?|gave|sits?|sat|carries|carried|contains?|contained|lacks?|lacked|serves?|served|receives?|received|continues?|continued|remains?|remained|becomes?|became|began|begins?|ends?|ended|accepts?|accepted|requires?|required|allows?|allowed|refuses?|refused|stopped|stops?)\b/i;

/** Unambiguous finite forms. Deliberately narrower than FINITE_AFTER, which
 *  carries verbs that are also common nouns — "host" reinstated every "Lebanese
 *  host residents" as a mention of "Lebanese Ministry of Interior". */
const AUX_AFTER =
  /^\s*(?:is|are|was|were|has|have|had|does|do|did|will|would|shall|should|can|could|may|might|must)\b/i;

const CUE_WINDOW = 56;

const CLAUSE_START_AT_END =
  /(?:^|[.;:!?—–]|[-*•]|\)|\bwhich\b|\bwho\b|\bthat\b|\bwhile\b|\bwhilst\b|\bbecause\b|\bif\b|\bwhen\b|\bwhere\b|\bso\b|\bbut\b|\bhowever\b)\s*(?:the\s+|our\s+|its\s+|their\s+|this\s+)?$/i;

/** "… in Bab al-Tabbaneh and " → "… in Bab al-Tabbaneh" → "… in", so the second
 *  conjunct inherits the preposition governing the first. */
function stripTrailingConjunct(s: string): string | null {
  const c = s.match(/(?:,\s*)?\s\b(?:and|or)\s*$/i) ?? s.match(/,\s*$/);
  if (!c) return null;
  let t = s.slice(0, s.length - c[0].length);
  const r = t.match(new RegExp(`(?:${CAP_RUN.source})\\s*$`));
  if (r) t = t.slice(0, t.length - r[0].length);
  return t.replace(/\s+$/, "");
}

function classifyRole(sentence: string, hit: Hit, zone: Zone): Role {
  const post = sentence.slice(hit.index + hit.surface.length);
  if (/^['’]s\b/.test(post)) return "genitive";

  let pre = sentence.slice(0, hit.index).replace(/\s+$/, "");

  // Subject: the name opens its clause and a finite verb follows it.
  if (CLAUSE_START_AT_END.test(pre) || pre === "") {
    if (FINITE_AFTER.test(post)) return "subject";
  }

  for (let i = 0; i < 4; i++) {
    if (PREP_AT_END.test(pre)) {
      // The cue must govern THIS prepositional phrase, so the search window stops
      // at the nearest clause or list boundary. Searching a flat 80 characters
      // made "…referred nine young people to our provision, including six residing
      // in Ferry Bank" a counterparty mention of Ferry Bank, on the strength of a
      // "referred" belonging to a different phrase two commas earlier.
      let w = pre.slice(Math.max(0, pre.length - CUE_WINDOW));
      const cut = Math.max(w.lastIndexOf(","), w.lastIndexOf(";"), w.lastIndexOf("("), w.lastIndexOf(")"));
      if (cut >= 0) w = w.slice(cut + 1);
      return COUNTERPARTY_CUE.test(w) ? "counterparty" : "adjunct";
    }
    const stripped = stripTrailingConjunct(pre);
    if (stripped === null) break;
    pre = stripped;
  }

  if (zone === "table" || zone === "list" || zone === "field") return "listing";
  if (FINITE_AFTER.test(post)) return "subject";
  return "adjunct";
}

// ---------------------------------------------------------------------------
// Load and contrast
// ---------------------------------------------------------------------------

const NUMBER_IN =
  /(?:\b\d[\d,]*(?:\.\d+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand)\b)/i;
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const DATE_IN =
  /(?:\b(?:19|20)\d{2}\b|\b(?:spring|summer|autumn|winter)\b|\bmonths?\s*\d|\bweeks?\s*\d|\bquarter\s*\d|\bq[1-4]\b|\byear\s*(?:one|two|three|1|2|3)\b)/i;
const CAUSAL_IN =
  /\b(?:because|so that|therefore|as a result|which means|hence|consequently|in order to|owing to|due to|thereby|which is why|so the|so we|so that)\b/i;
// Contrast is a property of a MENTION, not of a sentence. The first calibration
// pass tested the whole sentence and fired on "each" in "two organised clean-up
// rounds each week … in Bab al-Tabbaneh and Qobbe" — a frequency, not a contrast
// between the two places. It must sit immediately in front of the name.
// NOTE: deliberately NOT case-insensitive. `[^A-Z]` under the `i` flag also
// excludes lowercase letters, which silenced this test entirely on the one
// genuine contrast in the corpus — "(one in Bab al-Tabbaneh, one in Qobbe)".
const CONTRAST_LEAD =
  /\b(?:[Oo]ne|[Ee]ither|[Rr]espectively|[Ww]hereas|[Ww]hile|[Ww]hilst|rather than|instead of|[Tt]he first|[Tt]he second|[Ss]eparately|apiece|[Tt]he other|another)\b[^A-Z]{0,12}$/;
const CONTRAST_WINDOW = 26;

function loadOf(sentence: string) {
  return {
    number: NUMBER_IN.test(sentence),
    date: DATE_IN.test(sentence) || MONTHS.test(sentence),
    causal: CAUSAL_IN.test(sentence),
  };
}

// ---------------------------------------------------------------------------
// Removability — the swap test
// ---------------------------------------------------------------------------
//
// Replace the name with a generic placeholder of the same category ("the
// neighbourhood", "a local authority", "a partner college"). Does the sentence
// still assert everything it asserted? If YES the referent is decorative there.
//
// It does NOT survive — the name is load-bearing — when any of:
//
//   1. it is the SUBJECT. The placeholder becomes the actor and the sentence no
//      longer says who acts.
//   2. it is a COUNTERPARTY: an external party who has to sign, agree, refer,
//      host, supply, fund or receive. A commitment with an anonymous counterparty
//      is not a commitment. This is also the exact failure both blind critics
//      named on the evidence-poor case — "no municipal lift agreement is signed",
//      "no municipal counterpart" — against the two documents they ranked below
//      the one that had it.
//   3. it is CONTRASTIVE: the sentence distinguishes it from another named
//      referent. One shared placeholder collapses the distinction and the
//      sentence stops meaning anything ("one in the neighbourhood, one in the
//      neighbourhood").
//   4. it is a GENITIVE possessing a figure or a date: the number is predicated
//      of THIS place, and the placeholder detaches it from anything.
//
// Everything else survives: "we work in X", "residents of X", "across X and Y".
// That is what a swappable proposal looks like, and it is the majority of every
// document in the calibration corpus.

function survivesSwap(m: Omit<Mention, "survivesSwap" | "weight">): boolean {
  if (WEIGHTS.zone[m.zone] === 0) return true;      // an address field is compliance
  if (m.role === "subject") return false;
  if (m.role === "counterparty") return false;
  if (m.contrastive) return false;
  if (m.role === "genitive" && (m.load.number || m.load.date)) return false;
  return true;
}

function mentionWeight(m: Omit<Mention, "weight">): number {
  const base = WEIGHTS.zone[m.zone];
  if (base === 0) return 0;
  let w = base * WEIGHTS.role[m.role];
  let bonus = 0;
  if (m.load.number) bonus += WEIGHTS.load.number;
  if (m.load.date) bonus += WEIGHTS.load.date;
  if (m.load.causal) bonus += WEIGHTS.load.causal;
  w += Math.min(bonus, WEIGHTS.load.cap);
  if (m.contrastive) w += WEIGHTS.contrastive;
  return Math.round(w * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Ledger-backed referents
// ---------------------------------------------------------------------------

/**
 * The referents a ledger can legitimately supply, on the same terms as
 * `properNounAudit`: evidence ids and all-caps placeholders are scaffolding, not
 * content, and the applicant's own name is not particularity.
 *
 * NOTE: this repeats ~10 lines of `proper_nouns.ts` because that file does not
 * export its ledger pass. See the patch spec in the report; until it lands the
 * two must be changed together.
 */
export function ledgerReferents(
  ledger: ReadonlyArray<Record<string, unknown>>,
  applicantName: string,
  properNounsFn: (s: string) => string[],
): string[] {
  const text = ledger
    .map((e) => String(e.claim ?? e.fact ?? "").replace(/\bE-(?:INTAKE|WEB|PROP|ASK)-\d+\b/g, " "))
    // Terminate each item. Joined with a bare newline, the capitalised-run regex
    // treats "\n" as ordinary whitespace and reads straight across two ledger
    // items: "Organisation name: Mashghal Community Association" followed by
    // "Registration number: …" produced the phantom referent "Community
    // Association Registration". The same defect is live in `properNounAudit`.
    .join(".\n");
  // `properNouns()` drops the first word of a run that opens a sentence, so a bare
  // `properNouns("Halewater Commons Trust")` returns ["Commons"] and the applicant's
  // own name then fails to match itself in the ledger. Read it behind a neutral
  // stem, and keep the raw normalisation as well. The same defect is live in
  // `properNounAudit` — see the patch spec in the report.
  const own = new Set(properNounsFn("Recorded on the order form " + String(applicantName ?? "")).map(normPN));
  if (applicantName) own.add(normPN(applicantName));
  const ownKeys = [...own].map(refKey);
  const out = new Map<string, string>();
  for (const p of properNounsFn(text)) {
    if (p === p.toUpperCase()) continue;
    const n = normPN(p);
    if (!n || own.has(n)) continue;
    const k = refKey(p);
    if (ownKeys.some((o) => contains(k, o))) continue;
    out.set(n, p);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

export function referentWeight(
  narrative: string,
  referents: readonly string[],
): WeightAudit {
  // De-duplicate on the same identity rule the rest of the pipeline uses.
  const canon = new Map<string, string>();
  for (const r of referents) {
    const n = normPN(r);
    if (n && !canon.has(n)) canon.set(n, r.trim());
  }
  const names = [...canon.values()];
  const keys = names.map((n) => [n, refKey(n)] as const);

  const mentions: Mention[] = [];
  for (const block of segment(narrative)) {
    if (block.zone === "heading") continue;
    // Sentence-split everything except a form field, which is one unit by
    // construction. A long bullet holds several claims and usually only one of
    // them contains the name.
    const units = block.zone === "field" ? [block.text] : sentences(block.text);
    for (const unit of units) {
      const hits = hitsIn(unit, keys);
      if (!hits.length) continue;
      const distinct = new Set(hits.map((h) => h.referent));
      const load = loadOf(unit);
      for (const hit of hits) {
        const role = classifyRole(unit, hit, block.zone);
        const lead = unit.slice(Math.max(0, hit.index - CONTRAST_WINDOW), hit.index);
        const contrastive = distinct.size > 1 && CONTRAST_LEAD.test(lead);
        const partial: Omit<Mention, "survivesSwap" | "weight"> = {
          referent: hit.referent,
          surface: hit.surface,
          sentence: unit,
          sectionIndex: block.sectionIndex,
          sectionTitle: block.sectionTitle,
          zone: block.zone,
          role,
          load,
          contrastive,
        };
        const swap = survivesSwap(partial);
        mentions.push({ ...partial, survivesSwap: swap, weight: mentionWeight({ ...partial, survivesSwap: swap }) });
      }
    }
  }

  const perReferent: ReferentScore[] = names.map((name) => {
    const mine = mentions.filter((m) => m.referent === name);
    const weighted = mine.filter((m) => WEIGHTS.zone[m.zone] !== 0);
    const sections = new Set(weighted.map((m) => m.sectionIndex)).size;
    const loadBearing = weighted.filter((m) => !m.survivesSwap).length;
    const raw = weighted.reduce((a, m) => a + m.weight, 0);
    const spread = Math.min(
      WEIGHTS.distributionCap,
      1 + WEIGHTS.distributionPerSection * Math.max(0, sections - 1),
    );
    const weight = Math.round(raw * spread * 1000) / 1000;
    let verdict: ReferentVerdict;
    if (!mine.length) verdict = "absent";
    else if (loadBearing > 0) verdict = "load_bearing";
    else if (weight >= WEIGHTS.supportingFloor) verdict = "supporting";
    else verdict = "decorative";
    return { referent: name, mentions: mine.length, weightedMentions: weighted.length, sections, loadBearing, weight, verdict };
  });

  const present = perReferent.filter((r) => r.mentions > 0).length;
  const loadBearingReferents = perReferent.filter((r) => r.loadBearing > 0).length;
  const weight = Math.round(perReferent.reduce((a, r) => a + r.weight, 0) * 1000) / 1000;
  const weightedMentions = mentions.filter((m) => WEIGHTS.zone[m.zone] !== 0).length;
  const decorative = perReferent.filter((r) => r.verdict === "decorative").map((r) => r.referent);

  const findings: string[] = [];
  if (present > 0 && weightedMentions === 0) {
    findings.push(
      `REFERENTS APPEAR ONLY IN THE IDENTIFICATION BLOCK: ${present} named referent(s) occur ` +
      `nowhere but the address, contact or declaration fields. The donor requires those fields; ` +
      `filling them is compliance, not evidence. No referent appears in the argument.`,
    );
  }
  if (present > 0 && loadBearingReferents === 0) {
    findings.push(
      `NO LOAD-BEARING REFERENT: every named referent in this narrative survives replacement by a ` +
      `generic placeholder — none is the subject of a claim, a counterparty to a commitment, or ` +
      `distinguished from another named referent. The document names places it does not depend on.`,
    );
  }
  if (decorative.length) {
    findings.push(
      `DECORATIVE REFERENTS: ${decorative.slice(0, 8).join(", ")}` +
      (decorative.length > 8 ? ` (+${decorative.length - 8} more)` : "") +
      ` — mentioned, but every sentence containing them reads the same with "the area" or ` +
      `"a local partner" in their place.`,
    );
  }

  return {
    offered: names.length,
    present,
    loadBearingReferents,
    weightedMentions,
    weight,
    weightPerOffered: names.length ? Math.round((weight / names.length) * 1000) / 1000 : 0,
    perReferent: perReferent.sort((a, b) => b.weight - a.weight || a.referent.localeCompare(b.referent)),
    decorative,
    mentions,
    findings,
  };
}
