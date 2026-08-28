# RUNLOG — the full gauntlet

State lives here, on disk. A dead session resumes from this file, `git log`, and `reports/`.
Prompt: /home/jarvis/Downloads/KTEBLI-AUTORUN.md (the gauntlet). Branch: claude/supabase-audit-verify-77v56v (= origin/main + work, fast-forwardable).

## 2026-08-28 — session start

- Host verified: this IS Jarvis (`hostname` = Jarvis). Egress works: openrouter.ai 200, ukyouth.org 200.
- Production guard VERIFIED: `uocauqflcqefgdixbzpf.supabase.co` + `db.` blackholed to 127.0.0.1 in /etc/hosts; curl to production → 000.
- `kteblistate.md` does not exist anywhere on this machine (searched /home/jarvis). Its content is
  subsumed by the gauntlet STATUS block + reports/phase0-stack.md + reports/phase1-verdicts.md. Proceeding per autonomy rule 1.
- **stack/.env key was corrupted by a paste error**: the OPENROUTER_API_KEY line held THREE
  concatenated `sk-or-v1-` strings (73 + 58 + 73 chars). Fragments 1 and 3 were byte-identical and
  valid; fragment 2 was a truncated middle. Rewrote .env with the single 73-char key (never printed).
  GET /credits: total_credits 45.00, total_usage 19.956 → **balance $25.04**. Floor $3.00.
- Stale `phase0-output.txt` (operator's 09:48 up.sh run, failed on then-missing .env) removed.
- Tooling: docker OK, node OK, python3.14 OK. ABSENT: supabase CLI, psql, deno, local postgres. sudo is passwordless — installing.
- Verdict inventory confirmed on disk: 4 landed (n06/critic_b, n12/critic_b, n06thin/critic_a+b),
  6 outstanding (n03 both, n06/critic_a, n09 both, n12/critic_a). n03/critic_b packet must be built.
  NOTE: tests/ladder/verdicts/ holds only 3 of the 4 landed — n06thin/critic_a lives only in
  reports/design/ladder-critics/. Runner skips cells with files in tests/ladder/verdicts/, so that
  verdict must be copied in before the run or the cell re-bills.

Next: install postgres + supabase CLI → phase 0.

## 2026-08-28 — phase 0 CLOSED, phase 1 running

- Phase 0: all green. 15 migrations (gauntlet's "11" was stale), 8/8 fingerprints, zero exclusions,
  on PG17 after proving the lone `constraints` mismatch was PG18's NOT-NULL catalog rows (174
  contype='n' rows; excluding them reproduces the expected hash bit-for-bit). Worker tick
  `{"ok":true,"processed":0,"ms":12}`. Report: reports/phase0-stack.md. Committed 0837a3d.
- Phase 1 pre-flight: bytematch structural pass was globbing dotted scratch-names → checked ZERO
  packets silently. Fixed (fails loudly on empty glob). n03/critic_b packet had a 5th delimiter
  style → rebuilt with verified builder at BADC. n09/critic_b packet lost with scratch dir →
  rebuilt at DACB. Landed n06thin/critic_a staged into tests/ladder/verdicts/. Committed.
- Phase 1 runner launched (pid 1893093, detached, log buffered — poll verdict files not the log).
- Landed so far this run: n03/critic_a ($0.1079, gen-1787902200…) rank B>D>C>A fund B;
  n03/critic_b ($0.0377, gen-1787902295…) rank B>D>C>A fund B, fundable B+D.
  Fingerprints added and green: 55/B, 12,500/C (critic_a); 72/C (critic_b).
- Spend so far this run ≈ $0.146 of the $15 ladder line.

## 2026-08-28 — phase 1 CLOSED (10/10), phase 2 fork called, hybrid judging in flight

- Phase 1: all 6 outstanding cells landed first-attempt via direct streaming. Zero MISSING,
  zero SUBSTITUTE. Spend $0.4511 (usage fields). Every decode confirmed by critic-quoted
  figures unique to one arm (bytematch: 20 fingerprints green). reports/phase1-verdicts.md.
- Result: B (pipeline+opus) vs D (single+opus) ties 5–5; families agree per non-thin rung
  (n03→B, n06→D, n09→D, n12→B). Flash arms never win. Fork = CASE B.
- Phase 2: reports/phase2-decision.md pre-commits the hybrid test (win condition fixed
  before any call). Hybrid = single-prompt core at D's exact params + deterministic gates
  (word count / numeric closure / grounding) with named repairs, max 2.
- Hybrid gates calibrated on existing arms: every finding they raise on B/D is one a critic
  or meta independently recorded. Three silent-pass bugs found and fixed in MY OWN new
  code along the way (char-set rstrip mangling names; £-only budget parse skipping a
  bare-number budget; quantity regex missing adjective gaps). Verify the measurement first.
- out-n12-H.md (1155 words, 0 findings, $0.119, gen-1787903110), out-n06thin-H.md
  (1115 words, 0 findings, $0.089, gen-1787903160). Both clean on the FIRST generation.
- 4 packets built (H position rotates: AHDB/DBHA/HDAB/BADH), structurally derived.
  run-phase2.py launched (pid 1921153). Ladder-line spend so far ≈ $0.87 of $15.

## 2026-08-28 — phase 2 CLOSED (hybrid loses 0/4); fan-out begins

- Phase 2 hybrid test: H below both B and D in all 4 cells, below A once, funded 0/4.
  Both critics independently: failure is STRATEGY (over-broad, "pile of existing work"),
  not prose (critic_a verified H's budget closes — a first) and not referents. The
  strategy layer is load-bearing. Pipeline+opus stays the core; the phase-2 deterministic
  gates are kept as wrapper. BLOCKED.md written per fork rule with both tables.
- Spend: phase 2 $0.43. Total this session ≈ $0.90. Balance $24.12.
- Serial zone ends. Wave 1 fan-out (worktrees, disjoint ownership, critics before merge):
  * ws3-gate: wire delivery-gate v2 into worker index.ts; validate judge vs the 14 verdict
    files (agreement number); fallback + loop-stop proofs; sufficiency count-vs-weight.
    OWNS: worker/index.ts, delivery_gate.ts, sufficiency.ts, tests/delivery-gate/,
    tests/sufficiency/, reports/phase3-gate.md. Budget ≤$3 (gate line).
  * ws4-compliance: donor-limit fixture forms; parser re-audit (index.ts READ-ONLY this
    wave); render-service local. OWNS: tests/donor-limits/, tests/word-limit/,
    render-service/, supabase/functions/* EXCEPT worker/index.ts, crawl_outcome.ts,
    ssrf.ts; reports/phase4-compliance.md. $0 model budget.
  * ws5-crawl: six real buyer-shaped sites through stack/live-run.sh; fix silent crawler
    failures; keep ledgers for phase 6. OWNS: crawl_outcome.ts, ssrf.ts, stack/out/,
    stack/sites*, reports/phase5-crawl.md. $0 model budget.
- Wave 2 (after ws3 merge): phase 6 index.ts workstreams + e2e order + mini-benchmark.
  Wave 3: adversarial round. Then handoff.

## 2026-08-28 — orchestrator checks while wave 1 runs

- stack/tick.sh written (up.sh referenced it; never existed). Verified: {"ok":true,...}.
- Invariant 9 substrate proven on the live local stack: events_immutable trigger blocks
  UPDATE and DELETE (both raise), probe row survives.
- tests/exclusivity/run.sh is GREEN: 40 concurrent applicants on one grant, 40 served,
  0 refused, 16 sessions racing one fingerprint arbitrated by the partial unique index,
  no pool FK in claims. Invariant 6's unbounded composer holds in the replayed schema.

## 2026-08-28 — wave 1 coordination

- WS5 correctly refused to patch index.ts: live-run.sh's guard found the crawl_outcome
  wiring missing from index.ts (patch spec lost with scratch dir). Resolution: wiring
  assigned to WS3 (owns index.ts) as bounded task 1b; WS5 proceeds offline (silent-failure
  audit of crawl_outcome/ssrf + canned-response regression tests) and re-runs live after
  WS3 merges. Git push to origin was denied by the session's permission layer — commits
  stay local; operator pushes.

## 2026-08-28 — wave 1 landing sequence

- WS4a COMPLETE: fixtures 8/8 ("two pages" → loud refusal, argued); 21 proven parser
  findings (7 fixed in its paths, 14 specced for index.ts/migrations owners); NEW P0:
  migration 20260826180000 re-creates escalations_kind_check WITHOUT the gate_* kinds
  that 20260826170000's gate_refund_order() inserts → a confirmed refund can never be
  recorded (proven by executing the function on a replayed head). Render service verified
  with a real render (port 8790, n12-B → 4 pages). Critic spawned (verifying the P0 by
  execution among other checks) before merge.
- WS5 offline half COMPLETE: 8 silent-failure fixes + canned regressions (contract
  1.1.0), six sites committed; live run parked until WS3's index.ts crawl wiring merges.
- WS3 in flight: commit 9859e9f wires the v2 gate between package and deliver AND
  delegates the crawl to crawl_outcome.ts; validate_judge_ladder.ts created; model-call
  validation presumably running.
- P0 escalations-kind fix (new migration + re-recorded expected fingerprint, argued in
  the commit, never fudged) → assigned to wave-2 ws6-core alongside WS4a's 14 specs.
- WS4a critic: SEND BACK on one named failure — the archived SQL proof file typo
  ('clear' vs 'cleared') aborts at P4 under ON_ERROR_STOP, so the report's 10-PROOF-OK
  tally is unreproducible as archived (7 reproduce). Everything else PASSED in writing,
  including independent re-execution of the P0 refund regression, scope, secrets,
  fixture-weakening rule, and a byte-matched render reproduction. WS4a resumed with
  exactly that fix; no other changes permitted.
- WS4a MERGED (5fa9663) after critic PASS in writing: sole send-back fixed (artifact now
  reproduces 9/0/0), critic re-ran everything. P0 refund-regression fix + the 14 open
  specs go to wave-2 ws6-core.

## 2026-08-28 — WS3 complete, critic running

- WS3 done ($0.275 of $3): gate wired package-side + independent deliver-side hash
  refusal; QUALITY/INFRA disjoint; crawl delegated to crawl_outcome (unblocks WS5).
  Judge validation on 56 blind judgements: glm 65.0% = always-hold baseline exactly
  (NO SIGNAL); gemini 77.8% vs 22.2% baseline, <80% → wired gemini primary + glm
  fallback, HOLD-BIASED, LOW-AGREEMENT flagged. JUDGE_MAX_TOKENS 3000 was unusable
  (reasoning ate it; empty content) → 12000 with measurement. Sufficiency: tau count
  +0.161 / weight −0.452 → FLAT wired. NEW invariant-2 blocker (read-only finding):
  save-intake and stripe-webhook do not enforce sufficiency clearance → wave-2 core.
- WS3 critic spawned (recompute rates from persisted artifacts; ≤4 spot calls, $0.20).
- WS3 critic: SEND BACK on four record corrections only (code merge-ready, all numbers
  reproduced from artifacts + 2 exact-match spot re-calls): (1) exclusivity-probe claim
  false — it is GREEN in the WS3 worktree, the baseline log died on a /tmp permission
  error; (2) glm per-document judgements flip between identical seeded runs (4 docs) —
  rates stable, instrument not reproducible per-document, must be disclosed; (3) 17→18
  arithmetic; (4) JUDGE_MAX_TOKENS reframe (the claimed deterministic failure did not
  reproduce; change stands as reliability headroom). WS3 resumed with exactly those.

## 2026-08-28 — WS3 merged; wave 2 launched

- WS3 corrections confirmed by critic (PASS, quoted passages) and MERGED (c893af1).
  Post-merge: 555 gate checks, sufficiency suite, worker typecheck all green.
- WS5 worktree refreshed with trunk (crawl wiring present) and given the GO for the
  six-site live run.
- WS6-core launched (worktree): P0 escalations migration + re-recorded fingerprint
  (argued, in-commit), invariant-2 clearance enforcement in save-intake/stripe-webhook,
  WS4a's open index.ts specs (F1/F3/F5, numLike…), failure emails with DRAFT wordings,
  strategy-retry strand proof, crawler→sufficiency wiring, per-stage cost accounting,
  resumable generation (marked unproven-on-deployed-runtime). $0 model budget.
- Balance at wave-2 start: $23.99. Session spend so far ≈ $1.19 (ladder 0.87 + gate 0.28
  + critic spot-checks 0.02, usage-field attribution) + phase-1 $0.45 already counted in
  the 0.87? — correction: ladder line total = phase1 $0.45 + phase2 $0.43 = $0.88; gate
  line = $0.275 + $0.015 critic = $0.29. All inside lines.
- WS5 COMPLETE: 6 outcomes explicit (Felix FETCH_FAILED cross-domain-redirect named;
  5×OK with 53–178 referents), identity gate cleared on all OK sites, felix.org probe
  OK(271). Live run found the 9th silent failure — ~2/3 of referents were nav/menu
  furniture glued into capitalised runs; fixed in four layers, counts fell to real
  names. No wild BLOCKED/JS_ONLY (Felix redirects now, Watsi server-renders) —
  fixture-proven, disclosed. 7 ledgers committed for phase 6. Critic spawned (re-crawl
  one site, referent-quality audit, taxonomy honesty on FETCH_FAILED, coverage-gap call).
- WS5 critic: PASS in writing (regressions reproduced against pre-fix modules, Magpie
  re-crawl 53/53 exact, BLOCKED path wild-confirmed by the critic itself on
  glassdoor.com→blocked_bot, identity gate untouched). Three residuals sent back
  bounded before merge: (A) sitemap/wp-json machine files crawled as prose pollute 3
  of 7 ledgers with junk referents — fix + re-crawl affected sites; (B) entity residue
  in siteNameCandidates; (C) 203→205 count. Merge follows the fix.
- WS5 MERGED (0fda2e6) after critic re-check PASS: machine-file exclusion in two layers,
  entity-decoded name candidates, 215 checks green, honest 53→90 Magpie rise explained
  mechanically. Phase 5 CLOSED. Seven clean ledgers at stack/out/phase5-ledgers/.
- Remaining: WS6-core (running) → critic → merge → WS6-bench (e2e + mini-benchmark, ≤$8)
  → adversarial round → phase 7 handoff.

## 2026-08-28 — WS6-core complete, critic running

- WS6-core: all 8 tasks landed in 9 commits, $0 model spend, ALL SUITES PASSED in its
  worktree. P0 escalation-kind union migration + re-recorded fingerprint (argued
  in-commit) + regression guard; invariant-2 wired both sides with single-use
  fingerprint-matched clearance; F1/F3/F5 + numLike + refusal-before-spend; hold-class
  notifications with DRAFT wordings; strand release proven; crawl-starvation → HELD;
  per-stage cost accounting contamination-free; resumable generation marked
  unproven-on-deployed-runtime. Deferred honestly: numeric_register wiring (needs model
  budget + design), upload-intake-file follow-up.
- WS6-core critic spawned: deepest brief of the run (fingerprint re-record audit,
  refusal-matrix replay, hold-class disjointness, marked-block spot checks).

## 2026-08-28 — WS6-core merged; bench wave launched

- WS6-core MERGED (8f13783) after critic PASS; both merge nits applied (assertion count
  corrected; notifications suite wired into run-all — green). functions serve restarted
  on the merged worker; stack reset through all 17 migrations, fingerprints 8/8, Vault
  re-seeded, tick green. Render container healthy on 8790.
- WS6-bench launched IN the main tree (sole code workstream; needs the live serve):
  e2e Sufra order through the full chain incl. real crawl, real gemini gate, real
  render; then the mini-benchmark over the remaining phase-5 ledgers, one shared grant
  (exercises the real composer), ≤$8 usage-field budget with loud scope degradation.

## 2026-08-28 — WS6-bench resumed after session-limit death

- WS6-bench died mid-e2e-setup on a session-wide usage limit (now reset). Preserved its
  work: committed the two real defects it surfaced driving KT-10001 (commit ba56d2b) —
  absenceIsSuspicious() cross-line footer false-positive (held orders on unconstrained
  donor text; found on real LBF guidance) + analyze-stage usage snapshot gap. Both with
  regressions, argued as corrections. Restarted serve cleanly on committed code; tick
  advancing KT-10001 (analyze+org done on real Sufra crawl). Resumed the agent to finish
  the e2e + mini-benchmark. Handoff skeleton (reports/launch-readiness.md) written with
  DONE/OPERATOR/FIRST-ORDERS; benchmark + adversarial numbers pending.

## 2026-08-28 — WS6-bench complete (committed to trunk), critic running

- WS6-bench done. Surfaced a THIRD P0 (bfa6b4a): strategy stage was still on the
  pre-composer schema (selected dropped columns, old claim_approach signature) → every
  order died at strategy with PostgREST 400 before any claim. Rewired to the unbounded
  composer (composition_axes, canonical-axes hash, reserve-by-fingerprint, re-roll on
  race). Two more usage-snapshot gaps fixed (analyze, validate). All with tests.
- e2e terminal outcome: a CORRECT grounding HOLD at validate — Sufra's identity-only
  intake + own-domain crawl cannot supply mandatory admin facts (safeguarding, accounts,
  income band, bank, insurance); the gate held rather than let fabrication through. This
  is launch-readiness P0 #1 (data starvation) DEMONSTRATED LIVE, gate working. Real
  render verified (200, 6 pages). Notification path verified live (sent:false, Resend
  absent).
- Benchmark: 4 applicants on one grant → 4 distinct fingerprints, no collision; worker
  live crawl reproduced phase-5 counts (178/152/90/117); watsi+felix dropped at the $8
  line. Spend true ≈$7.96 of $8. Full suite green.
- Recorded not-fixed: design/validate are monolithic multi-call stages exceeding the
  local single-invocation window (launch P0.3, now reaching Draft tier).
- Critic spawned (deepest skepticism on the composer rewire + the grounding-hold honesty;
  verifies benchmark numbers from the DB, not the report). $0.50 model cap.

## 2026-08-28 — WS6-bench PASS (proven live); adversarial round launching

- WS6-bench critic PASS, by execution: pre-fix strategy select proven to 400 on the
  dropped column claims.structural_template_id (the P0 substantiated, not overstated);
  composer rewire preserves invariant 6 (40/40, 50 distinct fingerprints, no pool);
  benchmark numbers reproduced from the DB (4 fingerprints, 0 collision; referents
  178/152/90/117; $5.558 captured); grounding hold genuine (passed strategy/design/
  gen:narrative, held at validate on explicit unsupported Claim-Ledger classifications).
  Already on trunk → left as-is. One honest nuance: validate lands DB status `failed`
  (semantic hold), report transparent; pre-existing behavior. Adversarial round should
  probe invariant-8 notification-on-that-path.
- Phase 6 CLOSED. Launching phase 6.5 adversarial round: 7 attackers (inv 1,2,3,4,5,6 +
  loop), worktrees, each owns only its own reports/adversarial/*.md + tests/adversarial/
  adv2_*_test.ts; breaks filed as failing test + fix spec (no shared-code edits); the
  orchestrator routes any fix through a single owner.
