// Persists wizard answers just before Stripe; returns the row id so checkout
// can carry it as client_reference_id. v4: also stores the organisation website.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, clientIp, rateLimit } from "./http.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS = corsHeaders(req, "POST, OPTIONS");
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const ip = clientIp(req);
  if (!(await rateLimit(SB, KEY, `intake:ip:${ip}`, 40, 3600))) return json({ ok: false, reason: "rate_limited" }, 429);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* noop */ }
  const email = String(b.email ?? "").trim().slice(0, 200);
  if (!email.includes("@")) return json({ ok: false }, 400);
  if (!(await rateLimit(SB, KEY, `intake:em:${email.toLowerCase()}`, 20, 3600))) return json({ ok: false, reason: "rate_limited" }, 429);

  const row = {
    email,
    org_name: String(b.org ?? "").slice(0, 300) || null,
    org_reg: String(b.registration ?? "").slice(0, 100) || null,
    org_website: String(b.website ?? "").slice(0, 300) || null,
    grant_input: String(b.grant ?? "").slice(0, 100_000) || null,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline ?? "")) ? b.deadline : null,
    directions: String(b.directions ?? "").slice(0, 8000) || null,
    upload_names: Array.isArray(b.files) ? (b.files as string[]).slice(0, 3).map((f) => String(f).slice(0, 200)) : null,
  };
  const r = await fetch(`${SB}/rest/v1/pre_intakes`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}`, prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) return json({ ok: false }, 500);
  const saved = (await r.json())[0];
  return json({ ok: true, id: saved.id });
});
