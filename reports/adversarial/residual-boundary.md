# The two deterministic-irreducibility residuals (invariants 3 and 6-adjacent)

The adversarial round closed every REACHABLE class its attackers demonstrated, each surviving a
fresh re-attack. Two invariants — 3 (grounding / identity) and 4 (numeric register) — reached a
point where the remaining class is not deterministically closable, and both attackers said so in
writing. This note states each residual precisely, why it is irreducible for a deterministic gate,
and what backstops it. The operator should know these exist.

## Invariant 3 — the identity gate: "same topical stem, one name a subset of the other"

**Closed, each re-attack-proven:** a distinctive-token substring inside a different word (Art Care
→ smartcare.com); a prefix-not-boundary (Care Reach → careeroutreach.com); a domain spelling
overriding a CONTRADICTING crawled legal name (Green House → greenhouse.io / "Greenhouse Software
Inc"); a bare two-token INTERSECTION of different names (Youth Climate Hub Bristol vs Climate Youth
Action Fund); and topical CONTAINMENT for the common sector words now in ORG_GENERIC_WORDS (Mental
Health Leeds Project vs Mental Health Foundation).

**Residual:** two different organisations whose names share a topical stem NOT in the generic list,
where one name's distinctive tokens are a subset of the other's, and that stem is ALSO a word used
distinctively by some real charity (so it cannot be added to the generic list without rejecting a
real applicant's own site). "Green Streets Leeds" vs "Green Garden Streets Trust" is the example:
"green" is topical there but distinctive in "Green House", and no static list resolves both.

**Why irreducible for a deterministic gate:** distinguishing "a local project of a national field"
from "the national body of that field" requires knowing a word is topical rather than distinctive —
a frequency/distinctiveness judgement a string matcher cannot make without a lexicon that is both
complete and never wrong, which does not exist.

**Backstops:** (1) the gate stays ASYMMETRIC — on doubt it discards, so the failure it can produce
is importing a same-topic stranger's site, never fabricating; (2) the LLM Claim Ledger is the
grounding gate for FACTS — it classifies every material claim and blocks unsupported ones (it held
the Sufra e2e at validate); a stranger's imported facts that do not trace to the applicant's own
ledger are caught there; (3) the intake collects the applicant's own website, so a mismatched
domain is an applicant error, not an attack surface an adversary controls.

## Invariant 4 — the numeric register: "share of an ambiguously-named denominator"

**Closed, each re-attack-proven:** a rate right about the wrong denominator by substring (share of
"total project cost" ÷ the "cost" node); a scope reframe on either side ("cost of the whole
project", "the total of cost"); a partial sub-aggregate numerator (F1=L1+L2 ÷ grant while a flat
total exists) via a word-list-FREE leaf-set rule; and every label spelling of that class ("the
cost", "costs", a synonym) — the leaf-set rule compares leaves, not labels.

**Residual (corrected per the inv4 attacker's RE-6 concession):** the residual is SYMMETRIC — it
is "the part-whole relationship is not declared in structure," in EITHER direction: the true larger
whole is a bare LEAF, or the numerator is a disconnected leaf that is not a declared member of any
sum. In that regime the leaf-set rule has no aggregate to fire on, and the only backstop is the
label-superset rule. That backstop now article-strips and de-pluralises before comparing, so a
stop-word or plural ("the cost", "costs") no longer evades it — only a TOKEN-DISJOINT SYNONYM
("overall budget" for a "cost" node) is genuinely irreducible, because two unrelated words for the
same quantity cannot be matched without a semantic lexicon.

**Why narrow, and why the pipeline is protected:** the register is BUILT by the design stage from
the design object; a closed budget declares its total as a SUM (so the leaf-set rule fires), which
is the shape the consistency close-check already requires. A total declared as a bare leaf that
also carries a synonym label is an unusual, largely self-inflicted register shape, not a natural
model output. The threat model for invariant 4 is a model's honest arithmetic error (the 200-vs-216
and over-75% defects), which the register catches by closure; a deliberately-crafted colliding-label
register is not what honest generation produces.

**Backstops:** the bidirectional consistency close-check (a budget that does not sum is caught
regardless of any rate label); resolveRegister fail-closing before generation; and, again, the LLM
Claim Ledger on the finished narrative.

## Standing recommendation

Neither residual is a reason to withhold launch: both are in the asymmetric-safe direction, both are
backstopped by the LLM Claim Ledger, and both require inputs (a same-topic stranger domain the
applicant themselves supplied; a crafted colliding-label register) that honest use does not produce.
The durable closures — a frequency model for org-name distinctiveness, and requiring every budget
total to be a declared sum — are noted for a future iteration, not this launch.
