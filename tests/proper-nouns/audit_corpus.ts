import { properNounAudit } from "../../supabase/functions/worker/proper_nouns.ts";
const Q = "/tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/qloop";
const LIMITS: Record<string, number> = {};
const NAMES: Record<string, string> = {};
const LEDGERS: Record<string, Array<Record<string, unknown>>> = {};
for (const c of ["ukyouth", "evidence-poor"]) {
  const j = JSON.parse(await Deno.readTextFile(`${Q}/case-${c}.json`));
  LIMITS[c] = j.grant.word_limit;
  NAMES[c] = j.organisation.legal_name;
  LEDGERS[c] = j.evidence_ledger.map((e: Record<string, unknown>) => ({ claim: e.fact }));
}
console.log("case            var  words  limit  over%   ledger  used  unsourced");
for (const c of ["ukyouth", "evidence-poor"]) {
  for (const v of ["A", "B", "C", "D"]) {
    const md = await Deno.readTextFile(`${Q}/out-${c}-${v}.md`);
    const words = md.split(/\s+/).filter(Boolean).length;
    const a = properNounAudit(md, LEDGERS[c], NAMES[c]);
    const over = ((words / LIMITS[c] - 1) * 100).toFixed(0);
    console.log(
      `${c.padEnd(15)} ${v}   ${String(words).padStart(5)}  ${String(LIMITS[c]).padStart(5)}  ${over.padStart(4)}%   ` +
      `${String(a.ledger_offers).padStart(6)}  ${String(a.used).padStart(4)}  ${String(a.unsourced.length).padStart(9)}`);
  }
}
console.log("\nunsourced examples (proper nouns no ledger item supports):");
for (const c of ["ukyouth", "evidence-poor"]) for (const v of ["A", "B", "C", "D"]) {
  const md = await Deno.readTextFile(`${Q}/out-${c}-${v}.md`);
  const a = properNounAudit(md, LEDGERS[c], NAMES[c]);
  if (a.unsourced.length) console.log(`  ${c}-${v}: ${a.unsourced.slice(0, 6).join(" | ")}`);
}
