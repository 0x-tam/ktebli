// ============================================================================
// Notification wordings and class separation (phase 6.1).
//
// Executes the DRAFT wording block extracted verbatim from worker/index.ts
// (index.ts calls Deno.serve at module scope and cannot be imported), then
// asserts the wording rules and, by source, the class wiring:
//
//   terminal failure  -> customer AND operator
//   QUALITY_HOLD      -> customer (refund letter), never the generic failure
//   INFRA_HOLD        -> operator ONLY, wording never implies the proposal
//                        failed, customer explicitly uncontacted
//
// Run: deno run --allow-read tests/notifications/wording_test.ts
// ============================================================================

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}

const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));
const BEGIN = "// ---- WORDING-BLOCK-BEGIN";
const END = "// ---- WORDING-BLOCK-END";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0) throw new Error("wording block markers not found in index.ts");
const block = SRC.slice(SRC.indexOf("\n", a) + 1, b);
const mod = await import(
  "data:application/typescript;base64," +
  btoa(String.fromCharCode(...new TextEncoder().encode(block + "\nexport { DRAFT_WORDINGS };\n")))
);
// deno-lint-ignore no-explicit-any
const W = mod.DRAFT_WORDINGS as any;

console.log("1. THE BLOCK ITSELF");
ok(/DRAFT/.test(SRC.slice(Math.max(0, a - 900), a)), "the block is marked DRAFT for operator edit");

const rendered: Array<[string, { subject: string; html: string }]> = [
  ["customerTerminal", W.customerTerminal("KT-90001", "Drafting the proposal", "hello@ktebli.com")],
  ["customerQualityHold (unconfirmed)", W.customerQualityHold("Ashfield Youth Trust", "KT-90001", 149, "hello@ktebli.com", false)],
  ["customerQualityHold (confirmed)", W.customerQualityHold("Ashfield Youth Trust", "KT-90001", 149, "hello@ktebli.com", true)],
  ["customerQualityHold (no amount)", W.customerQualityHold("Org", "KT-90002", null, "hello@ktebli.com", false)],
  ["operatorInfraHold", W.operatorInfraHold("KT-90001", "package", "judge unreachable after retries")],
  ["operatorTerminal", W.operatorTerminal("KT-90001", "strategy", "analysis missing")],
];

console.log("\n2. WORDING RULES (short plain sentences, no em dashes)");
for (const [name, w] of rendered) {
  ok(!!w.subject && !!w.html, `${name}: subject and body exist`);
  ok(!/[—–]/.test(w.subject + w.html), `${name}: no em or en dash anywhere`);
  const sentences = w.html.replace(/<[^>]+>/g, " ").split(/[.!?]/).map((s) => s.trim()).filter(Boolean);
  ok(sentences.every((s) => s.length <= 160), `${name}: every sentence is short (max ${Math.max(...sentences.map((s) => s.length))} chars)`);
}

console.log("\n3. CLASS CONTENT");
{
  const w = W.customerTerminal("KT-1", "Checking it against every other proposal on this grant", "s@x.y");
  ok(w.html.includes("We could not finish your proposal"), "terminal: says plainly the proposal was not finished");
  ok(w.html.includes("Checking it against every other proposal"), "terminal: names the step it stopped at");
  ok(!/refund/i.test(w.html), "terminal: promises no refund policy the owner has not set");
}
{
  const w = W.customerQualityHold("Org", "KT-1", 149, "s@x.y", false);
  ok(/refunding \$149\.00 in full/.test(w.html), "quality hold: states the refund and the amount");
  ok(!/held|parked|infrastructure/i.test(w.html), "quality hold: no internal hold vocabulary leaks to the customer");
}
{
  const w = W.operatorInfraHold("KT-1", "package", "x");
  ok(w.html.includes("The proposal itself has not failed"), "infra hold: states outright that the proposal has NOT failed");
  ok(w.html.includes("No judgement about its quality was reached"), "infra hold: no quality judgement implied");
  ok(w.html.includes("The customer has not been contacted"), "infra hold: records that the customer heard nothing");
  ok(!/refund/i.test(w.html), "infra hold: never mentions a refund");
}

console.log("\n4. THE CLASS WIRING, BY SOURCE");
// INFRA hold path: operator only. Slice the hold_alert block and prove no
// customer send and no customer wording inside it.
const holdStart = SRC.indexOf('if (gate.decision.action === "hold_alert")');
const holdEnd = SRC.indexOf('if (gate.decision.action === "refund")');
const holdBlock = SRC.slice(holdStart, holdEnd);
ok(holdStart > 0 && /operatorInfraHold/.test(holdBlock), "INFRA_HOLD path sends the operator wording");
ok(!/sendEmail\(/.test(holdBlock) && !/customer(Terminal|QualityHold)/.test(holdBlock),
  "INFRA_HOLD path contains NO customer send of any kind");
ok(/notified_at/.test(holdBlock), "INFRA_HOLD marks itself notified so the terminal sweep cannot email the customer later");

// QUALITY refund path: customer letter, gate_refund kind, notified_at.
const refundStart = holdEnd;
const refundEnd = SRC.indexOf("// PASS. Render below");
const refundBlock = SRC.slice(refundStart, refundEnd);
ok(/customerQualityHold/.test(refundBlock), "QUALITY_HOLD path sends the customer the refund wording");
ok(!/operatorInfraHold/.test(refundBlock), "QUALITY_HOLD path does not reuse the INFRA wording (classes not conflated)");
ok(/notified_at/.test(refundBlock), "QUALITY_HOLD marks itself notified");

// Terminal path notifies both, records both attempts, escalation first.
const ntStart = SRC.indexOf("async function notifyTerminal");
const ntEnd = SRC.indexOf("async function notifyUnnotifiedTerminals");
const ntBlock = SRC.slice(ntStart, ntEnd);
ok(/customerTerminal/.test(ntBlock) && /operatorTerminal/.test(ntBlock), "terminal failure notifies BOTH customer and operator");
ok(ntBlock.indexOf('ins("escalations"') < ntBlock.indexOf("customerTerminal"),
  "the escalation row is written BEFORE the email attempt (alert lands even with no Resend key)");
ok((ntBlock.match(/recordNotifyAttempt/g) ?? []).length === 2, "both attempts are recorded as events rows");

// The sweep exists and the tick runs it.
ok(/notifyUnnotifiedTerminals\(\);/.test(SRC), "every tick sweeps reaper-failed stages nobody notified");
ok(/status=in\.\(failed,held\)&notified_at=is\.null/.test(SRC), "the sweep selects exactly terminal-and-unnotified");

// WS4a-19: deliver's email failure is an escalation + recorded output.
const delStart = SRC.indexOf('if (stage.key === "deliver")');
const delBlock = SRC.slice(delStart, SRC.indexOf("Deno.serve"));
ok(/delivery_failed/.test(delBlock) && /email_failed/.test(delBlock),
  "WS4a-19: a failed completion email escalates and is recorded on the stage output");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
