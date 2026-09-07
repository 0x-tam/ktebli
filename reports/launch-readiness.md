# Ktebli — launch readiness & handoff

**Date:** 2026-09-02 · **For:** whoever picks this up next (human or agent) to carry it to launch.
**Read this file first.** It is written to be self-contained — you should not need this
project's chat history to act on it. Where it references another file, that file exists
and is current.

---

## 1. Where this stands, in one paragraph

The pipeline can now run a real paid-tier order end to end and reach the delivery gate —
proven exactly **once**, on a real applicant (Sufra NW London, a food-security charity),
against a real grant (a homelessness/move-on fund). The gate's own independent judge
called the output *"exceptionally grounded and specific"* and it held on **Donor fit
(3/4)** — a genuine mission mismatch between that applicant and that grant, which is the
gate working correctly, not failing. **Zero proposals have ever been delivered to a
customer.** Today's work (2026-09-02) added a generation-density fix, real per-tier model
selection, and a code-enforced spend cap — all committed, all tested, **none deployed**.
Production is still worker **v26**, which cannot complete a design stage at all. Nothing
in this repo has touched production this entire engagement.

**The one-sentence bar for launch:** at least one well-matched real applicant needs to
clear the delivery gate — pass, not hold — on the actually-deployed system, before you
charge a stranger money. That has not happened yet.

---

## 2. Before you touch anything: constraints that do not flex

These come from `CLAUDE.md` at the repo root — read that file in full, it is short and
it is the actual authority, this section is a reminder, not a replacement.

- **Production (`uocauqflcqefgdixbzpf`) is never touched without deliberate, verified,
  byte-checked deploys.** A prior deploy (v25) was silently corrupted by a JSON
  over-escaping bug; only a byte-for-byte comparison against local source caught it.
  Every future deploy gets the same treatment. See `DEPLOY.md`.
- **Nothing is ever invented.** Every fact in a proposal traces to the Evidence Ledger.
  This is not a style preference — it is the entire safety architecture (Claim Ledger,
  proper-noun audit, contact-detail audit, the delivery gate's D4 check). Do not weaken
  any of these to make an order "pass" faster.
- **No human enters the customer workflow.** Fully automated end to end.
- **Exclusivity is unbounded** — the 8-per-grant ceiling was deliberately removed; do not
  reintroduce a finite pool.
- **Cost is measured from the provider's own accounting** (`usage.include`, OpenRouter's
  reported `cost` field), never reconstructed from token counts.
- **A model call is real money.** Before running anything that spends, check the live
  OpenRouter balance; stop and report rather than run through the account. See §6.

---

## 3. What actually happened today (2026-09-02) — for context on what's fresh

Three pieces of work landed, all local, all passing the full test suite
(`sudo env DENO=<path> PGBIN=/usr/lib/postgresql/17/bin bash tests/run-all.sh` →
`ALL SUITES PASSED`), none deployed:

1. **Generation density fix** (`supabase/functions/worker/proper_nouns.ts`,
   `delivery_gate.ts`, `index.ts`) — the one order that reached the gate held partly on
   D4 (using only 75 of 155 available grounded referents; the correction that removes
   ungrounded claims was leaving the draft too sparse). `properNounAudit()` now returns
   the actual list of unused ledger names (not just a count), both the validate finding
   and the gate's regeneration brief hand the model concrete names to weave in, and every
   generation call gets a proactive density instruction up front. **Not yet proven against
   a real generation** — typechecked and unit/regression-tested only.
2. **Per-tier model selection** (`index.ts`) — `resolveTierModel()`, four new secrets
   (`openrouter_model_draft/_competitive/_full/_full_pool`), all default to unset (falls
   through to the flat `openrouter_model`, i.e. today's behavior). Target config decided
   and documented in `DEPLOY.md`: **Draft → Sonnet 5, Competitive → Opus 5, Full → Fable
   5.1**. A real correctness bug was caught and fixed while wiring this: the delivery
   gate's `generatorModel` field (which decides which judge family is allowed — the
   generator must never grade its own work) was hardcoded to the flat model; it now
   correctly reads the resolved tier model.
3. **Spend cap, two layers** (`index.ts`, two migrations) — a per-proposal ceiling
   checked before every stage (`order_proposals.spend_usd`, monotonic, survives retries;
   `spend_cap_draft/_competitive/_full_usd` secrets, currently $8/$14/$40 — see §7 for
   how those numbers were chosen) and an account-wide floor checked once per worker
   invocation (`openrouter_balance_floor_usd`, default $3) that refuses to claim *any*
   stage work below the floor, non-destructively. This exists because a budget overrun
   during this project's own history had no code-level backstop — only a human
   remembering to check, which had already failed once.

All of this is on the branch `claude/supabase-audit-verify-77v56v`, **182 commits ahead
of `origin`**, and **could not be pushed** from this machine — see §4.

---

## 4. Immediate blocker: git push access

`git push origin claude/supabase-audit-verify-77v56v` fails with a real GitHub 403: the
account configured on this machine (`0x-jarvis`) does not have write access to
`0x-tam/ktebli`. This is not a code problem and not something to route around. Fix one of:
- add `0x-jarvis` as a collaborator with write access on the GitHub repo, or
- push from a machine/session that already has `0x-tam` push credentials.

Nothing is at risk in the meantime — every commit is safe in the local repo.

---

## 5. The task list, in priority order

### 5.1 — Get the branch onto GitHub and merged (blocking everything else)
Resolve §4, push, review, merge to `main` (or whatever your deploy source is). Trivial
once access exists.

### 5.2 — Validate the two new-to-this-pipeline models before they touch money
Neither Sonnet 5 nor Fable 5.1 has ever run through this pipeline. Every fix this project
has made (JSON malformation rate, design-stage runaway, currency drift, the density fix
above) was found by running a *specific* model through a *real* order — a different model
can have a different failure profile nothing here has caught yet.

- **Sonnet 5 (Draft candidate):** set `openrouter_model_draft` to
  `anthropic/claude-sonnet-5`, run one real Draft-tier order end to end on the local dev
  stack (see §8 for how to bring it up), and confirm it reaches a delivery-gate verdict
  (pass or a *correctly reasoned* hold — not a crash, not a stuck loop, not a spend-cap
  trip). Budget ~$1–3.
- **Fable 5.1 (Full candidate):** same procedure, `openrouter_model_full`, Full-tier
  order. Budget ~$5–15 (Full does the most tier work: up to 5 documents, up to 6 validate
  rounds, and Fable 5.1 is 2× Opus 5's per-token price).
- **Competitive (Opus 5) needs no new validation** — it stays on the model everything
  else has already been tuned against.
- **DEPLOY.md already states this as a hard rule: do not set Draft or Full live for
  paying customers until each clears this.** Don't relax that note when you update it —
  tighten it if anything, once you have the real result.

### 5.3 — Confirm the density fix actually improves specificity
Section 3.1's fix is code-verified, not generation-verified. The cheapest way to check
both 5.2 and 5.3 at once: the validation runs above ARE the test. Watch the resulting
narrative's proper-noun usage (`properNounAudit` output in the `validate` stage's
persisted `output`) — it should use meaningfully more than half the ledger's offered
referents without the correction loop needing to fight it back down.

### 5.4 — Get a real applicant to actually PASS the gate
Zero orders have ever passed. Sufra held on donor-fit (a real mismatch, not a bug). Three
more applicants were researched for exactly this purpose and are sitting ready, untouched,
in `stack/out/phase8-research/`: `magpie.json`, `glassdoor.json`, `nourish.json` (plus
`sufra.json`, already used). **Glass Door is a homelessness charity — the best donor-fit
match for the trial grant used throughout this project (LBF New Beginnings) — and was
explicitly pinned/deferred by the operator on 2026-09-02, not run.** It remains the
highest-value next order to run, whenever you're ready to spend on it (~$5–15 depending
on how many validate rounds it needs). This is the one piece of evidence still missing
before you can honestly claim "you'll get your money's worth."
- Use `tests/benchmark/create-order-phase8.py <slug>` to create the order from the
  researched intake (it bypasses checkout deliberately — a local benchmark forging its
  own payment clearance would test its own forgery, so this only ever runs on the local
  dev stack, never against production).
- Drive it with a sequential single-tick-at-a-time script against the local edge runtime
  (see §8) — do not use a tight polling loop against Kong's port, it has a ~150s client
  timeout that does not reflect the deployed runtime's real behavior; the direct
  edge-runtime port bypasses it for local testing, matching what a real deployed
  invocation is actually bounded by (~150s Kong-equivalent on hosted Supabase, so any
  stage must complete within that regardless — see the P0.3 history in
  `reports/phase8-intake.md` if you need the detail).

### 5.5 — Deploy to production, byte-verified
Everything above is local-only. Before deploying:
1. `supabase functions download worker` (and the other seven functions if they've
   changed) and diff byte-for-byte against local source. Do not trust a transcribed
   copy — see `CLAUDE.md`'s source-of-truth warning.
2. Apply the pending migrations (`supabase/migrations/20260901120000_intake_evidence_facts.sql`
   through `20260902093000_escalation_kind_spend_cap.sql` — check
   `tests/replay/run.sh`'s "UNDEPLOYED MIGRATIONS" output for the exact current gap
   against production).
3. Deploy the worker function via the Supabase CLI (uploads from disk — this is the
   documented safeguard against the class of corruption that hit v25).
4. Set the new Vault secrets from §3 (model selection + spend caps) on the **production**
   project, not just locally.
5. Re-verify byte-for-byte against what's now live.
6. Watch the first few real invocations closely — three properties of the deployed
   runtime were never reproducible locally and remain genuinely unproven: edge-function
   invocation timeouts under real load, cold starts, and heartbeat behavior under
   Supabase's actual (not simulated) concurrency. See §9.

### 5.6 — Clear the operator checklist (unrelated to any of today's work, still open)
See §10. None of these are code-blocked; all are one action away.

### 5.7 — Only then: launch publicly
Once 5.1–5.6 are done and at least one real, well-matched applicant has *passed* the gate
on the deployed system — not just reached it — you have a claim you can back up publicly.
Recommend a quiet/limited rollout before any broad announcement: watch the first several
real customer orders per §9 before pointing traffic at it from social media.

---

## 6. Budget discipline for whoever runs the validation orders in §5.2/5.4

- Check the live OpenRouter balance before starting, and again after each order — the
  account-wide floor (§3, $3 default) will refuse new work below that, but don't rely on
  the floor alone; check by hand too.
- These are real orders against real models — expect $5–20 total across the runs in
  §5.2–5.4. Do not run all of them back-to-back without checking balance in between.
- If a validation run behaves unexpectedly (a stage looping, a stuck resumable stage,
  a spend-cap trip on a LEGITIMATE-looking order), **stop, investigate, don't just
  increase the cap** — the caps in §3 were sized deliberately generously already; a real
  order hitting one is a signal something is actually wrong, not that the number was
  too tight (see the reasoning in `index.ts`'s spend-cap comment block for how those
  numbers were derived).

---

## 7. How the current spend caps were chosen (so you know whether to revisit them)

Reasoned bottom-up from real measured per-stage costs (design, audit, correction calls)
at real OpenRouter pricing, scaled by each tier's actual target model's price ratio, not
a flat guess:

| Tier | Target model | Worst-case *legitimate* cost estimate | Cap | Headroom |
|---|---|---|---|---|
| Draft | Sonnet 5 | ~$1.10 | $8 | ~7× |
| Competitive | Opus 5 | ~$3.20 | $14 | ~4× |
| Full | Fable 5.1 | ~$8.50 | $40 | ~4.7× |

These are **estimates**, not measurements — no clean, full, current-code run has been
priced end to end on any of these models yet. Once §5.2/§5.4 produce real numbers,
consider tightening the caps toward the real measured ceiling — but keep meaningful
headroom; the cap's only job is catching a bug (a loop that never converges), never
saving a few dollars on a legitimate order. A cap so tight it fails a real customer's
real order is worse than a cap that's slightly too generous.

---

## 8. Local dev stack — bringing it back up

The stack was fully stopped after the last work session (`supabase stop`, which backs up
the local DB volume). To resume:
```
supabase start
```
Postgres major is 17 (matches production). If you need the schema-replay test tooling
(`tests/replay/run.sh`, `tests/exclusivity/run.sh`), both need `PGBIN=/usr/lib/postgresql/17/bin`
and root privileges (they spin up their own throwaway cluster via `su postgres`):
```
sudo env PGBIN=/usr/lib/postgresql/17/bin bash tests/replay/run.sh
sudo env DENO=<path-to-deno> PGBIN=/usr/lib/postgresql/17/bin bash tests/run-all.sh
```
Clean `/tmp/ktebli-replay` and `/tmp/ktebli-exclusivity` with `sudo rm -rf` between runs
if you see permission errors — they're owned by `postgres` from the previous run.

The `.env` file with the OpenRouter key lives at `stack/.env` — never print or commit its
contents.

---

## 9. First real orders — what to watch (unchanged from before today, still accurate)

**Per order, watch (the append-only `events` table):**
- the **evidence ledger** size: how many real referents the crawl + intake yielded past
  the identity gate. Sufra had 155; below the sufficiency floor the order should HOLD,
  not ship generic.
- the **gate decision**: pass or hold, the hold code (QUALITY vs INFRA — disjoint), the
  judge's scores. The gate is hold-biased with known low agreement (its best validated
  judge, gemini, agreed with a blind human critic panel 77.8% of the time) — it will hold
  more than a perfect judge would, which is the safe direction, but a pattern of holding
  genuinely fundable work is the signal to revisit the judge model, not to loosen the bar.
- **stage durations and per-stage cost** (from each stage's own `usage` field, per-stage,
  never a shared global).
- any **refund** (the QUALITY_HOLD path) and any **operator escalation** (INFRA_HOLD,
  or now also `spend_cap`).

**Three things this machine could never prove — properties of the deployed runtime that
only the first real invocations will show:**
1. **Edge-function invocation timeouts on Competitive/Full under real platform load.**
   Locally, Kong's client timeout was set to 150s specifically to match the hosted
   platform's own limit, and the resumable-stage work (validate, gen:*, the gate) was
   built and proven against that number — but it was never tested against production's
   *actual* enforcement of it, only a local approximation.
2. **Cold starts.**
3. **Heartbeat behavior under Supabase's real invocation lifecycle and concurrency** —
   the reaper logic (3-minute stale-stage timeout) is unit-tested; its interaction with
   the real platform under real load is not.

---

## 10. OPERATOR checklist — one sitting, under thirty minutes, each item one action

None of these are blocked by the codebase. All require account credentials only you have.

1. **Deploy `render-service/`** and set its two Vault secrets
   (`render_service_url`, `render_service_secret`) — verified working locally (Docker
   image builds, a real render returned correct page counts). Until deployed, any donor
   **page** limit blocks delivery by design (page count is never estimated, only measured).
2. **Set a separate fallback judge credential** — `openrouter_api_key_fallback` — for
   real provider-outage isolation on the delivery gate's two-judge ladder. Optional but
   recommended; today both slots resolve to the same key.
3. **Set a deliberate OpenRouter spend limit on the production key itself**, sized for
   expected order volume with headroom — this project's own history includes two runs
   killed by an undersized total-spend cap at the account level (separate from the
   per-order caps in §3, which are a different layer).
4. **Create Stripe payment links for Competitive and Full** (Draft's $1 trial link
   exists) and wire their URLs into `order.html`.
5. **Deactivate the $1 trial payment link** before real launch.
6. **Verify the Resend sending domain** so `sendEmail` actually sends — today it returns
   `false` without a verified domain; every terminal failure and hold path already
   records its intent and raises an operator escalation regardless, so nothing is lost
   silently in the meantime, but customers won't get their emails.
7. **Review the two DRAFT customer wordings** (`reports/phase6-eng.md`: terminal-failure
   and QUALITY_HOLD letters). They're shipping defaults — short, plain, no em dashes;
   the INFRA_HOLD wording deliberately never tells the customer their proposal failed
   (because it hasn't — it's an infrastructure event). Edit to your voice, remove the
   DRAFT marker.

---

## 11. Reference — history, for context only (not action items)

`RUNLOG.md` and `git log` are the full audit trail. Prior phases (numbered, for
continuity with earlier reports):

| phase | outcome |
| --- | --- |
| 0 — stack | Local dev stack up, migrations replay clean, fingerprints match production |
| 1 — ten verdicts | Pipeline-vs-single-prompt quality tie, 5–5, on a blind ladder |
| 2 — the fork | Pipeline architecture kept — a simpler hybrid lost 0/4 in a pre-committed test |
| 3 — the gate | Delivery gate v2 built; judge validated against 56 blind human judgements |
| 4 — compliance | Donor-limit parsing hardened; render-service verified with a real render |
| 5 — six crawls | Real-site crawl hardened against 9 silent-failure classes |
| 6 — engineering | Three P0s fixed (refund-recording, a schema mismatch, clearance enforcement) |
| 6 — benchmark | First live Draft order correctly held at validate on data starvation — the root cause that opened phase 8 |
| 6.5 — adversarial | 9 safety invariants adversarially attacked; 4 held, 5 broken-then-closed, all re-attack-proven |
| 8 — intake expansion | Nine hidden pipeline defects found and fixed by driving one real order to the gate; the result and its meaning are §1 of this file |

`BLOCKED.md` records the one genuine architectural ceiling (proposal prose quality is
data-bound, not architecture-bound — phase 1/2's finding). `reports/adversarial/residual-boundary.md`
records two deterministic-irreducibility residuals from the adversarial round, both in the
safe (discard-not-fabricate) direction and both backstopped by the Claim Ledger.
`reports/phase8-intake.md` has the full detail behind §1 and §3 of this file, including the
nine-fix table with root causes. `NEEDS-CREDIT.md` is now historical (resolved) but records
the honest account of the budget overrun that motivated §3's spend cap.

**The single most important engineering finding from the adversarial round, still true
and still the thing to check first in any future review:** every broken invariant failed
for the same reason — a sound, isolated, unit-tested mechanism whose verdict was never
actually wired into the decision or generation path it was supposed to govern. When
reviewing any change, trace the verdict from where it's computed to where a decision
consumes it; that seam is where this system has failed before.
