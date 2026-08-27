# Phase 0 — Jarvis up

**Date:** 2026-08-27 · **Commit at start:** `3450e54` · **Balance:** $25.10 of $45.00
(total_usage $19.8987) — above the $3.00 floor.

**Result: 2 of 4 verifications PASS, 1 FAILS, 1 could not be performed.** The two that did
not pass fail for the same reason, and it is not a property of the code: **this session's
egress policy denies `openrouter.ai` and every third-party host.** Phase 0's own STOP
conditions — fingerprint mismatch, or production reachable — were **not** hit. The STOP is
in phase 1, and it is recorded in `reports/phase1-verdicts.md`.

`stack/up.sh` was not run to completion: it requires the Supabase CLI and container images,
and images cannot be pulled here (§4). Each of its checks was performed directly instead,
against the same artefacts, and that is what is reported below.

---

## 1. Migrations replay clean, and the fingerprint matches production — PASS

`tests/replay/run.sh`, unmodified. Two corrections to the phase brief's wording:

- **15 migrations, not 11.** Production has 11; the repo carries 4 more
  (`20260826150000`, `160000`, `170000`, `180000`) that are written and undeployed.
- **"Matches production" needed splitting in two**, because the repo is deliberately ahead
  of it. Both readings were checked, and both pass:

| check | result |
|---|---|
| 15-migration replay vs `expected-fingerprint.txt` | **all 8 categories match, zero exclusions** |
| 11-migration replay (undeployed skipped) vs `production-fingerprint.txt` | **all 8 categories match, zero exclusions** |

The second is stronger than the brief asked for and was run because the first does not
establish it. It proves the repo/production divergence is **exactly** the four undeployed
`20260826*` migrations and nothing else — no drift, no hand-edit, no lost transcription.
Script: `/tmp/.../scratchpad/replay11.sh` (throwaway; the assertion is reproducible by
skipping `20260826*` in `tests/replay/run.sh`).

Fingerprint of the full 15-migration history:

```
columns_nonvector e8117af74ac45fcfef1ea78972e07ceb   policies    66d57dd2e060c72c312926123b48dc22
constraints       be67c83d021beee4ed9dcbcf5e468db1   rls_flags   f3f957816f9975c7cb31d8127a58811d
functions         e5cf57888fab2d6b9cd28a5bf11c14a4   triggers    ec7f46725697aa62c2d33efd33b3fa41
grants            e7e7a9931b13923d26bf9315a0610ed5   indexes     bfd2c95cb6092fd119e0d04bce9bcad9
```

**The four undeployed migrations are not cosmetic.** `tests/exclusivity/run.sh` — written to
fail while any per-grant ceiling exists — now passes: 40 concurrent applicants on one grant,
0 refused, 0 queued. It passes against the *repo* schema, which includes
`20260826160000_unbounded_composer.sql`. **Production still carries the 8-proposal ceiling**
until those four migrations are deployed. The full suite (`tests/run-all.sh`, 15 suites) was
run and passed, with the ladder byte-match added to it.

Replay safety, all asserted by the test: cron target not hardcoded to production · **zero**
outbound requests during replay · no literal secret in any migration.

## 2. Migration 20260820145930 is corrected in this environment — PASS

| hazard | state |
|---|---|
| production URL in `cron.schedule` | **absent.** Target resolved from `public.get_secret('worker_url')`; `where s.u is not null and s.u <> ''` makes each tick a no-op until an operator sets it. Asserted against the live `cron.job` row, not just the file. |
| retired worker secret as a literal | **absent.** Generated per environment from two `gen_random_uuid()` values, and only when no `worker_secret` row exists, so a replay cannot silently rotate a secret the deployed worker authenticates against. |

The only occurrence of `uocauqflcqefgdixbzpf` anywhere in `supabase/migrations/` is inside
the header comment explaining why it is no longer there.

## 3. Network — production unreachable PASS · OpenRouter and nonprofit sites FAIL

**Production is unreachable, by two independent layers:**

- `stack/guard-egress.sh` applied: `uocauqflcqefgdixbzpf.supabase.co` → `127.0.0.1`.
  Direct curl bypassing the proxy: `Failed to connect ... port 443`.
- The session's egress proxy independently denies it: `403 to CONNECT`, logged at
  `15:46:37Z` in `$HTTPS_PROXY/__agentproxy/status`.

**OpenRouter is also unreachable, and that is the finding of this phase.**

| host | result |
|---|---|
| `openrouter.ai`, `api.openrouter.ai` | **403 CONNECT — organisation egress policy denial** (logged `15:45:34Z`) |
| `thefelixproject.org`, `www.thefelixproject.org`, `example.com` | blocked (no CONNECT) |
| `deno.land`, `jsr.io`, `github.com`, `esm.sh` | blocked / 403 |
| `registry.npmjs.org`, `api.github.com` | reachable |
| `registry-1.docker.io`, `ghcr.io`, `public.ecr.aws` (API) | reachable; **blob hosts denied** |

The proxy README is explicit that a 403 is an organisation policy denial and must be
reported rather than retried or routed around. It was reported, not routed around.

This is a **different** blocker from the one that spoiled the last run. That was the MCP
server's 60-second ceiling, which billed seven calls and returned none of them. Credit was
never the blocker then and is not now: **$25.10 remains.** The transport is.

## 4. One manual worker tick against the local stack — NOT PERFORMED

Not a pass and not a failure of the code. Three independent obstacles, any one sufficient:

1. **No container images.** `supabase start` needs them. Docker Hub returns
   `toomanyrequests` for unauthenticated pulls from this shared egress IP; the ECR mirror's
   blob host (`d2glxqk2uabbnd.cloudfront.net`) is policy-denied. A daemon was started
   successfully (`dockerd --storage-driver=vfs`, bridge networking, iptables functional), so
   the obstacle is image distribution, not the runtime. The daemon was stopped afterwards.
2. **The worker's module graph will not resolve.** `worker/index.ts:29` imports
   `jsr:@supabase/functions-js/edge-runtime.d.ts`, and `jsr.io` returns 403.
3. **A tick that "completes" needs OpenRouter.** Even with 1 and 2 solved, the first stage
   calls a model, and §3 is why it cannot.

What *was* established, because it bounds what a future session can do here without
unblocking anything:

- **Postgres 16 is usable directly** — the full replay, the fingerprint check and the
  11-migration comparison all ran locally, with no Docker.
- **Deno 2.9.5 is usable** (installed from npm, the one reachable registry).
- **All ten pure worker modules type-check clean** under it: `donor_limits`, `word_limit`,
  `proper_nouns`, `ssrf`, `referent_weight`, `sufficiency`, `crawl_outcome`,
  `delivery_gate`, `numeric_register`, `contact_claims`.

So phase 4's parser fixtures and grep audit, and phase 6 items 1, 2 and 4, are all runnable
in an environment shaped like this one. Phase 1, phase 4's end-to-end order and phase 5's
six crawls are not, and no amount of local plumbing changes that.

---

## What an operator must unblock, in order

1. **Allow `openrouter.ai` and `api.openrouter.ai`** through the session's egress policy.
   Without this no phase from 1 onward can run at all.
2. **Put an OpenRouter key in `stack/.env`.** There is none on this machine, and none should
   be taken out of production. This is separate from 1: both are required.
3. **Allow the six crawl targets** (phase 5) and either a container registry or a
   pre-pulled image set, if the end-to-end order in phase 4 is wanted locally.
