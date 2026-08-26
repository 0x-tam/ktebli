// ============================================================================
// THE PRE-PAYMENT SUFFICIENCY GATE — pure scoring core
// ============================================================================
//
// Invariant 2: no money is taken for an order the system cannot fulfil.
//
// This module decides, BEFORE checkout is opened, whether the evidence in hand
// can ground a proposal. It is not advisory. `save-intake` refuses to mint a
// checkout authorisation unless `evaluateSufficiency()` returns `cleared`, and
// `stripe-webhook` refuses to create an order unless a stored, fingerprint-
// matched clearance exists for the paying intake. Both are refusals by default.
//
// Everything here is DETERMINISTIC. There is no model call in the gate. That is
// deliberate on three counts: a gate that calls a model can be prompt-injected
// by the applicant text it is scoring; a gate that calls a model fails open when
// the provider is down; and CLAUDE.md is explicit that language models cannot
// count. Nothing in this file asks anything to count anything.
//
// ---------------------------------------------------------------------------
// WHAT THIS GATE SCORES, AND WHAT IT REFUSES TO SCORE
// ---------------------------------------------------------------------------
//
// It scores ONLY evidence that is physically in hand before the card is
// charged:
//
//   * the three intake identity facts (worker/index.ts:1274-1276) — these are
//     the applicant naming ITSELF, and they contribute ZERO to the score, for
//     the same reason worker/proper_nouns.ts:104-105 excludes the applicant's
//     own name: using your own name is not particularity;
//   * typed answers to the recall-only slots defined below (E-ASK), which are
//     applicant ASSERTIONS and are never recorded as verified;
//   * text actually extracted from uploaded past proposals. `upload-intake-file`
//     runs at wizard step 3, BEFORE payment, so extracted document text is
//     genuinely in hand. Only `.docx/.txt/.md` yield text today
//     (upload-intake-file/index.ts:87-90); a `.pdf` yields nothing and is
//     scored as nothing, however reassuring the wizard's "saved" message is.
//
// It refuses to score the applicant's WEBSITE. The crawl and the asymmetric
// identity gate (`orgNameMatchesSite`, worker/index.ts:447-460) run in the `org`
// stage, after payment. Pre-payment we have a URL and nothing else. Crediting a
// site we have not fetched, and whose ownership we have not tested, would be
// exactly the manufactured provenance invariant 3 forbids. The cost is real and
// is stated rather than hidden: an applicant with an excellent website is asked
// the same questions as one with no website, and the evidence budget is spent
// twice (reports/design/challenge-conversion.md section 4.1). The gate records
// the unscored website in `detail.website_unscored` so the duplication can be
// measured later; it can never raise the score.
//
// ---------------------------------------------------------------------------
// THE SCORING RULE IS NOT KNOWN YET
// ---------------------------------------------------------------------------
//
// A referent ladder (`reports/referent-ladder.md`) is running to determine
// whether fundability tracks referent COUNT, referent SPECIFICITY, or neither.
// Until it reports, this file must not pretend to know.
//
// So the bar has two arms and they behave differently:
//
//   HARD FLOOR — not ladder-derived, and not a fundability claim. It says only
//   that a ledger carrying nothing at all about the world beyond the applicant's
//   own name cannot ground any assertion, which follows from invariant 3 alone.
//   reports/design/ground-evidence.md section 4 establishes that today's intake
//   yields exactly one real-world proper noun — the applicant's own name — so
//   today's ledger scores ZERO against this floor and every current order
//   would refuse.
//
//   LADDER ARM — provisional, currently `null` (unknown). When the ladder
//   reports it sets `ladder` and `ladderStatus`. It is applied through
//   `effectiveThreshold()`, which takes the MAXIMUM of the two arms. The
//   provisional arm can therefore only ever RAISE the bar. There is no value it
//   can take that lowers or disables the gate, which is why this is not a
//   configuration flag in the sense the invariants forbid.
//
// If the ladder comes back FLAT — neither count nor specificity predicts
// fundability — set `ladderStatus: "flat"`. The gate keeps running on the hard
// floor and required-slot arms, and `ladderVerdictNote()` returns the sentence
// saying, in plain words, that this gate's scoring rule is unsupported and what
// has to change. The design is required to be able to say it is wrong.
// ============================================================================

import { normPN, properNouns } from "./proper_nouns.ts";

export const SUFFICIENCY_CONTRACT_VERSION = "1.0.0";

// Control characters, stripped from every stored and echoed answer. Matching
// them is the whole point: a customer answer is echoed back into a page and
// stored in a ledger, and neither should carry a NUL or an escape sequence.
// deno-lint-ignore no-control-regex
const CTRL = /[\u0000-\u001f\u007f]+/g;

// ---------------------------------------------------------------------------
// THE THRESHOLD. ONE PLACE. Nothing else in this file compares a score to a
// number — `clearsScoreBar()` below is the single comparison, and the test suite
// asserts that by scanning this file's own source.
// ---------------------------------------------------------------------------

export type LadderStatus = "pending" | "count" | "specificity" | "flat";

export interface Threshold {
  /** Invariant-derived, NOT ladder-derived. See the header. Never lower this. */
  readonly hardFloor: number;
  /**
   * PROVISIONAL. Set ONLY by the referent ladder (reports/referent-ladder.md).
   * `null` means "not yet known" — the hard floor governs alone.
   */
  readonly ladder: number | null;
  /** What the ladder found. Chooses the active scorer. */
  readonly ladderStatus: LadderStatus;
}

export const SUFFICIENCY_THRESHOLD: Threshold = {
  hardFloor: 1,
  ladder: null,
  ladderStatus: "pending",
};

/** The bar actually applied. Monotone upward: the provisional arm cannot lower it. */
export function effectiveThreshold(t: Threshold = SUFFICIENCY_THRESHOLD): number {
  return t.ladder === null ? t.hardFloor : Math.max(t.hardFloor, t.ladder);
}

/** The ONLY comparison of a score against the bar anywhere in the system. */
function clearsScoreBar(scoreValue: number, t: Threshold): boolean {
  return scoreValue >= effectiveThreshold(t);
}

export function thresholdSource(t: Threshold = SUFFICIENCY_THRESHOLD): string {
  return t.ladder === null
    ? `hard_floor_only(${t.hardFloor}) ladder=${t.ladderStatus}`
    : `max(hard_floor ${t.hardFloor}, ladder ${t.ladder}) ladder=${t.ladderStatus}`;
}

/** What this gate cannot know until the ladder reports, in one sentence. */
export function ladderVerdictNote(t: Threshold = SUFFICIENCY_THRESHOLD): string {
  switch (t.ladderStatus) {
    case "pending":
      return "The referent ladder has not reported. This gate currently stops only orders whose " +
        "evidence is empty; it does not yet stop orders that are merely thin, because no measured " +
        "bar for 'thin' exists.";
    case "count":
      return `The ladder found fundability tracking referent COUNT. The count scorer is active and the bar is ${effectiveThreshold(t)}.`;
    case "specificity":
      return `The ladder found fundability tracking referent SPECIFICITY. The specificity scorer is active and the bar is ${effectiveThreshold(t)}.`;
    case "flat":
      return "The ladder came back FLAT: neither referent count nor referent specificity predicts " +
        "fundability. This gate's scoring rule is therefore WRONG and the score arm carries no " +
        "evidential weight. The gate still refuses empty ledgers and unanswered required slots, " +
        "which follow from invariants 2 and 3 rather than from the ladder — but the scoring rule " +
        "must be replaced before any number above the hard floor is claimed to mean anything.";
  }
}

// PROVISIONAL, exactly like the threshold: the ladder chooses whether these
// weights matter at all. They are here so the specificity rule is a real,
// testable, pluggable alternative rather than a promise.
export const SPECIFICITY_WEIGHTS = {
  base: 1.0,
  dated: 0.75, // the slot carries a resolvable date
  compound: 0.5, // another referent named in the same slot (a venue in a named street)
  activity: 0.5, // the slot says what actually happens there, in >= 12 characters
  documented: 1.0, // the referent came out of a document we could read AND could attribute
  cap: 3.0, // no single referent may dominate the score
} as const;

// ---------------------------------------------------------------------------
// Slots. The pre-payment floor: recall only, no lookups, no numbers, no
// documents to fetch. reports/design/challenge-conversion.md sections 5 and 6.3.
// ---------------------------------------------------------------------------

export type SlotId =
  | "site_place"
  | "site_venue"
  | "site_activity"
  | "last_delivery_what"
  | "last_delivery_when"
  | "local_trigger";

export type GapScope = SlotId | "uploads" | "score" | "grant" | "organisation" | "deadline" | "tier";

interface SlotDef {
  id: SlotId;
  required: boolean;
  /** A referent must be extractable from this slot's answer for it to count as answered. */
  needsReferent: boolean;
  maxChars: number;
  ask: string;
  why: string;
  example: string;
  /** Offered when the honest answer is "there isn't one". Never a way to skip. */
  escape?: string;
}

export const SLOTS: readonly SlotDef[] = [
  {
    id: "site_place",
    required: true,
    needsReferent: true,
    maxChars: 200,
    ask: "Which town, city or neighbourhood will this project work in?",
    why: "Funders fund somewhere. Without a place name the proposal can only say " +
      "\"the local community\", and reviewers read that as a template.",
    example: "Bab al-Tabbaneh, Tripoli — or Tower Hamlets, London.",
  },
  {
    id: "site_venue",
    required: true,
    needsReferent: true,
    maxChars: 200,
    ask: "What is the place called where it actually happens?",
    why: "A named building is the single most load-bearing detail in a delivery plan: " +
      "it recurs in the needs statement, the workplan and the capability section.",
    example: "the Old Bakehouse on Ashfield Road; St Anne's Hall; Qobbe Primary School.",
    escape: "If there is no fixed venue — you work in people's homes, on the street, " +
      "outdoors, from a vehicle, or online — say so instead and we will write it that way.",
  },
  {
    id: "site_activity",
    required: true,
    needsReferent: false,
    maxChars: 300,
    ask: "What happens there, in one line?",
    why: "It is what turns a place name into a described service rather than an address.",
    example: "a Thursday evening drop-in for 14-19s, with hot food and a homework hour.",
  },
  {
    id: "last_delivery_what",
    required: true,
    needsReferent: true,
    maxChars: 200,
    ask: "The last thing your organisation actually delivered — what was it called?",
    why: "One named prior project is the difference between a track record and an adjective.",
    example: "the Qobbe school-bag distribution; the Ashfield Summer Kitchen.",
    escape: "If your organisation has not delivered anything yet, say so. We will write the " +
      "proposal without a track record and state plainly that this is your first project.",
  },
  {
    id: "last_delivery_when",
    required: true,
    needsReferent: false,
    maxChars: 100,
    ask: "Roughly when was that?",
    why: "An undated achievement reads as a claim; a dated one reads as a fact.",
    example: "winter 2024; since March 2023.",
  },
  {
    id: "local_trigger",
    required: true,
    needsReferent: false,
    maxChars: 240,
    ask: "What happened locally that made this needed?",
    why: "It is the only thing you can tell us that no website and no document can. " +
      "It is what stops your opening paragraph being interchangeable with anyone else's.",
    example: "the council closed the Ashfield youth centre in April and the nearest " +
      "alternative is now four miles away.",
  },
];

export type VenueEscape = "homes" | "street" | "outdoors" | "mobile" | "online";
const VENUE_ESCAPE_CLAIM: Record<VenueEscape, string> = {
  homes: "The applicant states delivery happens in participants' own homes, not at a fixed venue.",
  street: "The applicant states delivery is street-based outreach, not at a fixed venue.",
  outdoors: "The applicant states delivery happens outdoors, not at a fixed venue.",
  mobile: "The applicant states delivery is mobile, from a vehicle, not at a fixed venue.",
  online: "The applicant states delivery happens online, not at a fixed venue.",
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface UploadedDoc {
  /** Filename as the customer sees it. Echoed back to them, never into a prompt. */
  name: string;
  /** Text `upload-intake-file` actually extracted. null for .pdf/.doc today. */
  extracted_text: string | null;
}

export interface SufficiencyInput {
  tier: string;
  /** True when a server-side checkout can actually be created for this tier. */
  checkoutAvailable: boolean;

  org: string;
  registration?: string | null;
  website?: string | null;
  email: string;

  /** The grant link or pasted guidelines, exactly as stored by save-intake. */
  grant: string;
  /** Did `analyze-grant` return a usable object for this input? */
  grantAnalysisOk: boolean;
  /** The donor's own name, if analyze-grant found one. Excluded from the score. */
  grantIssuer?: string | null;
  /** ISO date, from analysis or typed. */
  deadline?: string | null;

  answers: Partial<Record<SlotId, string>>;
  venueEscape?: VenueEscape | null;
  neverDelivered?: boolean;

  uploads?: UploadedDoc[];
}

export interface Referent {
  text: string;
  key: string;
  slot: SlotId | "uploads";
  anchors: string[];
}

export interface ScoreResult {
  scorer: string;
  rule: "count" | "specificity";
  value: number;
  referents: Referent[];
  detail: Record<string, unknown>;
}

export interface Scorer {
  id: string;
  rule: "count" | "specificity";
  describe: string;
  score(referents: readonly Referent[]): ScoreResult;
}

export interface Blocker {
  scope: GapScope;
  code: string;
  /** Customer-facing. Says exactly what cannot be fulfilled, never "insufficient". */
  message: string;
  detail?: string;
}

export interface Gap {
  scope: GapScope;
  code: string;
  ask: string;
  why: string;
  example: string;
  escape?: string;
  /** The customer's own words, verbatim. Render with textContent, never innerHTML. */
  echo?: string;
}

export interface LedgerItem {
  id: string;
  claim: string;
  source_type: string;
  source_ref: string;
  status: string;
  allowed: boolean;
  slot?: SlotId;
  /** Applicant assertions are NEVER "verified". Nothing here manufactures provenance. */
  assertion?: "applicant_asserted";
}

export interface CustomerMessage {
  headline: string;
  intro: string;
  items: Gap[];
  blockers: Blocker[];
  reassurance: string;
}

export interface Verdict {
  cleared: boolean;
  contract_version: string;
  scorer: string;
  rule: "count" | "specificity";
  score: number;
  threshold: number;
  threshold_source: string;
  ladder_status: LadderStatus;
  ladder_note: string;
  blockers: Blocker[];
  gaps: Gap[];
  ledger: LedgerItem[];
  referents: Referent[];
  detail: Record<string, unknown>;
  message: CustomerMessage;
  /** Canonical serialisation of exactly what was scored. Hash this and bind the charge to it. */
  canonical: string;
}

// ---------------------------------------------------------------------------
// Referent extraction — deterministic, reusing worker/proper_nouns.ts
// ---------------------------------------------------------------------------

// `properNouns` drops the first word of a run that starts at a sentence boundary,
// because English capitalises sentence openers. A form field is not a sentence:
// "Old Bakehouse on Ashfield Road" typed into a box would lose "Old". So an
// answer is extracted behind a neutral stem, and its own internal sentence
// punctuation is softened to commas for extraction only. The customer's text is
// never modified anywhere it is stored, echoed or shown.
const EXTRACT_STEM = "Recorded in the intake form ";

export function referentsIn(text: string): string[] {
  const t = String(text ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const softened = t.replace(/[.;:!?]+/g, ",");
  return properNouns(EXTRACT_STEM + softened);
}

const PN_GLUE = new Set(["of", "the", "de", "la", "le", "du", "el", "al"]);
function refKey(s: string): Set<string> {
  return new Set(normPN(s).split(" ").filter((w) => w && !PN_GLUE.has(w)));
}
/** Every word of the shorter name appears in the longer one, order-insensitive. */
function sameReferent(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

// Mirrors worker/index.ts:433-446. Used only to test whether an uploaded document
// belongs to the applicant, with the same asymmetry as `orgNameMatchesSite`:
// anything short of a confident match contributes nothing.
const ORG_GENERIC_WORDS = new Set([
  "the", "of", "for", "and", "a", "an", "association", "foundation", "trust", "society",
  "project", "projects", "international", "community", "group", "organisation", "organization",
  "charity", "charitable", "fund", "funds", "network", "centre", "center", "institute",
  "council", "alliance", "collective", "partners", "partnership", "initiative", "services",
  "service", "ltd", "limited", "inc", "incorporated", "nonprofit", "non", "profit", "ngo",
  "national", "global", "development", "welfare", "aid", "relief", "union",
]);
export function orgTokens(raw: string): Set<string> {
  return new Set(
    String(raw ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
      .filter((t) => t.length > 2 && !ORG_GENERIC_WORDS.has(t)),
  );
}
export function documentIsAttributable(orgName: string, text: string): boolean {
  const want = orgTokens(orgName);
  if (!want.size) return false;
  const flat = ` ${String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const t of want) if (flat.includes(` ${t} `)) return true;
  return false;
}

const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
function hasDate(s: string | undefined): boolean {
  const t = String(s ?? "");
  return /\b(19|20)\d{2}\b/.test(t) || MONTHS.test(t) || /\b(spring|summer|autumn|winter)\b/i.test(t);
}

// ---------------------------------------------------------------------------
// The two scorers. Both pure. The ladder chooses which one is real.
// ---------------------------------------------------------------------------

function tally(referents: readonly Referent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of referents) out[r.slot] = (out[r.slot] ?? 0) + 1;
  return out;
}

export const countScorer: Scorer = {
  id: "referent-count-v1",
  rule: "count",
  describe: "Distinct named referents the pre-payment evidence carries, excluding the " +
    "applicant's own name and the donor's name.",
  score(referents) {
    return {
      scorer: countScorer.id,
      rule: "count",
      value: referents.length,
      referents: [...referents],
      detail: { by_slot: tally(referents) },
    };
  },
};

export const specificityScorer: Scorer = {
  id: "referent-specificity-v1",
  rule: "specificity",
  describe: "Weighted referents: a name bound to a date, to a described activity, to " +
    "another name in the same answer, or to readable attributable document text, counts " +
    "for more than a bare name.",
  score(referents) {
    const W = SPECIFICITY_WEIGHTS;
    let total = 0;
    const per: Record<string, number> = {};
    for (const r of referents) {
      let w: number = W.base;
      if (r.anchors.includes("dated")) w += W.dated;
      if (r.anchors.includes("compound")) w += W.compound;
      if (r.anchors.includes("activity")) w += W.activity;
      if (r.anchors.includes("documented")) w += W.documented;
      w = Math.min(w, W.cap);
      per[r.text] = w;
      total += w;
    }
    return {
      scorer: specificityScorer.id,
      rule: "specificity",
      value: Math.round(total * 100) / 100,
      referents: [...referents],
      detail: { weights: per, by_slot: tally(referents) },
    };
  },
};

/** Which scorer the ladder's answer selects. Pending and flat both fall back to count. */
export function activeScorer(t: Threshold = SUFFICIENCY_THRESHOLD): Scorer {
  return t.ladderStatus === "specificity" ? specificityScorer : countScorer;
}

// ---------------------------------------------------------------------------
// Fulfilment blockers — "cannot fulfil", separate from "evidence too thin"
// ---------------------------------------------------------------------------

export const MIN_GRANT_CHARS = 600;

const ORG_STOPWORDS =
  /^(test|testing|asdf+|demo|sample|example|abc+|xyz+|xxx+|qwerty|none|null|n\/?a|foo|bar|placeholder|org|organisation|organization|company|tbd|todo)$/i;

function fulfilmentBlockers(input: SufficiencyInput, now: Date): Blocker[] {
  const out: Blocker[] = [];

  if (!input.checkoutAvailable) {
    out.push({
      scope: "tier",
      code: "tier_unavailable",
      message: `We cannot take payment for the ${input.tier} package right now, so we are not ` +
        `going to pretend we can. Choose another package, or write to us and we will tell you when it opens.`,
    });
  }

  const org = String(input.org ?? "").replace(CTRL, " ").trim().replace(/\s+/g, " ");
  if (org.length < 4) {
    out.push({
      scope: "organisation",
      code: "org_too_short",
      message: "We need the organisation's registered name, not an abbreviation — it goes on " +
        "the application exactly as you type it here.",
    });
  } else if (ORG_STOPWORDS.test(org) || /^(.)\1{3,}$/.test(org) || !/[aeiouyà-ÿ]/i.test(org)) {
    out.push({
      scope: "organisation",
      code: "org_placeholder",
      message: "That does not look like a real organisation name. The funder will read it, so " +
        "it has to be the name you are registered under.",
    });
  } else if (/^(https?:\/\/|www\.)/i.test(org) || org.includes("@")) {
    out.push({
      scope: "organisation",
      code: "org_looks_like_address",
      message: "That looks like a web address or an email rather than an organisation name.",
    });
  }

  const grantText = String(input.grant ?? "").trim();
  if (!input.grantAnalysisOk && grantText.length < MIN_GRANT_CHARS) {
    out.push({
      scope: "grant",
      code: "grant_unreadable",
      message: `We could not open that link, and the text you pasted is ${grantText.length} ` +
        `characters. We build the whole proposal against the donor's own requirements, and we ` +
        `cannot extract a requirement list from that. Paste the guidelines themselves — the ` +
        `eligibility, the questions, the word limits — and we will take it from there.`,
      detail: `grant_chars=${grantText.length} min=${MIN_GRANT_CHARS}`,
    });
  }

  const dl = String(input.deadline ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(dl)) {
    const when = new Date(`${dl}T23:59:59Z`);
    if (when.getTime() < now.getTime()) {
      out.push({
        scope: "deadline",
        code: "deadline_passed",
        message: `The deadline for this grant is ${dl}, which has already passed. We would be ` +
          `writing an application nobody can submit. If that date is wrong, correct it and we ` +
          `will carry on.`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Assembly: the pre-payment ledger and the referent set
// ---------------------------------------------------------------------------

function trimmed(v: string | undefined | null, max: number): string {
  return String(v ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function mkIntake(n: number, claim: string): LedgerItem {
  return {
    id: `E-INTAKE-${n}`,
    claim,
    source_type: "user_intake",
    source_ref: "order form",
    status: "verified",
    allowed: true,
  };
}

interface Assembly {
  ledger: LedgerItem[];
  referents: Referent[];
  gaps: Gap[];
  detail: Record<string, unknown>;
}

function assemble(input: SufficiencyInput): Assembly {
  const ledger: LedgerItem[] = [];
  const gaps: Gap[] = [];
  const detail: Record<string, unknown> = {};
  let askSeq = 0;
  const addAsk = (claim: string, slot: SlotId) => {
    ledger.push({
      id: `E-ASK-${++askSeq}`,
      claim,
      source_type: "user_intake",
      source_ref: "order form (pre-payment questions)",
      status: "asserted",
      allowed: true,
      slot,
      assertion: "applicant_asserted",
    });
  };

  // ---- identity: the same three items the worker builds, worth ZERO -------
  const org = trimmed(input.org, 300);
  let n = 0;
  if (org) ledger.push(mkIntake(++n, `Organisation name: ${org}`));
  const reg = trimmed(input.registration, 100);
  if (reg) ledger.push(mkIntake(++n, `Registration number: ${reg}`));
  const website = trimmed(input.website, 300);
  if (website) ledger.push(mkIntake(++n, `Website: ${website}`));
  detail.website_unscored = website || null;

  // Names that are not particularity: the applicant's own, and the donor's.
  const excluded: Array<Set<string>> = [];
  for (const p of properNouns(EXTRACT_STEM + org)) excluded.push(refKey(p));
  for (const t of orgTokens(org)) excluded.push(new Set([t]));
  const issuer = trimmed(input.grantIssuer, 200);
  if (issuer) {
    for (const p of properNouns(EXTRACT_STEM + issuer)) excluded.push(refKey(p));
    for (const t of orgTokens(issuer)) excluded.push(new Set([t]));
  }
  if (website) {
    const host = normPN(website.replace(/^www\./, "").replace(/\.[a-z.]+$/i, ""));
    for (const w of host.split(" ")) if (w) excluded.push(new Set([w]));
  }

  const seen: Array<Set<string>> = [];
  const referents: Referent[] = [];
  const push = (text: string, slot: SlotId | "uploads", anchors: string[]): boolean => {
    const key = refKey(text);
    if (!key.size) return false;
    if (excluded.some((e) => sameReferent(key, e))) return false;
    if (seen.some((s) => sameReferent(key, s))) return false;
    seen.push(key);
    referents.push({ text, key: [...key].sort().join(" "), slot, anchors });
    return true;
  };

  // ---- typed slots (E-ASK) ------------------------------------------------
  const answers: Partial<Record<SlotId, string>> = {};
  for (const s of SLOTS) answers[s.id] = trimmed(input.answers?.[s.id], s.maxChars);

  const venueEscaped = !!input.venueEscape && input.venueEscape in VENUE_ESCAPE_CLAIM;
  const neverDelivered = input.neverDelivered === true;
  const activityRich = (answers.site_activity ?? "").length >= 12;
  const dated = hasDate(answers.last_delivery_when);
  const perSlotCounts: Record<string, number> = {};

  for (const s of SLOTS) {
    const escapedHere = (s.id === "site_venue" && venueEscaped) ||
      ((s.id === "last_delivery_what" || s.id === "last_delivery_when") && neverDelivered);
    if (escapedHere) continue;

    const a = answers[s.id] ?? "";
    if (!a) {
      if (s.required) {
        gaps.push({
          scope: s.id,
          code: `${s.id}_missing`,
          ask: s.ask,
          why: s.why,
          example: s.example,
          escape: s.escape,
        });
      }
      continue;
    }

    const found = referentsIn(a);
    let added = 0;
    for (const f of found) {
      const anchors: string[] = [];
      if (s.id === "last_delivery_what" && dated) anchors.push("dated");
      if ((s.id === "site_venue" || s.id === "site_place") && activityRich) anchors.push("activity");
      if (found.length > 1) anchors.push("compound");
      if (push(f, s.id, anchors)) added++;
    }
    perSlotCounts[s.id] = added;

    if (s.needsReferent && added === 0) {
      gaps.push({
        scope: s.id,
        code: `${s.id}_unnamed`,
        ask: s.ask,
        why: `${s.why} We read your answer and could not find a name in it.`,
        example: s.example,
        escape: s.escape,
        echo: a,
      });
      continue;
    }

    addAsk(`${s.ask} ${a}`, s.id);
  }

  if (venueEscaped) addAsk(VENUE_ESCAPE_CLAIM[input.venueEscape as VenueEscape], "site_venue");
  if (neverDelivered) {
    addAsk(
      "The applicant states it has not yet delivered a project. There is no track record to " +
        "draw on and the proposal must not imply one.",
      "last_delivery_what",
    );
  }

  // ---- uploaded documents, only where text was really extracted ----------
  const uploads = input.uploads ?? [];
  const docStats: Array<Record<string, unknown>> = [];
  for (const u of uploads) {
    const name = trimmed(u.name, 200) || "your upload";
    const text = u.extracted_text ?? null;
    if (!text || text.length < 300) {
      docStats.push({ file: name, read: false, reason: "no_text_extracted" });
      gaps.push({
        scope: "uploads",
        code: "upload_unreadable",
        ask: "Re-upload it as .docx, or answer the questions above instead.",
        why: "We could not read that file. Today we can only pull text out of .docx, .txt and " +
          ".md — a .pdf is stored but nothing is extracted from it, so it adds nothing to your " +
          "proposal. Nothing is lost either way; the questions above do the same job.",
        example: "In Word: File, then Save a Copy, then Word Document (.docx).",
        echo: name,
      });
      continue;
    }
    if (!documentIsAttributable(org, text)) {
      docStats.push({ file: name, read: true, attributable: false });
      gaps.push({
        scope: "uploads",
        code: "upload_not_attributable",
        ask: "Upload a document that names your organisation, or answer the questions above.",
        why: `We read that file, and the name you gave us does not appear anywhere in it. We ` +
          `will not treat another organisation's work as yours — that is a false statement to a ` +
          `funder, and it is the one mistake we refuse to make.`,
        example: "An annual report, a past application, or a project report with your letterhead.",
        echo: name,
      });
      continue;
    }
    const found = referentsIn(text.slice(0, 40_000));
    let added = 0;
    for (const f of found) if (push(f, "uploads", ["documented"])) added++;
    docStats.push({ file: name, read: true, attributable: true, referents: added });
  }

  detail.uploads = docStats;
  detail.per_slot_referents = perSlotCounts;
  detail.escapes = { venue: input.venueEscape ?? null, never_delivered: neverDelivered };

  return { ledger, referents, gaps, detail };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface EvaluateOptions {
  scorer?: Scorer;
  threshold?: Threshold;
  now?: Date;
}

export function evaluateSufficiency(input: SufficiencyInput, opts: EvaluateOptions = {}): Verdict {
  const t = opts.threshold ?? SUFFICIENCY_THRESHOLD;
  const scorer = opts.scorer ?? activeScorer(t);
  const now = opts.now ?? new Date();

  const blockers = fulfilmentBlockers(input, now);
  const { ledger, referents, gaps, detail } = assemble(input);
  const score = scorer.score(referents);

  const bar = effectiveThreshold(t);
  const scoreOk = clearsScoreBar(score.value, t);
  if (!scoreOk) {
    gaps.push({
      scope: "score",
      code: "too_thin",
      ask: "Add one more concrete detail — a street, a school, a partner you actually work with, " +
        "or the name of something you have already run.",
      why: `Across everything you have given us we found ${score.value} named thing` +
        `${score.value === 1 ? "" : "s"} specific to you, and we need at least ${bar}. ` +
        `Every fact in your proposal has to trace back to something you told us, so with nothing ` +
        `specific in hand we would be writing a document that could belong to any organisation — ` +
        `and that is the document funders reject.`,
      example: "\"We run it from St Anne's Hall on Bellenden Road\" is worth more than three " +
        "paragraphs about our values.",
    });
  }

  // Refusal by default. `cleared` is derived here and nowhere else; nothing
  // upstream can assert it.
  const cleared = blockers.length === 0 && gaps.length === 0 && scoreOk;

  const verdict: Verdict = {
    cleared,
    contract_version: SUFFICIENCY_CONTRACT_VERSION,
    scorer: scorer.id,
    rule: scorer.rule,
    score: score.value,
    threshold: bar,
    threshold_source: thresholdSource(t),
    ladder_status: t.ladderStatus,
    ladder_note: ladderVerdictNote(t),
    blockers,
    gaps,
    ledger,
    referents: score.referents,
    detail: { ...detail, score_detail: score.detail, scorer_describe: scorer.describe },
    message: buildMessage(cleared, blockers, gaps),
    canonical: canonicalPayload(input),
  };
  assertVerdictConsistent(verdict);
  return verdict;
}

/**
 * No stage may pass a gate by asserting it passed. Any caller that receives a
 * Verdict — including `stripe-webhook` reading one back out of the database —
 * re-derives the claim from the verdict's own parts before acting on it.
 */
export function assertVerdictConsistent(v: Verdict): void {
  const derived = v.blockers.length === 0 && v.gaps.length === 0 && v.score >= v.threshold;
  if (derived !== v.cleared) {
    throw new Error(
      `sufficiency: verdict claims cleared=${v.cleared} but its own parts derive ${derived} ` +
        `(blockers=${v.blockers.length} gaps=${v.gaps.length} score=${v.score} threshold=${v.threshold})`,
    );
  }
}

// ---------------------------------------------------------------------------
// The customer-facing message. "Insufficient evidence" is a failure of this
// design: every item names the specific thing that is missing and shows what a
// good answer looks like.
// ---------------------------------------------------------------------------

function buildMessage(cleared: boolean, blockers: Blocker[], gaps: Gap[]): CustomerMessage {
  if (cleared) {
    return {
      headline: "We have what we need.",
      intro: "Everything checks out. Payment next, and the writing starts the moment it clears.",
      items: [],
      blockers: [],
      reassurance: "",
    };
  }
  const n = blockers.length + gaps.length;
  return {
    headline: blockers.length
      ? "We are not taking your payment, because we could not do this properly."
      : `We are not taking your payment yet — ${n === 1 ? "one thing is" : `${n} things are`} missing.`,
    intro: blockers.length
      ? "One or more of these has to be sorted out before there is an order we could deliver at all:"
      : "Nothing has been charged. Each of these changes what we can actually write, so we would " +
        "rather ask now than send you a document full of \"the local community\":",
    items: gaps,
    blockers,
    reassurance: "Your answers are saved. Fix these and the payment button opens — no card " +
      "details have been touched.",
  };
}

/** Flattened, ready to render. The client MUST render `echo` with textContent. */
export function gapLines(v: Verdict): string[] {
  const out: string[] = [];
  for (const b of v.blockers) out.push(`${b.code}: ${b.message}`);
  for (const g of v.gaps) out.push(`${g.code}: ${g.ask} — ${g.why}`);
  return out;
}

// ---------------------------------------------------------------------------
// Binding the charge to the thing that was scored
// ---------------------------------------------------------------------------

/**
 * Canonical serialisation of EXACTLY the fields the score was computed over.
 * `stripe-webhook` recomputes this from the stored intake row and refuses to
 * create an order if it does not hash to the fingerprint recorded with the
 * clearance — so a customer cannot clear the gate with good answers, edit them
 * down, and then pay.
 */
export function canonicalPayload(input: SufficiencyInput): string {
  const answers: Record<string, string> = {};
  for (const s of SLOTS) {
    const v = trimmed(input.answers?.[s.id], s.maxChars);
    if (v) answers[s.id] = v;
  }
  const uploads = (input.uploads ?? []).map((u) => ({
    name: trimmed(u.name, 200),
    len: u.extracted_text ? u.extracted_text.length : 0,
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return JSON.stringify({
    v: SUFFICIENCY_CONTRACT_VERSION,
    tier: String(input.tier ?? ""),
    org: trimmed(input.org, 300),
    registration: trimmed(input.registration, 100),
    website: trimmed(input.website, 300),
    email: String(input.email ?? "").trim().toLowerCase(),
    grant_len: String(input.grant ?? "").trim().length,
    grant_ok: !!input.grantAnalysisOk,
    deadline: String(input.deadline ?? ""),
    answers,
    venue_escape: input.venueEscape ?? null,
    never_delivered: input.neverDelivered === true,
    uploads,
  });
}

/** SHA-256 of `canonicalPayload`. Web Crypto only — same in Deno and in the edge runtime. */
export async function fingerprint(input: SufficiencyInput): Promise<string> {
  return await fingerprintOfCanonical(canonicalPayload(input));
}

export async function fingerprintOfCanonical(canonical: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
