// Shared CORS + rate-limit + client-IP helpers.
//
// WS4a 2026-08-28 — two silent-pass fixes, proven before fixing
// (reports/phase4-compliance.md §A5):
//
//  * rateLimit failed OPEN: any rl_hit failure (non-2xx, network, RPC missing)
//    returned `true` and the caller proceeded as if the check had passed. A
//    broken rate limiter silently became no rate limiter — unbounded intake
//    rows, and on analyze-grant unbounded paid model calls. It now fails
//    CLOSED and logs why: refusing costs one visible 429 a customer can retry;
//    failing open is invisible until the bill arrives. Same asymmetry as
//    worker/donor_limits.ts.
//  * clientIp trusted the FIRST x-forwarded-for entry. Proxies APPEND: any
//    client-sent XFF values come first and the platform appends the real peer
//    address last, so the first entry is attacker-chosen per request and the
//    per-IP limit was keyed on it. The LAST entry is the address that actually
//    connected to the edge and is the one to key on.
const ALLOWED_ORIGINS = new Set<string>([
  "https://ktebli.com",
  "https://www.ktebli.com",
  "https://ktebli.vercel.app",
  "https://ktebli-privs-projects-73c7bb38.vercel.app",
]);

export function corsHeaders(req: Request, methods = "POST, OPTIONS"): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://ktebli.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  // Last entry: appended by the connecting edge, not supplied by the client.
  const last = parts.length ? parts[parts.length - 1] : "";
  return last || req.headers.get("x-real-ip") || "unknown";
}

export async function rateLimit(
  sbUrl: string,
  serviceKey: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const r = await fetch(`${sbUrl}/rest/v1/rpc/rl_hit`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_key: key, p_max: max, p_window_seconds: windowSeconds }),
    });
    if (!r.ok) {
      // Fail CLOSED, loudly. A limiter that cannot answer has not said yes.
      console.error(JSON.stringify({ rl_hit: "http_" + r.status, key }));
      return false;
    }
    return (await r.json()) === true;
  } catch (e) {
    console.error(JSON.stringify({ rl_hit: "unreachable", key, err: String(e).slice(0, 120) }));
    return false;
  }
}
