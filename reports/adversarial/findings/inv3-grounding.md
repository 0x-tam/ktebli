# Adversarial finding — invariant 3 (grounding): BROKEN, 3 deterministic routes

Attacker worktree: agent-a878dcfecda41173a, commit 76ca51c (adv2_grounding_test.ts 14 failing +
4 controls + report). $0 (deterministic). Context the attacker established: the FACT grounding
gate is the LLM claim-ledger (index.ts:2294, which correctly held Sufra in the e2e); the
deterministic auditors are the backstops it attacked. Conceded (held): registration-number
digit-substring trick fully closed; multi-word invented partners in table cells caught;
deniability-softening is an LLM surface with no deterministic function to break.

1. **contact_claims.ts — the only blocking guard for a fabricated contact detail (the ledger's
   donor_required_certification class permits self-statements).** contactAudit anchors on a
   CLOSED label list + closed separator set (or a leading +). A domestic number under an unlisted
   label (Reception:, "WhatsApp is 06 431 227", "| Enquiries |"), or a fabricated .io/.ly website
   (website/homepage aren't labels; the TLD set is closed) walks through. The +961 6 380 000
   failure the module exists for, reintroduced by a label swap. FIX: detect number-shaped and
   URL-shaped content by SHAPE regardless of label/separator; the label list may only ADD
   context, never gate detection.
2. **proper_nouns.ts:247 — self-naming exemption exonerates a SUPERSET of the org name.** Any
   capitalised run whose token set ⊇ the applicant name is swallowed unreported, so "Mashghal
   Community Association Excellence Prize" (invented award) and fabricated tokens wrapped around
   the name escape; corrupts D4's denominator (advisory, but the fabrication survives every
   correction round). FIX: exempt only the exact org-name span, not supersets containing it.
3. **orgNameMatchesSite (index.ts:431) — admits a stranger's site on one shared common word.**
   "grace"→W.R. Grace chemicals, "bright"→Bright Horizons, or a coincidental domain substring
   ("arts" in smartsdata.io, zero name overlap) → imports another org's history as the
   applicant's. The identity gate's asymmetry failing in the DANGEROUS direction (the worst
   outcome per invariant 3). FIX: require distinctive/multi-token overlap or a high match score;
   stay asymmetric (discard on doubt) — a stopword-only overlap must NOT admit.

Status: OPEN — consolidation fix owner. Re-attack: adv2_grounding_test.ts (14 failing) → pass.
Note: proper_nouns/referent_weight are advisory by design; the MUST-FIX is Route 1 (blocking
guard) and Route 3 (identity gate admitting a stranger). Route 2 tightens a measurement.
