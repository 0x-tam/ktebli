// Does either deterministic referent measure predict the blind fundability
// ranking? The re-test phase 3 requires before wiring any ladder arm into
// sufficiency.ts.
//
//   npx --yes deno@2.9.5 run --allow-read tests/sufficiency/ladder_tau.ts
//
// Offline and deterministic: no network, no model. For each of the 14 blind
// verdict cells (10 in tests/ladder/verdicts/, 4 in tests/ladder/verdicts2/) it
// computes, over that cell's four documents:
//
//   COUNT   ledger-offered referents PRESENT in the document
//           (referentWeight().present — the deterministic audit, not a model)
//   WEIGHT  total document weight (referentWeight().weight)
//
// and reports Kendall tau-b between each measure and the critic's own ranking,
// oriented so that POSITIVE tau means "more referents / more weight ranked
// better". The wiring rule fixed by the phase brief: only a measure with
// tau >= 0.5 across rungs and critics may become the sufficiency ladder arm.
//
// The rankings are the decoded tables of reports/phase1-verdicts.md ("Decoded
// results") and reports/phase2-decision.md ("RESULT"), every decode of which was
// confirmed by content fingerprint (tests/ladder/bytematch.py, exit 0 in the
// suite). They are restated here as data rather than re-parsed from prose, so a
// wording change in a report cannot silently flip a ranking; bytematch.py is
// what pins them to the packets' actual bytes.

import { ledgerReferents, referentWeight } from "../../supabase/functions/worker/referent_weight.ts";
import { properNouns } from "../../supabase/functions/worker/proper_nouns.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const APPLICANT = "Halewater Commons Trust";

// rung -> critic -> ranking, best first. Phase 1 judged arms A-D; phase 2
// (verdicts2) judged A, B, D, H.
interface Cell { rung: string; critic: string; source: string; ranking: string[] }
const CELLS: Cell[] = [
  { rung: "n03", critic: "critic_a", source: "verdicts", ranking: ["B", "D", "C", "A"] },
  { rung: "n03", critic: "critic_b", source: "verdicts", ranking: ["B", "D", "C", "A"] },
  { rung: "n06", critic: "critic_a", source: "verdicts", ranking: ["D", "B", "C", "A"] },
  { rung: "n06", critic: "critic_b", source: "verdicts", ranking: ["D", "B", "C", "A"] },
  { rung: "n09", critic: "critic_a", source: "verdicts", ranking: ["D", "B", "A", "C"] },
  { rung: "n09", critic: "critic_b", source: "verdicts", ranking: ["D", "B", "C", "A"] },
  { rung: "n12", critic: "critic_a", source: "verdicts", ranking: ["B", "D", "A", "C"] },
  { rung: "n12", critic: "critic_b", source: "verdicts", ranking: ["B", "D", "C", "A"] },
  { rung: "n06thin", critic: "critic_a", source: "verdicts", ranking: ["B", "D", "C", "A"] },
  { rung: "n06thin", critic: "critic_b", source: "verdicts", ranking: ["D", "B", "C", "A"] },
  { rung: "n12", critic: "critic_a", source: "verdicts2", ranking: ["B", "D", "A", "H"] },
  { rung: "n12", critic: "critic_b", source: "verdicts2", ranking: ["D", "B", "H", "A"] },
  { rung: "n06thin", critic: "critic_a", source: "verdicts2", ranking: ["B", "D", "H", "A"] },
  { rung: "n06thin", critic: "critic_b", source: "verdicts2", ranking: ["B", "D", "H", "A"] },
];

// Kendall tau-b: ties handled in both variables; NaN when one variable is
// constant (no ordering to agree with).
function kendallTauB(x: number[], y: number[]): number {
  const n = x.length;
  let concordant = 0, discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[i] - x[j]), dy = Math.sign(y[i] - y[j]);
      if (dx === 0 || dy === 0) continue; // tied pairs enter through the denominator
      if (dx === dy) concordant++;
      else discordant++;
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const denom = Math.sqrt((n0 - tiePairs(x)) * (n0 - tiePairs(y)));
  return denom === 0 ? NaN : (concordant - discordant) / denom;
}
function tiePairs(v: number[]): number {
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  let t = 0;
  for (const c of counts.values()) t += (c * (c - 1)) / 2;
  return t;
}

// The deterministic audit over one document, against its rung's ledger.
const auditCache = new Map<string, { count: number; weight: number; offered: number }>();
function audit(rung: string, arm: string): { count: number; weight: number; offered: number } {
  const key = `${rung}-${arm}`;
  const hit = auditCache.get(key);
  if (hit) return hit;
  const ledger = (JSON.parse(Deno.readTextFileSync(`${ROOT}tests/ladder/fixture/ledger-${rung}.json`)) as Array<Record<string, unknown>>)
    .filter((e) => e.source !== "fixture-meta");
  const refs = ledgerReferents(ledger, APPLICANT, properNouns);
  const narrative = Deno.readTextFileSync(`${ROOT}tests/ladder/documents/out-${rung}-${arm}.md`);
  const a = referentWeight(narrative, refs);
  const out = { count: a.present, weight: a.weight, offered: a.offered };
  auditCache.set(key, out);
  return out;
}

console.log(`Referent measures vs the 14 blind rankings (higher measure should mean better rank)\n`);
console.log("cell                       docs   counts (by rank, best first)   weights (by rank)          tau_count  tau_weight");

interface Row { cell: Cell; tauCount: number; tauWeight: number }
const rows: Row[] = [];
for (const cell of CELLS) {
  const arms = cell.ranking;
  // Rank 1 is best; orient so positive tau = measure tracks fundability.
  const goodness = arms.map((_, i) => arms.length - i); // 4,3,2,1 down the ranking
  const counts = arms.map((a) => audit(cell.rung, a).count);
  const weights = arms.map((a) => audit(cell.rung, a).weight);
  const tauCount = kendallTauB(goodness, counts);
  const tauWeight = kendallTauB(goodness, weights);
  rows.push({ cell, tauCount, tauWeight });
  const name = `${cell.rung}/${cell.critic}${cell.source === "verdicts2" ? " (p2)" : ""}`;
  console.log(
    `${name.padEnd(26)} ${arms.join(">")}   ${counts.map((c) => String(c).padStart(2)).join(" ")}`.padEnd(65) +
    `${weights.map((w) => w.toFixed(1).padStart(6)).join(" ")}   ` +
    `${fmt(tauCount).padStart(8)}  ${fmt(tauWeight).padStart(9)}`,
  );
}

function fmt(t: number): string { return Number.isNaN(t) ? "n/a" : t.toFixed(3); }
function summarise(name: string, taus: number[]): { mean: number; ge05: number; usable: number } {
  const usable = taus.filter((t) => !Number.isNaN(t));
  const mean = usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : NaN;
  const ge05 = usable.filter((t) => t >= 0.5).length;
  console.log(
    `${name.padEnd(8)} mean tau ${fmt(mean)} over ${usable.length} usable cells` +
    ` (${taus.length - usable.length} degenerate); tau >= 0.5 in ${ge05} of ${taus.length} cells`,
  );
  return { mean, ge05, usable: usable.length };
}

console.log("");
const sc = summarise("COUNT", rows.map((r) => r.tauCount));
const sw = summarise("WEIGHT", rows.map((r) => r.tauWeight));

console.log(
  `\nWiring rule (phase brief): a measure becomes the sufficiency ladder arm only with` +
  ` tau >= 0.5 across rungs and critics.\n` +
  `COUNT ${sc.ge05}/${rows.length} cells at tau >= 0.5; WEIGHT ${sw.ge05}/${rows.length}.`,
);
const robust = (s: { ge05: number }) => s.ge05 === rows.length;
if (robust(sc) || robust(sw)) {
  console.log(`VERDICT: ${robust(sc) ? "COUNT" : "WEIGHT"} robustly predicts fundability — wire it as the ladder arm.`);
} else {
  console.log(`VERDICT: neither measure robustly predicts fundability. ladderStatus stays/becomes "flat";` +
    ` the gate keeps the hard floor and required-slot arms only.`);
}
