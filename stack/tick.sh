#!/usr/bin/env bash
# Drive the local worker by hand: one tick, authenticated from the local Vault.
# Referenced by stack/up.sh since the stack landed; it now exists (phase 0 finding).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
FN_URL="${FN_URL:-http://127.0.0.1:54321/functions/v1/worker}"
SEC="$(psql "$DB_URL" -tAc "select public.get_secret('worker_secret')")"
[ -n "$SEC" ] || { echo "FATAL: no worker_secret in the local Vault. Run stack/up.sh first." >&2; exit 1; }
SRK="$(supabase status --workdir "$REPO" -o env 2>/dev/null | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
curl -sS -X POST -H "Authorization: Bearer ${SRK}" -H "x-worker-secret: ${SEC}" \
     -H "Content-Type: application/json" -d '{}' "$FN_URL"
echo
