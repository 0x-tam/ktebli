// Shared CORS + rate-limit + client-IP helpers.

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
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
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
    if (!r.ok) return true;
    return (await r.json()) === true;
  } catch {
    return true;
  }
}
