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
} from "../../supabase/functions/worker/delivery_gate.ts";
import type {
  CriticRequest, GateDeps, GateInput, GateOutcome, Judgement,
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

// ---------------------------------------------------------------- report
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} of ${checks} checks failed:\n`);
  for (const f of failures) console.error("  - " + f);
  Deno.exit(1);
}
console.log(`ok — ${checks} checks passed`);
