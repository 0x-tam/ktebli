# Ktebli — Supabase CLI project files, migration baseline, and source verification

**Date:** 2026-08-23
**Scope:** CLI project init, migration baseline, edge-function byte-verification, typecheck.
**Nothing was deployed.** No `functions deploy`, no `db push`, no `db reset`, no `vercel deploy`.
No application code was changed.

---

## Environment reality check (read this first)

The task assumed the Supabase CLI was installed, logged in and linked. In this container it is
none of those things, and two of the four requested commands cannot run here at all:

| Assumption | Actual |
| --- | --- |
| CLI installed | Not present. Installed `supabase@2.115.0` from npm for this pass (registry.npmjs.org is reachable). |
| CLI logged in | No `~/.supabase`, no `SUPABASE_ACCESS_TOKEN`. `supabase projects list` returns `LegacyPlatformAuthRequiredError`. |
| CLI linked | Not linked. `supabase db pull --linked` returns `LegacyProjectNotLinkedError`. |
| `api.supabase.com` reachable | **Blocked.** Egress policy returns 403 to CONNECT (confirmed in the agent proxy's own failure log). |
| Database reachable | **No.** `db.uocauqflcqefgdixbzpf.supabase.co` resolves IPv6-only and this container has no IPv6 stack; the IPv4 pooler is blocked on 5432/6543. The proxy does not tunnel raw TCP by design. |

`supabase login` needs a browser and `supabase link` needs the database password, so both were
left for the user to run. The blocked hosts are an organisation egress-policy matter, not
something to route around.

**What was used instead:** the Supabase MCP server, which is authenticated and egresses over a
different path. It gave read-only access to the live project (`ACTIVE_HEALTHY`, Postgres 17.6.1.155,
region eu-central-1). That covers the *comparisons* asked for, but it cannot produce a migration file.

---

## 1. CLI project files — done, clean

`supabase init` (no `--force`) was purely additive.

- Before: 16 files under `supabase/`. After: 18.
- All 16 pre-existing files verified **byte-identical** by sha256 before and after.
- New: `supabase/config.toml`, `supabase/.gitignore`.
- Nothing was proposed for overwrite; `--force` was never needed (it only affects `config.toml`,
  and none existed).

This confirms the prediction in `DEPLOY.md` that init would not disturb `functions/`.

**Carry-over risk:** the generated `config.toml` has **no `[functions.*]` stanza**, so it does not
record `verify_jwt = false` for the eight functions. The `--no-verify-jwt` flag on every deploy
remains the only thing standing between a deploy and JWT verification being switched on — which
would break pg_cron, Stripe, the wizard and the order page. Making that durable in `config.toml`
is worth doing before the first real deploy.

---

## 2. `db/schema.sql` vs the live database

`supabase db pull` could not run (no auth, no database route). The comparison below is against the
**live database** instead, which answers the same question more directly.

### What the dump gets exactly right

Verified byte-for-byte or by exact set comparison against live catalogs:

- **The five partial unique indexes on `claims`** — all present, all five `indexdef` strings
  character-identical to live: `claims_one_per_org`, `claims_concept_lock`, `claims_template_lock`,
  `claims_opening_lock`, `claims_house_voice_lock`.
- **All 46 indexes** (41 unique + 5 non-unique) — index-name sets match exactly, no additions, no omissions.
- **All 13 functions** — every body md5-identical to live `pg_proc.prosrc`, including all 12
  `SECURITY DEFINER` routines (`claim_approach` 2333 bytes, `claim_next_stage` 1131 bytes,
  `claim_revision`, `confirm_claim`, `expire_stale_holds`, `get_secret`, `my_org_id`,
  `reap_stale_stages`, `release_claim`, `rl_hit`, `rollup_statuses`, `stripe_event_seen`).
  `SET search_path TO ''` is preserved on the ones that carry it.
- **The events immutability trigger** — `events_immutable BEFORE DELETE OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION events_no_change()`, plus its (non-`SECURITY DEFINER`) function body.
- **RLS facts** — 24 of 25 tables have RLS enabled, `bench_cases` does not; 10 policies, all
  PERMISSIVE, all for role `authenticated`. Every policy name, command and `USING`/`WITH CHECK`
  expression matches live.
- Cron: 1 job, `ktebli-worker-tick`, every minute.

The dump is **accurate**. Its content is not the problem.

### What did not make it across

The gap is *form*, not fidelity. `db/schema.sql` is not a migration and is not even valid SQL:

1. **Zero `CREATE TABLE` statements.** All 25 tables and 206 columns exist only as a commented
   listing in Section 1 — and the column lines themselves are **not** comment-prefixed, so `psql`
   would fail on line 28, the very first thing it reaches.
2. **Zero constraints.** The live database has **83** constraints (primary keys, foreign keys,
   unique, check). None are expressed as DDL. The unique *indexes* survive; the unique *constraints*,
   PK/FK relationships and check constraints do not.
3. **RLS is prose, not DDL.** Sections 5 and 6 are entirely commented out. There are no
   `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statements and no `CREATE POLICY` statements.
   A rebuild from this file yields a database with **RLS off on every table and no policies** —
   the tenant-isolation model silently absent on a system that takes payments.
4. **Cron is prose.** Section 7 documents `ktebli-worker-tick` in comments; replaying the file
   creates no job, so a rebuilt database would never tick the worker.
5. No extensions (`pg_cron`, `pg_net`, `pgvector` are all implied but never declared), no
   sequences, no grants, no storage buckets, no Vault entries.

Of 748 lines, only 60 are executable statements: 46 indexes, 13 functions, 1 trigger — and every
one of them references tables the file never creates.

**Net:** the five exclusivity indexes, the SECURITY DEFINER functions and the events trigger *did*
make it across intact. Tables, constraints, RLS enablement, policies and cron did **not**.
A real `supabase db pull` is still needed and still outstanding.

---

## 3. Edge function verification — all seven match

`supabase functions download` is blocked (it needs `api.supabase.com`). Sources were fetched from
the live project through the MCP management API and diffed against the committed copies.

| slug | version | files | result |
| --- | --- | --- | --- |
| `analyze-grant` | 3 | index.ts, ssrf.ts, http.ts | identical |
| `order-status` | 4 | index.ts, http.ts | identical |
| `save-intake` | 4 | index.ts, http.ts | identical |
| `upload-intake-file` | 2 | index.ts, http.ts | identical |
| `request-revision` | 3 | index.ts, http.ts | identical |
| `stripe-webhook` | 9 | index.ts | identical |
| `qa-visual-test` | 3 | index.ts | identical |

**Nothing was replaced — every transcribed file is byte-identical to what is deployed**, including
byte counts (e.g. `stripe-webhook/index.ts` 11,213; `analyze-grant/ssrf.ts` 5,668). The file sets
match too: no committed file is absent from the deployment and none is missing locally. All eight
functions confirmed `verify_jwt: false`; `worker` confirmed at v26.

**Caveat worth keeping.** This re-fetch came through the same management API the originals were
transcribed from. It rules out transcription error — the thing actually at risk — but it cannot
rule out a systematic misrepresentation in the API's own output. The v25 incident was a *write*-path
over-escaping bug, and its signature (literal `\"` inside template literals) is absent here. A
`supabase functions download` from an authenticated machine would close the loop.

---

## 4. Typecheck

`deno check` on all eight entrypoints initially failed identically: the type-only import
`jsr:@supabase/functions-js/edge-runtime.d.ts` cannot be fetched because **`jsr.io` answers 403**
to this container (not an agent-proxy denial — it does not appear in the proxy's failure log, and
`registry.npmjs.org` works fine from the same path). That failure says nothing about the code.

Re-running with that one type-only import stubbed **in a scratch copy** (the repo was not touched;
the substitution was one line for one line, so line numbers below map directly to the repo):

- **7 of 8 clean:** `analyze-grant`, `order-status`, `save-intake`, `upload-intake-file`,
  `request-revision`, `stripe-webhook`, `qa-visual-test`.
- **`worker` — 2 errors**, both `TS2769`, same root cause:
  - `supabase/functions/worker/index.ts:937` — in `renderService(bytes: Uint8Array)`
  - `supabase/functions/worker/index.ts:1015` — in `upload(path, bytes: Uint8Array, contentType)`

  Both pass `body: bytes` to `fetch`. Under TypeScript 5.7+/Deno 2.x, a bare `Uint8Array` means
  `Uint8Array<ArrayBufferLike>`, while `BodyInit` requires `Uint8Array<ArrayBuffer>`.

  This is **typecheck-only**. The deployed edge runtime pins an older TS/lib, which is why v26 runs
  fine in production. It becomes a build break the moment a `deno.json` or a CI typecheck is added.
  `upload-intake-file` does the same thing without erroring because its `bytes` comes from
  `new Uint8Array(await file.arrayBuffer())`, which is concretely `Uint8Array<ArrayBuffer>`.

  Not fixed, as instructed. The fix is a signature widening in two places, not a logic change.

---

## Outstanding, for the user to run

1. `supabase login` (browser) and `supabase link --project-ref uocauqflcqefgdixbzpf` (database password).
2. `supabase db pull` — still the only way to get a replayable baseline. Review its output before
   applying: anything it proposes to drop or recreate should be read carefully first.
3. `supabase functions download <slug>` from an authenticated machine, to close the loop on §3.
4. Ask whoever owns the egress policy to allow `api.supabase.com` if this environment is meant to
   do Supabase CLI work.
