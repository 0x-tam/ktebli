# Adversarial tests

Each of these was written by an agent whose job was to **break** an invariant, not to admire
it. An invariant is not proven by passing its own test; it is proven by surviving an agent that
was trying to defeat it.

All four broke the invariant they attacked on first contact. Every one of these tests **failed
against the code as shipped**, which is why they exist.

| test | invariant | what it found |
| --- | --- | --- |
| `fabricated_identity_test.ts` | 3 — nothing asserted the ledger does not carry | 9 routes. 1 contact shape caught of 25; an invented bank account **affirmatively cleared** because its digits sit inside the registration number; invented partners invisible inside tables; the metric **inverts**, rewarding entities assembled from ledger vocabulary and penalising the applicant's real city |
| `register_does_not_close_test.ts` | 4 — every number derived once | 10 classes of non-closing number, including a percentage right about the wrong denominator and a fraction used as a headcount |
| `compliance_truncation_test.ts` | 5 — compliance never traded | 2 routes to an over-length document; heading detection steerable **by the document itself** |
| `regeneration_loop_test.ts` | the loop limits | 3 holes, one that spends real money: the dollar cap acts after the spend instead of reserving before it |

They are kept in the suite permanently. A fix that makes one pass has closed a hole that was
demonstrated, not imagined.
