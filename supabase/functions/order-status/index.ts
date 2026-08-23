// Order tracking API v4: rate-limited (throttles token/session guessing),
// scoped CORS. Access is still gated by the unguessable order token (random
// UUID) or the Stripe session id.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, clientIp, rateLimit } from "./http.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

async function sel(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`sel ${path}: ${r.status}`);
  return await r.json();
}
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function signUrl(path: string): Promise<string | null> {
  const r = await fetch(`${SB}/storage/v1/object/sign/order-files/${path}`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) });
  if (!r.ok) return null;
  const { signedURL } = await r.json();
  return `${SB}/storage/v1${signedURL}`;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req, "GET, OPTIONS");
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const session = url.searchParams.get("session") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(token) && !/^cs_[A-Za-z0-9_]+$/.test(session)) {
    return json({ ok: false, reason: "bad_token" }, 400);
  }

  const ip = clientIp(req);
  if (!(await rateLimit(SB, KEY, `status:ip:${ip}`, 120, 600))) return json({ ok: false, reason: "rate_limited" }, 429);

  const support = (await rpc("get_secret", { p_name: "support_email" })) ?? "hello@ktebli.com";
  const q = token ? `orders?token=eq.${token}&select=*` : `orders?stripe_session_id=eq.${encodeURIComponent(session)}&select=*`;
  const orders = await sel(q);
  if (!orders.length) return json({ ok: true, pending: true, support });

  const o = orders[0];
  const props = await sel(`order_proposals?order_id=eq.${o.id}&select=id,title,status,revisions_used,revisions_cap,created_at&order=created_at`);
  const result = [];
  for (const p of props) {
    const stages = await sel(`job_stages?proposal_id=eq.${p.id}&select=seq,key,label,status,started_at,finished_at,output&order=seq`);
    const files: Array<{ name: string; url: string; version: number }> = [];
    for (const st of stages) {
      if (st.key === "package" && st.status === "done" && st.output?.files) {
        for (const f of st.output.files) {
          const signed = await signUrl(f.path);
          if (signed) files.push({ name: f.name, url: signed, version: f.version ?? 1 });
        }
      }
    }
    result.push({
      id: p.id, title: p.title, status: p.status,
      revisions_used: p.revisions_used, revisions_cap: p.revisions_cap,
      stages: stages.map((s: Record<string, unknown>) => ({
        seq: s.seq, label: s.label, status: s.status,
        started_at: s.started_at, finished_at: s.finished_at,
        note: s.status === "held" || s.status === "failed"
          ? "The final checks on this document are taking a little longer than usual. If this does not clear shortly, we will follow up by email."
          : null,
      })),
      files,
    });
  }
  return json({
    ok: true, support,
    order: { token: o.token, order_no: o.order_no, status: o.status, tier: o.tier, org_name: o.org_name, created_at: o.created_at, email: o.email },
    proposals: result,
  });
});
