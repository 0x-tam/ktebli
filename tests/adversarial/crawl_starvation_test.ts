// ============================================================================
// ADVERSARY: get a paid order through to a generic proposal after its own-site
// crawl silently failed (phase 6.3 — launch-readiness P1.6 meets the P0.1 data
// starvation the blind critics described).
//
// Before this wiring: a crawl that came back blocked/js_only/extraction_failed
// left the ledger at the three identity items, grounding correctly forbade
// inventing anything, and the pipeline shipped the "could belong to any
// organisation" document 8/8 blind judgements called machine-generated. Now
// the org stage computes the referent count actually in hand and, when a
// starvation-class outcome meets a ledger below the sufficiency floor, parks
// the order as held on the FIRST pass with customer + operator notification.
//
// The decision predicate is extracted from worker/index.ts and executed (the
// shipping bytes); the surrounding wiring is asserted by source, the same
// technique as the other adversarial suites (index.ts cannot be imported).
// ============================================================================

import {
  effectiveThreshold,
  referentsIn,
  SUFFICIENCY_THRESHOLD,
} from "../../supabase/functions/worker/sufficiency.ts";

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}
const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));
const BEGIN = "// ---- CRAWL-STARVATION-BEGIN", END = "// ---- CRAWL-STARVATION-END";
const a = SRC.indexOf(BEGIN), b = SRC.indexOf(END);
if (a < 0 || b < 0) throw new Error("starvation block markers not found");
const block = SRC.slice(SRC.indexOf("\n", a) + 1, b);
const mod = await import(
  "data:application/typescript;base64," +
  btoa(String.fromCharCode(...new TextEncoder().encode(block + "\nexport { crawlStarved, CRAWL_STARVED_OUTCOMES };\n")))
);
const crawlStarved = mod.crawlStarved as (o: string | null | undefined, n: number, f: number) => boolean;
const OUTCOMES = mod.CRAWL_STARVED_OUTCOMES as Set<string>;

console.log("1. THE PREDICATE, EXECUTED");
const floor = effectiveThreshold(SUFFICIENCY_THRESHOLD);
ok(floor >= 1, `the sufficiency hard floor is ${floor} (>= 1; thresholds untouched by this wiring)`);
for (const o of ["blocked_robots", "blocked_bot", "js_only", "fetch_failed", "extraction_failed"]) {
  ok(crawlStarved(o, 0, floor), `${o} + empty ledger -> STARVED (holds)`);
  ok(!crawlStarved(o, floor, floor), `${o} + ledger AT the floor -> proceeds (the crawl failure alone is not a hold)`);
}
ok(!crawlStarved("succeeded", 0, floor), "a successful crawl never trips the starvation hold");
ok(!crawlStarved("nothing_relevant", 0, floor),
  "nothing_relevant is NOT starvation: the site was read and truthfully yielded nothing admissible");
ok(!crawlStarved("identity_mismatch", 0, floor),
  "identity_mismatch is NOT starvation: the discard is the identity gate working");
ok(!crawlStarved(null, 0, floor) && !crawlStarved(undefined, 0, floor), "no classified outcome, no starvation hold");
ok([...OUTCOMES].length === 5, "exactly the five starvation-class outcomes are named");

console.log("\n2. THE REFERENT COUNT FEEDING IT (sufficiency.ts, executed)");
ok(referentsIn("the Old Bakehouse on Ashfield Road").length >= 1,
  "a real E-ASK answer contributes referents to the count");
ok(referentsIn("homes").length === 0, "an escape value like 'homes' contributes nothing");

console.log("\n3. THE WIRING, BY SOURCE");
const orgAt = SRC.indexOf('if (stage.key === "org")');
const voiceAt = SRC.indexOf('if (stage.key === "voice")');
const orgBlock = SRC.slice(orgAt, voiceAt);
ok(/CRAWL_STARVED_OUTCOMES\.has\(crawlReport\.outcome\)/.test(orgBlock),
  "the org stage checks the CLASSIFIED crawl outcome (crawl_outcome.ts taxonomy, WS3's wiring)");
ok(/intake_answers/.test(orgBlock) && /intake_files/.test(orgBlock) && /webEvidence\.length/.test(orgBlock),
  "the count covers intake answers + uploaded documents + surviving web evidence");
ok(/effectiveThreshold\(SUFFICIENCY_THRESHOLD\)/.test(orgBlock),
  "the floor is sufficiency.ts's own effectiveThreshold — no second threshold definition");
ok(/action: "evidence_starved"/.test(orgBlock), "the hold is an events row before it is a throw (invariant 9)");
ok(/throw new Error\(`evidence starved/.test(orgBlock), "and then a loud throw, never a silent generic proposal");
ok(/msg\.includes\("evidence starved"\)/.test(SRC.slice(SRC.indexOf("Deno.serve"))),
  "the tick handler makes it TERMINAL on first occurrence (held, notifyTerminal -> customer + operator)");
const servePart = SRC.slice(SRC.indexOf("Deno.serve"));
// Widened from "const final" to "const isHold" (launch spend-cap wiring, 2026-09):
// "evidence starved" moved into a named isHold predicate declared just before
// const final, rather than sitting inline inside it — same runtime classification,
// refactored for reuse (isHold now also gates the status computation and the
// spend-cap branch below it). The window still captures the whole predicate chain.
const finalLine = servePart.slice(servePart.indexOf("const isHold"), servePart.indexOf("const status"));
ok(/evidence starved/.test(finalLine), "  ...final on the first pass (a retry cannot grow the ledger)");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
