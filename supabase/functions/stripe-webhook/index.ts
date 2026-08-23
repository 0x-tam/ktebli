// Stripe webhook v9: payment -> order + stages.
// v9 change ONLY: the stage list matches the worker v12 intelligence pipeline
// (org intelligence, strategy, project design, validate) with honest customer
// labels — every listed stage actually runs; nothing is fake progress.
// Carries the v7/v8 base: org-identity fields + security hardening (constant-
// time signature comparison with 300s tolerance, event-id idempotency via
// stripe_event_seen(), graceful duplicate handling, server-side price/tier
// authority — a tier/amount mismatch parks the order with NO work queued).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
  const priceOk = typeof expectedUsd === "number" && Math.abs(paidUsd - expectedUsd) < 0.01;

  // primary source of truth: the wizard's saved intake
  let pi: Record<string, unknown> | null = null;
  const ref = s.client_reference_id ?? "";
  if (/^[0-9a-f-]{36}$/.test(ref)) {
    const found = await sel(`pre_intakes?id=eq.${ref}&select=*`);
    if (found.length) pi = found[0];
  }
  if (!pi && email) {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const found = await sel(
      `pre_intakes?email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(cutoff)}&order=created_at.desc&limit=1`);
    if (found.length) pi = found[0];
  }

  // legacy custom fields, if a link still carries them
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

  let order;
  try {
    order = await ins("orders", {
      stripe_session_id: s.id, organisation_id: orgId, email,
      org_name: orgName, org_reg: regNo, org_website: website, whatsapp: phone, tier,
      amount_usd: paidUsd, grant_input: grantInput,
      directions, deadline, uploads_expected: uploadsExpected,
      ...(priceOk ? {} : { status: "attention" }),
    });
  } catch (e) {
    if (String(e).toLowerCase().includes("duplicate")) return new Response("duplicate", { status: 200 });
    throw e;
  }

  if (!priceOk) {
    // Charged amount does not match the claimed tier: park the order, audit it,
    // queue NO paid work and wake NO worker. A human resolves it.
    await ins("events", {
      actor: "stripe-webhook", action: "price_mismatch", entity: "order", entity_id: order.id,
      detail: { tier, paid_usd: paidUsd, expected_usd: expectedUsd ?? null, session: s.id },
    }, false).catch(() => {});
    await ins("escalations", {
      kind: "price_mismatch", detail: `Order ${order.order_no}: tier ${tier} paid $${paidUsd}, expected $${expectedUsd ?? "?"}`,
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
