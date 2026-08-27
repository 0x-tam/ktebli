// The pre-delivery quality gate. Invariant 1: nothing unfundable is ever delivered.
//
// It stands between `package` and `deliver` and it can do exactly two things:
// PASS, or HOLD. There is no third outcome, no score that rounds up, no "pass
// with reservations", and no configuration flag that turns it off. Refusal is
// the default: an outcome is `pass` only when every condition of the published
// bar was affirmatively cleared by two critics who both returned a judgement we
// could parse. Anything else — a failing score, a triggered disqualifier, a
// timeout, a malformed reply, a judge configured in the generator's own model
// family — is a hold.
//
// WHY IT IS NOT JUST ANOTHER VALIDATOR
//
// reports/launch-readiness-report.md §P1.8: "every failing proposal passed every
// internal validator." The validators were built to detect DEFECTS. The bar in
// reports/quality-standard.md was written to be failable by a technically clean
// document. This gate enforces THAT bar — the same ten dimensions and the same
// disqualifying conditions the blind critics use — and it enforces it on the
// finished document, with no view of the pipeline that produced it.
//
// TWO LAYERS, AND THE BLINDNESS RULE APPLIES TO ONLY ONE OF THEM
//
//   preflight()  deterministic. May read pipeline artefacts (the evidence
//                ledger), because it computes FACTS, not opinions, and cannot
//                be flattered by prose. Nothing it produces is shown to a model.
//   critics      blind. Each sees only what a donor's reviewer sees: the grant
//                text, the applicant's identity, and the narrative. Never the
//                strategy object, the design object, the ledger, the validator
//                output, or the fact that a pipeline exists.
//
// The split is deliberate. Disqualifier 4 ("available evidence is unused") is
// unjudgeable by a blind critic — it requires knowing what the ledger held — so
// it is computed here, deterministically, from properNounAudit(). Symmetrically,
// nothing in this file asks a model to count anything (CLAUDE.md: language
// models cannot count words).
//
// WHAT THIS GATE DELIBERATELY DOES NOT RE-CHECK
//
// Truncation, required sections, degenerate tables and the rest of
// contentViolations() are enforced at generation time by the real markdown
// parser in index.ts. Re-implementing a second, weaker parser here would produce
// a *different* answer on the same document, and a gate that disagrees with the
// renderer is worse than no gate. Unsourced proper nouns are likewise not
// blocking here: index.ts:1715-1720 records the reason — naming your own new
// project reads as unsourced to a string matcher — and the Claim Ledger remains
// the grounding gate. Only checks that are cheap, exact, and free of that
// failure mode live in preflight().
//
// THE RE-JUDGE RULE
//
// A verdict is bound to a hash of the document that earned it. Re-judging an
// unchanged document returns the stored verdict; it is never a fresh roll of the
// dice. Terminal verdicts (`pass`, and holds on the merits) are sticky. A hold
// whose cause is the ABSENCE of a judgement — a timeout, a garbage reply, a
// misconfigured judge — is not sticky, because it is not a judgement, and
// re-attempting it is not re-rolling. That distinction is the whole of it, and
// it is enforced in the database too (a partial unique index), not only here.
//
// FAIL CLOSED
//
// A model that fails, times out, or returns garbage yields NO judgement, and no
// judgement means the gate was not affirmatively cleared, so the document is
// held. Fail-open would mean a provider outage silently disables invariant 1 —
// a gate whose failure mode is "deliver anyway" is not a gate, it is a log line.
// The cost of failing closed is bounded and is paid by us, not the customer: a
// hold goes first to regeneration, and only a document that still cannot clear
// reaches refund-plus-written-explanation. Refunding a customer whose document
// might have been fine costs money; delivering an unfundable document costs them
// the grant round, and no refund buys that back.

import { properNounAudit } from "./proper_nouns.ts";

const GATE_VERSION = "delivery-gate-v1";

// ---------------------------------------------------------------- the bar
// reports/quality-standard.md §2. The keys are the wire format the critics
// answer in; `n` is the dimension number in the published standard.
interface Dimension { n: number; key: string; name: string; weighted: boolean }
const DIMENSIONS: readonly Dimension[] = [
  { n: 1, key: "donor_fit", name: "Donor fit", weighted: true },
  { n: 2, key: "strategic_quality", name: "Strategic quality", weighted: false },
  { n: 3, key: "organisation_fit", name: "Organisation fit", weighted: true },
  { n: 4, key: "specificity", name: "Specificity", weighted: false },
  { n: 5, key: "problem_intervention_logic", name: "Problem to intervention logic", weighted: false },
  { n: 6, key: "feasibility", name: "Feasibility", weighted: true },
  { n: 7, key: "evidence_use", name: "Evidence use", weighted: false },
  { n: 8, key: "persuasiveness", name: "Persuasiveness", weighted: false },
  { n: 9, key: "clarity", name: "Clarity", weighted: false },
  { n: 10, key: "submission_readiness", name: "Submission readiness", weighted: true },
];

// §3: "a case passes only when it clears every disqualifier AND scores >=3 on all
// ten dimensions AND >=4 on dimensions 1, 3, 6 and 10."
const MIN_SCORE = 3;
const WEIGHTED_MIN = 4;

// §3, the nine disqualifying conditions, plus the overriding rule stated
// immediately after them ("Overclaiming is a failure, not a stylistic choice"),
// which is encoded as a tenth because it is a condition, not a score.
// A `true` from a critic means THE CONDITION IS PRESENT, i.e. the proposal fails.
interface Disqualifier { code: string; key: string; text: string }
const DISQUALIFIERS: readonly Disqualifier[] = [
  { code: "D1", key: "generic_intervention", text: "the central intervention is generic — the same answer would be obvious for any applicant to this grant" },
  { code: "D2", key: "organisation_fit_questionable", text: "the proposed work does not follow from what this organisation is or does, or assumes capability that is not evidenced" },
  { code: "D3", key: "sustainability_empty", text: "sustainability is empty language rather than a named mechanism with an owner, a cost and a payer" },
  { code: "D4", key: "evidence_unused", text: "material that was available about the organisation is not drawn on" },
  { code: "D5", key: "problem_activities_disconnect", text: "the problem statement does not lead to the activities" },
  { code: "D6", key: "targets_arbitrary", text: "targets are round numbers with no derivation, or the activities plainly cannot produce them" },
  { code: "D7", key: "activity_unrealistic", text: "a major activity is unrealistic at the stated budget, timeline or staffing" },
  { code: "D8", key: "reads_ai_generated", text: "it reads obviously machine-generated — uniform paragraph rhythm, tri-colon lists, abstract nouns doing the work of concrete ones, no authorial judgement" },
  { code: "D9", key: "priorities_not_integrated", text: "donor priorities are named but change nothing about the design" },
  { code: "D10", key: "overclaims_beyond_evidence", text: "it papers over a gap between the applicant and the grant instead of stating the limit plainly" },
];

// D4 is computed deterministically in preflight(), never asked of a blind critic:
// it cannot see what the ledger held. Critics answer the other nine.
const CRITIC_DISQUALIFIERS = DISQUALIFIERS.filter((d) => d.key !== "evidence_unused");

// ---------------------------------------------------------------- types
type GateDecision = "pass" | "hold";

// `bar_not_cleared` and `preflight_failed` are judgements about the document and
// are STICKY: the same document gets the same answer forever. The other two are
// the absence of a judgement and are retryable.
type GateCause =
  | "bar_not_cleared"
  | "preflight_failed"
  | "judgement_unavailable"
  | "judge_misconfigured";

interface Judgement {
  scores: Record<string, number>;
  disqualifiers: Record<string, boolean>;
  weakest_thing: string;
  fix_instructions: string[];
}

interface CriticResult {
  model: string;
  family: string;
  attempts: number;
  ok: boolean;
  error: string | null;
  judgement: Judgement | null;
  clears: boolean;
  failures: string[];
}

interface GateOutcome {
  decision: GateDecision;
  cause: GateCause | null;
  gate_version: string;
  doc_hash: string;
  sticky: boolean;          // may this verdict be stored as the answer for this hash
  retryable: boolean;       // may the same document be judged again
  findings: string[];       // why it was held, in the words a regeneration can act on
  critics: CriticResult[];
  preflight: string[];
  from_record: boolean;     // true when this is a stored verdict replayed, not a fresh judgement
  model_calls: number;
}

interface GateFmt { maxWords: number | null }

interface GateInput {
  narrative: string;
  applicantName: string;
  applicantLine: string;     // name · registration · website, exactly as the donor would see it
  grantText: string;         // the donor's own words: requirements, priorities, criteria
  fmt: GateFmt;
  evidence: Array<Record<string, unknown>>;
  generatorModel: string;    // so the gate can refuse to let the generator grade itself
  criticModels?: string[];   // overrides the default pair; family rules still apply
}

// `effort` is typed, not free text, and the type has no "max" member. The v2
// judge is required to run at reasoning_effort HIGH; a model whose reasoning is
// mandatory and defaults to max is otherwise a silent cost multiplier on every
// order. The remaining fields are additive and v1 leaves them undefined, so the
// v1 wire body is byte-identical to what it was.
interface CriticRequest {
  model: string;
  prompt: string;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  temperature?: number;              // v2: 0
  seed?: number;                     // v2: fixed, so the same document judged twice agrees
  responseFormat?: JsonSchemaFormat; // v2: structured outputs; the gate reads fields, never prose
  slot?: string;                     // v2: which credential slot pays for this call
}

interface GateDeps {
  chat(req: CriticRequest): Promise<string>;
  // Returns a stored TERMINAL verdict for this hash, or null. The database is the
  // real authority; this is how the module sees it, and how tests drive it.
  // v2 reads this too, and v2 branches on hold_class and score, neither of which
  // the v1 GateOutcome carries. Typed as the union so the v2 path cannot silently
  // `as unknown as` a v1 record into a v2 decision; runDeliveryGate validates the
  // gate_version on the record before it honours it.
  storedVerdict?(docHash: string): Promise<GateOutcome | JudgeOutcome | null>;
  timeoutMs?: number;
  attemptsPerCritic?: number;
  beat?(): void;             // heartbeat, so the reaper does not kill a slow judge
  // v2 only. `judge` replaces `chat` on the v2 path because the v2 path must
  // record what the call cost, from the provider's own accounting rather than
  // from a module-level token counter that concurrent stages share
  // (launch-readiness P2.9). When it is absent, v2 wraps `chat` and records the
  // spend as unmeasured — never as zero.
  judge?(req: CriticRequest): Promise<JudgeReply>;
  readHeadroom?(slot: string): Promise<KeyReading | null>;
  spend?: SpendLedger;
  spendCapUsd?: number;
  formatRetries?: number;
}

// ---------------------------------------------------------------- hashing
// Whitespace is normalised before hashing, and nothing else is. A regeneration
// that only reflows blank lines has not changed the document and must not earn a
// fresh roll of the dice; a regeneration that changes one word has, and does.
// Case, punctuation and word order are all content and are all preserved.
function normaliseDocument(md: string): string {
  return md
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The gate version is inside the hash on purpose. If the bar changes, every
// stored verdict was reached against a different standard, and replaying it
// would be the one way to smuggle a document past the new bar without judging it.
async function documentHash(md: string, gateVersion: string = GATE_VERSION): Promise<string> {
  const payload = `${gateVersion}\n${normaliseDocument(md)}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- model families
// OpenRouter ids are `family/model`. The provider prefix is the family, which is
// exactly the granularity the standard means by "a different model family"
// (reports/quality-standard.md §4: the generator never grades its own work).
function modelFamily(id: string): string {
  const s = String(id ?? "").trim().toLowerCase();
  const slash = s.indexOf("/");
  return slash > 0 ? s.slice(0, slash) : s;
}

// Two critics, two families, neither of them the generator's. §4: "Agreement
// between two different model families is materially stronger evidence than
// repeated sampling of a single model."
const DEFAULT_CRITICS = ["openai/gpt-5.6-sol", "x-ai/grok-4.6"];

function criticModelsFor(generatorModel: string, configured?: string[]): { models: string[]; error: string | null } {
  const wanted = (configured && configured.length ? configured : DEFAULT_CRITICS)
    .map((m) => String(m).trim()).filter(Boolean);
  if (wanted.length < 2) return { models: [], error: `the gate needs two critics, ${wanted.length} configured` };
  const gen = modelFamily(generatorModel);
  const seen = new Set<string>();
  for (const m of wanted) {
    const fam = modelFamily(m);
    if (!fam) return { models: [], error: `critic model "${m}" has no family prefix` };
    if (gen && fam === gen) {
      return { models: [], error: `critic ${m} is in the generator's own family (${gen}); the generator never grades its own work` };
    }
    if (seen.has(fam)) return { models: [], error: `two critics from the same family (${fam}) are one critic sampled twice` };
    seen.add(fam);
  }
  return { models: wanted, error: null };
}

// ---------------------------------------------------------------- preflight
// Copied deliberately from index.ts:563 rather than imported: index.ts is a Deno
// server module with npm dependencies and a Deno.serve() side effect, and the
// gate must be unit-testable without any of it. If that function changes, this
// one changes with it.
function gateWordCount(md: string): number {
  return md.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9؀-ۿ]/.test(w)).length;
}

const PLACEHOLDER_RE = /\[(TBD|TODO|INSERT|PLACEHOLDER|XXX?)\]|lorem ipsum|\{\{[^}]*\}\}/i;

interface PreflightResult {
  failures: string[];
  words: number;
  evidence_offered: number;
  evidence_used: number;
}

function preflight(input: GateInput): PreflightResult {
  const md = input.narrative ?? "";
  const words = gateWordCount(md);
  const failures: string[] = [];

  // A document that is not there cannot be fundable, and a blind critic asked to
  // score an empty string will hallucinate a document to score.
  if (!md.trim()) {
    failures.push("the narrative is empty");
  } else if (words < 250) {
    failures.push(`the narrative is ${words} words, which is not a proposal`);
  }

  // A donor word limit is a hard limit. This is arithmetic, not opinion, and it
  // is the last place it can be caught before the file is sent.
  if (input.fmt.maxWords && words > input.fmt.maxWords) {
    failures.push(`over the donor word limit: ${words} words against a limit of ${input.fmt.maxWords}`);
  }

  if (PLACEHOLDER_RE.test(md)) {
    failures.push("the narrative still contains placeholder text");
  }

  // Disqualifier D4, computed rather than asked. properNounAudit() reports what
  // the evidence ledger could supply and how much of it the narrative actually
  // used; below half, with at least three referents on offer, the narrative is
  // writing around its own evidence — the exact condition §3.4 disqualifies.
  // Only the SPECIFICITY finding is blocking here. The audit's other finding,
  // unsourced proper nouns, stays advisory for the reason recorded at
  // index.ts:1715: a legitimately named new project reads as unsourced.
  const pn = properNounAudit(md, input.evidence ?? [], input.applicantName ?? "");
  if (pn.ledger_offers >= 3 && pn.used * 2 < pn.ledger_offers) {
    failures.push(
      `D4 (${DISQUALIFIERS[3].text}): the evidence ledger offers ${pn.ledger_offers} named referents ` +
      `and the narrative uses ${pn.used}`,
    );
  }

  return { failures, words, evidence_offered: pn.ledger_offers, evidence_used: pn.used };
}

// ---------------------------------------------------------------- the critic prompt
// §4: adversarial. "The evaluator is instructed that most proposals it sees are
// mediocre, that a 4 or 5 must be earned, and that it must name the single
// weakest thing in the document. A critic that hands out 4s freely is useless."
function buildCriticPrompt(input: GateInput): string {
  const dims = DIMENSIONS.map((d) =>
    `  "${d.key}": 1-5   — dimension ${d.n}, ${d.name}`).join("\n");
  const dqs = CRITIC_DISQUALIFIERS.map((d) =>
    `  "${d.key}": true if ${d.text}`).join("\n");

  return (
    `You are an experienced grant assessor reading an application on behalf of the funder below. ` +
    `You have read hundreds. Most are mediocre. Assume this one is until it proves otherwise: a 4 or a 5 ` +
    `must be earned by something you can point at in the text, and handing out 4s freely would make you useless.\n\n` +

    `Score each dimension 1-5 as an INTEGER. Then answer each yes/no condition. ` +
    `Then name, in one sentence, the single weakest thing in this document.\n\n` +

    `Do NOT judge length, word counts or page counts — you cannot count and it is checked elsewhere. ` +
    `Do NOT reward polish for its own sake: a proposal that states plainly where the applicant is a partial fit ` +
    `for this funder scores higher than one that papers over the gap, even if the second reads better.\n\n` +

    `Reply with strict JSON only, no preamble, no markdown fence:\n` +
    `{\n  "scores": {\n${dims}\n  },\n  "disqualifiers": {\n${dqs}\n  },\n` +
    `  "weakest_thing": "one sentence",\n` +
    `  "fix_instructions": ["concrete, actionable, worst first, max 6"]\n}\n\n` +
    `Every key above must be present. Scores must be integers 1-5. Conditions must be true or false. ` +
    `Do not add a verdict, a recommendation, a total, an average, or any qualifier such as "with reservations" — ` +
    `they will be ignored.\n\n` +

    `FUNDER AND OPPORTUNITY:\n<untrusted_source>\n${String(input.grantText ?? "").slice(0, 24_000)}\n</untrusted_source>\n\n` +
    `APPLICANT: ${String(input.applicantLine ?? input.applicantName ?? "").slice(0, 400)}\n\n` +
    `APPLICATION:\n<untrusted_source>\n${String(input.narrative ?? "").slice(0, 40_000)}\n</untrusted_source>`
  );
}

// ---------------------------------------------------------------- parsing
// Strict by construction. A reply we cannot fully understand is not a lenient
// judgement, it is no judgement: assuming a missing disqualifier is `false` would
// be exactly the partial credit this gate exists to refuse.
type ParseResult = { ok: true; judgement: Judgement } | { ok: false; reason: string };

function parseJudgement(raw: string): ParseResult {
  const s = String(raw ?? "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return { ok: false, reason: "no JSON object in reply" };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, reason: `unparseable JSON: ${String(e).slice(0, 120)}` };
  }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "reply is not an object" };

  const rawScores = obj.scores;
  if (!rawScores || typeof rawScores !== "object" || Array.isArray(rawScores)) {
    return { ok: false, reason: "missing scores object" };
  }
  const scores: Record<string, number> = {};
  for (const d of DIMENSIONS) {
    const v = (rawScores as Record<string, unknown>)[d.key];
    // A string "4", a 4.5, a "4 (with reservations)" — all are a refusal to
    // answer the question that was asked, and none of them is a 4.
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      return { ok: false, reason: `dimension ${d.n} (${d.key}) is not an integer 1-5: ${JSON.stringify(v)}` };
    }
    scores[d.key] = v;
  }

  const rawDq = obj.disqualifiers;
  if (!rawDq || typeof rawDq !== "object" || Array.isArray(rawDq)) {
    return { ok: false, reason: "missing disqualifiers object" };
  }
  const disqualifiers: Record<string, boolean> = {};
  for (const d of CRITIC_DISQUALIFIERS) {
    const v = (rawDq as Record<string, unknown>)[d.key];
    if (typeof v !== "boolean") {
      return { ok: false, reason: `disqualifier ${d.code} (${d.key}) is not a boolean: ${JSON.stringify(v)}` };
    }
    disqualifiers[d.key] = v;
  }

  const weakest = typeof obj.weakest_thing === "string" ? obj.weakest_thing.trim() : "";
  if (!weakest) return { ok: false, reason: "weakest_thing is missing or empty" };

  const fixes = Array.isArray(obj.fix_instructions)
    ? (obj.fix_instructions as unknown[]).map((f) => String(f).slice(0, 400)).filter(Boolean).slice(0, 6)
    : null;
  if (fixes === null) return { ok: false, reason: "fix_instructions is not an array" };

  // Anything else in the reply — a "verdict", a "recommendation", an "overall",
  // a "pass_with_reservations" — is read and discarded here. The bar is applied
  // by applyBar() to the numbers, and a model cannot talk its way past it.
  return { ok: true, judgement: { scores, disqualifiers, weakest_thing: weakest.slice(0, 400), fix_instructions: fixes } };
}

// ---------------------------------------------------------------- the bar, applied
// No average, no total, no weighting arithmetic that could round anything up.
// Every condition is checked and every failure is named.
function applyBar(j: Judgement): { clears: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const d of DIMENSIONS) {
    const s = j.scores[d.key];
    const floor = d.weighted ? WEIGHTED_MIN : MIN_SCORE;
    if (typeof s !== "number" || s < floor) {
      failures.push(`dimension ${d.n} (${d.name}) scored ${s} against a floor of ${floor}`);
    }
  }
  for (const d of CRITIC_DISQUALIFIERS) {
    if (j.disqualifiers[d.key] === true) failures.push(`${d.code}: ${d.text}`);
  }
  return { clears: failures.length === 0, failures };
}

// ---------------------------------------------------------------- timeout
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: no reply after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- combination
// Ordering matters and is not negotiable:
//   1. any VALID judgement that fails the bar  -> hold on the merits, sticky.
//      A missing second opinion cannot rescue a document one critic has already
//      failed, and the document must change before it is judged again.
//   2. any critic without a valid judgement    -> hold, not sticky, retryable.
//   3. both valid, both clear                  -> pass.
// There is no path in which one clearing critic is enough.
function combineCritics(critics: CriticResult[]): { decision: GateDecision; cause: GateCause | null; sticky: boolean; retryable: boolean; findings: string[] } {
  const failing = critics.filter((c) => c.ok && !c.clears);
  if (failing.length) {
    const findings: string[] = [];
    for (const c of failing) {
      findings.push(...c.failures.map((f) => `[${c.model}] ${f}`));
      if (c.judgement?.weakest_thing) findings.push(`[${c.model}] weakest: ${c.judgement.weakest_thing}`);
      for (const f of c.judgement?.fix_instructions ?? []) findings.push(`[${c.model}] fix: ${f}`);
    }
    return { decision: "hold", cause: "bar_not_cleared", sticky: true, retryable: false, findings: [...new Set(findings)] };
  }
  const unavailable = critics.filter((c) => !c.ok);
  if (unavailable.length || critics.length < 2) {
    const findings = unavailable.length
      ? unavailable.map((c) => `no judgement from ${c.model} after ${c.attempts} attempts: ${c.error ?? "unknown"}`)
      : [`only ${critics.length} critic(s) ran; the gate requires two independent families`];
    return { decision: "hold", cause: "judgement_unavailable", sticky: false, retryable: true, findings };
  }
  return { decision: "pass", cause: null, sticky: true, retryable: false, findings: [] };
}

// ---------------------------------------------------------------- one critic
async function runCritic(model: string, prompt: string, deps: GateDeps): Promise<CriticResult> {
  const attemptsAllowed = Math.max(1, deps.attemptsPerCritic ?? 2);
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const res: CriticResult = {
    model, family: modelFamily(model), attempts: 0, ok: false, error: null,
    judgement: null, clears: false, failures: [],
  };
  for (let i = 0; i < attemptsAllowed; i++) {
    res.attempts++;
    deps.beat?.();
    try {
      const raw = await withTimeout(
        deps.chat({
          model,
          // A second attempt says nothing new about the document, only about the
          // format the first reply broke.
          prompt: i === 0 ? prompt : `${prompt}\n\nYour previous reply could not be read: ${res.error}. Reply with the JSON object only.`,
          maxTokens: 2000,
          effort: "medium",
        }),
        timeoutMs,
        `critic ${model}`,
      );
      const parsed = parseJudgement(raw);
      if (!parsed.ok) { res.error = parsed.reason; continue; }
      const bar = applyBar(parsed.judgement);
      res.ok = true;
      res.error = null;
      res.judgement = parsed.judgement;
      res.clears = bar.clears;
      res.failures = bar.failures;
      return res;
    } catch (e) {
      res.error = String(e).slice(0, 240);
    }
  }
  return res;
}

// ---------------------------------------------------------------- the gate
async function runGate(input: GateInput, deps: GateDeps): Promise<GateOutcome> {
  const doc_hash = await documentHash(input.narrative ?? "");
  const base = {
    gate_version: GATE_VERSION, doc_hash, critics: [] as CriticResult[],
    preflight: [] as string[], from_record: false, model_calls: 0,
  };

  // 1. A verdict already reached on this exact document is THE verdict. No model
  //    is called; there is nothing left to decide.
  const stored = deps.storedVerdict ? await deps.storedVerdict(doc_hash) : null;
  if (stored && stored.gate_version === GATE_VERSION) {
    return { ...(stored as GateOutcome), doc_hash, from_record: true, model_calls: 0 };
  }

  // 2. Deterministic layer. Cheap, exact, and it spends nothing when it fails.
  const pre = preflight(input);
  if (pre.failures.length) {
    return {
      ...base, decision: "hold", cause: "preflight_failed", sticky: true, retryable: false,
      findings: pre.failures, preflight: pre.failures,
    };
  }

  // 3. The generator never grades its own work, and no secret can arrange for it
  //    to. A misconfigured judge is an operational fault, so it is retryable —
  //    but it is not a pass, and the retry budget above it ends in a refund.
  const { models, error } = criticModelsFor(input.generatorModel, input.criticModels);
  if (error) {
    return {
      ...base, decision: "hold", cause: "judge_misconfigured", sticky: false, retryable: true,
      findings: [error],
    };
  }

  // 4. Two blind critics, independently.
  const prompt = buildCriticPrompt(input);
  const critics: CriticResult[] = [];
  for (const m of models) critics.push(await runCritic(m, prompt, deps));

  const combined = combineCritics(critics);
  return {
    ...base,
    decision: combined.decision,
    cause: combined.cause,
    sticky: combined.sticky,
    retryable: combined.retryable,
    findings: combined.findings,
    critics,
    preflight: [],
    model_calls: critics.reduce((n, c) => n + c.attempts, 0),
  };
}

// ---------------------------------------------------------------- what happens next
// A hold is not an ending. The bounded ladder is: regenerate, regenerate, refund.
const MAX_REGENERATIONS = 2;

type HoldAction = "regenerate" | "refund" | "retry_gate";

// `regenerationsDone` counts STICKY holds already recorded for this proposal —
// holds on the merits and preflight failures. A hold with no judgement behind it
// does not consume the budget, because the document was never judged.
function holdAction(outcome: GateOutcome, regenerationsDone: number, gateAttemptsUsed: number): HoldAction {
  if (outcome.decision === "pass") throw new Error("holdAction called on a pass");
  if (!outcome.sticky) {
    // No judgement was obtained. Try again on the next tick — but a judge that
    // never answers must not park a paid order forever, so the attempts are
    // bounded and the end of that road is a refund, never a delivery.
    return gateAttemptsUsed < 3 ? "retry_gate" : "refund";
  }
  return regenerationsDone < MAX_REGENERATIONS ? "regenerate" : "refund";
}

// The brief handed back to regeneration. It is the critics' own words: what
// failed, and what to do about it. It never says "score", never says which
// model said it, and never suggests softening anything.
function regenerationBrief(outcome: GateOutcome): string {
  const lines = outcome.findings.map((f) => f.replace(/^\[[^\]]+\]\s*/, "")).filter(Boolean);
  return (
    `An independent assessment of the finished proposal found it not yet fundable. ` +
    `Every point below must be fixed in the narrative itself.\n\n- ` +
    [...new Set(lines)].slice(0, 20).join("\n- ") +
    `\n\nDo not add facts about the organisation that the evidence ledger does not carry, ` +
    `do not change the reserved strategic approach, and do not solve any point by removing ` +
    `the section it appears in. Return the complete revised narrative only.`
  );
}

// The written explanation. Sent when the ladder ends in a refund. It says what
// happened, in plain words, and it does not attach the document — invariant 1
// does not have an exception for "but they paid for it".
function refundLetter(opts: { orgName: string; orderNo: string; amountUsd: number | null; supportEmail: string; refundConfirmed: boolean }): { subject: string; html: string } {
  const money = opts.amountUsd != null ? `$${Number(opts.amountUsd).toFixed(2)}` : "your payment";
  return {
    subject: `We are refunding your Ktebli order ${opts.orderNo}`,
    html:
      `<p>We wrote a proposal for ${opts.orgName} and then put it through the same assessment a funder's ` +
      `reviewer would apply. It did not clear that bar, and a second attempt did not clear it either.</p>` +
      `<p>We could send it to you anyway. We would rather not: a proposal we do not believe in costs you ` +
      `a submission round, and that is worth more than what you paid us.</p>` +
      (opts.refundConfirmed
        ? `<p><strong>We have refunded ${money} in full.</strong> It returns to the card you paid with, usually within five to ten business days.</p>`
        : `<p><strong>We are refunding ${money} in full.</strong> It is in hand now and you will get a confirmation from our payment provider when it settles.</p>`) +
      `<p>You do not need to do anything, and you are not being charged for a revision.</p>` +
      `<p>If you want to tell us about the opportunity in more detail and try again, reply to this message ` +
      `or write to ${opts.supportEmail} quoting order ${opts.orderNo}. There is no charge for that conversation.</p>` +
      `<p>— Ktebli</p>`,
  };
}

// =====================================================================
// ============================ DELIVERY GATE v2 =======================
// =====================================================================
//
// v1 above is a two-critic quorum on two expensive frontier families. It is
// retained because the offline confirmation runs and tests/delivery-gate/
// validate_judge.ts use it as the reference instrument, and because its stored
// verdicts were reached against its own bar. It is NOT the production gate.
//
// v2 is the production gate, to this specification:
//
//   Judge     z-ai/glm-5.3-flash
//   Fallback  google/gemini-3.7-flash   on cap, error or timeout
//
// Deliberately different providers. A cap or an outage on one provider must
// never hold every order in flight at once — which is exactly what happened to
// this project's own OpenRouter key during the referent-ladder run
// (reports/referent-ladder.md: every critic call refused, HTTP 403 "Key limit
// exceeded (total limit)", at $15.76 of a $30 balance). That is the failure
// this ladder exists to survive, and it is not hypothetical.
//
// WHAT CHANGED FROM v1, AND WHY EACH CHANGE IS NOT A LOOSENING
//
//   One judge, not two.        v1 required two independent families to BOTH
//                              clear. v2 asks one, and falls back to a second
//                              provider only when the first produced NO
//                              judgement. A fallback is never a second opinion:
//                              a verdict, once obtained, ends the ladder. There
//                              is no path on which a document that failed is
//                              asked again by a different model.
//   Structured outputs.        The reply is constrained by a JSON schema built
//                              from DIMENSIONS and CRITIC_DISQUALIFIERS, so it
//                              cannot drift from the bar. The gate reads typed
//                              fields. Nothing is regexed out of prose.
//   verdict enum + reasons.    The judge must commit to a verdict field. That
//                              field is RECORDED and is never DECISIVE: the bar
//                              is computed by applyBar() from the scores and the
//                              conditions, exactly as in v1. A disagreement
//                              between the asserted verdict and the computed one
//                              is an event, not an outcome.
//   temperature 0, fixed seed. The same document judged twice returns the same
//                              verdict, and the request body for a given
//                              document is byte-identical every time.
//   reasoning_effort high.     Explicit, never defaulted. Reasoning is mandatory
//                              on the primary judge and defaults to max there,
//                              which would be a silent cost multiplier on every
//                              single order.
//   A neutral instrument.      reports/quality-iteration-1.md §3, CORRECTED:
//                              "Iteration 1's critic prompt supplied the reject
//                              list, and the critics returned its vocabulary;
//                              E-1 withheld it, and they did not... the
//                              pre-delivery quality gate must use a neutral
//                              instrument, or it will hold documents for
//                              failures it invented." v1's D8 text hands the
//                              critic the tells it is asking about. v2 asks the
//                              same question without naming a single tell. The
//                              condition is unchanged; the priming is gone.
//
// TWO HOLD REASONS, AND THEY ARE NEVER THE SAME THING
//
//   QUALITY_HOLD   the document failed the bar. Refund path. Customer told.
//   INFRA_HOLD     the gate could not run — cap, outage, timeout, misconfigured
//                  judge, spend cap. Operator alerted. Order resumes when the
//                  service returns. NO refund. The customer is NEVER told their
//                  proposal failed, because it did not: nobody read it.
//
// They land in the append-only events table under distinct actions and the two
// sets of causes are provably disjoint (ALL_JUDGE_CAUSES, classifyHold, and the
// tests that assert the partition is total). Conflating them means you cannot
// tell a bad week of generation from an unpaid bill.
//
// v1's holdAction() conflates them: it refunds after three failed GATE attempts,
// i.e. it refunds a customer whose document was never judged. That is retained
// only because v1 is retained. loopAction() below is the v2 controller and it
// never refunds on an INFRA_HOLD.

// ---------------------------------------------------------------- judge config
const JUDGE_GATE_VERSION = "delivery-gate-v2";
const JUDGE_PRIMARY = "z-ai/glm-5.3-flash";
const JUDGE_FALLBACK = "google/gemini-3.7-flash";
// Fixed, and part of the gate version's meaning: change it and every stored
// verdict was reached under a different instrument.
const JUDGE_SEED = 20260827;
const JUDGE_TEMPERATURE = 0;
const JUDGE_EFFORT: "high" = "high";
const JUDGE_MAX_TOKENS = 3000;

interface KeySlot { slot: string; model: string; secret: string }
// Two slots, two providers, two credentials. The secrets are Vault names; the
// worker resolves them. If the operator points both at one key the failover is
// illusory and assessHeadroom() says so out loud.
const JUDGE_SLOTS: readonly KeySlot[] = [
  { slot: "judge_primary", model: JUDGE_PRIMARY, secret: "openrouter_api_key" },
  { slot: "judge_fallback", model: JUDGE_FALLBACK, secret: "openrouter_api_key_fallback" },
];

// ---------------------------------------------------------------- types
type HoldClass = "QUALITY_HOLD" | "INFRA_HOLD";

type JudgeCause = GateCause | "cap_exhausted" | "spend_cap_reached";

// Runtime list, so the disjointness of the two hold classes can be tested for
// TOTALITY rather than for the cases somebody remembered to write down.
const ALL_JUDGE_CAUSES: readonly JudgeCause[] = [
  "bar_not_cleared", "preflight_failed",
  "judgement_unavailable", "judge_misconfigured", "cap_exhausted", "spend_cap_reached",
];

const QUALITY_CAUSES: ReadonlySet<JudgeCause> = new Set<JudgeCause>([
  "bar_not_cleared", "preflight_failed",
]);
const INFRA_CAUSES: ReadonlySet<JudgeCause> = new Set<JudgeCause>([
  "judgement_unavailable", "judge_misconfigured", "cap_exhausted", "spend_cap_reached",
]);

function classifyHold(cause: JudgeCause): HoldClass {
  if (QUALITY_CAUSES.has(cause)) return "QUALITY_HOLD";
  if (INFRA_CAUSES.has(cause)) return "INFRA_HOLD";
  // An unclassified cause is not a pass and is not a guess. Refuse loudly.
  throw new Error(`unclassified gate cause "${cause}": every cause must be QUALITY or INFRA, and never both`);
}

// The append-only events table (db/schema.sql:78) takes an `action`. These are
// the actions, and the two hold actions are different strings on purpose.
const HOLD_EVENT: Readonly<Record<HoldClass, string>> = {
  QUALITY_HOLD: "gate.quality_hold",
  INFRA_HOLD: "gate.infra_hold",
};

// The policy attached to each class, in one place, so it cannot be re-derived
// differently at two call sites.
function tellCustomerOnHold(cls: HoldClass): boolean { return cls === "QUALITY_HOLD"; }
function refundOnHold(cls: HoldClass): boolean { return cls === "QUALITY_HOLD"; }
function alertOperatorOnHold(cls: HoldClass): boolean { return true; }

type ProviderErrorClass = "cap" | "timeout" | "transport" | "unreadable";

interface GateAlert { code: string; severity: "warn" | "critical"; message: string; detail: Record<string, unknown> }

interface JudgeReply { text: string; usd: number | null; generation_id?: string | null }

interface KeyReading { slot: string; key_fingerprint: string; limit_usd: number | null; usage_usd: number }

type HeadroomLevel = "ok" | "warn" | "critical" | "exhausted" | "unmetered" | "unknown";

interface HeadroomAssessment {
  slot: string;
  level: HeadroomLevel;
  fraction_used: number | null;
  remaining_usd: number | null;
  usable: boolean;
}

interface SpendLedger {
  calls: number;
  usd: number;
  unmeasured_calls: number;
  by_model: Record<string, { calls: number; usd: number }>;
}

interface JudgeAttempt {
  slot: string;
  model: string;
  family: string;
  calls: number;
  ok: boolean;
  error: string | null;
  error_class: ProviderErrorClass | null;
  usd: number | null;
  judgement: Judgement | null;
  asserted_verdict: string | null;   // recorded, never decisive
  reasons: string[];
  clears: boolean;
  failures: string[];
}

interface JudgeOutcome {
  decision: GateDecision;
  cause: JudgeCause | null;
  hold_class: HoldClass | null;
  gate_version: string;
  doc_hash: string;
  sticky: boolean;
  retryable: boolean;
  findings: string[];
  score: number | null;              // divergence detection only; never a pass criterion
  judge: JudgeAttempt[];
  used_fallback: boolean;
  preflight: string[];
  from_record: boolean;
  model_calls: number;
  spend: SpendLedger;
  alerts: GateAlert[];
  headroom: HeadroomAssessment[];
}

// ---------------------------------------------------------------- the judge ladder
// Same family rule as v1: the generator never grades its own work, and no
// configuration can arrange for it to. Applied per rung. A rung in the
// generator's family is DROPPED, not permitted — and if that leaves the ladder
// empty, the gate is misconfigured and holds. If it leaves one rung, the gate
// still runs (nobody waits) and the loss of the failover is an alert, because a
// one-rung ladder is one provider away from holding every order at once.
interface Ladder { rungs: KeySlot[]; error: string | null; alerts: GateAlert[] }

function judgeLadder(generatorModel: string, override?: string[]): Ladder {
  const alerts: GateAlert[] = [];
  let want: KeySlot[];
  if (override && override.length) {
    want = override.map((m, i) => ({
      slot: i === 0 ? "judge_primary" : `judge_fallback${i > 1 ? i : ""}`,
      model: String(m).trim(),
      secret: JUDGE_SLOTS[Math.min(i, JUDGE_SLOTS.length - 1)].secret,
    })).filter((r) => r.model);
  } else {
    want = JUDGE_SLOTS.map((s) => ({ ...s }));
  }
  if (!want.length) return { rungs: [], error: "no judge configured", alerts };

  const gen = modelFamily(generatorModel);
  const rungs: KeySlot[] = [];
  const seenFamily = new Set<string>();
  for (const r of want) {
    const fam = modelFamily(r.model);
    if (!fam) {
      alerts.push({
        code: "gate.judge_rung_dropped", severity: "critical",
        message: `judge "${r.model}" has no family prefix`, detail: { slot: r.slot, model: r.model },
      });
      continue;
    }
    if (gen && fam === gen) {
      alerts.push({
        code: "gate.judge_rung_dropped", severity: "critical",
        message: `judge ${r.model} is in the generator's own family (${gen}); the generator never grades its own work`,
        detail: { slot: r.slot, model: r.model, generator_family: gen },
      });
      continue;
    }
    if (seenFamily.has(fam)) {
      alerts.push({
        code: "gate.judge_rung_dropped", severity: "critical",
        message: `judge ${r.model} repeats family ${fam}; a fallback on the same provider is not a fallback`,
        detail: { slot: r.slot, model: r.model, family: fam },
      });
      continue;
    }
    seenFamily.add(fam);
    rungs.push(r);
  }
  if (!rungs.length) {
    return { rungs: [], error: alerts[0]?.message ?? "no usable judge remains after the family rule", alerts };
  }
  if (rungs.length < 2) {
    alerts.push({
      code: "gate.judge_ladder_degraded", severity: "critical",
      message: `only ${rungs.length} judge rung available; a cap or outage on ${rungs[0].model} will hold every order at once`,
      detail: { rungs: rungs.map((r) => r.model) },
    });
  }
  return { rungs, error: null, alerts };
}

// ---------------------------------------------------------------- cap headroom
// Alert WELL BEFORE exhaustion. Silent exhaustion holds every order in flight
// simultaneously; that is the whole reason this exists.
const HEADROOM_WARN = 0.75;
const HEADROOM_CRITICAL = 0.90;

function assessHeadroom(readings: Array<KeyReading | null>, slots: readonly string[]): { headroom: HeadroomAssessment[]; alerts: GateAlert[] } {
  const headroom: HeadroomAssessment[] = [];
  const alerts: GateAlert[] = [];
  const fingerprints = new Map<string, string[]>();

  readings.forEach((r, i) => {
    const slot = r?.slot ?? slots[i] ?? `slot${i}`;
    if (!r) {
      // No reading is not a licence to spend blind, but it is also not proof of
      // exhaustion: the call itself will tell us, and a cap error fails over.
      headroom.push({ slot, level: "unknown", fraction_used: null, remaining_usd: null, usable: true });
      alerts.push({
        code: "gate.cap_headroom_unreadable", severity: "warn",
        message: `headroom for ${slot} could not be read; exhaustion will only be visible when a call fails`,
        detail: { slot },
      });
      return;
    }
    const fp = r.key_fingerprint || "unknown";
    fingerprints.set(fp, [...(fingerprints.get(fp) ?? []), slot]);

    if (r.limit_usd == null) {
      headroom.push({ slot, level: "unmetered", fraction_used: null, remaining_usd: null, usable: true });
      return;
    }
    const limit = Math.max(0, r.limit_usd);
    const used = Math.max(0, r.usage_usd);
    const frac = limit === 0 ? 1 : used / limit;
    const remaining = limit - used;
    let level: HeadroomLevel = "ok";
    if (frac >= 1) level = "exhausted";
    else if (frac >= HEADROOM_CRITICAL) level = "critical";
    else if (frac >= HEADROOM_WARN) level = "warn";
    headroom.push({ slot, level, fraction_used: frac, remaining_usd: remaining, usable: level !== "exhausted" });

    if (level === "exhausted") {
      alerts.push({
        code: "gate.cap_exhausted", severity: "critical",
        message: `${slot} is exhausted: $${used.toFixed(2)} of $${limit.toFixed(2)}`,
        detail: { slot, usage_usd: used, limit_usd: limit },
      });
    } else if (level === "critical") {
      alerts.push({
        code: "gate.cap_headroom_critical", severity: "critical",
        message: `${slot} is at ${(frac * 100).toFixed(1)}% of its cap, $${remaining.toFixed(2)} left`,
        detail: { slot, fraction_used: frac, remaining_usd: remaining },
      });
    } else if (level === "warn") {
      alerts.push({
        code: "gate.cap_headroom_warn", severity: "warn",
        message: `${slot} is at ${(frac * 100).toFixed(1)}% of its cap, $${remaining.toFixed(2)} left`,
        detail: { slot, fraction_used: frac, remaining_usd: remaining },
      });
    }
  });

  // Two rungs on two providers paid for by ONE key is not a failover. It is one
  // point of failure wearing two names, and it fails exactly the way the ladder
  // run failed.
  for (const [fp, sl] of fingerprints) {
    if (sl.length > 1) {
      alerts.push({
        code: "gate.judge_keys_shared", severity: "critical",
        message: `slots ${sl.join(", ")} share one credential; a cap on it takes out both rungs at once`,
        detail: { slots: sl, key_fingerprint: fp },
      });
    }
  }
  return { headroom, alerts };
}

// A stable, non-reversible label for a credential, so two slots can be compared
// without either key being written to the events table.
async function keyFingerprint(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ktebli-key\n${secret ?? ""}`));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- provider errors
// The distinction that matters: a cap is a fact about OUR account and fails over
// to the other provider; a timeout or a transport error is a fact about that
// provider and does the same. Neither is ever a fact about the document.
function classifyProviderError(e: unknown): ProviderErrorClass {
  const s = String(e ?? "").toLowerCase();
  if (/key limit exceeded|limit exceeded|insufficient credit|quota exceeded|out of credit|payment required|\b402\b/.test(s)) return "cap";
  if (/no reply after \d+ms|timed? ?out|timeout|aborted/.test(s)) return "timeout";
  return "transport";
}

// ---------------------------------------------------------------- spend
// Recorded from the provider's own accounting. The launch-readiness report
// (P2.9) records that the worker's per-stage token counter is a module-level
// global shared by concurrent stages, so its per-stage numbers are
// cross-contaminated; this ledger is per-order and never reads that global.
//
// MISSING: the dollar cost of a real gate run has NOT been measured. Every model
// call in this environment is refused with HTTP 403 "Key limit exceeded", so no
// figure exists. The cap below is a budget, not a measurement, and it is marked
// provisional wherever it appears.
const DEFAULT_ORDER_SPEND_CAP_USD = 6.00;

function newSpend(): SpendLedger { return { calls: 0, usd: 0, unmeasured_calls: 0, by_model: {} }; }

function addSpend(s: SpendLedger, model: string, usd: number | null): SpendLedger {
  s.calls++;
  const row = s.by_model[model] ?? { calls: 0, usd: 0 };
  row.calls++;
  if (usd == null || !Number.isFinite(usd)) {
    // Never recorded as zero. An unmeasured call is a hole in the cap, and the
    // cap must know it has a hole.
    s.unmeasured_calls++;
  } else {
    s.usd += usd;
    row.usd += usd;
  }
  s.by_model[model] = row;
  return s;
}

// ---------------------------------------------------------------- the score
// A single scalar, used for ONE purpose: detecting that a regeneration made the
// document worse. It is never a pass criterion — applyBar() is, and it reads
// every dimension and every condition separately, so nothing here can round a
// failing dimension up.
const SCORE_DISQUALIFIER_PENALTY = 10;

function gateScore(j: Judgement): number {
  let s = 0;
  for (const d of DIMENSIONS) s += Number(j.scores[d.key] ?? 0);
  let dq = 0;
  for (const d of CRITIC_DISQUALIFIERS) if (j.disqualifiers[d.key] === true) dq++;
  return s - SCORE_DISQUALIFIER_PENALTY * dq;
}

// ---------------------------------------------------------------- material change
// "Regenerating something near-identical and hoping for a better verdict is the
// loop's favourite failure." Word-5-gram containment of the new document in the
// old one: how much of what the regeneration produced was already there.
//
// PROVISIONAL. The 0.20 threshold has been measured against the only corpus
// available offline — the eight iteration-1 documents in the qloop scratch —
// which bounds it but does not calibrate it:
//
//   two genuinely different documents, same case      0.976 - 1.000
//   a document against itself                         0.000
//   one word in twenty changed                        0.259
//   one word in sixty changed                         0.086
//
// So 0.20 sits between "one word in sixty" and "one word in twenty", and well
// below any real rewrite. What is MISSING is the distribution that actually
// matters: what a REGENERATION of the same document under a fix brief scores.
// That needs model calls, and every model call in this environment is refused.
// Until it is measured, this number is a floor chosen to be obviously below a
// rewrite and obviously above a polish, not a calibrated one.
const MIN_MATERIAL_CHANGE = 0.20;
const SHINGLE_N = 5;
// PROVISIONAL, on the same footing as MIN_MATERIAL_CHANGE and for the same reason.
// Word-5-grams cannot see the strongest form of the non-rewrite: insert one filler
// word every four words and every 5-gram breaks while every content word survives in
// order, which scores 0.990 on the shingle measure. Retention is insertion-robust.
// Measured: a genuine paraphrase retains 0.514 of the previous document's words; a
// padded, interleaved or reordered copy retains 1.000.
const MAX_CONTENT_RETENTION = 0.85;

function shingleCounts(md: string, n: number = SHINGLE_N): Map<string, number> {
  const words = normaliseDocument(md).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const m = new Map<string, number>();
  if (words.length < n) {
    if (words.length) m.set(words.join(" "), 1);
    return m;
  }
  for (let i = 0; i + n <= words.length; i++) {
    const k = words.slice(i, i + n).join(" ");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

interface ChangeReport { changed_fraction: number; retention: number; identical: boolean; material: boolean }

// The multiset of words in `md`, which is what survives an insertion attack.
function wordCounts(md: string): Map<string, number> {
  const w = normaliseDocument(md).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const m = new Map<string, number>();
  for (const x of w) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function materialChange(previous: string, next: string, threshold: number = MIN_MATERIAL_CHANGE): ChangeReport {
  const identical = normaliseDocument(previous) === normaliseDocument(next);
  const a = shingleCounts(previous);
  const b = shingleCounts(next);
  let total = 0, shared = 0, prevTotal = 0;
  for (const [k, v] of b) { total += v; shared += Math.min(v, a.get(k) ?? 0); }
  for (const v of a.values()) prevTotal += v;
  // Change has to be visible from BOTH ends. Containment of NEXT in PREVIOUS alone
  // scores an APPEND as a rewrite: the held document survives untouched and the
  // padding supplies the novelty. Containment of PREVIOUS in NEXT alone scores a
  // TRUNCATION as a rewrite. A regeneration is material only when material text
  // left the old document AND material text arrived in the new one.
  const newInNext = total === 0 ? (identical ? 0 : 1) : 1 - shared / total;
  const goneFromPrev = prevTotal === 0 ? (identical ? 0 : 1) : 1 - shared / prevTotal;
  const changed = Math.min(newInNext, goneFromPrev);
  const pw = wordCounts(previous), nw = wordCounts(next);
  let prevWords = 0, keptWords = 0;
  for (const [k, v] of pw) { prevWords += v; keptWords += Math.min(v, nw.get(k) ?? 0); }
  const retention = prevWords === 0 ? 0 : keptWords / prevWords;
  return {
    changed_fraction: changed, retention, identical,
    material: !identical && changed >= threshold && retention <= MAX_CONTENT_RETENTION,
  };
}

// ---------------------------------------------------------------- structured output
interface JsonSchemaFormat {
  type: "json_schema";
  json_schema: { name: string; strict: true; schema: Record<string, unknown> };
}

const VERDICT_ENUM = ["clears_bar", "fails_bar"] as const;
type AssertedVerdict = typeof VERDICT_ENUM[number];

// Built from DIMENSIONS and CRITIC_DISQUALIFIERS rather than written out, so the
// schema cannot drift from the bar. If a dimension is added, the schema gains it
// on the same commit or nothing compiles.
function judgeSchema(): JsonSchemaFormat {
  const scoreProps: Record<string, unknown> = {};
  for (const d of DIMENSIONS) {
    scoreProps[d.key] = { type: "integer", minimum: 1, maximum: 5, description: `dimension ${d.n}, ${d.name}` };
  }
  const dqProps: Record<string, unknown> = {};
  for (const d of CRITIC_DISQUALIFIERS) {
    dqProps[d.key] = { type: "boolean", description: `true if ${d.text}` };
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "ktebli_delivery_gate_verdict",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["scores", "disqualifiers", "verdict", "reasons", "weakest_thing", "fix_instructions"],
        properties: {
          scores: { type: "object", additionalProperties: false, required: DIMENSIONS.map((d) => d.key), properties: scoreProps },
          disqualifiers: { type: "object", additionalProperties: false, required: CRITIC_DISQUALIFIERS.map((d) => d.key), properties: dqProps },
          verdict: { type: "string", enum: [...VERDICT_ENUM] },
          reasons: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          weakest_thing: { type: "string" },
          fix_instructions: { type: "array", maxItems: 6, items: { type: "string" } },
        },
      },
    },
  };
}

// ---------------------------------------------------------------- the judge's view
// The judge sees the finished document and nothing else. This type is the ONLY
// thing the prompt builder can read, and judgeView() is the only way to build
// one: there is no field here for the pipeline, the generator, the ledger, the
// attempt number, the previous verdict, or the findings that produced this
// draft. Blindness is enforced by the type, not by remembering.
interface JudgeView { narrative: string; applicantLine: string; grantText: string }

function judgeView(input: GateInput): JudgeView {
  return {
    narrative: String(input.narrative ?? ""),
    applicantLine: String(input.applicantLine ?? input.applicantName ?? ""),
    grantText: String(input.grantText ?? ""),
  };
}

// The neutral instrument. Compare with buildCriticPrompt() above, which lists
// the tells for D8 ("uniform paragraph rhythm, tri-colon lists, abstract
// nouns...") and, per the correction in reports/quality-iteration-1.md §3, got
// those exact words back from every critic that was given them. Here the same
// condition is asked without naming a single tell, and the judge has to find its
// own reason or answer false.
const NEUTRAL_D8 = "you would not believe this was written by someone who knows this organisation and this place first-hand";

function buildJudgePrompt(view: JudgeView): string {
  const dims = DIMENSIONS.map((d) => `  ${d.key}  — dimension ${d.n}, ${d.name}`).join("\n");
  const dqs = CRITIC_DISQUALIFIERS.map((d) =>
    `  ${d.key}  — true if ${d.key === "reads_ai_generated" ? NEUTRAL_D8 : d.text}`).join("\n");

  return (
    `You are an experienced grant assessor reading an application on behalf of the funder below. ` +
    `You have read hundreds. Most are mediocre. Assume this one is until it proves otherwise: a 4 or a 5 ` +
    `must be earned by something you can point at in the text.\n\n` +

    `Score each dimension as an integer 1-5:\n${dims}\n\n` +
    `Then answer each condition true or false. A true means the condition is PRESENT in this document:\n${dqs}\n\n` +

    `Then set "verdict": "clears_bar" if you believe this application would survive assessment as submitted, ` +
    `"fails_bar" otherwise. Then give your reasons, then the single weakest thing in one sentence, ` +
    `then concrete fixes, worst first.\n\n` +

    `Do NOT judge length, word counts or page counts — you cannot count and it is checked elsewhere. ` +
    `Do NOT reward polish for its own sake: an application that states plainly where the applicant is a partial fit ` +
    `for this funder scores higher than one that papers over the gap, even if the second reads better.\n\n` +

    `FUNDER AND OPPORTUNITY:\n<untrusted_source>\n${view.grantText.slice(0, 24_000)}\n</untrusted_source>\n\n` +
    `APPLICANT: ${view.applicantLine.slice(0, 400)}\n\n` +
    `APPLICATION:\n<untrusted_source>\n${view.narrative.slice(0, 40_000)}\n</untrusted_source>`
  );
}

// The request. Pure function of the document — same document, same bytes, every
// time — which is half of what makes the gate reproducible. The other half is
// temperature 0 and the fixed seed, both set here and nowhere else.
function buildJudgeRequest(view: JudgeView, rung: KeySlot): CriticRequest {
  return {
    model: rung.model,
    prompt: buildJudgePrompt(view),
    maxTokens: JUDGE_MAX_TOKENS,
    effort: JUDGE_EFFORT,
    temperature: JUDGE_TEMPERATURE,
    seed: JUDGE_SEED,
    responseFormat: judgeSchema(),
    slot: rung.slot,
  };
}

// ---------------------------------------------------------------- parsing v2
type JudgeParse =
  | { ok: true; judgement: Judgement; verdict: AssertedVerdict; reasons: string[] }
  | { ok: false; reason: string };

function parseJudgeReply(raw: string): JudgeParse {
  const base = parseJudgement(raw);
  if (!base.ok) return { ok: false, reason: base.reason };

  const s = String(raw ?? "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>; }
  catch (e) { return { ok: false, reason: `unparseable JSON: ${String(e).slice(0, 120)}` }; }

  const v = obj.verdict;
  if (typeof v !== "string" || !(VERDICT_ENUM as readonly string[]).includes(v)) {
    return { ok: false, reason: `verdict is not one of ${VERDICT_ENUM.join("|")}: ${JSON.stringify(v)}` };
  }
  if (!Array.isArray(obj.reasons)) return { ok: false, reason: "reasons is not an array" };
  const reasons = (obj.reasons as unknown[]).map((r) => String(r).slice(0, 400)).filter(Boolean).slice(0, 6);
  if (!reasons.length) return { ok: false, reason: "reasons is empty" };

  return { ok: true, judgement: base.judgement, verdict: v as AssertedVerdict, reasons };
}

// ---------------------------------------------------------------- one rung
// One rung, one judgement, and then its turn is over. It is handed a document
// and it emits a verdict; it is never handed the generator's reply to its
// verdict, never told an attempt number, and never asked to reconsider. The only
// second message it can receive is a format complaint that quotes nothing but
// the parse error.
async function runJudgeRung(view: JudgeView, rung: KeySlot, deps: GateDeps, spend: SpendLedger): Promise<JudgeAttempt> {
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const formatRetries = Math.max(0, deps.formatRetries ?? 1);
  const call: (req: CriticRequest) => Promise<JudgeReply> = deps.judge
    ? deps.judge.bind(deps)
    : async (req: CriticRequest) => ({ text: await deps.chat(req), usd: null });

  const at: JudgeAttempt = {
    slot: rung.slot, model: rung.model, family: modelFamily(rung.model),
    calls: 0, ok: false, error: null, error_class: null, usd: null,
    judgement: null, asserted_verdict: null, reasons: [], clears: false, failures: [],
  };
  const req = buildJudgeRequest(view, rung);

  for (let i = 0; i <= formatRetries; i++) {
    at.calls++;
    deps.beat?.();
    try {
      const reply = await withTimeout(
        call(i === 0
          ? req
          : { ...req, prompt: `${req.prompt}\n\nYour previous reply did not match the required schema: ${at.error}. Reply with the JSON object only.` }),
        timeoutMs,
        `judge ${rung.model}`,
      );
      addSpend(spend, rung.model, reply.usd);
      if (reply.usd != null && Number.isFinite(reply.usd)) at.usd = (at.usd ?? 0) + reply.usd;
      const parsed = parseJudgeReply(reply.text);
      if (!parsed.ok) { at.error = parsed.reason; at.error_class = "unreadable"; continue; }
      const bar = applyBar(parsed.judgement);
      at.ok = true;
      at.error = null;
      at.error_class = null;
      at.judgement = parsed.judgement;
      at.asserted_verdict = parsed.verdict;
      at.reasons = parsed.reasons;
      at.clears = bar.clears;
      at.failures = bar.failures;
      return at;
    } catch (e) {
      at.error = String(e).slice(0, 240);
      at.error_class = classifyProviderError(e);
      // A cap or an outage will not be cured by asking the same provider again
      // in the same second. Hand the ladder over.
      if (at.error_class !== "unreadable") return at;
    }
  }
  return at;
}

// ---------------------------------------------------------------- the v2 gate
async function runDeliveryGate(input: GateInput, deps: GateDeps): Promise<JudgeOutcome> {
  const spend = deps.spend ?? newSpend();
  const spendCap = deps.spendCapUsd ?? DEFAULT_ORDER_SPEND_CAP_USD;
  const doc_hash = await documentHash(input.narrative ?? "", JUDGE_GATE_VERSION);
  const base = {
    gate_version: JUDGE_GATE_VERSION, doc_hash, judge: [] as JudgeAttempt[],
    used_fallback: false, preflight: [] as string[], from_record: false,
    model_calls: 0, spend, alerts: [] as GateAlert[], headroom: [] as HeadroomAssessment[],
    score: null as number | null,
  };
  const held = (cause: JudgeCause, findings: string[], over: Partial<JudgeOutcome> = {}): JudgeOutcome => {
    const cls = classifyHold(cause);
    return {
      ...base,
      decision: "hold", cause, hold_class: cls,
      sticky: cls === "QUALITY_HOLD", retryable: cls === "INFRA_HOLD",
      findings, ...over,
    };
  };

  // 1. A verdict already reached on this exact document, under this exact gate
  //    version, is THE verdict. No model is called; there is nothing to decide.
  //    The version is in the hash, but a hash is the store's key and the store is
  //    not the authority on what it hashed. Read the version off the record and
  //    refuse anything reached under a different bar, and refuse a hold that
  //    arrives without the class the loop is going to branch on. A record that
  //    cannot be validated is not a verdict, so it is INFRA and the document is
  //    untouched by it — never a pass, and never a judgement on the merits.
  const stored = deps.storedVerdict ? await deps.storedVerdict(doc_hash) : null;
  if (stored) {
    const s = stored as unknown as JudgeOutcome;
    if (s.gate_version !== JUDGE_GATE_VERSION) {
      return held("judgement_unavailable",
        [`a stored verdict for this document was reached under "${s.gate_version}", not ${JUDGE_GATE_VERSION}; it is not a verdict against this bar`],
        { alerts: [{ code: "gate.stored_verdict_stale", severity: "critical",
            message: `stored verdict rejected: gate_version "${s.gate_version}" != ${JUDGE_GATE_VERSION}`,
            detail: { doc_hash, stored_gate_version: s.gate_version } }] });
    }
    if (s.decision === "hold" && !s.hold_class) {
      return held("judgement_unavailable",
        ["a stored hold arrived with no hold class; it cannot be told apart from an outage and is discarded"],
        { alerts: [{ code: "gate.stored_verdict_malformed", severity: "critical",
            message: "stored hold has no hold_class", detail: { doc_hash, cause: s.cause } }] });
    }
    return { ...s, doc_hash, from_record: true, model_calls: 0, spend };
  }

  // 2. Deterministic layer. It reads the ledger, which the judge never does,
  //    because it computes facts rather than opinions. It spends nothing.
  const pre = preflight(input);
  if (pre.failures.length) {
    return held("preflight_failed", pre.failures, { preflight: pre.failures });
  }

  // 3. The ladder. The generator never grades its own work.
  const ladder = judgeLadder(input.generatorModel, input.criticModels);
  const alerts: GateAlert[] = [...ladder.alerts];
  if (ladder.error) {
    return held("judge_misconfigured", [ladder.error], { alerts });
  }

  // 4. Cap headroom, on every rung, before a cent is spent. Alerts fire well
  //    before exhaustion; an exhausted rung is skipped rather than attempted.
  let usableRungs = ladder.rungs;
  let headroom: HeadroomAssessment[] = [];
  if (deps.readHeadroom) {
    const readings = await Promise.all(ladder.rungs.map((r) => deps.readHeadroom!(r.slot).catch(() => null)));
    const h = assessHeadroom(readings, ladder.rungs.map((r) => r.slot));
    headroom = h.headroom;
    alerts.push(...h.alerts);
    const blocked = new Set(h.headroom.filter((x) => !x.usable).map((x) => x.slot));
    usableRungs = ladder.rungs.filter((r) => !blocked.has(r.slot));
    if (!usableRungs.length) {
      return held("cap_exhausted",
        ladder.rungs.map((r) => `${r.slot} (${r.model}) is at or over its spend cap`),
        { alerts, headroom });
    }
  }

  // 5. The per-order dollar cap. Checked BEFORE the call, because a cap you
  //    only notice after paying is not a cap.
  if (spend.usd >= spendCap) {
    alerts.push({
      code: "gate.spend_cap_reached", severity: "critical",
      message: `order spend $${spend.usd.toFixed(2)} has reached its cap of $${spendCap.toFixed(2)}`,
      detail: { spend_usd: spend.usd, cap_usd: spendCap, by_model: spend.by_model },
    });
    return held("spend_cap_reached",
      [`the gate stopped: this order has spent $${spend.usd.toFixed(2)} against a cap of $${spendCap.toFixed(2)}`],
      { alerts, headroom });
  }

  // 6. Down the ladder. A verdict ENDS it: a fallback is a failover, never a
  //    second opinion, and a document that failed is never asked again by a
  //    different model.
  const view = judgeView(input);
  const attempts: JudgeAttempt[] = [];
  let verdictAttempt: JudgeAttempt | null = null;
  for (const rung of usableRungs) {
    const at = await runJudgeRung(view, rung, deps, spend);
    attempts.push(at);
    if (at.ok) { verdictAttempt = at; break; }
    if (at.error_class === "cap") {
      alerts.push({
        code: "gate.cap_exhausted", severity: "critical",
        message: `${rung.slot} (${rung.model}) refused the call: ${at.error}`,
        detail: { slot: rung.slot, model: rung.model, error: at.error },
      });
    }
    if (spend.usd >= spendCap) break;
  }
  const model_calls = attempts.reduce((n, a) => n + a.calls, 0);
  const used_fallback = attempts.length > 1 && verdictAttempt !== null && verdictAttempt.slot !== usableRungs[0].slot;
  if (used_fallback) {
    alerts.push({
      code: "gate.fallback_used", severity: "warn",
      message: `the primary judge produced no judgement; ${verdictAttempt!.model} answered instead`,
      detail: { primary: usableRungs[0].model, fallback: verdictAttempt!.model, primary_error: attempts[0].error },
    });
  }
  const common = { judge: attempts, model_calls, alerts, headroom, used_fallback };

  // 7. No rung produced a judgement. That is the ABSENCE of a judgement, not a
  //    judgement, so it is INFRA and the document is untouched by it.
  if (!verdictAttempt) {
    const everyFailureWasACap = attempts.length > 0 && attempts.every((a) => a.error_class === "cap");
    const cause: JudgeCause = everyFailureWasACap ? "cap_exhausted" : "judgement_unavailable";
    return held(cause,
      attempts.map((a) => `no judgement from ${a.model} after ${a.calls} call(s): ${a.error ?? "unknown"}`),
      common);
  }

  // 8. The verdict the judge ASSERTED is recorded and is never decisive; the bar
  //    is what applyBar() computed from the numbers. Where they disagree, that
  //    is an observation about the judge, and it belongs in events.
  const computed: AssertedVerdict = verdictAttempt.clears ? "clears_bar" : "fails_bar";
  if (verdictAttempt.asserted_verdict !== computed) {
    alerts.push({
      code: "gate.verdict_disagreement", severity: "warn",
      message: `${verdictAttempt.model} asserted "${verdictAttempt.asserted_verdict}" while the bar computes "${computed}"; the computed bar stands`,
      detail: { model: verdictAttempt.model, asserted: verdictAttempt.asserted_verdict, computed, failures: verdictAttempt.failures },
    });
  }

  const score = verdictAttempt.judgement ? gateScore(verdictAttempt.judgement) : null;

  if (!verdictAttempt.clears) {
    const findings: string[] = [
      ...verdictAttempt.failures.map((f) => `[${verdictAttempt!.model}] ${f}`),
      ...(verdictAttempt.judgement?.weakest_thing ? [`[${verdictAttempt.model}] weakest: ${verdictAttempt.judgement.weakest_thing}`] : []),
      ...verdictAttempt.reasons.map((r) => `[${verdictAttempt!.model}] reason: ${r}`),
      ...(verdictAttempt.judgement?.fix_instructions ?? []).map((f) => `[${verdictAttempt!.model}] fix: ${f}`),
    ];
    return { ...held("bar_not_cleared", [...new Set(findings)], common), score };
  }

  return {
    ...base, ...common,
    decision: "pass", cause: null, hold_class: null,
    sticky: true, retryable: false, findings: [], score,
  };
}

// ---------------------------------------------------------------- the loop
// Hard limits, no exceptions, and each one is a separate reason with its own
// event code so a post-mortem can tell them apart.
interface LoopLimits {
  maxRegenerations: number;   // two, and the third failure refunds
  maxGateAttempts: number;    // consecutive INFRA holds before the order parks
  spendCapUsd: number;
  minMaterialChange: number;
  // A call the provider did not price is a call the cap cannot see. A few are a
  // provider quirk; a run of them means the cap is not being enforced, and an
  // unenforceable cap must stop the order rather than be assumed satisfied.
  maxUnmeasuredCalls: number;
}
const LOOP_LIMITS: LoopLimits = {
  maxRegenerations: MAX_REGENERATIONS,          // 2
  maxGateAttempts: 3,
  spendCapUsd: DEFAULT_ORDER_SPEND_CAP_USD,     // provisional; see MISSING note above
  minMaterialChange: MIN_MATERIAL_CHANGE,       // provisional; uncalibrated
  maxUnmeasuredCalls: 4,
};

type LoopAction = "deliver" | "regenerate" | "retry_gate" | "refund" | "hold_alert";

interface LoopAttempt {
  doc_hash: string;
  decision: GateDecision;
  cause: JudgeCause | null;
  hold_class: HoldClass | null;
  score: number | null;
  changed_fraction: number | null;   // against the previous attempt; null on the first
}

interface LoopDecision {
  action: LoopAction;
  reason: string;
  event: string;
  hold_class: HoldClass | null;
  tell_customer: boolean;
  refund: boolean;
}

function loopAction(attempts: LoopAttempt[], spend: SpendLedger, limits: LoopLimits = LOOP_LIMITS): LoopDecision {
  if (!attempts.length) throw new Error("loopAction called with no attempts");
  const last = attempts[attempts.length - 1];

  if (last.decision === "pass") {
    return { action: "deliver", reason: "the document cleared the bar", event: "gate.pass", hold_class: null, tell_customer: true, refund: false };
  }
  if (!last.hold_class) throw new Error("a hold with no hold class is the conflation this gate exists to prevent");

  // The dollar cap outranks everything except a pass. Hit it, stop, hold, alert.
  // It does NOT refund: it is a limit we chose, not a verdict on the document,
  // and the operator may raise it and resume.
  //
  // Three things it has to survive, each of which defeated the old one-line test:
  //  - RESERVE. The cap is read before the next call and after the last one landed.
  //    Nothing priced the call it is about to authorise, so a cap tested at exactly
  //    the cap is overshot by a whole cycle. Stop one cycle early.
  //  - THE HOLE. addSpend() refuses to price an unmeasured call at zero because "the
  //    cap must know it has a hole". This is the cap asking. A provider that returns
  //    no accounting, or a deps object with no `judge`, otherwise has no cap at all.
  //  - NEITHER IS A VERDICT ON THE DOCUMENT. Both are INFRA and neither refunds.
  const reserve = limits.spendCapUsd / (limits.maxRegenerations + 1);
  if (spend.usd + reserve > limits.spendCapUsd) {
    return {
      action: "hold_alert",
      reason: `order spend $${spend.usd.toFixed(2)} leaves less than the $${reserve.toFixed(2)} reserved for one more cycle against the cap of $${limits.spendCapUsd.toFixed(2)}`,
      event: "gate.spend_cap_reached", hold_class: "INFRA_HOLD", tell_customer: false, refund: false,
    };
  }
  if (spend.unmeasured_calls > limits.maxUnmeasuredCalls) {
    return {
      action: "hold_alert",
      reason: `${spend.unmeasured_calls} model calls on this order returned no cost accounting; the dollar cap cannot see them and is not enforceable`,
      event: "gate.spend_unmeasured", hold_class: "INFRA_HOLD", tell_customer: false, refund: false,
    };
  }

  // INFRA. The document was never judged. The customer is never told and is
  // never refunded on this path; the order resumes when the service returns,
  // and if it does not, the order parks with an operator alert.
  if (last.hold_class === "INFRA_HOLD") {
    let trailing = 0;
    for (let i = attempts.length - 1; i >= 0 && attempts[i].hold_class === "INFRA_HOLD"; i--) trailing++;
    if (trailing < limits.maxGateAttempts) {
      return {
        action: "retry_gate", reason: `no judgement was obtained (${last.cause}); attempt ${trailing} of ${limits.maxGateAttempts}`,
        event: HOLD_EVENT.INFRA_HOLD, hold_class: "INFRA_HOLD", tell_customer: false, refund: false,
      };
    }
    return {
      action: "hold_alert", reason: `no judgement after ${trailing} gate attempts (${last.cause})`,
      event: HOLD_EVENT.INFRA_HOLD, hold_class: "INFRA_HOLD", tell_customer: false, refund: false,
    };
  }

  // QUALITY. The document was read and it failed.
  const qualityFails = attempts.filter((a) => a.hold_class === "QUALITY_HOLD").length;

  // The regeneration did not actually rewrite anything. Asking again with the
  // same brief is the loop's favourite failure and it is refused outright.
  if (last.changed_fraction !== null && last.changed_fraction < limits.minMaterialChange) {
    return {
      action: "refund",
      reason: `the regenerated document changed by ${(last.changed_fraction * 100).toFixed(1)}%, below the ${(limits.minMaterialChange * 100).toFixed(0)}% floor: it was not rewritten`,
      event: "gate.no_material_change", hold_class: "QUALITY_HOLD", tell_customer: true, refund: true,
    };
  }

  // Diverging, not converging. Stop immediately.
  const prior = attempts.slice(0, -1).filter((a) => a.hold_class === "QUALITY_HOLD" && a.score !== null);
  const prev = prior.length ? prior[prior.length - 1] : null;
  if (last.score !== null && prev && prev.score !== null && last.score <= prev.score) {
    return {
      action: "refund",
      reason: `the score did not improve: ${prev.score} then ${last.score}. It is diverging, not converging`,
      event: "gate.score_diverged", hold_class: "QUALITY_HOLD", tell_customer: true, refund: true,
    };
  }

  // Two regenerations maximum. The third failure refunds.
  if (qualityFails > limits.maxRegenerations) {
    return {
      action: "refund", reason: `${qualityFails} judgements on the merits, all failing; the regeneration budget is ${limits.maxRegenerations}`,
      event: "gate.regeneration_budget_exhausted", hold_class: "QUALITY_HOLD", tell_customer: true, refund: true,
    };
  }

  return {
    action: "regenerate", reason: `held on the merits; regeneration ${qualityFails} of ${limits.maxRegenerations}`,
    event: HOLD_EVENT.QUALITY_HOLD, hold_class: "QUALITY_HOLD", tell_customer: false, refund: false,
  };
}

// ---------------------------------------------------------------- events
// Invariant 9: all of it observable in the append-only events table. One row for
// the outcome under a class-specific action, plus one row per alert. Nothing
// here carries a key, a prompt, or the document.
interface EventRow { actor: string; action: string; entity: string; entity_id: string; detail: Record<string, unknown> }

function gateEvents(outcome: JudgeOutcome, ctx: { proposalId: string; attempt: number; decision?: LoopDecision }): EventRow[] {
  const rows: EventRow[] = [];
  const entity = "order_proposal";
  const common = {
    gate_version: outcome.gate_version,
    doc_hash: outcome.doc_hash,
    attempt: ctx.attempt,
    model_calls: outcome.model_calls,
    spend_usd: outcome.spend.usd,
    spend_unmeasured_calls: outcome.spend.unmeasured_calls,
    judge: outcome.judge.map((j) => ({ slot: j.slot, model: j.model, ok: j.ok, calls: j.calls, error_class: j.error_class })),
    used_fallback: outcome.used_fallback,
    from_record: outcome.from_record,
  };

  if (outcome.decision === "pass") {
    rows.push({ actor: "worker", action: "gate.pass", entity, entity_id: ctx.proposalId, detail: { ...common, score: outcome.score } });
  } else {
    const cls = outcome.hold_class ?? classifyHold(outcome.cause as JudgeCause);
    rows.push({
      actor: "worker", action: HOLD_EVENT[cls], entity, entity_id: ctx.proposalId,
      detail: {
        ...common,
        hold_class: cls,
        cause: outcome.cause,
        score: outcome.score,
        findings: outcome.findings.slice(0, 20),
        refund: refundOnHold(cls),
        customer_told: tellCustomerOnHold(cls),
        operator_alerted: alertOperatorOnHold(cls),
      },
    });
  }
  for (const a of outcome.alerts) {
    rows.push({ actor: "worker", action: a.code, entity, entity_id: ctx.proposalId, detail: { severity: a.severity, message: a.message, ...a.detail } });
  }
  if (ctx.decision) {
    rows.push({
      actor: "worker", action: ctx.decision.event, entity, entity_id: ctx.proposalId,
      detail: {
        action: ctx.decision.action, reason: ctx.decision.reason, hold_class: ctx.decision.hold_class,
        refund: ctx.decision.refund, customer_told: ctx.decision.tell_customer, attempt: ctx.attempt,
      },
    });
  }
  return rows;
}

// The operator's alert. INFRA holds go here and ONLY here — nothing on an INFRA
// path is allowed to reach the customer, because their proposal did not fail.
function operatorAlert(outcome: JudgeOutcome, ctx: { orderNo: string; orgName: string; proposalId: string }): { subject: string; html: string } {
  const cls = outcome.hold_class ?? "INFRA_HOLD";
  return {
    subject: `[Ktebli] ${cls} on order ${ctx.orderNo} — ${outcome.cause}`,
    html:
      `<p><strong>${cls}</strong> — order ${ctx.orderNo} (${ctx.orgName}), proposal ${ctx.proposalId}.</p>` +
      `<p>Cause: <code>${outcome.cause}</code>. Gate ${outcome.gate_version}, document ${outcome.doc_hash.slice(0, 12)}.</p>` +
      `<p>Judge attempts: ${outcome.judge.map((j) => `${j.model} (${j.ok ? "answered" : j.error_class ?? "failed"})`).join(", ") || "none"}.</p>` +
      `<p>Order spend so far: $${outcome.spend.usd.toFixed(2)}${outcome.spend.unmeasured_calls ? ` plus ${outcome.spend.unmeasured_calls} unmeasured call(s)` : ""}.</p>` +
      (outcome.alerts.length ? `<ul>${outcome.alerts.map((a) => `<li>[${a.severity}] ${a.code}: ${a.message}</li>`).join("")}</ul>` : "") +
      (cls === "INFRA_HOLD"
        ? `<p>The customer has NOT been contacted and has NOT been refunded. The order resumes on the next tick once the service returns.</p>`
        : `<p>The customer is being told and refunded on the quality path.</p>`),
  };
}

export {
  GATE_VERSION, DIMENSIONS, DISQUALIFIERS, CRITIC_DISQUALIFIERS, MIN_SCORE, WEIGHTED_MIN,
  DEFAULT_CRITICS, MAX_REGENERATIONS,
  normaliseDocument, documentHash, modelFamily, criticModelsFor,
  gateWordCount, preflight, buildCriticPrompt, parseJudgement, applyBar,
  withTimeout, combineCritics, runCritic, runGate,
  holdAction, regenerationBrief, refundLetter,
};
export {
  // ---- v2, the production gate
  JUDGE_GATE_VERSION, JUDGE_PRIMARY, JUDGE_FALLBACK, JUDGE_SEED, JUDGE_TEMPERATURE,
  JUDGE_EFFORT, JUDGE_MAX_TOKENS, JUDGE_SLOTS, VERDICT_ENUM, NEUTRAL_D8,
  ALL_JUDGE_CAUSES, QUALITY_CAUSES, INFRA_CAUSES, HOLD_EVENT,
  classifyHold, tellCustomerOnHold, refundOnHold, alertOperatorOnHold,
  judgeLadder, HEADROOM_WARN, HEADROOM_CRITICAL, assessHeadroom, keyFingerprint,
  classifyProviderError, DEFAULT_ORDER_SPEND_CAP_USD, newSpend, addSpend,
  SCORE_DISQUALIFIER_PENALTY, gateScore,
  MIN_MATERIAL_CHANGE, SHINGLE_N, MAX_CONTENT_RETENTION, shingleCounts, materialChange,
  judgeSchema, judgeView, buildJudgePrompt, buildJudgeRequest, parseJudgeReply,
  runJudgeRung, runDeliveryGate,
  LOOP_LIMITS, loopAction, gateEvents, operatorAlert,
};
export type {
  Dimension, Disqualifier, Judgement, CriticResult, GateOutcome, GateInput, GateDeps,
  GateCause, GateDecision, GateFmt, CriticRequest, PreflightResult, ParseResult, HoldAction,
  HoldClass, JudgeCause, ProviderErrorClass, GateAlert, JudgeReply, KeyReading, KeySlot,
  HeadroomLevel, HeadroomAssessment, SpendLedger, JudgeAttempt, JudgeOutcome, Ladder,
  JsonSchemaFormat, AssertedVerdict, JudgeView, JudgeParse, ChangeReport,
  LoopLimits, LoopAction, LoopAttempt, LoopDecision, EventRow,
};
