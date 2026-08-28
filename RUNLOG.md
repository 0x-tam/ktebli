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
