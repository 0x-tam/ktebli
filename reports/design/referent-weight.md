# Referent weight — what a named referent is actually doing in a document

**Date:** 2026-08-27 · **Status:** measure built, calibrated, and **NOT adopted as a gate**.
**Headline:** on the only fundability data that exists, referent **count** predicts the blind
ranking better than any weight statistic I built. Weight is not yet evidence for anything about
fundability. It *is* a good extractor and it produced three findings that do not depend on
fundability at all.

Blocked this session and marked so throughout: **no model call was made** (OpenRouter key returns
HTTP 403 "Key limit exceeded (total limit)") and **no host was fetched**. Every number below comes
from code run over files already on disk.

Deliverables:

- `/home/user/ktebli/supabase/functions/worker/referent_weight.ts` — 716 lines, pure, typechecks
  under `npx --yes deno@2.9.5 check`.
- `/home/user/ktebli/tests/referent-weight/referent_weight_test.ts` — 61 checks, all passing under
  `npx --yes deno@2.9.5 run --allow-read tests/referent-weight/referent_weight_test.ts`. Eight
  cases, seven built from verbatim excerpts of real corpus documents, six of them regressions on
  defects this module had in its first pass.

---

## 1. What is measured

For each ledger-backed referent, every mention is located and six things are recorded.

| signal | how it is decided | kept? |
| --- | --- | --- |
| **position** | the mention's block: prose / list item / table cell / `Label: value` field / identification-or-declaration section / heading | **kept**, and decisive |
| **grammatical role** | subject · counterparty · genitive · adjunct · listing | **kept** |
| **load** | the sentence also carries a number, a date, or a causal connective | **kept, weak** |
| **recurrence** | mentions per referent | **kept, but demoted** — see §4 |
| **distribution** | distinct sections the referent reaches, as a capped multiplier | **kept, weak** |
| **removability (the swap test)** | does the sentence still assert everything with the name replaced by a generic placeholder | **kept, and it is the sharp one** |

### The swap test, operationalised

A mention **survives the swap** — is decorative — unless one of four things holds:

1. **subject** — the placeholder becomes the actor and the sentence stops saying who acts;
2. **counterparty** — an external party who must sign, agree, refer, host, supply, fund or
   receive; a commitment with an anonymous counterparty is not a commitment;
3. **contrastive** — the sentence distinguishes this referent from another named one
   (`one in Bab al-Tabbaneh, one in Qobbe`); one shared placeholder collapses it into nonsense;
4. **genitive possessing a figure or a date** — the number is predicated of *this* place.

Everything else survives. `we work in X`, `residents of X`, `across X and Y` all remain true
sentences with "the neighbourhood" substituted. That is what a swappable proposal looks like, and
across the 20-document corpus it is **85% of all mentions**.

### What I rejected, and why

- **A model call of any kind.** Not merely because the key is dead: a quality measure that calls a
  model can be prompt-injected by the applicant text it is scoring, fails open when the provider is
  down, and CLAUDE.md is explicit that models cannot count.
- **Counting mentions in the identification block.** Every one of the four evidence-poor documents
  names its neighbourhood in the address field, because the donor's Section 1 demands an address.
  It cannot discriminate, and it was where the *worst* document got half its mentions. Weighted 0.
- **Sentence-level "load" as a strong signal.** It fires on almost everything. In the
  evidence-poor corpus, 15 of 24 weighted mentions sit in a sentence carrying a number, and the
  document the critics ranked LAST has the highest rate of it (1 of 1). It survives as a small
  additive bonus and nothing rests on it.
- **Total recurrence as the aggregate.** Rejected on evidence — §4. Summing mention weights makes
  the measure a dressed-up mention count, and the mention count is wrong.
- **A "reads generic" lexicon** (boilerplate phrase lists). Not tried. `reports/quality-iteration-1.md`
  E-1 established that supplying the vocabulary of a failure to an instrument makes the instrument
  return that vocabulary. A hand-written banned-phrase list is the deterministic version of the
  same mistake.

---

## 2. Calibration A — against the critics' own referent counts: **4 of 4 exact**

`reports/quality-iteration-1.md` §4: on the `evidence-poor` case both critic families independently
returned identical counts **and identical names**.

| document | true arm | critics said | critics named | this measure found |
| --- | --- | --- | --- | --- |
| Doc 1 | **B** | 3 | Bab al-Tabbaneh; Qobbe; Municipality of Tripoli | **3** — the same three |
| Doc 2 | **D** | 2 | Bab al-Tabbaneh; Qobbe | **2** — the same two |
| Doc 3 | **A** | 1 | Bab al-Tabbaneh | **1** — the same one |
| Doc 4 | **C** | 2 | Bab al-Tabbaneh; Qobbe | **2** — the same two |

Exact agreement on the count and on which names, on all four documents. That is the extraction
half working. Getting there took four corrections to my own code — §6.

On the `ukyouth` case both critics returned **0 for all four documents**. This measure returns 0
weight and 0 present for all four when given the ledger's own referents, because
`properNounAudit` reports that ledger offers nothing usable (`used = 0` or `1` of `3`; its twelve
`E-WEB` items are all `UNKNOWN`). **The ukyouth case cannot calibrate a referent measure at all**,
and its ranking is driven by something else — the last-placed document carried 35 `[INSERT: …]`
placeholders. Recorded as uninformative, not as a pass.

---

## 3. Calibration B — against the blind rankings: **weight loses to count**

The blind ranking on `evidence-poor` is **B > D > C > A**, produced independently and identically
by `openai/gpt-5.6-sol` and `x-ai/grok-4.6`. It is the only fundability ordering that exists over
documents with a non-zero referent count.

| arm | blind rank | critic count | referents present | load-bearing referents | weighted mentions | **document weight** |
| --- | --- | --- | --- | --- | --- | --- |
| B | **1** | 3 | 3 | 1 | 7 | 10.6 |
| D | **2** | 2 | 2 | 0 | 6 | 10.8 |
| C | **3** | 2 | 2 | 2 | 10 | **17.4** |
| A | **4** | 1 | 1 | 0 | 1 | 1.3 |

Kendall τ-b against the blind ranking, n = 4:

| statistic | τ-b |
| --- | --- |
| **referent count** (the existing measure) | **0.913** |
| counterparty referents (one sub-signal of weight) | 0.707 |
| weighted mentions | 0.333 |
| load-bearing referents | 0.183 |
| **document weight (the thing I built)** | **0.000** |

**Total weight is at chance.** It puts the third-ranked document first, because C repeats the same
two names ten times in adjunct position and the aggregate rewards volume. Count is very nearly
perfect. **On the data available, weight is not more predictive than count; it is less.**

### The one thing weight got right, and how much it is worth

The single sub-signal that isolates the winner is **counterparty**: B is the only document in which
any named referent is a party to a commitment (`Sign written arrangement with the Municipality of
Tripoli`; `the rota … pass to the Municipality of Tripoli`; `Municipality does not lift reliably`).
Both critics named exactly that as the reason the others fell below it — critic_b on Doc 2:
*"no municipal lift agreement is signed into the workplan"*; on Doc 4: *"no municipal counterpart"*.

So a deterministic signal reproduced, in the right document, the prose reason two independent
critics gave. That is worth something. It is worth **one document out of four**, on **one case**,
against a baseline that already scores 0.913. It is not a result. τ-b for that signal alone is
0.707, still below count.

### Honest statement, as required

**The data cannot tell whether weight beats count, and what it can tell points the other way.**
Four documents, one usable ordering, one tie in the baseline to break — that is roughly one bit of
discriminating information, and weight spends it wrongly. The comparison is additionally rigged in
count's favour by accident: on this case the referent counts (3/2/2/1) happen to be nearly a
perfect proxy for rank. A fair test needs a blind ranking over documents whose referent **counts
are equal** and whose **use** differs. That experiment does not exist. `ladder/n06thin` was
specified to be exactly it and was never generated.

**Therefore: do not change `worker/sufficiency.ts`.** `activeScorer()` (sufficiency.ts:504-506)
must stay on `countScorer`, and `SUFFICIENCY_THRESHOLD.ladderStatus` must stay `"pending"`
(sufficiency.ts:111-115). Nothing here licenses moving it to `specificityScorer`.

There is also a category error worth naming: **the sufficiency gate scores the pre-payment ledger,
and referent weight scores a finished narrative.** They are different objects. Weight cannot be
read from an intake form, because no document exists yet. Even a validated weight measure would
belong in `validate`, not in the pre-payment gate.

---

## 4. What weight *does* establish — no critic required

Running the measure over the 12 ladder documents, whose referent supply is a controlled variable.

| rung | designed referents offered | **present** | load-bearing referents | load-bearing mentions | mentions that survive the swap |
| --- | --- | --- | --- | --- | --- |
| n03 | 3 | **3.00** (100%) | 2.00 | 5.25 | 80% |
| n06 | 6 | **5.75** (96%) | 2.50 | 4.00 | 90% |
| n09 | 9 | **8.75** (97%) | 4.25 | 9.25 | 84% |

Role of every weighted mention across all 12 documents: **adjunct 336 · listing 85 · counterparty
45 · subject 26 · genitive 2** (n = 494). Two thirds of every named reference is the object of a
preposition.

### 4a. CORRECTION to `reports/referent-ladder.md` §1 — usage is ~100%, not 71/80/82%

The ladder reported "ledger offers 7 / 10 / 13 → 5 / 8 / 11 used", i.e. 71% / 80% / 82%, and read
the shortfall as headroom. I reproduced those exact numbers with `properNounAudit` (7/5, 10/8,
13/11 across all twelve documents — the published table replicates byte for byte), and then
decomposed them. The denominator is not what it looks like:

- the fixture *designs* 3 / 6 / 9 referents (`ledger-nNN.json`, `E-META-0`: `named referents in
  this ledger: N`); the extra four are `Kelverton`, `England`, `United Kingdom` and
  **`Halewater Commons`** — a fragment of the applicant's own legal name;
- `Halewater Commons` is the applicant naming itself and should never have been in the denominator.
  It is there because of a live bug — §5, patch spec 1;
- `United Kingdom` is never used by any document in any arm. No proposal writes its own country
  into a UK application;
- **all 3 / 6 / 9 designed referents are used, in 34 of 36 document-referent slots.** The two
  misses are `Northgate Minibus Hire` (n06-B) and `Wharfside Boathouse` (n09-B).

So the generator consumes **essentially all** of the particular evidence it is handed, at every
rung. The ladder's own conclusion — "the generator is not starved" — is *stronger* than the ladder
stated, not weaker.

### 4b. The thing that does not scale is the WORK

Presence scales 1 : 1 with supply. Load-bearing referents do not: 2.00 → 2.50 → 4.25 against an
offer of 3 → 6 → 9, i.e. **67% → 42% → 47%** of what is on offer. The load-bearing *share of
mentions* is flat and noisy at 10–20% with no trend.

**Tripling the referent supply triples the decoration and does not triple the load-bearing use.**

This is the operator's reading, measured. It bears directly on CLAUDE.md "Decisions taken
(2026-08-26)" item 1 — expanding the intake into an evidence interview. That decision is aimed at
referent **supply**, and supply is already being fully consumed at every rung tested. It does not
refute the decision (a richer ledger still permits claims that today's ledger forbids, and §4c is
a case in point) but it does say plainly: **more names in the ledger will not by itself produce
names that carry the argument.** The intervention that would is a generation-side one — require
each ledger referent to appear at least once as a subject or a counterparty — and it is testable
without spending any intake budget.

### 4c. The load-bearing referent in the winning document is UNSOURCED

`Municipality of Tripoli` — the one referent this measure calls load-bearing in the top-ranked
document, and the one both critics named as the difference — **is not in the ledger**.
`properNounAudit(out-evidence-poor-B.md, …)` reports it under `unsourced`, alongside `Block Rota`.
The ledger carries `one municipal in-kind contribution` (E-INTAKE-7) and never names a municipality.

Under invariant 3 the deployed pipeline could not have written those three sentences. Measured with
the ledger-derived referent set instead of the critic-named one, document B has **zero**
load-bearing referents.

This is not an argument for relaxing invariant 3. It is a precise statement of the cost: the
highest-value referent in the best document in the corpus is one an honest pipeline must refuse to
write, and the intake does not collect it. "Who is the counterparty for each commitment you are
making, and what is their name?" is a question the evidence interview can ask and today does not.

---

## 5. Patch specs (I did not apply these — `proper_nouns.ts` is not mine to edit)

Both are live defects in `supabase/functions/worker/proper_nouns.ts`, both found by checking my
output against the critics' counts, both reproduced in isolation.

### Patch 1 — the applicant's own name is counted as a ledger referent

Reproduction:

```
properNouns("Halewater Commons Trust")                       -> ["Commons"]
properNouns("The applicant is Halewater Commons Trust (…).") -> ["Halewater Commons"]
properNounAudit("Halewater Commons runs youth sessions.",
                [{claim:"The applicant is Halewater Commons Trust (…)."}],
                "Halewater Commons Trust")
  -> {"ledger_offers":1,"used":0,…}
```

`ledger_offers` should be 0. Cause: `properNouns()` drops the first word of a run that opens a
sentence, so the own-name side yields the fragment `Commons`; `PN_STOP` trims the trailing `Trust`
on the ledger side, yielding `Halewater Commons`. The two never match, and the deletion at line 122
is by exact normalised string. Effect: the denominator of the specificity finding is inflated by one
on every order whose ledger states the legal name in a sentence, and the numerator is not — which
is precisely the direction that produced the ladder's understated 71/80/82%.

**Anchor** — `supabase/functions/worker/proper_nouns.ts:120-122`:

```ts
  const own = new Set<string>();
  for (const p of properNouns(applicantName || "")) own.add(normPN(p));
  for (const k of own) ledgerNouns.delete(k);
```

**Replacement:**

```ts
  // The applicant's own name must be read the way it appears in prose, not as a
  // bare fragment: `properNouns()` drops the first word of a run that opens a
  // sentence, so `properNouns("Halewater Commons Trust")` returns ["Commons"],
  // while the ledger's own "The applicant is Halewater Commons Trust" yields
  // "Halewater Commons" — and the two never match, so the applicant's own name is
  // counted as a ledger-supplied named referent. Read it behind a neutral stem,
  // keep the raw normalisation too, and delete by referent IDENTITY rather than by
  // exact string, so word order and a trimmed suffix cannot defeat it.
  const own = new Set<string>();
  for (const p of properNouns("Recorded on the order form " + String(applicantName ?? ""))) {
    own.add(normPN(p));
  }
  if (applicantName) own.add(normPN(applicantName));
  const ownKeys = [...own].map((k) => pnKey(k));
  for (const k of [...ledgerNouns.keys()]) {
    const kk = pnKey(k);
    if (own.has(k) || ownKeys.some((o) => pnOverlap(kk, o))) ledgerNouns.delete(k);
  }
```

`pnKey` and `pnOverlap` are already module-private in the same file (lines 84-96). The later
`const ownKeys = [...own].map((k) => pnKey(k));` at line 128 must be renamed or reuse this one —
it currently shadows nothing, so the simplest edit is to delete the line-128 declaration and let
this one serve both.

**Why it cannot loosen anything:** it can only ever *remove* items from `ledgerNouns`, which
*lowers* `ledger_offers`, which makes the specificity finding fire *less* often. It never adds a
referent and never suppresses an `unsourced` report.

### Patch 2 — a capitalised run reads across two ledger items

The ledger is joined with a bare `"\n"` and the capitalised-run regex treats `\n` as ordinary
whitespace, so `Organisation name: Mashghal Community Association` followed by
`Registration number: …` produces the phantom referent `Community Association Registration`. On the
evidence-poor ledger this inflates `ledger_offers` from 4 to 5.

**Anchor** — `supabase/functions/worker/proper_nouns.ts:111-113`:

```ts
  const ledgerText = ledger
    .map((e) => String(e.claim ?? "").replace(/\bE-(?:INTAKE|WEB|PROP)-\d+\b/g, " "))
    .join("\n");
```

**Replacement:** change the final line only, to

```ts
    // Terminate each item. Joined with a bare newline, the capitalised-run regex
    // treats "\n" as ordinary whitespace and reads straight across two ledger
    // items: "…Mashghal Community Association" + "Registration number: …" yields
    // the phantom referent "Community Association Registration".
    .join(".\n");
```

Both patches are already applied to the equivalent code inside `referent_weight.ts`'s own
`ledgerReferents()` helper (which exists only because `proper_nouns.ts` does not export its ledger
pass — a third, cosmetic patch would be to export it and delete the duplicate).

---

## 6. Auditing the auditor

Six defects in my own code, all found by checking output against the corpus and the critics rather
than by reading the source. Each is now a named regression test.

1. **`Direct:` read as a form field.** `FIELD_LINE` matched any line opening `Label:`, so
   `out-evidence-poor-D.md:41` — `Direct: 12 young people out of work from Bab al-Tabbaneh and
   Qobbe, paid for clean-up shifts…` — was zeroed as an address field. D lost its entire
   beneficiary claim. Fixed with a length cap and a single-sentence requirement.
2. **Contrast fired on `each week`.** The contrast test ran over the whole sentence and matched
   `each` in *"two organised clean-up rounds each week … in Bab al-Tabbaneh and Qobbe"*. Fixed to
   require the cue within 26 characters immediately before the name.
3. **The same test then fired on nothing at all**, because `[^A-Z]` under the `/i` flag also
   excludes lowercase letters — so `(one in Bab al-Tabbaneh, one in Qobbe)`, the only genuine
   contrast in the corpus, was silently missed. Fixed by dropping the flag.
4. **`Municipality of Tripoli` shrank to `Tripoli`.** The span-alignment step used a symmetric
   containment test and re-attributed a counterparty mention to a different offered referent.
5. **`Lebanese host residents` counted as the Ministry of Interior**, four times in one document,
   one of them scored as a load-bearing subject. A bare partial name in front of a lowercase word
   is an attributive adjective. Fixed, then fixed again: the first escape clause used the full
   finite-verb list, which contains `host`.
6. **The bare city name `Tripoli` in an address line counted as the Municipality of Tripoli**,
   giving the bottom-ranked document two referents where both critics counted one. Fixed by
   requiring a partial match to retain the referent's leading token.

**The number I nearly published.** Before fix 1 and fix 6, the evidence-poor table read
A = 1 present / weight 1.0 and D = 2 present / weight 5.75 — which would have supported a claim
that the second-ranked document barely uses its referents. It was my segmentation, not the
document. Both are now regression cases 4 and 2 in the test file.

**Known limitations, stated rather than hidden.**

- `Tripoli` (the city) versus `Municipality of Tripoli` (the institution) cannot be told apart by
  any set-based identity rule. The leading-token rule resolves it in the direction that matches the
  critics here; it would resolve `the College` or a bare surname the other way and under-count.
  Under-counting is the safer error for a measure built to detect names doing less work than they
  appear to, and it is documented in the module.
- Role classification is lexical, not parsed. `subject` requires a clause-initial position plus a
  finite verb from a closed list; `counterparty` requires a governing preposition plus a cue verb
  within the same phrase. Both will miss constructions the lists do not carry.
- The measure has **no opinion about whether its input referent list is meaningful**. Fed the
  ukyouth ledger's junk strings (`Kingdom`, `UK Youth'`) it returns confident-looking weights of
  15–36. Deciding what is a referent is `properNounAudit`'s ledger pass, and on that ledger the
  honest answer is "nothing usable".

---

## 7. What I recommend

1. **Do not move the sufficiency gate to weight.** §3. `activeScorer()` stays on `countScorer`;
   `ladderStatus` stays `"pending"`. This is a finding against my own deliverable.
2. **Do not adopt document weight as a threshold anywhere.** It is at chance on the only ranking
   available. The module exports `WEIGHTS` so the scale is inspectable, and its header says in
   terms that no pass mark may be set from it.
3. **Wire it as an observation, not a gate**, at `worker/index.ts:1691` — inside the `validate`
   loop, immediately after `properNounAudit`, whose `ledger_offers`/`used` output already supplies
   the referent list. Record `weight`, `loadBearingReferents` and `decorative` in the events table
   (invariant 9) on every order. Twenty documents is not a sample. Two hundred delivered orders
   with a later fundability signal attached is, and it costs nothing to start collecting now.
   Emit the `NO LOAD-BEARING REFERENT` finding into `detFindings` so the correction loop sees it,
   which is advisory in that loop exactly as the proper-noun findings already are. **Do not make it
   blocking** — a blocking gate calibrated at τ = 0 would refuse fundable documents.
4. **Apply patch specs 1 and 2.** They are unambiguous bugs and both only ever lower a count.
5. **Generate `ladder/n06thin` and re-run the refused critic calls** when the key cap is lifted.
   That is the experiment that can actually answer the question, because it varies use at fixed
   count. Until then the honest position is that this question is open.
6. **Ask the intake for counterparties by name.** §4c. The one referent that carried the argument
   in the best document in the corpus was a named counterparty the ledger did not have.

## 8. Marked MISSING

- **Any fundability judgement on the 12 ladder documents.** All ten critic calls were refused.
  `ladder/critic-*.md` carry explicit `NO CRITIC JUDGEMENT WAS OBTAINED` markers. Nothing in §4 is
  a quality claim.
- **Any fundability judgement at equal referent count.** `n06thin` was never generated.
- **Whether weight predicts fundability at n > 4.** Not measurable from what is on disk.
