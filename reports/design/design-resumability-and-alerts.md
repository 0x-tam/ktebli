# Design — resumable section-by-section generation, and failure notification

Design document. Nothing in the repo is modified by this file. It specifies (a) a change to
`supabase/functions/worker/index.ts`, (b) one new migration, (c) two small changes to
`order-status` and `stripe-webhook`, and the tests that prove each.

## 0. Line-number convention, and what is already in the tree

Line numbers are against **v26 as committed at `HEAD` (328adc1)**, 1929 lines — the byte-verified
deployed source. The working tree is *not* v26: another track has 68 uncommitted lines in
`worker/index.ts` (a `notifyTerminal` helper inserted after `sendEmail` at :1046, a
`release_stranded_claim` call in `strategy`, and a `final` branch in the catch). Everything after
:1045 in the working tree therefore sits ~51 lines lower than the numbers below. Migration
`20260826150000_stranded_claims_and_alerting.sql` is already committed and this design **builds on
it** — it has already added `job_stages.notified_at`, the `escalations` kind list including
`stage_failed | stage_held | order_stalled | delivery_failed`, `escalations.order_id`,
`escalations.order_proposal_id`, a `due_at` default, and `release_stranded_claim()`.

What that other track has *not* done, and what this design supplies: nothing is resumable, nothing
observes the reaper's own transitions, nothing decides what happens to the customer's money, the
delivery email has no failure path, and `order-status` still promises an email in a case that is now
only half covered.

Architecture is unchanged: Postgres + job queue + the same 8 Deno edge functions, OpenRouter,
Resend, Stripe. No new service. Stages stay strictly sequential; every resumption is *inside* one
stage.

---

# PART A — RESUMABLE SECTION-BY-SECTION GENERATION

## A.1 What the code does today

| Fact | Line | Consequence |
|---|---|---|
| `TIME_BUDGET_MS = 100_000` | :43 | bounds *claiming*, not execution |
| `while (Date.now() - start < TIME_BUDGET_MS)` | :1901 | the only clock read in the file |
| `await Promise.all(claims.map(...))` | :1909 | unbounded; no deadline reaches `runStage` |
| `runStage()` | :1122-1888 | contains no clock read at all |
| `done()` | :1126 | the only writer of `status:"done"` + `output`, runs once at the end |
| `ctx()` reads `out[st.key]` only where `st.status === "done"` | :1001 | a retry cannot see its own previous attempt |
| `claim_next_stage` returns `(stage_id, proposal_id, seq, key, attempt)` | `20260820145739:78` | the worker never re-reads its own row |
| narrative generation | :1555 → `generateValidated` :625, `spec.max` 7000 | one call chain of up to 12 `llmRaw` hops |
| `validate` at tier `full`, `maxRounds = 2` | :1587, loop :1594 | up to 48 `llmRaw` calls in one stage |
| `beatAll()` called only at the first line of `llmRaw` | :138, throttle :121 | no beat *during* a call |
| `llmRaw`'s fetch has no `AbortSignal` | :139-149 | the only unbounded network call in the file |

The stage is therefore all-or-nothing: a death at call 47 of 48 discards 47 calls and burns one of
three attempts. Three deaths and `reap_stale_stages` writes `failed`
(`20260820145739:117`), `rollup_statuses` writes `attention`, and — today — nobody is told.

**A longer timeout cannot fix this.** The 807 s stage did not fail because 100 s was too short; it
failed because one invocation must do a bounded amount of work and there was no way to stop in the
middle and keep what was written. The fix is a stage that can stop on its own terms.

## A.2 The mechanism in one paragraph

`gen:narrative` stops generating one 7 000-token document and starts generating an ordered list of
sections, each 250-500 words, each persisted to a new `job_stages.progress jsonb` column the moment
it exists. Before starting each section the stage asks whether the invocation has enough time left;
if not it throws a `YieldSignal`, the catch block calls a new `yield_stage()` RPC which puts the row
back to `pending`, **decrements `attempt`** so the yield costs nothing, and nulls `heartbeat_at`.
The next cron tick claims the same row, reads `progress` back through `ctx()`, and continues at the
first section with `text === null`. The stage is `done` only when every section exists, the document
has been assembled, seam-edited and brought inside the word limit; `done()` clears `progress` in the
same write. `validate`, `check` and `revise` use the same column with a smaller state object.

## A.3 DDL — one new migration

`supabase/migrations/20260826160000_resumable_stages.sql` (applied after `20260826150000`):

```sql
-- Resumable stages: a stage that runs out of invocation budget stops on its own
-- terms, keeps what it wrote, and is continued by the next tick.
--
-- Today a stage is all-or-nothing. `done()` is the only writer of status='done'
-- and output, and ctx() reads a stage's output only where status='done', so a
-- retry cannot see one byte of its own previous attempt. A gen:narrative that
-- dies at call 47 of 48 discards 47 calls and burns an attempt; three of those
-- and reap_stale_stages writes 'failed'. That is why competitive and full do not
-- reliably complete, and no timeout increase can change it.

-- Partial work, keyed by stage. Written after every section; cleared by done().
alter table public.job_stages add column if not exists progress jsonb;

-- How many times this stage has yielded. attempt is NOT consumed by a yield, so
-- something else has to bound a stage that yields forever. Twelve yields at the
-- worker's 240s soft deadline is ~45 minutes of real work on one stage, which is
-- far more than any tier needs and still terminates.
alter table public.job_stages add column if not exists yields smallint not null default 0;

-- A cooperative yield. NOT a failure: the row goes back to 'pending' with its
-- attempt returned, so a yield can never push a stage toward max_attempts.
-- heartbeat_at is nulled so the row is unambiguously not-running; reap_stale_stages
-- only ever touches status='running', so a yielded stage cannot be reaped and can
-- never "look dead".
-- Returns false when the row is not running (someone else already moved it) or the
-- yield budget is spent — the caller then lets the normal failure path run.
create or replace function public.yield_stage(p_stage bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update public.job_stages
     set status       = 'pending',
         attempt      = greatest(0, attempt - 1),
         yields       = yields + 1,
         heartbeat_at = null,
         error        = null
   where id = p_stage
     and status = 'running'
     and yields < 12
  returning true into v_ok;
  return coalesce(v_ok, false);
end; $$;
revoke all on function public.yield_stage(bigint) from public, anon, authenticated;
grant execute on function public.yield_stage(bigint) to service_role;

-- A stage that is resumed carries no output until it finishes, so the ready index
-- is unaffected. This index serves the stalled-order sweeper in Part B.
create index if not exists job_stages_progress_idx
  on public.job_stages (proposal_id) where progress is not null;
```

`claim_next_stage` and `reap_stale_stages` are **not modified**. That is deliberate: they are the
concurrency heart, and the yield is expressible entirely as a state the existing predicates already
handle correctly (`pending`, no fresh heartbeat, `attempt < max_attempts`).

## A.4 Worker plumbing: deadline, yield, beats, abort

### A.4.1 An invocation-scoped clock that reaches `runStage`

```ts
// The 100s TIME_BUDGET_MS at :43 is a CLAIMING budget: line :1901 may pass at
// t=99.9s and then Promise.all at :1909 runs the batch to completion with no
// deadline of any kind. The effective ceiling of an invocation is therefore
// 100s + the slowest stage in the last batch, and nothing in the worker knows
// that second term. This is the execution budget: the point past which a stage
// stops asking for more work, saves what it has, and hands itself back.
//
// It MUST stay under the platform's wall-clock ceiling for an edge function
// invocation, with room for the yield write itself. It is deliberately larger
// than TIME_BUDGET_MS, and that gap is load-bearing: once elapsed exceeds 100s
// the claim loop at :1901 has already exited, so a stage that yields at 240s can
// never be re-claimed by the same isolate.
const SOFT_DEADLINE_MS = 240_000;
const YIELD_RESERVE_MS = 25_000;   // room to persist progress and call yield_stage

// Unlike the `usage` global at :129 — which is genuinely wrong, because PARALLEL
// stages share the isolate and cross-contaminate each other's token counts — this
// global is invocation-scoped by nature. Every stage in this isolate shares one
// wall clock, which is exactly the quantity being budgeted.
let INVOCATION_START = 0;
function msLeft(): number { return SOFT_DEADLINE_MS - (Date.now() - INVOCATION_START); }
function haveBudget(estimateMs: number): boolean { return msLeft() > estimateMs + YIELD_RESERVE_MS; }

// Observed worst-case durations, per isolate, so the budget check adapts to the
// provider's actual latency instead of a guess. Conservative floors: a first
// section on a congested provider is the case that must not be started blind.
let obsSectionMs = 45_000;
let obsRoundMs = 120_000;
let obsSeamMs = 90_000;

// Not an error: a cooperative stop. It must be distinguished from a real failure
// BEFORE the `final` classification at :1917, or a yield would burn an attempt and
// eventually notify the customer that their proposal failed.
class YieldSignal extends Error {
  constructor(readonly at: string) { super("[yield] " + at); }
}
```

`Deno.serve` at :1898 sets it, one line:

```ts
  const start = Date.now();
  INVOCATION_START = start;
```

### A.4.2 The catch block at :1909-1925

```ts
    await Promise.all(claims.map(async (st) => {
      const stBeat = () => patch(`job_stages?id=eq.${st.stage_id}`, { heartbeat_at: new Date().toISOString() }).catch(() => {});
      ACTIVE_BEATS.add(stBeat);
      try {
        await runStage(st);
        processed++;
      } catch (e) {
        // A yield is not a failure. Stop beating this stage FIRST — the 20s beat
        // interval is still armed and must not write a heartbeat onto a row that
        // is about to be pending — then hand the row back with its attempt intact.
        if (e instanceof YieldSignal) {
          ACTIVE_BEATS.delete(stBeat);
          const yielded = await rpc("yield_stage", { p_stage: st.stage_id }).catch(() => false);
          if (yielded === true) { yields++; return; }
          // Yield budget spent, or the row moved under us: fall through and fail
          // properly, so the customer is told rather than left in limbo.
        }
        const msg = String(e).slice(0, 300);
        const final = st.attempt >= 3 || msg.includes("claim blocked") || msg.includes("similarity gate");
        const status = final
          ? (msg.includes("similarity gate") || msg.includes("claim blocked") ? "held" : "failed")
          : "pending";
        await patch(`job_stages?id=eq.${st.stage_id}`, { status, error: msg }).catch(() => {});
        if (final) await notifyTerminal(st.stage_id, st.proposal_id, status, msg);
      } finally {
        ACTIVE_BEATS.delete(stBeat);
      }
    }));
```

`yields` joins `processed` in the response body, so a tick's log line says how much work was carried
forward rather than lost.

### A.4.3 Beat during a call, and bound the call

Two independent holes, both in `llmRaw` (:137-155). Neither needs schema.

```ts
// The beat is thrown at the START of a model call (:138) and throttled to 20s
// (:121), so the interval between beats is the interval between call STARTS. One
// call longer than the reaper's 3 minutes produces no beat at all and the stage is
// killed while it is alive and working. A timer beats on wall-clock time instead,
// which is the quantity the reaper actually measures.
let beatTimer: number | undefined;

// And the inverse failure: this fetch is the only network call in the file without
// a timeout — compare renderService at :938 (AbortSignal.timeout(45_000)) and
// safeFetchText at ssrf.ts:91. Deno's fetch waits forever, while the two sibling
// stages sharing this isolate keep calling beatAll(), which beats the hung stage
// too. heartbeat_at then means "this isolate is alive", not "this stage is
// progressing", and the reaper cannot recover a wedged stage. 120s is comfortably
// above a slow 7000-token reasoning completion and comfortably below the reaper.
const LLM_TIMEOUT_MS = 120_000;

async function llmRaw(messages: ChatMsg[], maxTokens: number, opts: LlmOpts = {}): Promise<{ text: string; finish: string }> {
  beatAll();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { /* unchanged */ },
    body: /* unchanged */,
  });
  // ...unchanged
}
```

In `Deno.serve`, right after `INVOCATION_START = start`:

```ts
  beatTimer = setInterval(() => { lastBeatAll = 0; beatAll(); }, 20_000);
```

and in a `finally` around the whole handler body: `clearInterval(beatTimer)`. Resetting
`lastBeatAll` before the call bypasses the throttle at :121-123, which exists to stop a fast hop
sequence from writing a row per second — a timer is already rate-limited by construction.

## A.5 The section plan

The plan is **derived once and persisted**. Re-deriving it per invocation is the one thing that
would let a resumed run splice sections from two different plans.

```ts
interface PlanSection { heading: string; brief: string; weight: number }

// Skeletons, one per seeded structural template (20260819195010). This is the
// shape only — headings are named for THIS grant by the planning call below.
// It must vary by template: the structural template is one of the five exclusivity
// locks (20260819194825:101-107), so a single shared skeleton would give all eight
// proposals on a grant the same section list and feed the `check` gate at :1744.
const TEMPLATE_SKELETONS: Record<string, Array<[string, number]>> = {
  problem_first:   [["the problem, in evidence", 2], ["why it persists", 1], ["what we will do", 3], ["who benefits and how many", 1], ["how we will know it worked", 1], ["what happens after the grant", 1]],
  story_first:     [["one case that shows the problem", 1], ["how widespread it is", 2], ["the response", 3], ["reach and targets", 1], ["measurement", 1], ["sustainability", 1]],
  outcomes_first:  [["the end state we are funding", 2], ["working backwards: outputs", 2], ["the activities that produce them", 3], ["who is reached", 1], ["evidence of change", 1], ["continuation", 1]],
  capacity_first:  [["what this organisation already does", 2], ["the gap this grant closes", 2], ["the project", 3], ["delivery and reach", 1], ["monitoring", 1], ["beyond the grant", 1]],
  geography_first: [["the areas served", 2], ["needs by area", 2], ["the intervention in each area", 3], ["combined targets", 1], ["measurement", 1], ["sustainability", 1]],
  question_led:    [["what is the need", 2], ["what is proposed", 3], ["who delivers it", 1], ["what changes", 2], ["how it is measured", 1], ["what lasts", 1]],
  timeline_led:    [["the problem and the window", 2], ["phase one", 2], ["phase two", 2], ["phase three", 2], ["targets and indicators", 1], ["after the final phase", 1]],
  partnership_led: [["the actors and the gap between them", 2], ["what each contributes", 2], ["the joint intervention", 3], ["who is reached", 1], ["shared measurement", 1], ["the arrangement after the grant", 1]],
};

// Priority order matches what the single-call generator does today: the donor's own
// structure wins (:1521-1523), then the donor's required sections (:1134), then the
// house skeleton for the reserved template.
async function buildPlan(
  analysis: Record<string, unknown> | undefined,
  fmt: Fmt,
  strategy: Record<string, unknown> | undefined,
  base: string,
): Promise<{ sections: PlanSection[]; source: string }> {
  const appStruct = analysis?.application_structure as { defined_by_donor?: boolean; sections_or_questions?: string[] } | undefined;
  const donor = appStruct?.defined_by_donor && (appStruct.sections_or_questions?.length ?? 0) > 0
    ? appStruct.sections_or_questions!.map(String) : [];
  const fixed = donor.length ? donor : fmt.requiredSections;
  if (fixed.length) {
    return {
      source: donor.length ? "donor" : "required_sections",
      // Donor wording is reproduced EXACTLY — never renamed, never shortened. That
      // is the same rule as :1523 and :643, and here it is structural rather than a
      // request to the model: the worker writes the heading line itself (A.6).
      sections: fixed.map((h) => ({ heading: h, brief: `Answer this section directly and completely: ${h}`, weight: 1 })),
    };
  }
  const tpl = String(((strategy?.template_style as { name?: string } | undefined)?.name) ?? "problem_first");
  const skeleton = TEMPLATE_SKELETONS[tpl] ?? TEMPLATE_SKELETONS.problem_first;
  // One cheap call names the sections in this grant's and this project's own terms.
  // The skeleton alone would be a house template on every proposal; the P0 finding
  // is that the output already reads machine-generated, and eight fixed heading
  // sets would make that worse. The call's OUTPUT is persisted, so resumption never
  // re-runs it and can never get a different plan.
  try {
    const p = jsonOf(await llm(
      base +
      `\n\nTASK — plan the narrative's sections. Do not write the proposal.\n` +
      `The reserved structure is "${tpl}": ${skeleton.map(([s], i) => `${i + 1}. ${s}`).join("  ")}\n` +
      `Give each position a heading in this project's own words (not the generic label above) and a one-line brief saying exactly what that section must establish, so that the sections together cover every row of the requirement matrix once and only once.\n` +
      `Reply strict JSON only: {"sections":[{"heading":string,"brief":string}]} — exactly ${skeleton.length} sections, in this order. Headings are short noun phrases, no numbering, no colons.`,
      1200));
    const got = (Array.isArray(p.sections) ? p.sections as Array<Record<string, unknown>> : []);
    if (got.length === skeleton.length) {
      return { source: "template:" + tpl, sections: got.map((s, i) => ({
        heading: String(s.heading ?? skeleton[i][0]).replace(/^#+\s*/, "").slice(0, 120),
        brief: String(s.brief ?? skeleton[i][0]).slice(0, 400),
        weight: skeleton[i][1],
      })) };
    }
  } catch { /* fall through to the raw skeleton */ }
  return { source: "template_fallback:" + tpl, sections: skeleton.map(([s, w]) => ({ heading: s.replace(/^\w/, (c) => c.toUpperCase()), brief: s, weight: w })) };
}
```

## A.6 The resumable generation loop

Progress shape (`job_stages.progress`):

```ts
interface SectionState {
  heading: string;
  brief: string;
  words: number;            // this section's share of the word budget
  text: string | null;      // "## heading\n\n<body>" — null until generated
  gist: string | null;      // one line, for sections that have fallen out of the tail window
  attempts: number;         // repair-ladder position, PERSISTED across invocations
}
interface GenProgress {
  v: 1;
  stage: string;            // must equal stage.key or the progress is foreign
  fp: string;               // fingerprint of every upstream input
  plan_source: string;
  sections: SectionState[];
  assembled: string | null; // set once every section exists
  seamed: boolean;          // the one continuity pass has run
  final: string | null;     // inside the word limit; ready for done()
}

// Every upstream stage output is frozen at 'done' (ctx() at :1001 reads nothing
// else), so baseCtx() is a pure function of them. If it changes between
// invocations, an upstream stage was reset or reran and the half-written document
// belongs to a different strategy, a different design, or a different evidence
// ledger. Splicing the two would be worse than the failure it is recovering from.
// jsonb columns come back from PostgREST with a stable key order, so the same
// stored rows always produce the same string here.
async function fingerprint(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
```

`ctx()` at :996-1003 gains `progress` in its select and returns the stage's own row — one line, no
extra round trip, and it is the only way the worker can see its own state (`claim_next_stage`
returns the row's identity but not its contents):

```ts
async function ctx(proposalId: string) {
  const prop = (await sel(`order_proposals?id=eq.${proposalId}&select=*`))[0];
  const order = (await sel(`orders?id=eq.${prop.order_id}&select=*`))[0];
  const stages = await sel(`job_stages?proposal_id=eq.${proposalId}&select=id,seq,key,status,output,progress,yields&order=seq`);
  const out: Record<string, unknown> = {};
  for (const st of stages) if (st.output && st.status === "done") out[st.key] = st.output;
  return { prop, order, out, stages };
}
```

and in `runStage` at :1122-1127:

```ts
  const self = c.stages.find((s: { id: number }) => s.id === stage.stage_id);
  const saveProgress = (p: unknown) => patch(`job_stages?id=eq.${stage.stage_id}`, { progress: p });
  // done() clears progress in the same write: partial state has no meaning once
  // output exists, and leaving it makes "was this stage resumed?" ambiguous.
  const done = (output: unknown) =>
    patch(`job_stages?id=eq.${stage.stage_id}`, { status: "done", finished_at: new Date().toISOString(), output, progress: null });
```

The narrative branch replaces :1546-1557 (the `gen:` branch keeps its existing shape for every other
kind; `budget`, `logframe`, `workplan`, `risk_table` and the rest are single bounded calls of
1200-4000 tokens and are not the problem):

```ts
    if (kind !== "narrative") {
      const text = await generateValidated(baseCtx() + extra + `\n\nTASK: ${brief}${FORMAT_RULES}`, spec.max, opts);
      return done({ text, usage: usageSnap() });
    }

    // ---- the narrative is written section by section, and is resumable ----
    const fp = await fingerprint(baseCtx() + " " + JSON.stringify({ w: fmt.maxWords, r: fmt.requiredSections }));
    let pg = (self?.progress ?? null) as GenProgress | null;
    if (pg && (pg.v !== 1 || pg.stage !== stage.key || pg.fp !== fp)) {
      // An upstream stage moved. Start clean rather than splice two strategies.
      pg = null;
    }
    if (!pg) {
      const plan = await buildPlan(analysis, fmt, strategy, baseCtx());
      // 0.94 of the donor's limit, the same headroom the single-call generator
      // aims for at :1193, split by weight. The headings themselves are counted:
      // wordCount() at :555 strips '#' but counts the words after it.
      const totalW = plan.sections.reduce((a, s) => a + s.weight, 0);
      const budgetW = fmt.maxWords ? Math.round(fmt.maxWords * 0.94) : 2000;
      pg = {
        v: 1, stage: stage.key, fp, plan_source: plan.source, assembled: null, seamed: false, final: null,
        sections: plan.sections.map((s) => ({
          heading: s.heading, brief: s.brief,
          words: Math.max(120, Math.round((budgetW * s.weight) / totalW)),
          text: null, gist: null, attempts: 0,
        })),
      };
      await saveProgress(pg);
    }

    const styleNote = strategy ? `\nStructure style: ${JSON.stringify(strategy.template_style)}.` : "";
    for (let i = 0; i < pg.sections.length; i++) {
      const s = pg.sections[i];
      if (s.text !== null) continue;                      // already written, in a previous invocation
      // The budget check is BEFORE the call, never after: a section started
      // without the time to finish it is a section thrown away.
      if (!haveBudget(obsSectionMs)) throw new YieldSignal(`gen:narrative section ${i + 1}/${pg.sections.length}`);
      if (s.attempts >= 3) throw new Error(`section failed after 3 attempts: ${s.heading.slice(0, 60)}`);
      const t0 = Date.now();
      await beat();
      s.attempts++;
      await saveProgress(pg);                             // the ladder position survives the isolate

      const body = sanitizeMd(await llm(
        baseCtx() +
        `\n\nYou are writing ONE section of a proposal narrative that is being written in order, section by section. The reader will read it as one continuous document.\n` +
        `\nTHE FULL SECTION LIST (this is the whole document; write ONLY section ${i + 1}):\n` +
        pg.sections.map((x, n) => `${n + 1}. ${x.heading}${n === i ? "   <-- WRITE THIS ONE" : ""}`).join("\n") +
        (i > 0 ? `\n\nWHAT HAS ALREADY BEEN SAID (do not repeat any of it):\n` +
          pg.sections.slice(0, i).map((x) => `- ${x.heading}: ${x.gist}`).join("\n") : "") +
        (i < pg.sections.length - 1 ? `\n\nWHAT COMES AFTER YOU (do not pre-empt these; leave them their material):\n` +
          pg.sections.slice(i + 1).map((x) => `- ${x.heading}: ${x.brief}`).join("\n") : "") +
        (i > 0 ? `\n\nTHE LAST WORDS OF THE DOCUMENT SO FAR — continue directly from this, in the same voice, at the same level of detail; your first sentence must follow it naturally without restating it:\n${tailOf(pg, 1200)}` : "") +
        (i === 0 && strategy?.opening_style ? `\n\nOPENING: this is the first section and it carries the document's opening. Opening device: ${JSON.stringify(strategy.opening_style)}. Every later section continues; only this one opens.` : "") +
        (i > 0 ? `\n\nThe document has already opened. Do not write a new introduction and do not re-introduce the organisation or the problem.` : "") +
        (numbersUsed(pg).length ? `\n\nFIGURES ALREADY STATED IN THIS DOCUMENT — reuse these exact numbers where this section needs them, and never state a different value for the same quantity: ${numbersUsed(pg).join(", ")}` : "") +
        `\n\nTASK: write the BODY of the section "${s.heading}". ${s.brief}\n` +
        `Length: about ${s.words} words. Do NOT write the heading — it is added for you. Sub-headings (###) only if the section genuinely needs them.\n` +
        `Return the section body only, no preamble, no commentary.${styleNote}${STYLE_RULES}${FORMAT_RULES}`,
        Math.min(2600, Math.max(700, s.words * 3))));

      // The worker writes the heading, not the model. Under length pressure the
      // heading is the first thing a model trims (:645-647), and a donor-mandated
      // heading that has been shortened fails contentViolations at :601-604 and
      // the docx check at :1875. Writing it here makes 'missing_required_section'
      // structurally impossible for a donor-defined plan.
      const clean = body.replace(/^\s*#{1,2}\s+.*\n+/, "").trim();
      const sectionViol = contentViolations(clean, toBlocks(clean), {});
      if (sectionViol.length && s.attempts < 3) {
        obsSectionMs = Math.max(obsSectionMs, Date.now() - t0);
        continue;                                          // s.text stays null; retried, ladder persisted
      }
      s.text = `## ${s.heading}\n\n${clean}`;
      s.gist = gistOf(s.heading, clean);
      obsSectionMs = Math.max(obsSectionMs, Date.now() - t0);
      await saveProgress(pg);                              // <-- the durability point
    }
```

Two small pure helpers:

```ts
// The tail is the real continuity mechanism: the model literally continues from the
// last paragraph of the document as it stands, not from a summary of it. At 250-500
// words a section, 1200 words of tail is the previous two to four sections in full.
function tailOf(pg: GenProgress, chars: number): string {
  const all = pg.sections.filter((s) => s.text).map((s) => s.text!).join("\n\n");
  return all.length <= chars ? all : "..." + all.slice(all.length - chars);
}
// And the gist is what remains of a section once it has fallen out of the tail
// window. Deterministic — no extra model call, no cost, and it cannot drift from
// what was actually written.
function gistOf(heading: string, body: string): string {
  const first = (body.replace(/^#+.*$/gm, "").trim().split(/(?<=[.!?])\s/)[0] ?? "").trim();
  return `${heading} — ${first.slice(0, 200)}`;
}
// Numbers already committed to, extracted with the same regex the validate stage
// uses for evidence figures (:1580-1585). Passing them forward is what stops the
// arithmetic drift that blind critics catch and the deterministic checker misses.
function numbersUsed(pg: GenProgress): string[] {
  const seen = new Set<string>();
  for (const s of pg.sections) {
    if (!s.text) continue;
    for (const m of s.text.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) { seen.add(m[0]); if (seen.size > 40) break; }
  }
  return [...seen];
}
```

## A.7 Coherence — exactly how a sectioned document still reads as one piece

This is the requirement the design lives or dies on. Six mechanisms, in the order they act:

1. **One controlling context, byte-identical for every section.** Every section call carries the
   same `baseCtx()` (:1151-1165): the same Grant Intelligence Object, the same Organisation Profile,
   the same Evidence Ledger, the same reserved strategy, the same Project Design Object, the same
   voice guide, the same `FACT_RULES`. Every number in the document derives from one
   `design.project` JSON, so numbers cannot drift between sections for the same reason they cannot
   drift within a single call today.

2. **The tail, in full, not a summary.** Section *i* receives the last ~1200 characters of the
   document as it actually stands and is told to continue from it. Sentence-level continuity — the
   thing that makes stitched text obvious — is produced by the model reading the previous sentences,
   which is the same input a single-call generator has.

3. **A persisted gist per completed section.** Beyond the tail window, each earlier section is
   represented by one deterministic line. That is global memory: section 6 knows what section 1
   argued without carrying 1 800 words of it.

4. **A forward contract.** Every section is shown what the *later* sections will cover and told not
   to pre-empt them. A single call sees the whole document and naturally distributes its material;
   separately generated sections cannot, and without this they each try to be complete, which is
   precisely what makes multi-call writing read as a set of overlapping essays. `STYLE_RULES`
   already says "do not repeat the same argument across sections" (:78-81); this makes it
   actionable.

5. **The opening belongs to section 1 only.** The reserved `opening_style` (:1462) is passed for
   `i === 0`; every later section is told the document has already opened and must not re-introduce
   the organisation or the problem. Eight opening devices exist as an exclusivity lock, and only one
   section may carry one.

6. **One seam pass over the whole assembled document.** After every section exists, a single call is
   allowed to edit *only* the joins. It is the same size as today's single generation call, it runs
   once, and — crucially — it runs *after* `assembled` has been persisted, so an isolate death
   during it costs one call, not the document.

```ts
    // ---- assembly ----
    if (pg.assembled === null) {
      pg.assembled = pg.sections.map((s) => s.text!).join("\n\n");
      await saveProgress(pg);
    }

    // ---- the seam pass: the one call that makes it continuous ----
    if (!pg.seamed) {
      if (!haveBudget(obsSeamMs)) throw new YieldSignal("gen:narrative seam");
      const t0 = Date.now();
      await beat();
      const seamed = sanitizeMd(await llm(
        `Below is a proposal narrative whose sections were drafted in order. Your ONLY job is to make it read as one continuous piece of writing by one author.\n` +
        `You MAY: rewrite the first and last sentence of any section so it follows from what precedes it; delete a sentence that repeats something already said; fix a tense or a term that is used inconsistently.\n` +
        `You MAY NOT: add any fact, figure, name, date, partnership or claim that is not already in the text; change any number; remove, rename, merge, split or reorder any heading; add a heading; cut anything that is not literal repetition; add an introduction or a conclusion.\n` +
        `Reproduce every heading exactly as it stands, character for character. Return the complete document only.${FORMAT_RULES}\n\nDOCUMENT:\n${pg.assembled}`,
        7000));
      obsSeamMs = Math.max(obsSeamMs, Date.now() - t0);
      // A seam pass that broke a rule is discarded, not repaired: the un-seamed
      // document is already correct and shippable, and a second attempt at a
      // cosmetic pass is not worth the tokens or the risk.
      const headingsIntact = pg.sections.every((s) => seamed.includes(`## ${s.heading}`));
      const viol = contentViolations(seamed, toBlocks(seamed), { ...narrativeOpts, maxWords: null });
      if (headingsIntact && !viol.length && Math.abs(wordCount(seamed) - wordCount(pg.assembled)) < wordCount(pg.assembled) * 0.25) {
        pg.assembled = seamed;
      }
      pg.seamed = true;
      await saveProgress(pg);
    }

    // ---- word limit, deterministically, then the existing shorten prompt ----
    if (pg.final === null) {
      let doc = pg.assembled!;
      // Language models cannot count words; the shortener is only ever invoked on a
      // count this code made (:555), and the result is re-counted here, never asked
      // for. Two critics once rejected a 596-word document against a 600-word limit.
      for (let pass = 0; pass < 2 && fmt.maxWords && wordCount(doc) > fmt.maxWords; pass++) {
        if (!haveBudget(obsSeamMs)) { await saveProgress(pg); throw new YieldSignal("gen:narrative shorten"); }
        await beat();
        doc = await shortenToLimit(doc, fmt.maxWords, narrativeOpts);
      }
      const viol = contentViolations(doc, toBlocks(doc), narrativeOpts);
      if (viol.length) throw new Error("content validation failed: " + viol.join(","));
      pg.final = doc;
      await saveProgress(pg);
    }
    return done({
      text: pg.final, sections: pg.sections.length, plan_source: pg.plan_source,
      seamed: pg.seamed, resumed_yields: self?.yields ?? 0, usage: usageSnap(),
    });
```

`shortenToLimit` is the existing `lengthOnly` branch of `generateValidated` (:661-671) lifted into a
named function so it can be called without first burning two failed attempts to reach it. Its prompt
text is unchanged — it is the branch that already fixed R2's repeated 2 000-word rewrites:

```ts
// Extracted verbatim from generateValidated's lengthOnly branch (:661-671). Shortening
// a document that is already correct is a much easier task than writing it correctly
// shorter; the section path reaches that conclusion by construction instead of by
// failing twice first.
async function shortenToLimit(md: string, maxWords: number, opts: ContentOpts): Promise<string> {
  const target = Math.round(maxWords * 0.94);
  const out = sanitizeMd(await llm(
    `Shorten the document below to at most ${target} words. It is currently ${wordCount(md)} words.\n` +
    `Change NOTHING else. Keep every heading exactly as written, keep every section, keep every number, target and commitment, and keep the order. ` +
    `Cut only by tightening sentences, removing repetition, and deleting the least load-bearing detail. Do not summarise and do not drop a section.\n` +
    `Return the complete shortened document only.${FORMAT_RULES}\n\nDOCUMENT:\n${md}`, 7000));
  return contentViolations(out, toBlocks(out), opts).includes("missing_required_section") ? md : out;
}
```

## A.8 Idempotency — a section generated twice cannot be delivered twice

Four independent guarantees, three of which already exist:

1. **Sections are addressed, not appended.** `pg.sections[i].text` is written at a fixed index. A
   regenerated section overwrites; there is no code path that pushes. The plan's length is fixed
   when the plan is persisted.
2. **Sections have no external side effects.** A section writes nothing but its own text into one
   jsonb column: no storage upload, no email, no claim, no row in another table. That is why this
   granularity is safe, and it is exactly why `strategy` is **not** sectioned (A.10).
3. **`done()` is still the only writer of `output`, and it runs once.** `claim_next_stage`
   (`20260820145739:88`) only selects `status = 'pending'`, so a `done` stage cannot be re-claimed
   and a duplicate `gen:narrative` cannot exist.
4. **Delivery is guarded downstream, already.** `package` uploads to a deterministic path
   `${order.id}/${proposal_id}/${vprefix}${title}.docx` with `x-upsert: true` (:1030, :1857) — a
   repeat overwrites the same object rather than adding a second file. `deliver` sends at most one
   email per order because of `orders.completion_email_sent` (:1877, :1885). So even a
   `gen:narrative` that somehow ran twice end to end produces one set of files and one email.

The one window that loses work: a crash between the model returning a section and the
`saveProgress` that follows it. Cost: one section regenerated. That is the smallest possible unit
and it is bounded by `s.attempts`.

## A.9 Interaction with `reap_stale_stages()` — every state, explicitly

`reap_stale_stages` (`20260820145739:114-123`) touches exactly `status = 'running' and heartbeat_at
< now() - interval '3 minutes'`.

| State the stage is in | `status` | `heartbeat_at` | What the reaper does | Correct? |
|---|---|---|---|---|
| Generating a section (call in flight) | `running` | rewritten every 20 s by the new timer (A.4.3) | nothing | yes — it is alive |
| One very long model call | `running` | still beaten, by the timer rather than by call starts | nothing | yes — this is the hole the timer closes |
| Model call hung | `running` | beaten by siblings for at most 120 s, then `AbortSignal` fires and the stage fails or retries | nothing while alive | yes — the abort bounds it |
| **Yielded** | `pending` | `null` | **nothing — `status <> 'running'`** | yes — a yielded stage cannot look dead |
| Isolate died between the last `saveProgress` and `yield_stage` | `running` | stale | reaps to `pending`, **consumes one attempt** | acceptable: progress survives, resumption continues, only the attempt is lost |
| Isolate died mid-section | `running` | stale | reaps to `pending` after 3 min, consumes an attempt | acceptable: at most one section lost |
| Yield budget exhausted (`yields = 12`) | `yield_stage` returns `false` | — | the catch block falls through to the normal failure path | yes — bounded, and Part B tells the customer |

Two further interactions worth stating because they are easy to get wrong:

- **`claim_next_stage`'s global cap** counts `status = 'running' and heartbeat_at > now() - 3 min`
  (`20260820145739:83-86`). A yielded stage is `pending`, so it releases its slot immediately
  instead of occupying one of six until the reaper notices.
- **Re-claiming inside the same invocation is impossible by construction.** A yield can only happen
  once elapsed exceeds `SOFT_DEADLINE_MS` (240 s), and the claim loop's own condition at :1901 is
  `elapsed < TIME_BUDGET_MS` (100 s). Once anything yields, that loop has long since exited. The
  `ACTIVE_BEATS.delete` before `yield_stage` (A.4.2) closes the only other ordering hazard.
- **A concurrent invocation picking the row up immediately is desirable**, not a race: it has a
  fresh 240 s and the work continues sooner than the next cron minute.

## A.10 What is deliberately not made resumable

- **`strategy`** — it has an irreversible database side effect (`claim_approach` at :1425) with five
  network round trips before `done()` at :1467. Yielding inside that window would multiply the
  stranded-claim problem that `release_stranded_claim` was just added to repair. It also makes at
  most three model calls and has never been the stage that runs long.
- **`package`** — it uploads to storage. Uploads are idempotent (`x-upsert`), but the stage is
  bounded by document count, not by generation, and the expensive part is the render service call,
  which already has its own 45 s timeout (:938).
- **`analyze`, `org`, `voice`, `design`** — one to three bounded calls each.

## A.11 `validate`, `check`, `revise` — the same column, a smaller object

`validate` at tier `full` is the arithmetic that actually produced the 807 s stage: three loop
iterations (`maxRounds = 2`, :1587) each doing a Claim-Ledger call (:1604) plus a coverage/review
call (:1621), and rounds 0 and 1 each ending in a full-narrative regeneration at
`generateValidated(..., 7000, ...)` (:1676) — 48 `llmRaw` calls worst case. The round boundary is a
natural checkpoint: every round ends with a complete, valid narrative.

At the top of the loop (:1594-1595, immediately after `await beat()`):

```ts
    interface ValProgress { v: 1; stage: string; fp: string; round: number; narrative: string; rounds: Array<Record<string, unknown>> }
    let vp = (self?.progress ?? null) as ValProgress | null;
    if (vp && (vp.v !== 1 || vp.stage !== stage.key || vp.fp !== fp)) vp = null;
    let startRound = 0;
    if (vp) { narrative = vp.narrative; rounds.push(...vp.rounds); startRound = vp.round; corrected = startRound > 0; }

    for (let round = startRound; round <= maxRounds; round++) {
      // A round is one Claim Ledger call, one review call, and possibly a full
      // regeneration: on a congested provider that is minutes, and it is the
      // largest unit of work in the pipeline. Never start one without the budget
      // to finish it — a half-finished round is a discarded round.
      if (!haveBudget(obsRoundMs)) throw new YieldSignal(`validate round ${round}`);
      const t0 = Date.now();
      await beat();
      /* ...existing round body unchanged... */
      obsRoundMs = Math.max(obsRoundMs, Date.now() - t0);
      // written at the END of the round, when `narrative` is once again a complete document
      await saveProgress({ v: 1, stage: stage.key, fp, round: round + 1, narrative, rounds } satisfies ValProgress);
    }
```

`check`'s rewrite loop (:1744-1751) and `revise` (:1692-1713) take the same two lines each:
`if (!haveBudget(obsSeamMs)) throw new YieldSignal("check rewrite")` before each rewrite, and
`saveProgress({ v: 1, stage: stage.key, fp, mine, rewrites })` after it. Both loops already end each
iteration holding a complete narrative.

`check`'s cross-proposal query filters `status=eq.done` (:1716-1718), so another proposal's
in-progress `progress` is invisible to the similarity gate. No change needed there.

## A.12 Cost ceiling

Worst case for `gen:narrative` after this change: 1 plan call + (6 sections × up to 3 attempts) + 1
seam + 2 shorten = **22 calls**, but at 700-2 600 tokens rather than 7 000, against today's 12 calls
at 7 000. Typical case: 1 + 6 + 1 = **8 calls**. `validate` is unchanged in call count; it is only
made restartable. The `yields < 12` cap in `yield_stage` is the hard stop that prevents any
regression into unbounded regeneration, and test R8 pins it.

---

# PART B — FAILURE NOTIFICATION

## B.0 What exists, and what is missing

The working tree already has `notifyTerminal(stageId, proposalId, status, error)`: it takes
`notified_at` as a lock, writes an `escalations` row, and sends the customer one email. It is called
from exactly one place — the catch block, when `final` is true. Its own comment says the customer
paragraph is a placeholder because refund policy "is not one this code should invent".

Three things are still missing and each one leaves a paid order silent:

1. **The reaper's own failures are never observed.** `reap_stale_stages` is pure SQL
   (`20260820145739:114-123`); when it writes `failed` there is no TypeScript anywhere in the
   transaction. The catch block can never cover it. A sweeper is mandatory, not optional.
2. **No money decision.** The customer is told the proposal failed and nothing about the charge.
3. **Three terminal paths are outside the worker's catch entirely**: the price-mismatch park
   (`stripe-webhook:183-194`), a delivery email that Resend rejects (:1883 — `if (ok)` and no else,
   and `deliver` is `done`, so nothing ever retries), and an order that simply stops making progress
   without any stage reaching `failed`.

## B.1 Terminal paths, classified

| # | Terminal state | Produced at | Class | Money |
|---|---|---|---|---|
| 1 | 3 attempts exhausted in the catch | :1913-1917 | infrastructure | requeue once, then refund |
| 2 | reaper, `attempt >= max_attempts` | `20260820145739:117` | infrastructure | requeue once, then refund |
| 3 | similarity gate | :1749 | exclusivity | refund |
| 4 | `existing_claim_same_org` | :1434 | exclusivity | refund |
| 5 | `strategy_space_exhausted` (the 9th customer) | :1459 | capacity | refund |
| 6 | render service down, page limit unverifiable | :1846 | infrastructure | requeue once, then refund |
| 7 | rendered pages over donor limit | :1834 | compliance | refund |
| 8 | visual QA blocking | :1842 | compliance | refund |
| 9 | validation unresolved | :1642 | compliance | refund |
| 10 | budget over ceiling after rework | :1542 | compliance | refund |
| 11 | content validation failed | :675 | compliance | refund |
| 12 | Stripe price mismatch, no stages created | `stripe-webhook:183-194` | price_mismatch | refund |
| 13 | isolate torn down mid-stage | platform | (becomes 1 or 2) | as 1/2 |
| 14 | **delivery email rejected by Resend** | :1883, no else branch | delivery | none — the work is done |
| 15 | **order stalls with no failed stage** | — | stalled | none yet — ops signal only |
| 16 | section yield budget exhausted | `yield_stage` returns false | infrastructure | requeue once, then refund |

Rows 14-16 are new. Row 14 is a completed, paid, delivered-to-storage proposal whose customer is
never told it exists — arguably the worst outcome in the table, and it is one unchecked boolean.

## B.2 DDL — appended to the same new migration

```sql
-- ---------------------------------------------------------------- failure notification
-- What happens to the customer's money, recorded where the code can see it.
alter table public.orders add column if not exists stripe_payment_intent text;
alter table public.orders add column if not exists refund_id text;
alter table public.orders add column if not exists refund_state text not null default 'none'
  check (refund_state in ('none','issued','manual_required','not_applicable'));
-- The delivery email has no failure path today: deliver sets completion_email_sent
-- only `if (ok)` and the stage is already done, so nothing ever retries. A finished,
-- paid proposal whose customer is never told it exists is the worst outcome we have.
alter table public.orders add column if not exists delivery_attempts smallint not null default 0;

-- An infrastructure failure gets exactly one free restart before it costs the
-- customer their order. This counts them.
alter table public.order_proposals add column if not exists requeue_count smallint not null default 0;

-- 20260826150000 already widened this CHECK; two more kinds are needed for the
-- paths that migration did not cover.
alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('similarity_exhausted','grant_merge','sanctions_review','planner_stuck',
                  'provenance_failed','price_mismatch','stage_failed','stage_held',
                  'order_stalled','delivery_failed','refund_required','systemic_failure','other'));

-- One free restart of a proposal from the failed stage onwards. Earlier stages keep
-- their outputs — they are this stage's inputs (ctx() at :1001 reads only 'done'
-- rows) — and any partial progress on the reset stages is dropped, because a restart
-- is for the case where the saved state is suspect. notified_at is cleared so a
-- second, real failure notifies again.
create or replace function public.requeue_proposal(p_proposal uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_seq smallint;
begin
  if (select requeue_count from public.order_proposals where id = p_proposal) <> 0 then
    return false;
  end if;
  select min(seq) into v_seq from public.job_stages
   where proposal_id = p_proposal and status in ('failed','held');
  if v_seq is null then return false; end if;

  update public.job_stages
     set status = 'pending', attempt = 0, yields = 0, error = null,
         progress = null, heartbeat_at = null, finished_at = null, notified_at = null
   where proposal_id = p_proposal and seq >= v_seq and status <> 'done';

  update public.order_proposals set requeue_count = 1, status = 'processing' where id = p_proposal;
  update public.orders o set status = 'processing'
    from public.order_proposals p where p.id = p_proposal and o.id = p.order_id and o.status = 'attention';

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('worker', 'proposal_requeued', 'order_proposal', p_proposal::text,
          jsonb_build_object('from_seq', v_seq));
  return true;
end; $$;
revoke all on function public.requeue_proposal(uuid) from public, anon, authenticated;
grant execute on function public.requeue_proposal(uuid) to service_role;
```

## B.3 Classification and the notifier

```ts
type FailClass = "capacity" | "exclusivity" | "infrastructure" | "compliance" | "unknown";

// The class decides three things at once: what the customer is told, what happens to
// their money, and how loudly the operator is woken. It is derived from the error
// string because that is the only signal the failure paths actually produce — every
// one of them is a `throw new Error(...)` with a stable prefix.
function classifyFailure(msg: string): FailClass {
  if (msg.includes("strategy_space_exhausted")) return "capacity";
  if (msg.includes("similarity gate") || msg.includes("existing_claim_same_org")) return "exclusivity";
  if (msg.includes("[timeout]") || msg.includes("[yield]") ||
      /\bllm \d{3}\b/.test(msg) || msg.includes("TimeoutError") || msg.includes("AbortError") ||
      msg.includes("render service") || msg.startsWith("rpc ") || msg.startsWith("sel ") ||
      msg.startsWith("patch ") || msg.startsWith("upload ")) return "infrastructure";
  if (msg.includes("page limit") || msg.includes("visual QA") || msg.includes("validation unresolved") ||
      msg.includes("content validation failed") || msg.includes("budget over limit") ||
      msg.includes("over ceiling") || msg.includes("generation incomplete")) return "compliance";
  return "unknown";
}

// What the customer reads. Every one of these is a TERMINAL statement — the order
// page stops being a progress bar and becomes an answer. None of them waits on a
// human, and none of them asks the customer to do anything.
const CUSTOMER_COPY: Record<FailClass, { subject: (n: string) => string; body: string }> = {
  capacity: {
    subject: (n) => `We cannot take on this grant — Order ${n}`,
    body: `<p>We guarantee that no two proposals we write for the same grant share an approach, a structure or an opening. That guarantee has a limit, and this grant has reached it: every distinct approach we can honestly reserve is already taken by an earlier applicant.</p>` +
      `<p>Rather than send you something that breaks the promise we sell, we have stopped and refunded you in full.</p>`,
  },
  exclusivity: {
    subject: (n) => `We could not meet our own uniqueness guarantee — Order ${n}`,
    body: `<p>Every proposal we write has to be demonstrably unlike every other proposal written for the same grant. Yours came too close to one already written, and our rewrites did not open the gap far enough.</p>` +
      `<p>We will not ship a document that fails our own test, so we have stopped and refunded you in full.</p>`,
  },
  infrastructure: {
    subject: (n) => `A problem on our side — Order ${n}`,
    body: `<p>Something on our side failed while your proposal was being written. This is our fault, not a problem with anything you sent.</p>`,
  },
  compliance: {
    subject: (n) => `We could not meet this donor's requirements — Order ${n}`,
    body: `<p>This donor sets limits we could not meet honestly — on length, on format, or on what we are able to state about your organisation without evidence for it.</p>` +
      `<p>We would rather refund you than send a document that would be rejected on a technicality or that claims something we cannot support. You have been refunded in full.</p>`,
  },
  unknown: {
    subject: (n) => `We could not finish your proposal — Order ${n}`,
    body: `<p>We were not able to finish your proposal, and we would rather tell you that than leave you watching a progress bar.</p>` +
      `<p>You have been refunded in full.</p>`,
  },
};

// Terminal-failure notification. Idempotent on job_stages.notified_at: a stage is
// notified at most once however many times the worker ticks over it. The order of
// operations is deliberate — claim the notification, decide the money, THEN write
// the escalation and send the mail — so that a crash mid-way can only ever lose the
// telling, never double-refund. Nothing in here is allowed to throw: a failure to
// notify must never mask the failure being notified.
async function notifyTerminal(stageId: number, proposalId: string, status: string, error: string) {
  try {
    const st = (await sel(`job_stages?id=eq.${stageId}&select=notified_at,key,label`))[0];
    if (!st || st.notified_at) return;
    await patch(`job_stages?id=eq.${stageId}`, { notified_at: new Date().toISOString() });

    const prop = (await sel(`order_proposals?id=eq.${proposalId}&select=id,order_id,requeue_count`))[0];
    if (!prop) return;
    const order = (await sel(`orders?id=eq.${prop.order_id}&select=*`))[0];
    if (!order) return;

    const cls = classifyFailure(error);
    const site = (await rpc("get_secret", { p_name: "site_url" })) ?? "https://ktebli.com";
    const link = `${site}/orders/${order.token}`;

    // One free restart for an infrastructure failure, and only one. The stage that
    // failed and everything after it goes back to pending; earlier outputs stand.
    if (cls === "infrastructure" && prop.requeue_count === 0) {
      const ok = await rpc("requeue_proposal", { p_proposal: prop.id }).catch(() => false);
      if (ok === true) {
        await opsAlert("stage_failed", order, prop.id,
          `RESTARTED (attempt 1 of 1) — ${st.key}: ${error}`, "normal");
        await sendEmail(order.email, `A hiccup on our side — Order ${order.order_no}`,
          `<p>Something on our side interrupted work on your proposal. We have restarted it automatically — you do not need to do anything, and you have not been charged twice.</p>` +
          `<p><a href="${link}">Your order page</a> will keep updating.</p><p>— Ktebli</p>`).catch(() => false);
        return;
      }
    }

    const money = await refundOrder(order, cls);
    const copy = CUSTOMER_COPY[cls];
    await opsAlert(status === "held" ? "stage_held" : "stage_failed", order, prop.id,
      `${cls} — ${st.key} (${st.label}): ${error} | money=${money.state}${money.id ? " " + money.id : ""}`,
      money.state === "manual_required" ? "deadline_72h" : "normal");

    await sendEmail(order.email, copy.subject(order.order_no),
      copy.body +
      `<p>It stopped at: <strong>${st.label}</strong>.</p>` +
      money.sentence +
      `<p>Nothing you sent us is kept for any other purpose, and you are welcome to come back for a different grant.</p>` +
      `<p>Order ${order.order_no}. <a href="${link}">Your order page</a>.</p><p>— Ktebli</p>`).catch(() => false);
  } catch { /* never let notification failure mask the original failure */ }
}
```

## B.4 The money

Stripe is already in the architecture; this adds one API call to it and no new service. Two things
must exist first: `orders.stripe_payment_intent`, captured in `stripe-webhook` at the row insert
(`:171-177`, one added field `stripe_payment_intent: s.payment_intent ?? null`), and a
`stripe_secret_key` Vault secret.

```ts
// Refunds are money, so the exactly-once guarantee is Stripe's own idempotency key
// rather than anything in this database: the same key can be POSTed any number of
// times and Stripe returns the first refund. orders.refund_state is the local
// record, not the lock.
async function refundOrder(order: Record<string, unknown>, cls: FailClass):
  Promise<{ state: string; id: string | null; sentence: string }> {
  const already = String(order.refund_state ?? "none");
  if (already === "issued") return { state: "issued", id: String(order.refund_id ?? ""), sentence: REFUND_SENTENCE };
  if (Number(order.amount_usd ?? 0) <= 0) {
    await patch(`orders?id=eq.${order.id}`, { refund_state: "not_applicable", status: "refunded" }).catch(() => {});
    return { state: "not_applicable", id: null, sentence: "" };
  }
  const key = await rpc("get_secret", { p_name: "stripe_secret_key" }).catch(() => null);
  const pi = order.stripe_payment_intent as string | null;
  // Degraded path. It is the only place in either half of this design where a human
  // is required, and it is deliberately outside the customer's proposal workflow:
  // the proposal is already terminal, and the escalation is about a charge, not a
  // review step that a document is waiting on. The pre-launch checklist must set
  // stripe_secret_key so this branch is never taken in production.
  if (!key || !pi) {
    await patch(`orders?id=eq.${order.id}`, { refund_state: "manual_required", status: "attention" }).catch(() => {});
    await ins("escalations", {
      kind: "refund_required", order_id: order.id, priority: "deadline_72h",
      detail: { order_no: order.order_no, amount_usd: order.amount_usd, class: cls, reason: !key ? "no stripe_secret_key" : "no payment_intent on order" },
    }).catch(() => {});
    return { state: "manual_required", id: null, sentence: REFUND_SENTENCE };
  }
  try {
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `ktebli-refund-${order.id}`,
      },
      body: new URLSearchParams({ payment_intent: pi, reason: "requested_by_customer" }).toString(),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`stripe ${r.status} ${String(j?.error?.message ?? "").slice(0, 120)}`);
    await patch(`orders?id=eq.${order.id}`, { refund_state: "issued", refund_id: String(j.id), status: "refunded" }).catch(() => {});
    await ins("events", { actor: "worker", action: "refund_issued", entity: "order", entity_id: String(order.id),
      detail: { refund: j.id, amount_usd: order.amount_usd, class: cls } }).catch(() => {});
    return { state: "issued", id: String(j.id), sentence: REFUND_SENTENCE };
  } catch (e) {
    await patch(`orders?id=eq.${order.id}`, { refund_state: "manual_required", status: "attention" }).catch(() => {});
    await ins("escalations", { kind: "refund_required", order_id: order.id, priority: "deadline_72h",
      detail: { order_no: order.order_no, amount_usd: order.amount_usd, error: String(e).slice(0, 200) } }).catch(() => {});
    return { state: "manual_required", id: null, sentence: REFUND_SENTENCE };
  }
}

// The customer is told the same thing whether the API call succeeded or an operator
// has to push it through, because from their side it is the same fact and the
// escalation guarantees it happens. What is never said is "we will follow up" —
// that is the promise order-status makes today and nothing can keep.
const REFUND_SENTENCE =
  `<p><strong>Your payment has been refunded in full.</strong> It returns to the card you paid with, ` +
  `usually within five to ten working days depending on your bank. You do not need to ask for it.</p>`;
```

## B.5 Operator alerts, and the two sweepers

```ts
// The operator half. Two channels, both best-effort, escalation FIRST so the durable
// record survives a Resend outage. This is an ops signal only: nothing in the
// customer's path ever waits on someone reading it.
async function opsAlert(kind: string, order: Record<string, unknown>, proposalId: string | null,
                        detail: string, priority: "normal" | "deadline_72h") {
  await ins("escalations", {
    kind, order_id: order.id, order_proposal_id: proposalId, priority,
    detail: { order_no: order.order_no, tier: order.tier, org: order.org_name, amount_usd: order.amount_usd, note: detail },
  }).catch(() => {});
  const to = await rpc("get_secret", { p_name: "support_email" }).catch(() => null);
  if (!to) return;
  // A systemic outage must not send five hundred emails. When the open escalation
  // rate crosses a threshold, one alert goes out and the rest live in the table.
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const recent = await sel(`escalations?status=eq.open&created_at=gte.${since}&select=id`).catch(() => []);
  if (recent.length > 5) {
    if (recent.length !== 6) return;                   // exactly one alert per burst
    await sendEmail(to, `[Ktebli ops] SYSTEMIC — ${recent.length} failures in 15 minutes`,
      `<p>More than five orders have failed terminally in the last fifteen minutes. Per-order emails are suppressed; see the escalations table.</p>`).catch(() => false);
    return;
  }
  await sendEmail(to, `[Ktebli ops] ${kind} — Order ${order.order_no} (${order.tier})`,
    `<p><b>Order</b> ${order.order_no} · ${order.org_name} · ${order.tier} · $${order.amount_usd}</p>` +
    `<p><b>Detail</b> ${detail}</p><p><b>Email</b> ${order.email}</p><p><b>Order id</b> ${order.id}</p>`).catch(() => false);
}

// Sweepers. These run once per invocation, immediately after reap_stale_stages at
// :1900, and they are what make notification complete rather than best-effort.
async function sweepUnnotified() {
  // MANDATORY, not a belt-and-braces addition: reap_stale_stages is pure SQL and no
  // TypeScript ever observes its transitions, so the catch block at :1912 structurally
  // cannot cover a reaper-produced failure. notified_at makes this exactly-once.
  const rows = await sel(
    `job_stages?status=in.(failed,held)&notified_at=is.null&select=id,proposal_id,status,error&limit=20`).catch(() => []);
  for (const r of rows) await notifyTerminal(r.id, r.proposal_id, r.status, String(r.error ?? "[timeout]"));
}

async function sweepStalled() {
  // An order that stops making progress WITHOUT any stage reaching failed: repeated
  // isolate teardown, a stuck global cap, cron not ticking, or the price-mismatch
  // park. It has no failed stage, so nothing above sees it. This is an ops signal
  // only — the order may still finish, and the customer is not told anything yet.
  const cutoff = new Date(Date.now() - 45 * 60_000).toISOString();
  const orders = await sel(
    `orders?status=in.(paid,processing)&created_at=lt.${cutoff}&select=id,order_no,tier,org_name,email,amount_usd,token&limit=10`).catch(() => []);
  for (const o of orders) {
    const open = await sel(`escalations?order_id=eq.${o.id}&kind=eq.order_stalled&status=eq.open&select=id&limit=1`).catch(() => [{}]);
    if (open.length) continue;                          // already raised; do not raise it every minute
    // PostgREST has no subselect, so the proposal ids are fetched first and passed
    // as an in.() list — the same two-step shape ctx() uses at :997-999.
    const props = await sel(`order_proposals?order_id=eq.${o.id}&select=id`).catch(() => []);
    if (!props.length) { await opsAlert("order_stalled", o, null, "order has no proposals and no stages", "deadline_72h"); continue; }
    const ids = props.map((p: { id: string }) => p.id).join(",");
    const moving = await sel(
      `job_stages?proposal_id=in.(${ids})&finished_at=gte.${cutoff}&select=id&limit=1`).catch(() => [{}]);
    if (moving.length) continue;
    await opsAlert("order_stalled", o, null, `no stage has finished in 45 minutes`, "deadline_72h");
  }
}

async function sweepUndelivered() {
  // Terminal path 14: every proposal complete, the documents in storage, and the
  // customer never told because Resend returned non-ok once and deliver was already
  // done. Three tries, then it becomes an ops problem rather than silence.
  const rows = await sel(
    `orders?status=eq.complete&completion_email_sent=is.false&delivery_attempts=lt.3&select=*&limit=10`).catch(() => []);
  for (const o of rows) {
    await patch(`orders?id=eq.${o.id}`, { delivery_attempts: (o.delivery_attempts ?? 0) + 1 }).catch(() => {});
    const site = (await rpc("get_secret", { p_name: "site_url" })) ?? "https://ktebli.com";
    const ok = await sendEmail(o.email, `Your proposal is ready — Order ${o.order_no}`,
      `<p>Everything in your order is ready.</p><p><a href="${site}/orders/${o.token}">Open your order page to download everything</a>.</p><p>— Ktebli</p>`);
    if (ok) await patch(`orders?id=eq.${o.id}`, { completion_email_sent: true }).catch(() => {});
    else if ((o.delivery_attempts ?? 0) + 1 >= 3) await opsAlert("delivery_failed", o, null, "Resend rejected the delivery email three times", "deadline_72h");
  }
}
```

Wired into `Deno.serve` at :1900:

```ts
  await rpc("reap_stale_stages").catch(() => {});
  await sweepUnnotified();
  await sweepUndelivered();
  await sweepStalled();
```

All three are bounded by `limit`, run before the claim loop, and add three cheap selects to a tick
that already does several.

## B.6 The price-mismatch dead end (`stripe-webhook:183-194`)

Today the customer gets an order page with `proposals: []` and no email of any kind — the function
returns at :193, before the "we're on it" email at :205. The `escalations` insert at :190 was a
silent no-op until `20260826150000` fixed the CHECK and the `due_at` default.

```ts
  if (!priceOk) {
    // Charged amount does not match the claimed tier: queue no paid work, and do not
    // leave the customer with a silent order page. They paid something; they are told
    // what happened and refunded.
    await ins("events", { /* unchanged */ }, false).catch(() => {});
    await ins("escalations", {
      kind: "price_mismatch", order_id: order.id, priority: "deadline_72h",
      detail: { order_no: order.order_no, tier, paid_usd: paidUsd, expected_usd: expectedUsd ?? null, session: s.id },
    }, false).catch(() => {});
    const support = (await rpc("get_secret", { p_name: "support_email" })) ?? "hello@ktebli.com";
    await sendEmail(email, `We could not start Order ${order.order_no}`,
      `<p>Your payment came through, but the amount does not match the ${tier} tier, so we have not started any work.</p>` +
      `<p><strong>We are refunding it in full.</strong> It returns to the card you paid with, usually within five to ten working days.</p>` +
      `<p>If you meant to order the ${tier} tier, please start again from the site — or write to ${support} and quote Order ${order.order_no}.</p><p>— Ktebli</p>`).catch(() => false);
    if (support) await sendEmail(support, `[Ktebli ops] price_mismatch — Order ${order.order_no}`,
      `<p>${tier}: paid $${paidUsd}, expected $${expectedUsd ?? "?"} · session ${s.id}</p>`).catch(() => false);
    return new Response(JSON.stringify({ ok: true, parked: true }), { status: 200 });
  }
```

The refund itself is left to the same `refund_required` escalation rather than duplicating
`refundOrder` into a second function: `stripe-webhook` must answer Stripe inside its webhook
timeout, and a mismatched charge is by definition already anomalous. It is the one path where an
operator touches money, and it is the path where an operator *should*.

## B.7 `order-status` — remove the promise that cannot be kept

`order-status:70-74` tells a paying customer "we will follow up by email" in exactly the state where
no code could send one. Once B.5 exists that sentence becomes true, but only after the email has
actually gone out — so the copy is driven by `notified_at`, not by status. `error` stays unexposed.

```ts
    const stages = await sel(`job_stages?proposal_id=eq.${p.id}&select=seq,key,label,status,started_at,finished_at,notified_at,output&order=seq`);
    ...
      stages: stages.map((s: Record<string, unknown>) => ({
        seq: s.seq, label: s.label, status: s.status,
        started_at: s.started_at, finished_at: s.finished_at,
        // Three distinct states, where there was one soothing sentence that was
        // true for a slow order and a lie for a dead one.
        note: (s.status === "held" || s.status === "failed")
          ? (s.notified_at
              ? "We could not complete this step. We have emailed you about it, and about your refund."
              : "This step needs another attempt. If it does not clear, we will email you.")
          : null,
      })),
```

and at the order level (:78-82):

```ts
    order: {
      token: o.token, order_no: o.order_no, status: o.status, tier: o.tier,
      org_name: o.org_name, created_at: o.created_at, email: o.email,
      // The page must be able to stop being a progress bar.
      terminal: o.status === "refunded" || o.status === "complete",
      refunded: o.refund_state === "issued" || o.refund_state === "manual_required",
    },
```

---

# PART C — TEST PLAN

Everything runs against a **local stack** (`supabase start`) and a fresh `supabase db reset` that
replays all thirteen migrations. Nothing touches project `uocauqflcqefgdixbzpf`. No test creates an
order in production, per the `bench_cases` convention.

Harness (`tests/resumability/harness.ts`), the same shape the reliability audit specifies: patch
`globalThis.fetch` to intercept `openrouter.ai`, `api.resend.com`, `api.stripe.com` and the render
service **before** `await import("../../supabase/functions/worker/index.ts")`, then drive the worker
over HTTP with the correct `x-worker-secret`. The stub records every call: URL, body, and for
OpenRouter the section heading it was asked for. A `seedOrder(tier)` helper inserts one order, one
`order_proposals` row and the `stagesFor(tier)` rows directly, so no Stripe call is needed.

### C.1 Resumability

| id | Setup | Assertion | Status today |
|---|---|---|---|
| **R1** | stub sleeps 200 s on one call; one stage running | with the beat timer armed, `reap_stale_stages()` returns 0 and the stage is still `running` | **fails today** — this is the residual v21 hole |
| **R2** | stub never responds | the call aborts at ~120 s with `TimeoutError`; the stage does not sit `running` forever | **fails today** |
| **R3** | stub delays 40 s per call, tier `full` | invocation returns before `SOFT_DEADLINE_MS + YIELD_RESERVE_MS`; row is `pending`; **`attempt` is unchanged**; `yields = 1`; `progress` is non-null | **fails today** |
| **R4** | stub returns one section per call and counts calls per heading; run the worker three times | stage reaches `done`; the narrative contains every planned heading, in plan order; **each heading was generated exactly once across all three invocations** | **fails today** |
| **R5** | after a partial run, back-date `heartbeat_at` by 4 minutes on the *running* row, call `reap_stale_stages()`, run again | row → `pending`, `progress` intact, completed sections not regenerated (call counter unchanged for them) | **fails today** |
| **R5b** | back-date `heartbeat_at` by 4 minutes on a *yielded* row | `reap_stale_stages()` returns 0 and the row is untouched — a yielded stage never looks dead | new |
| **R6** | resume with `design.output` mutated between invocations | `progress` discarded; the narrative is rebuilt from section 1; the final document contains no text from the first plan | new |
| **R7** | force 13 yields (`SOFT_DEADLINE_MS` set to 1 in the test build) | the 13th `yield_stage` returns false, the stage goes `failed`, and `notifyTerminal` fires exactly once | new |
| **R8** | tier `full`, happy path | total OpenRouter calls under a fixed ceiling (currently 8 for `gen:narrative`, 22 worst case); the test pins the number so a regression into unbounded regeneration is a red test | new |
| **R9** | tier `full`, happy path | deterministic coherence checks: every planned heading present exactly once and in order; no `#` H1; no sentence of ≥12 words appearing in two sections; every distinct value of a `design.project` number appearing identically wherever it appears; `wordCount(doc) <= fmt.maxWords` **computed in code, never asked of a model** | new |
| **R10** | blind evaluation, per `reports/quality-standard.md` | the same fixture generated single-call (v26) and sectioned, judged blind by a **different model family** from the generator, which is shown only the grant, the applicant and the narrative and asked which reads as one author's continuous document. Gate: sectioned is **not worse**. This is the only test of coherence that is not mechanical, and it is the one that decides whether the design ships | new |
| **R11** | run `package` twice against the same proposal, and `deliver` twice | identical storage paths and file count (`x-upsert`), and exactly one Resend call (`completion_email_sent`) | passes today; pinned as a regression |
| **R12** | `validate` at tier `full`, stub delaying 90 s per call | yields at a round boundary; on resume, `rounds` continues from the persisted index and the previous round's Claim-Ledger calls are not repeated | **fails today** |

### C.2 Notification

| id | Setup | Assertion |
|---|---|---|
| **N1** | for each of rows 1-11, a stub that throws that exact error string | exactly one customer Resend call, one ops Resend call, one `escalations` row, and the class in the ops subject matches the table in B.1 |
| **N2** | insert a `running` row with `attempt = 3` and a heartbeat back-dated 4 minutes; run the worker | `reap_stale_stages` marks it `failed` **and** `sweepUnnotified` notifies. This is the case the catch block structurally cannot cover |
| **N3** | run the worker twice over the same failed row | exactly one customer email, one ops email, one refund POST (`notified_at` + the Stripe idempotency key) |
| **N4** | plain SQL: insert one `escalations` row of every `kind` the code uses, with `due_at` omitted | all succeed. Fails against the pre-`20260826150000` schema, which is the point |
| **N5** | infrastructure failure, `requeue_count = 0` | `requeue_proposal` returns true, stages from the failed one onward are `pending` with `attempt = 0` and `notified_at` null, earlier `done` outputs untouched, **no refund**, and the customer email says "restarted" |
| **N6** | the same order fails again | `requeue_proposal` returns false, refund POSTed exactly once, `orders.status = 'refunded'`, `refund_state = 'issued'` |
| **N7** | `stripe_secret_key` absent | `refund_state = 'manual_required'`, a `refund_required` escalation at `deadline_72h`, and the customer email still states the refund — the promise the escalation guarantees |
| **N8** | Stripe stub returns 500 | same as N7; the worker does not throw and the stage's terminal status is unchanged |
| **N9** | Resend stub returns 500 for the delivery email | `completion_email_sent` stays false; `sweepUndelivered` retries on the next two ticks; after the third, one `delivery_failed` escalation |
| **N10** | an order 46 minutes old with no finished stage | exactly one `order_stalled` escalation and one ops email, and **no second one** on the following tick |
| **N11** | seven terminal failures inside 15 minutes | exactly one `systemic_failure` ops email; seven `escalations` rows; seven customer emails (customers are never suppressed) |
| **N12** | `order-status` against a notified failed stage, and against a not-yet-notified one | two different notes, `error` absent from the response in both, `order.terminal` true only after refund |
| **N13** | `stripe-webhook` with a $99 payment tagged `tier=draft` | one customer email, one ops email, one `price_mismatch` escalation with `order_id` set, and **zero** `job_stages` rows |

### C.3 The no-human invariant

One test, asserted over the union of N1-N13: for every terminal class, the order reaches a terminal
`orders.status` (`refunded` or `complete`) and the customer receives exactly one terminal email,
**with no operator action taken in the test**. The single exception is `refund_state =
'manual_required'`, which is asserted to be reachable *only* when `stripe_secret_key` or
`stripe_payment_intent` is missing — both of which are pre-launch checklist items, not runtime
states.

---

# PART D — ORDER OF WORK, AND WHAT COULD GO WRONG

1. **Migration first** (`20260826160000`). It is additive: three columns on `orders`, two on
   `job_stages`, one on `order_proposals`, two functions, one widened CHECK. Nothing the deployed
   v26 does is affected by any of it.
2. **Part B second**, as the audit argues: it is the smaller change and it converts every failure in
   Part A's blast radius from an unknown unknown into a measured rate. Ship B, watch the escalations
   table for a day, then ship A.
3. **A.4 before A.5-A.9.** The beat timer and the `AbortSignal` are eight lines and fix R1 and R2
   without any of the section machinery. They are worth deploying on their own.
4. **Byte-verify every deploy**, per `CLAUDE.md`: `supabase functions deploy worker`, then
   `supabase functions download worker` and `sha256sum` both copies. The v25 over-escaping corruption
   would have been invisible in every other check, and this change adds several new template literals
   containing bare double quotes.

Risks I would watch:

- **The seam pass is the quality risk.** It is the only call permitted to rewrite finished text, and
  its constraint list is long. If R10 shows it hurting, drop it: the design is still correct without
  it, because mechanisms 1-5 in A.7 do the structural work and the seam pass only polishes joins.
  It is deliberately isolated behind `pg.seamed` so it can be disabled with one boolean.
- **Section-level word budgets can under-fill.** Six sections at 250 words is 1 500, and a donor
  limit of 3 000 would leave the document short. `minWords: 450` in `narrativeOpts` (:1134) catches
  the gross case at assembly; the per-section target is derived from the real limit, so the failure
  mode is a document at 94 % of the limit, which is the intent.
- **`SOFT_DEADLINE_MS = 240_000` is a guess about the platform ceiling.** It must be set below the
  deployment's actual edge-function wall-clock limit with margin. If it is set too high, a yield
  never happens and the design silently degrades to today's behaviour — which is why R3 asserts the
  invocation *returns*, not merely that it eventually completes.
