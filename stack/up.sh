#!/usr/bin/env bash
# Bring up the whole Ktebli stack locally, on Ubuntu.
#
#   stack/up.sh
#
# What this is for: Ktebli has never run end to end against a live crawl. Every
# measurement so far replayed the generation path offline. The first time this
# pipeline meets a real nonprofit's website must not be the first time a customer
# has paid for it.
#
# WHAT RUNS HERE IS WHAT RUNS IN PRODUCTION. Same migrations, same edge functions,
# same config.toml. The only differences are environmental: which database it points
# at, and what is in the Vault. There is no local-only code path, and adding one
# would defeat the purpose of the exercise.
#
# WHAT THIS CANNOT TEST, stated plainly rather than assumed away:
#   - Production's deployed runtime. Edge-function invocation limits, cold starts and
#     the 807-second heartbeat loss are properties of Supabase's platform. They will
#     not reproduce here. Resumability is NOT proven by a local run.
#   - Stripe and Resend are stubbed. No charge is made and no email leaves the machine.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PROD_REF="uocauqflcqefgdixbzpf"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. safety
# Production must be unreachable, not merely unconfigured. A misread env var or a
# stale Vault row should hit a closed socket, not a live customer's worker.
say "checking that production is unreachable from this machine"
if ! grep -q "$PROD_REF" /etc/hosts 2>/dev/null; then
  die "production is still routable.
  Run:  sudo stack/guard-egress.sh
  This blackholes ${PROD_REF}.supabase.co so no local job can reach it.
  Refusing to start a stack that could tick production's worker."
fi
if getent hosts "${PROD_REF}.supabase.co" | grep -qv '^127\.0\.0\.1\|^0\.0\.0\.0'; then
  die "${PROD_REF}.supabase.co does not resolve to a blackhole. Re-run stack/guard-egress.sh"
fi
echo "  ok: ${PROD_REF}.supabase.co is blackholed"

# ---------------------------------------------------------------- 1. secrets
say "checking operator-supplied secrets"
[ -f "$REPO/stack/.env" ] || die "stack/.env is missing. Copy stack/env.example and fill it in.
  The OpenRouter key is set by you here and is never read out of production."
# shellcheck disable=SC1091
set -a; . "$REPO/stack/.env"; set +a
[ -n "${OPENROUTER_API_KEY:-}" ] || die "OPENROUTER_API_KEY is empty in stack/.env"
case "${OPENROUTER_API_KEY}" in sk-or-*) ;; *) die "OPENROUTER_API_KEY does not look like an OpenRouter key" ;; esac
echo "  ok: OpenRouter key present (value never printed)"

# ---------------------------------------------------------------- 2. the stack
say "starting the local Supabase stack"
command -v supabase >/dev/null || die "supabase CLI not found. npm i -g supabase"
command -v docker    >/dev/null || die "docker not found. The local stack needs it.
  Alternative without Docker: stack/up-nodocker.sh (plain Postgres + PostgREST + deno)"

# --local everywhere. The repo's config.toml carries a project_id, and a command that
# forgets --local can reach the linked remote.
supabase start --workdir "$REPO"

DB_URL="$(supabase status --workdir "$REPO" -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
API_URL="$(supabase status --workdir "$REPO" -o env | grep '^API_URL=' | cut -d= -f2- | tr -d '"')"
SRK="$(supabase status --workdir "$REPO" -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
[ -n "$DB_URL" ] || die "could not read the local DB_URL from supabase status"

say "replaying all migrations into the local database"
supabase db reset --local --workdir "$REPO"

# ---------------------------------------------------------------- 3. parity
say "verifying schema parity against the recorded fingerprint"
ACT="$(mktemp)"
psql "$DB_URL" -tAF'|' --no-align -f "$REPO/db/verify_schema_fingerprint.sql" \
  | grep -E '^[a-z_]+\|[0-9a-f]{32}$' | sort > "$ACT"
if diff -u "$REPO/tests/replay/expected-fingerprint.txt" "$ACT"; then
  echo "  ok: all 8 categories match the migration-history fingerprint"
else
  die "the local schema does not match the migration history. Fix that before running anything."
fi

# ---------------------------------------------------------------- 4. vault
say "seeding local Vault"
# worker_url points at the LOCAL functions endpoint. Migration 20260820145930 reads
# the cron target from Vault precisely so a replayed history cannot inherit
# production's URL; this is that mechanism doing its job.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
select vault.create_secret('${API_URL}/functions/v1/worker', 'worker_url')
  where not exists (select 1 from vault.secrets where name = 'worker_url');
select vault.create_secret('${OPENROUTER_API_KEY}', 'openrouter_api_key')
  where not exists (select 1 from vault.secrets where name = 'openrouter_api_key');
-- Stripe and Resend are deliberately absent. sendEmail returns false without a key,
-- so nothing leaves the machine, and no charge can be made.
SQL
echo "  ok: worker_url -> ${API_URL}/functions/v1/worker"
echo "  ok: OpenRouter key in Vault; Stripe and Resend absent by design"

# ---------------------------------------------------------------- 5. functions
say "serving the edge functions"
echo "  run this in a second terminal, and leave it running:"
echo "      supabase functions serve --workdir $REPO --env-file $REPO/stack/.env"
echo
echo "  the worker ticks from pg_cron once the stack is up; to drive it by hand:"
echo "      stack/tick.sh"
echo
say "stack is up"
echo "  API   $API_URL"
echo "  DB    $DB_URL"
echo
echo "  next:  stack/live-run.sh   (the six-site live crawl)"
