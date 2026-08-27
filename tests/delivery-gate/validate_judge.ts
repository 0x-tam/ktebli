// Validate the delivery gate's judge against verdicts the expensive critics
// already gave.
//
//   OPENROUTER_API_KEY=... npx --yes deno@2.9.5 run \
//     --allow-net=openrouter.ai --allow-read --allow-env \
//     tests/delivery-gate/validate_judge.ts
//
//   --models=z-ai/glm-5.3-flash,google/gemini-3.7-flash   candidates to test
//   --instrument=neutral|primed|both                       which critic prompt
//   --corpus=/path/to/qloop                                where out-*.md live
//   --dry-run                                              build every request,
//                                                          call nothing, print
//                                                          the plan and the
//                                                          ground truth
//
// ---------------------------------------------------------------------------
// THIS HAS NOT BEEN RUN. The OpenRouter key in this project is refused with
// HTTP 403 "Key limit exceeded (total limit)" on every call, including a
// 16-token liveness probe (reports/referent-ladder.md). There is therefore NO
// agreement rate for any candidate judge, and none is guessed anywhere in this
// repository. When the cap is raised, run this. Until then the number is
// MISSING and must be reported as MISSING.
// ---------------------------------------------------------------------------
//
// WHAT IT MEASURES, AND THE TWO THINGS IT CANNOT
//
// Ground truth is the per-document `fundable as submitted: yes|no` recorded by
// critic_a (openai/gpt-5.6-sol) and critic_b (x-ai/grok-4.6) in the iteration-1
// blind round, de-blinded through the same mapping files that round used. A
// candidate judge "agrees" when the bar computed from its structured reply
// (applyBar, unchanged) matches that verdict.
//
//   1. THE CORPUS CANNOT VALIDATE A PASS. Sixteen judgements: fifteen "no" and
//      one "yes", and that single yes is DISPUTED — critic_b funded
//      evidence-poor/B and critic_a did not. So of eight documents, seven carry
//      an agreed verdict and all seven are "not fundable". A judge that refuses
//      every document scores 100% agreement on this corpus while being
//      completely useless.
//
//      What this harness CAN establish is the direction that matters for
//      invariant 1: a candidate judge that PASSES any of those seven is passing
//      a document two frontier critics agreed was not fundable, and that is a
//      disqualifying result no matter what its headline rate says. It cannot
//      establish that a judge recognises a good document, because there is no
//      agreed good document to recognise. Getting that requires a corpus with
//      fundable documents in it, and there is not one.
//
//      The ALWAYS-HOLD BASELINE is printed next to every rate for this reason,
//      and a rate at or below it is reported as NO SIGNAL. Do not quote the
//      agreement rate without the baseline beside it.
//   2. The expensive critics were run at reasoning_effort low, on a replayed
//      pipeline, on two cases. They are the best available reference, not
//      ground truth about fundability. Agreement with them is agreement with
//      them.
//
// It also answers the open question from reports/quality-iteration-1.md §3
// (CORRECTED): the v1 critic prompt supplied the "reads machine-generated"
// vocabulary and the critics returned it; the v2 prompt withholds it.
// --instrument=both judges every document under both prompts with the same
// model, seed and temperature, so the difference is the prompt and nothing else.

import {
  DIMENSIONS, CRITIC_DISQUALIFIERS,
  JUDGE_PRIMARY, JUDGE_FALLBACK, JUDGE_SEED, JUDGE_TEMPERATURE, JUDGE_EFFORT,
  JUDGE_SLOTS, applyBar, buildCriticPrompt, buildJudgePrompt, buildJudgeRequest,
  judgeView, parseJudgeReply, parseJudgement, gateScore, classifyProviderError,
} from "../../supabase/functions/worker/delivery_gate.ts";
import type { GateInput, CriticRequest } from "../../supabase/functions/worker/delivery_gate.ts";

// ---------------------------------------------------------------- args
function arg(name: string, fallback: string): string {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const DRY = Deno.args.includes("--dry-run");
const CORPUS = arg("corpus", "/tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/qloop");
const MODELS = arg("models", [JUDGE_PRIMARY, JUDGE_FALLBACK].join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const INSTRUMENT = arg("instrument", "neutral");
const INSTRUMENTS: Array<"neutral" | "primed"> =
  INSTRUMENT === "both" ? ["neutral", "primed"] : [INSTRUMENT === "primed" ? "primed" : "neutral"];

// ---------------------------------------------------------------- ground truth
type Verdict = "fundable" | "not_fundable";

interface DocRef {
  case_id: string;
  variant: string;          // A | B | C | D
  path: string;             // out-<case>-<variant>.md
  critics: Record<string, Verdict>;
  consensus: Verdict | "disputed";
}

// critic_a writes "### Doc 1"; critic_b writes "Doc 1" — except for its first
// document, which it writes as "3. Doc 1", carrying the section number of the
// per-document assessments. An earlier version of this parser did not allow the
// section number and silently dropped two of the sixteen verdicts, one of which
// was the ONLY "fundable: yes" in the corpus. A parser that quietly loses the
// single positive case would have made every candidate judge look better than
// it is. Both forms are accepted, and loadGroundTruth() prints what it found
// per document so the loss is visible if it happens again.
//
// "Doc 1: absence of proper nouns..." in the later reject-list and arithmetic
// sections also matches this heading shape. That is harmless: only the FIRST
// "fundable as submitted" line seen for a document is taken, and those later
// sections carry none.
function verdictsByDoc(md: string): Record<string, Verdict> {
  const out: Record<string, Verdict> = {};
  const lines = md.split("\n");
  let current: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const head = line.match(/^(?:#{0,4}\s*)?(?:\d+\.\s*)?\**Doc\s+(\d)\b/i);
    if (head) { current = `Doc ${head[1]}`; continue; }
    const v = line.match(/^[-*]?\s*fundable as submitted\s*:\s*(yes|no)\b/i);
    if (v && current && !(current in out)) {
      out[current] = v[1].toLowerCase() === "yes" ? "fundable" : "not_fundable";
    }
  }
  return out;
}

function loadGroundTruth(): DocRef[] {
  const cases = ["ukyouth", "evidence-poor"];
  const criticFiles: Record<string, string> = { critic_a: "critic_a", critic_b: "critic_b" };
  const docs: DocRef[] = [];

  for (const c of cases) {
    const mapping = JSON.parse(Deno.readTextFileSync(`${CORPUS}/mapping-${c}.json`)) as Record<string, string>;
    const perDoc: Record<string, Record<string, Verdict>> = {};
    for (const [label, file] of Object.entries(criticFiles)) {
      const path = `${CORPUS}/critic-${c}-${file}.md`;
      let md: string;
      try { md = Deno.readTextFileSync(path); }
      catch { console.error(`missing critic file ${path}; that critic's verdicts are absent, not assumed`); continue; }
      for (const [doc, v] of Object.entries(verdictsByDoc(md))) {
        perDoc[doc] = { ...(perDoc[doc] ?? {}), [label]: v };
      }
    }
    for (const [doc, variant] of Object.entries(mapping)) {
      const critics = perDoc[doc] ?? {};
      const vals = Object.values(critics);
      if (!vals.length) { console.error(`no verdict recorded for ${c} ${doc}; skipped, never defaulted`); continue; }
      const consensus: Verdict | "disputed" =
        vals.every((v) => v === "fundable") ? "fundable"
        : vals.every((v) => v === "not_fundable") ? "not_fundable"
        : "disputed";
      docs.push({ case_id: c, variant, path: `${CORPUS}/out-${c}-${variant}.md`, critics, consensus });
    }
  }
  return docs.sort((a, b) => (a.case_id + a.variant).localeCompare(b.case_id + b.variant));
}

// ---------------------------------------------------------------- the input
function gateInputFor(doc: DocRef): GateInput {
  const c = JSON.parse(Deno.readTextFileSync(`${CORPUS}/case-${doc.case_id}.json`)) as {
    grant: Record<string, unknown>;
    organisation: Record<string, unknown>;
    evidence_ledger: Array<Record<string, unknown>>;
  };
  const g = c.grant, o = c.organisation;
  const grantText = [
    `${String(g.funder)} — ${String(g.programme)}`,
    String(g.full_guidelines_text ?? ""),
    Array.isArray(g.required_sections) ? `Required sections: ${(g.required_sections as string[]).join("; ")}` : "",
    g.published_criteria ? `Published criteria: ${JSON.stringify(g.published_criteria)}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    narrative: Deno.readTextFileSync(doc.path),
    applicantName: String(o.legal_name ?? ""),
    applicantLine: `${String(o.legal_name ?? "")} · ${String(o.website ?? "")}`,
    grantText,
    fmt: { maxWords: typeof g.word_limit === "number" ? g.word_limit : null },
    // The ledger is here only because GateInput carries it; the judge never sees
    // it and preflight is not run by this script — the question is whether the
    // MODEL agrees with the critics, not whether the deterministic layer does.
    evidence: (c.evidence_ledger ?? []).map((e) => ({ id: e.id, claim: e.fact ?? e.claim })),
    generatorModel: "",
  };
}

// ---------------------------------------------------------------- the call
const KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

class CapExhausted extends Error {}

interface Reply { text: string; usd: number | null }

async function call(req: CriticRequest): Promise<Reply> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    temperature: req.temperature ?? JUDGE_TEMPERATURE,
    seed: req.seed ?? JUDGE_SEED,
    reasoning: { effort: req.effort },
    usage: { include: true },
    messages: [{ role: "user", content: req.prompt }],
  };
  if (req.responseFormat) body.response_format = req.responseFormat;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "HTTP-Referer": "https://ktebli.com", "X-Title": "Ktebli judge validation" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    // The whole point of failing loudly here: a partial run over a capped key
    // would produce an agreement rate computed from whichever calls happened to
    // land, and that number would be worse than no number.
    const err = `HTTP ${r.status} ${text.slice(0, 300)}`;
    if (classifyProviderError(err) === "cap") throw new CapExhausted(err);
    throw new Error(err);
  }
  const j = JSON.parse(text);
  return {
    text: j.choices?.[0]?.message?.content ?? "",
    usd: typeof j.usage?.cost === "number" ? j.usage.cost : null,
  };
}

// ---------------------------------------------------------------- one judgement
interface Row {
  model: string;
  instrument: string;
  doc: string;
  truth: Verdict | "disputed";
  gate: Verdict | "no_judgement";
  score: number | null;
  failures: string[];
  usd: number | null;
  error: string | null;
}

async function judgeOne(doc: DocRef, model: string, instrument: "neutral" | "primed"): Promise<Row> {
  const input = gateInputFor(doc);
  const base = buildJudgeRequest(judgeView(input), { ...JUDGE_SLOTS[0], model });
  const req: CriticRequest = instrument === "neutral"
    ? base
    // The primed arm is v1's prompt on the v2 transport: same model, same seed,
    // same temperature, same schema. Only the wording differs.
    : { ...base, prompt: buildCriticPrompt(input) };

  const row: Row = {
    model, instrument, doc: `${doc.case_id}/${doc.variant}`, truth: doc.consensus,
    gate: "no_judgement", score: null, failures: [], usd: null, error: null,
  };
  try {
    const reply = await call(req);
    row.usd = reply.usd;
    // The neutral arm must satisfy the full v2 schema (verdict enum + reasons);
    // the primed arm is v1's prompt, which never asks for them, so it is parsed
    // with v1's parser. Both end at applyBar, which is the comparison.
    const parsed = instrument === "neutral" ? parseJudgeReply(reply.text) : parseJudgement(reply.text);
    if (!parsed.ok) { row.error = parsed.reason; return row; }
    const bar = applyBar(parsed.judgement);
    row.gate = bar.clears ? "fundable" : "not_fundable";
    row.score = gateScore(parsed.judgement);
    row.failures = bar.failures;
  } catch (e) {
    if (e instanceof CapExhausted) throw e;
    row.error = String(e).slice(0, 300);
  }
  return row;
}

// ---------------------------------------------------------------- report
function report(rows: Row[], docs: DocRef[]): void {
  const decided = docs.filter((d) => d.consensus !== "disputed");
  const notFundable = decided.filter((d) => d.consensus === "not_fundable").length;
  const baseline = decided.length ? notFundable / decided.length : 0;

  console.log(`\ncorpus: ${docs.length} documents, ${decided.length} with an agreed critic verdict, ${docs.length - decided.length} disputed`);
  console.log(`corpus balance: ${notFundable} not fundable, ${decided.length - notFundable} fundable`);
  console.log(`ALWAYS-HOLD BASELINE: ${(baseline * 100).toFixed(1)}%  <- a judge that refuses everything scores this. Any rate at or below it is NO SIGNAL.`);
  if (baseline >= 1) {
    console.log(
      "\n  !! EVERY agreed document in this corpus is NOT FUNDABLE. The agreement rate below therefore\n" +
      "     measures ONE thing: whether a candidate judge wrongly PASSES a document two frontier critics\n" +
      "     agreed was unfundable. A 100% rate here does NOT mean the judge works — refusing everything\n" +
      "     scores 100%. Recognising a fundable document is UNTESTED and stays untested until this corpus\n" +
      "     contains one.\n",
    );
  } else {
    console.log("");
  }

  const keys = [...new Set(rows.map((r) => `${r.model}|${r.instrument}`))];
  console.log("model                              instrument  n   agree  rate    vs baseline  false-pass  false-hold  no-judgement  $/doc");
  for (const k of keys) {
    const [model, instrument] = k.split("|");
    const rs = rows.filter((r) => r.model === model && r.instrument === instrument && r.truth !== "disputed");
    const judged = rs.filter((r) => r.gate !== "no_judgement");
    const agree = judged.filter((r) => r.gate === r.truth).length;
    // The dangerous direction: the gate would have DELIVERED a document two
    // frontier critics said was not fundable. Invariant 1 lives here.
    const falsePass = judged.filter((r) => r.gate === "fundable" && r.truth === "not_fundable").length;
    const falseHold = judged.filter((r) => r.gate === "not_fundable" && r.truth === "fundable").length;
    const none = rs.length - judged.length;
    const costs = rs.map((r) => r.usd).filter((u): u is number => typeof u === "number");
    const perDoc = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    const rate = judged.length ? agree / judged.length : 0;
    const delta = rate - baseline;
    console.log(
      `${model.padEnd(34)} ${instrument.padEnd(11)} ${String(rs.length).padEnd(3)} ${String(agree).padEnd(6)} ` +
      `${(rate * 100).toFixed(1).padStart(5)}%  ${(delta >= 0 ? "+" : "") + (delta * 100).toFixed(1).padStart(5)}pp   ` +
      `${String(falsePass).padStart(10)}  ${String(falseHold).padStart(10)}  ${String(none).padStart(12)}  ` +
      (perDoc == null ? "     -" : `$${perDoc.toFixed(4)}`),
    );
    if (judged.length && rate <= baseline) {
      console.log(`   ^ NO SIGNAL: ${model} (${instrument}) does not beat refusing everything on this corpus.`);
    }
    if (none) console.log(`   ^ ${none} document(s) produced no readable judgement; they are excluded from the rate, never counted as agreement.`);
  }

  console.log("\nper-document:");
  console.log("case/variant        truth          " + keys.map((k) => k.split("|").join(" ")).join("   "));
  for (const d of docs) {
    const cells = keys.map((k) => {
      const [model, instrument] = k.split("|");
      const r = rows.find((x) => x.doc === `${d.case_id}/${d.variant}` && x.model === model && x.instrument === instrument);
      return (r?.error ? "ERR" : r?.gate ?? "-").padEnd(k.length);
    });
    console.log(`${(d.case_id + "/" + d.variant).padEnd(20)}${String(d.consensus).padEnd(15)}${cells.join("   ")}`);
  }

  const errs = rows.filter((r) => r.error);
  if (errs.length) {
    console.log(`\n${errs.length} judgement(s) failed:`);
    for (const e of errs.slice(0, 20)) console.log(`  ${e.model} ${e.instrument} ${e.doc}: ${e.error}`);
  }
  const totalUsd = rows.map((r) => r.usd ?? 0).reduce((a, b) => a + b, 0);
  const unmeasured = rows.filter((r) => r.usd == null && !r.error).length;
  console.log(`\ntotal measured spend: $${totalUsd.toFixed(4)} over ${rows.length} calls${unmeasured ? `, ${unmeasured} of them unmeasured` : ""}`);
  console.log("MEASURED HERE, NOT ASSUMED: this is the cost of judging, not the cost of an order.");
}

// ---------------------------------------------------------------- main
const docs = loadGroundTruth();
if (!docs.length) {
  console.error("no documents with recorded critic verdicts were found; nothing to validate");
  Deno.exit(1);
}

console.log(`ground truth: ${docs.length} documents from ${CORPUS}`);
for (const d of docs) {
  console.log(`  ${d.case_id}/${d.variant}  ${JSON.stringify(d.critics)}  -> ${d.consensus}`);
}
console.log(`candidates: ${MODELS.join(", ")}`);
console.log(`instruments: ${INSTRUMENTS.join(", ")}`);
console.log(`fixed: temperature ${JUDGE_TEMPERATURE}, seed ${JUDGE_SEED}, reasoning_effort ${JUDGE_EFFORT}`);
console.log(`bar: ${DIMENSIONS.length} dimensions, ${CRITIC_DISQUALIFIERS.length} conditions asked of the judge`);

if (DRY) {
  const req = buildJudgeRequest(judgeView(gateInputFor(docs[0])), { ...JUDGE_SLOTS[0], model: MODELS[0] });
  console.log(`\n--dry-run: ${docs.length * MODELS.length * INSTRUMENTS.length} calls would be made. Nothing was called.`);
  console.log(`first request: model=${req.model} effort=${req.effort} temperature=${req.temperature} seed=${req.seed} prompt=${req.prompt.length} chars, schema=${req.responseFormat?.json_schema.name}`);
  Deno.exit(0);
}
if (!KEY) {
  console.error("OPENROUTER_API_KEY is not set. Refusing to report an agreement rate that was never measured.");
  Deno.exit(1);
}

const rows: Row[] = [];
try {
  for (const instrument of INSTRUMENTS) {
    for (const model of MODELS) {
      for (const doc of docs) {
        const r = await judgeOne(doc, model, instrument);
        rows.push(r);
        console.error(`  ${model} ${instrument} ${r.doc}: ${r.error ? "ERR " + r.error.slice(0, 80) : r.gate}`);
      }
    }
  }
} catch (e) {
  if (e instanceof CapExhausted) {
    console.error(`\nABORTED — the OpenRouter key is capped: ${String(e.message).slice(0, 300)}`);
    console.error("No agreement rate is reported. A rate computed from a partial run is worse than no rate.");
    console.error("Raise the key's total spend cap and run this again.");
    Deno.exit(2);
  }
  throw e;
}

report(rows, docs);
