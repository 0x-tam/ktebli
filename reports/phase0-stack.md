# Phase 0 — Jarvis up

**Date:** 2026-08-27 · **Host:** `vm` (the Claude Code container) · **Result: STOPPED**

`stack/up.sh` was not run. It cannot be: this is not Jarvis, and two of the four verifications
the phase requires cannot pass here. What follows is what was verified, what was not, and why.

---

## The four verifications

### 1. Migrations replay clean, fingerprint matches across all eight categories — PASS

`tests/replay/run.sh` replayed all migrations into a throwaway Postgres and produced:

```
columns_nonvector | e8117af74ac45fcfef1ea78972e07ceb
constraints       | be67c83d021beee4ed9dcbcf5e468db1
functions         | e5cf57888fab2d6b9cd28a5bf11c14a4
grants            | e7e7a9931b13923d26bf9315a0610ed5
indexes           | bfd2c95cb6092fd119e0d04bce9bcad9
policies          | 66d57dd2e060c72c312926123b48dc22
rls_flags         | f3f957816f9975c7cb31d8127a58811d
triggers          | ec7f46725697aa62c2d33efd33b3fa41
-> all 8 categories match the recorded migration-history fingerprint
REPLAY OK
```

**Zero exclusions.** One qualification the run reports itself: `UNDEPLOYED MIGRATIONS` — the repo
is ahead of the live project by the migrations added during this work. The fingerprint asserted
against is what the migration history produces, which is the correct baseline for a local stack.

### 2. Migration `20260820145930` corrected — PASS

```
production URL in executable SQL : 0   (the only occurrence is in the explanatory banner)
literal worker secret            : 0
cron target source               : get_secret('worker_url')
```

The cron target resolves from Vault rather than a literal, so a replayed history has no
production URL to inherit, and the secret is generated per environment.

### 3. Production unreachable, openrouter.ai and a nonprofit site reachable — **FAIL**

```
https://uocauqflcqefgdixbzpf.supabase.co/functions/v1/worker   HTTP 000
https://uocauqflcqefgdixbzpf.supabase.co                       HTTP 000
https://openrouter.ai/api/v1/models                            HTTP 000
https://www.ukyouth.org                                        HTTP 000
```

Production is unreachable — **but not for the right reason, and this matters.** Every host is
unreachable, because this container refuses all outbound CONNECT. `/etc/hosts` carries **no**
guard entry (`grep -c` → 0). So the block that makes production safe here is incidental, and on
Jarvis, where egress works, it would be load-bearing and is not yet installed. `stack/up.sh`
already refuses to start without it, and `stack/guard-egress.sh` installs and verifies it — that
step has simply not been performed on any machine yet.

The second half fails outright: openrouter.ai and the nonprofit site are both unreachable, so
**rule 4 cannot be satisfied from this host.** Model calls must go direct over HTTP with
`stream: true`; there is no route.

### 4. One manual worker tick against the local stack — **NOT PERFORMED**

```
supabase CLI : ABSENT
deno         : ABSENT
docker       : present (29.3.1)
psql         : present (16.13)
openrouter.ai reachable for the worker's llm() calls : HTTP 000
```

Two of the four prerequisites are missing and the third — the worker's own model calls — has no
route even if they were installed.

---

## Where this stopped, and why

**Neither of the phase's named STOP conditions fired.** The fingerprint matches and production is
not reachable. The phase stopped on something else: **verifications 3 and 4 cannot be performed on
this host at all.**

This container is `vm`, not Jarvis. There is no `tailscale` binary, no route to a tailnet, and no
outbound HTTPS. Rule 4 requires every model call to go direct to
`https://openrouter.ai/api/v1/chat/completions` with `stream: true` — precisely to avoid the
60-second MCP ceiling that lost seven paid calls in the previous run. That instruction is correct
and it is unexecutable from here.

Phases 1 through 6 all depend on one or both of the two capabilities this host lacks:

| phase | needs |
| --- | --- |
| 1 — ten verdicts | direct streaming calls to openrouter.ai |
| 2 — the fork | phase 1 |
| 3 — wire the gate | direct calls, for judge validation |
| 4 — compliance end to end | the local stack, and a real crawl |
| 5 — six real sites | outbound access to six real websites |
| 6 — engineering | the local stack, to prove each path |

So the run ends here rather than improvising around a STOP.

## What is needed to resume

Run this on Jarvis, which has ordinary outbound internet:

```bash
sudo stack/guard-egress.sh          # installs and VERIFIES the production blackhole
cp stack/env.example stack/.env     # operator sets OPENROUTER_API_KEY
stack/up.sh                         # postgres, migrations, fingerprint assert, vault
```

Then phase 1 runs from there. Alternatively, connect this session to the tailnet and it can drive
Jarvis directly.

## Spend

**$0.00 this phase.** No model call was made. Balance last observed at $29.24 available, well
above the $3.00 floor. Per rule 4 the account meter is not used for cost attribution; that figure
is a balance check only, as rule 3 requires before phase 1.

## Carried forward, unchanged

The seven lost verdicts from the previous run were **billed and never delivered** — accepted,
generated, then cut off by the MCP transport with no generation id returned. Phase 1's direct
streaming approach is what makes them recoverable. Their packets and blinding are preserved
byte-for-byte in `scratchpad/qloop/ladder/`.
