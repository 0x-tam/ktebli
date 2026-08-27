// Tests for the pre-delivery quality gate.
//
//   npx --yes deno@2.9.5 run tests/delivery-gate/delivery_gate_test.ts
//
// No network, no permissions, no imports outside the module under test. Every
// model call is a fake injected through GateDeps, which is the point of keeping
// the logic and the model call apart: the gate's decisions are all testable
// without OpenRouter, and none of these tests can pass because a model was
// feeling generous.

import {
  DIMENSIONS, CRITIC_DISQUALIFIERS, MAX_REGENERATIONS,
  applyBar, buildCriticPrompt, combineCritics, criticModelsFor, documentHash,
  gateWordCount, holdAction, modelFamily, normaliseDocument, parseJudgement,
  preflight, refundLetter, regenerationBrief, runGate, withTimeout,
  // v2
  JUDGE_GATE_VERSION, JUDGE_PRIMARY, JUDGE_FALLBACK, JUDGE_SEED, JUDGE_TEMPERATURE,
  JUDGE_EFFORT, JUDGE_SLOTS, VERDICT_ENUM, NEUTRAL_D8,
  ALL_JUDGE_CAUSES, QUALITY_CAUSES, INFRA_CAUSES, HOLD_EVENT,
  classifyHold, tellCustomerOnHold, refundOnHold, alertOperatorOnHold,
  judgeLadder, HEADROOM_WARN, HEADROOM_CRITICAL, assessHeadroom, keyFingerprint,
  DEFAULT_ORDER_SPEND_CAP_USD, newSpend, addSpend,
  SCORE_DISQUALIFIER_PENALTY, gateScore,
  MIN_MATERIAL_CHANGE, shingleCounts, materialChange,
  judgeSchema, judgeView, buildJudgePrompt, buildJudgeRequest, parseJudgeReply,
  runDeliveryGate, LOOP_LIMITS, loopAction, gateEvents, operatorAlert,
} from "../../supabase/functions/worker/delivery_gate.ts";
import type {
  CriticRequest, GateDeps, GateInput, GateOutcome, Judgement,
  HoldClass, JudgeCause, JudgeReply, KeyReading, JudgeOutcome, LoopAttempt,
} from "../../supabase/functions/worker/delivery_gate.ts";

// ---------------------------------------------------------------- harness
let checks = 0;
const failures: string[] = [];
let current = "";

function ok(cond: unknown, label: string) {
  checks++;
  if (!cond) failures.push(`${current}: ${label}`);
}
function eq(actual: unknown, expected: unknown, label: string) {
  checks++;
  if (actual !== expected) failures.push(`${current}: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  current = name;
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: threw ${String(e).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- fixtures
const GENERATOR = "anthropic/claude-opus-5";

// Four ledger items carrying four named referents. properNounAudit reads the
// `claim` field and ignores the E-* scaffolding.
const LEDGER = [
  { id: "E-INTAKE-1", claim: "The applicant runs a youth centre in Bab al-Tabbaneh." },
  { id: "E-WEB-1", claim: "Delivered a literacy programme with the Municipality of Tripoli in 2024." },
  { id: "E-WEB-2", claim: "Works alongside Safadi Foundation on referrals." },
  { id: "E-PROP-1", claim: "Ran evening classes in Qobbe reaching 180 young people." },
];

// A narrative that draws on the ledger. Long enough to clear the 250-word floor.
const NARRATIVE_GOOD = `
## The problem as it stands

Two neighbourhoods carry most of the out-of-school population in this city, and they carry it for
different reasons. In Bab al-Tabbaneh the barrier is work: boys leave at thirteen because a day of
casual labour pays more than a term of schooling appears to. In Qobbe the barrier is documentation,
and a family without papers cannot enrol a child at all. Treating those two as one problem is why
previous efforts reached neither.

## What we propose to do

We will run two tracks rather than one. The evening classes we already deliver in Qobbe, which
reached 180 young people last year, will be extended to carry a documentation caseworker, because
the teaching was never the constraint there. In Bab al-Tabbaneh the youth centre will host a paid
apprenticeship strand instead, on the reasoning that an intervention which does not replace the
income it displaces will not hold a fourteen year old for a full term.

## Why this organisation

The Municipality of Tripoli worked with us on the 2024 literacy programme and holds the enrolment
records the documentation track depends on. Safadi Foundation refers young people to us already,
which is where the apprenticeship intake will come from. Neither relationship is new and neither
needs to be built before the work starts.

## What continues afterwards

The apprenticeship placements sit with the employers who host them, and the cost of hosting one is
a wage the employer is already paying. The documentation caseworker post transfers to the
municipality's own social affairs office at month eighteen, at a cost the office has budgeted for.
We are not proposing that the community will take ownership; we are naming who signs what.
`.trim();

// The same length and shape, and it names nothing the ledger offers.
const NARRATIVE_UNSPECIFIC = NARRATIVE_GOOD
  .replace(/Bab al-Tabbaneh/g, "the first neighbourhood")
  .replace(/Qobbe/g, "the second neighbourhood")
  .replace(/The Municipality of Tripoli/g, "The local authority")
  .replace(/Municipality of Tripoli/g, "the local authority")
  .replace(/Safadi Foundation/g, "A referral partner")
  .replace(/municipality's/g, "authority's");

const GRANT_TEXT = "Round 4 supports out-of-school children in urban Lebanon. Priority 1 is retention.";

function baseInput(over: Partial<GateInput> = {}): GateInput {
  return {
    narrative: NARRATIVE_GOOD,
    applicantName: "Mashghal Community Association",
    applicantLine: "Mashghal Community Association · registration no. 1234 · mashghal.org",
    grantText: GRANT_TEXT,
    fmt: { maxWords: null },
    evidence: LEDGER,
    generatorModel: GENERATOR,
    ...over,
  };
}

// ---------------------------------------------------------------- fake critics
function scoresAt(over: Record<string, number> = {}): Record<string, number> {
  const s: Record<string, number> = {};
  for (const d of DIMENSIONS) s[d.key] = d.weighted ? 4 : 3;   // exactly on the floor
  return { ...s, ...over };
}
function dqAllFalse(over: Record<string, boolean> = {}): Record<string, boolean> {
  const d: Record<string, boolean> = {};
  for (const q of CRITIC_DISQUALIFIERS) d[q.key] = false;
  return { ...d, ...over };
}
function judgementJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    scores: scoresAt(),
    disqualifiers: dqAllFalse(),
    weakest_thing: "The budget justification for the apprenticeship wage subsidy is thin.",
    fix_instructions: ["Show how the wage subsidy tapers."],
    ...over,
  });
}

interface Recorder { calls: CriticRequest[]; chat: (r: CriticRequest) => Promise<string> }
function recorder(reply: (r: CriticRequest) => Promise<string> | string): Recorder {
  const calls: CriticRequest[] = [];
  return { calls, chat: async (r: CriticRequest) => { calls.push(r); return await reply(r); } };
}
function deps(rec: Recorder, over: Partial<GateDeps> = {}): GateDeps {
  return { chat: rec.chat, timeoutMs: 50, attemptsPerCritic: 2, ...over };
}

// ================================================================ tests
await test("fixtures are usable", () => {
  ok(gateWordCount(NARRATIVE_GOOD) >= 250, `narrative is ${gateWordCount(NARRATIVE_GOOD)} words, need >= 250`);
  const pre = preflight(baseInput());
  eq(pre.failures.length, 0, `good narrative should clear preflight, got ${JSON.stringify(pre.failures)}`);
  ok(pre.evidence_offered >= 3, `ledger should offer >= 3 referents, offers ${pre.evidence_offered}`);
  ok(pre.evidence_used * 2 >= pre.evidence_offered, `good narrative should use its evidence (${pre.evidence_used}/${pre.evidence_offered})`);
});

// ---------------------------------------------------------------- 1. a clear pass
await test("a clear pass: two critics, both on the floor, both clear", async () => {
  const rec = recorder(() => judgementJson());
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "pass", "decision");
  eq(out.cause, null, "cause");
  eq(out.sticky, true, "a pass is sticky");
  eq(out.from_record, false, "freshly judged");
  eq(out.findings.length, 0, "no findings on a pass");
  eq(out.critics.length, 2, "two critics ran");
  eq(rec.calls.length, 2, "exactly one call per critic");
  ok(rec.calls[0].model !== rec.calls[1].model, "two different critic models");
  ok(modelFamily(rec.calls[0].model) !== modelFamily(rec.calls[1].model), "two different families");
  for (const c of rec.calls) ok(modelFamily(c.model) !== modelFamily(GENERATOR), "no critic in the generator's family");
});

await test("the critics are blind: the prompt carries no pipeline artefacts", () => {
  const p = buildCriticPrompt(baseInput());
  ok(p.includes(GRANT_TEXT), "carries the grant text");
  ok(p.includes("Mashghal Community Association"), "carries the applicant identity");
  ok(p.includes("## The problem as it stands"), "carries the narrative");
  ok(!p.includes("E-INTAKE-1") && !p.includes("E-WEB-1"), "does not carry the evidence ledger");
  ok(!/pipeline|stage|validator|claim ledger/i.test(p), "does not tell the critic a pipeline exists");
  ok(/cannot count/i.test(p), "forbids the critic from judging length");
});

// ---------------------------------------------------------------- 2. a clear hold
await test("a clear hold: one dimension below its floor", async () => {
  const rec = recorder(() => judgementJson({ scores: scoresAt({ submission_readiness: 3 }) }));
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "hold", "decision");
  eq(out.cause, "bar_not_cleared", "cause");
  eq(out.sticky, true, "a judgement on the merits is sticky");
  eq(out.retryable, false, "the same document is not judged again");
  ok(out.findings.some((f) => f.includes("dimension 10")), `findings name the dimension: ${JSON.stringify(out.findings)}`);
  ok(out.findings.some((f) => f.startsWith("[")), "findings are attributed to a critic");
});

await test("a clear hold: a disqualifier fires while every score is a 5", async () => {
  const perfect = scoresAt();
  for (const d of DIMENSIONS) perfect[d.key] = 5;
  const rec = recorder(() => judgementJson({ scores: perfect, disqualifiers: dqAllFalse({ sustainability_empty: true }) }));
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "hold", "a disqualifier overrides every score");
  eq(out.cause, "bar_not_cleared", "cause");
  ok(out.findings.some((f) => f.includes("D3")), "the disqualifier is named");
});

await test("no averaging: nine 5s and one 1 is a hold, not an 4.6", () => {
  const s = scoresAt();
  for (const d of DIMENSIONS) s[d.key] = 5;
  s.clarity = 1;
  const bar = applyBar({ scores: s, disqualifiers: dqAllFalse(), weakest_thing: "x", fix_instructions: [] });
  eq(bar.clears, false, "clears");
  eq(bar.failures.length, 1, "one named failure");
});

await test("the floors are the published ones, exactly", () => {
  const j = (over: Record<string, number>): Judgement =>
    ({ scores: scoresAt(over), disqualifiers: dqAllFalse(), weakest_thing: "x", fix_instructions: [] });
  eq(applyBar(j({})).clears, true, "floor-exact clears");
  for (const d of DIMENSIONS) {
    const floor = d.weighted ? 4 : 3;
    eq(applyBar(j({ [d.key]: floor - 1 })).clears, false, `dimension ${d.n} one below its floor must fail`);
  }
  eq(applyBar(j({ donor_fit: 3 })).clears, false, "a weighted dimension at 3 fails even though 3 clears elsewhere");
});

await test("one failing critic holds the document even when the other clears it", async () => {
  const rec = recorder((r) =>
    r.model.startsWith("openai/")
      ? judgementJson()
      : judgementJson({ disqualifiers: dqAllFalse({ reads_ai_generated: true }) }));
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "hold", "a single clearing critic is never enough");
  eq(out.cause, "bar_not_cleared", "cause");
});

// ---------------------------------------------------------------- 3. garbage
await test("a model returning garbage yields no judgement, and no judgement is a hold", async () => {
  const rec = recorder(() => "I'm sorry, I can't evaluate that. Here is a poem instead.");
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "hold", "decision");
  eq(out.cause, "judgement_unavailable", "cause");
  eq(out.sticky, false, "the absence of a judgement is not a judgement about the document");
  eq(out.retryable, true, "so the same document may be judged again");
  eq(rec.calls.length, 4, "both critics retried once each");
  ok(out.findings.every((f) => /no judgement from/.test(f)), "findings say what was missing");
});

await test("garbage that is well-formed JSON is still garbage", () => {
  const cases: Array<[string, string]> = [
    ["missing a dimension", JSON.stringify({ scores: (() => { const s = scoresAt(); delete s.clarity; return s; })(), disqualifiers: dqAllFalse(), weakest_thing: "x", fix_instructions: [] })],
    ["a non-integer score", judgementJson({ scores: scoresAt({ donor_fit: 4.5 }) })],
    ["a stringified score", JSON.stringify({ scores: { ...scoresAt(), donor_fit: "4 (with reservations)" }, disqualifiers: dqAllFalse(), weakest_thing: "x", fix_instructions: [] })],
    ["a score out of range", judgementJson({ scores: scoresAt({ clarity: 7 }) })],
    ["a missing disqualifier", JSON.stringify({ scores: scoresAt(), disqualifiers: (() => { const d = dqAllFalse(); delete d.generic_intervention; return d; })(), weakest_thing: "x", fix_instructions: [] })],
    ["a non-boolean disqualifier", judgementJson({ disqualifiers: dqAllFalse({ targets_arbitrary: "maybe" as unknown as boolean }) })],
    ["no weakest_thing", judgementJson({ weakest_thing: "  " })],
    ["fix_instructions not an array", judgementJson({ fix_instructions: "fix it" })],
    ["prose with no object", "The proposal is broadly acceptable."],
    ["truncated JSON", '{"scores": {"donor_fit": 4,'],
  ];
  for (const [label, raw] of cases) {
    const p = parseJudgement(raw);
    eq(p.ok, false, `${label} must be rejected`);
  }
  eq(parseJudgement(judgementJson()).ok, true, "a well-formed reply parses");
});

await test("a failing judgement beats a missing one: the ordering rule", async () => {
  const rec = recorder((r) =>
    r.model.startsWith("openai/") ? judgementJson({ scores: scoresAt({ feasibility: 2 }) }) : "garbage");
  const out = await runGate(baseInput(), deps(rec));
  eq(out.cause, "bar_not_cleared", "a document one critic failed is held on the merits");
  eq(out.sticky, true, "and must change before it is judged again");
});

// ---------------------------------------------------------------- 4. timeout
await test("withTimeout rejects and does not leave a timer running", async () => {
  let rejected = false;
  try {
    await withTimeout(new Promise<string>(() => {}), 10, "critic x");
  } catch (e) {
    rejected = /no reply after 10ms/.test(String(e));
  }
  ok(rejected, "a hanging call rejects with a timeout");
  const fast = await withTimeout(Promise.resolve("done"), 1000, "critic x");
  eq(fast, "done", "a fast call is untouched");
});

await test("a model that never answers is a hold, never a pass", async () => {
  const rec = recorder(() => new Promise<string>(() => {}));
  const out = await runGate(baseInput(), deps(rec, { timeoutMs: 10 }));
  eq(out.decision, "hold", "fail closed");
  eq(out.cause, "judgement_unavailable", "cause");
  eq(out.sticky, false, "not a judgement about the document");
  eq(out.retryable, true, "retryable");
  ok(out.findings.some((f) => /no reply after/.test(f)), `findings record the timeout: ${JSON.stringify(out.findings)}`);
});

// ---------------------------------------------------------------- 5. re-judge
await test("a re-judge of an unchanged document returns the stored verdict, unchanged", async () => {
  const input = baseInput();

  const firstRec = recorder(() => judgementJson({ scores: scoresAt({ organisation_fit: 2 }) }));
  const first = await runGate(input, deps(firstRec));
  eq(first.decision, "hold", "first pass holds");
  eq(first.sticky, true, "and is sticky");
  ok(firstRec.calls.length > 0, "the first judgement cost model calls");

  // The record, exactly as the database would hold it.
  const store = new Map<string, GateOutcome>([[first.doc_hash, first]]);

  // The retry is handed a critic that would now pass the same document. It must
  // never be asked: this is the "retried into passing" attack.
  const retryRec = recorder(() => judgementJson());
  const second = await runGate(input, deps(retryRec, {
    storedVerdict: (h: string) => Promise.resolve(store.get(h) ?? null),
  }));
  eq(retryRec.calls.length, 0, "no model was called on a re-judge");
  eq(second.model_calls, 0, "and the outcome says so");
  eq(second.from_record, true, "the outcome is flagged as replayed");
  eq(second.decision, "hold", "the stored verdict is returned verbatim");
  eq(second.cause, "bar_not_cleared", "cause is preserved");
  eq(second.doc_hash, first.doc_hash, "same hash");
  eq(JSON.stringify(second.findings), JSON.stringify(first.findings), "findings are preserved");

  // A document that ACTUALLY changed gets a fresh judgement.
  const changed = baseInput({ narrative: NARRATIVE_GOOD.replace("two tracks", "three tracks") });
  const changedRec = recorder(() => judgementJson());
  const third = await runGate(changed, deps(changedRec, {
    storedVerdict: (h: string) => Promise.resolve(store.get(h) ?? null),
  }));
  ok(third.doc_hash !== first.doc_hash, "a changed document has a different hash");
  eq(third.from_record, false, "and is judged fresh");
  eq(third.decision, "pass", "and can pass on its merits");
  eq(changedRec.calls.length, 2, "which cost two model calls");
});

await test("the hash tracks content, not whitespace", async () => {
  const a = await documentHash(NARRATIVE_GOOD);
  const reflowed = NARRATIVE_GOOD.replace(/\n\n/g, "\n\n\n").replace(/\n/g, "  \n") + "\n\n";
  eq(await documentHash(reflowed), a, "reflowing blank lines and trailing spaces is not a change");
  eq(await documentHash("\r\n" + NARRATIVE_GOOD.replace(/\n/g, "\r\n")), a, "line endings are not a change");
  ok(await documentHash(NARRATIVE_GOOD.replace("180 young people", "190 young people")) !== a, "one number is a change");
  ok(await documentHash(NARRATIVE_GOOD.replace("Qobbe", "qobbe")) !== a, "case is a change");
  ok(await documentHash(NARRATIVE_GOOD, "delivery-gate-v2") !== a, "a change to the bar invalidates every stored verdict");
  eq(normaliseDocument("  a  \n\n\n\n b \n\n"), "a\n\n b", "normalisation is whitespace only");
});

// ---------------------------------------------------------------- 6. reservations
await test("a critic cannot pass a document with reservations", async () => {
  // The reply asserts its own verdict, adds an average, and hedges. The numbers
  // it reports still fail the bar, and the numbers are all the gate reads.
  const rec = recorder(() => JSON.stringify({
    verdict: "pass_with_reservations",
    recommendation: "fund",
    overall: 4.4,
    confidence: "high",
    note: "Passing on balance despite a weak strategy section.",
    scores: scoresAt({ strategic_quality: 2 }),
    disqualifiers: dqAllFalse(),
    weakest_thing: "The strategy is the obvious one.",
    fix_instructions: ["Choose a way in that is not the default."],
  }));
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "hold", "self-asserted verdicts are ignored");
  eq(out.cause, "bar_not_cleared", "cause");
  ok(out.findings.some((f) => f.includes("dimension 2")), "the real failure is named");
  ok(!JSON.stringify(out).includes("pass_with_reservations"), "the asserted verdict is not carried forward");
});

await test("the reverse also holds: a critic cannot fail a document it scored as clearing", async () => {
  const rec = recorder(() => JSON.stringify({
    verdict: "reject",
    overall: 1.0,
    scores: scoresAt(),
    disqualifiers: dqAllFalse(),
    weakest_thing: "Nothing in particular.",
    fix_instructions: [],
  }));
  const out = await runGate(baseInput(), deps(rec));
  eq(out.decision, "pass", "the bar is applied to observations, not to the model's opinion");
});

// ---------------------------------------------------------------- the family rule
await test("the generator never grades its own work, whatever the configuration says", async () => {
  const rec = recorder(() => judgementJson());
  const out = await runGate(baseInput({ criticModels: ["anthropic/claude-sonnet-4", "x-ai/grok-4.6"] }), deps(rec));
  eq(out.decision, "hold", "decision");
  eq(out.cause, "judge_misconfigured", "cause");
  eq(rec.calls.length, 0, "no model was called");
  ok(out.findings[0].includes("own family"), `findings explain: ${out.findings[0]}`);

  eq(criticModelsFor(GENERATOR, ["openai/a", "openai/b"]).error !== null, true, "two critics from one family is one critic");
  eq(criticModelsFor(GENERATOR, ["openai/gpt-5.6-sol"]).error !== null, true, "one critic is not two");
  eq(criticModelsFor(GENERATOR).error, null, "the default pair is legal");
  eq(criticModelsFor(GENERATOR).models.length, 2, "and is a pair");
  eq(modelFamily("x-ai/grok-4.6"), "x-ai", "family is the provider prefix");
});

// ---------------------------------------------------------------- preflight
await test("preflight holds deterministically and spends nothing", async () => {
  const cases: Array<[string, GateInput, RegExp]> = [
    ["empty narrative", baseInput({ narrative: "   " }), /empty/],
    ["a stub", baseInput({ narrative: "We will do good work in the community. ".repeat(5) }), /not a proposal/],
    ["over the word limit", baseInput({ fmt: { maxWords: 100 } }), /word limit/],
    ["placeholder text", baseInput({ narrative: NARRATIVE_GOOD + "\n\nBudget: [TBD]" }), /placeholder/],
    ["evidence unused", baseInput({ narrative: NARRATIVE_UNSPECIFIC }), /D4/],
  ];
  for (const [label, input, re] of cases) {
    const rec = recorder(() => judgementJson());
    const out = await runGate(input, deps(rec));
    eq(out.decision, "hold", `${label}: decision`);
    eq(out.cause, "preflight_failed", `${label}: cause`);
    eq(out.sticky, true, `${label}: a deterministic fact about the document is sticky`);
    eq(rec.calls.length, 0, `${label}: no model call`);
    ok(out.findings.some((f) => re.test(f)), `${label}: findings say why — ${JSON.stringify(out.findings)}`);
  }
});

await test("preflight does not punish an applicant for evidence nobody has", () => {
  const thin = [{ id: "E-INTAKE-1", claim: "Registered charity number 1234." }];
  const pre = preflight(baseInput({ narrative: NARRATIVE_UNSPECIFIC, evidence: thin }));
  eq(pre.failures.length, 0, "a ledger offering fewer than three referents cannot trigger D4");
});

// ---------------------------------------------------------------- the ladder
await test("the ladder is regenerate, regenerate, refund — and never deliver", () => {
  const sticky = { decision: "hold", sticky: true } as GateOutcome;
  const notSticky = { decision: "hold", sticky: false } as GateOutcome;
  eq(holdAction(sticky, 0, 1), "regenerate", "first hold on the merits");
  eq(holdAction(sticky, 1, 1), "regenerate", "second hold on the merits");
  eq(holdAction(sticky, MAX_REGENERATIONS, 1), "refund", "budget exhausted");
  eq(holdAction(notSticky, 0, 1), "retry_gate", "a missing judgement is retried");
  eq(holdAction(notSticky, 0, 2), "retry_gate", "still retried");
  eq(holdAction(notSticky, 0, 3), "refund", "but not forever — and the end is a refund, not a delivery");
  let threw = false;
  try { holdAction({ decision: "pass", sticky: true } as GateOutcome, 0, 1); } catch { threw = true; }
  ok(threw, "there is no hold action for a pass");
});

await test("the regeneration brief is actionable and leaks nothing", async () => {
  const rec = recorder(() => judgementJson({ scores: scoresAt({ donor_fit: 2 }) }));
  const out = await runGate(baseInput(), deps(rec));
  const brief = regenerationBrief(out);
  ok(brief.includes("dimension 1"), "carries the failure");
  ok(brief.includes("weakest"), "carries the critic's single weakest thing");
  ok(!brief.includes("openai/") && !brief.includes("x-ai/"), "does not name the critic");
  ok(/evidence ledger does not carry/.test(brief), "restates the grounding rule");
  ok(/reserved strategic approach/.test(brief), "restates the exclusivity rule");
});

await test("the refund letter explains, and does not attach the document", () => {
  const l = refundLetter({ orgName: "Mashghal Community Association", orderNo: "KT-10007", amountUsd: 149, supportEmail: "hello@ktebli.com", refundConfirmed: true });
  ok(l.subject.includes("KT-10007"), "subject carries the order number");
  ok(l.html.includes("$149.00"), "names the amount");
  ok(/refunded \$149\.00 in full/.test(l.html), "states the refund as done when it is done");
  ok(!/attached|download|your files/i.test(l.html), "does not hand over the document it refused to deliver");
  const pending = refundLetter({ orgName: "x", orderNo: "KT-1", amountUsd: 299, supportEmail: "h@k.com", refundConfirmed: false });
  ok(!/have refunded/.test(pending.html), "never claims a refund that has not been executed");
});

// ---------------------------------------------------------------- combination unit
await test("combineCritics cannot be talked into a pass", () => {
  const clearing = { model: "a/x", family: "a", attempts: 1, ok: true, error: null, judgement: null, clears: true, failures: [] };
  const failing = { ...clearing, model: "b/y", family: "b", clears: false, failures: ["dimension 6"] };
  const missing = { ...clearing, model: "c/z", family: "c", ok: false, error: "timeout", clears: false, failures: [] };
  eq(combineCritics([clearing, { ...clearing, model: "b/y", family: "b" }]).decision, "pass", "two clearing critics pass");
  eq(combineCritics([clearing, failing]).cause, "bar_not_cleared", "one failing critic holds");
  eq(combineCritics([clearing, missing]).cause, "judgement_unavailable", "one missing critic holds");
  eq(combineCritics([clearing]).decision, "hold", "one critic is not a quorum");
  eq(combineCritics([]).decision, "hold", "no critics is not a pass");
  eq(combineCritics([failing, missing]).cause, "bar_not_cleared", "merits beat absence");
});

// ================================================================
// ====================== DELIVERY GATE v2 ========================
// ================================================================
// Everything above this line is the v1 suite and every check in it still runs.
// Below: the operator's specification, item by item, each limit tested on its
// own so a failure names which limit broke.

// ---------------------------------------------------------------- v2 fixtures
function judgeJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    scores: scoresAt(),
    disqualifiers: dqAllFalse(),
    verdict: "clears_bar",
    reasons: ["The delivery route is named and the partner relationship predates the grant."],
    weakest_thing: "The budget justification for the apprenticeship wage subsidy is thin.",
    fix_instructions: ["Show how the wage subsidy tapers."],
    ...over,
  });
}
function failingJudgeJson(over: Partial<Record<string, unknown>> = {}): string {
  return judgeJson({
    scores: scoresAt({ specificity: 2 }),
    verdict: "fails_bar",
    reasons: ["No delivery place is named."],
    ...over,
  });
}

interface JRec { calls: CriticRequest[]; judge: (r: CriticRequest) => Promise<JudgeReply> }
function jrecorder(reply: (r: CriticRequest, n: number) => JudgeReply | Promise<JudgeReply> | string): JRec {
  const calls: CriticRequest[] = [];
  return {
    calls,
    judge: async (r: CriticRequest) => {
      calls.push(r);
      const out = await reply(r, calls.length);
      return typeof out === "string" ? { text: out, usd: 0.004 } : out;
    },
  };
}
const NO_CHAT = () => Promise.reject(new Error("v2 must never fall back to chat() when judge() is supplied"));
function jdeps(rec: JRec, over: Partial<GateDeps> = {}): GateDeps {
  return { chat: NO_CHAT, judge: rec.judge, timeoutMs: 50, formatRetries: 1, ...over };
}
function reading(slot: string, usage: number, limit: number | null, fp = "aa" + slot): KeyReading {
  return { slot, key_fingerprint: fp, limit_usd: limit, usage_usd: usage };
}
function la(over: Partial<LoopAttempt> = {}): LoopAttempt {
  return { doc_hash: "h", decision: "hold", cause: "bar_not_cleared", hold_class: "QUALITY_HOLD", score: 30, changed_fraction: null, ...over };
}

// ---------------------------------------------------------------- the judge, as specified
await test("v2: the judge is the specified model and the fallback is a different provider", () => {
  eq(JUDGE_PRIMARY, "z-ai/glm-5.3-flash", "primary judge");
  eq(JUDGE_FALLBACK, "google/gemini-3.7-flash", "fallback judge");
  ok(modelFamily(JUDGE_PRIMARY) !== modelFamily(JUDGE_FALLBACK), "different providers on purpose");
  eq(JUDGE_SLOTS.length, 2, "two credential slots");
  ok(JUDGE_SLOTS[0].secret !== JUDGE_SLOTS[1].secret, "and two credentials, or a cap takes out both rungs");
  const l = judgeLadder(GENERATOR);
  eq(l.error, null, "the default ladder is legal against the deployed generator");
  eq(l.rungs.length, 2, "two rungs");
  eq(l.rungs[0].model, JUDGE_PRIMARY, "primary first");
  eq(l.rungs[1].model, JUDGE_FALLBACK, "fallback second");
  eq(l.alerts.length, 0, "and a healthy ladder alerts nothing");
});

await test("v2: reasoning_effort is HIGH, explicitly, on every judge call", async () => {
  const req = buildJudgeRequest(judgeView(baseInput()), JUDGE_SLOTS[0]);
  eq(req.effort, "high", "explicit high, never defaulted");
  eq(JUDGE_EFFORT, "high", "and the constant says so");
  ok(!/["']max["']/.test(JSON.stringify(req)), "the request never carries max");
  const rec = jrecorder(() => judgeJson());
  await runDeliveryGate(baseInput(), jdeps(rec));
  ok(rec.calls.length > 0, "a call was made");
  for (const c of rec.calls) eq(c.effort, "high", `every call is high, not ${c.effort}`);
});

await test("v2: temperature 0 and a fixed seed, and the request is byte-identical twice", () => {
  const v = judgeView(baseInput());
  const a = buildJudgeRequest(v, JUDGE_SLOTS[0]);
  const b = buildJudgeRequest(judgeView(baseInput()), JUDGE_SLOTS[0]);
  eq(a.temperature, 0, "temperature");
  eq(JUDGE_TEMPERATURE, 0, "the constant");
  eq(a.seed, JUDGE_SEED, "the seed is the fixed one");
  ok(Number.isInteger(JUDGE_SEED), "and it is a fixed integer, not a clock");
  eq(JSON.stringify(a), JSON.stringify(b), "the same document builds the same request, byte for byte");
  const other = buildJudgeRequest(judgeView(baseInput({ narrative: NARRATIVE_GOOD.replace("two tracks", "three tracks") })), JUDGE_SLOTS[0]);
  ok(JSON.stringify(other) !== JSON.stringify(a), "a different document builds a different request");
});

await test("v2: structured outputs, and the schema is generated from the bar so it cannot drift", () => {
  const s = judgeSchema();
  eq(s.type, "json_schema", "structured outputs");
  eq(s.json_schema.strict, true, "strict");
  const schema = s.json_schema.schema as Record<string, unknown>;
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const required = schema.required as string[];
  for (const k of ["scores", "disqualifiers", "verdict", "reasons", "weakest_thing", "fix_instructions"]) {
    ok(required.includes(k), `${k} is required`);
  }
  const scoreReq = (props.scores as Record<string, unknown>).required as string[];
  eq(scoreReq.length, DIMENSIONS.length, "one required score per published dimension");
  for (const d of DIMENSIONS) ok(scoreReq.includes(d.key), `schema carries dimension ${d.n}`);
  const dqReq = (props.disqualifiers as Record<string, unknown>).required as string[];
  eq(dqReq.length, CRITIC_DISQUALIFIERS.length, "one required condition per critic disqualifier");
  for (const d of CRITIC_DISQUALIFIERS) ok(dqReq.includes(d.key), `schema carries ${d.code}`);
  eq(JSON.stringify((props.verdict as Record<string, unknown>).enum), JSON.stringify([...VERDICT_ENUM]), "verdict is an enum");
  eq((props.reasons as Record<string, unknown>).minItems, 1, "reasons cannot be empty");
  const req = buildJudgeRequest(judgeView(baseInput()), JUDGE_SLOTS[0]);
  ok(req.responseFormat != null, "the request carries the schema");
});

await test("v2: the gate reads a field, and a field it cannot read is no judgement", () => {
  eq(parseJudgeReply(judgeJson()).ok, true, "a schema-shaped reply parses");
  const bad: Array<[string, string]> = [
    ["no verdict field", JSON.stringify({ scores: scoresAt(), disqualifiers: dqAllFalse(), reasons: ["x"], weakest_thing: "x", fix_instructions: [] })],
    ["a verdict outside the enum", judgeJson({ verdict: "pass_with_reservations" })],
    ["a verdict in prose", judgeJson({ verdict: "I would say it clears_bar on balance" })],
    ["reasons missing", JSON.stringify({ scores: scoresAt(), disqualifiers: dqAllFalse(), verdict: "clears_bar", weakest_thing: "x", fix_instructions: [] })],
    ["reasons empty", judgeJson({ reasons: [] })],
    ["reasons not an array", judgeJson({ reasons: "because" })],
    ["a dimension missing", JSON.stringify({ scores: (() => { const s = scoresAt(); delete s.feasibility; return s; })(), disqualifiers: dqAllFalse(), verdict: "clears_bar", reasons: ["x"], weakest_thing: "x", fix_instructions: [] })],
  ];
  for (const [label, raw] of bad) eq(parseJudgeReply(raw).ok, false, `${label} must be refused`);
});

await test("v2: the asserted verdict is recorded and is never decisive, in both directions", async () => {
  // Asserts it clears; the numbers say a dimension is below its floor. The bar wins.
  const recA = jrecorder(() => judgeJson({ scores: scoresAt({ feasibility: 3 }), verdict: "clears_bar" }));
  const a = await runDeliveryGate(baseInput(), jdeps(recA));
  eq(a.decision, "hold", "a model cannot assert its way past the bar");
  eq(a.cause, "bar_not_cleared", "cause");
  eq(a.judge[0].asserted_verdict, "clears_bar", "what it asserted is recorded");
  ok(a.alerts.some((x) => x.code === "gate.verdict_disagreement"), "and the disagreement is an event");

  // Asserts it fails; every number clears. The bar wins there too.
  const recB = jrecorder(() => judgeJson({ verdict: "fails_bar" }));
  const b = await runDeliveryGate(baseInput(), jdeps(recB));
  eq(b.decision, "pass", "the bar is applied to observations, not to the model's opinion");
  eq(b.judge[0].asserted_verdict, "fails_bar", "recorded either way");
  ok(b.alerts.some((x) => x.code === "gate.verdict_disagreement"), "and flagged");
});

// ---------------------------------------------------------------- blindness
await test("v2: the judge sees the finished document only", () => {
  const input = baseInput();
  const v = judgeView(input);
  eq(Object.keys(v).sort().join(","), "applicantLine,grantText,narrative", "the view has exactly three fields");
  const p = buildJudgePrompt(v);
  ok(p.includes(GRANT_TEXT), "carries the grant text");
  ok(p.includes("Mashghal Community Association"), "carries the applicant identity");
  ok(p.includes("## The problem as it stands"), "carries the narrative");
  ok(!p.includes("E-INTAKE-1") && !p.includes("E-WEB-1"), "no evidence ledger");
  ok(!p.includes(GENERATOR) && !p.includes("anthropic"), "no generator identity");
  ok(!/pipeline|stage|validator|claim ledger/i.test(p), "no pipeline view");
  ok(!/attempt|regenerat|previous (draft|verdict|assessment)|earlier version/i.test(p), "no prior attempt history");
  ok(/cannot count/i.test(p), "still forbids judging length");
});

await test("v2: the instrument is neutral — it does not hand the judge the answer it asks for", () => {
  const p = buildJudgePrompt(judgeView(baseInput()));
  // reports/quality-iteration-1.md §3 CORRECTED: the v1 prompt supplied this
  // vocabulary and every critic returned it. E-1 withheld it and none did.
  const primed = [/tri-?colon/i, /uniform paragraph rhythm/i, /abstract nouns/i, /machine-generated/i, /template diction/i];
  for (const re of primed) ok(!re.test(p), `the v2 prompt must not supply "${re.source}"`);
  const v1 = buildCriticPrompt(baseInput());
  ok(/tri-colon|machine-generated/i.test(v1), "v1 does supply it — this is the difference being tested, not an accident");
  ok(p.includes("reads_ai_generated"), "the condition itself is still asked");
  ok(p.includes(NEUTRAL_D8), "asked neutrally");
});

// ---------------------------------------------------------------- the ladder
await test("v2: a cap on the primary fails over to the other provider, and the order does not wait", async () => {
  const rec = jrecorder((r) => {
    if (r.model === JUDGE_PRIMARY) throw new Error("llm 403 Key limit exceeded (total limit)");
    return judgeJson();
  });
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(out.decision, "pass", "the fallback answered");
  eq(out.used_fallback, true, "and the outcome says the fallback was used");
  eq(rec.calls.length, 2, "one call to each rung");
  eq(rec.calls[0].model, JUDGE_PRIMARY, "primary first");
  eq(rec.calls[1].model, JUDGE_FALLBACK, "fallback second");
  eq(out.judge[0].error_class, "cap", "the primary failure is classified as a cap");
  ok(out.alerts.some((a) => a.code === "gate.cap_exhausted"), "a cap is alerted");
  ok(out.alerts.some((a) => a.code === "gate.fallback_used"), "and the failover is recorded");
});

await test("v2: a timeout on the primary fails over too", async () => {
  const rec = jrecorder((r) => r.model === JUDGE_PRIMARY ? new Promise<JudgeReply>(() => {}) as unknown as JudgeReply : judgeJson());
  const out = await runDeliveryGate(baseInput(), jdeps(rec, { timeoutMs: 10 }));
  eq(out.decision, "pass", "the fallback answered");
  eq(out.judge[0].error_class, "timeout", "classified as a timeout, not a cap");
  eq(out.used_fallback, true, "failover recorded");
});

await test("v2: the fallback is a failover, NEVER a second opinion", async () => {
  const rec = jrecorder(() => failingJudgeJson());
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(out.decision, "hold", "held on the merits");
  eq(out.cause, "bar_not_cleared", "cause");
  eq(rec.calls.length, 1, "a document that failed is NEVER shown to the other model");
  eq(out.used_fallback, false, "no failover happened");
  eq(out.judge.length, 1, "one rung ran");

  // and the symmetric case: a verdict that PASSES also ends the ladder
  const rec2 = jrecorder(() => judgeJson());
  const out2 = await runDeliveryGate(baseInput(), jdeps(rec2));
  eq(out2.decision, "pass", "pass");
  eq(rec2.calls.length, 1, "a verdict, once obtained, ends the ladder");
});

await test("v2: both rungs capped is INFRA, never a pass and never a quality verdict", async () => {
  const rec = jrecorder(() => { throw new Error("HTTP 403 Key limit exceeded (total limit)"); });
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(out.decision, "hold", "fail closed");
  eq(out.cause, "cap_exhausted", "the cause names the cap");
  eq(out.hold_class, "INFRA_HOLD", "and it is INFRA, not QUALITY");
  eq(out.sticky, false, "the document was never judged");
  eq(out.retryable, true, "so it may be judged again when the bill is paid");
  eq(rec.calls.length, 2, "both rungs were tried");
});

await test("v2: a mixed failure is judgement_unavailable, still INFRA", async () => {
  const rec = jrecorder((r) => {
    if (r.model === JUDGE_PRIMARY) throw new Error("HTTP 403 Key limit exceeded (total limit)");
    throw new Error("upstream 502 bad gateway");
  });
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(out.cause, "judgement_unavailable", "not every failure was a cap");
  eq(out.hold_class, "INFRA_HOLD", "still INFRA");
  eq(out.judge[1].error_class, "transport", "the second is transport");
});

await test("v2: the generator never grades its own work, and a lost rung is alerted not ignored", async () => {
  const rec = jrecorder(() => judgeJson());
  const out = await runDeliveryGate(baseInput({ criticModels: ["anthropic/claude-sonnet-4", "openai/gpt-5.6-sol"] }), jdeps(rec));
  eq(out.decision, "pass", "the anthropic rung is dropped, the surviving rung answers, and nobody waits");
  eq(rec.calls.length, 1, "only the surviving rung was called");
  eq(rec.calls[0].model, "openai/gpt-5.6-sol", "and it is not in the generator's family");
  ok(out.alerts.some((a) => a.code === "gate.judge_rung_dropped"), "the dropped rung is alerted");
  ok(out.alerts.some((a) => a.code === "gate.judge_ladder_degraded"), "and the loss of the failover is alerted");

  const both = await runDeliveryGate(baseInput({ criticModels: ["anthropic/a", "anthropic/b"] }), jdeps(jrecorder(() => judgeJson())));
  eq(both.decision, "hold", "no usable rung");
  eq(both.cause, "judge_misconfigured", "cause");
  eq(both.hold_class, "INFRA_HOLD", "a misconfigured judge is our fault, not the document's");
  eq(both.model_calls, 0, "and it spends nothing");

  const dupe = judgeLadder("anthropic/claude-opus-5", ["openai/a", "openai/b"]);
  eq(dupe.rungs.length, 1, "a fallback on the same provider is not a fallback");
  ok(dupe.alerts.some((a) => a.code === "gate.judge_ladder_degraded"), "and that is alerted");
});

// ---------------------------------------------------------------- QUALITY vs INFRA
await test("v2: QUALITY and INFRA partition every cause, totally and disjointly", () => {
  ok(ALL_JUDGE_CAUSES.length >= 6, "every cause is listed");
  for (const c of ALL_JUDGE_CAUSES) {
    const inQ = QUALITY_CAUSES.has(c), inI = INFRA_CAUSES.has(c);
    ok(inQ !== inI, `${c} must be in exactly one class, not ${inQ && inI ? "both" : "neither"}`);
    const cls = classifyHold(c);
    eq(cls, inQ ? "QUALITY_HOLD" : "INFRA_HOLD", `${c} classifies consistently`);
  }
  let threw = false;
  try { classifyHold("something_new" as JudgeCause); } catch { threw = true; }
  ok(threw, "an unclassified cause refuses rather than guessing — refusal by default");
});

await test("v2: the two holds land under distinct event codes and can never be conflated", () => {
  ok(HOLD_EVENT.QUALITY_HOLD !== HOLD_EVENT.INFRA_HOLD, "distinct actions");
  eq(HOLD_EVENT.QUALITY_HOLD, "gate.quality_hold", "quality code");
  eq(HOLD_EVENT.INFRA_HOLD, "gate.infra_hold", "infra code");
  eq(tellCustomerOnHold("QUALITY_HOLD"), true, "a quality hold tells the customer");
  eq(tellCustomerOnHold("INFRA_HOLD"), false, "an infra hold NEVER tells the customer their proposal failed");
  eq(refundOnHold("QUALITY_HOLD"), true, "a quality hold refunds");
  eq(refundOnHold("INFRA_HOLD"), false, "an infra hold never refunds");
  eq(alertOperatorOnHold("INFRA_HOLD"), true, "an infra hold alerts the operator");
  eq(alertOperatorOnHold("QUALITY_HOLD"), true, "so does a quality hold");
});

await test("v2: every gate outcome carries a hold class, and the class matches the cause", async () => {
  const cases: Array<[string, () => Promise<JudgeOutcome>, HoldClass | null]> = [
    ["pass", () => runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson()))), null],
    ["bar not cleared", () => runDeliveryGate(baseInput(), jdeps(jrecorder(() => failingJudgeJson()))), "QUALITY_HOLD"],
    ["preflight", () => runDeliveryGate(baseInput({ narrative: "   " }), jdeps(jrecorder(() => judgeJson()))), "QUALITY_HOLD"],
    ["capped", () => runDeliveryGate(baseInput(), jdeps(jrecorder(() => { throw new Error("Key limit exceeded"); }))), "INFRA_HOLD"],
    ["garbage", () => runDeliveryGate(baseInput(), jdeps(jrecorder(() => "here is a poem"))), "INFRA_HOLD"],
    ["misconfigured", () => runDeliveryGate(baseInput({ criticModels: ["anthropic/a"] }), jdeps(jrecorder(() => judgeJson()))), "INFRA_HOLD"],
  ];
  for (const [label, run, expected] of cases) {
    const out = await run();
    eq(out.hold_class, expected, `${label}: hold class`);
    if (expected) {
      eq(out.decision, "hold", `${label}: decision`);
      eq(out.sticky, expected === "QUALITY_HOLD", `${label}: only a judgement about the document is sticky`);
      eq(out.retryable, expected === "INFRA_HOLD", `${label}: only a missing judgement is retryable`);
    }
  }
});

await test("v2: a garbage reply is INFRA, and the format retry carries the parse error and nothing else", async () => {
  const rec = jrecorder(() => "I would rather write a poem.");
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(out.cause, "judgement_unavailable", "no judgement");
  eq(out.hold_class, "INFRA_HOLD", "the document was never read, so it is not the document's fault");
  eq(rec.calls.length, 4, "one format retry per rung, then the next rung");
  const first = rec.calls[0].prompt, second = rec.calls[1].prompt;
  ok(second.startsWith(first), "the retry is the same prompt plus a format complaint");
  ok(/did not match the required schema/.test(second), "and the complaint is about the schema");
  ok(!/regenerat|attempt \d|previous draft|generator/i.test(second.slice(first.length)), "it says nothing about the generator or the attempt");
});

// ---------------------------------------------------------------- the critic never talks to the generator
await test("v2: the critic emits a verdict and its turn ends", async () => {
  const rec = jrecorder(() => failingJudgeJson());
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(rec.calls.length, 1, "one call, one verdict, no conversation");
  const brief = regenerationBrief(out as unknown as GateOutcome);
  ok(brief.length > 0, "the brief is a one-way artefact");
  ok(!brief.includes("z-ai/") && !brief.includes("google/"), "and it does not name the judge");
  ok(!brief.includes(GENERATOR), "nor the generator");
  // The judge's own deps expose no generator: JudgeView has three fields and
  // buildJudgePrompt can read nothing else.
  const v = judgeView(baseInput());
  eq(Object.keys(v).length, 3, "the judge's whole world is three strings");
});

// ---------------------------------------------------------------- score
await test("v2: gateScore exists only to detect divergence and can never pass a document", () => {
  const perfect: Judgement = { scores: Object.fromEntries(DIMENSIONS.map((d) => [d.key, 5])), disqualifiers: dqAllFalse(), weakest_thing: "x", fix_instructions: [] };
  eq(gateScore(perfect), 50, "ten fives");
  const oneDq: Judgement = { ...perfect, disqualifiers: dqAllFalse({ sustainability_empty: true }) };
  eq(gateScore(oneDq), 50 - SCORE_DISQUALIFIER_PENALTY, "a condition costs more than any dimension can pay for");
  ok(gateScore(oneDq) < gateScore(perfect), "monotone in the right direction");
  const floorJ: Judgement = { scores: scoresAt(), disqualifiers: dqAllFalse(), weakest_thing: "x", fix_instructions: [] };
  ok(gateScore(perfect) > gateScore(floorJ), "higher scores score higher");
  // and the bar does not read it
  eq(applyBar(oneDq).clears, false, "a 40 with a live condition still fails the bar");
  eq(applyBar(floorJ).clears, true, "a 34 exactly on the floors clears it");
  ok(gateScore(oneDq) > gateScore(floorJ), "so a HIGHER score can be the one that fails — the score is not the bar");
});

// ---------------------------------------------------------------- material change
await test("v2: material change is measured by diff, not asserted", () => {
  const same = materialChange(NARRATIVE_GOOD, NARRATIVE_GOOD);
  eq(same.identical, true, "identical");
  eq(same.changed_fraction, 0, "nothing changed");
  eq(same.material, false, "and that is not a regeneration");

  const cosmetic = materialChange(NARRATIVE_GOOD, NARRATIVE_GOOD.replace("180 young people", "181 young people"));
  eq(cosmetic.identical, false, "the hash would differ");
  ok(cosmetic.changed_fraction < MIN_MATERIAL_CHANGE, `one word is not a rewrite (${cosmetic.changed_fraction.toFixed(3)})`);
  eq(cosmetic.material, false, "so it is refused as a regeneration");

  // FIXTURE CORRECTED. This previously read
  //   materialChange(GOOD, UNSPECIFIC + reversed-lines-of-GOOD)
  // and expected `material: true`. That fixture is an APPEND: every line of the held
  // document survives, so its within-line 5-grams survive with it, and the novelty is
  // supplied entirely by the padding. It scored 0.039 against the two-sided measure --
  // correctly. Keeping the old expectation would have required weakening the exact
  // defence patch 1a added, since "append padding and resubmit" is the attack the
  // two-sided check exists to refuse. A genuine rewrite replaces the text.
  const appended = materialChange(NARRATIVE_GOOD, NARRATIVE_UNSPECIFIC + "\n\n" + NARRATIVE_GOOD.split("\n").reverse().join("\n"));
  eq(appended.material, false, "an append with the old document intact is NOT a rewrite");

  // NARRATIVE_UNSPECIFIC is NARRATIVE_GOOD with its proper nouns swapped for generic
  // phrases -- a swappability fixture, not a rewrite, and it scores 0.148 because it
  // genuinely is not one. A rewrite has to be different prose.
  const NARRATIVE_REWRITTEN = `
## Q1. Who are you?

Nine years of Saturday sessions in one building have taught us where the gaps sit. We
opened in 2016 and have not closed since. Two staff, fifteen volunteers, one van.

## Q2. What is the problem?

Children stop attending in the spring and nobody follows up. Last year we counted
forty-one who left and were never contacted again by any service in the district.

## Q3. What will you do?

Two workers, four afternoons a week, tracking every absence within seventy-two hours
and walking to the house where a phone call has already failed twice.
`;
  const rewritten = materialChange(NARRATIVE_GOOD, NARRATIVE_REWRITTEN);
  ok(rewritten.changed_fraction > MIN_MATERIAL_CHANGE, `a real rewrite clears the floor (${rewritten.changed_fraction.toFixed(3)})`);
  eq(rewritten.material, true, "material");

  eq(materialChange("", "").identical, true, "two empties are identical");
  ok(materialChange("", NARRATIVE_GOOD).changed_fraction > 0.9, "everything is new");
  eq(shingleCounts("one two three four five six").size, 2, "5-grams of a six-word document");
});

// ---------------------------------------------------------------- loop limits
await test("v2 loop: two regenerations maximum, and the third failure refunds", () => {
  const s = newSpend();
  const one = loopAction([la({ changed_fraction: null })], s);
  eq(one.action, "regenerate", "first failure regenerates");
  eq(one.refund, false, "no refund yet");
  const two = loopAction([la({ score: 20 }), la({ score: 30, changed_fraction: 0.5 })], s);
  eq(two.action, "regenerate", "second failure regenerates");
  const three = loopAction([la({ score: 20 }), la({ score: 30, changed_fraction: 0.5 }), la({ score: 40, changed_fraction: 0.5 })], s);
  eq(three.action, "refund", "the third failure refunds");
  eq(three.event, "gate.regeneration_budget_exhausted", "under its own event code");
  eq(three.hold_class, "QUALITY_HOLD", "on the quality path");
  eq(three.tell_customer, true, "and the customer is told");
  eq(LOOP_LIMITS.maxRegenerations, 2, "the limit is two");
});

await test("v2 loop: a document that did not materially change stops the loop", () => {
  const d = loopAction([la({ score: 20 }), la({ score: 30, changed_fraction: 0.03 })], newSpend());
  eq(d.action, "refund", "regenerating something near-identical is refused");
  eq(d.event, "gate.no_material_change", "its own event code");
  eq(d.hold_class, "QUALITY_HOLD", "quality path");
  ok(/changed by 3\.0%/.test(d.reason), `the reason quotes the measurement: ${d.reason}`);
  const okd = loopAction([la({ score: 20 }), la({ score: 30, changed_fraction: MIN_MATERIAL_CHANGE })], newSpend());
  eq(okd.action, "regenerate", "exactly at the floor is a change");
});

await test("v2 loop: the score must improve, or it is diverging and stops immediately", () => {
  const lower = loopAction([la({ score: 30 }), la({ score: 24, changed_fraction: 0.5 })], newSpend());
  eq(lower.action, "refund", "attempt two scored lower");
  eq(lower.event, "gate.score_diverged", "its own event code");
  eq(lower.hold_class, "QUALITY_HOLD", "quality path");
  const flat = loopAction([la({ score: 30 }), la({ score: 30, changed_fraction: 0.5 })], newSpend());
  eq(flat.action, "refund", "no improvement is not improvement");
  eq(flat.event, "gate.score_diverged", "same code");
  const better = loopAction([la({ score: 30 }), la({ score: 31, changed_fraction: 0.5 })], newSpend());
  eq(better.action, "regenerate", "improving but still failing may continue while budget remains");
  // improving is not passing
  eq(better.refund, false, "and it does not refund");
});

await test("v2 loop: the dollar cap stops, holds and alerts — and does not refund", () => {
  const spent = { ...newSpend(), usd: LOOP_LIMITS.spendCapUsd };
  const d = loopAction([la()], spent);
  eq(d.action, "hold_alert", "hit it, stop, hold, alert");
  eq(d.event, "gate.spend_cap_reached", "its own event code");
  eq(d.hold_class, "INFRA_HOLD", "a limit we chose is not a verdict on the document");
  eq(d.refund, false, "no automatic refund");
  eq(d.tell_customer, false, "and the customer is not told their proposal failed");
  // FIXTURE CORRECTED. This previously expected "regenerate" one cent under the cap.
  // Patch 2 made the cap RESERVE the next call's cost before spending it, because the
  // attacker showed the cap acted after the spend -- which is how a $149 order quietly
  // eats $40. One cent of headroom cannot fund a call, so reserving correctly holds.
  // The old expectation described the behaviour the patch was written to remove.
  const under = loopAction([la()], { ...newSpend(), usd: LOOP_LIMITS.spendCapUsd - 0.01 });
  eq(under.action, "hold_alert", "a cent of headroom cannot fund a call, so it holds");
  const roomy = loopAction([la()], { ...newSpend(), usd: LOOP_LIMITS.spendCapUsd / 4 });
  eq(roomy.action, "regenerate", "with real headroom the loop still runs");
  ok(DEFAULT_ORDER_SPEND_CAP_USD > 0, "there is a cap at all");
});

await test("v2 loop: an INFRA hold retries, then parks — and never refunds", () => {
  const inf = la({ cause: "cap_exhausted", hold_class: "INFRA_HOLD", score: null });
  const s = newSpend();
  eq(loopAction([inf], s).action, "retry_gate", "first");
  eq(loopAction([inf, inf], s).action, "retry_gate", "second");
  eq(loopAction([inf, inf, inf], s).action, "hold_alert", "third parks with an operator alert");
  for (const n of [1, 2, 3, 4]) {
    const d = loopAction(Array(n).fill(inf), s);
    eq(d.refund, false, `${n} infra holds never refund`);
    eq(d.tell_customer, false, `${n} infra holds never tell the customer`);
    eq(d.hold_class, "INFRA_HOLD", `${n}: class`);
  }
  // and an INFRA hold does not consume the regeneration budget
  const mixed = loopAction([la({ score: 20 }), inf, inf, la({ score: 30, changed_fraction: 0.5 })], s);
  eq(mixed.action, "regenerate", "gate outages do not spend the customer's regenerations");
});

await test("v2 loop: a pass delivers, and there is no loop action for a passing document that holds", () => {
  const d = loopAction([la({ decision: "pass", cause: null, hold_class: null })], newSpend());
  eq(d.action, "deliver", "a pass delivers");
  eq(d.event, "gate.pass", "under its own code");
  let threw = false;
  try { loopAction([], newSpend()); } catch { threw = true; }
  ok(threw, "no attempts is not a decision");
  let threw2 = false;
  try { loopAction([la({ hold_class: null })], newSpend()); } catch { threw2 = true; }
  ok(threw2, "a hold with no class is the conflation this gate exists to prevent, and it throws");
});

// ---------------------------------------------------------------- headroom
await test("v2: cap headroom alerts well before exhaustion, on every key", () => {
  const a = assessHeadroom([reading("judge_primary", 10, 100), reading("judge_fallback", 10, 100, "bb")], ["judge_primary", "judge_fallback"]);
  eq(a.alerts.length, 0, "10% used is quiet");
  eq(a.headroom[0].level, "ok", "ok");

  const warn = assessHeadroom([reading("judge_primary", 76, 100)], ["judge_primary"]);
  eq(warn.headroom[0].level, "warn", "75% warns");
  eq(warn.alerts[0].code, "gate.cap_headroom_warn", "warn code");
  eq(warn.alerts[0].severity, "warn", "severity");
  ok(HEADROOM_WARN < HEADROOM_CRITICAL && HEADROOM_CRITICAL < 1, "warn comes well before critical, which comes before exhaustion");

  const crit = assessHeadroom([reading("judge_primary", 92, 100)], ["judge_primary"]);
  eq(crit.headroom[0].level, "critical", "90% is critical");
  eq(crit.alerts[0].code, "gate.cap_headroom_critical", "critical code");
  eq(crit.alerts[0].severity, "critical", "severity");
  eq(crit.headroom[0].usable, true, "still usable — alerting is not blocking");

  // The real number from reports/referent-ladder.md: $15.76 spent against the
  // key's own $15.76 total cap while the account still held credit.
  const gone = assessHeadroom([reading("judge_primary", 15.76, 15.76)], ["judge_primary"]);
  eq(gone.headroom[0].level, "exhausted", "at the cap is exhausted");
  eq(gone.headroom[0].usable, false, "and unusable");
  eq(gone.alerts[0].code, "gate.cap_exhausted", "exhausted code");

  const unmet = assessHeadroom([reading("judge_primary", 5, null)], ["judge_primary"]);
  eq(unmet.headroom[0].level, "unmetered", "a key with no cap is unmetered, not ok-by-assumption");

  const blind = assessHeadroom([null], ["judge_primary"]);
  eq(blind.headroom[0].level, "unknown", "an unreadable key is unknown");
  eq(blind.alerts[0].code, "gate.cap_headroom_unreadable", "and says so");
  eq(blind.headroom[0].usable, true, "but is not assumed dead");
});

await test("v2: two rungs paid for by one key is not a failover, and it is alerted", async () => {
  const shared = assessHeadroom(
    [reading("judge_primary", 1, 100, "same"), reading("judge_fallback", 1, 100, "same")],
    ["judge_primary", "judge_fallback"],
  );
  ok(shared.alerts.some((a) => a.code === "gate.judge_keys_shared" && a.severity === "critical"), "shared credential is critical");
  const distinct = assessHeadroom(
    [reading("judge_primary", 1, 100, "one"), reading("judge_fallback", 1, 100, "two")],
    ["judge_primary", "judge_fallback"],
  );
  ok(!distinct.alerts.some((a) => a.code === "gate.judge_keys_shared"), "two credentials, no alert");
  const fp = await keyFingerprint("sk-or-v1-secret");
  ok(fp.length === 16 && !fp.includes("secret"), "the fingerprint is a label, not the key");
  eq(fp, await keyFingerprint("sk-or-v1-secret"), "and it is stable");
  ok(fp !== await keyFingerprint("sk-or-v1-other"), "and distinguishes keys");
});

await test("v2: an exhausted rung is skipped before a cent is spent, and two exhausted rungs hold", async () => {
  const rec = jrecorder(() => judgeJson());
  const one = await runDeliveryGate(baseInput(), jdeps(rec, {
    readHeadroom: (slot: string) => Promise.resolve(slot === "judge_primary" ? reading(slot, 20, 20) : reading(slot, 1, 100, "bb")),
  }));
  eq(one.decision, "pass", "the healthy rung answered");
  eq(rec.calls.length, 1, "the exhausted rung was never called");
  eq(rec.calls[0].model, JUDGE_FALLBACK, "the fallback carried it");
  ok(one.headroom.some((h) => h.slot === "judge_primary" && !h.usable), "headroom recorded");

  const rec2 = jrecorder(() => judgeJson());
  const both = await runDeliveryGate(baseInput(), jdeps(rec2, {
    readHeadroom: (slot: string) => Promise.resolve(reading(slot, 20, 20, "k" + slot)),
  }));
  eq(both.decision, "hold", "no rung has headroom");
  eq(both.cause, "cap_exhausted", "cause");
  eq(both.hold_class, "INFRA_HOLD", "INFRA — the customer's document is untouched by our unpaid bill");
  eq(rec2.calls.length, 0, "and nothing was spent finding out");
});

// ---------------------------------------------------------------- cost
await test("v2: cost is recorded from the provider's own accounting, and never guessed", async () => {
  const rec = jrecorder(() => ({ text: judgeJson(), usd: 0.0123, generation_id: "gen-1" }));
  const out = await runDeliveryGate(baseInput(), jdeps(rec));
  eq(out.spend.calls, 1, "one call");
  ok(Math.abs(out.spend.usd - 0.0123) < 1e-9, "the provider's number, unmodified");
  eq(out.spend.unmeasured_calls, 0, "measured");
  eq(out.spend.by_model[JUDGE_PRIMARY].calls, 1, "attributed to the model that spent it");

  // A reply with no cost is UNMEASURED, never zero: a cap with holes must know
  // it has holes.
  const rec2 = jrecorder(() => ({ text: judgeJson(), usd: null }));
  const out2 = await runDeliveryGate(baseInput(), jdeps(rec2));
  eq(out2.spend.usd, 0, "nothing measured");
  eq(out2.spend.unmeasured_calls, 1, "and the hole is counted");

  const s = newSpend();
  addSpend(s, "m", 1); addSpend(s, "m", null); addSpend(s, "n", 2);
  eq(s.calls, 3, "three calls");
  eq(s.usd, 3, "three dollars measured");
  eq(s.unmeasured_calls, 1, "one unmeasured");
  eq(s.by_model["m"].calls, 2, "per model");
});

await test("v2: the per-order dollar cap is checked before the call, not after", async () => {
  const rec = jrecorder(() => judgeJson());
  const out = await runDeliveryGate(baseInput(), jdeps(rec, { spend: { ...newSpend(), usd: 99 }, spendCapUsd: 6 }));
  eq(out.decision, "hold", "held");
  eq(out.cause, "spend_cap_reached", "cause");
  eq(out.hold_class, "INFRA_HOLD", "class");
  eq(rec.calls.length, 0, "a cap you only notice after paying is not a cap");
  ok(out.alerts.some((a) => a.code === "gate.spend_cap_reached" && a.severity === "critical"), "and it alerts");
});

// ---------------------------------------------------------------- re-judge, v2
await test("v2: a stored verdict is replayed, and a v1 verdict can never be replayed as a v2 one", async () => {
  const input = baseInput();
  const rec = jrecorder(() => failingJudgeJson());
  const first = await runDeliveryGate(input, jdeps(rec));
  eq(first.decision, "hold", "held");
  eq(first.gate_version, JUDGE_GATE_VERSION, "under v2");

  const store = new Map<string, JudgeOutcome>([[first.doc_hash, first]]);
  const rec2 = jrecorder(() => judgeJson());
  const second = await runDeliveryGate(input, jdeps(rec2, {
    storedVerdict: (h: string) => Promise.resolve(store.get(h) as unknown as GateOutcome ?? null),
  }));
  eq(rec2.calls.length, 0, "no model was called on a re-judge");
  eq(second.from_record, true, "replayed");
  eq(second.decision, "hold", "verbatim");
  eq(second.hold_class, "QUALITY_HOLD", "class preserved");

  const v1hash = await documentHash(NARRATIVE_GOOD);
  const v2hash = await documentHash(NARRATIVE_GOOD, JUDGE_GATE_VERSION);
  ok(v1hash !== v2hash, "a verdict reached under the v1 bar is not a verdict under the v2 bar");
  eq(first.doc_hash, v2hash, "and v2 hashes under v2");
});

// ---------------------------------------------------------------- events
await test("v2: everything lands in the append-only events table, under codes that separate the two holds", async () => {
  const q = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => failingJudgeJson())));
  const qd = loopAction([{ doc_hash: q.doc_hash, decision: q.decision, cause: q.cause, hold_class: q.hold_class, score: q.score, changed_fraction: null }], q.spend);
  const qrows = gateEvents(q, { proposalId: "p1", attempt: 1, decision: qd });
  eq(qrows[0].action, "gate.quality_hold", "a quality hold is a quality event");
  eq(qrows[0].entity, "order_proposal", "entity");
  eq((qrows[0].detail as Record<string, unknown>).refund, true, "the row records the refund decision");
  eq((qrows[0].detail as Record<string, unknown>).customer_told, true, "and that the customer is told");

  const i = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => { throw new Error("Key limit exceeded"); })));
  const irows = gateEvents(i, { proposalId: "p1", attempt: 1 });
  eq(irows[0].action, "gate.infra_hold", "an infra hold is an infra event");
  eq((irows[0].detail as Record<string, unknown>).refund, false, "no refund");
  eq((irows[0].detail as Record<string, unknown>).customer_told, false, "customer never told");
  ok(irows.some((r) => r.action === "gate.cap_exhausted"), "the cap alert has its own row");

  const p = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson())));
  const prows = gateEvents(p, { proposalId: "p1", attempt: 1 });
  eq(prows[0].action, "gate.pass", "a pass is a pass");

  const actions = new Set([...qrows, ...irows, ...prows].map((r) => r.action));
  ok(!(actions.has("gate.quality_hold") && qrows.some((r) => r.action === "gate.infra_hold")), "one outcome never emits both hold codes");
  const all = JSON.stringify([...qrows, ...irows, ...prows]);
  ok(!all.includes("## The problem as it stands"), "no document in the events table");
  ok(!all.includes("You are an experienced grant assessor"), "no prompt in the events table");
  ok(!all.includes("sk-or"), "no key in the events table");
});

await test("v2: the operator alert goes to the operator and says the customer was not told", async () => {
  const i = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => { throw new Error("Key limit exceeded"); })));
  const a = operatorAlert(i, { orderNo: "KT-10007", orgName: "Mashghal Community Association", proposalId: "p1" });
  ok(a.subject.includes("INFRA_HOLD"), "the class is in the subject line");
  ok(a.subject.includes("KT-10007"), "and the order");
  ok(/has NOT been contacted and has NOT been refunded/.test(a.html), "and it states plainly that the customer is untouched");
  ok(!a.html.includes("## The problem as it stands"), "it does not carry the document");
});

// ---------------------------------------------------------------- report
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} of ${checks} checks failed:\n`);
  for (const f of failures) console.error("  - " + f);
  Deno.exit(1);
}
console.log(`ok — ${checks} checks passed`);
