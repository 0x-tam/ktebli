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

interface CriticRequest { model: string; prompt: string; maxTokens: number; effort: "low" | "medium" | "high" }

interface GateDeps {
  chat(req: CriticRequest): Promise<string>;
  // Returns a stored TERMINAL verdict for this hash, or null. The database is the
  // real authority; this is how the module sees it, and how tests drive it.
  storedVerdict?(docHash: string): Promise<GateOutcome | null>;
  timeoutMs?: number;
  attemptsPerCritic?: number;
  beat?(): void;             // heartbeat, so the reaper does not kill a slow judge
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
  if (stored) return { ...stored, doc_hash, from_record: true, model_calls: 0 };

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

export {
  GATE_VERSION, DIMENSIONS, DISQUALIFIERS, CRITIC_DISQUALIFIERS, MIN_SCORE, WEIGHTED_MIN,
  DEFAULT_CRITICS, MAX_REGENERATIONS,
  normaliseDocument, documentHash, modelFamily, criticModelsFor,
  gateWordCount, preflight, buildCriticPrompt, parseJudgement, applyBar,
  withTimeout, combineCritics, runCritic, runGate,
  holdAction, regenerationBrief, refundLetter,
};
export type {
  Dimension, Disqualifier, Judgement, CriticResult, GateOutcome, GateInput, GateDeps,
  GateCause, GateDecision, GateFmt, CriticRequest, PreflightResult, ParseResult, HoldAction,
};
