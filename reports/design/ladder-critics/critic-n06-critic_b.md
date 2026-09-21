> # THE 2026-08-27 "DECODING CORRECTED" BANNER WAS ITSELF WRONG — WITHDRAWN 2026-08-27
>
> A banner was prepended to this file claiming the packet sent was critic_a's
> (`.prompt-n06-critic_a.txt`, order `BDAC`), and re-decoding the verdict from
> `D > B > C > A` to `B > C > D > A` — which changed the funded document from a
> single-prompt arm to the shipped pipeline default. **That claim does not survive a
> content check and is withdrawn.** The original decoding below, `DCAB`, stands.
>
> The banner reasoned about which packet *was sent*. The decisive question is which
> document the critic actually *read*, and the critic's own quoted arithmetic answers it:
>
> | critic wrote | figure | appears in | under `DCAB` | under `BDAC` |
> | --- | --- | --- | --- | --- |
> | Doc 4's budget states 55,385 and sums to 53,885 | `55,385` | **only `out-n06-B.md`** | Doc 4 = B ✓ | Doc 4 = C ✗ |
> | Doc 1: 38,840 + 4,660 = 43,500 | `38,840` | **only `out-n06-D.md`** | Doc 1 = D ✓ | Doc 1 = B ✗ |
>
> Neither figure occurs in any other arm at this rung. `DCAB` fits both; `BDAC` fits
> neither. Structurally, `.packet-n06-critic_b.txt` decodes to `DCAB` and
> `.prompt-n06-critic_a.txt` to `BDAC` — both self-consistent — so the map files were
> never the problem; the banner simply picked the wrong packet as the one that was read.
>
> Re-runnable: `tests/ladder/bytematch.py`, which derives every packet's permutation from
> the documents and re-checks all eleven fingerprints. The ladder documents and packets
> now live in `tests/ladder/`; they were previously only in a scratch directory.
>
> **Standing result for this cell: ranking `D > B > C > A`, would fund `D`
> (single prompt + stronger generator). Both pipeline arms were judged not fundable.**
> `reports/referent-ladder.md` §1 and §2 already record `DCAB` and need no change.

# Blind critic evaluation — rung n06, critic_b (x-ai/grok-4.6) — REPLAY OBTAINED 2026-08-27

SYNTHETIC FIXTURE. Halewater Commons Trust, Kelverton, Marlpit, St Aidan's Parish Hall,
Dunmore Sixth Form College, Northgate Minibus Hire, Priya Raval, the Wren Hill Foundation and
the Neighbourhood Futures Fund do not exist. Every name, figure and date quoted below is
invented for a test fixture and is not a fact about any real organisation. The domain
halewatercommons.org.uk is part of the fixture and must never be crawled or cited as a source.

Date of original (refused) run: 2026-08-26
Date of replay: 2026-08-27
Rung: n06 (ledger offers 10 referents) · Critic: critic_b = `x-ai/grok-4.6`

## RESULT: OBTAINED. This replaces the refusal placeholder.

The original `HTTP 403 Key limit exceeded` is gone. The call was accepted, generated and
returned in full.

- Generation id: `gen-1787834440-eBxR1TOh7mcsNEHehuj5`
- Provider: xAI · finish_reason `stop` (complete, not truncated)
- native prompt tokens 11,558 · native completion tokens 3,627 (of which 1,994 reasoning)
- **total_cost: USD 0.044686** (from generation metadata, not estimated)
- generation_time: **54,568 ms**

### Why this one landed when the n03 replays did not

Sibling agents lost three paid n03 calls to the MCP server's 60-second ceiling and reasoned,
from billing arithmetic, that grok-4.6 produces ~13k completion tokens on this packet and so
could never fit. That reasoning did not hold here: this call produced 3,627 completion tokens
and finished in 54.6 s — **5.4 s inside the ceiling**. The block is real but it is marginal,
not arithmetically out of reach, and completion length on this task is high-variance. A
prediction of certain failure was made and was wrong; the measurement was worth taking.

Note the margin is thin. A rerun could plausibly fall the other side of 60 s.

## Call parameters

Model `x-ai/grok-4.6`, `reasoning_effort: "low"`, `max_tokens: 8000`, no system prompt (the
programme-officer framing is inside the packet), message = full contents of
`.packet-n06-critic_b.txt` sent verbatim. Exactly one call was made.

## CORRECTION TO THE REPLAY INSTRUCTION — packet path was wrong

The replay task named `.prompt-n06-critic_a.txt` as the packet to send, paired with
`.map-n06-critic_b.txt` as the mapping. **Those do not belong together and sending them as a
pair would have produced a corrupted verdict.**

- `.prompt-n06-critic_a.txt` is critic_a's packet: document order `BDAC`, and a different
  framing preamble and different question wording.
- `.map-n06-critic_b.txt` is `DCAB`.

Decoding a `BDAC` packet with a `DCAB` key mislabels every document. The packet actually
paired with `DCAB` is `.packet-n06-critic_b.txt`, which is self-contained (it carries its own
"WHAT I NEED FROM YOU" section) and is the file this rung's own placeholder named for the
re-run. That file was sent.

A sibling agent hit the identical mismatch on rung n03 and corrected it the same way; this is
a systematic defect in the replay instructions, not a one-off.

## Randomisation mapping — VERIFIED, not assumed

Each blinded document was matched back to its source file by whitespace-normalised
difflib ratio against all four arms. Every one matched its claimed arm at ratio **1.0000**
and no other arm above it.

| Sent as | TRUE arm | Arm meaning | Source file | Match ratio |
|---|---|---|---|---|
| Doc 1 | **D** | single prompt + stronger generator | out-n06-D.md | 1.0000 |
| Doc 2 | **C** | single prompt + current generator | out-n06-C.md | 1.0000 |
| Doc 3 | **A** | pipeline + current generator | out-n06-A.md | 1.0000 |
| Doc 4 | **B** | pipeline + stronger generator | out-n06-B.md | 1.0000 |

Permutation `DCAB`. Blinding leak check over the packet for
`ktebli|pipeline|variant|rung|single prompt`: **0 hits** (one grep match on "arm" is the
funder's phrase "no delivery arm", a false positive).

## DECODED SUMMARY

**Ranking, best first: D > B > C > A.**
**Would fund: D** (single prompt + stronger generator).

| Doc | TRUE arm | fundable | machine-generated | swappable | referents | weakest |
|---|---|---|---|---|---|---|
| 1 | **D** | y | n | n | 11 | thinned continuation |
| 2 | **C** | y (barely) | n | n | 10 | 90 starters unevidenced |
| 3 | **A** | **n** | **y** | **y** | 9 | Q5 does not say who pays |
| 4 | **B** | **n** | n | n | 9 | budget does not add up |

Both pipeline arms (A and B) were judged **not fundable**. Both single-prompt arms (C and D)
were judged fundable, and the one the critic would fund is a single-prompt document. Arm A is
the only document called machine-generated and the only one called swappable.

### Independently confirmed: arm B's budget does not close

The critic's arithmetic was rechecked deterministically in Python rather than taken on trust.
Doc 4 (= arm B, the chosen production default) lists budget lines summing to **53,885** against
a stated subtotal of **55,385** — short by exactly **1,500**. Confirmed. The other three
documents' totals close as the critic said (Doc 1 = D: 38,840 + 4,660 = 43,500; Doc 3 = A:
38,800 + 4,656 = 43,456; Doc 2 = C: 44,310 + 4,200 = 48,510, overhead 9.48%).

This is a live instance of P1 item 7 in CLAUDE.md: the deterministic consistency checker
"never sums anything", and a blind critic caught an internal arithmetic failure that the
pipeline's own validators passed.

## FULL CRITIC REPLY, VERBATIM

The text below is the model's reply exactly as returned. "Doc 1".."Doc 4" are the BLIND labels;
use the mapping table above to decode. Nothing in it has been edited, reordered or de-blinded.

---

**1. Rank (best first): Doc 1, Doc 4, Doc 2, Doc 3.**  
**Fund: Doc 1.** None of the others is a better use of a 25-award round.

---

**2. Per document**

**Doc 1**  
- Fundable as submitted: **y**  
- Reads machine-generated: **n**  
- Swappable: **n**  
- Named referents: **11** — Marlpit; east bank of the river; St Aidan's Parish Hall; Priya Raval (delivery coordinator, in post since 2019, L3); Dunmore Sixth Form College; Northgate Minibus Hire; 46 supper sittings year to March 2025; 27 referred / 18 enrolled 2024–25; Second Chances Jan–Apr 2025 (24/19/11); 14 minibus trips Apr 2024–Mar 2025; hire £40 / trip £95.  
- Weakest: continuation is a *thinned* course (once a year, four trips not eight). Honest, but thin.

**Doc 2**  
- Fundable as submitted: **y** (barely)  
- Reads machine-generated: **n**  
- Swappable: **n**  
- Named referents: **10** — Marlpit; east bank; St Aidan's; Priya Raval; Dunmore; Northgate; 46 sittings to March 2025; 14 trips Apr 2024–Mar 2025; 27/18 2024–25; Second Chances Jan–Apr 2025 (24/19/11).  
- Weakest: 90 starters (3×30) against a single evidenced cohort of 24, plus 12 “volunteer mentors” with no prior volume.

**Doc 3**  
- Fundable as submitted: **n**  
- Reads machine-generated: **y**  
- Swappable: **y** (the “addresses all three Round 3 priorities” paragraph and the three-cause / three-outcome blocks would travel)  
- Named referents: **9** — Marlpit; St Aidan's; Priya Raval; Dunmore; Northgate; 27/18; Second Chances 19 of 24 / 11; 14 trips 2024–25; 38% lowest decile 2021 census.  
- Weakest: Q5 (“zero marginal cost” / “continuation funding is sought”) does not answer who pays.

**Doc 4**  
- Fundable as submitted: **n**  
- Reads machine-generated: **n**  
- Swappable: **n**  
- Named referents: **9** — Marlpit; east bank; St Aidan's; Priya Raval; Dunmore; 38% 2021 census; 46 sittings to March 2025; 14 trips; 27/18 and Second Chances 24/19/11.  
- Weakest: the budget lines do not add to the stated subtotal; the declaration is not the four required self-certs.

---

**3. Reject-list hits (quote)**

**Doc 1** — none of the listed defects at a level that bites.

**Doc 2**  
- Targets a reader cannot fully trace: “90 young people… not in education, employment, or training” vs evidenced 24 starters / 27 referrals.  
- Pseudo-precise: “66.7 per cent” / “79.2 per cent” / “45.8 per cent” restating the same three integers.

**Doc 3**  
- Uniform phase tables: Phase 1/2/3 table, then KPI table, then budget table, all the same administrative shape.  
- Three-part parallel constructions: three causes; three outcomes; three post-grant “assets”.  
- Template diction: “This proposal addresses all three Round 3 priorities”; “actionable causes”; “institutional and travel friction”.  
- Reads machine-generated: the whole of Q1’s last paragraph and Q2’s numbered causes.  
- Targets not derived: 450 mentoring hours; 57 completers from 72 with no link to 19/24.

**Doc 4**  
- Arithmetic that does not close (see §4).  
- Declaration is not the required set (no bank-account, debarment, or policy-review self-certs as specified).

---

**4. Recompute**

**Doc 1** — closes (with 80p overhead rounding).  
19,500+7,800+2,880+2,280+2,880+1,500+2,000 = **38,840**.  
12% × 38,840 = 4,660.80 → they take **4,660**. Total **43,500**.  
72×40=2,880; 24×95=2,280; 48×60=2,880. Continuation: 12×40=480; 4×95=380; 960 → **1,820**. 16×3=48. 38/24/18 sit under the 2025 ratios. **OK.**

**Doc 2** — closes.  
18×65×22=**25,740**; 12×65×15=**11,700**; 72×40=2,880; 18×95=1,710; +1,200+1,080 = **44,310**.  
4,200/44,310 ≈ 9.48%. 44,310+4,200=**48,510**. Post-grant 48×40=1,920; 10×95=950; +950=**3,820**. **OK.** Volume is the problem, not the sums.

**Doc 3** — closes.  
21,600+9,000+4,500+1,440+1,710+550=**38,800**. 12%×38,800=**4,656**. Total **43,456**. 36×40=1,440; 18×95=1,710. **OK.** (Venue 36 sessions vs others’ 72 is a design cut, not a sum error.)

**Doc 4** — **does not close.**  
39,105+5,510=44,615  
+1,440=46,055  
+1,710=47,765  
+1,650=49,415  
+1,620=51,035  
+900=51,935  
+750=52,685  
+1,200=**53,885**  
Stated subtotal **55,385** (short **1,500**).  
8% of 55,385=4,430.80 → they take 4,431; 55,385+4,431=59,816 (internal to the *wrong* subtotal). Venue/transport “indicative”. **Fail.**

---

**5. One system, four variations.**  
Same org, same town, same ward, same hall, same coordinator, same college, same hire firm, same 27/18, same 24/19/11, same 46 sittings, same 14 trips, same £40/£95. Doc 1 is the human draft; 2 inflates headcount and pastes mentors; 3 is the LLM restyle (priorities paragraph, phase table, three-causes); 4 is the “cleverer” rewrite (keyworker, handovers, risks) that then breaks the budget and the declaration. Not four applicants.

---

## Scope limits on this result

- **One critic, one rung, one fixture, one replay.** critic_a at n06 remains unobtained.
- The critic's referent counts are its own; they are not the repo's `properNounAudit` numbers
  and should not be substituted for them.
- The critic's guess at provenance in §5 ("Doc 1 is the human draft") is wrong — no document
  is human-written; all four are model output. It correctly identified one system, but its
  story about which arm is which is not evidence.
