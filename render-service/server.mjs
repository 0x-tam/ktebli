// Ktebli render-validation service v2.
//
// POST /extract-pdf (same auth, raw PDF <=50MiB) -> native evidence, <=64-page batch.
// POST /inspect-pdf (same auth, raw PDF <=2000 pages) -> bounded native text per page.
// POST /raster-pdf (same auth, raw PDF <=10 pages) -> bounded PNG images, up to 200 DPI.
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
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
const run = promisify(execFile);

const PORT = process.env.PORT || 8080;
const SECRET = process.env.RENDER_SECRET || "";
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 120;
const MAX_IMAGE_PAGES = MAX_PAGES;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const SOFFICE_TIMEOUT_MS = 60_000;
const RASTER_TIMEOUT_MS = 45_000;
const REQUEST_WATCHDOG_MS = 110_000;
const PDF_RASTER_PAGES = 10;
const PDF_RASTER_DPI = 200;
const PDF_RASTER_MIN_DPI = 96;
const PDF_RASTER_MAX_DIMENSION = 6000;
const PDF_RASTER_MAX_PIXELS = 12_000_000;


class RenderError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function inspectPdf(pdf, signal, execute = run, detailed = false) {
  try {
    const args = detailed ? ["-f", "1", "-l", String(PDF_RASTER_PAGES), "-box", pdf] : [pdf];
    const { stdout: info } = await execute("pdfinfo", args, { signal, killSignal: "SIGKILL", timeout: 15_000, maxBuffer: 65536 });
    return { pages: parseInt((info.match(/^Pages:\s+(\d+)/m) || [])[1] || "0", 10), info };
  } catch {
    throw new RenderError("pdf_info_failed", 422);
  }
}

// Rasterize a supplied small PDF chunk. Never fetches a URL or executes PDF
// JavaScript. Bounded resolution, page/dimension/output limits and shared HTTP
// concurrency protect the service from oversized or malicious documents.
export async function rasterPdf(bytes, signal, { execute = run } = {}) {
  if (bytes.length > MAX_BYTES) throw new RenderError("too_large", 413);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new RenderError("invalid_pdf", 422);
  const dir = mkdtempSync(join(tmpdir(), "r-pdf-"));
  try {
    const pdf = join(dir, "in.pdf");
    writeFileSync(pdf, bytes);
    const { pages, info } = await inspectPdf(pdf, signal, execute, true);
    if (!pages || pages > PDF_RASTER_PAGES) throw new RenderError(pages ? "too_many_pages" : "pdf_info_failed", 422);
    const sizes = [...info.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+) x ([\d.]+) pts/gm)];
    if (sizes.length !== pages || new Set(sizes.map(s => Number(s[1]))).size !== pages) throw new RenderError("pdf_dimensions_unavailable", 422);
    const boxes = [...info.matchAll(/^Page\s+(\d+)\s+MediaBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/gm)];
    if (boxes.length !== pages || new Set(boxes.map(b => Number(b[1]))).size !== pages) throw new RenderError("pdf_dimensions_unavailable", 422);
    const expectedPages = Array.from({ length: pages }, (_, i) => i + 1);
    if (sizes.some((s, i) => Number(s[1]) !== expectedPages[i]) ||
        boxes.some((b, i) => Number(b[1]) !== expectedPages[i])) throw new RenderError("pdf_dimensions_unavailable", 422);
    const dimensions = [...sizes.map(s => [s[1], Number(s[2]), Number(s[3])]), ...boxes.map(b => [b[1], Number(b[4])-Number(b[2]), Number(b[5])-Number(b[3])])];
    if (dimensions.some(([, w, h]) => !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0))
      throw new RenderError("pdf_dimensions_limit", 422);
    const fits = dpi => dimensions.every(([, w, h]) => {
      const width = Math.ceil(w * dpi / 72), height = Math.ceil(h * dpi / 72);
      return width <= PDF_RASTER_MAX_DIMENSION && height <= PDF_RASTER_MAX_DIMENSION &&
        width * height <= PDF_RASTER_MAX_PIXELS;
    });
    let dpi = PDF_RASTER_DPI;
    while (dpi >= PDF_RASTER_MIN_DPI && !fits(dpi)) dpi--;
    if (dpi < PDF_RASTER_MIN_DPI) throw new RenderError("pdf_dimensions_limit", 422);
    try {
      await execute("pdftoppm", ["-png", "-r", String(dpi), "-f", "1", "-l", String(pages), pdf, join(dir, "pg")],
        { signal, killSignal: "SIGKILL", timeout: RASTER_TIMEOUT_MS, maxBuffer: 65536 });
    } catch (e) {
      throw new RenderError(e.killed ? "timeout" : "raster_failed", e.killed ? 504 : 422);
    }
    const files = readdirSync(dir).filter(f => /^pg-\d+\.png$/.test(f)).sort((a,b) => a.localeCompare(b, "en", { numeric: true }));
    if (files.length !== pages || files.some((f,i) => Number(f.match(/\d+/)[0]) !== i + 1)) throw new RenderError("incomplete_render", 422);
    let total = 0;
    const images = files.map(file => {
      const path = join(dir, file), size = statSync(path).size;
      total += size;
      if (size < 24 || total > MAX_IMAGE_BYTES) throw new RenderError("render_output_too_large", 422);
      const png = readFileSync(path);
      if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
          png.toString("ascii", 12, 16) !== "IHDR") throw new RenderError("raster_failed", 422);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      if (!width || !height || width > PDF_RASTER_MAX_DIMENSION || height > PDF_RASTER_MAX_DIMENSION ||
          width * height > PDF_RASTER_MAX_PIXELS) throw new RenderError("pdf_dimensions_limit", 422);
      return png.toString("base64");
    });
    return { ok: true, pages, dpi, images, images_truncated: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Native text inspection is not OCR or proof that graphical content was read.
export async function inspectPdfText(bytes, signal, { execute = run } = {}) {
  const maxTextBytes=8*1024*1024;
  if(bytes.length>MAX_BYTES)throw new RenderError("too_large",413);
  if(bytes.length<5||bytes.subarray(0,5).toString()!=="%PDF-")throw new RenderError("invalid_pdf",422);
  const dir=mkdtempSync(join(tmpdir(),"r-inspect-"));
  try{
    const pdf=join(dir,"in.pdf");writeFileSync(pdf,bytes);
    const {pages}=await inspectPdf(pdf,signal,execute);
    if(!pages||pages>2000)throw new RenderError(pages?"too_many_pages":"pdf_info_failed",422);
    let stdout;
    try{
      ({stdout}=await execute("pdftotext",["-layout","-enc","UTF-8",pdf,"-"],
        {signal,killSignal:"SIGKILL",timeout:45000,maxBuffer:maxTextBytes,encoding:"buffer"}));
    }catch(error){
      if(error.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER")throw new RenderError("inspection_output_too_large",422);
      throw new RenderError(error.killed||signal?.aborted?"timeout":"text_inspection_failed",error.killed||signal?.aborted?504:422);
    }
    const raw=Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout);
    if(raw.length>maxTextBytes)throw new RenderError("inspection_output_too_large",422);
    let text;
    try{text=new TextDecoder("utf-8",{fatal:true}).decode(raw);}catch{throw new RenderError("text_encoding_failed",422);}
    const pageTexts=text.split("\f");
    if(pageTexts.at(-1)==="")pageTexts.pop();
    if(pageTexts.length!==pages)throw new RenderError("inspection_page_mismatch",422);
    return {ok:true,pages,text_bytes:raw.length,page_texts:pageTexts.map((text,index)=>({page:index+1,text})),
      text_truncated:false,mode:"native_text_only",visual_content_verified:false};
  }finally{rmSync(dir,{recursive:true,force:true});}
}

// Native extraction consumes supplied bytes only; no remote URL or path accepted.
export async function extractPdf(bytes, signal, { execute = run, first = 1, last = null } = {}) {
  if (bytes.length > 50*1024*1024) throw new RenderError("too_large",413);
  if (bytes.subarray(0,5).toString() !== "%PDF-") throw new RenderError("invalid_pdf",422);
  if (!Number.isInteger(first) || first < 1 || first > 2000 || (last !== null && (!Number.isInteger(last) || last < first || last-first >= 64 || last > 2000))) throw new RenderError("invalid_page_range",422);
  const dir=mkdtempSync(join(tmpdir(),"r-native-"));
  try {
    const path=join(dir,"in.pdf");writeFileSync(path,bytes);
    let stdout;
    try { ({stdout}=await execute("python3",[fileURLToPath(new URL("./extract_pdf.py",import.meta.url)),path,String(first),last===null?"auto":String(last)],
      {signal,killSignal:"SIGKILL",timeout:45000,maxBuffer:8*1024*1024,encoding:"utf8"})); }
    catch(e) { throw new RenderError(e.killed || signal?.aborted ? "timeout" : e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "extraction_output_too_large" : "native_extraction_failed",e.killed || signal?.aborted ? 504 : 422); }
    const result=JSON.parse(stdout);
    if (!result.ok || !Array.isArray(result.page_results) || result.text_truncated !== false) throw new RenderError("native_extraction_failed",422);
    return result;
  } finally {rmSync(dir,{recursive:true,force:true});}
}

// Split PDF pages outside the Edge CPU/memory budget. Original bytes stay private.
export async function slicePdf(bytes, signal, { execute = run, first = 1, last = null } = {}) {
  if(bytes.length>50*1024*1024) throw new RenderError("too_large",413);
  if(bytes.subarray(0,5).toString()!=="%PDF-") throw new RenderError("invalid_pdf",422);
  if(!Number.isInteger(first)||first<1||first>2000||(last!==null&&(!Number.isInteger(last)||last<first||last-first>=4||last>2000))) throw new RenderError("invalid_page_range",422);
  const dir=mkdtempSync(join(tmpdir(),"r-slice-"));
  try {
    const path=join(dir,"in.pdf");writeFileSync(path,bytes);
    let stdout;
    try { ({stdout}=await execute("python3",[fileURLToPath(new URL("./slice_pdf.py",import.meta.url)),path,String(first),last===null?"auto":String(last)],
      {signal,killSignal:"SIGKILL",timeout:45000,maxBuffer:16*1024*1024,encoding:"utf8"})); }
    catch(e) { throw new RenderError(e.killed||signal?.aborted?"timeout":e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER"?"slice_output_too_large":"pdf_slice_failed",e.killed||signal?.aborted?504:422); }
    const value=JSON.parse(stdout);
    if(!value.ok||!Array.isArray(value.page_results)||value.page_results.length<1||value.page_results.length>4) throw new RenderError("pdf_slice_failed",422);
    return value;
  } finally {rmSync(dir,{recursive:true,force:true});}
}

export async function renderDocx(bytes, signal) {
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
      await run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src],
        { signal, killSignal: "SIGKILL", timeout: SOFFICE_TIMEOUT_MS, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, HOME: dir } });
    } catch (e) {
      throw new RenderError(e.killed ? "timeout" : "conversion_failed", e.killed ? 504 : 422);
    }
    const pdf = join(dir, "in.pdf");
    const { pages } = await inspectPdf(pdf, signal);
    if (!pages || pages > MAX_PAGES) throw new RenderError(pages ? "too_many_pages" : "pdf_info_failed", 422);
    try {
      await run("pdftoppm", ["-png", "-r", "70", "-l", String(Math.min(pages, MAX_IMAGE_PAGES)), pdf, join(dir, "pg")],
        { signal, killSignal: "SIGKILL", timeout: RASTER_TIMEOUT_MS, stdio: ["ignore", "ignore", "ignore"] });
    } catch (e) {
      throw new RenderError(e.killed ? "timeout" : "raster_failed", e.killed ? 504 : 422);
    }
    let imageBytes = 0;
    const images = readdirSync(dir).filter((f) => f.startsWith("pg") && f.endsWith(".png")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .map((f) => {
        const bytes = readFileSync(join(dir, f));
        imageBytes += bytes.length;
        if (imageBytes > MAX_IMAGE_BYTES) throw new RenderError("render_output_too_large", 422);
        return bytes.toString("base64");
      });
    if (images.length !== pages) throw new RenderError("incomplete_render", 422);
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

// Injectable conversion allows HTTP lifecycle tests without LibreOffice.
export function createRenderServer({ secret = SECRET, convert = renderDocx, raster = rasterPdf, inspect = inspectPdfText, extract = extractPdf, slice = slicePdf,
  maxConcurrent = MAX_CONCURRENT, maxBytes = MAX_BYTES,
  watchdogMs = REQUEST_WATCHDOG_MS } = {}) {
  let active = 0;
  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") { res.writeHead(200); res.end("ok"); return; }
    if (req.method !== "POST" || !["/render", "/raster-pdf", "/inspect-pdf", "/extract-pdf", "/slice-pdf"].includes(req.url)) { send(res, 404, { ok: false, code: "not_found" }); return; }
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) { send(res, 401, { ok: false, code: "unauthorized" }); return; }
    if (active >= maxConcurrent) { send(res, 429, { ok: false, code: "busy" }); return; }
    // Reserve before receiving bytes: slow uploads also consume capacity.
    active++;
    const abort = new AbortController();
    const started = Date.now();
    const watchdog = setTimeout(() => {
      abort.abort();
      send(res, 504, { ok: false, code: "timeout" });
      if (!req.complete) req.destroy();
    }, watchdogMs);
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.on("close", disconnected);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (["/extract-pdf","/slice-pdf"].includes(req.url) ? 50*1024*1024 : maxBytes)) {
          send(res, 413, { ok: false, code: "too_large" });
          return;
        }
        chunks.push(chunk);
      }
      if (abort.signal.aborted) return;
      if(["/extract-pdf","/slice-pdf"].includes(req.url)) {
        const from=req.headers["x-page-from"], to=req.headers["x-page-to"];
        if ((from !== undefined && !/^[1-9]\d{0,3}$/.test(from)) || (to !== undefined && !/^[1-9]\d{0,3}$/.test(to))) throw new RenderError("invalid_page_range",422);
        send(res,200,await (req.url === "/slice-pdf" ? slice : extract)(Buffer.concat(chunks),abort.signal,{first:from===undefined?1:Number(from),last:to===undefined?null:Number(to)}));
        return;
      }
      send(res, 200, await (req.url === "/inspect-pdf" ? inspect : req.url === "/raster-pdf" ? raster : convert)(Buffer.concat(chunks), abort.signal));
    } catch (e) {
      if (abort.signal.aborted) send(res, 504, { ok: false, code: "timeout" });
      else if (e instanceof RenderError) send(res, e.status, { ok: false, code: e.code });
      else send(res, 500, { ok: false, code: "internal" });
    } finally {
      clearTimeout(watchdog);
      res.off("close", disconnected);
      active--;
      console.log(JSON.stringify({ m: req.method, s: res.statusCode, ms: Date.now() - started }));
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRenderServer().listen(PORT, () => console.log(JSON.stringify({ up: true, port: Number(PORT) })));
}
