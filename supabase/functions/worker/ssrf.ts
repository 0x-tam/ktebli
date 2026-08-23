export class SsrfError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "SsrfError";
  }
}

const BLOCKED_HOST_RE =
  /(^localhost$)|(\.local$)|(\.internal$)|(^metadata\.google\.internal$)|(\.lan$)|(^ip6-)/i;

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && p[2] === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6Blocked(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fe8") || ip.startsWith("fe9") ||
      ip.startsWith("fea") || ip.startsWith("feb")) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const m = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) return ipv4Blocked(m[1]);
  return false;
}

function ipBlocked(ip: string): boolean {
  return ip.includes(":") ? ipv6Blocked(ip) : ipv4Blocked(ip);
}

const isIpLiteral = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":");

async function assertHostSafe(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new SsrfError("bad_host");
  if (BLOCKED_HOST_RE.test(host)) throw new SsrfError("blocked_host");
  if (isIpLiteral(host)) {
    if (ipBlocked(host)) throw new SsrfError("blocked_ip_literal");
    return;
  }
  let addrs: string[] = [];
  for (const kind of ["A", "AAAA"] as const) {
    try {
      addrs = addrs.concat(await Deno.resolveDns(host, kind));
    } catch { /* record kind may be absent */ }
  }
  if (!addrs.length) throw new SsrfError("dns_unresolved");
  for (const a of addrs) if (ipBlocked(a)) throw new SsrfError("resolves_to_private");
}

export interface SafeFetchOpts {
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
  allowContentTypes?: RegExp;
  userAgent?: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

export async function safeFetchText(
  rawUrl: string,
  opts: SafeFetchOpts = {},
): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const allow = opts.allowContentTypes ?? /^(text\/|application\/(xhtml\+xml|json|xml))/i;
  const ua = opts.userAgent ?? "KtebliBot/1.0 (+https://ktebli.com)";

  let url = rawUrl.trim();
  if (url.length > 2048 || /\s/.test(url)) throw new SsrfError("bad_url");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let u: URL;
      try { u = new URL(url); } catch { throw new SsrfError("bad_url"); }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new SsrfError("bad_protocol");
      await assertHostSafe(u.hostname);

      const resp = await fetch(u.toString(), {
        redirect: "manual",
        signal: ctl.signal,
        headers: { "user-agent": ua, "accept": "text/html,application/xhtml+xml,text/plain" },
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        try { await resp.body?.cancel(); } catch { /* noop */ }
        if (!loc) throw new SsrfError("redirect_no_location");
        if (hop === maxRedirects) throw new SsrfError("too_many_redirects");
        url = new URL(loc, u).toString();
        continue;
      }

      const ct = resp.headers.get("content-type") ?? "";
      if (!allow.test(ct)) { try { await resp.body?.cancel(); } catch { /* noop */ } throw new SsrfError("bad_content_type"); }

      const reader = resp.body?.getReader();
      if (!reader) return { finalUrl: u.toString(), status: resp.status, contentType: ct, body: "" };
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > maxBytes) { try { await reader.cancel(); } catch { /* noop */ } break; }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(Math.min(total, maxBytes));
      let off = 0;
      for (const c of chunks) { if (off + c.length > buf.length) { buf.set(c.subarray(0, buf.length - off), off); break; } buf.set(c, off); off += c.length; }
      return { finalUrl: u.toString(), status: resp.status, contentType: ct, body: new TextDecoder().decode(buf) };
    }
    throw new SsrfError("too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}

export function stripHtml(raw: string, cap = 60_000): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, cap);
  }
