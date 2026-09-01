// Stripe webhook v10: payment -> order + stages, gated by sufficiency clearance.
// v10 change (invariant 2, WS3's phase-3 exit blocker): this function REFUSES
// order-with-work creation unless the session carries a valid, single-use,
// fingerprint-matched clearance minted by save-intake:
//
//   * client_reference_id must be a checkout_token minted by the gate;
//   * the pre_intakes row it names is re-canonicalised through the SAME code
//     that scored it (clearance.ts / worker/sufficiency.ts) and the recomputed
//     fingerprint is handed to consume_checkout_token(), which re-checks the
//     stored clearance, the fingerprint, single-use and TTL atomically and
//     refuses by default;
//   * the cleared tier must equal the PAID tier — a clearance earned for one
//     tier does not authorise a charge for another;
//   * a charge with no valid clearance parks the order as `attention` with a
//     `payment_ungated` escalation at priority `immediate` (money moved, no
//     work queued, no worker woken — 20260826180000's design). The 48-hour
//     any-intake-with-this-email fallback is GONE: it was hole #2 in that
//     migration's header.
//
// Carries the v9 base: honest stage labels; v7/v8 security hardening (constant-
// time signature comparison with 300s tolerance, event-id idempotency via
// stripe_event_seen(), graceful duplicate handling, server-side price/tier
// authority — a tier/amount/currency mismatch parks the order with NO work
// queued; a missing customer email parks likewise).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { intakeFilesQuery, uploadsFromFiles, fingerprintOfRow } from "./clearance.ts";
import { SLOTS } from "../worker/sufficiency.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}` };

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${name}: ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function ins(table: string, row: unknown, ret = true) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method: "POST", headers: { ...H, prefer: ret ? "return=representation" : "return=minimal" }, body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insert ${table}: ${r.status} ${await r.text()}`);
  return ret ? (await r.json())[0] : null;
}
async function sel(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`select ${path}: ${r.status}`);
  return await r.json();
}

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

async function verifyStripeSig(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts["t"], v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(hex, v1);
}

const REV_CAPS: Record<string, number> = { trial: 1, draft: 1, competitive: 3, full: 10 };
// Server-owned canonical prices in USD — the browser can never set these.
const PRICES_USD: Record<string, number> = { trial: 1, draft: 149, competitive: 299, full: 449 };

function stagesFor(tier: string): Array<[string, string]> {
  const base: Array<[string, string]> = [
    ["analyze", "Analysing the opportunity and donor requirements"],
    ["org", "Reviewing your organisation"],
    ["voice", "Reviewing your previous proposals"],
    ["strategy", "Developing your proposal approach"],
    ["design", "Designing your project"],
    ["gen:narrative", "Drafting the proposal"],
  ];
  if (tier === "competitive" || tier === "full") {
    base.push(["gen:concept_note", "Writing the concept note"]);
    base.push(["gen:budget", "Building the budget"]);
    base.push(["gen:budget_justification", "Writing the budget justification"]);
    base.push(["gen:cover_email", "Preparing your covering email"]);
  }
  if (tier === "full") {
    base.push(["gen:workplan", "Laying out the workplan"]);
    base.push(["gen:logframe", "Building the logframe"]);
    base.push(["gen:risk_table", "Preparing the risk table"]);
    base.push(["gen:board_summary", "Writing your board summary"]);
  }
  base.push(["validate", tier === "full" ? "Running the deeper final review" : "Checking requirements, facts and consistency"]);
  base.push(["check", "Checking it against every other proposal on this grant"]);
  base.push(["package", "Preparing your documents and checking layout"]);
  base.push(["deliver", "Finalising"]);
  return base;
}

async function sendEmail(to: string, subject: string, html: string) {
  const key = await rpc("get_secret", { p_name: "resend_api_key" });
  const from = (await rpc("get_secret", { p_name: "email_from" })) ?? "Ktebli <onboarding@resend.dev>";
  if (!key) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const payload = await req.text();
  const whsec = await rpc("get_secret", { p_name: "stripe_webhook_secret" });
  if (!whsec) return new Response("webhook secret not configured", { status: 500 });
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeSig(payload, sig, whsec))) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed") return new Response("ignored", { status: 200 });

  // idempotency on the Stripe event id (unique insert; true = already processed)
  try {
    const seen = await rpc("stripe_event_seen", { p_id: String(event.id ?? "") });
    if (seen === true) return new Response("duplicate event", { status: 200 });
  } catch { /* fail open to session-id dedupe below */ }

  const s = event.data.object;

  const existing = await sel(`orders?stripe_session_id=eq.${s.id}&select=id`);
  if (existing.length > 0) return new Response("duplicate", { status: 200 });

  const email = s.customer_details?.email ?? s.customer_email ?? "";
  const phone = s.customer_details?.phone ?? null;
  const tier = String(s.metadata?.tier ?? "draft");
  const paidUsd = (s.amount_total ?? 0) / 100;
  const expectedUsd = PRICES_USD[tier];
  // WS4a 2026-08-28: the price check read amount_total without reading the
  // currency, so 149.00 in ANY currency satisfied the USD 149 tier (proven,
  // reports/phase4-compliance.md §A7). A non-USD session now parks exactly like
  // a price mismatch: NO paid work on an amount the check cannot value.
  const currency = String(s.currency ?? "usd").toLowerCase();
  const priceOk = currency === "usd" &&
    typeof expectedUsd === "number" && Math.abs(paidUsd - expectedUsd) < 0.01;
  // An order with no reachable email would complete unpaid-for work with no way
  // to deliver a link or a failure notice. Park it for the operator instead of
  // silently accepting an undeliverable order.
  const emailOk = email.includes("@");

  // ---- invariant 2: the clearance, or nothing --------------------------------
  // The ONLY source of intake truth is the pre_intakes row named by a valid
  // checkout token. No token, unknown token, tier mismatch, fingerprint
  // mismatch, reuse or expiry -> pi stays null and the charge parks below.
  let pi: Record<string, unknown> | null = null;
  let clearanceFp: string | null = null;
  let clearanceWhy = "token_absent";
  const token = String(s.client_reference_id ?? "");
  if (token.length >= 32 && /^[0-9a-f]+$/.test(token)) {
    const found = await sel(`pre_intakes?checkout_token=eq.${encodeURIComponent(token)}&select=*`);
    if (!found.length) {
      clearanceWhy = "token_unknown";
    } else if (String(found[0].tier ?? "") !== tier) {
      clearanceWhy = "tier_mismatch";
    } else {
      // Recompute the fingerprint from the row's own current answers plus the
      // same uploaded-file set the clearance covered; the SQL gate compares it
      // to the recorded one and refuses on any difference, atomically.
      const uploads = uploadsFromFiles(await sel(intakeFilesQuery(String(found[0].email ?? ""))));
      clearanceFp = await fingerprintOfRow(found[0], uploads);
      const consumed = await rpc("consume_checkout_token", {
        p_token: token, p_session: s.id, p_fingerprint: clearanceFp,
      });
      if (consumed) { pi = consumed as Record<string, unknown>; clearanceWhy = ""; }
      else clearanceWhy = "refused_by_gate"; // the exact reason is the gate's own checkout_refused events row
    }
  }
  const clearanceOk = pi !== null;

  // legacy custom fields, if a link still carries them (parked-path labelling
  // only — they can never substitute for a clearance)
  const cf: Record<string, string> = {};
  for (const f of s.custom_fields ?? []) cf[f.key] = f.text?.value ?? "";

  const orgName = (pi?.org_name as string) || cf["organisation"] || "Customer organisation";
  const regNo = (pi?.org_reg as string) || cf["registration_number"] || null;
  const website = (pi?.org_website as string) || null;
  const grantInput = (pi?.grant_input as string) || cf["grant_link"] || "";
  const directions = (pi?.directions as string) || null;
  const deadline = (pi?.deadline as string) || null;
  const uploadsExpected = ((pi?.upload_names as string[]) ?? []).length;

  let orgId: string | null = null;
  if (regNo) {
    const found = await sel(`organisations?registration_number=eq.${encodeURIComponent(regNo)}&select=id`);
    if (found.length) orgId = found[0].id;
  }
  if (!orgId && email) {
    const found = await sel(`organisations?email=eq.${encodeURIComponent(email)}&select=id`);
    if (found.length) orgId = found[0].id;
  }
  if (!orgId) {
    const org = await ins("organisations", {
      name: orgName, registration_number: regNo ?? `PENDING-${s.id.slice(-12)}`,
      email, whatsapp: phone, sanctions_status: "pending",
    });
    orgId = org.id;
  }

  const funded = priceOk && emailOk && clearanceOk;
  // The answers travel to the order RAW (20260826180000 §4): the worker rebuilds
  // the E-ASK and E-INTAKE ledger items through the same intake the gate scored.
  // Derived state never crosses the payment boundary. The six particularity
  // slots and escapes are their own pre_intakes columns; the extended evidence-
  // interview facts (admin certifications, named org facts, extra links) are the
  // stored intake_facts jsonb — spread here so orders.intake_answers carries the
  // one flat shape the worker reads.
  const storedFacts = (pi && pi.intake_facts && typeof pi.intake_facts === "object" && !Array.isArray(pi.intake_facts))
    ? pi.intake_facts as Record<string, unknown>
    : {};
  const intakeAnswers: Record<string, unknown> | null = clearanceOk
    ? {
      ...Object.fromEntries(SLOTS.map((sl) => [sl.id, (pi![sl.id] as string | null) ?? null])),
      venue_escape: (pi!.venue_escape as string | null) ?? null,
      never_delivered: pi!.never_delivered === true,
      ...storedFacts,
    }
    : null;
  let order;
  try {
    order = await ins("orders", {
      stripe_session_id: s.id, organisation_id: orgId, email,
      org_name: orgName, org_reg: regNo, org_website: website, whatsapp: phone, tier,
      amount_usd: paidUsd, grant_input: grantInput,
      directions, deadline, uploads_expected: uploadsExpected,
      // The order remembers its licence (or records that it has none).
      pre_intake_id: clearanceOk ? pi!.id : null,
      sufficiency_fingerprint: clearanceOk ? clearanceFp : null,
      intake_answers: intakeAnswers,
      ...(funded ? {} : { status: "attention" }),
    });
  } catch (e) {
    if (String(e).toLowerCase().includes("duplicate")) return new Response("duplicate", { status: 200 });
    throw e;
  }

  if (!funded) {
    // The charge cannot be honoured as an order: the amount does not match the
    // tier, or the currency is not USD, or there is no reachable customer
    // email, or — invariant 2 — no valid sufficiency clearance authorised the
    // checkout. Park the order, audit it, queue NO paid work and wake NO
    // worker. Money moved, so the operator is alerted either way; the ungated
    // case alerts at priority immediate because the documented remedy is a
    // refund (20260826180000 §5) and this codebase has no Stripe refund
    // plumbing (a deliberate phase-3 decision, reports/phase3-gate.md §7.1).
    const why = !priceOk ? "price_mismatch" : !emailOk ? "email_missing" : "payment_ungated";
    await ins("events", {
      actor: "stripe-webhook", action: why, entity: "order", entity_id: order.id,
      detail: {
        tier, paid: paidUsd, currency, expected_usd: expectedUsd ?? null,
        email_ok: emailOk, clearance_ok: clearanceOk, clearance_why: clearanceWhy || null, session: s.id,
      },
    }, false).catch(() => {});
    // NOTE (WS4a): on the schema at migration head these inserts write rows
    // (kinds allowed and due_at defaulted — 20260826150000/20260828120000). On
    // the PRODUCTION schema they still violate the kind CHECK and the due_at
    // NOT NULL, write zero rows, and are swallowed here — proven in
    // reports/phase4-compliance.md §F13. Deploy the migrations with this.
    await ins("escalations", {
      kind: !priceOk || !emailOk ? "price_mismatch" : "payment_ungated",
      ...(!priceOk || !emailOk ? {} : { priority: "immediate" }),
      detail: {
        order_no: order.order_no, why, tier, paid: paidUsd, currency,
        expected_usd: expectedUsd ?? null, email_ok: emailOk,
        clearance_why: clearanceWhy || null, session: s.id,
      },
    }, false).catch(() => {});
    return new Response(JSON.stringify({ ok: true, parked: true }), { status: 200 });
  }

  const prop = await ins("order_proposals", {
    order_id: order.id, title: "Proposal 1", revisions_cap: REV_CAPS[tier] ?? 1,
  });
  const rows = stagesFor(tier).map(([key, label], i) => ({ proposal_id: prop.id, seq: i + 1, key, label }));
  await ins("job_stages", rows, false);

  const site = (await rpc("get_secret", { p_name: "site_url" })) ?? "https://ktebli-privs-projects-73c7bb38.vercel.app";
  const support = (await rpc("get_secret", { p_name: "support_email" })) ?? "hello@ktebli.com";
  const track = `${site}/orders/${order.token}`;
  const sent = await sendEmail(
    email,
    `Ktebli is on it — Order ${order.order_no}`,
    `<p>Thank you — payment received and work has started on <b>Order ${order.order_no}</b>.</p>` +
      `<p><a href="${track}">Track your proposal live here</a>. Keep this link; it is your order page and works from any device.</p>` +
      `<p>Most proposals are ready within 5–30 minutes, depending on complexity. We will email you the moment everything is ready.</p>` +
      (uploadsExpected > 0 ? `<p>Your ${uploadsExpected} old proposal(s) are already being read to learn your organisation's voice.</p>` : "") +
      `<p>Questions? Write to ${support} and quote Order ${order.order_no}.</p><p>— Ktebli</p>`,
  );
  await fetch(`${SB}/rest/v1/orders?id=eq.${order.id}`, {
    method: "PATCH", headers: { ...H, prefer: "return=minimal" },
    body: JSON.stringify({ tracking_email_sent: sent, status: "processing" }),
  });

  const wsec = await rpc("get_secret", { p_name: "worker_secret" });
  if (wsec) {
    fetch(`${SB}/functions/v1/worker`, {
      method: "POST", headers: { "content-type": "application/json", "x-worker-secret": wsec }, body: "{}",
    }).catch(() => {});
  }
  return new Response(JSON.stringify({ ok: true, order: order.id }), { status: 200 });
});
