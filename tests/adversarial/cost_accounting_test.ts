// ============================================================================
// ADVERSARY: make two concurrent stages contaminate each other's cost record
// (launch-readiness P2.9 / phase 6.4).
//
// The old accounting was a module-level counter shared by the PARALLEL stages
// of one isolate: every concurrent stage's tokens landed in whichever stage's
// snapshot read the global last. The accounting is now a per-runStage sink
// threaded into every model call, with dollars taken from OpenRouter's own
// per-response accounting (usage.include -> usage.cost).
//
// The accumulation code is extracted from worker/index.ts and EXECUTED here
// under real concurrency (interleaved async tasks on two sinks); the threading
// is asserted by source (index.ts cannot be imported: Deno.serve at module
// scope).
// ============================================================================

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}
const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));
const BEGIN = "// ---- USAGE-ACCOUNTING-BEGIN", END = "// ---- USAGE-ACCOUNTING-END";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0) throw new Error("usage accounting block not found");
const mod = await import(
  "data:application/typescript;base64," +
  btoa(String.fromCharCode(...new TextEncoder().encode(
    SRC.slice(SRC.indexOf("\n", a) + 1, b) + "\nexport { newUsage, addUsage };\nexport type { Usage };\n",
  )))
);
// deno-lint-ignore no-explicit-any
const newUsage = mod.newUsage as () => any;
// deno-lint-ignore no-explicit-any
const addUsage = mod.addUsage as (u: any, j: any) => void;

console.log("1. TWO CONCURRENT STAGES, EXECUTED: NO CROSS-CONTAMINATION");
{
  // Two "stages", each making 50 model calls with distinct token/cost shapes,
  // interleaved on the event loop exactly as PARALLEL stages interleave.
  const uA = newUsage(), uB = newUsage();
  const stage = async (u: unknown, prompt: number, completion: number, cost: number) => {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 0)); // yield: force interleaving
      addUsage(u, { usage: { prompt_tokens: prompt, completion_tokens: completion, cost } });
    }
  };
  await Promise.all([stage(uA, 100, 10, 0.001), stage(uB, 7, 70, 0.02)]);
  ok(uA.calls === 50 && uB.calls === 50, "each stage records exactly its own 50 calls");
  ok(uA.prompt_tokens === 5000 && uA.completion_tokens === 500,
    `stage A's tokens are exactly its own (${uA.prompt_tokens}/${uA.completion_tokens})`);
  ok(uB.prompt_tokens === 350 && uB.completion_tokens === 3500,
    `stage B's tokens are exactly its own (${uB.prompt_tokens}/${uB.completion_tokens})`);
  ok(Math.abs(uA.usd - 0.05) < 1e-9 && Math.abs(uB.usd - 1.0) < 1e-9,
    `dollars separate too (A $${uA.usd.toFixed(3)}, B $${uB.usd.toFixed(2)}) — from the response's own cost field`);
}
{
  const u = newUsage();
  addUsage(u, { usage: { prompt_tokens: 5, completion_tokens: 5 } }); // no cost field
  addUsage(u, { usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.01 } });
  ok(u.unpriced_calls === 1 && Math.abs(u.usd - 0.01) < 1e-9,
    "a response without a cost field is counted as unpriced, never silently $0");
  addUsage(undefined, { usage: { prompt_tokens: 9, completion_tokens: 9, cost: 9 } });
  ok(u.calls === 2, "a call with no sink accumulates NOWHERE (no hidden global to fall back to)");
}

console.log("\n2. THE THREADING, BY SOURCE");
ok(!/const usage = \{ calls: 0/.test(SRC) && !/usageReset|usageSnap/.test(SRC),
  "the module-level shared counter is GONE (usageReset/usageSnap removed)");
ok(/addUsage\(opts\.u, j\);/.test(SRC), "llmRaw accumulates into the CALLER'S sink only");
ok(/usage: \{ include: true \},\s*\n\s*reasoning:/.test(SRC),
  "every workhorse call requests OpenRouter's own cost accounting (usage.include)");
ok(/const stageUsage = newUsage\(\);/.test(SRC), "each runStage call owns a fresh sink");
ok((SRC.match(/usage: \{ \.\.\.stageUsage \}/g) ?? []).length >= 10,
  "every stage output snapshots ITS OWN sink (10 stage outputs)");
ok((SRC.match(/u: stageUsage/g) ?? []).length + (SRC.match(/, stageUsage\)/g) ?? []).length >= 15,
  "the sink is threaded into every model-calling site inside runStage");
ok(/generateValidated\(prompt: string, maxTokens: number, opts: ContentOpts = \{\}, u\?: Usage\)/.test(SRC),
  "generateValidated forwards the sink to its internal calls");
ok(/judgeCall/.test(SRC) && /usage\.include\) rather than the module-level token counter/.test(SRC),
  "the delivery-gate judge keeps its own per-call provider accounting (unchanged)");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
