# Ktebli — Supabase deployment reference

**Project ref:** `uocauqflcqefgdixbzpf`
**Project name:** Ktebli
**Functions base URL:** `https://uocauqflcqefgdixbzpf.supabase.co/functions/v1/<slug>`

Captured 2026-08-23 from the live project.

## Layout

```
handoff/
  supabase/functions/<slug>/...   # edge function sources (CLI layout)
  db/schema.sql                   # readable schema reference (not replayable)
  DEPLOY.md
```

There is **no `supabase/config.toml`** in this handoff. If the CLI complains that the
directory is not a Supabase project, run `supabase init` in the parent of `supabase/`
first — it will not overwrite the existing `functions/` directory. Verify this before
relying on it.

## First-time setup

```bash
supabase login
supabase link --project-ref uocauqflcqefgdixbzpf
```

Run subsequent commands from the directory that contains `supabase/`.

## Deployed functions

All eight functions run with `verify_jwt = false`. **This is now encoded in
`supabase/config.toml`** as a `[functions.<slug>]` stanza per function, so a plain
`supabase functions deploy` preserves it. The CLI defaults `verify_jwt` to true, and before
those stanzas existed a deploy that forgot `--no-verify-jwt` would have turned JWT
verification on and broken every caller: Stripe, pg_cron's worker tick, the public wizard
and the order page.

The `--no-verify-jwt` flag is kept on the commands below as belt-and-braces. It is no longer
the only thing protecting the setting, but it costs nothing and matches what is deployed.

| slug                 | deployed version | verify_jwt | files                  |
| -------------------- | ---------------- | ---------- | ---------------------- |
| `analyze-grant`      | 3                | false      | index.ts, ssrf.ts, http.ts |
| `stripe-webhook`     | 9                | false      | index.ts               |
| `worker`             | 26               | false      | index.ts, ssrf.ts      |
| `order-status`       | 4                | false      | index.ts, http.ts      |
| `save-intake`        | 4                | false      | index.ts, http.ts      |
| `upload-intake-file` | 2                | false      | index.ts, http.ts      |
| `request-revision`   | 3                | false      | index.ts, http.ts      |
| `qa-visual-test`     | 3                | false      | index.ts (retired 410 stub) |

Version numbers are the versions live at capture time. Each successful deploy
increments the version on Supabase's side; you do not set it.

## Deploy commands

```bash
supabase functions deploy analyze-grant      --no-verify-jwt
supabase functions deploy stripe-webhook     --no-verify-jwt
supabase functions deploy worker             --no-verify-jwt
supabase functions deploy order-status       --no-verify-jwt
supabase functions deploy save-intake        --no-verify-jwt
supabase functions deploy upload-intake-file --no-verify-jwt
supabase functions deploy request-revision   --no-verify-jwt
supabase functions deploy qa-visual-test     --no-verify-jwt
```

Add `--project-ref uocauqflcqefgdixbzpf` to any command if you have not linked, or if
you have several projects linked and want to be explicit.

## Notes

- **`worker` has two files** — `index.ts` and `ssrf.ts`. The CLI deploys the whole
  `supabase/functions/worker/` directory, so a plain
  `supabase functions deploy worker --no-verify-jwt` ships both. Do not try to deploy
  individual files. The same applies to `analyze-grant` (three files) and the four
  functions that carry their own `http.ts`.
- The `worker` source in this handoff is the authoritative local `v12` source, verified
  byte-identical to deployed v26 (`index.ts` 129,431 bytes; `ssrf.ts` 5,412 bytes).
- `http.ts` and `ssrf.ts` are **duplicated per function directory**, not shared. Two
  slightly different `http.ts` variants exist in the deployed code (a commented long
  form in `analyze-grant`/`request-revision`, a compact form in the other three). They
  are functionally the same; both are preserved as deployed.
- **Secrets are not in this repo.** Functions read them at runtime through the
  `public.get_secret(text)` RPC, which reads Supabase Vault. Names in use:
  `openrouter_api_key`, `openrouter_model`, `openrouter_model_strategy`, `resend_api_key`,
  `email_from`, `stripe_webhook_secret`, `site_url`, `support_email`, `worker_secret`.
  Manage them in the dashboard's Vault, not via `supabase secrets set` — the code does
  not read `Deno.env` for these. The only env vars the functions read directly are
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform injects.
  - **Per-tier model selection (phase 8 follow-on).** Four more, all optional and all
    defaulting to unset (falls straight through to `openrouter_model`, so setting none
    of these changes nothing): `openrouter_model_draft`, `openrouter_model_competitive`,
    `openrouter_model_full` (the model Full uses when no pool entry matches), and
    `openrouter_model_full_pool` — a JSON array picking Full's model by the grant itself:
    `[{"match":"research|scientific|clinical","model":"provider/model-id"},{"match":"community|grassroots","model":"provider/model-id"}]`.
    `match` is a case-insensitive regex tested against the grant's issuer/programme/
    summary/priorities; first match wins, no match falls back to `openrouter_model_full`.
    **Do not point a tier at a model that has not been run through a real order first** —
    this project's own history is JSON-malformation rates, a design-stage runaway, and a
    currency default that are all model-specific and were only found by driving real
    orders end to end (reports/phase8-intake.md). Setting the secret is not validation.
  - **Target model config (decided 2026-09-02, not yet validated in a real order):**
    `openrouter_model_draft = anthropic/claude-sonnet-5`,
    `openrouter_model_competitive = anthropic/claude-opus-5` (the one proven model this
    whole pipeline has been tuned against — safe as the always-on fallback for every
    tier until its replacement is proven),
    `openrouter_model_full = anthropic/claude-fable-5.1` (2x Opus 5's price on
    OpenRouter; zero real orders through it as of this note). **Do not set Draft or
    Full live for paying customers until each has cleared one real order end to end** —
    Competitive can go live immediately since it stays on the proven model.
  - **Spend caps (the runaway backstop).** Three secrets, dollars, checked BEFORE every
    stage — a proposal at or over its tier's cap is refused further model work and
    raises a `spend_cap` escalation (immediate priority) rather than spending another
    cent: `spend_cap_draft_usd` (default 6), `spend_cap_competitive_usd` (default 10),
    `spend_cap_full_usd` (default 20). Defaults are generous headroom over the
    estimated per-order cost, not a budget target — they exist to catch a BUG (a retry
    or resumable-stage loop that never converges), the exact failure this project's own
    phase-8 re-run hit with no code-level backstop. Also `openrouter_balance_floor_usd`
    (default 3) — a SEPARATE, account-wide check: before claiming any stage at all, the
    worker reads the real live OpenRouter balance and refuses to claim ANYTHING this
    tick if it is at or under the floor. Non-destructive — stages are simply not
    claimed, not failed; the next tick resumes normally once credit is added.
- A pg_cron job `ktebli-worker-tick` runs every minute and POSTs to the `worker`
  function with the `x-worker-secret` header. It lives in the database, not in this
  repo — see `db/schema.sql` section 7. Redeploying `worker` does not disturb it.
- `db/schema.sql` is a reference dump assembled from catalog queries. It is **not**
  replayable as a migration — it has no `CREATE TABLE`, no constraints, and its RLS,
  policy and cron sections are comments. Keep it as the human-readable reference.
- **`supabase/migrations/` now holds the real migration history** — all 11 migrations,
  recovered from `supabase_migrations.schema_migrations` on the live project, which had
  been tracking them all along even though the files were never in this repo. Ten are
  byte-identical to the recorded statements; `20260820145930_secrets_grants_and_cron.sql`
  is deliberately redacted (see below).
- Verified by replaying all 11 in order into a clean Postgres and comparing schema
  fingerprints against production: columns, constraints, indexes, grants, RLS flags,
  functions, policies and the trigger all matched exactly. Re-check any database with
  `db/verify_schema_fingerprint.sql`.
- **Synthetic data was removed from production on 2026-08-23**, in two passes: the 13
  benchmark orders plus `public.bench_cases` (which no migration described), then the four
  `test-org*` orders. Production now holds only the two $1 trial orders, KT-10001 and
  KT-10002, and its schema matches the migration history exactly, with no exclusions.
- **Storage is clean.** The 27 objects belonging to those deleted orders were removed from the
  `order-files` bucket on 2026-08-23. The bucket now holds exactly two objects, one each for
  KT-10001 and KT-10002. No agent session could perform that deletion — the Supabase MCP server
  exposes no storage-object delete tool, and both the project host and the management API are
  refused by this environment's egress policy — so it was done from the dashboard and verified
  from the database side afterwards.
- The three zero-referenced benchmark grant rows (`... (RB-R1/R2/R3)`) were deleted on
  2026-08-23 after re-verifying that nothing referenced them. Production now holds three
  grants, all belonging to the two retained trial orders.
- **Do not `supabase db push`.** These migrations are already applied in production;
  the versions match the remote history, so the CLI should see nothing to do. If it
  ever reports them as pending, repair the history rather than re-running them.
- **`20260820145930` contained the live `worker_secret` in plaintext** in its
  `vault.create_secret` call. The committed file replaces it with `__WORKER_SECRET__`.
  The real value is still sitting in the remote migration history — rotate it.
