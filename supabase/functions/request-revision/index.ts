// Customer revision request from the order page. Token-authorised, cap-enforced
// ATOMICALLY via claim_revision (no concurrent over-cap). Rate limited.
// v3: revisions re-run the exclusivity gate — a revised narrative must never
// drift closer to another customer's proposal on the same grant, so a `check`
// stage now runs between revise and package (contract parts 42/49).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, clientIp, rateLimit } from "./http.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}` };

async function sel(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`sel ${path}`);
  return await r.json();
}
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  if (!r.ok) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req, "POST, OPTIONS");
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* noop */ }
  const token = String(b.token ?? "");
  const proposalId = String(b.proposal_id ?? "");
  const options = (Array.isArray(b.options) ? b.options : []).slice(0, 8).map((o) => String(o).slice(0, 60));
  const details = String(b.details ?? "").slice(0, 4000);
  if (!/^[0-9a-f-]{36}$/.test(token) || !/^[0-9a-f-]{36}$/.test(proposalId)) return json({ ok: false, reason: "bad_input" }, 400);
  if (!options.length && !details.trim()) return json({ ok: false, reason: "empty" }, 400);

  const ip = clientIp(req);
  if (!(await rateLimit(SB, KEY, `rev:tok:${token}`, 10, 3600)) ||
      !(await rateLimit(SB, KEY, `rev:ip:${ip}`, 20, 3600))) {
    return json({ ok: false, reason: "rate_limited" }, 429);
  }

  const orders = await sel(`orders?token=eq.${token}&select=id`);
  if (!orders.length) return json({ ok: false, reason: "not_found" }, 404);

  const claim = await rpc("claim_revision", { p_proposal: proposalId, p_order: orders[0].id });
  if (!claim || claim.ok !== true) {
    const reason = claim?.reason ?? "not_found";
    const code = reason === "not_found" ? 404 : 400;
    return json({ ok: false, reason, remaining: claim?.remaining ?? undefined }, code);
  }

  await fetch(`${SB}/rest/v1/revision_requests`, {
    method: "POST", headers: { ...H, prefer: "return=minimal" },
    body: JSON.stringify({ proposal_id: proposalId, options, details: details || null }),
  });

  const stages = await sel(`job_stages?proposal_id=eq.${proposalId}&select=seq&order=seq.desc&limit=1`);
  const base = (stages[0]?.seq ?? 0) as number;
  const version = claim.revisions_used + 1;
  const newStages = [
    { proposal_id: proposalId, seq: base + 1, key: "revise", label: "Making your requested changes" },
    { proposal_id: proposalId, seq: base + 2, key: "check", label: "Checking it against every other proposal on this grant" },
    { proposal_id: proposalId, seq: base + 3, key: "package", label: `Preparing your Version ${version} files` },
    { proposal_id: proposalId, seq: base + 4, key: "deliver", label: `Delivering Version ${version}` },
  ];
  const insR = await fetch(`${SB}/rest/v1/job_stages`, {
    method: "POST", headers: { ...H, prefer: "return=minimal" }, body: JSON.stringify(newStages),
  });
  if (!insR.ok) return json({ ok: false, reason: "stage_insert" }, 500);

  await fetch(`${SB}/rest/v1/orders?id=eq.${orders[0].id}`, {
    method: "PATCH", headers: { ...H, prefer: "return=minimal" },
    body: JSON.stringify({ status: "processing", completion_email_sent: false }),
  });

  const wsec = await rpc("get_secret", { p_name: "worker_secret" });
  if (wsec) {
    fetch(`${SB}/functions/v1/worker`, {
      method: "POST", headers: { "content-type": "application/json", "x-worker-secret": wsec }, body: "{}",
    }).catch(() => {});
  }
  return json({ ok: true, remaining: claim.remaining, version });
});
