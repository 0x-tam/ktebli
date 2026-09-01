// ============================================================================
// ADVERSARY: take Ktebli's money without clearing the sufficiency gate.
// Invariant 2: no money is taken for an order the system cannot fulfil.
//
// Attack surface (WS3's read-only finding, wired closed by ws6-core):
//   1. Reach checkout with no intake at all (index.html's 2500 ms timeout used
//      to navigate with client_reference_id null).
//   2. Clear the gate with good answers, edit them down, then pay.
//   3. Clear the gate for the draft tier, pay for full.
//   4. Skip save-intake entirely and let the webhook's 48-hour
//      any-intake-with-this-email fallback attach some other abandoned row.
//
// This suite executes the SHIPPING decision code (clearance.ts + sufficiency.ts
// are imported and run; they are what save-intake and stripe-webhook call) and
// asserts the HTTP glue by source, the same technique as the other adversarial
// suites (index-style handlers call Deno.serve at module scope and cannot be
// imported). The database half of the authority — consume_checkout_token()'s
// refusal matrix, single use, TTL, events — is executed for real against the
// replayed schema by tests/exclusivity/checkout_clearance_test.sql.
// ============================================================================

import {
  evaluateSufficiency,
  fingerprint,
} from "../../supabase/functions/worker/sufficiency.ts";
import {
  inputFromRow,
  fingerprintOfRow,
  mintCheckoutToken,
  uploadsFromFiles,
  intakeFilesQuery,
} from "../../supabase/functions/stripe-webhook/clearance.ts";

let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}

// ---------------------------------------------------------------------------
// 1. Refusal by default: the intake today's wizard actually sends (identity
//    only, no slot answers) does NOT clear. This is the gate's own hard floor;
//    if this ever passes, invariant 2 is open again.
// ---------------------------------------------------------------------------
console.log("1. AN IDENTITY-ONLY INTAKE REFUSES");
const identityOnlyRow: Record<string, unknown> = {
  email: "attacker@example.invalid",
  tier: "draft",
  org_name: "Beit Al-Shabab Community Association",
  org_reg: "1234-L",
  org_website: "https://example.org",
  grant_input: "https://donor.example.org/call",
  grant_analysis_ok: true, // even granting them a readable grant page
  deadline: null,
  never_delivered: false,
};
const identityVerdict = evaluateSufficiency(inputFromRow(identityOnlyRow, []));
ok(!identityVerdict.cleared, "identity-only intake is not cleared");
ok(identityVerdict.score < identityVerdict.threshold, `score ${identityVerdict.score} is under the floor ${identityVerdict.threshold}`);
ok(identityVerdict.gaps.length > 0, "the refusal names what is missing (gaps present)");

// ---------------------------------------------------------------------------
// 2. A genuinely sufficient intake clears, and its fingerprint is stable
//    across the payment boundary: the SAME row canonicalised by the SAME twin
//    module yields the SAME fingerprint on both sides.
// ---------------------------------------------------------------------------
console.log("\n2. A REAL INTAKE CLEARS, AND ITS FINGERPRINT ROUND-TRIPS");
const goodRow: Record<string, unknown> = {
  email: "real@example.invalid",
  tier: "draft",
  org_name: "Ashfield Youth Trust",
  org_reg: "1189922",
  org_website: "https://ashfieldyouth.example.org",
  grant_input: "x".repeat(700), // pasted guidelines over MIN_GRANT_CHARS
  grant_analysis_ok: false,
  deadline: null,
  site_place: "Tower Hamlets, London",
  site_venue: "the Old Bakehouse on Ashfield Road",
  site_activity: "a Thursday evening drop-in for 14-19s with hot food",
  // NB: distinct from the venue's referent — sufficiency.ts collapses referents
  // that share their distinctive tokens ("Ashfield Summer Kitchen" would merge
  // into "Old Bakehouse on Ashfield Road" and the slot would count as unnamed).
  last_delivery_what: "the Qobbe school-bag distribution",
  last_delivery_when: "winter 2024",
  local_trigger: "the council closed the Ashfield youth centre in April",
  venue_escape: null,
  never_delivered: false,
  // The core admin facts every UK grant application needs (phase 8).
  intake_facts: {
    income_band: "£10,000–£100,000",
    safeguarding_policy: true,
    safeguarding_lead_name: "Ruth Adeyemi",
    safeguarding_lead_role: "Trustee",
  },
};
const goodVerdict = evaluateSufficiency(inputFromRow(goodRow, []));
ok(goodVerdict.cleared, "a fully answered intake clears the hard floor");
const fpAtClearance = await fingerprint(inputFromRow(goodRow, []));
const fpAtWebhook = await fingerprintOfRow(goodRow, []);
ok(fpAtClearance === fpAtWebhook, "save-side and webhook-side fingerprints are identical for an untouched row");

// ---------------------------------------------------------------------------
// 3. Clear-then-edit refuses: any material change to the row after clearance
//    changes the fingerprint, so consume_checkout_token() refuses the charge.
// ---------------------------------------------------------------------------
console.log("\n3. CLEAR THEN EDIT -> FINGERPRINT MISMATCH");
for (const [field, value, label] of [
  ["site_venue", null, "deleting an answer"],
  ["site_place", "somewhere else entirely", "rewriting an answer"],
  ["org_name", "A Different Org", "swapping the organisation"],
  ["tier", "full", "swapping the tier (clearance for draft must not authorise full)"],
  // RESIDUAL, recorded: canonicalPayload covers the grant by LENGTH and
  // analysability, not by text — sufficiency.ts's own design (the gate never
  // scores grant text as evidence). A same-length different grant would keep
  // the fingerprint; the only customer-facing edit path is save-intake, which
  // re-evaluates and re-fingerprints, so this is not reachable from outside.
  ["grant_input", "y".repeat(800), "swapping the grant (different length)"],
  ["never_delivered", true, "flipping the no-track-record escape"],
] as Array<[string, unknown, string]>) {
  const tampered = { ...goodRow, [field]: value };
  const fpTampered = await fingerprintOfRow(tampered, []);
  ok(fpTampered !== fpAtClearance, `${label} changes the fingerprint`);
}
// the uploaded-file set is covered too
const fpWithUpload = await fingerprintOfRow(goodRow, uploadsFromFiles([
  { file_name: "old-proposal.docx", extracted_text: "t".repeat(500) },
]));
ok(fpWithUpload !== fpAtClearance, "adding an uploaded document after clearance changes the fingerprint");

// ---------------------------------------------------------------------------
// 4. Tokens: 48 hex chars, unpredictable shape, never minted on refusal (the
//    minting rule is asserted by source below; here the generator itself).
// ---------------------------------------------------------------------------
console.log("\n4. TOKEN SHAPE");
const t1 = mintCheckoutToken(), t2 = mintCheckoutToken();
ok(/^[0-9a-f]{48}$/.test(t1), "token is 48 hex chars (>= the SQL gate's 32-char floor)");
ok(t1 !== t2, "two mints differ");

// ---------------------------------------------------------------------------
// 5. The HTTP glue, by source (same technique as compliance_truncation_test):
//    the handlers call Deno.serve at module scope and cannot be imported.
// ---------------------------------------------------------------------------
console.log("\n5. THE GLUE IN save-intake/index.ts AND stripe-webhook/index.ts");
const saveSrc = await Deno.readTextFile(new URL("../../supabase/functions/save-intake/index.ts", import.meta.url));
const hookSrc = await Deno.readTextFile(new URL("../../supabase/functions/stripe-webhook/index.ts", import.meta.url));
const twinA = await Deno.readTextFile(new URL("../../supabase/functions/save-intake/clearance.ts", import.meta.url));
const twinB = await Deno.readTextFile(new URL("../../supabase/functions/stripe-webhook/clearance.ts", import.meta.url));

ok(twinA === twinB, "clearance.ts twins are byte-identical (one canonicalisation on both sides of the payment)");
ok(/evaluateSufficiency/.test(saveSrc), "save-intake runs the gate");
ok(/const token = verdict\.cleared \? mintCheckoutToken\(\) : null;/.test(saveSrc),
  "save-intake mints a checkout token ONLY on a cleared verdict — there is no other mint site");
ok((saveSrc.match(/mintCheckoutToken\(\)/g) ?? []).length === 1, "exactly one mint site exists");
ok(/consume_checkout_token/.test(hookSrc), "the webhook consumes the clearance through the SQL authority");
ok(/const funded = priceOk && emailOk && clearanceOk;/.test(hookSrc),
  "work is queued only when price, email AND clearance all hold");
ok(!/pre_intakes\?email=eq\./.test(hookSrc),
  "the 48-hour any-intake-with-this-email fallback is gone from the webhook");
const parkedAt = hookSrc.indexOf("if (!funded)");
const stagesAt = hookSrc.indexOf('ins("order_proposals"');
ok(parkedAt > 0 && stagesAt > parkedAt, "the proposal/stage insert sits after the parked-path return");
ok(/payment_ungated/.test(hookSrc), "an ungated charge writes the payment_ungated escalation (priority immediate)");
ok(/tier_mismatch/.test(hookSrc), "a clearance for one tier does not authorise a charge for another");
ok(/grant_analysis_ok: grantAnalysisOk/.test(saveSrc) && /safeFetchText/.test(saveSrc),
  "grant readability is decided server-side, never accepted from the client");
ok(!/b\.cleared|body\.cleared|answersIn\.cleared/.test(saveSrc),
  "nothing client-supplied can assert clearance");
// both sides must use the same uploaded-file set
ok(intakeFilesQuery("a@b.c").includes("order=created_at.desc&limit=3"),
  "the fingerprint's upload set is pinned to the same newest-3 query on both sides");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
