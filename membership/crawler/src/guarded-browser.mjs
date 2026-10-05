import { chromium } from "playwright";
import { SafeHttp, allowedUrl, blockedBody, CrawlError } from "./safe-http.mjs";

const EXTERNAL_ASSETS = new Set([
  "https://ajax.googleapis.com/ajax/libs/jquery/2.1.0/jquery.min.js",
  "https://code.jquery.com/ui/1.9.1/jquery-ui.js",
  "https://code.jquery.com/ui/1.9.1/themes/smoothness/jquery-ui.css",
  "https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.8/js/select2.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.8/css/select2.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.18.1/moment.min.js",
]);
const ASSET_HOSTS = new Set(
  [...EXTERNAL_ASSETS].map((s) => new URL(s).hostname),
);
export function cdrResourceUrl(input) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new CrawlError("url_not_allowed");
  if (
    EXTERNAL_ASSETS.has(u.href) ||
    (ASSET_HOSTS.has(u.hostname) && u.pathname === "/robots.txt" && !u.search)
  )
    return u;
  try {
    return allowedUrl(u);
  } catch {}
  if (u.hostname !== "www.cdr.gov.lb") throw new CrawlError("url_not_allowed");
  if (u.href.length > 4096) throw new CrawlError("url_too_long");
  if (u.pathname === "/CDR/Pages/LoadMore/LoadMoreProcurments.aspx") {
    if (
      [...u.searchParams.keys()].some(
        (k) => !["1", "stage", "Limit", "Offset"].includes(k),
      ) ||
      u.searchParams.get("1") !== "1" ||
      u.searchParams.get("Limit") !== "8" ||
      !["Ongoing", "Archive", "Others"].includes(u.searchParams.get("stage")) ||
      !/^\d+$/.test(u.searchParams.get("Offset") || "") ||
      Number(u.searchParams.get("Offset")) % 8 !== 0
    )
      throw new CrawlError("invalid_cdr_cursor");
    return u;
  }
  if (
    ["/ScriptResource.axd", "/WebResource.axd"].includes(u.pathname) &&
    [...u.searchParams.keys()].every((k) => ["d", "t"].includes(k))
  )
    return u;
  if (u.pathname === "/CMSPages/GetResource.ashx") {
    const keys = [...u.searchParams.keys()];
    if (
      keys.length !== 1 ||
      !["scriptfile", "stylesheetfile"].includes(keys[0])
    )
      throw new CrawlError("asset_not_allowed");
    const value = u.searchParams.get(keys[0]);
    if (
      !/^~?\/(CMSScripts\/Custom\/|App_Themes\/CDR\/)[\w./-]+\.(js|css)$/.test(
        value,
      ) ||
      value.includes("..")
    )
      throw new CrawlError("asset_not_allowed");
    return u;
  }
  if (
    /^\/(CMSScripts\/Custom\/|App_Themes\/)[\w/-]+\.(js|css)$/.test(
      u.pathname,
    ) &&
    !u.search
  )
    return u;
  throw new CrawlError("url_not_allowed");
}
export async function createGuardedCdrDriver({
  maxRequests = 300,
  maxSessionBytes = 40_000_000,
  maxSessionMs = 300_000,
  http = new SafeHttp({
    urlPolicy: cdrResourceUrl,
    contentTypes:
      /^(text\/(html|plain|css|javascript)|application\/(javascript|x-javascript|json))/i,
  }),
} = {}) {
  // Chromium has no direct network route. All page requests are fulfilled with
  // our pinned, TLS-verified, robots-aware transport. Unsupported protocols and
  // background requests fail at the dead proxy, rather than bypassing validation.
  // Chromium <-loopback> SUBTRACTS its implicit localhost bypass; keep it.
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: "http://127.0.0.1:9",
      bypass: "<-loopback>",
    },
    args: [
      "--disable-quic",
      "--disable-background-networking",
      "--disable-features=DnsOverHttps",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.addInitScript(() => {
    for (const key of [
      "Worker",
      "SharedWorker",
      "RTCPeerConnection",
      "webkitRTCPeerConnection",
    ])
      Object.defineProperty(globalThis, key, {
        value: class {
          constructor() {
            throw new Error("Disabled in crawler");
          }
        },
        configurable: false,
        writable: false,
      });
  });
  let requests = 0,
    bytes = 0,
    challenge = false,
    error = null,
    chain = Promise.resolve(),
    lastCount = 0,
    pendingResponse = null;
  const timer = setTimeout(() => {
    error = "browser_session_timeout";
    void browser.close();
  }, maxSessionMs);
  await context.routeWebSocket("**/*", (ws) => ws.close());
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (
      request.method() !== "GET" ||
      !["document", "script", "stylesheet", "xhr", "fetch"].includes(
        request.resourceType(),
      )
    )
      return route.abort("blockedbyclient");
    try {
      cdrResourceUrl(request.url());
    } catch {
      return route.abort("blockedbyclient");
    }
    const execute = async () => {
      if (++requests > maxRequests)
        throw new CrawlError("browser_request_budget");
      const response = await http.get(request.url());
      bytes += Buffer.byteLength(response.body);
      if (bytes > maxSessionBytes) throw new CrawlError("browser_byte_budget");
      await route.fulfill({
        status: response.status,
        headers: {
          "content-type": response.headers["content-type"],
          ...(request.resourceType() === "document"
            ? {
                "content-security-policy":
                  "worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'",
              }
            : {}),
        },
        body: response.body,
      });
    };
    try {
      const next = chain.then(execute);
      chain = next.catch(() => {});
      await next;
    } catch (e) {
      if (e.code === "access_blocked") challenge = true;
      error = e.code || "browser_fetch_failed";
      await route.abort("blockedbyclient").catch(() => {});
    }
  });
  const page = await context.newPage();
  page.on("response", (response) => {
    if ([401, 403].includes(response.status())) {
      challenge = true;
      error = "access_blocked";
    }
    if (Number(response.headers()["content-length"]) > 4_000_000) {
      error = "response_too_large";
      void page.close();
    }
  });
  page.on("popup", (p) => void p.close());
  page.on("download", (d) => void d.cancel());
  return {
    networkPolicy: Object.freeze({
      httpsOnly: true,
      publicIpPinned: true,
      robotsEnforced: true,
    }),
    async openApprovedStage(stage) {
      if (!["Ongoing", "Archive", "Others"].includes(stage))
        throw new CrawlError("invalid_stage");
      const url = `https://www.cdr.gov.lb/en-US/Procurment.aspx?stage=${stage}`;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
      } catch (e) {
        throw new CrawlError(error || "browser_navigation_failed", e.message);
      }
      if (error) throw new CrawlError(error);
      if (blockedBody(await page.content()))
        throw new CrawlError("access_blocked");
    },
    async snapshot() {
      if (error && !challenge) throw new CrawlError(error);
      const html = await page.content();
      if (Buffer.byteLength(html) > 4_000_000)
        throw new CrawlError("dom_too_large");
      const button = page.locator("#LoadMoreWebsiteProcurments");
      return {
        html,
        url: page.url(),
        challenge: challenge || blockedBody(html),
        loadMoreVisible: await button.isVisible(),
        loadMoreEnabled: await button.isEnabled().catch(() => false),
        loading: false,
      };
    },
    async clickLoadMore() {
      lastCount = await page.locator("#ProcurmentsTbody > tr.content").count();
      pendingResponse = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
          "/CDR/Pages/LoadMore/LoadMoreProcurments.aspx",
        { timeout: 30_000 },
      );
      // Attach immediately so a rejected response wait cannot escape as unhandled.
      pendingResponse.catch(() => {});
      await page
        .locator("#LoadMoreWebsiteProcurments")
        .click({ timeout: 10_000 });
    },
    async waitForChange() {
      try {
        const response = await pendingResponse;
        if (response.status() !== 200)
          throw new CrawlError("pagination_http_failure");
        await page.waitForFunction(
          (previous) =>
            document.querySelectorAll("#ProcurmentsTbody > tr.content").length >
              previous ||
            !document.querySelector("#LoadMoreWebsiteProcurments") ||
            getComputedStyle(
              document.querySelector("#LoadMoreWebsiteProcurments"),
            ).display === "none",
          lastCount,
          { timeout: 15_000 },
        );
      } catch (e) {
        throw new CrawlError(error || e.code || "pagination_no_progress");
      }
    },
    stats() {
      return { requests, bytes, error };
    },
    async close() {
      clearTimeout(timer);
      await browser.close();
    },
  };
}
