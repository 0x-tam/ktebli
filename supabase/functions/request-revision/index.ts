// Customer revision request from the order page. Token-authorised, cap-enforced
// ATOMICALLY via submit_revision_request, including retry deduplication. Rate limited.
// v3: revisions re-run the exclusivity gate — a revised narrative must never
// drift closer to another customer's proposal on the same grant, so a `check`
// stage now runs between revise and package (contract parts 42/49).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, clientIp, rateLimit } from "./http.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}` };

async function rpc(name: string, args: Record<string, unknown>) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req, "POST, OPTIONS");
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);

  let b: Record<string, unknown> = {};
  try { const parsed = await req.json(); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) b = parsed; } catch { /* noop */ }
  const token = String(b.token ?? "");
  const proposalId = String(b.proposal_id ?? "");
  const requestId = String(b.request_id ?? "");
  const expectedRevision = b.expected_revision;
  const options = (Array.isArray(b.options) ? b.options : []).slice(0, 8).map((o) => String(o).slice(0, 60));
  const details = String(b.details ?? "").slice(0, 4000);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(token) || !uuid.test(proposalId)) return json({ ok: false, reason: "bad_input" }, 400);
  if (!uuid.test(requestId) || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) return json({ ok: false, reason: "bad_input" }, 400);
  if (!options.length && !details.trim()) return json({ ok: false, reason: "empty" }, 400);

  const ip = clientIp(req);
  if (!(await rateLimit(SB, KEY, `rev:tok:${token}`, 10, 3600)) ||
      !(await rateLimit(SB, KEY, `rev:ip:${ip}`, 20, 3600))) {
    return json({ ok: false, reason: "rate_limited" }, 429);
  }

  // One transaction authenticates ownership, deduplicates, claims the allowance,
  // stores the exact instructions, and queues every stage. Transport failure is
  // safely retryable with the same request id and expected revision.
  const claim = await rpc("submit_revision_request", {
    p_token: token, p_proposal: proposalId, p_request: requestId,
    p_expected_revision: expectedRevision, p_options: options, p_details: details,
  });
  if (!claim) return json({ ok: false, reason: "temporarily_unavailable" }, 503);
  if (claim.ok !== true) {
    const code = claim.reason === "not_found" ? 404 :
      ["request_conflict", "stale_revision", "not_complete"].includes(claim.reason) ? 409 : 400;
    return json(claim, code);
  }

  const wsec = await rpc("get_secret", { p_name: "worker_secret" });
  if (wsec) {
    fetch(`${SB}/functions/v1/worker`, {
      method: "POST", headers: { "content-type": "application/json", "x-worker-secret": wsec }, body: "{}",
    }).catch(() => {});
  }
  return json(claim);
});
