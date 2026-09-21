# Design documents — quality loop, 2026-08-26

Working documents from the diagnosis and design pass. They are kept because they
carry the line-level ground truth the changes were built from, and because two of
them are adversarial reviews that **rejected** the designs they reviewed.

Nothing here is a decision record. `CLAUDE.md` holds decisions.

## Ground truth (verified against the code, line by line)

| File | What it establishes |
| --- | --- |
| `pipeline-spec.md` | The real stage chain and every generation prompt, faithfully transcribed |
| `house-style-findings.md` | Where the *scaffolding* — not the model — makes every document alike: hardcoded table headers, fixed section lists, fixed word bands, one logframe ontology |
| `ground-evidence.md` | What the evidence ledger can and cannot carry. Answers the ceiling question: 1–4 genuinely new proper nouns for a typical customer, and reliably zero of the categories the critics named |
| `audit-exclusivity.md` | All five locks. The true ceiling, why it falls below 8, and that the house-voice lock indexes zero rows |
| `audit-reliability.md` | Completion, notification, retry stranding, crawler silence |
| `audit-integrity.md` | Arithmetic, cost accounting, currency, drift blindness |

## Designs

| File | Status |
| --- | --- |
| `design-composer.md` | **Implemented** (reservation layer). Twelve axes, fingerprint lock, re-roll on collision |
| `design-integrity.md` | **Partly implemented** — the Numeric Register core and its tests. The design-stage wiring waits on the 2×2 |
| `design-resumability-and-alerts.md` | Alerts implemented; resumable generation not yet |
| `design-evidence-interview.md` | **NOT implemented — rejected as written.** See the challenges |
| `design-deep-crawl.md` | **NOT implemented — rejected as written.** See the challenges |

## Adversarial reviews

Both returned `NEEDS_WORK` on designs written by other agents. Their findings are
why the evidence layer was not built as specified.

`challenge-evidence.md` — nine constraint violations. The ones that matter:

- **Manufactured provenance.** The finances question hard-codes a basis string
  asserting a figure came from the organisation's accounts, when no accounts were
  seen and the customer never said so. Code inventing provenance in a
  funder-facing document.
- **Assertion class assigned per slot, not per sentence.** Free text inside a
  typed slot can carry any claim, so a customer's unverified sentence about a
  named person and two named institutions would be stated plainly as fact.
- **Corroboration promoted the wrong unit.** One matching token promoted a whole
  multi-fact item to "site corroborated" and licensed it unhedged.
- **The ledger is not fenced.** Every other applicant-supplied input is wrapped in
  the untrusted-source delimiters; the ledger is not, which is safe only while
  every claim in it is model-extracted from already-fenced input. Verbatim
  customer text would break that invariant.
- On the headline claim: the interview plus deep crawl would raise a typical
  customer from ~1 proper noun to **6–12**, with 15–25% of orders gaining
  **nothing**. Directionally right, an order of magnitude short of the goal — and
  neither design made the generator *use* what it collected. That last omission
  is what `worker/proper_nouns.ts` answers.

`challenge-conversion.md` — the customer's side. Counts 28–55 controls before
payment against today's ten, and argues the owner's pre-payment decision is the
highest-variance change available on an unmeasured baseline. It also finds that
the design's own post-payment recovery path spends a Draft customer's single
included revision (`REV_CAPS.draft = 1`) repairing a gap our form created.
