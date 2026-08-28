// Adversarial round 2 — INVARIANT 1: nothing unfundable is ever delivered.
//
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_delivery_gate_test.ts
//
// The unit suite (tests/delivery-gate/) proves the gate does what it says on
// benign and simple-malicious inputs. This file is the attacker: it tries to
// PASS an unfundable document, to REPLAY a pass it did not earn, to slip past
// the deliver-stage hash refusal, and to get the generator's own family to
// judge. Every model call is a fake injected through GateDeps — so a green here
// is not a model being strict, it is the MECHANISM holding. A red here is a
// delivery of something that was never affirmatively cleared.
//
// OUTCOME OF THIS ROUND: CONCEDED on INVARIANT 1 — no deterministic, attacker-
// controlled path was found that delivers an unfundable document. Probes 1-12
// are the attacks that FAILED to break the gate (the defenses that held). Probe
// 13 pins the one genuine LATENT DEFECT found — the re-judge rule's blank-line
// robustness claim (delivery_gate.ts:218-220) is false at the 0<->1 blank-line
// boundary — as a CHARACTERIZATION of current behaviour, with the reasons its
// reach to delivery is unproven set out in
// reports/adversarial/invariant-1-delivery-gate.md.
//
// No network, no permissions beyond --allow-read, no imports outside the module.

import {
  DIMENSIONS, CRITIC_DISQUALIFIERS,
  documentHash, normaliseDocument,
  modelFamily, judgeLadder, judgeSchema,
  runDeliveryGate, runGateLoop, loopAction, verdictFromRecord, loopAttemptFromRecord,
  JUDGE_GATE_VERSION, GATE_VERSION, JUDGE_PRIMARY, JUDGE_FALLBACK,
} from "../../supabase/functions/worker/delivery_gate.ts";
import type {
  CriticRequest, GateDeps, GateInput, GateOutcome, JudgeReply, JudgeOutcome, LoopAttempt,
} from "../../supabase/functions/worker/delivery_gate.ts";

// ---------------------------------------------------------------- harness
let checks = 0;
const failures: string[] = [];
let current = "";
function ok(cond: unknown, label: string) { checks++; if (!cond) failures.push(`${current}: ${label}`); }
function eq(a: unknown, b: unknown, label: string) {
  checks++;
  if (a !== b) failures.push(`${current}: ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function test(name: string, fn: () => void | Promise<void>) {
  current = name;
  try { await fn(); } catch (e) { failures.push(`${name}: threw ${String(e).slice(0, 300)}`); }
}

// ---------------------------------------------------------------- fixtures
const GENERATOR = "anthropic/claude-opus-5";
const LEDGER = [
  { id: "E-INTAKE-1", claim: "The applicant runs a youth centre in Bab al-Tabbaneh." },
  { id: "E-WEB-1", claim: "Delivered a literacy programme with the Municipality of Tripoli in 2024." },
  { id: "E-WEB-2", claim: "Works alongside Safadi Foundation on referrals." },
  { id: "E-PROP-1", claim: "Ran evening classes in Qobbe reaching 180 young people." },
];
// A long, evidence-using narrative that clears the 250-word preflight floor and
// the D4 specificity check — so preflight is never the thing doing the holding
// in the tests below; the JUDGE has to be. Blank lines separate its sections
// (so it is not degenerate against the whitespace probes).
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
function scoresAt(over: Record<string, number> = {}): Record<string, number> {
  const s: Record<string, number> = {};
  for (const d of DIMENSIONS) s[d.key] = d.weighted ? 4 : 3;
  return { ...s, ...over };
}
function dqAllFalse(over: Record<string, boolean> = {}): Record<string, boolean> {
  const d: Record<string, boolean> = {};
  for (const q of CRITIC_DISQUALIFIERS) d[q.key] = false;
  return { ...d, ...over };
}
function judgeJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    scores: scoresAt(), disqualifiers: dqAllFalse(), verdict: "clears_bar",
    reasons: ["The delivery route is named and the partner relationship predates the grant."],
    weakest_thing: "The budget justification for the apprenticeship wage subsidy is thin.",
    fix_instructions: ["Show how the wage subsidy tapers."],
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
// A verdict store keyed exactly the way the production DB is (proposal + doc_hash);
// here proposal is fixed so the key is the hash. Mirrors gate_verdict_for.
function makeStore() {
  const store = new Map<string, JudgeOutcome>();
  return {
    record: (o: JudgeOutcome) => { if (o.sticky) store.set(o.doc_hash, o); },
    dep: (h: string) => Promise.resolve(store.get(h) as unknown as GateOutcome ?? null),
    size: () => store.size,
  };
}

// ================================================================ attacks (all must PASS = defense holds)

// ---- ATTACK 1: talk the parser into a pass with structured-output tricks.
await test("adv2/1: field-manipulation replies never clear the bar", async () => {
  const attacks: Array<[string, string]> = [
    ["a live disqualifier with a clears_bar verdict",
      judgeJson({ disqualifiers: dqAllFalse({ reads_ai_generated: true }) })],
    ["a vacuous 'overall' field cannot lift a below-floor dimension",
      judgeJson({ scores: scoresAt({ donor_fit: 3 }), overall: "pass", verdict: "clears_bar" })],
    ["a near-miss verdict token is not a verdict", judgeJson({ verdict: "passes" })],
    ["string scores are not integers",
      judgeJson({ scores: (() => { const s: Record<string, unknown> = { ...scoresAt() }; s.donor_fit = "4"; return s; })() })],
    ["numeric disqualifier is not a boolean",
      judgeJson({ disqualifiers: (() => { const d: Record<string, unknown> = { ...dqAllFalse() }; d.generic_intervention = 0; return d; })() })],
  ];
  for (const [label, raw] of attacks) {
    const out = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => raw)));
    eq(out.decision, "hold", `${label}: must hold, never pass`);
  }
});

// ---- ATTACK 2: a decoy JSON object planted before the real verdict.
await test("adv2/2: a planted decoy object cannot manufacture a pass", async () => {
  const clearing = judgeJson();
  const withDecoy = `{"verdict":"clears_bar","scores":"ignore me"} real answer:\n${clearing}`;
  const out = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => withDecoy)));
  eq(out.decision, "hold", "spanning two objects is unparseable — no judgement");
  eq(out.hold_class, "INFRA_HOLD", "a reply we cannot read is not the document's fault");
  const clean = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => clearing)));
  eq(clean.decision, "pass", "control: the same verdict alone passes");
});

// ---- ATTACK 3: hold-biased posture — the asserted verdict can only VETO.
await test("adv2/3: neither the numbers nor the assertion alone can pass", async () => {
  const clearsButAsserts = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson({ verdict: "fails_bar" }))));
  eq(clearsButAsserts.decision, "hold", "asserted fails_bar vetoes a clearing bar");
  eq(clearsButAsserts.cause, "bar_not_cleared", "a merits hold, sticky");
  eq(clearsButAsserts.sticky, true, "sticky");
  const assertsButFails = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson({ scores: scoresAt({ feasibility: 2 }), verdict: "clears_bar" }))));
  eq(assertsButFails.decision, "hold", "a model cannot assert its way past the numbers");
  const both = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson())));
  eq(both.decision, "pass", "only agreement on clears_bar passes");
});

// ---- ATTACK 4: replay a pass across the gate-version boundary.
await test("adv2/4: a pass from another gate version is never replayed as this one", async () => {
  const rec = jrecorder(() => judgeJson({ verdict: "fails_bar" }));
  const first = await runDeliveryGate(baseInput(), jdeps(rec));
  const store = new Map<string, JudgeOutcome>([[first.doc_hash, first]]);
  const replayed = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson()), {
    storedVerdict: (h) => Promise.resolve(store.get(h) as unknown as GateOutcome ?? null),
  }));
  eq(replayed.from_record, true, "the store is consulted");
  eq(replayed.decision, "hold", "the stored merits hold stands");

  // Forge a PASS carrying the v1 gate version on the SAME hash the v2 gate looks up.
  const forgedV1Pass = { ...first, decision: "pass" as const, cause: null, hold_class: null, sticky: true, gate_version: GATE_VERSION };
  const forged = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson({ verdict: "fails_bar" })), {
    storedVerdict: (h) => Promise.resolve(h === first.doc_hash ? (forgedV1Pass as unknown as GateOutcome) : null),
  }));
  eq(forged.decision, "hold", "a v1-version pass is not a verdict against the v2 bar");
  ok(forged.from_record === false, "it was NOT honoured as a stored verdict");
  ok(forged.alerts.some((a) => a.code === "gate.stored_verdict_stale"), "and it is alerted, not silently dropped");

  // The deliver-guard shape check (index.ts:2785): verdictFromRecord surfaces
  // the stored gate_version verbatim so a v1 row is rejected there too.
  const v1Row = { decision: "pass", cause: null, sticky: true, gate_version: GATE_VERSION, doc_hash: first.doc_hash, critics: [], findings: [], preflight: [] };
  const bridged = verdictFromRecord(v1Row);
  ok(bridged !== null, "the row parses");
  ok(bridged!.gate_version !== JUDGE_GATE_VERSION, "and its version is not v2, so the deliver guard throws");
});

// ---- ATTACK 5: TRUE whitespace-only edits to a held doc replay the hold with
// no fresh roll. Trailing spaces, CRLF, leading/trailing space, and blank-line
// runs of TWO OR MORE all normalise away (delivery_gate.ts:221-230).
await test("adv2/5: true whitespace on a held doc replays the hold; no fresh roll", async () => {
  const s = makeStore();
  const held = await runDeliveryGate(baseInput(), jdeps(jrecorder(() => judgeJson({ verdict: "fails_bar" }))));
  s.record(held);
  eq(held.decision, "hold", "held on the merits");

  // Whitespace the normaliser DOES collapse: trailing tabs/spaces, CRLF, an
  // extra blank line where a blank line already exists (2 blanks -> collapses),
  // and surrounding whitespace.
  const reflowed = "\n\n  " + NARRATIVE_GOOD
    .replace(/\n\n/g, "\n\n\n\n")          // 1 blank line -> 3 blank lines (both >=1 -> collapse to 1)
    .replace(/\n/g, "\t\r\n")               // trailing tab + CRLF on every line
    + "   \n";
  ok(reflowed !== NARRATIVE_GOOD, "the bytes differ");
  eq(await documentHash(reflowed, JUDGE_GATE_VERSION), held.doc_hash, "but the normalised hash is identical");

  const generous = jrecorder(() => judgeJson()); // waiting to pass if asked
  const reroll = await runDeliveryGate(baseInput({ narrative: reflowed }), jdeps(generous, { storedVerdict: s.dep }));
  eq(generous.calls.length, 0, "no fresh roll: the generous judge is never consulted");
  eq(reroll.from_record, true, "the held verdict is replayed");
  eq(reroll.decision, "hold", "a true-whitespace edit cannot launder a held document into a pass");

  // A one-word content change DOES earn a fresh judgement (the defense is not
  // simply 'never re-roll').
  const oneWord = NARRATIVE_GOOD.replace("two tracks", "three tracks");
  ok(await documentHash(oneWord, JUDGE_GATE_VERSION) !== held.doc_hash, "a content change is a different document");
  const fresh = await runDeliveryGate(baseInput({ narrative: oneWord }), jdeps(jrecorder(() => judgeJson()), { storedVerdict: s.dep }));
  eq(fresh.from_record, false, "and it is judged afresh");
  eq(fresh.decision, "pass", "control: a genuinely different document can be judged");
});

// ---- ATTACK 6: preflight is upstream of the judge — a poisoned document a
// generous judge would clear must still be held by preflight, spending nothing.
await test("adv2/6: preflight holds before a generous judge is ever asked", async () => {
  const cases: Array<[string, string]> = [
    ["placeholder text left in", NARRATIVE_GOOD + "\n\n[TODO] finish the budget section."],
    ["a stub too short to be a proposal", "## Plan\nWe will help the community with various activities and outcomes."],
  ];
  for (const [label, narrative] of cases) {
    const rec = jrecorder(() => judgeJson());
    const out = await runDeliveryGate(baseInput({ narrative }), jdeps(rec));
    eq(out.decision, "hold", `${label}: preflight holds`);
    eq(out.cause, "preflight_failed", `${label}: on preflight`);
    eq(rec.calls.length, 0, `${label}: and no generous judge was consulted`);
  }
});

// ---- ATTACK 7: get the generator's own family to judge, however it is spelled.
await test("adv2/7: the generator's family can never end up judging, however spelled", () => {
  const genForms = ["google/gemini-3.7-flash", "  GOOGLE/Gemini-3.7-Flash  ", "Google/anything", "google"];
  for (const g of genForms) {
    const l = judgeLadder(g);
    ok(!l.rungs.some((r) => modelFamily(r.model) === "google"), `generator "${g}": no google rung survives`);
    ok(l.error !== null || l.rungs.length >= 1, `generator "${g}": a legal ladder or a clean misconfig`);
  }
  const zl = judgeLadder("z-ai/glm-5.3-flash");
  ok(!zl.rungs.some((r) => modelFamily(r.model) === "z-ai"), "a z-ai generator drops the z-ai judge");
  const empty = judgeLadder("anthropic/claude-opus-5", ["anthropic/a", "anthropic/b"]);
  eq(empty.rungs.length, 0, "both in-family -> no usable rung");
  ok(empty.error !== null, "which is a misconfiguration, held, never a pass");
});

// ---- ATTACK 8: family rule, end to end through runDeliveryGate.
await test("adv2/8: a same-family judge that would pass is dropped, not consulted", async () => {
  const rec = jrecorder(() => judgeJson());
  const out = await runDeliveryGate(baseInput({ criticModels: ["anthropic/x", "anthropic/y"] }), jdeps(rec));
  eq(out.decision, "hold", "held");
  eq(out.cause, "judge_misconfigured", "as a misconfiguration");
  eq(out.hold_class, "INFRA_HOLD", "our fault, not the document's");
  eq(rec.calls.length, 0, "the generator's family is never handed the document");
});

// ---- ATTACK 9: drive the whole loop; it delivers only on a genuine pass.
await test("adv2/9: the loop delivers only on a pass; a persistent failure refunds", async () => {
  const s = makeStore();
  const deps = jdeps(jrecorder(() => judgeJson({ scores: scoresAt({ specificity: 2 }), verdict: "fails_bar" })), { storedVerdict: s.dep });
  let regenSeq = 0;
  const res = await runGateLoop(baseInput(), deps, {
    regenerate: (_brief, _prev) => Promise.resolve(NARRATIVE_GOOD.replace("two tracks", `variant ${++regenSeq} tracks with distinct wording ${"x ".repeat(40)}`)),
    record: (o) => { s.record(o); return Promise.resolve(); },
  });
  eq(res.decision.action, "refund", "a document that cannot clear is refunded, never delivered");
  eq(res.decision.hold_class, "QUALITY_HOLD", "on the quality path");
  const holdAttempt: LoopAttempt = { doc_hash: "h", decision: "hold", cause: "bar_not_cleared", hold_class: "QUALITY_HOLD", score: 10, changed_fraction: 0.5 };
  ok(loopAction([holdAttempt], res.spend).action !== "deliver", "loopAction never delivers off a hold");
});

// ---- ATTACK 10: a from_record PASS whose recorded gate_version is wrong seeds
// nothing and is never honoured.
await test("adv2/10: loopAttemptFromRecord refuses a stale-version pass row", () => {
  const passRowV1 = { decision: "pass", cause: null, sticky: true, gate_version: GATE_VERSION, doc_hash: "a".repeat(64), critics: [], findings: [], preflight: [] };
  eq(loopAttemptFromRecord(passRowV1), null, "a v1 pass row seeds nothing in the v2 loop");
  const passRowV2 = { decision: "pass", cause: null, sticky: true, gate_version: JUDGE_GATE_VERSION, doc_hash: "b".repeat(64), critics: [], findings: [], preflight: [] };
  const seeded = loopAttemptFromRecord(passRowV2);
  ok(seeded !== null && seeded.decision === "pass", "a v2 pass row is a real prior attempt");
});

// ---- ATTACK 11: normalisation cannot merge two SEMANTICALLY different documents
// into one hash. Case, punctuation, digits and words are all content.
await test("adv2/11: only whitespace collapses under the hash — never content", async () => {
  const base = NARRATIVE_GOOD;
  const wsVariant = base.split("\n").map((l) => l + "  ").join("\r\n"); // trailing spaces + CRLF only
  const contentVariant = base.replace("180 young people", "18 young people"); // one digit
  eq(await documentHash(wsVariant, JUDGE_GATE_VERSION), await documentHash(base, JUDGE_GATE_VERSION), "true whitespace collapses");
  ok(await documentHash(contentVariant, JUDGE_GATE_VERSION) !== await documentHash(base, JUDGE_GATE_VERSION), "a single changed digit is a different document");
  ok(normaliseDocument("The Cat.") !== normaliseDocument("the cat"), "case and punctuation survive normalisation");
});

// ---- ATTACK 12: the wired judges are the phase-3 primary/fallback, two families.
await test("adv2/12: the wired judges are the phase-3 primary/fallback, on two families", () => {
  eq(JUDGE_PRIMARY, "google/gemini-3.7-flash", "primary is the validated judge");
  eq(JUDGE_FALLBACK, "z-ai/glm-5.3-flash", "fallback is a different provider");
  ok(modelFamily(JUDGE_PRIMARY) !== modelFamily(JUDGE_FALLBACK), "two families, or the failover is illusory");
  const s = judgeSchema();
  const req = (s.json_schema.schema as { required: string[] }).required;
  for (const k of ["scores", "disqualifiers", "verdict", "reasons"]) ok(req.includes(k), `${k} stays required`);
});

// ---- 13: the latent re-judge defect, NOW CLOSED (see the report, "Strongest attempt").
// The re-judge comment (delivery_gate.ts) says a regeneration that "only reflows
// blank lines has not changed the document and must not earn a fresh roll of the
// dice." The earlier normaliseDocument collapsed only runs of >=3 newlines (to
// two), leaving the 0<->1 blank-line boundary open: toggling a single line-break
// to a paragraph-break (1 newline <-> 2) changed the hash, so the held verdict
// was NOT replayed and the judge rolled again. The inv1 hardening collapses EVERY
// run of newlines to one, so blank-line reflow is hash-invariant at every
// boundary. This test — which the CHARACTERIZATION version explicitly said a fix
// would "visibly flip" — now asserts the CLOSED behaviour.
await test("adv2/13: the 0<->1 blank-line boundary is hash-invariant (latent defect CLOSED)", async () => {
  const zeroBlank = "line one\nline two\nline three";        // 0 blank lines
  const oneBlank = "line one\n\nline two\n\nline three";     // 1 blank line
  const twoBlank = "line one\n\n\nline two\n\n\nline three"; // 2 blank lines
  const hz = await documentHash(zeroBlank, JUDGE_GATE_VERSION);
  const h1 = await documentHash(oneBlank, JUDGE_GATE_VERSION);
  const h2 = await documentHash(twoBlank, JUDGE_GATE_VERSION);
  // >=1 blank-line reflows were already hash-stable.
  eq(h1, h2, "1 blank line and 2 blank lines share a hash");
  // FIXED: 0 blanks and 1 blank now share a hash too, so a semantically-equal
  // document no longer earns a fresh, independent roll of the judge.
  eq(hz, h1, "0-blank and 1-blank reflow now share a hash — blank-line reflow is fully hash-invariant");

  // End-to-end: a HELD document, re-presented with a single blank-line delta,
  // now hits the sticky replay instead of being judged afresh.
  const s = makeStore();
  const heldInput = baseInput({ narrative: oneBlank + "\n\n" + NARRATIVE_GOOD }); // long enough for preflight
  const held = await runDeliveryGate(heldInput, jdeps(jrecorder(() => judgeJson({ verdict: "fails_bar" }))));
  s.record(held);
  eq(held.decision, "hold", "held on the merits, sticky");
  const semanticallyEqual = zeroBlank + "\n\n" + NARRATIVE_GOOD; // same content, one fewer blank line up top
  eq(await documentHash(semanticallyEqual, JUDGE_GATE_VERSION), held.doc_hash, "the reflowed twin has the SAME hash");
  const generous = jrecorder(() => judgeJson());
  const twin = await runDeliveryGate(baseInput({ narrative: semanticallyEqual }), jdeps(generous, { storedVerdict: s.dep }));
  eq(twin.from_record, true, "the held verdict IS replayed for the reflowed twin (no fresh roll)");
  eq(generous.calls.length, 0, "the judge is NOT rolled again on a semantically-unchanged document");
  // The replayed verdict is the original hold — a generous fresh judge can no
  // longer flip a held document to a pass by reflowing one blank line.
  eq(twin.decision, "hold", "the replayed verdict is the original hold, not a fresh pass");
});

// ---------------------------------------------------------------- report
if (failures.length) {
  console.error(`\nADV2 FAIL — ${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.error("  ✗ " + f);
  console.error("\nA red above is a delivery of something never affirmatively cleared. See reports/adversarial/invariant-1-delivery-gate.md.");
  Deno.exit(1);
}
console.log(`ok — ${checks} adversarial checks passed (INVARIANT 1 mechanism held; probe 13's latent re-judge defect CLOSED by the normaliseDocument hardening)`);
