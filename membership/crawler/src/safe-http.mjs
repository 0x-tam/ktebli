import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";

export class CrawlError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}
export const USER_AGENT = "KtebliOpportunityBot/1.0";
export function allowedUrl(input) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new CrawlError("url_not_allowed");
  const host = u.hostname.toLowerCase();
  const pathOk =
    host === "www.ppa.gov.lb"
      ? /^\/(robots\.txt|(?:en|ar)(?:\/tenders(?:\/details\/\d+)?)?\/?$)/.test(
          u.pathname,
        )
      : host === "www.cdr.gov.lb"
        ? /^\/robots\.txt$/.test(u.pathname) ||
          /^\/en-US\/Procurment\.aspx$/i.test(u.pathname) ||
          /^\/Procurment(?:\/ProcurementDetail\.aspx)?$/i.test(u.pathname)
        : (host === "www.ungm.org" &&
            (/^\/robots\.txt$/.test(u.pathname) ||
              /^\/Public\/Notice\/\d+$/.test(u.pathname))) ||
          (host === "mawred.org" &&
            (/^\/robots\.txt$/.test(u.pathname) ||
              u.pathname === "/artistic-creativity/production-awards/"));
  if (!pathOk) throw new CrawlError("url_not_allowed");
  if (host === "www.ungm.org" && u.search)
    throw new CrawlError("query_not_allowed");
  if (
    host === "mawred.org" &&
    u.search !== "" &&
    !(
      u.pathname === "/artistic-creativity/production-awards/" &&
      u.search === "?lang=en"
    )
  )
    throw new CrawlError("query_not_allowed");
  for (const key of u.searchParams.keys())
    if (
      !["page", "id", "lot", "stage"].includes(key) &&
      !(host === "mawred.org" && key === "lang")
    )
      throw new CrawlError("query_not_allowed");
  u.hash = "";
  return u;
}
export function publicIp(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublic(host, resolver = lookup) {
  const answers = await resolver(host, { all: true, verbatim: true });
  if (!answers.length || answers.some((a) => !publicIp(a.address)))
    throw new CrawlError("non_public_dns");
  return answers[0];
}
export function blockedBody(text) {
  return /<title>\s*(Just a moment|Access denied)|cf-chl-|g-recaptcha|hcaptcha|verify you are human|type=["']password["']/i.test(
    text,
  );
}
// DNS is validated once, then the TLS socket is pinned to that address. The URL
// hostname remains the TLS SNI/certificate authority; redirects start over.
export function pinnedRequest(
  url,
  address,
  { maxBytes = 4_000_000, timeoutMs = 25_000, request = https.request } = {},
) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        agent: false,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,text/plain",
          "accept-encoding": "identity",
        },
        lookup(_host, options, callback) {
          callback(
            null,
            ...(options?.all ? [[address]] : [address.address, address.family]),
          );
        },
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new CrawlError("response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: decodeBody(
                Buffer.concat(chunks),
                res.headers["content-type"],
              ),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new CrawlError("request_timeout")),
      timeoutMs,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}
export function decodeBody(bytes, contentType = "") {
  const declared =
    String(contentType).match(/charset\s*=\s*["']?([a-z0-9-]+)/i)?.[1] ||
    bytes
      .subarray(0, 1024)
      .toString("latin1")
      .match(/<meta[^>]+charset\s*=\s*["']?([a-z0-9-]+)/i)?.[1] ||
    "utf-8";
  if (
    !["utf-8", "utf8", "windows-1252", "iso-8859-1"].includes(
      declared.toLowerCase(),
    )
  )
    throw new CrawlError("unsupported_character_encoding");
  return new TextDecoder(declared).decode(bytes);
}
export class SafeHttp {
  constructor({
    resolver = lookup,
    transport = pinnedRequest,
    minIntervalMs = 1200,
    maxBytes = 4_000_000,
    urlPolicy = allowedUrl,
    contentTypes = /^text\/(html|plain)/i,
  } = {}) {
    this.urlPolicy = urlPolicy;
    this.contentTypes = contentTypes;
    this.resolver = resolver;
    this.transport = transport;
    this.minIntervalMs = minIntervalMs;
    this.maxBytes = maxBytes;
    this.last = 0;
    this.robots = new Map();
  }
  async raw(input, { robotsRequest = false } = {}) {
    let url = this.urlPolicy(input);
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (!robotsRequest) await this.assertRobots(url);
      const address = await resolvePublic(url.hostname, this.resolver);
      await new Promise((r) =>
        setTimeout(r, Math.max(0, this.last + this.minIntervalMs - Date.now())),
      );
      this.last = Date.now();
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await this.transport(url, address, {
          maxBytes: this.maxBytes,
        });
        if (![429, 500, 502, 503, 504].includes(response.status)) break;
        if (attempt === 2) throw new CrawlError("retry_exhausted");
        const retry = Math.min(
          10_000,
          Math.max(
            1500 * 2 ** attempt,
            Number(response.headers["retry-after"] || 0) * 1000,
          ),
        );
        await new Promise((r) => setTimeout(r, retry));
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.headers.location)
          throw new CrawlError("invalid_redirect");
        url = this.urlPolicy(new URL(response.headers.location, url));
        continue;
      }
      if ([401, 403].includes(response.status) || blockedBody(response.body))
        throw new CrawlError("access_blocked");
      if (robotsRequest && response.status === 404)
        return { ...response, url: url.href };
      if (response.status !== 200)
        throw new CrawlError(`http_${response.status}`);
      if (!this.contentTypes.test(response.headers["content-type"] || ""))
        throw new CrawlError("content_type_not_allowed");
      return { ...response, url: url.href };
    }
    throw new CrawlError("redirect_limit");
  }
  async assertRobots(url) {
    let rules = this.robots.get(url.origin);
    if (!rules) {
      const r = await this.raw(`${url.origin}/robots.txt`, {
        robotsRequest: true,
      });
      // Ambiguous robots responses fail closed; only explicit 404 means absent.
      if (r.status !== 404 && /<html/i.test(r.body))
        throw new CrawlError("robots_unavailable");
      rules = robotsParser(
        `${url.origin}/robots.txt`,
        r.status === 404 ? "" : r.body,
      );
      this.robots.set(url.origin, rules);
    }
    if (rules.isAllowed(url.href, USER_AGENT) === false)
      throw new CrawlError("robots_disallowed");
    const delay = rules.getCrawlDelay(USER_AGENT);
    if (Number.isFinite(delay))
      this.minIntervalMs = Math.max(this.minIntervalMs, delay * 1000);
  }
  async get(url) {
    return this.raw(url);
  }
}
