# Ktebli — launch readiness

**Date:** 2026-08-28 · **Prepared by:** the autonomous gauntlet run (see RUNLOG.md, git log).

**Recommendation: NOT READY to charge real customers yet — one product gap and one runtime
gap remain, both now precisely diagnosed.** Phase 8 (intake expansion) was opened because the
system could not complete a real order (KT-10001 held at grounding on data starvation). The
intake redesign that fixes that is built, critic-passed, and merged — the worker now grounds a
customer's structured evidence-interview answers (proper-noun starvation 9→0), so the data
cause is closed. But the end-to-end proof (four real orders to the delivery gate) is NOT yet
in hand: the four applicants' real intake was researched and verified and one order ran through
crawl→ledger→strategy on real facts, then stalled at the DESIGN stage — a monolithic high-effort
model call that exceeds the local edge-runtime invocation window (the P0.3 runtime limitation),
which also burned the re-run budget below its floor (NEEDS-CREDIT.md). So: the safety invariants
all hold (adversarial round), the data-starvation cause is fixed, but no real order has yet been
carried to a delivery-gate verdict. Clear the OPERATOR list, land the P0.3 design-stage fix, and
re-run the four applicants to the gate (needs credit) before charging anyone.** All eight phases are done, the full test suite is green, and all nine
unbreakable invariants are held or closed with every adversarial break re-attacked to a written
concession. Two things temper this into *controlled* rather than *open* launch, and both are
already on the lists below: the quality gate is hold-biased with known low agreement (it errs
toward holding, the safe direction), and three properties of Supabase's deployed runtime
(invocation timeouts, cold starts, heartbeats under load) could not be reproduced on this machine
and must be watched on the first Competitive and Full orders. The one genuine ceiling found —
proposal prose quality is data-bound, not architecture-bound (phase 1/2) — is recorded in
`BLOCKED.md`; it caps how good a Draft reads, not whether the system is safe to run.

Launch is the operator pressing go after clearing the OPERATOR list below. Not the machine.

---

## DONE — each phase, one line, actual spend, running balance

| phase | outcome | spend (usage fields) |
| --- | --- | --- |
| 0 — stack | Up on Jarvis. 15 migrations replay, 8/8 fingerprints, zero exclusions (PG17; a PG18 NOT-NULL catalog artefact caught and ruled out). Guard verified, worker ticks. | $0 |
| 1 — ten verdicts | 10/10 landed, 0 MISSING, 0 SUBSTITUTE. Every decode byte-confirmed (26 fingerprints). Pipeline+opus vs single-prompt+opus ties **5–5**, families agree per rung. | $0.45 |
| 2 — the fork | Case B (single matches pipeline). Pre-committed hybrid test: hybrid **lost 0/4** — the strategy layer is load-bearing (both critics, unprompted). Pipeline+opus stays the core; the new deterministic gates are kept. BLOCKED.md carries both tables. | $0.43 |
| 3 — the gate | v2 delivery gate wired between package and deliver + independent deliver-side hash refusal. Judge validation on 56 blind judgements: glm 65.0% = the always-hold baseline (NO SIGNAL); gemini 77.8% vs 22.2% → **gemini primary, glm fallback, hold-biased, LOW-AGREEMENT flagged**. Sufficiency wired FLAT on shown tau (count +0.16, weight −0.45). | $0.29 |
| 4 — compliance | Donor-limit fixtures 8/8 (incl. "1.400 palabras", "two pages"→refuse). 21 proven parser silent-pass findings (7 fixed here, the rest specced/fixed in phase 6). Render-service verified with a **real render** (n12-B → 4 pages). | $0 |
| 5 — six crawls | Six real buyer-shaped sites, every outcome explicit: 1 truthful FETCH_FAILED (cross-domain redirect, target named), 5×OK with furniture-free referents. 9 silent-failure classes fixed with canned regressions. Seven ledgers kept as the phase-6 applicants. | $0 |
| 6 — engineering | THREE P0s fixed: (a) escalations kind-check regression that made every refund unrecordable; (b) the strategy stage was still on the pre-composer schema — every order died at strategy with a PostgREST 400 before any claim (found by the e2e, proven by the critic); (c) invariant-2 clearance now enforced both sides (DB-atomic single-use). Plus F1/F3/F5 fail-closed, hold-class notifications with DRAFT wordings, strand release, crawl-starvation hold, per-stage cost accounting, resumable generation (unproven on deployed runtime). | $0 |
| 6 — benchmark | One real Draft order (Sufra) driven full-chain on the live stack → a **correct grounding HOLD at validate** (identity-only intake + own-domain crawl cannot supply mandatory admin facts — launch P0 #1 data-starvation demonstrated live, gate working, not fabricating). Real render verified (200, 6 pages). Mini-benchmark: 4 real applicants on one grant → **4 distinct composed fingerprints, no collision**; live crawl reproduced phase-5 counts (178/152/90/117). | $5.56 measured (≈$7.96 true incl. debugging iterations; the $8 line overran on the meter — see RUNLOG) |
| 8 — intake expansion | Opened because no real order completed (KT-10001 held on data starvation). Spec from the grounding failure; intake redesigned so structured answers ground the proposal (proper-noun starvation 9→0), critic-passed and merged; four applicants' real intake researched + verified. Re-run to the gate STOPPED at the design-stage P0.3 runtime wall and the $3 model floor — **0 delivery-gate rows** (NEEDS-CREDIT.md). Three real bugs fixed en route. | ~$8.7 (crossed the $6 line and $3 floor — see NEEDS-CREDIT) |
| 6.5 — adversarial | 9 invariants, one focused adversary each, every break re-attacked until the attacker **conceded in writing**. **4 held** (1 delivery-gate, 2 sufficiency — conceded with live proof; 7 no-human, 9 observability — orchestrator-audited). **5 broken then closed** (3, 4, 5, 6, 8). The two hardest (3 identity-matching, 4 numeric-denominators) took six re-attack rounds each — the attacker found a genuinely distinct reachable class each round, all now closed and re-attack-proven, with the final residuals documented as deterministic-irreducibility boundaries. Root cause below. | $0 |

Every phase committed; `git log` is the audit trail. `BLOCKED.md` records the one genuine
ceiling (phase 2). Balance never approached the $3 floor.

### The single most important finding — read this before touching the code

Every one of the five broken invariants failed for the **same reason**: round 1 built a sound
isolated mechanism and never wired its verdict into the decision or generation path. The loop's
`materialChange()` computed an insertion-robust verdict that `loopAction` threw away; the numeric
register `resolveRegister()` was fully implemented and called by nothing; the exclusivity composer
hashed 11 style axes into the fingerprint while only 2 reached the writer; the word counter's
Unicode-aware siblings were fixed while the counter itself was left Latin-only; `notifyTerminal`
set its idempotency marker before attempting the notification. **A passing unit test on a mechanism
is not proof the mechanism is in the path.** When reviewing any future change, trace the verdict
from where it is computed to where a decision consumes it — that seam is where this system fails.

### Two documented residuals (not launch blockers)

`reports/adversarial/residual-boundary.md` records the two classes that are not fully closable by a
deterministic gate: (3) two organisations sharing a topical stem where one name subsets the other
and the word is also a real charity's distinctive name (needs a distinctiveness/frequency model);
(4) a "share of X" whose true whole is not declared in structure and is named with a token-disjoint
synonym (needs a semantic lexicon). Both are in the asymmetric-safe direction (discard, never
fabricate), both are backstopped by the **LLM Claim Ledger** — the real fact-grounding gate, which
held the phase-6 Sufra order at `validate` — and neither is reachable from inputs honest use
produces. The durable closures (a name-distinctiveness model; requiring every budget total to be a
declared sum) are noted for a future iteration.

---

## OPERATOR — one sitting, under thirty minutes, each item one-click-ready

These are the items only a human with account credentials can do. None is blocked by the
codebase; each is prepared to a single action.

1. **Deploy render-service** and set its two Vault secrets. It is verified working locally
   (Docker image builds, real render returns correct page counts). Until deployed, any donor
   **page** limit blocks delivery by design (page count is never estimated).
   - Deploy the `render-service/` container to your host of choice.
   - `select vault.create_secret('<https URL of the deployed service>', 'render_service_url');`
   - `select vault.create_secret('<a strong shared secret>', 'render_service_secret');`
   (set the same secret in the service's environment).

2. **Set the fallback judge credential.** The delivery gate reads two Vault slots:
   `openrouter_api_key` (primary judge, google/gemini-3.7-flash) and
   `openrouter_api_key_fallback` (fallback, z-ai/glm-5.3-flash). Today both resolve to the one
   key. For real provider-outage isolation, set a **separate** key:
   - `select vault.create_secret('<second OpenRouter key>', 'openrouter_api_key_fallback');`
   (optional but recommended — it is the whole point of the two-provider ladder).

3. **Set the production OpenRouter key limit deliberately.** The gauntlet's own history is two
   runs killed by an undersized total-spend cap. Pick a monthly cap that clears the per-order
   cost (Draft ≈ $1.2–1.5 generation + a few cents gate) times expected volume, with headroom.

4. **Stripe payment links for Competitive and Full** (Draft's $1 trial link exists). Create both,
   put their URLs where order.html expects them.

5. **Deactivate the $1 trial payment link** before real launch.

6. **Verify the Resend sending domain** so `sendEmail` actually sends (today it returns false
   without a key; every terminal failure, QUALITY_HOLD and INFRA_HOLD already records its intent
   and the operator escalation regardless, so nothing is lost silently until then).

7. **Review the two DRAFT customer wordings** (reports/phase6-eng.md, terminal-failure and
   QUALITY_HOLD). They are shipping defaults: short, plain, no em dashes; INFRA_HOLD text never
   tells the customer their proposal failed. Edit to your voice and remove the DRAFT marker.

**Deploy discipline (unchanged, load-bearing):** every function is verified byte-for-byte against
local source before it is trusted; deploy v25 was silently corrupted and only the byte compare
caught it. The seven non-worker functions were transcribed from API output and were edited this
round — re-pull each with `supabase functions download <slug>` and diff before deploying. Two of
them (save-intake, stripe-webhook) now import from `../worker/` for the first time; the CLI bundles
this, but diff the bundle. See DEPLOY.md.

---

## FIRST ORDERS — what to watch, and the three things this machine could not prove

**Per order, watch (all in the append-only events table):**
- the **evidence ledger**: how many real referents the crawl yielded past the identity gate
  (phase 5 saw 53–178 on real sites; below the sufficiency floor the order should HOLD, not
  ship generic);
- the **gate decision**: pass or hold, the hold code (QUALITY vs INFRA — they are disjoint), and
  the judge's scores. The gate is **hold-biased with known LOW-AGREEMENT** (gemini 77.8%): it will
  hold more than a perfect judge would, which is the safe direction, but watch for it holding
  fundable work — that is the signal to revisit the judge, per phase 3.
- **stage durations and per-stage cost** (now from usage fields, not a shared global);
- any **refund** (QUALITY_HOLD path) and any **operator escalation** (INFRA_HOLD path).

**The three things this machine could not prove — they are properties of the deployed runtime:**
1. **Edge-function invocation timeouts** on Competitive/Full. A single invocation could not
   finish a large narrative in prior history (one stage heartbeated 807s then was lost). The
   resumable section-by-section generation is correct by construction but **unproven on the
   deployed runtime** — watch the first Competitive and Full orders closely.
2. **Cold starts** — not reproducible locally.
3. **Heartbeats under real platform load** — the reaper logic is tested; its interaction with
   Supabase's actual invocation lifecycle is not.

Launch is the operator's call after the OPERATOR list is clear.
