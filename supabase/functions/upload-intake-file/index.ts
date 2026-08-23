// Receives an old proposal from the wizard, validates it as a real document by
// content (magic bytes) not just the browser's claimed type, stores it under a
// server-generated path, and extracts text for the voice stage.
// v2: magic-byte + extension allowlist, zip-bomb-limited docx extraction,
// per-IP/email rate limiting, scoped CORS.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import { corsHeaders, clientIp, rateLimit } from "./http.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BYTES = 10_000_000;
const MAX_UNZIP_ENTRY = 30_000_000;

type Sig = { name: string; test: (b: Uint8Array) => boolean };
const PK: Sig = { name: "zip/ooxml", test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) };
const PDF: Sig = { name: "pdf", test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 };
const OLE: Sig = { name: "ole/doc", test: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 };
const RTF: Sig = { name: "rtf", test: (b) => b[0] === 0x7b && b[1] === 0x5c && b[2] === 0x72 && b[3] === 0x74 };
function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096);
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) { if (c !== 27) return false; } }
  return true;
}
const ALLOW: Record<string, Sig[]> = {
  pdf: [PDF], docx: [PK], odt: [PK], doc: [OLE], rtf: [RTF],
  txt: [{ name: "text", test: looksLikeText }], md: [{ name: "text", test: looksLikeText }],
};

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function docxText(bytes: Uint8Array): string | null {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" && f.originalSize < MAX_UNZIP_ENTRY });
    const doc = files["word/document.xml"];
    if (!doc) return null;
    return strFromU8(doc)
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } catch { return null; }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req, "POST, OPTIONS");
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const ip = clientIp(req);
  if (!(await rateLimit(SB, KEY, `upl:ip:${ip}`, 30, 3600))) return json({ ok: false, reason: "rate_limited" }, 429);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, reason: "bad_form" }, 400); }
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  const file = form.get("file");
  if (!email.includes("@") || !(file instanceof File)) return json({ ok: false, reason: "missing" }, 400);
  if (!(await rateLimit(SB, KEY, `upl:em:${email.toLowerCase()}`, 20, 3600))) return json({ ok: false, reason: "rate_limited" }, 429);
  if (file.size > MAX_BYTES) return json({ ok: false, reason: "too_big" }, 400);
  if (file.size < 8) return json({ ok: false, reason: "too_small" }, 400);

  const rawName = String((file as File).name ?? "upload");
  const ext = extOf(rawName);
  const sigs = ALLOW[ext];
  if (!sigs) return json({ ok: false, reason: "type_not_allowed" }, 415);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = bytes.subarray(0, 16);
  if (!sigs.some((s) => s.test(header))) return json({ ok: false, reason: "content_mismatch" }, 415);

  const safeMeta = rawName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  const storedName = `${crypto.randomUUID()}.${ext}`;
  const path = `pre/${storedName}`;

  const up = await fetch(`${SB}/storage/v1/object/uploads/${path}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/octet-stream", "x-upsert": "false" },
    body: bytes,
  });
  if (!up.ok) return json({ ok: false, reason: "store_failed" }, 500);

  let text: string | null = null;
  if (ext === "docx") text = docxText(bytes);
  else if (ext === "txt" || ext === "md") text = new TextDecoder().decode(bytes).slice(0, 200_000);
  if (text && text.length < 300) text = null;
  if (text) text = text.slice(0, 120_000);

  await fetch(`${SB}/rest/v1/intake_files`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}`, prefer: "return=minimal" },
    body: JSON.stringify({ email, file_name: safeMeta, storage_path: path, extracted_text: text }),
  });
  return json({ ok: true, analysed: !!text, name: safeMeta });
});
