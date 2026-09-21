# Phase 1 — ten verdicts

Run on Jarvis, where `openrouter.ai` is reachable:

```bash
export OPENROUTER_API_KEY=sk-or-...
python3 tests/ladder/run-phase1.py
```

Python 3 standard library only. No dependencies, no MCP, no Deno.

## What is here

| path | what |
| --- | --- |
| `packets/` | 8 blinded critic packets, byte-for-byte as sent |
| `documents/` | the 20 ladder documents, 5 rungs x 4 arms |
| `fixture/` | the synthetic organisation, the grant, and the 5 ledgers |
| `verdicts/` | judgements. 3 already landed; the runner writes the rest here |

Arms: **A** pipeline + current generator, **B** pipeline + stronger, **C** single prompt +
current, **D** single prompt + stronger.

## Why direct HTTP instead of the MCP tool

The MCP server closes a call at 60 seconds. Seven judgements in the previous run were
accepted, generated and **billed** upstream, then cut off with no generation id returned, so
text that had been paid for was unrecoverable. Every call here goes direct to
`/chat/completions` with `stream: true`, which has no such ceiling, and the generation id is
captured from the first chunk so even a death mid-stream stays traceable.

## Blinding is derived, never passed

Each packet's `Doc 1`..`Doc 4` labels are resolved by finding where each source document's own
bytes sit inside the packet — three probes per document, at 10%, 45% and 80% through the text,
so a single coincidence cannot decide it. If a document is absent, or its probes land in
unrelated places, the run **stops**.

This is not defensive decoration. In the previous run a packet was paired with the wrong
mapping file and the result inverted: it reported that a critic funded the single-prompt
baseline when the critic had in fact funded the pipeline. Deriving the map from the bytes makes
that class of error impossible rather than merely unlikely.

Verified across all eight packets:

```
prompt-n03-critic_a   CBAD      prompt-n06thin-critic_b  DCAB
prompt-n03-critic_b   BADC      prompt-n09-critic_a      BDAC
prompt-n06-critic_a   BDAC      prompt-n12-critic_a      BACD
prompt-n06thin-critic_a BDCA    prompt-n12-critic_b      BDAC
```

`prompt-n06-critic_a` derives to **BDAC**, which independently confirms the correction applied
to the n06 verdict: it had been decoded with `DCAB`.

## Settings, and why they are fixed

`reasoning_effort: low` and `max_tokens: 8000` match every judgement already recorded. Changing
either would produce a verdict at different settings wearing the old label, and the rungs would
no longer be comparable with each other. Two rungs already carry verdicts at these settings.

## Failure handling

A call that dies mid-stream keeps its partial text and generation id and is retried **once**. A
second death on the same packet is recorded `MISSING` and the run moves on. Nothing substitutes
its own judgement for a missing verdict — every prior run that faced this refused, and that is
now the standing rule.

Cost comes from each response's `usage` field. The account meter is **not** used for cost: it is
account-wide, and in a previous run two concurrent agents read the same increment and published
contradictory per-call figures. It is read twice here, at the start and end, purely as a balance
check against the $3.00 floor.
