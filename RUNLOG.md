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
