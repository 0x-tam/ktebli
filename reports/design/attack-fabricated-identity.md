# ADVERSARIAL — invariant 3: BROKEN

**Target:** *nothing asserted that the ledger does not carry; never manufacture provenance.*
**Attacked:** `supabase/functions/worker/contact_claims.ts`, `supabase/functions/worker/proper_nouns.ts`,
and their wiring in `index.ts` and `delivery_gate.ts`.
**Date:** 2026-08-27 · **Verdict: BROKEN.** Nine distinct routes, all deterministic, all
reproduced against the real functions.

Everything below was executed. No model was called (the OpenRouter key is capped) and none
was needed — every check attacked here is deterministic code, which is exactly why it can be
broken on a laptop with no credit.

---

## The headline

A single document carrying **sixteen fabricated facts** — telephone, second telephone,
registered address, postcode, company number, date of incorporation, web domain, two
accreditations, three partner organisations, two named staff, an invented funder, and a
quotation attributed to an invented beneficiary — produces:

```
contactAudit   : claims=0  fabricated=0  findings=0
properNounAudit: offers=5  used=3  unsourced=["Registration Number","Company Number","Date of Incorporation"]
index.ts validate  -> deterministic BLOCKING contribution: 0
delivery_gate D4   -> failure raised: false
```

Zero blocking findings. The only finding raised is advisory, and it names **three donor form
field labels** — not one of the sixteen inventions. The document is at
`probe8.ts` in this directory; run it with
`npx --yes deno@2.9.5 run --allow-read probe8.ts`.

Worse than passing: **two of the three referents the audit credits as "ledger use" are
inventions**, and without them the document fails the blocking D4 gate. The fabrications are
what carry it through.

---

## What I did NOT measure — read this before quoting anything above

The remaining defence against every route below is the **model-driven Claim Ledger**
(`index.ts:1704-1720`). Whether it catches any of these is **NOT MEASURED**. The OpenRouter key
returns 403 for every call including a 16-token probe, so no model ran this session. I am not
guessing at its verdict in either direction.

Two things about it are on the record and are not my opinion:

- `contact_claims.ts:1-24` states that when the pipeline invented `+961 6 380 000`,
  *"Every internal validator passed it"* — the Claim Ledger included.
- Its `donor_required_certification` class (`index.ts:1709`) exists to **permit**
  administrative self-statements about registration standing and banking arrangements —
  precisely the class of fabrication in routes 1–3 below.

So "the Claim Ledger might catch it" is not available as reassurance here, but neither is
"it won't". It is unmeasured.

`delivery_gate.ts` is not imported anywhere in `index.ts` — it is built and tested but not
yet wired into the pipeline. I report its D4 arithmetic because the module is the intended
last gate; it is not currently running in production.

---

## Route 1 — the separator decides whether a field is checked

`LABELLED` (`contact_claims.ts:37-41`) requires a literal `:` with only whitespace between it
and the label. 25 fabricated identity lines, one ledger, real `contactAudit`:

| written | caught |
| --- | --- |
| `- **Telephone:** +961 6 431 227` | **yes** (the one shape the check was written against) |
| `- **Telephone**: +961 6 431 227` | no |
| `- _Telephone_: +961 6 431 227` | no |
| `\| Telephone \| +961 6 431 227 \|` | no |
| `- Tel. +961 6 431 227` | no |
| `- Telephone — +961 6 431 227` | no |
| `Reach the coordinator on +961 6 431 227 during office hours.` | no |

**1 caught, 24 missed of 25** (`probe2.ts`). Moving the colon one character to the right —
`**Telephone**:` instead of `**Telephone:**`, both idiomatic markdown, both produced routinely
by generators — defeats the check completely.

## Route 2 — every identity field that is not a telephone

The label list carries phone, fax, bank/account/IBAN/sort/routing/SWIFT/BIC. It does not carry:

`contact number` · `hotline` · `landline` · `company number` · `charity number` ·
`registration number` · `VAT registration` · **`postcode`** · `postal code` · `P.O. box` ·
`registered office` · `address` · `date of incorporation`

All fabricate freely. Note `postcode`: it is **already declared in `ContactKind`**
(`contact_claims.ts:26`) and nothing in the file ever produces one. The type is a promise the
code does not keep, and the task brief named a fabricated postcode as a target — it lands
without resistance.

## Route 3 — manufactured provenance (the worst one)

This is not a miss. It is an **affirmative clearance**. `contactAudit` strips every separator
from the whole ledger and asks whether the claim appears anywhere inside the result
(`contact_claims.ts:103-107`).

```
ledger : "Registration number: 1487/2019 (Lebanese Ministry of Interior …), registered 2019."
       → "registrationnumber14872019lebaneseministryofinterior…registered2019."

document "- **Account number:** 14872019"  →  detected as a claim  →  fabricated: 0   CLEARED
document "- **Sort code:** 148720"         →  detected as a claim  →  fabricated: 0   CLEARED
```

An invented **bank account number** is certified as ledger-backed by the applicant's
*registration* number. A gate that must be affirmatively cleared instead affirmatively clears
a fabrication, using evidence about something else entirely. `join("\n")` on `:103` means the
same trick works across two unrelated ledger rows, since the newline is deleted by
normalisation. (`probe3.ts`)

## Route 4 — a web address without a scheme is not a web address

`URL` (`:45`) requires `https?://`. Against a ledger that says in terms *"Website: none
supplied. The applicant has no website"*, the line
`Further detail is published at www.mashghal-community.org.` raises nothing.

## Route 5 — the proper-noun audit is blind to tables and headings

`properNouns()` deletes whole headings and whole table rows before it looks
(`proper_nouns.ts:40-41`). A grant proposal puts its partners, its staff and its awards in
exactly those two places.

| written | reported |
| --- | --- |
| `The work is delivered with Cedar Valley Trust across the district.` | yes (control) |
| `\| Cedar Valley Trust \| Vocational curriculum \| 2019 \|` in a partner table | **invisible** |
| `## Recognition: the Beirut Civic Excellence Award` | **invisible** |

Not "unflagged" — never read.

## Route 6 — markdown line-wrapping deletes the first word of a name

Any capitalised run beginning after `.` `!` `?` `:` `;` **or a newline** loses its first word
unconditionally (`proper_nouns.ts:61-62`). Two-word inventions then fall below the multi-word
reporting threshold at `:149` and vanish.

| written | audit sees | reported |
| --- | --- | --- |
| `Volunteers are trained locally. Cedar Valley Trust supplies the curriculum.` | `Valley` | no |
| `… our delivery partner\nCedar Valley Trust, at no cost.` | `Valley` | no |
| `The team is small. Rana Haddad has directed the association since 2016.` | `Haddad` | no |
| `Reach extends beyond the city. Deir Ammar hosts our second workshop.` | — | no |
| `Staffing:\n\nRana Haddad, Executive Director` | `Executive Director` | **the job title, not the person** |

The last row is the ugliest: the audit reports something, so it looks like it is working, and
what it reports is not the fabrication.

**Whether an invented partner is visible depends on where the generator's line happened to
wrap.** That is not a gate.

## Route 7 — quotations and accreditations

- `"Before the workshop I had no way to earn," said Layla, a 17-year-old participant.` —
  `Layla` is one word, and single words are never reported. An invented human being, quoted
  in a funded document, raises nothing.
- `ISO 9001:2015`, `BS 8484` — all-caps runs are dropped at `:150` as headings. Every
  accreditation an organisation could invent is spelled in capitals.

## Route 8 — a fabrication is CREDITED as evidence use

`pnOverlap` (`:87-95`) matches when every word of the **shorter** name appears in the longer,
**in either direction**. So an entity invented out of a word the ledger carries is scored as
*use of that ledger referent* and is not reported unsourced.

```
"Referrals come from the Qobbe Vocational Institute."           used=1  unsourced=[]
"Its accounts are filed with the Lebanon Reconstruction Fund."  used=1  unsourced=[]
"Placements run through the Bab al-Tabbaneh Employers Consortium." used=1 unsourced=[]

"Our workshops sit in Tripoli, minutes from the port."          used=0  unsourced=[]
```

**Naming the applicant's real city scores zero. Inventing three institutions scores three.**

`delivery_gate.ts:318-324` computes the blocking D4 disqualifier from that number. On the
composite document, `used=3` of `offers=5` clears D4; strip the two invented entities and
`used=1`, which fails it. **The document is delivered because of its fabrications, not
despite them.** Invariant 3's violation is what satisfies the delivery gate.

## Route 9 — the denominator is partly imaginary

`properNouns()` on the ledger joins items with a bare `"\n"` (`:111-113`), and the
capitalised-run regex reads straight across the boundary:

```
ledger nouns as extracted:
  ["Community Association Registration", "Lebanese Ministry of Interior",
   "Lebanon", "Bab al-Tabbaneh", "Qobbe"]
```

`"Community Association Registration"` does not exist. It is the tail of
`Organisation name: Mashghal Community Association` fused to the head of
`Registration number: …`. Meanwhile `Tripoli`, which the ledger really carries, is **absent**,
because it follows a colon and route 6 ate it. So the applicant's own name is counted as an
external referent it must "use", and a real place it works in is not counted at all.

`referent_weight.ts:590-601` records both defects verbatim as *"live in `properNounAudit`"*.
They are still live.

---

## The wiring, which is a finding in its own right

**`UNSOURCED PROPER NOUNS` does not block, and the module says it should.**
`proper_nouns.ts:15-17` states its own contract: *"a proper noun in the narrative that is in
NO ledger item is either fabricated or lifted from another organisation. That is the worse
outcome and it is reported separately, **as blocking**."* It is listed in `ADVISORY` at
`index.ts:1744-1745` and contributes **zero** to `blocking`; `delivery_gate.ts:318-324` blocks
only on `SPECIFICITY`. So even the routes the audit *does* catch cannot stop a delivery. The
documented reason — a legitimately named new project reads as unsourced — is real, and the
remedy chosen for it was to switch the gate off rather than to give it the second provenance
source it needed. `design.project` holds exactly the names the pipeline invented for itself.

**Four scope holes, each a route on its own:**

1. `contactAudit` and `properNounAudit` run on `narrative` only (`index.ts:1691,1698`).
   `concept_note`, `workplan`, `logframe` and `budget_justification` (`:1653-1657`) are
   delivered and are **never checked at all**.
2. The `check` stage rewrites the narrative *after* `validate`, up to twice, under
   *"rephrase aggressively"* (`index.ts:1856-1863`). Neither audit nor the Claim Ledger runs
   again on the result. Every check described above can be passed and then invalidated.
3. The `revise` stage re-runs the Claim Ledger but **not** `contactAudit`
   (`index.ts:1812-1822`). A customer revision can introduce an invented telephone number
   with no deterministic check anywhere in the path.
4. `delivery_gate.ts` never imports `contactAudit`. The intended last gate before the file is
   sent does not ask whether the document states a contact detail no evidence carries.

---

## What I tried that did NOT work

Reported so the pass claims are worth something:

- **Making the audit credit a fabrication as the applicant's own name.** The two-way
  `pnOverlap` at `:137` is deliberately generous about self-naming; I could not turn that into
  a route for a *third-party* fabrication, because the applicant-name keys are built from the
  order form, not the document.
- **Defeating the email check.** `EMAIL` (`:43`) is unanchored and global, so it fires inside
  table cells and headings where the labelled path cannot reach. `grants@mashghal-community.org`
  in a table row was the one fabrication in my composite document that got caught. Email is
  the only contact shape with real coverage.
- **Defeating the IBAN check.** `IBAN` (`:44`) is likewise unanchored and caught
  `LB62 0999 0000 0001 0019 0122 9114`. It fails only via the route-3 substring collision,
  which needs a long digit run in the ledger.
- **Slipping a long fabricated value past the 48-character value cap.** The cap truncates but
  the leading fragment is still extracted and still compared, so a long address does not
  escape by length — it escapes because `address` is not a label the check knows.
- **Getting `used` to over-count via the applicant's own name.** Blocked correctly: `:137`
  excludes it in both directions.

## Auditing my own audit

The standing rule is to correct measurements before reporting them, so:

- My first pass was about to report that `Tripoli Chamber of Commerce` is credited like the
  other invented entities. It is **not** — it is flagged. The reason is not that the check
  works; it is that `Tripoli` never became a ledger referent at all (route 9). Crediting is
  driven by *which ledger nouns survived extraction*, so the behaviour looks inconsistent from
  outside. I re-ran with the ledger noun list dumped (`probe6.ts`) before writing route 8.
- I nearly asserted in the test that the correct `ledger_offers` for this ledger is 3. It is
  not: the true count is 5 (Lebanese Ministry of Interior, Tripoli, Lebanon, Bab al-Tabbaneh,
  Qobbe), and the audit also returns 5 — by coincidence, one phantom in and one real referent
  out. The assertion was replaced with a direct one that does not depend on that arithmetic.
- The email and IBAN results above were originally in my miss column. They are catches, and
  they are reported as catches.

---

## Artefacts

| file | what it is |
| --- | --- |
| `/home/user/ktebli/tests/adversarial/fabricated_identity_test.ts` | the failing test. **31 of 33 assertions FAIL** against HEAD; `tests/contact-claims/` and `tests/proper-nouns/` are both green at HEAD. `npx --yes deno@2.9.5 check` passes. Deliberately not added to `tests/run-all.sh`, which is another agent's file and would go red. |
| `…/scratchpad/qloop/unblocked/patch-fabricated-identity.md` | patch spec, P1–P9, exact anchors and replacements |
| `…/scratchpad/qloop/unblocked/probe1..10.ts` | the probes, runnable with `--allow-read` |

Reproduce:

```
cd /home/user/ktebli
npx --yes deno@2.9.5 run --allow-read tests/adversarial/fabricated_identity_test.ts   # exit 1
npx --yes deno@2.9.5 run --allow-read tests/contact-claims/contact_claims_test.ts     # exit 0
npx --yes deno@2.9.5 run --allow-read tests/proper-nouns/proper_nouns_test.ts         # exit 0
```

The two existing suites passing while 31 adversarial assertions fail is the whole finding in
one line: **these checks were written against the one failure that was observed, and they
enforce that one failure's syntax rather than the invariant.**

## Should anything be removed?

No stage should be removed, but one claim should be. `contact_claims.ts` and `proper_nouns.ts`
are currently load-bearing in the launch narrative — `reports/referent-ladder.md` §4 reports
*"No fabricated contact details anywhere — zero across all twelve"* and treats it as a
property of the pipeline. On this evidence that number measures the checker's coverage, not the
generator's honesty: the ladder fixture supplied contact fields (the report says so itself),
and a run where they had been invented in any of the twelve shapes above would have returned
zero as well. Until P1–P3 land, **§4 of the referent ladder should not be cited as evidence
that fabricated contact details do not occur.** The unsourced-name counts in §3 of the same
report are subject to routes 5–8 and are floors, not counts.
