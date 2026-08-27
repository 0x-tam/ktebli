# The referent ladder — partial result

**Date:** 2026-08-26 · **Status:** BLOCKED before judgement. Generation done, critics refused.

## What happened

The ladder was built and 12 of 20 documents generated. **Every critic call was refused** with
`HTTP 403 Key limit exceeded (total limit)`. Verified independently, twice, including with a
16-token liveness probe: the OpenRouter **API key's own spend cap** is exhausted at $15.76 while
the account still holds $14.24 of credit. It is a per-key cap, not a balance.

So there is **no fundability judgement at any rung**, and the question the ladder exists to
answer — does fundability rise with referent count, or with referent specificity, or with
neither — **is not answered**. The rungs `n12` and `n06thin` were never generated, so the
specificity axis does not exist yet either.

The sub-agents were asked not to substitute their own opinion for a missing critic verdict, and
did not. Their structured results carry explicit `NO CRITIC VERDICT` markers where a judgement
would otherwise sit. Do not read the absence of a result as a passing result.

## What the run does establish, deterministically

Measured with the repo's own counters — `properNounAudit`, `contactAudit`, and `wc`-equivalent
word counts. No model was asked to count anything.

| rung | ledger offers | arm | words | over 1,200 limit | ledger referents used | unsourced names | fabricated contacts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| n03 | 7 | A pipeline+flash | 1578 | **+378** | 5 | 8 | 0 |
| n03 | 7 | B pipeline+opus | 1605 | **+405** | 5 | 3 | 0 |
| n03 | 7 | C single+flash | 2253 | **+1053** | 5 | 11 | 0 |
| n03 | 7 | D single+opus | 1427 | **+227** | 5 | 1 | 0 |
| n06 | 10 | A | 1461 | **+261** | 8 | 13 | 0 |
| n06 | 10 | B | 1520 | **+320** | 8 | 1 | 0 |
| n06 | 10 | C | 1974 | **+774** | 8 | 5 | 0 |
| n06 | 10 | D | 1467 | **+267** | 8 | 1 | 0 |
| n09 | 13 | A | 2075 | **+875** | 11 | 13 | 0 |
| n09 | 13 | B | 1463 | **+263** | 10 | 6 | 0 |
| n09 | 13 | C | 1989 | **+789** | 11 | 17 | 0 |
| n09 | 13 | D | 1690 | **+490** | 11 | 1 | 0 |

### 1. Referent use scales with the ledger, tightly and predictably

Ledger offers 7 → 10 → 13. Referents used: **5 → 8 → 11**, in every arm, almost without variance.
That is 71%, 80%, 82% of what was available, and it holds across both modes and both generators.

**More referents in, more referents out.** The generator is not ignoring its evidence and is not
saturating at three or four. Whether that converts into a fundable document is exactly the part
the refused critics were supposed to say, so this is half a finding, not a whole one — but it is
the half that had been assumed rather than measured, and it holds.

### 2. RETRACTED — the word-limit finding was my own measurement error

> The section below originally reported **12 of 12 documents over the word limit** and, with
> iteration 1's 7 of 8, concluded that **19 of 20 across two independent setups is not an
> artefact** and that the artefact reading was withdrawn. **That was wrong, and the error was
> mine.**
>
> I counted the whole markdown file. Both fixtures state the rule in terms: *"Answer the five
> questions below in order… The five answers together must not exceed 1,400 words"*, with *"a
> one-page budget table must be **attached**"* and the declaration separate. The budget table and
> the declaration are not part of the five answers, and I counted them.
>
> Recounted against the donor's actual rule, all sixteen documents:
>
> | | over the limit | compliant |
> | --- | --- | --- |
> | **pipeline arms (A, B)** | **0 of 8** | **8 of 8** |
> | single-prompt arms (C, D) | 4 of 8 | 4 of 8 |
>
> **Every pipeline document is compliant. Every overrun is a single-prompt baseline** — which is
> precisely what the launch-readiness report said in the first place: the naive baseline blew a
> hard limit by 42% on its first try and Ktebli has never shipped over one. Compliance is intact
> and it is still a real differentiator. The claim that Ktebli's last advantage over a naive
> baseline was gone is withdrawn in full.
>
> A separate finding, from the same recount, is in section 2b and is not withdrawn.

### 2b. The pipeline writes at half length, because it counts the wrong text

`wordCount()` counts the whole markdown document and `contentViolations()` compares that against
the donor's limit. So the worker makes the same error I did — and then acts on it. A compliant
document reads as over-length, and the correction loop instructs the generator to *"cut at least
N words"* from prose that never needed cutting.

Measured across all sixteen documents, as a share of the words the donor allowed:

| arm | words used |
| --- | --- |
| A pipeline + flash | 43–67% |
| B pipeline + opus | 59–70% |
| C single + flash | 73–120% |
| D single + opus | 94–113% |

**The pipeline spends less than half its allowance on four of eight documents.** A proposal using
43% of the room it had has thrown away more than half the space available to be specific in — and
thin, generic prose is the headline quality complaint against this product. This is not the only
cause of that, and it is not proven to be a large one, but it is mechanical, it is measurable, and
it is cheap to remove.

Fixed in `worker/word_limit.ts`: the counted span is read from the donor's own guidelines and
defaults to the whole document, so it can only ever narrow when the donor says attachments sit
outside the limit — never the other way round, because invariant 5 runs one way.

### Original section 2, as written, now superseded

Iteration 1 saw seven of eight and read it as a replay artefact. This is a different fixture, a
different grant, a different generator mix, and it is **12 of 12**, from +227 to +1053.

That makes "replay artefact" substantially less plausible. It is still a replay, so it is still
not the real end-to-end run that would settle it — but the launch instruction is explicit that
if the breaks are real, the last differentiator Ktebli holds over a naive baseline is gone and
it is a launch blocker rather than a footnote. **This now needs the live run to resolve, and it
should be treated as suspected-real rather than assumed-artefact.**

One nuance the table shows plainly: the single-prompt arm at the current generator (C) is by far
the worst offender at every rung (+1053, +774, +789), which matches the launch-readiness finding
that the naive baseline blew a hard limit by 42% on its first try. The pipeline arms are over
too, which is the new and unwelcome part.

### 3. The stronger generator invents fewer unsupported names

Unsourced multi-word names, by arm across all rungs: **B: 3, 1, 6** and **D: 1, 1, 1**, against
**A: 8, 13, 13** and **C: 11, 5, 17**. The opus arms are consistently an order of magnitude
lower.

That is an independent, deterministic argument for the variant-B default that was chosen on
blind ranking alone — different measurement, same direction.

### 4. No fabricated contact details anywhere

Zero across all twelve, using the check built after the pipeline was caught inventing a
telephone number on the earlier benchmark. The fixture supplies contact fields, which is
precisely the condition under which that failure does not occur.

## What this does not establish

- **Nothing about fundability.** No critic judged any document.
- **Nothing about specificity versus count.** `n06thin` was never generated.
- **Nothing about the top of the curve.** `n12` was never generated.
- One synthetic organisation, one grant, one replay. The fixture is a synthetic small nonprofit
  (`ladder/fixture-README.md`), chosen because the twelve real UK Youth facts are unrecoverable
  and building them would mean inventing facts about a real charity.

## To finish this

Raise the API key's total spend cap. The packets are preserved byte-for-byte with their
blinding mappings, so the ten refused critic calls can be replayed unchanged — roughly $10 —
and `n12` and `n06thin` generated for about $5 more.

Until then the sufficiency gate's threshold stays where it is: in one place, marked provisional,
with the ladder named as the input that sets it.
