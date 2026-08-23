// Ktebli render-validation service v2.
//
// POST /render  (Authorization: Bearer <RENDER_SECRET>, body: raw .docx bytes)
//   -> 200 { ok:true, pages, images:[base64 PNG], images_truncated }
//   -> 4xx/5xx { ok:false, code }   (codes: unauthorized, too_large, busy,
//        conversion_failed, pdf_info_failed, raster_failed, timeout, internal)
// GET /healthz -> ok
//
// PRIVACY CONTRACT (customer documents are confidential):
//  - Nothing is persisted. Bytes live only in memory and in a per-request
//    temp directory with an unpredictable name, deleted in `finally`.
//  - Logs contain method, status code, duration and byte counts ONLY — never
//    filenames, document text, stderr, or any content-derived value.
//  - Error responses carry classification codes only, never tool output.
//  - No files are ever exposed by URL; results return in the response body
//    of the authenticated request that supplied the document.
//
// RESOURCE LIMITS: body <= 12 MB, soffice/pdftoppm each hard-killed at their
// timeout, pages counted up to MAX_PAGES (beyond -> fail cleanly), images
// rasterised at 70 dpi for at most MAX_IMAGE_PAGES pages, at most
// MAX_CONCURRENT renders in flight (429 beyond), whole request watchdog.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const PORT = process.env.PORT || 8080;
const SECRET = process.env.RENDER_SECRET || "";
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 120;
const MAX_IMAGE_PAGES = 15;
const MAX_CONCURRENT = 2;
const SOFFICE_TIMEOUT_MS = 60_000;
const RASTER_TIMEOUT_MS = 45_000;
const REQUEST_WATCHDOG_MS = 110_000;

let inFlight = 0;

class RenderError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

function renderDocx(bytes) {
  // must actually be a DOCX (ZIP magic) — LibreOffice would otherwise "convert"
  // arbitrary bytes as a text dump instead of failing
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new RenderError("invalid_docx", 422);
  }
  const dir = mkdtempSync(join(tmpdir(), "r-"));
  try {
    const src = join(dir, "in.docx");
    writeFileSync(src, bytes);
    try {
      execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src],
        { timeout: SOFFICE_TIMEOUT_MS, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, HOME: dir } });
    } catch (e) {
      throw new RenderError(e.killed ? "timeout" : "conversion_failed", e.killed ? 504 : 422);
    }
    const pdf = join(dir, "in.pdf");
    let pages = 0;
    try {
      const info = execFileSync("pdfinfo", [pdf], { timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] }).toString();
      pages = parseInt((info.match(/^Pages:\s+(\d+)/m) || [])[1] || "0", 10);
    } catch {
      throw new RenderError("pdf_info_failed", 422);
    }
    if (!pages || pages > MAX_PAGES) throw new RenderError(pages ? "too_many_pages" : "pdf_info_failed", 422);
    try {
      execFileSync("pdftoppm", ["-png", "-r", "70", "-l", String(Math.min(pages, MAX_IMAGE_PAGES)), pdf, join(dir, "pg")],
        { timeout: RASTER_TIMEOUT_MS, stdio: ["ignore", "ignore", "ignore"] });
    } catch (e) {
      throw new RenderError(e.killed ? "timeout" : "raster_failed", e.killed ? 504 : 422);
    }
    const images = readdirSync(dir).filter((f) => f.startsWith("pg") && f.endsWith(".png")).sort()
      .map((f) => readFileSync(join(dir, f)).toString("base64"));
    return { ok: true, pages, images, images_truncated: pages > MAX_IMAGE_PAGES };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const send = (res, status, obj) => {
  if (res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

createServer((req, res) => {
  const started = Date.now();
  const watchdog = setTimeout(() => send(res, 504, { ok: false, code: "timeout" }), REQUEST_WATCHDOG_MS);
  res.on("finish", () => {
    clearTimeout(watchdog);
    // content-free access log
    console.log(JSON.stringify({ m: req.method, s: res.statusCode, ms: Date.now() - started }));
  });

  if (req.method === "GET" && req.url === "/healthz") { res.writeHead(200); res.end("ok"); return; }
  if (req.method !== "POST" || req.url !== "/render") { send(res, 404, { ok: false, code: "not_found" }); return; }
  if (!SECRET || req.headers.authorization !== `Bearer ${SECRET}`) { send(res, 401, { ok: false, code: "unauthorized" }); return; }
  if (inFlight >= MAX_CONCURRENT) { send(res, 429, { ok: false, code: "busy" }); return; }

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) { send(res, 413, { ok: false, code: "too_large" }); req.destroy(); }
    else chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    inFlight++;
    try {
      send(res, 200, renderDocx(Buffer.concat(chunks)));
    } catch (e) {
      if (e instanceof RenderError) send(res, e.status, { ok: false, code: e.code });
      else send(res, 500, { ok: false, code: "internal" });
    } finally {
      inFlight--;
    }
  });
}).listen(PORT, () => console.log(JSON.stringify({ up: true, port: Number(PORT) })));
