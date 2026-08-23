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

All eight functions currently have `verify_jwt = false`, so **every** deploy command
below needs `--no-verify-jwt`. Deploying without it would turn JWT verification on and
break the callers (Stripe, pg_cron, the public web wizard, the order page).

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
  `openrouter_api_key`, `openrouter_model`, `resend_api_key`, `email_from`,
  `stripe_webhook_secret`, `site_url`, `support_email`, `worker_secret`. Manage them in
  the dashboard's Vault, not via `supabase secrets set` — the code does not read
  `Deno.env` for these. The only env vars the functions read directly are
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform injects.
- A pg_cron job `ktebli-worker-tick` runs every minute and POSTs to the `worker`
  function with the `x-worker-secret` header. It lives in the database, not in this
  repo — see `db/schema.sql` section 7. Redeploying `worker` does not disturb it.
- `db/schema.sql` is a reference dump assembled from catalog queries. It is **not**
  replayable as a migration and there are no migration files in this handoff. Use
  `supabase db pull` against the linked project if you need real migrations.
