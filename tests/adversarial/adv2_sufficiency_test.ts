// ============================================================================
// ADVERSARY (round 2): take Ktebli's money for an order it cannot fulfil.
// Invariant 2: no money is taken for an order the system cannot fulfil.
//
// Round 1 (payment_without_clearance_test.ts + checkout_clearance_test.sql) is
// assumed CLOSED. This suite attacks the two things round 1 asserted only by
// source and never executed, plus the module edges it did not cover:
//
//   * LIVE CONCURRENCY — two webhooks racing ONE token. consume_checkout_token
//     serialises on `SELECT … FOR UPDATE`; round 1 grepped for it, this suite
//     proves it (optional live block, env KTEBLI_DB_URL) and pins the guard by
//     source so removing FOR UPDATE / the single-use / the TTL fails the test.
//   * THE PUBLIC WRITE SURFACE — every forge/clear-then-edit attack reduces to
//     "can the attacker write pre_intakes?". It cannot: the base migration is
//     `enable row level security` + `revoke all … from anon, authenticated`
//     with zero policies, and consume_checkout_token is granted to service_role
//     only. Pinned by source here; executed against the live stack in the report
//     (reports/adversarial/invariant-2-sufficiency.md §3).
//   * MODULE EDGES — the two honest escapes do NOT zero the hard floor; the
//     grant-by-length residual is real but unreachable; nothing client-supplied
//     asserts `cleared`.
//
// Same technique as the other adversarial suites: the shipping decision code
// (sufficiency.ts + clearance.ts) is imported and RUN; the SQL/DDL authority and
// the Deno.serve glue (which cannot be imported) are asserted by source against
// the real files. Verdict of the investigation: CONCEDED — every attack refuses.
//
// Run:  deno run --allow-read --allow-env --allow-run \
//         tests/adversarial/adv2_sufficiency_test.ts
// (--allow-run + KTEBLI_DB_URL only exercise the optional live-concurrency block;
//  without them the suite still runs every module and by-source assertion.)
// ============================================================================

import {
  effectiveThreshold,
  evaluateSufficiency,
  fingerprint,
  SUFFICIENCY_THRESHOLD,
  type SufficiencyInput,
} from "../../supabase/functions/worker/sufficiency.ts";
import {
  fingerprintOfRow,
  inputFromRow,
} from "../../supabase/functions/stripe-webhook/clearance.ts";

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}
const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

// A fully-answered, genuinely fundable draft intake (the round-1 archetype).
const goodRow: Record<string, unknown> = {
  email: "real@example.invalid",
  tier: "draft",
  org_name: "Ashfield Youth Trust",
  org_reg: "1189922",
  org_website: "https://ashfieldyouth.example.org",
  grant_input: "x".repeat(700),
  grant_analysis_ok: false,
  deadline: null,
  site_place: "Tower Hamlets, London",
  site_venue: "the Old Bakehouse on Ashfield Road",
  site_activity: "a Thursday evening drop-in for 14-19s with hot food",
  last_delivery_what: "the Qobbe school-bag distribution",
  last_delivery_when: "winter 2024",
  local_trigger: "the council closed the Ashfield youth centre in April",
  venue_escape: null,
  never_delivered: false,
  // The core admin facts every UK grant application needs (phase 8): without
  // these the gate now refuses regardless of particularity.
  intake_facts: {
    income_band: "£10,000–£100,000",
    safeguarding_policy: true,
    safeguarding_lead_name: "Ruth Adeyemi",
    safeguarding_lead_role: "Trustee",
  },
};

// ---------------------------------------------------------------------------
// A. THE HONEST ESCAPES DO NOT ZERO THE HARD FLOOR
//    venue_escape and never_delivered are answers, not skips. Taking both and
//    naming nothing else must still refuse; the floor is only met by real,
//    supplied place evidence. (sufficiency.ts header: "An applicant who takes
//    both and names nothing else still refuses.")
// ---------------------------------------------------------------------------
console.log("A. BOTH ESCAPES + EMPTY SLOTS REFUSES; THE MINIMUM STILL NEEDS REAL EVIDENCE");

const bothEscapesEmpty = inputFromRow({
  email: "esc@example.invalid",
  tier: "draft",
  org_name: "Beit Al-Shabab Community Association",
  org_reg: "1234-L",
  org_website: "https://example.org",
  grant_input: "g".repeat(700),
  grant_analysis_ok: true,
  deadline: null,
  venue_escape: "street", // "we work on the street, not a fixed venue"
  never_delivered: true, // "we have not delivered anything yet"
  // site_place / site_activity / local_trigger deliberately empty
}, []);
const escVerdict = evaluateSufficiency(bothEscapesEmpty);
ok(!escVerdict.cleared, "both escapes + empty required slots is NOT cleared");
ok(escVerdict.gaps.some((g) => g.scope === "site_place"),
  "the refusal still demands a place name (site_place gap present)");
ok(escVerdict.score < escVerdict.threshold,
  `score ${escVerdict.score} is under the floor ${escVerdict.threshold} despite both escapes`);

// The irreducible minimum WITH both escapes: a real place + what happens + why.
// This must clear — the escapes are honest, not impossibly strict.
const minWithEscapes = inputFromRow({
  email: "esc2@example.invalid",
  tier: "draft",
  org_name: "Beit Al-Shabab Community Association",
  org_reg: "1234-L",
  org_website: "https://example.org",
  grant_input: "g".repeat(700),
  grant_analysis_ok: true,
  deadline: null,
  site_place: "Bab al-Tabbaneh, Tripoli",
  site_activity: "a weekly street outreach session with a hot meal",
  local_trigger: "the only youth centre in the quarter shut in March",
  venue_escape: "street",
  never_delivered: true,
  intake_facts: {
    income_band: "under £10,000",
    safeguarding_policy: true,
    safeguarding_lead_name: "Layla Haddad",
    safeguarding_lead_role: "Chair",
  },
}, []);
const minVerdict = evaluateSufficiency(minWithEscapes);
ok(minVerdict.cleared,
  "the honest minimum (real place + activity + trigger, both escapes taken) clears");
ok(minVerdict.threshold === effectiveThreshold(SUFFICIENCY_THRESHOLD) && minVerdict.threshold === 1,
  "the bar is the FLAT hard floor of 1 — no threshold was quietly moved");

// ---------------------------------------------------------------------------
// B. CLEARED IS DERIVED, NEVER ASSERTED
//    Nothing on the input can turn a refusal into a clearance. An identity-only
//    intake with junk keys jammed in still refuses.
// ---------------------------------------------------------------------------
console.log("\nB. NOTHING CLIENT-SUPPLIED CAN ASSERT CLEARANCE");
const identityOnly = inputFromRow({
  email: "attacker@example.invalid",
  tier: "draft",
  org_name: "Beit Al-Shabab Community Association",
  org_reg: "1234-L",
  org_website: "https://example.org",
  grant_input: "https://donor.example.org/call",
  grant_analysis_ok: true,
  deadline: null,
  never_delivered: false,
}, []);
// jam attacker-controlled keys that the gate must ignore
const spiked = { ...identityOnly, cleared: true, sufficiency_cleared: true, score: 999 } as unknown as SufficiencyInput;
const spikedVerdict = evaluateSufficiency(spiked);
ok(!spikedVerdict.cleared, "identity-only intake refuses even with cleared/score keys spiked onto the input");

// ---------------------------------------------------------------------------
// C. THE FINGERPRINT ROUND-TRIPS, AND A DOWNGRADE BREAKS IT
// ---------------------------------------------------------------------------
console.log("\nC. FINGERPRINT ROUND-TRIP AND CLEAR-THEN-EDIT DETECTION");
const goodVerdict = evaluateSufficiency(inputFromRow(goodRow, []));
ok(goodVerdict.cleared, "the archetype clears");
const fpClear = await fingerprint(inputFromRow(goodRow, []));
const fpHook = await fingerprintOfRow(goodRow, []);
ok(fpClear === fpHook, "save-side and webhook-side fingerprints match for an untouched row");

// downgrade after clearance -> different fingerprint -> consume refuses
const downgraded = { ...goodRow, site_place: null };
ok(await fingerprintOfRow(downgraded, []) !== fpClear,
  "deleting a scored answer after clearance changes the fingerprint");

// RECORDED RESIDUAL: the grant is bound by length + analysability, not text.
// A same-length grant swap keeps the fingerprint. This is sufficiency.ts's own
// design (the gate never scores grant text). It is NOT reachable: the only
// public edit path is save-intake, which re-scores and re-fingerprints, and
// pre_intakes is RLS-locked from anon/authenticated (section D). We assert the
// residual EXISTS so a future change that opens a public write to pre_intakes
// (which would make it reachable) is caught by section D flipping.
const sameLenGrant = { ...goodRow, grant_input: "z".repeat(700) };
ok(await fingerprintOfRow(sameLenGrant, []) === fpClear,
  "RESIDUAL (recorded): a same-length grant swap keeps the fingerprint — unreachable while §D holds");

// ---------------------------------------------------------------------------
// D. THE DB AUTHORITY, BY SOURCE — the guards that make every DB-side attack
//    refuse. If any of these strings goes, invariant 2 is open again.
// ---------------------------------------------------------------------------
console.log("\nD. consume_checkout_token + pre_intakes DDL (by source)");
const suffMig = await read("../../supabase/migrations/20260826180000_sufficiency_gate.sql");
const preMig = await read("../../supabase/migrations/20260820150903_pre_intakes.sql");

ok(/for update/i.test(suffMig),
  "consume_checkout_token locks the row with FOR UPDATE (serialises the two-webhook race)");
ok(/checkout_token_used_at is not null/.test(suffMig),
  "single use: a consumed token refuses (token_already_used)");
ok(/interval '6 hours'/.test(suffMig),
  "TTL: an expired token refuses (token_expired)");
ok(/sufficiency_fingerprint is distinct from p_fingerprint/.test(suffMig),
  "fingerprint mismatch refuses (clear-then-edit / tier-swap / A-for-B)");
ok(/sufficiency_cleared is not true/.test(suffMig),
  "an uncleared row refuses (not_cleared)");
ok(/grant execute on function public\.consume_checkout_token\(text, text, text\) to service_role/.test(suffMig) &&
  /revoke all on function public\.consume_checkout_token\(text, text, text\) from public, anon, authenticated/.test(suffMig),
  "only service_role may consume a token — the public roles cannot");
ok(/create unique index if not exists pre_intakes_checkout_token_idx/.test(suffMig),
  "checkout_token is a unique key — one token names exactly one intake");
ok(/sufficiency_score >= sufficiency_threshold/.test(suffMig),
  "pre_intakes_clearance_complete forbids cleared=true unless score >= threshold");
ok(/enable row level security/.test(preMig) &&
  /revoke all on public\.pre_intakes from anon, authenticated/.test(preMig),
  "pre_intakes has RLS on and all privileges revoked from anon/authenticated (no public forge/edit)");

// ---------------------------------------------------------------------------
// E. THE WEBHOOK GLUE, BY SOURCE — work is queued only behind the clearance.
// ---------------------------------------------------------------------------
console.log("\nE. stripe-webhook + save-intake glue (by source)");
const hookSrc = await read("../../supabase/functions/stripe-webhook/index.ts");
const saveSrc = await read("../../supabase/functions/save-intake/index.ts");

ok(/const funded = priceOk && emailOk && clearanceOk;/.test(hookSrc),
  "order-with-work is funded only when price, email AND clearance all hold");
ok(/consume_checkout_token/.test(hookSrc),
  "the webhook drives clearance through the SQL authority, not a local check");
ok(/tier_mismatch/.test(hookSrc),
  "a clearance for one tier does not authorise a charge for another");
ok(!/pre_intakes\?email=eq\./.test(hookSrc),
  "the 48-hour any-intake-with-this-email fallback is gone");
ok(/const token = verdict\.cleared \? mintCheckoutToken\(\) : null;/.test(saveSrc) &&
  (saveSrc.match(/mintCheckoutToken\(\)/g) ?? []).length === 1,
  "save-intake mints a token at exactly one site, gated on verdict.cleared");

// The single order-creation site: only stripe-webhook inserts orders.
let orderInsertSites = 0;
const insertingFns: string[] = [];
for await (const entry of Deno.readDir(new URL("../../supabase/functions/", import.meta.url))) {
  if (!entry.isDirectory) continue;
  let src = "";
  try {
    src = await read(`../../supabase/functions/${entry.name}/index.ts`);
  } catch { continue; }
  const inserts = (src.match(/ins\("orders"/g) ?? []).length;
  if (inserts > 0) {
    orderInsertSites += inserts;
    insertingFns.push(entry.name);
  }
}
ok(orderInsertSites === 1 && insertingFns.length === 1 && insertingFns[0] === "stripe-webhook",
  `exactly one order-creation site exists, in stripe-webhook (found: ${insertingFns.join(",") || "none"})`);

// ---------------------------------------------------------------------------
// F. OPTIONAL LIVE CONCURRENCY — two consumes race one token; exactly one wins.
//    Runs only with KTEBLI_DB_URL set and psql available (--allow-run). Any
//    absence/tooling error SKIPS (never fails the suite). Creates and deletes
//    its own adv2-live-* row; the report ran the fuller 25x stress + RLS matrix.
// ---------------------------------------------------------------------------
console.log("\nF. LIVE FOR-UPDATE SERIALISATION (optional; needs KTEBLI_DB_URL)");
// Reading the env var itself needs --allow-env; the suite runs with --allow-read only,
// so treat a denied lookup exactly like an unset var — F is optional and must SKIP,
// never throw and fail the suite (see the contract note above).
let dbUrl: string | undefined;
try {
  dbUrl = Deno.env.get("KTEBLI_DB_URL");
} catch {
  dbUrl = undefined;
}
if (!dbUrl) {
  console.log("  skip  KTEBLI_DB_URL unset — see reports/adversarial/invariant-2-sufficiency.md §Reproduction");
} else {
  try {
    const psql = async (sql: string): Promise<string> => {
      const { stdout } = await new Deno.Command("psql", {
        args: [dbUrl, "-Atc", sql],
        stdout: "piped",
        stderr: "piped",
      }).output();
      return new TextDecoder().decode(stdout).trim();
    };
    const rnd = crypto.getRandomValues(new Uint8Array(24));
    const tok = Array.from(rnd).map((b) => b.toString(16).padStart(2, "0")).join(""); // 48 hex
    const fp = "d".repeat(64);
    const email = `adv2-live-${tok.slice(0, 8)}@example.invalid`;
    await psql(
      `insert into public.pre_intakes (email,tier,org_name,sufficiency,sufficiency_cleared,` +
        `sufficiency_fingerprint,sufficiency_score,sufficiency_threshold,sufficiency_scorer,` +
        `sufficiency_contract,sufficiency_at,checkout_token,checkout_token_at) values ` +
        `('${email}','draft','Live Probe','{}'::jsonb,true,'${fp}',2,1,'referent-count-v1',` +
        `'1.0.0',now(),'${tok}',now());`,
    );
    // session A holds the consume txn open ~1.2s; session B fires into the lock
    const a = new Deno.Command("psql", {
      args: [dbUrl, "-Atc",
        `begin; select (public.consume_checkout_token('${tok}','liveA','${fp}') is not null); ` +
        `select pg_sleep(1.2); commit;`],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    await new Promise((r) => setTimeout(r, 400));
    const bOut = await psql(`select (public.consume_checkout_token('${tok}','liveB','${fp}') is not null);`);
    const aRaw = await a.output();
    const aOut = new TextDecoder().decode(aRaw.stdout);
    const aWon = /(^|\n)t(\n|$)/.test(aOut);
    const bWon = bOut === "t";
    const winners = (aWon ? 1 : 0) + (bWon ? 1 : 0);
    ok(winners === 1, `exactly one consume won the race (A=${aWon} B=${bOut || "?"})`);
    await psql(`delete from public.pre_intakes where email = '${email}';`);
  } catch (e) {
    console.log(`  skip  live block errored (tooling/permissions): ${String(e).slice(0, 120)}`);
  }
}

console.log(`\n${bad === 0 ? "ALL HELD — invariant 2 CONCEDED (no break found)" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
