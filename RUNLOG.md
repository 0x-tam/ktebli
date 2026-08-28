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
- 7 adversarial attackers launched (worktrees, disjoint report+test ownership):
  inv1 delivery-gate, inv2 sufficiency, inv3 grounding, inv4 numeric, inv5 compliance,
  inv6 exclusivity, inv8+loop. Each files BROKEN (failing test + fix spec) or CONCEDED
  in writing. Invariants 7 (no human in loop) and 9 (observability) verified directly by
  the orchestrator (below) rather than a separate agent.

## 2026-08-28 — phase-boundary balance reconciliation (honest)

- GET /credits: total_usage 34.844 → balance $10.16 (floor $3.00). Session delta since
  start (19.956): $14.89. This EXCEEDS the running per-call tally (~$9). The gap is
  understood and honest:
  * WS6-bench's e2e drove KT-10001 through the full pipeline MULTIPLE times while fixing
    4 defects (strategy 400, two usage-snapshot gaps, footer false-positive); each run to
    validate is ~$1.5-2. Those debugging iterations are real meter spend not captured in
    the final $5.56 benchmark figure.
  * Two of the four defects WERE the un-snapshotted analyze/validate calls — so the very
    calls that escaped per-call attribution are why captured < meter. Fixed going forward.
  * Net: the e2e+benchmark LINE ($8, +50% degrade threshold = $12) was overrun on the
    true meter (~$13 for that portion). WS6-bench degraded scope (dropped watsi+felix)
    believing it was at $5.56 — correct action, wrong instrument reading. The pure
    measurement stands at $5.56; the development cost is the overrun.
- Posture for the remainder: adversarial round is deterministic ($0 for 5 of 7 attackers,
  $0.30 cap on 2); handoff is $0. No further full-pipeline runs. Headroom above floor
  ($7.16) is ample for that. No NEEDS-CREDIT.md required.

## 2026-08-28 — adversarial round complete: 4 held, 5 broken

Tally (each attacker filed BROKEN=failing test+fix spec, or CONCEDED, in writing; findings in
reports/adversarial/findings/, full attacker reports on their worktree branches):
- inv1 delivery gate: HELD (10 families held) + 1 cheap hardening (normaliseDocument \n{2,}→\n)
- inv2 sufficiency: HELD (conceded, FOR-UPDATE race + RLS wall proven live)
- inv3 grounding: BROKEN — contact_claims closed-label list; proper_nouns superset exemption;
  orgNameMatchesSite admits a stranger on one shared word
- inv4 numeric: BROKEN — resolveRegister wired to NOTHING; consistencyFindings one-directional;
  + 2 register internals (denominator-by-label, %-provenance)
- inv5 compliance: BROKEN — word counter not Unicode-aware (Cyrillic→0); zero-width collapse;
  wrapped-limit backstop gap
- inv6 exclusivity: BROKEN — 9 of 11 composed axes never reach the writer; visible style pool
  = 182 regardless of fingerprint count; uniqueness NOMINAL not real
- inv7 no-human-in-loop: HELD (orchestrator audit; no review/flag state)
- inv8+loop: BROKEN — loop material-floor ignores retention/material (padding regen passes);
  notifyTerminal sets notified_at before the attempt (silent-swallow)
- inv9 observability: HELD (orchestrator audit; immutability + live per-stage cost/events)

THE META-FINDING: every break shares one signature — round 1 built a sound isolated mechanism
(materialChange.retention, resolveRegister, the 11 composer axes, Unicode-aware sibling
tokenizers) and NEVER WIRED THE VERDICT/OUTPUT into the decision or generation path. This is the
single most important pattern for the operator.

Next: ONE consolidation fix owner (worktree) closes all 5 broken invariants + inv1 hardening,
pulls the 5 failing adv2 tests + 2 concession tests onto its branch, makes the whole suite green,
then a critic + attacker re-attack. Deep fixes (register-wiring, axes-wiring) get their MECHANISM
wired + deterministically tested; generation-quality impact marked unproven-without-e2e (budget).

## 2026-08-28 — consolidation fix owner dispatched

- One fix owner (worktree) closes all 5 broken invariants + inv1 hardening, pulls the 5
  failing adv2 tests + 2 concession tests onto its branch, greens the whole suite. Ordered
  cleanest-first: (1) Unicode word counter, (2) zero-width/table counting, (3) notifyTerminal
  notified_at-last, (4) normaliseDocument \n{2,}→\n, (5) loop material/retention wired, (6)
  contact-by-shape, (7) proper_nouns exact-span exemption, (8) orgNameMatchesSite distinctive
  overlap, (9) register denominator-by-identity, (10) register %-provenance, (11 DEEP) register
  wired + consistencyFindings bidirectional, (12 DEEP) all axes → generation prompt.
- Clarified for the agent: inv6 fix is route-all-axes-to-writer, NOT shrink-the-hash (shrinking
  would reintroduce a ceiling). The two DEEP fixes get mechanism wired + deterministically
  tested; generation-QUALITY halves marked unproven-without-e2e (budget: no full pipeline runs).
- On its critic+re-attack PASS: merge, then phase 7 handoff finalization.

## 2026-08-28 — consolidation fix owner dropped (connection), resumed

- Fix owner died on a connection error (not session limit) after committing inv5 (Unicode
  counter + wrapped backstop, 73fdf6d) and the adv2 test pulls; inv8.1 (loop material floor)
  was complete but uncommitted (correct diff: material wired into LoopAttempt, refuse only on
  explicit material===false, fraction floor kept). Resumed in-place: commit inv8.1 + run
  delivery-gate regression, then remaining fixes (inv8.2, inv1, inv3.x, inv4.x, inv6).
  Instructed to commit each fix as it goes so a re-drop loses at most one fix.

## 2026-08-28 — consolidation fix complete, critic+re-attack running

- Fix owner resumed and COMPLETED all fixes: full suite green, all 7 adv2 tests green,
  15 files, deno check clean, no forbidden path touched. inv4.3 + inv6 mechanism halves
  unit-tested; generation-quality halves explicitly marked unproven-without-e2e. Two
  obsoleted test assertions (donor_limits, delivery_gate) argued as corrections. Branch
  worktree-agent-ad9b7ede72a74647b, commits 73fdf6d…ac2d4cf.
- Critic+re-attacker spawned: re-executes all 7 adv2 + round-1 tests + full suite, and
  ADVERSARIALLY re-attacks each fix (esp. inv3.3 dangerous-direction: must reject
  strangers without rejecting legit sites; verifies inv4.3/inv6 mechanism is really wired,
  not just imported; no-weakening check). On PASS: merge, then batch-resume the 5
  attackers for written concessions, then finalize handoff.

## 2026-08-28 — fix critic+re-attack: SEND BACK on 2 fresh holes

- Critic re-executed all 7 adv2 + 10 round-1 + full suite (green) AND re-attacked each fix.
  REPELLED: inv5, inv6, inv8, inv4.2, inv4.3, inv3.2. Confirmed both DEEP mechanisms genuinely
  wired (resolveRegister called at index.ts:2263 + register_derivations in prompt; 11 axes in
  composedStyleNote reaching both generation paths, hash not narrowed). Two obsoleted test
  assertions confirmed strengthened-not-weakened.
- TWO FRESH HOLES (not closed until they survive re-attack):
  * inv3.3 (dangerous): single-distinctive-token org names (Shelter/Mind/Scope…) still admit
    strangers — for want.size===1, `want.every(t=>host.includes(t))` is a bare substring test;
    Shelter→shelterlogic.com admits. Identical-single-token-set branch admits Bright→"Bright Ltd".
  * inv4.1: denominator-identity guard anchors only the LEFT edge; "share of cost overrun"/cost
    node resolves 0.75 (the wrong-denominator defect).
  Sent back with exact fixes + regression assertions. Non-blocking residuals noted (inv3.1
  exotic phone formats behind the LLM ledger; inv5 no-space non-CJK scripts).
- Fix owner closed both re-attack holes: inv3.3 (single-token org → whole DNS-label match;
  legal-name needs 2 distinctive tokens; +6 grounding assertions, 24/24), inv4.1 (denominator
  whole-run bounded both sides; +A9c). fix-report wording corrected, residuals noted. Commits
  39c73ed/6b71a82/524185b. Critic sent back for bounded re-verification of exactly those two
  spots (re-run its own stranger reproductions + right-extension attack). On PASS: merge.
- Re-verify: inv4.1 CONFIRMED CLOSED (right-extension refused, controls intact). inv3.3 still
  open on subdomain/hyphen variants (shelter.evil.com, shelter-supplies.com admit — whole-
  COMPONENT match splits on both - and .). Sent back with a precise registrable-main-label
  algorithm (embedded public-suffix set, exact-equality, discard-on-doubt) + adv2 assertions
  for the 4 variants. Third pass on the identity gate — invariant 3's worst-outcome direction,
  worth converging precisely.
- inv3.3 third pass CLOSED (e24cdbc): registrableMainLabel() with embedded public-suffix set,
  exact main-label match, discard-on-doubt fallback; adv2_grounding 28 checks. All four
  subdomain/hyphen variants reject, legit sites admit, full suite green. Critic sent for final
  bounded re-attack (its 4 variants + 3 fresh, esp. unrecognised-eTLD fallback). On PASS: merge
  the whole consolidation fix.

## 2026-08-28 — consolidation fix MERGED (41b25d7); adversarial round CLOSED

- Critic's final re-attack on inv3.3 repelled every variant (4 pass-2 defeaters + deeper
  subdomain + two-label-suffix + unrecognised-eTLD fallback + IP + 5 substring strangers all
  REJECT; legit sites admit). Whole consolidation fix PASS. Merged. Full suite ALL SUITES PASSED
  on trunk.
- All 5 broken invariants closed and each survived a FRESH re-attack (not just a passing test),
  which is the phase-6.5 bar. Documented safe-direction residuals: inv3.1 exotic phone/domain
  formats (behind the LLM Claim Ledger), inv5 no-space non-CJK scripts (monotonic undercount),
  single-common-word same-name identity limitation (inherent, discard-on-doubt). Two DEEP fixes
  (inv4.3 register-wiring, inv6 axes-wiring) have mechanism wired+unit-tested; generation-quality
  halves marked unproven-without-e2e.
- Final step: batch-resume the 5 broken-invariant attackers to re-attack trunk and concede in
  writing (the doctrine: "re-attacked until the attacker concedes in writing"), then finalize
  the handoff.

## 2026-08-28 — adversarial re-attack round (attackers re-attacking merged trunk)

- Re-attacked the merged consolidation fix with the 5 original attackers:
  * inv5 CONCEDED (every vector held; noted non-reachable Default_Ignorable hardening).
  * inv6 CONCEDED (all 11 axes reach the writer, 1000/1000 distinct; noted a latent
    "9th-axis" hardening — hardcoded 8-name categorical list vs extensible schema —
    not a live break under today's schema).
  * inv8 CONCEDED (material===false refuses padding regen; >2 impossible; notify last).
  * inv3 found a FRESH hole: the single-token fix left the MULTI-token domain branch on
    any-substring (Art Care->smartcare.com). FIXED by me (anchor first token to
    registrable main label + in-order), +7 assertions; Grace Kitchen->grace.com rejects,
    real Sufra->sufra-nwlondon.org.uk admits. Verified via adv2_grounding + probes.
  * inv4 found TWO fresh holes: donor-branch Math.round(ratio) collision (fabricated
    donor % verified by a stray 1) and a scope-reframe denominator ("cost of the whole
    project"). Both FIXED by me; A12/A13 green, round-1 register green.
- Full suite ALL SUITES PASSED. Committed eae6b18. Final inv3+inv4 attacker concession on
  the fixed code requested (the doctrine: re-attacked until the attacker concedes in
  writing). inv1/inv2 conceded on the first pass. inv7/9 orchestrator-audited.

## 2026-08-28 — adversarial re-attack #2: convergent structural fixes

- inv3 and inv4 attackers each found ONE more variant on the re-attack, both proving the
  same meta-lesson: heuristic patches (substring, anchor+in-order, one-directional word
  list) keep reopening; only the STRUCTURAL rule closes the class.
  * inv3 (5th pass): "Care Reach"->careeroutreach.com defeated anchor+in-order (care<career,
    reach<outreach). Took the attacker's own conclusion — EXACT main-label concatenation
    only for the domain-ONLY branch. Sufra admits on its crawled legal name (how phase 5
    cleared it); domain-only rejection of Sufra is the accepted discard-on-doubt cost.
  * inv4 (3rd pass): "frontline share of the total of cost" (scope word LEFT of the
    denominator) evaded the one-directional walk. Made the scope walk direction-symmetric
    + expanded synonyms, AND added the word-list-free STRUCTURAL closure the attacker
    specced: a share whose numerator is transitively a member of a same-unit sum node
    must divide by that aggregate, not a sibling leaf (rate_denominator_not_whole).
- Full suite ALL SUITES PASSED. Committed 6fbabdb. Final concession requested on 6fbabdb.
- inv3 re-attack #3: attacker found a distinct class — "Green House"->greenhouse.io
  ("Greenhouse Software Inc", HR SaaS, 0 shared) admitted on domain spelling while
  IGNORING a contradicting crawled legal name. Fixed (2c273dc): bare-domain exact-concat
  admit now requires site.size===0 (no stated identity to contradict); a named site admits
  only via shared>=2. +4 assertions, full suite green. Final concession requested.
- inv4 final concession still pending from the structural-fix round (6fbabdb).

## 2026-08-28 — adversarial re-attack #3/#4: name-branch + partial-aggregate

- inv3 re-attack #4: attacker found the NAME branch (shared>=2, never attacked before)
  conflated two DIFFERENT names sharing only topic words ("Youth Climate Hub Bristol" vs
  "Climate Youth Action Fund" → {youth,climate}). Fixed (20e2049) with the attacker's own
  spec: containment not intersection (smaller distinctive-token set ⊆ larger). Attacker
  states this reduces the residual to the irreducible exact-same-name case. Domain branch
  (exact-concat + site.size===0) already closed. Full suite green. Final concession requested.
- inv4 re-attack #3: attacker found the node-id structural rule missed a PARTIAL
  sub-aggregate (F1=sum[L1,L2] part of flat T1=sum[L1,L2,L3] by value). The attacker's
  leaf-set fix would over-refuse the donor's "overhead over direct costs" rule; instead
  used label-superset ambiguity (13537a8) — refuse when another same-unit node's label is
  a strict superset with a different value. Catches both structurings, no over-refusal.
  A15 green. Final concession requested.
- Identity gate: 7 passes, each a distinct real class (substring, prefix, domain-overrides-
  stated-identity, topical-overlap). Numeric register: 5 passes. Both now on principled
  structural rules (exact-concat + containment; label-superset + symmetric-scope).

## 2026-08-28 — adversarial round converging to the deterministic boundary

- inv4 RE-5 (stop-word 'the cost' defeated the label-token comparison): fixed with the
  attacker's own durable word-list-FREE LEAF-SET rule (numerator a proper part of sum S,
  denominator outside S → refuse). Closes all label-spelling variants; overhead/direct
  stays legit. Label-superset kept as leaf-declared-total backstop. Committed 13537a8→5a04a60.
- inv3 8th class (topical CONTAINMENT — "Mental Health Leeds" vs "Mental Health Foundation"):
  extended ORG_GENERIC_WORDS with a NARROW purely-topical set (Mental Health / Youth Music /
  Family Action reject; Shelter/Green House/Grace Kitchen preserved). The broad list first
  tried broke legit fixtures (shelter/green/kitchen double as distinctive names) — which IS
  the irreducibility: a word topical for one org is distinctive for another.
- Wrote reports/adversarial/residual-boundary.md: both remaining residuals precisely stated
  as deterministic-irreducibility boundaries, each with backstops (asymmetric discard, LLM
  Claim Ledger, budget-total-as-sum). Both attackers acknowledged the boundary in writing.
- Final concession requested: concede the boundary, or report a genuinely NEW reachable
  class outside it. Balance $10.15 (adversarial round ~$0, all deterministic).
- inv3 CONCEDED (6 rounds): attacker's structural proof — 3 admit paths, all requiring
  >=2 shared distinctive tokens+containment or domain spelling the applicant's own name;
  stranger with neither is structurally unadmittable. 5 reachable classes closed. Dead
  `shared` counter removed. Committed 70e48cd. Awaiting inv4 final concession.
