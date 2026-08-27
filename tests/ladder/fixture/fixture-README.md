# Ladder fixture — SYNTHETIC

Files: `org.json`, `grant.json`, `ledger-n03.json`, `ledger-n06.json`, `ledger-n09.json`,
`ledger-n12.json`, `ledger-n06thin.json`. Built by `build.py`, counted by `verify.ts`,
counter output preserved verbatim in `verify-output.txt`.

## 1. The organisation is synthetic, and why

**Halewater Commons Trust does not exist.** Neither does the town of Kelverton, the wards
Marlpit and Ferry Bank, Dunmore Sixth Form College, St Aidan's Parish Hall, Wharfside
Boathouse, Barrowfield Youth Justice Team, Northgate Minibus Hire, Redgate Catering, Priya
Raval, Delroy Ferguson, the Second Chances course, the Night Kitchen course, the Wren Hill
Foundation or the Neighbourhood Futures Fund. Every number and date in every ledger is
invented for this fixture. The domain `halewatercommons.org.uk` is part of the fixture and
must not be crawled, resolved or cited as a source. The registered charity number is
deliberately left uninstantiated, because a realistic-looking number could collide with a
real entry on a real register.

The experiment was originally specified to draw referent counts of 3/6/9/12 from the crawled
UK Youth evidence set. **That set is not recoverable.** `reports/` and the state document
record only three of the twelve crawled facts (founded 1911; a ~9,000-organisation network;
"named corporate partnerships with figures", values unrecorded). The other nine survive only
as category labels — see `case-ukyouth.json`, where they appear as `UNKNOWN` placeholders.
Building a 12-referent rung for a real named charity out of a record of three would mean
inventing facts about a real organisation. So the applicant is synthetic instead.

Two things are gained by that, beyond avoiding the fabrication:

- A six-staff community organisation in two neighbourhoods is closer to Ktebli's actual buyer
  than a national federation founded in 1911.
- Referent count becomes an exactly controllable variable rather than an artefact of what a
  crawler happened to find.

## 2. What counts as a named referent

A named referent is one of six kinds: a place below city level, a venue, a vendor, a named
person with a role, a named partner organisation, or a prior result with a date attached.
The twelve are two of each kind.

## 3. How the count was made — deterministically, by the repo's own counter

No model counted anything (CLAUDE.md: language models cannot count). `verify.ts` imports
`properNouns()` from `supabase/functions/worker/proper_nouns.ts` — the extractor the worker's
own specificity audit uses — and applies it as follows:

1. The `fixture-meta` item (element 0 of each array) is excluded entirely. It is metadata, not
   evidence. Any packet builder must filter on `source == "fixture-meta"`.
2. **Constant set** = `properNouns()` over the items with `referent_kind == "none"` — the
   eight-item identity block, which is byte-identical in all five ledgers. It resolves to
   exactly five strings: `England`, `GBP`, `Halewater Commons`, `Kelverton`, `United Kingdom`.
   These are the applicant's own identity and its currency; they are not named referents, and
   because the block is identical everywhere they cannot contribute to any difference between
   rungs.
3. **Referent count** = size of `properNouns()` over the remaining items, minus the constant set.

The identity block was rewritten once during the build because the counter disagreed with
intent: `GBP 214,000` sat immediately after a colon in the constant block, and `properNouns()`
treats `:` as a sentence boundary and drops the first word after it — so `GBP` was not captured
as a constant, and it then scored as a 7th referent in n06. The **ledger was rephrased, not the
counter**, and the count came back to 6.

Verified counts (from `verify-output.txt`, matching the `named referents in this ledger: N`
line each file declares):

| ledger | arm | referent count | declared | match |
|---|---|---|---|---|
| `ledger-n03.json` | count axis, specific | **3** | 3 | yes |
| `ledger-n06.json` | count axis, specific — *and* the SPECIFIC arm of the specificity axis | **6** | 6 | yes |
| `ledger-n09.json` | count axis, specific | **9** | 9 | yes |
| `ledger-n12.json` | count axis, specific | **12** | 12 | yes |
| `ledger-n06thin.json` | specificity axis, THIN arm | **6** | 6 | yes |

## 4. The superset relation

`n03 ⊂ n06 ⊂ n09 ⊂ n12`, strictly, and the ledger *items* are byte-identical between rungs, not
merely equivalent: `ledger-n06.json` is `ledger-n03.json` with three items appended. `verify.ts`
asserts the subset relation on the extracted noun sets and reports the deltas: **+3, +3, +3**.

The added blocks are kind-balanced so the profile does not drift as the count rises:

- `E-WEB-1..3` (n03): place, partner, dated result — Marlpit, Dunmore Sixth Form College, Second Chances
- `E-WEB-4..6` (→ n06): venue, person, vendor — St Aidan's Parish Hall, Priya Raval, Northgate Minibus Hire
- `E-WEB-7..9` (→ n09): place, partner, venue — Ferry Bank, Barrowfield Youth Justice Team, Wharfside Boathouse
- `E-WEB-10..12` (→ n12): person, vendor, dated result — Delroy Ferguson, Redgate Catering, Night Kitchen

n06 therefore carries exactly one referent of each of the six kinds, and n12 exactly two.

## 5. The specificity axis

Count is held at 6 and **the six names are the same six strings**. `verify.ts` asserts that the
extracted name sets of `n06` and `n06thin` are identical. Only the surrounding matter differs:

- **n06 (specific)** — every referent fact carries the name *and* a date or a number *and* a
  place. Example: "Transport to off-site activity is bought from Northgate Minibus Hire at GBP
  95 a trip; 14 trips ran between April 2024 and March 2025, every one of them picking up in
  Marlpit."
- **n06thin (thin)** — the same name, with every date, number, price, role and place anchor
  removed. Example: "The organisation has used a supplier called Northgate Minibus Hire."

So the thin arm is not a different ledger with different referents. It is the specific arm with
the detail stripped, which is what makes count and specificity separable.

## 6. What a reader may NOT conclude from this fixture

- **Nothing about any real organisation.** No fact here is evidence about UK Youth, about any
  charity, college, firm or person, or about any funder. If a downstream narrative names a real
  body, that is fabrication and the fixture did not supply it.
- **Nothing generalisable from n = 1 organisation.** One synthetic applicant, one synthetic
  grant, one sector (UK community youth work), one language, one funder style. Any effect
  measured across the rungs is an effect *for this applicant on this call*. It cannot be
  reported as "referent count drives quality" — only as "on this fixture, varying referent
  count from 3 to 12 moved the measured scores by X". Confounds with organisation type, sector,
  country, call structure and word limit are entirely uncontrolled, because there is only one
  of each.
- **No dose–response curve from four points.** Four rungs on one organisation cannot establish
  monotonicity, a threshold, or a saturation point. They can show a direction, or fail to.
- **No claim that the synthetic ledger resembles a real crawl.** These twelve facts are cleanly
  written and mutually consistent. A real crawl of a real small-charity site returns messier,
  partially contradictory, differently-dated material — and on some real sites (the report
  records thefelixproject.org) returns nothing at all. An effect that depends on the ledger
  being tidy will not survive contact with the crawler.
- **Nothing about whether an expanded intake can actually obtain facts of this kind.** The
  fixture assumes the evidence exists. Whether an automated pre-payment interview can extract
  it from a real applicant is a separate, untested question.
