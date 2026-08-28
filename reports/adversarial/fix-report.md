# Consolidation fix report — adversarial round 2 (phase 6.5)

Owner: consolidation fix owner. Budget: **$0** (no model calls; every fix is
verified deterministically). Base: `claude/supabase-audit-verify-77v56v` tip
(1b4630a). All seven adv2 attacker tests were imported onto this branch first and
run as the baseline before any worker code changed: the five BROKEN tests failed,
the two concession tests passed (inv2 after a harness-only env guard — see below).

**Final state:** `sudo env PGBIN=/usr/lib/postgresql/17/bin TMPDIR=/tmp bash
tests/run-all.sh` → **ALL SUITES PASSED**, with all 7 adv2 tests in the suite
green. `deno check` clean on every one of the 15 changed files.

The claims below are exactly what the imported tests reproduce. Two fixes have a
mechanism half (deterministically proven here) and a generation-quality half that
needs a paid end-to-end order and is marked **UNPROVEN-WITHOUT-E2E** — inv4.3 and
inv6. Nothing was specced-not-applied; no fix required a migration.

---

## inv5 — compliance (BROKEN → fixed). adv2_compliance_test.ts green.

**inv5.1 counter blind to non-Latin scripts.** `wordCount` (index.ts:568) and its
byte-identical twin `gateWordCount` (delivery_gate.ts:287) tokenised on
`/[A-Za-z0-9؀-ۿ]/` — Latin, ASCII, Arabic only. A document over the donor limit in
any other script counted ~0 and never tripped `over_word_limit` or the delivery-gate
preflight. **Fix:** the full letter/number class `/[\p{L}\p{N}]/u`, plus
zero-width glue (ZWSP/ZWNJ/ZWJ/word-joiner/soft-hyphen/BOM) normalised to word
boundaries, pipe table-cell walls split, and CJK counted per character. The rule is
MONOTONIC (counts ≥ the old rule for every input — the gate only ever gets stricter).
Both twins kept identical; the test now asserts that and imports the real
`gateWordCount` (it had inlined the broken copy).

**inv5.2** folded into the same counter (zero-width + table cells above).

**inv5.3 wrapped word limit → null gate** (`absenceIsSuspicious`, donor_limits.ts:311).
A stated limit whose number and unit wrapped across a single line break ("1,400\nwords")
returned `absent` → a null gate. **Fix:** the `max_words` numeric bridge now spans
exactly one newline (never a blank line). The blank-line / sentence-boundary "Page N"
footer false positive that forced the earlier documented trade stays closed;
`max_pages` is left horizontal-only on purpose (its FP was the live footer, and no
attacker broke it). The round-1 donor-limits assertion that pinned "missed by design"
was updated to assert the wrap is now caught and a blank-line wrap is still missed.

Regression: word-limit, delivery-gate (555) and donor-limits (71) all still pass.

## inv8 — loop limits + notify (BROKEN → fixed). adv2_loop_notify_test.ts A2/A3 green.

**inv8.1 material-change floor defeated by padding.** `materialChange` computes an
insertion-robust `{retention, material}` verdict for exactly the padding attack, but
`runGateLoop` kept only `changed_fraction` and `loopAction` tested only that scalar,
so a padded "regeneration" (retention 1.000, changed_fraction ~1.0) passed the floor.
**Fix:** `LoopAttempt` gains `material`; `runGateLoop` (delivery_gate.ts:1884) carries
the whole ChangeReport; `loopAction` (delivery_gate.ts:1670) refuses
(refund / `gate.no_material_change`) when `material === false`, before and in addition
to the `changed_fraction` floor (kept for the low-edit control A4). Only an EXPLICIT
`false` triggers it, so existing loopAction cases and distinct-doc regenerations are
unaffected. A3 (the unmodified end-to-end case) proves runGateLoop halts at the FIRST
padded regen. delivery-gate 555 unchanged.

**inv8.2 notifyTerminal silent-swallow** (index.ts:1398). The `notified_at`
idempotency marker was set BEFORE the order lookups; `sel()` throws on any non-2xx and
a fresh row may not be visible, so a throw/early-return left the stage marked
"notified" with nobody told, and the sweep (which retries only `notified_at IS NULL`)
never re-ran it. **Fix:** set `notified_at` LAST, after the escalation row and both
email channels are attempted; the notification steps are `.catch`-guarded so once the
order is in hand the marker is always reached (no partial-then-retry double-send). No
adv2 executable case (index.ts has `Deno.serve` at module scope); the
tests/notifications stub test runs the real worker subprocess and still passes.

## inv1 — delivery gate (CONCESSION kept) + hardening. adv2_delivery_gate_test.ts green.

The mechanism held (72 checks). The documented `normaliseDocument` hardening was
applied: it collapsed only runs of ≥3 newlines, leaving the 0↔1 blank-line boundary
open, so a held document re-presented with one blank-line delta changed its hash,
dodged the sticky replay and earned a fresh judge roll. **Fix:** collapse EVERY run of
newlines to one (delivery_gate.ts:221); a newline stays a token boundary so
word/shingle counts and materialChange are unaffected. Probe 13 — which explicitly
said a fix would "visibly flip these assertions" — was updated to assert the CLOSED
behaviour (0-blank and 1-blank share a hash; the reflowed twin replays the held
verdict, no fresh roll). The delivery-gate `normaliseDocument` assertion was updated
to the new collapsed output.

## inv2 — sufficiency (CONCESSION kept). adv2_sufficiency_test.ts green.

Held; no worker change. One harness-only fix: optional section F (live FOR-UPDATE
race) read `KTEBLI_DB_URL` via `Deno.env.get` outside its try/catch, and the suite runs
adversarial tests with `--allow-read` only, so the lookup threw `NotCapable` before the
documented skip. Wrapped so a denied lookup is treated as unset → F skips as its own
contract requires. Deterministic proofs A–E unchanged.

## inv3 — grounding (BROKEN → fixed). adv2_grounding_test.ts 18/18 green.

**inv3.1 fabricated contact by shape** (contact_claims.ts). Detection anchored on a
closed label list, closed separator set, a leading "+" for phones and a closed TLD set
for hosts, so the invented +961-6-380-000 the module exists for reappeared under any
un-listed field name, non-colon separator, no label, or a TLD outside the set. **Fix:**
shape is the anchor, the lists may only add context — `BARE_HOST` TLD generalised to
any ≥2-letter run (the ≥2-char first-label rule keeps "e.g."/"i.e." out), and a new
`PHONE_SHAPE` detects ≥2 digit groups joined by space/dot/dash/parens, ≥7 digits total.
Comma-grouped budgets, slashed registration numbers and lone years/counts are excluded
by construction, so the round-1 prose false-positive control still raises nothing.
Residual (fail-closed, documented): a space-grouped number or a filename in prose can be
HELD for review — the safe direction for a blocking invariant-3 gate.

**inv3.2 self-naming exemption exonerated supersets** (proper_nouns.ts:250). Two-way
containment exempted ANY capitalised run whose token set was a SUPERSET of the org name,
so "Mashghal Community Association Excellence Prize" (invented award) and fabricated
tokens wrapped around the name were swallowed unreported. **Fix:** exempt one direction
only — every token of the run must be within the org name (`pnContains(key, o)`); a run
that adds any token is a different invented entity and must match the ledger/design or be
reported. Dead `pnOverlap` removed.

**inv3.3 identity gate admitted a stranger** (`orgNameMatchesSite`, index.ts:445). The
dangerous-direction fix. The gate admitted on any single shared distinctive token, or a
token appearing as a bare SUBSTRING of the domain, so "Grace Kitchen"→W.R. Grace,
"Bright Futures Youth Club"→Bright Horizons, "Community Arts Reach"→smartsdata.io ("arts"
inside "smartsdata"). **Fix (conservative, discard-on-doubt):** a legal-name match needs
two distinctive tokens to agree OR identical distinctive-token sets; the domain admits
only when EVERY distinctive applicant token appears in the host. Stays asymmetric —
errs toward rejecting a real site, never toward importing a stranger's; the B1 wholesale
mismatch still rejects.

## inv4 — numeric register (BROKEN → fixed). adv2_numeric_test.ts 7/7 green.

**inv4.1 rate right about the wrong denominator** (numeric_register.ts:251). The PATCH-6
guard was `norm(label).includes(norm(den.label))` — a substring test, so "share of total
project cost" divided by the "cost" node passed, certifying 75% of the grant as 75% of a
different £120k total. **Fix:** match by node identity — the denominator's label must
appear as a whole token-run whose left edge is the start or a connective; a run extended
by a content word ("total"/"project" before "cost") names a different quantity and is
refused. The honest "per participants" rate still resolves.

**inv4.2 ratio verified by a colliding integer** (numeric_register.ts:361). A 0.11 ratio
was "verified" by "11 staff" because `asPercent(0.11)=11` was in the pooled integers.
**Fix:** `numbersIn` (numeric_register.ts:105) records the fraction (0.29) only for a
number that wore a "%" ("29%"/"per cent"); the evidence/donor checks match `r.value`
directly and the bare-integer `asPercent` disjunct (and the dead `asPercent` fn) are
gone. A headcount no longer confirms a percentage; a real "29%" still does.

**inv4.3 the register was wired to nothing (DEEP).**
- consistencyFindings (index.ts:256) is now BIDIRECTIONAL: it catches an UNDERSTATEMENT
  (a total-claim below the design total — the delivered 200-vs-216 direction) as well as
  an overstatement, and the dead `numbersNear` (`a===b`) is deleted.
- `resolveRegister` + `numbersIn` are imported and CALLED in the design stage
  (index.ts:2263): the design's `numeric_register` resolves (totals recomputed/SUMMED,
  rates name their denominator, bases closed) before any document is written, fail-closed
  on the design's own arithmetic; the resolved derivations become the single source of
  truth threaded into narrative generation (both whole-doc and section paths). The design
  prompt now asks for the register (index.ts:2211).
- **Mechanism vs quality:** the MECHANISM (register imported + called before writing;
  consistency bidirectional + summing via the register; live `numbersNear` gone) is wired
  and deterministically unit-tested — adv2_numeric A11's four wiring asserts pass. The
  GENERATION-QUALITY half — that a real narrative's understatement is now caught
  end-to-end because every section writes from the resolved register — needs a full
  pipeline order and is **UNPROVEN-WITHOUT-E2E** (not run: costs money), marked in the
  code comments exactly as WS6-core marked resumable generation.

Round-1 numeric_register test unchanged and passing.

## inv6 — exclusivity (BROKEN → fixed, DEEP). adv2_exclusivity_test.ts green (HELD).

`composeDraw` hashes the fingerprint across eleven axes, but the gen:narrative styleNote
fed the writer only two (spine, opening_move). The other nine were hashed and dropped,
so the reader-visible style space was a finite pool of |spine|×|opening_move| = 182 —
distinct fingerprints, identical writing, two served proposals sharing a byte-identical
style brief past ~17 applicants. **Fix (F1 only — the hash is NOT narrowed):** a new
`composedStyleNote` in the composer block (index.ts:1631) expresses EVERY hashed axis as
a style instruction — each categorical axis its prompt_directive, each integer grid a
concrete instruction (cadence as a mean sentence-length target; move_order /
weight_profile as fixed non-default orderings/weightings keyed to their value). The
gen:narrative styleNote (index.ts:2301) is built from it over the whole stored
composition in both generation paths. The writer's style brief is now injective in the
fingerprint, so the visible-style space equals the fingerprint space and the 182 ceiling
is gone. **Deliberately NOT narrowing the hash:** that would REINTRODUCE a ceiling;
instead the visible space is widened to match the (large) hash space.

**Test correction, argued:** adv2_exclusivity's `writerStyle` model was the old two-axis
brief and its section-1 guards asserted the defect (styleNote = template_style +
opening_style only). Both were updated to import and use the worker's own
`composedStyleNote` as the model of the writer's input, and to assert the brief carries
all eleven axes. This is a correction, not a weakening: the test now models what the
generator actually receives, and with that honest model the predicate flips to HELD —
1000/1000 served applicants get 1000 distinct visible styles (was capped at 182).
`composer_reservation_test` passes unchanged (hash and reservation untouched).

- **Mechanism vs quality:** the MECHANISM (every hashed axis is in the writer's brief;
  visible space == fingerprint space) is proven. The PROSE-DISTINCTNESS half — that
  move_order 5 vs 6, or weight_profile 41 vs 42, actually read differently to a human
  rather than only as different instruction bytes — needs a full pipeline order and is
  **UNPROVEN-WITHOUT-E2E** (not run: costs money), marked in the code and the test output.

---

## Rules honoured

Every fix fails closed. No fix weakens another invariant: inv3.3 rejects strangers more
strictly, not less; inv6 widens the visible space and never shrinks the fingerprint. No
schema/migration change was needed. Test edits outside `tests/adversarial/` were confined
to two assertions a fix legitimately obsoleted (donor_limits_test wrap; delivery_gate_test
`normaliseDocument` output), each argued above. A critic and the original attackers may
re-attack: the claims here are exactly what the imported adv2 tests reproduce.
