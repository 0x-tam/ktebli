# Phase 8 — intake expansion (the pre-launch phase)

**Date:** 2026-09-01 · **Why:** the product cannot currently complete a real order. KT-10001, the
one full end-to-end run, held at `validate` on grounding — the correct refusal to fabricate. The
fix is not architecture; it is the intake. Nothing ships until a real order completes.

---

## 1. The specification — what the grounding check found missing on KT-10001, in check order

The `validate` stage (worker/index.ts:2553) runs these checks per round, in this order. A finding
in any BLOCKING check holds the order. This is the exact order and the exact findings on KT-10001.

### Check order

1. **Deterministic (free, always):** numeric consistency; development-jargon; **proper-noun audit**
   (advisory — a name with no ledger item is flagged but does not block); **contact-detail audit**
   (BLOCKING — a fabricated phone/URL).
2. **Claim Ledger (LLM), BLOCKING:** every material claim about the org's PAST/PRESENT is classified
   supported / qualified / model_proposed_future / stale / conflicting / donor_required_certification
   / **unsupported**. Material `unsupported | stale | conflicting` claims block.
3. **Requirement coverage (LLM), BLOCKING:** every donor requirement → covered / partial / **missing**.
   Mandatory requirements with status `missing` block. (`partial` does not block but degrades quality
   and is the customer-facing "to be confirmed" list.)

### What KT-10001 failed on

**(2) Seven material UNSUPPORTED claims** — org facts the narrative asserted that no ledger item
carried. These are the org-specific facts the intake must collect (structured or from an upload):

1. Safeguarding policy exists + a Designated Safeguarding Lead with Level-3 training
2. The Deputy Chair (named) holds the Deputy Safeguarding Lead role
3. "OpenARMS" is the org's asylum-support programme (a named programme)
4. The "Advice Service" and its scope (benefits, housing, debt, income maximisation, training, employment)
5. A "Community Wellbeing Service" at a named venue ("New Horizons Centre")
6. How existing refugee contact is funded/recorded ("as food aid and advice, not homelessness prevention")
7. A named organisational practice ("cash-first practice")

**(3) Two MISSING mandatory requirements** (final round):

1. **Charity registration number** — was the placeholder `UNVERIFIED-TEST-0000001`
2. Submission-deadline compliance (a process attestation, not an org fact)

**Six `donor_required_certification` self-certs** (surfaced to the customer, not blocking, but the
intake must carry them so coverage is not left "partial"):

1. Is a registered charity
2. Bank account in the org's name with unrelated signatories
3. Public Liability Insurance held
4. Accounts received covering a twelve-month period; **income band** (drives permitted grant size)
5. Independent organisation with the Board in full control
6. No live Foundation grant running past a stated date

**Advisory (non-blocking) but informative:** 24–26 **unsourced proper nouns** (New Beginnings Brent,
New Beginnings Keyworker, OpenARMS, Immigration Advice Authority, PSA, …) — every named place,
partner, programme, register or body the narrative used that the 3-item ledger could not back.

### The intake specification that follows from this

The Evidence Ledger must be able to carry, PRE-PAYMENT:

**A. Structured admin facts (self-certified; the `donor_required_certification` + `missing` set):**
charity/legal registration number, legal form, latest-annual-income + income band, latest filed
accounts (period), bank account in the org's own name, public liability insurance, safeguarding
policy + **named** Designated Safeguarding Lead (+ training level), board independence, current-
grant status with the funder, lived-experience involvement in governance.

**B. Named org facts (the `unsupported`-claim set), from structured fields AND an uploaded document:**
key people with roles (chair, deputy chair, DSL, coordinators), named programmes/services with a
one-line scope each, named venues, dated results / beneficiary numbers, partnerships.

**C. Two evidence intake mechanisms beyond the order form:**
- **Upload** of a past proposal, annual report, or charity-register filing → text extracted into
  the ledger as `E-DOC-n`.
- **Extra links** field → pages beyond the home domain the crawler should read (`E-WEB-n`).

The sufficiency gate scores this assembled ledger before checkout and tells the customer precisely
which facts are still missing; nobody is charged below the bar (invariant 2).
