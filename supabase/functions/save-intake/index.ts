// Persists wizard answers just before Stripe. v5 (invariant 2): the pre-payment
// sufficiency gate is ENFORCED here — this function refuses to mint a checkout
// authorisation unless evaluateSufficiency() returns cleared, per the contract
// in worker/sufficiency.ts. Refusal by default:
//
//   * every submission is evaluated by the deterministic gate (hard floor only;
//     see the FLAT ladder note in sufficiency.ts — thresholds are NOT set here);
//   * a cleared intake gets a single-use checkout_token (the value the front
//     end must pass to Stripe as client_reference_id) plus the stored verdict
//     and the fingerprint of exactly what was scored;
//   * anything else gets the verdict's own customer message and NO token. The
//     wizard renders message/gaps; nothing here invents wording.
//
// The stored row is the fingerprint authority: the SufficiencyInput is derived
// FROM the row about to be stored (clearance.ts inputFromRow), so
// stripe-webhook's recompute from the same row can only diverge if the row (or
// the uploaded-file set) changed after clearance — which must refuse.
//
// grant_analysis_ok is decided HERE, server-side and deterministically: a
// URL-shaped grant input is fetched through the same SSRF-hardened fetch the
// worker uses and counts as analysable only if it yields real text. It is
// never accepted from the client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, clientIp, rateLimit } from "./http.ts";
import {
  evaluateSufficiency,
  gapLines,
  fingerprint,
  MIN_GRANT_CHARS,
  SLOTS,
} from "../worker/sufficiency.ts";
import { safeFetchText, stripHtml } from "../worker/ssrf.ts";
import {
  KNOWN_TIERS,
  VENUE_ESCAPES,
  intakeFilesQuery,
  uploadsFromFiles,
  inputFromRow,
  mintCheckoutToken,
} from "./clearance.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { "content-type": "application/json", apikey: KEY, authorization: `Bearer ${KEY}` };

async function sel(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`sel ${path}: ${r.status}`);
  return await r.json();
}

// The extended evidence-interview facts, sanitised server-side: bounded lengths,
// bounded list sizes, booleans coerced to exactly true. A blank field is dropped
// (never stored as a default), so the stored blob is only what the customer
// actually asserted. The SAME shape the worker reads out of orders.intake_answers
// and the sufficiency gate fingerprints — the pre-payment authority.
// deno-lint-ignore no-control-regex
const CTRL = /[\u0000-\u001f\u007f]+/g;
function str(v: unknown, max: number): string {
  return String(v ?? "").replace(CTRL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function sanitizeFacts(raw: unknown): Record<string, unknown> {
  const f = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  const put = (k: string, v: string) => { if (v) out[k] = v; };
  put("registration_number", str(f.registration_number, 100));
  put("legal_form", str(f.legal_form, 120));
  put("annual_income", str(f.annual_income, 60));
  put("income_band", str(f.income_band, 60));
  put("accounts_period", str(f.accounts_period, 80));
  put("safeguarding_lead_name", str(f.safeguarding_lead_name, 120));
  put("safeguarding_lead_role", str(f.safeguarding_lead_role, 120));
  put("safeguarding_lead_training", str(f.safeguarding_lead_training, 120));
  put("lived_experience_governance", str(f.lived_experience_governance, 400));
  for (const k of ["bank_account_own_name", "public_liability_insurance", "safeguarding_policy", "board_independent", "no_conflicting_grant"]) {
    if (f[k] === true) out[k] = true;
  }
  const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
  const key_people = arr(f.key_people).slice(0, 12).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { name: str(o.name, 120), role: str(o.role, 120) };
  }).filter((p) => p.name || p.role);
  if (key_people.length) out.key_people = key_people;
  const programmes = arr(f.programmes).slice(0, 12).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { name: str(o.name, 120), what: str(o.what, 300) };
  }).filter((p) => p.name || p.what);
  if (programmes.length) out.programmes = programmes;
  const results = arr(f.results).slice(0, 12).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { what: str(o.what, 200), when: str(o.when, 60), figure: str(o.figure, 60) };
  }).filter((r) => r.what || r.when || r.figure);
  if (results.length) out.results = results;
  const partnerships = arr(f.partnerships).slice(0, 12).map((p) => str(p, 160)).filter(Boolean);
  if (partnerships.length) out.partnerships = partnerships;
  // Extra links: bounded, http(s) only, deduplicated. The worker crawls these
  // through the same SSRF-hardened path as the home domain; a bad one there is
  // recorded and skipped, so light validation is enough here.
  const seen = new Set<string>();
  const extra_links: string[] = [];
  for (const l of arr(f.extra_links).slice(0, 8)) {
    const u = str(l, 400);
    if (/^https?:\/\/[^\s]+$/i.test(u) && !seen.has(u.toLowerCase())) {
      seen.add(u.toLowerCase());
      extra_links.push(u);
    }
    if (extra_links.length >= 5) break;
  }
  if (extra_links.length) out.extra_links = extra_links;
  return out;
}

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

  // WS4a 2026-08-28: a SUPPLIED deadline that does not parse used to become
  // null silently — the customer's stated deadline was discarded with no
  // signal, and downstream nothing can tell "no deadline" from "deadline we
  // could not read". A malformed supplied value now refuses; absent stays null.
  const deadlineRaw = String(b.deadline ?? "").trim();
  if (deadlineRaw && !/^\d{4}-\d{2}-\d{2}$/.test(deadlineRaw)) {
    return json({ ok: false, reason: "bad_deadline" }, 400);
  }
  // The tier the clearance will be scored for. An unknown tier refuses loudly
  // rather than storing a value the pre_intakes_tier_check constraint rejects.
  const tier = String(b.tier ?? "draft").trim().toLowerCase();
  if (!KNOWN_TIERS.includes(tier)) return json({ ok: false, reason: "bad_tier" }, 400);

  // Server-side grant readability. Never a client assertion. A URL-shaped grant
  // input is fetched (SSRF-hardened, bounded) and counts as analysable only
  // when it yields at least MIN_GRANT_CHARS of extractable text. Pasted
  // guidelines need no fetch: the gate's own length rule covers them.
  const grantRaw = String(b.grant ?? "").slice(0, 100_000);
  const grantTrimmed = grantRaw.trim();
  let grantAnalysisOk = false;
  if (/^https?:\/\//i.test(grantTrimmed) && !/\s/.test(grantTrimmed)) {
    try {
      const res = await safeFetchText(grantTrimmed, { maxRedirects: 3, timeoutMs: 12_000, maxBytes: 2_000_000 });
      grantAnalysisOk = stripHtml(res.body, 80_000).trim().length >= MIN_GRANT_CHARS;
    } catch { grantAnalysisOk = false; }
  }

  // The six pre-payment answer slots + the two honest escapes.
  const answersIn = (b.answers && typeof b.answers === "object" ? b.answers : {}) as Record<string, unknown>;
  const slotColumns: Record<string, string | null> = {};
  for (const s of SLOTS) {
    const v = String(answersIn[s.id] ?? "").slice(0, 1000).trim();
    slotColumns[s.id] = v || null;
  }
  const veRaw = String(b.venue_escape ?? "").trim().toLowerCase();
  const venueEscape = VENUE_ESCAPES.has(veRaw) ? veRaw : null;
  const neverDelivered = b.never_delivered === true;

  // The extended evidence-interview facts (admin certifications, named org
  // facts, extra crawl links). Sanitised, then stored as one jsonb blob the
  // gate fingerprints and the worker rebuilds into the Evidence Ledger.
  const facts = sanitizeFacts(b.facts);

  // The row is built FIRST; the gate scores exactly what will be stored.
  const row: Record<string, unknown> = {
    email,
    tier,
    org_name: String(b.org ?? "").slice(0, 300) || null,
    org_reg: String(b.registration ?? "").slice(0, 100) || null,
    org_website: String(b.website ?? "").slice(0, 300) || null,
    grant_input: grantRaw || null,
    grant_analysis_ok: grantAnalysisOk,
    deadline: deadlineRaw || null,
    directions: String(b.directions ?? "").slice(0, 8000) || null,
    upload_names: Array.isArray(b.files) ? (b.files as string[]).slice(0, 3).map((f) => String(f).slice(0, 200)) : null,
    ...slotColumns,
    venue_escape: venueEscape,
    never_delivered: neverDelivered,
    intake_facts: Object.keys(facts).length ? facts : null,
  };

  // The uploaded-file set the fingerprint covers — the same query the webhook
  // will re-run. A file added or removed after clearance changes the
  // fingerprint and the payment refuses; that is the contract, not a bug.
  let uploads: ReturnType<typeof uploadsFromFiles> = [];
  try { uploads = uploadsFromFiles(await sel(intakeFilesQuery(email))); } catch { uploads = []; }

  const input = {
    ...inputFromRow(row, uploads),
    grantIssuer: String(b.grant_issuer ?? "").slice(0, 200) || null,
  };
  const verdict = evaluateSufficiency(input);
  const fp = await fingerprint(input);

  // Clearance state written ONLY from the verdict just computed. `cleared` is
  // derived inside evaluateSufficiency and asserted consistent there; nothing
  // upstream (and nothing client-supplied) can set it.
  const now = new Date().toISOString();
  const token = verdict.cleared ? mintCheckoutToken() : null;
  Object.assign(row, {
    sufficiency: {
      cleared: verdict.cleared,
      score: verdict.score,
      threshold: verdict.threshold,
      threshold_source: verdict.threshold_source,
      ladder_status: verdict.ladder_status,
      scorer: verdict.scorer,
      blockers: verdict.blockers,
      gaps: verdict.gaps.map((g) => ({ scope: g.scope, code: g.code })),
      advisories: verdict.advisories.map((g) => ({ scope: g.scope, code: g.code })),
      referents: verdict.referents.length,
      contract: verdict.contract_version,
    },
    sufficiency_cleared: verdict.cleared,
    sufficiency_fingerprint: fp,
    sufficiency_score: verdict.score,
    sufficiency_threshold: verdict.threshold,
    sufficiency_scorer: verdict.scorer,
    sufficiency_contract: verdict.contract_version,
    sufficiency_at: now,
    checkout_token: token,
    checkout_token_at: token ? now : null,
    updated_at: now,
  });

  // Re-evaluation of an existing wizard row (funnel measurement): update in
  // place when the caller names its row AND the email matches; otherwise a new
  // row. Either way the stored row is exactly what was scored.
  const intakeId = String(b.intake_id ?? "");
  let saved: { id: string } | null = null;
  if (/^[0-9a-f-]{36}$/.test(intakeId)) {
    const r = await fetch(
      `${SB}/rest/v1/pre_intakes?id=eq.${intakeId}&email=eq.${encodeURIComponent(email)}`,
      { method: "PATCH", headers: { ...H, prefer: "return=representation" }, body: JSON.stringify(row) },
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows.length) saved = rows[0];
      // attempts counter: best-effort, never blocks the response
      if (rows.length) {
        await fetch(`${SB}/rest/v1/pre_intakes?id=eq.${intakeId}`, {
          method: "PATCH",
          headers: { ...H, prefer: "return=minimal" },
          body: JSON.stringify({ attempts: Number(rows[0].attempts ?? 0) + 1 }),
        }).catch(() => {});
      }
    }
  }
  if (!saved) {
    const r = await fetch(`${SB}/rest/v1/pre_intakes`, {
      method: "POST",
      headers: { ...H, prefer: "return=representation" },
      body: JSON.stringify({ ...row, attempts: 1 }),
    });
    if (!r.ok) return json({ ok: false }, 500);
    saved = (await r.json())[0];
  }

  // Invariant 9: the refusal or clearance is an events row either way.
  await fetch(`${SB}/rest/v1/events`, {
    method: "POST",
    headers: { ...H, prefer: "return=minimal" },
    body: JSON.stringify({
      actor: "save-intake",
      action: verdict.cleared ? "sufficiency_cleared" : "sufficiency_refused",
      entity: "pre_intake",
      entity_id: saved!.id,
      detail: {
        tier,
        score: verdict.score,
        threshold: verdict.threshold,
        blockers: verdict.blockers.map((x) => x.code),
        gaps: verdict.gaps.map((g) => g.code),
        advisories: verdict.advisories.map((g) => g.code),
        fingerprint: fp,
      },
    }),
  }).catch(() => {});

  if (!verdict.cleared) {
    // NO checkout authorisation. The wizard shows the gate's own message.
    return json({
      ok: true,
      id: saved!.id,
      cleared: false,
      message: verdict.message,
      gaps: gapLines(verdict),
    });
  }
  return json({
    ok: true,
    id: saved!.id,
    cleared: true,
    // The front end passes THIS to Stripe as client_reference_id. The webhook
    // refuses any checkout.session.completed that does not carry a valid,
    // unconsumed, fingerprint-matched token (consume_checkout_token).
    checkout_token: token,
    message: verdict.message,
  });
});
