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

/**
 * The refusal reason when a response's content-type is not readable. The status
 * is part of the finding: a 403 that also carries a non-text (or missing)
 * content-type is a REFUSAL, not a transport failure, and the crawler must be
 * able to classify it as one. Discarding the status here would recreate, one
 * layer down, exactly the defect crawl_outcome.ts exists to fix — the
 * thefelixproject.org silent failure was a discarded status.
 */
export function ctRefusalReason(status: number): string {
  return status >= 200 && status < 300 ? "bad_content_type" : `bad_content_type_http_${status}`;
}

/**
 * Decode a body honouring its declared charset: the content-type header first,
 * then a <meta charset> in the first bytes, else UTF-8. Tiny-charity sites are
 * disproportionately windows-1252/iso-8859-1, and decoding those as UTF-8 turns
 * readable prose into replacement-character junk that the prose detector then
 * (correctly) refuses — a false extraction_failed. An unknown label falls back
 * to UTF-8 rather than failing.
 */
export function decodeBody(buf: Uint8Array, contentType: string): string {
  let label = /charset=["']?([\w.-]+)/i.exec(contentType ?? "")?.[1] ?? null;
  if (!label) {
    const head = new TextDecoder().decode(buf.subarray(0, 1024));
    label = /<meta[^>]+charset=["']?([\w.-]+)/i.exec(head)?.[1] ??
      /content=["'][^"']*charset=([\w.-]+)/i.exec(head)?.[1] ?? null;
  }
  if (label && !/^utf-?8$/i.test(label)) {
    try { return new TextDecoder(label.toLowerCase()).decode(buf); } catch { /* unknown label */ }
  }
  return new TextDecoder().decode(buf);
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
      if (!allow.test(ct)) { try { await resp.body?.cancel(); } catch { /* noop */ } throw new SsrfError(ctRefusalReason(resp.status)); }

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
      return { finalUrl: u.toString(), status: resp.status, contentType: ct, body: decodeBody(buf, ct) };
    }
    throw new SsrfError("too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}

// The common named entities, decoded to their characters. Everything else named
// still strips to a space, exactly as before. Numeric entities used to survive
// stripping as literal text ("St Aidan&#8217;s"), which both polluted referents
// and dragged a page's letter ratio down toward a false extraction_failed.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", middot: "·",
  pound: "£", euro: "€", cent: "¢", copy: "©", reg: "®", trade: "™", deg: "°",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", aacute: "á",
  ccedil: "ç", ouml: "ö", oacute: "ó", ocirc: "ô", uuml: "ü", uacute: "ú",
  auml: "ä", iacute: "í", ntilde: "ñ", szlig: "ß",
};

function entityChar(cp: number): string {
  if (!Number.isFinite(cp) || cp < 32 || (cp >= 127 && cp < 160) || cp > 0x10ffff) return " ";
  try { return String.fromCodePoint(cp); } catch { return " "; }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d{1,7});/g, (_, d) => entityChar(Number(d)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => entityChar(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (_, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? " ");
}

// Elements whose CONTENT is site furniture, not the organisation's prose. A nav
// menu stripped to bare words reads as "Volunteer Donate Get Help Menu Home
// About" — a run of capitalised words that the proper-noun counter (correctly,
// for narrative text) reads as one giant name. The phase-5 live run showed
// two-thirds of "referents" on real charity sites were exactly this. Removing
// the elements is the honest fix: the words were never the applicant's prose.
// <header>, <footer> and <form> are deliberately KEPT — real sites put
// straplines, addresses and charity numbers there — and the paragraph filter
// (crawl_outcome.keepParagraphs) handles the link lists they also carry.
const BOILERPLATE_RE =
  /<(nav|aside|menu|select|button|iframe|svg|noscript)\b[\s\S]*?<\/\1>/gi;

// Closing a block element ends a run of text. Without a real boundary here, a
// menu's last label glues onto the first word of the article ("About We run a
// pantry…") and a card grid's labels glue to each other. The sentinel becomes a
// newline AFTER source whitespace is collapsed, so the line structure of the
// OUTPUT reflects the block structure of the page, never the pretty-printing of
// its HTML.
const BLOCK_BOUNDARY_RE =
  /<\/?(p|div|li|ul|ol|dl|dt|dd|h[1-6]|tr|td|th|table|thead|tbody|section|article|main|header|footer|form|blockquote|figure|figcaption|pre|address)\b[^>]*>|<(br|hr)\b[^>]*\/?>/gi;

export function stripHtml(raw: string, cap = 60_000): string {
  // Block boundaries become a NUL sentinel, which survives the whitespace
  // collapse (NUL is not \s) and then becomes a real line break — so the line
  // structure of the OUTPUT reflects the block structure of the page, never the
  // pretty-printing of its HTML source.
  const S = "\u0000";
  return decodeEntities(
    raw
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(BOILERPLATE_RE, " ")
      .replace(BLOCK_BOUNDARY_RE, S)
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/ ?\u0000[\s\u0000]*/g, "\n")
    .replace(/^\n+|\n+$/g, "")
    .slice(0, cap);
}
