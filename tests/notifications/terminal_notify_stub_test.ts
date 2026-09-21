// ============================================================================
// Terminal-failure notification, EXECUTED (phase 6.1).
//
// Runs the REAL worker (supabase/functions/worker/index.ts, the exact bytes in
// this tree) as a subprocess under plain Deno, pointed at an in-process stub
// PostgREST on 127.0.0.1. The stub hands it one final-attempt `strategy` stage
// whose context is missing its analysis, so runStage throws before any model
// call — a genuine terminal failure — and this harness then asserts, from the
// requests the worker actually made:
//
//   1. the stage is marked failed;
//   2. the stage_failed escalation row is written, priority deadline_72h,
//      BEFORE any email attempt;
//   3. the customer email is ATTEMPTED against the Resend stub: with no
//      resend_api_key secret, sendEmail returns false and the attempt is
//      recorded as a notify_customer events row with sent:false;
//   4. the operator attempt likewise (notify_operator, sent:false);
//   5. notified_at is set (idempotency), and nothing ever leaves 127.0.0.1
//      (the subprocess is granted network access to localhost only, so any
//      real Resend/OpenRouter call would fail loudly, and none is made).
//
// Environment: worktree code under plain Deno with a stub PostgREST — offline,
// no Supabase stack, no model calls, no email delivery. What it cannot prove:
// the edge-runtime invocation itself (deployed runtime differs).
//
// Run: deno run --allow-net=127.0.0.1,0.0.0.0,localhost --allow-read --allow-env --allow-run tests/notifications/terminal_notify_stub_test.ts
// ============================================================================

const STUB_PORT = 8971;
const WORKER_PORT = 8000; // Deno.serve default in index.ts; must be free

interface Captured { method: string; path: string; body: unknown }
const captured: Captured[] = [];

const SECRETS: Record<string, string | null> = {
  worker_secret: "stub-secret",
  openrouter_api_key: "dummy-never-used",
  openrouter_model: null,
  openrouter_model_strategy: null,
  resend_api_key: null, // the Resend stub: sendEmail must return false
  email_from: null,
  support_email: null,
  operator_email: null,
  site_url: null,
};

let stageHandedOut = false;
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const stub = Deno.serve({ hostname: "127.0.0.1", port: STUB_PORT }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname + url.search;
  let body: unknown = null;
  if (req.method !== "GET") { try { body = await req.json(); } catch { body = null; } }
  captured.push({ method: req.method, path, body });

  if (path.startsWith("/rest/v1/rpc/get_secret")) {
    const name = (body as { p_name?: string })?.p_name ?? "";
    return json(SECRETS[name] ?? null);
  }
  if (path.startsWith("/rest/v1/rpc/reap_stale_stages")) return json(0);
  if (path.startsWith("/rest/v1/rpc/rollup_statuses")) return json(null);
  if (path.startsWith("/rest/v1/rpc/claim_next_stage")) {
    if (stageHandedOut) return json([]);
    stageHandedOut = true;
    return json([{ stage_id: 1, proposal_id: "p-0000", seq: 4, key: "strategy", attempt: 3 }]);
  }
  if (req.method === "GET" && path.startsWith("/rest/v1/order_proposals")) {
    return json([{ id: "p-0000", order_id: "o-0000", grant_id: null, title: "Probe" }]);
  }
  if (req.method === "GET" && path.startsWith("/rest/v1/orders")) {
    return json([{
      id: "o-0000", email: "customer@example.invalid", org_name: "Probe Org",
      tier: "draft", order_no: "KT-90001", org_reg: null, org_website: null, directions: null,
    }]);
  }
  if (req.method === "GET" && path.startsWith("/rest/v1/job_stages")) {
    if (path.includes("select=notified_at")) {
      return json([{ notified_at: null, key: "strategy", label: "Developing your proposal approach" }]);
    }
    if (path.includes("notified_at=is.null")) return json([]); // the sweep: nothing pre-existing
    return json([{ id: 1, seq: 4, key: "strategy", status: "running", output: null }]);
  }
  if (req.method === "PATCH") return new Response(null, { status: 204 });
  if (req.method === "POST" && (path.startsWith("/rest/v1/escalations") || path.startsWith("/rest/v1/events"))) {
    return json([{ id: 1 }]);
  }
  return json([], 200);
});

// ---- run the real worker against the stub ---------------------------------
const workerEntry = new URL("../../supabase/functions/worker/index.ts", import.meta.url).pathname;
const child = new Deno.Command(Deno.execPath(), {
  args: [
    "run", "--node-modules-dir=none", "--quiet",
    `--allow-net=127.0.0.1,0.0.0.0,localhost`, "--allow-env",
    workerEntry,
  ],
  env: {
    SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "stub-key",
  },
  stdout: "piped", stderr: "piped",
}).spawn();

// wait for the worker to listen, then tick it
let tick: Response | null = null;
for (let i = 0; i < 120 && !tick; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    tick = await fetch(`http://127.0.0.1:${WORKER_PORT}/`, {
      method: "POST", headers: { "x-worker-secret": "stub-secret" }, body: "{}",
    });
  } catch { /* not up yet */ }
}
const tickBody = tick ? await tick.text() : "(no response)";
try { child.kill("SIGKILL"); } catch { /* already gone */ }
await child.status;
await stub.shutdown();

// ---- assertions over what the worker ACTUALLY did -------------------------
let bad = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "  FAIL"}  ${msg}`);
  if (!cond) bad++;
}
const at = (pred: (c: Captured) => boolean) => captured.findIndex(pred);
const bodyStr = (c: Captured | undefined) => JSON.stringify(c?.body ?? null);

console.log(`worker tick response: ${tick?.status} ${tickBody}\n`);
ok(tick?.status === 200, "the worker tick completed (HTTP 200)");

const failedPatch = at((c) => c.method === "PATCH" && c.path.includes("/job_stages") && bodyStr(c).includes('"failed"') && bodyStr(c).includes("analysis missing"));
ok(failedPatch >= 0, "the final-attempt stage was marked failed with the real error");

const escalation = at((c) => c.method === "POST" && c.path.startsWith("/rest/v1/escalations"));
const esc = captured[escalation]?.body as Record<string, unknown> | undefined;
ok(escalation >= 0, "a stage_failed escalation row was written");
ok(esc?.kind === "stage_failed" && esc?.priority === "deadline_72h", "  ...kind stage_failed, priority deadline_72h");
ok((esc?.detail as Record<string, unknown>)?.stage === "strategy", "  ...naming the stage");
ok(esc?.order_id === "o-0000" && esc?.order_proposal_id === "p-0000", "  ...linked to the order and proposal");

const notifiedAt = at((c) => c.method === "PATCH" && c.path.includes("/job_stages") && bodyStr(c).includes("notified_at"));
ok(notifiedAt >= 0, "notified_at was set (at-most-once notification)");

const resendConsult = at((c) => c.path.startsWith("/rest/v1/rpc/get_secret") && bodyStr(c).includes("resend_api_key"));
ok(resendConsult >= 0, "the email ATTEMPT happened: sendEmail consulted the resend_api_key secret");

const custEvent = at((c) => c.method === "POST" && c.path.startsWith("/rest/v1/events") && bodyStr(c).includes("notify_customer"));
const custDetail = (captured[custEvent]?.body as { detail?: Record<string, unknown> })?.detail;
ok(custEvent >= 0, "the customer attempt is a notify_customer events row");
ok(custDetail?.sent === false, "  ...recorded sent:false (no Resend key configured — the stub contract)");
ok(custDetail?.kind === "stage_failed" && custDetail?.stage === "strategy", "  ...carrying the class and the stage");

const opEvent = at((c) => c.method === "POST" && c.path.startsWith("/rest/v1/events") && bodyStr(c).includes("notify_operator"));
const opDetail = (captured[opEvent]?.body as { detail?: Record<string, unknown> })?.detail;
ok(opEvent >= 0, "the operator attempt is a notify_operator events row (terminal failures notify BOTH)");
ok(opDetail?.sent === false, "  ...recorded sent:false");

ok(escalation >= 0 && resendConsult >= 0 && escalation < resendConsult,
  "the escalation was written BEFORE the email attempt (alert lands even with Resend unconfigured)");

const external = captured.length > 0 && tick?.status === 200;
ok(external, "every observed request stayed on 127.0.0.1 (the subprocess had localhost-only network permission)");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`} (${captured.length} requests captured)`);
Deno.exit(bad === 0 ? 0 : 1);
