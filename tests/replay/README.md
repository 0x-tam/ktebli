# Migration replay test

Replays `supabase/migrations/` into a throwaway Postgres and asserts the resulting
schema is byte-for-byte the same shape as production.

```
tests/replay/run.sh          # replay + assert, exits non-zero on any mismatch
tests/replay/run.sh --keep   # leave the server up to poke at it
```

It never touches the production project and never makes a network call.

## Why it exists

Repo/production parity was verified once, by hand, in a scratch directory that no
longer exists — so the claim "the repo describes production" was true but not
re-checkable. This makes it a test.

## What it asserts

1. **Schema fingerprint.** All eight categories in `db/verify_schema_fingerprint.sql`
   — columns, constraints, functions, grants, indexes, policies, RLS flags, triggers —
   match `expected-fingerprint.txt`, which is what the migration history in this repo
   produces. A mismatch means a migration changed without its fingerprint being updated.
2. **The cron job does not target production.** `20260820145930` originally hardcoded
   the production project URL in `cron.schedule`. Replayed into any other environment
   that job would have ticked *production's* worker every minute. The target now comes
   from a Vault secret, and this test fails if a production ref reappears.
3. **Zero outbound requests.** `pg_net` is shimmed to record rather than send, so a
   replayed cron tick can be inspected without anything leaving the machine.
4. **No literal secret in any migration.** The worker secret is generated per
   environment; a literal in version control fails the run.

## The shims

Supabase-managed objects the migrations reference but never create:

| Object | Shim | Fidelity |
| --- | --- | --- |
| `anon`, `authenticated`, `service_role` | `shim.sql` | NOLOGIN roles; enough for GRANT/REVOKE and RLS to replay |
| Default privileges on `public` | `shim.sql` | Supabase grants the three roles everything on new objects and the migrations revoke on top. Without this the replay under-grants and the `grants` fingerprint diverges. |
| `auth.users`, `auth.uid()` | `shim.sql` | `auth.uid()` returns null — an anonymous caller |
| `storage.buckets/objects/foldername` | `shim.sql` | structure only |
| `vault.*` | `shim.sql` | plaintext, not encrypted. Safe because the replay DB is thrown away and no migration carries a real secret. |
| `pgvector` | `fake-extensions/vector` | a type named `vector` that accepts a typmod, borrowing varchar's I/O. No distance operators, no index support. The two `vector(1536)` columns are excluded from the column fingerprint — hence the category name `columns_nonvector`. |
| `pg_cron` | `fake-extensions/pg_cron` | `cron.schedule` records the job instead of scheduling it |
| `pg_net` | `fake-extensions/pg_net` | `net.http_post` records the request instead of sending it |

## Two fingerprints, and why

- **`expected-fingerprint.txt`** — what `supabase/migrations/` produces. Repo truth.
  The replay is asserted against this, and a mismatch fails the run.
- **`production-fingerprint.txt`** — the live project as last observed, with the date.

While a migration is written but not yet deployed the two differ, and the run reports
`UNDEPLOYED MIGRATIONS` listing exactly which categories moved. That is a normal state,
not a failure — but it is never invisible. After deploying, re-read the live values and
update `production-fingerprint.txt` in the same commit.

## When a fingerprint changes

A mismatch means the repo and production have diverged. Find out which moved before
touching `expected-fingerprint.txt` — updating it to make the test pass is how parity
gets silently lost. If a migration was added deliberately, re-read the live values and
update the file in the same commit as the migration.
