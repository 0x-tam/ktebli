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

---

## 2. What was built (Phase 8, Task 2)

The gap was never that the store was missing — `orders.intake_answers` (jsonb) and the E-ASK slot
system already existed. It was that (1) the worker never turned the structured answers into Evidence
Ledger items, so they grounded nothing; (2) the slots covered particularity only, not the admin and
named facts the grounding check demands; and (3) there was no field for extra crawl links. All three
are now closed. No model calls were made building this; the re-run that spends is the orchestrator's.

### 2.1 Worker — intake_answers → Evidence Ledger (the data-starvation fix)

`supabase/functions/worker/intake_ledger.ts` (new) exports `intakeAnswerLedger(intake_answers, opts)`:
a pure, deterministic mapper from the flat answer shape to E-INTAKE items. Wired into the org stage
at `worker/index.ts:1943` (import at `:55`), immediately after the three identity items — identity
reserves ids 1–3, facts start at **E-INTAKE-4**. Every item is
`{source_type:"user_intake", source_ref:"evidence interview", status:"verified", allowed:true}`, so
it lands in `allowedEvidence` and the Claim Ledger classifies a matching narrative claim as
`supported`, not `unsupported`. **A blank field emits nothing; a boolean asserts only when exactly
`true`** (invariant 3 — no default is ever invented).

Field → ledger item (one clear claim each; objects/arrays expand to one item each):

| intake_answers field | E-INTAKE claim |
| --- | --- |
| `site_place` | `Project location: <v>` |
| `site_venue` / `venue_escape` | `Delivery venue: <v>` — or, if escaped, `Delivery is street-based outreach, not at a fixed venue.` |
| `site_activity` | `Main activity: <v>` |
| `last_delivery_what`(+`_when`) / `never_delivered` | `Most recent delivery: <what> (<when>)` — or the stated-absence "…has not yet delivered a project…" |
| `local_trigger` | `Local trigger for this work: <v>` |
| `registration_number` | `Registration number: <n>` — **skipped when identity already built E-INTAKE-2** (dedup) |
| `legal_form` / `annual_income` / `income_band` / `accounts_period` / `lived_experience_governance` | `Legal form: <v>`, `Latest annual income: <v>`, `Annual income band: <v>`, `Latest filed accounts cover the period: <v>`, `People with lived experience are involved in governance: <v>` |
| `safeguarding_lead_name`(+`_role`,`_training`) | `Designated Safeguarding Lead: <name>, <role>, <training>` (one item) |
| `safeguarding_policy` / `bank_account_own_name` / `public_liability_insurance` / `board_independent` / `no_conflicting_grant` (booleans) | one certification sentence each, emitted only when `true` |
| `key_people[{name,role}]` | `Key person: <name> — <role>` (one per entry) |
| `programmes[{name,what}]` | `Programme: <name> — <what>` (one per entry) |
| `results[{what,when,figure}]` | `<figure> <what> (<when>)` (one per entry) |
| `partnerships[string]` | `Partnership: <v>` (one per entry) |
| `extra_links[url]` | not a ledger item — a crawler hint (§2.2) |

This mapping is proven at unit level in `tests/intake-ledger/intake_ledger_test.ts`: the decisive
assertion runs the real `properNounAudit` over `[identity items] + intakeAnswerLedger(answers)` and a
narrative naming the DSL, programmes, venue, chair, partner and dated result — **0 unsourced** — while
the same narrative against the three-item identity ledger leaves **9 names unsourced** (exactly the
KT-10001 starvation). This is the load-bearing check: a field the worker did not fold into
`allowedEvidence` would fail grounding on a live run, and this test would catch it.

### 2.2 Worker — extra-links crawl (`worker/index.ts:1971`–2010, `:2007`, cache guard `:2177`)

In the org stage, each URL in `intake_answers.extra_links` (server-capped at 5, http(s) only) is
crawled through the **same `crawlSiteObserved` path** as the home domain — same robots/SSRF guards,
unweakened. Each link's text is gated for attributability with the same asymmetric token test the
uploads gate and identity gate use (`orgTokens(org)` must appear in the page); a page that does not
carry the applicant's own name is discarded whole. Attributable pages are folded into the single
extraction corpus, so their referents reach `E-WEB` through the existing one extraction call (no
extra model call). A link that fails is recorded in `crawlMeta.extra_links` and skipped — fail-closed
means fewer referents, never a crash. When extra links contribute, the org_intel cache write is
skipped (`freshExtraction && !extraLinksContributed`), because the extraction is keyed to this order's
own link set, not to the domain. **Deferred:** extra links only fold in when a home domain is present
(the common case — a website is collected); an extra-links-only order is not yet handled, and
`crawlSiteObserved` does not fetch PDFs, so an extra link to a PDF yields no text today.

### 2.3 Sufficiency gate — the hard bar is fulfillability, admin self-certs are reported (`worker/sufficiency.ts`)

`SufficiencyInput.facts: IntakeFacts` added. The gate distinguishes two tiers, and the distinction is
an invariant-2 correctness point: the **HARD** bar (below which nobody is charged) is *fulfillability*
— can the pipeline ground and deliver a proposal? — **not** *completeness* (has the customer supplied
every donor self-cert?). The pipeline itself treats `donor_required_certification` claims as
NON-BLOCKING at grounding and surfaces them as "[to confirm]", so an order missing them is still
fulfillable.

- **HARD (`requiredFactGaps`, refuses checkout):** the **registration number** — a fabricated or
  absent registration is not groundable (the KT-10001 defect); `factPresent` rejects blanks and the
  literal `UNVERIFIED-TEST-0000001` placeholder — **plus the existing referent / particularity floor**
  (the six slots + the score arm), all unchanged.
- **REPORTED (`advisoryFactGaps`, named but never refuses):** **income_band**, **safeguarding_policy**,
  **safeguarding_lead_name**. These land in a new `verdict.advisories` and `message.advisories` list;
  `cleared` is derived from `blockers`/`gaps`/`score` **only** — advisories are deliberately excluded,
  and `assertVerdictConsistent` never references them. The gate NAMES each missing one in the
  customer's "to confirm before you submit" list.

**ladderStatus stays FLAT**; both functions are presence checks, no number compared, so the "one
threshold, one comparison" source-scan (Test 4) still holds. `canonicalFacts` + `facts:` in
`canonicalPayload` put the whole extended shape under the fingerprint, so clear-then-edit of any fact
still refuses at the webhook (invariant 2). `sufficiency_test.ts` §9 proves: registration + org facts
but blank income/safeguarding **CLEARS** with the three named as advisories (not gaps); registration
missing/placeholder **REFUSES**; below the referent floor **REFUSES**. `save-intake` records
advisories in the stored verdict and the events row (invariant 9). The wizard shows them under "To
confirm before you submit (we will write it either way)" and does not hold checkout on them.

### 2.4 Persistence & schema (invariant 2 preserved end to end)

- **Migration** `supabase/migrations/20260901120000_intake_evidence_facts.sql` (new file) adds one
  column `pre_intakes.intake_facts jsonb` — nullable, no default (a blank interview stores null and
  the gate refuses on the missing core facts). `tests/replay/expected-fingerprint.txt`
  `columns_nonvector` re-recorded to `2d3e7c1032a16e06354a10cd10295400` in the same commit (the
  documented update path — only that one category moved; `tests/replay/run.sh` → **REPLAY OK**, with
  the repo-ahead-of-production `UNDEPLOYED MIGRATIONS` note, as expected).
- `save-intake/index.ts`: `sanitizeFacts(b.facts)` (`:62`) bounds every field and drops blanks; stored
  as `intake_facts` (`:188`). `save-intake/clearance.ts` + its byte-identical twin
  `stripe-webhook/clearance.ts`: `inputFromRow` reads `row.intake_facts` into `SufficiencyInput.facts`
  (`:70`,`:87`). `stripe-webhook/index.ts:221` spreads the stored facts into the order's
  `intake_answers` alongside the six slots + escapes, so the worker reads the one flat shape.

### 2.5 Wizard (`index.html`)

Redesigned into the pre-payment evidence interview: 7 steps (package → organisation+income band →
grant → project specifics → governance & assurances → people/programmes/results/partnerships/links +
uploads → review). Registration is required (the hard bar); income band, the safeguarding policy and
the named DSL are collected but reported-not-gated. Particularity slots, the
safeguarding policy + named DSL, the certifications, dynamic repeaters for the list facts, and an
extra-links field all write **exactly** the `intake_answers` shape (`answers` + `facts`). On review,
`pay()` POSTs to `save-intake` and renders the gate's own message: **cleared → navigate to Stripe with
the `checkout_token` as `client_reference_id`** (the blind 2500 ms navigate-without-a-token that
migration 20260826180000 flagged is gone — invariant 2 held at the front end too); **not cleared →
show exactly which facts are missing and go no further**. Customer `echo` text is escaped
(`textContent`), never injected.

**What a browser click-through confirms (spot-checked headless, no network — the `save-intake` fetch
was never fired):** all new elements resolve; `wiz.collect()` returns the exact shape above (verified
field-by-field); step validation passes when filled and blocks when not; the review summary renders;
`renderSuff()` shows named gaps for a refusal, the `ok` state for a clearance, escapes customer HTML,
and clears on navigation. A real end-to-end click-through (submitting to `save-intake`) is the
orchestrator's live-order step.

### 2.6 Verification

`sudo env PGBIN=/usr/lib/postgresql/17/bin TMPDIR=/tmp bash tests/run-all.sh` → **ALL SUITES PASSED**
(includes REPLAY OK, the new `intake answers -> evidence ledger` suite, updated sufficiency §9, and
two adversarial fixtures (updated then fully reverted within this task — byte-identical to base at HEAD)). `deno check` clean on every worker/function file changed.

### 2.7 The intake_answers shape as shipped

```
{
  site_place, site_venue, site_activity, last_delivery_what, last_delivery_when, local_trigger,  // strings
  venue_escape,                                                                                   // "homes"|"street"|"outdoors"|"mobile"|"online"|null
  never_delivered,                                                                                // boolean
  registration_number, legal_form, annual_income, income_band, accounts_period,                   // strings (registration_number usually via org_reg instead)
  safeguarding_lead_name, safeguarding_lead_role, safeguarding_lead_training, lived_experience_governance,  // strings
  bank_account_own_name, public_liability_insurance, safeguarding_policy, board_independent, no_conflicting_grant,  // booleans
  key_people:   [{ name, role }],
  programmes:   [{ name, what }],
  results:      [{ what, when, figure }],
  partnerships: [ string ],
  extra_links:  [ url ]
}
```
The wizard writes it; `save-intake` stores the extended half in `pre_intakes.intake_facts` and the
slots in their columns; `stripe-webhook` reassembles the one flat object into `orders.intake_answers`;
the worker reads it. Both ends agree on this shape.

---

## 2. The redesign (Task 2) — built, critic-passed, merged

See the merge commit and reports/adversarial-style critic trail. Summary:
- **Grounding fix:** `worker/intake_ledger.ts::intakeAnswerLedger()` folds every non-empty
  `intake_answers` field into an E-INTAKE-4+ ledger item, wired into the org stage. Proven: the
  real `properNounAudit` returns **0 unsourced** over identity + mapped ledger vs **9** on the
  three-item ledger — the KT-10001 starvation, closed. A separate critic reproduced it at 11→0
  with different names.
- **Sufficiency (invariant 2):** hard bar = fulfillability (registration_number + the referent/
  org-fact floor); income_band, safeguarding_policy, safeguarding_lead_name are REPORTED to the
  customer as advisories, never blocking (they are donor_required_certification — non-blocking at
  grounding, produced with the self-cert surfaced). Placeholder registration numbers rejected.
- Extra-links crawl into E-WEB; new additive migration (`pre_intakes.intake_facts`) + fingerprint
  re-recorded; wizard redesigned into the pre-payment evidence interview. Full suite green.

## 3. The re-run (Task 3) — STOPPED at the $3 floor, 0 gate rows. See NEEDS-CREDIT.md.

The four applicants' real public-materials intake was researched and all four charity numbers
independently verified (stack/out/phase8-research/). Sufra (KT-10001) was driven with the real
intake ledger through **analyze → org → voice → strategy** — the expanded intake path works
end-to-end through the real crawl, the ledger build (13 people / 7 programmes / 7 dated results),
and the composer. It then **stalled at DESIGN**, the monolithic high-effort stage that exceeds the
local edge-runtime invocation window (launch-readiness **P0.3**), which was reaped and retried
until the model budget crossed the $3 floor. **No order reached the delivery gate;
delivery_gate_verdicts = 0.**

Three real bugs the re-run surfaced were fixed on trunk: the free-text grant-deadline crash
(coerceGrantDeadline), the heartbeat-only-at-call-start reaping (heartbeat-during-call), and a
`functions serve` restart-infra workaround.

**Honest reading:** the intake expansion — the subject of this phase — is done and proven at the
unit level. The end-to-end gate demonstration was blocked by the pre-existing P0.3 design-stage
runtime limitation, not by the intake, and the design retries exhausted the budget before the gate.
What it costs to finish is in NEEDS-CREDIT.md: ~$8–12 of credit plus the P0.3 design-stage fix
(streaming llmRaw / resumable design), then re-run the four applicants to the gate.
