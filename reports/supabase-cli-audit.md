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

---

## Follow-up (same day): real migration history recovered

After the Supabase MCP connection was authorised, the migration gap in §2 was closed —
though not the way it was framed there.

**The remote was tracking migrations all along.** `supabase_migrations.schema_migrations`
on the live project holds 11 migrations with their full SQL. The repo simply never had
the files. So the fix was not to synthesise a baseline but to recover the authentic
history, which is now in `supabase/migrations/`.

I did first build a synthetic baseline from catalog queries and verified it reproduced
production exactly. It was then discarded: its timestamp sat after the recorded history,
so the CLI would have read it as unapplied and invited a push against production. The
real files carry the versions the remote already knows, so there is nothing to push.

**Verification.** Ten of the 11 files are byte-identical to the recorded statements
(checked per file against the stored byte length). All 11 were replayed in order into a
clean Postgres 16 behind a shim harness for the Supabase-only objects (auth, storage,
vault, cron, net, pgvector). Every schema fingerprint then matched production exactly —
columns, constraints, indexes, grants, RLS flags, functions, policies, trigger.

**Two findings came out of it, both worth acting on:**

1. **A live secret is in the migration history.** `20260820145930_secrets_grants_and_cron`
   embeds the real `worker_secret` as a literal in `vault.create_secret`. The committed
   file redacts it to `__WORKER_SECRET__`, and a scan of all 11 migrations confirms this
   is the only one carrying secret material. But the plaintext value is still in the
   remote `supabase_migrations` table, readable by anything with database access, and it
   is the shared secret pg_cron uses to authenticate to the worker. **Rotate it**, and
   note that a `supabase db pull` on any machine would write it straight to disk.

2. **`public.bench_cases` is in production but in no migration.** It is the sole
   difference between a clean replay and live, and the only table with RLS disabled —
   it never passed through the deny-by-default migration, so `anon` and `authenticated`
   hold full DML on it with nothing constraining them. DDL and options in
   `db/untracked_bench_cases.sql`.

`db/schema.sql` is unchanged and still useful as the human-readable reference; the
executable source of truth is now `supabase/migrations/`.

---

## Benchmark cleanup executed (2026-08-23)

The `bench_cases` drift recorded above is resolved. The table and the 13 synthetic
orders it indexed were deleted from production in one guarded transaction, after an
approved dry run.

**Scope.** `bench_cases.order_id` was the sole manifest. The email pattern
`^(real)?bench-` was used only to corroborate it — both sets contained exactly the same
13 orders, with no discrepancy in either direction. Scope was never widened on the
strength of an email pattern.

**Removed:** 13 orders, 13 order_proposals, 142 job_stages, 14 claims (13 explicit
exclusivity reservations plus 1 stale claim by cascade), 11 organisations, 11
voice_profiles, 3 org_intel rows, 10 grants, 1 intake_files row, and the `bench_cases`
table itself.

**Deliberately retained:**

- **Two organisations** — Amel Association International and Horizon Development
  Foundation — each also carried a non-benchmark `test-org*` order. Deleting them would
  have taken real non-manifest data with them. Their orders, claims, voice profiles and
  org_intel are untouched.
- **`public.events`** — 70 rows, 26 of which reference benchmark entities. The
  `events_immutable` trigger makes deletion impossible by design, and any attempt would
  have aborted the whole transaction. The audit history is intact and the trigger was
  not weakened.
- `pre_intakes`, `link_previews`, `stripe_events` and the four `test-org*` orders, none
  of which are in the manifest.

**Verification.** All 13 manifest orders gone; zero orphaned rows across every foreign
key in both directions; both shared organisations and their data intact; `events` still
70 rows with its trigger present; `bench_cases` gone. The worker cron returned HTTP 200
on all 30 runs in the surrounding half hour, including after the cleanup.

**Schema fingerprint now matches with no exclusion.** All eight categories equal the
values the replayed migrations produce. Before the cleanup this held only when
`bench_cases` was excluded; production and `supabase/migrations/` now describe the same
schema.

**Metrics.** Orders 19 → 6. Gross `amount_usd` $2,538 → $598 — the benchmark rows had
been inflating it by $1,940 in a table any revenue query reads. Of the 6 remaining, 4
are `test-org*` and 2 are genuine addresses.

**Outstanding: 22 storage objects.** The benchmark files in the `order-files` bucket
were not deleted. This session's egress policy blocks
`uocauqflcqefgdixbzpf.supabase.co` (403 to CONNECT) and no service_role key is
available here, so the Storage API could not be reached. Nothing is orphaned — the
`storage.objects` metadata is intact — and the paths are listed in
`db/pending_benchmark_storage_cleanup.txt` for removal from the dashboard or an
authenticated machine.


---

## Second cleanup pass — `test-org*` orders removed (2026-08-23)

The four remaining synthetic orders (`test-orga` KT-10003, `test-orgb` KT-10005,
`test-orgc` KT-10004, `test-orgd` KT-10006) were deleted in one guarded transaction, scoped
by explicit order ID rather than by email pattern. Dependencies were re-verified against
current production state first, not carried over from the earlier report.

**Removed:** 4 orders, 4 order_proposals, 39 job_stages, 4 claims, 4 organisations,
4 voice_profiles, 1 org_intel, 1 grant. The two organisations preserved during the
benchmark pass — Amel Association International and Horizon Development Foundation —
existed only to serve `test-orga` and `test-orgb`, so they were correctly removed here.

**Production now holds two orders:** KT-10001 and KT-10002, both $1 trials, gross $2.00.

**Regression evidence preserved outside production.** `test-orgb` was the only live example
of the similarity gate firing. Its reproduction case is now
`tests/regression/similarity-gate/`, holding the synthetic grant and applicant, the abstract
strategy record, the 25-word cap, the observed 26-word run after 2 automated rewrites, the
`held` (not `failed`) classification, and a passing negative control at 16 words. The
colliding narrative concerned a real, identifiable NGO and is deliberately not reproduced —
only the abstract descriptors the exclusivity architecture already compares on.

**Two things noted, not acted on:**

1. **27 storage objects remain** (22 benchmark + 5 test-org) in the `order-files` bucket.
   Deletion is blocked three ways from this session: the Supabase MCP server exposes no
   storage-object delete tool, the project host and management API are both refused by
   egress policy (403 to CONNECT), and no service_role key is available. Paths and blockers
   are recorded in `db/pending_storage_cleanup.txt`. Deleting `storage.objects` rows over
   SQL was deliberately avoided — it would strand the backing blobs.
2. **Three zero-referenced benchmark grants survive** — titles suffixed `(RB-R1)`, `(RB-R2)`,
   `(RB-R3)`, from the realbench cases. They were never linked to an order_proposal, so the
   benchmark pass did not reach them. They hold no claims and no exclusivity locks, and do
   not affect the schema fingerprint or any order/revenue metric. Left in place as outside
   the approved scope.

**Stripe was not touched.** The four test orders carried real Stripe sessions; those remain
in Stripe as the historical development transactions they are. Nothing was refunded,
cancelled or mutated.


---

## Final baseline pass (2026-08-23)

**Three zero-referenced benchmark grants removed.** The `(RB-R1)`, `(RB-R2)` and `(RB-R3)`
rows noted above were re-verified against current production — zero `order_proposals`, zero
claims of any status, zero fingerprints, zero merge reviews, zero `merged_into` references,
zero legacy proposals, zero retained orders depending on them — and then deleted by explicit
ID inside a guarded transaction. Production now holds three grants, all belonging to the two
retained trial orders. No other grant was touched.

**Production dataset is final:** 2 orders (KT-10001, KT-10002), gross $2.00, 2 organisations,
3 grants, 3 claims (2 active), 2 order_proposals, 32 job_stages, 0 revision_requests,
2 voice_profiles, 0 org_intel. Zero FK orphans in either direction. `public.events` unchanged
at 70 rows with `events_immutable` intact. Migration history untouched at 11 rows. Worker
secret resolves from Vault; cron returning HTTP 200 with zero non-200 responses. Schema
fingerprint matches the reconstructed migration replay across all eight categories with zero
exclusions. Repository secret scan clean.

**Storage remains the single open item.** The 27 objects could not be deleted from any agent
session — this was re-tested a third time, and all three routes still fail: no storage-object
delete tool in the Supabase MCP server, and 403-to-CONNECT egress denials for both the project
host and the management API, with no service_role key available. Rather than delete
`storage.objects` rows over SQL (which would strand the backing blobs) or claim a cleanup that
did not happen, `db/pending_storage_cleanup.txt` was converted into an actionable dashboard
procedure: 15 folders to delete, 2 to keep, with every path listed. The baseline is therefore
reported as NOT clean until those objects are gone.


---

## Baseline closed (2026-08-23)

The last open item is resolved. All 27 storage objects belonging to deleted synthetic orders
were removed from the `order-files` bucket via the dashboard — the deletion an agent session
could not perform — and verified from the database side afterwards.

`storage.objects` now holds **two** rows in `order-files`, one each for KT-10001 and KT-10002.
Zero of the 27 pending prefixes remain; zero objects belong to any non-existent order. Both
retained files are byte-for-byte untouched: sizes 18,596 and 18,173, and `updated_at` values of
2026-08-21 and 2026-08-22 that predate the cleanup entirely.

Final state: 2 orders, gross $2.00, 2 organisations, 3 grants, 3 claims (2 active), 2
order_proposals, 32 job_stages, 0 revision_requests, 2 voice_profiles, 0 org_intel. Zero FK
orphans. `public.events` unchanged at 70 rows with `events_immutable` intact. Migration history
untouched at 11 rows. Worker secret resolves from Vault and cron is returning HTTP 200 with no
non-200 responses. Schema fingerprint matches the reconstructed migration replay across all
eight categories with zero exclusions. Repository secret scan clean.

`db/pending_storage_cleanup.txt` has been deleted, its work complete. The record of why it
existed stays in the sections above; nothing here has been rewritten to suggest these problems
never occurred.


---

## Deploy-time `verify_jwt` gap closed (2026-08-23)

The carry-over risk recorded in §1 is resolved.

**Confirmed deployed state:** all eight functions report `verify_jwt: false`, worker at v26.

**Why the repo failed to encode it:** `supabase init` generates a `config.toml` with no
`[functions.*]` section at all — the file had `[api]`, `[db]`, `[auth]`, `[edge_runtime]` and
others, but not a single mention of `verify_jwt`. Supabase's documented default is that edge
functions *require* a valid JWT, so the repository was silently describing the opposite of
production. The only thing holding the real setting in place was remembering
`--no-verify-jwt` on every deploy command, by hand, forever.

**Change applied:** eight `[functions.<slug>]` stanzas, each `verify_jwt = false`. Purely
additive — 48 lines inserted, nothing removed or modified. All eight slugs were checked
against both the deployed slugs and the on-disk directory names; all three sets are identical.
No function source was touched, and no function's own authentication logic was changed:
`x-worker-secret` remains the worker's real authentication, the Stripe signature check remains
the webhook's, and the token/rate-limit gates remain the public endpoints'. These stanzas
govern the gateway check only.

**Scope note.** The gap was raised for `worker`, but the fix covers all eight deliberately. A
bare `supabase functions deploy` deploys every function, so encoding only `worker` would have
left seven identical landmines. Eight stanzas is the smallest change that is actually correct.

**No deployment was performed, and none was needed.** Production already has
`verify_jwt = false` everywhere; the config only affects future deploys. Redeploying to
"prove" it would have bumped worker from v26 to v27 on a live payments system for a
configuration-only change, with nothing gained. Verified instead by parsing the file
(`tomllib`, 8 stanzas resolved), by confirming the CLI itself loads it without error, and by
re-checking that the live project is untouched: worker still v26, all eight still
`verify_jwt: false`, cron still returning HTTP 200.

`supabase config push` was deliberately **not** run. It pushes the whole local config to the
linked project, and this `config.toml` is otherwise `supabase init` defaults for auth, API,
storage and SMTP that have never been reconciled with production — pushing it would overwrite
real settings.
