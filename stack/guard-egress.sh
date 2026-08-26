#!/usr/bin/env bash
# Make the production project unreachable from this machine.
#
#   sudo stack/guard-egress.sh          # block
#   sudo stack/guard-egress.sh --unblock
#
# Egress to production must be IMPOSSIBLE, not merely unconfigured. A stale Vault
# row, a copied env var or a mistyped flag should hit a closed socket rather than a
# live customer's worker. This is environmental on purpose: putting the guard in the
# code would create a path that exists only because the environment is local, and
# everything built here has to deploy to production unchanged.
set -euo pipefail
PROD_REF="uocauqflcqefgdixbzpf"
HOST="${PROD_REF}.supabase.co"
MARK="# ktebli-local-stack guard"

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

if [ "${1:-}" = "--unblock" ]; then
  sed -i "\|$MARK|d" /etc/hosts
  echo "unblocked: $HOST resolves normally again"
  exit 0
fi

sed -i "\|$MARK|d" /etc/hosts
printf '127.0.0.1 %s %s\n' "$HOST" "$MARK" >> /etc/hosts
printf '127.0.0.1 db.%s %s\n' "$HOST" "$MARK" >> /etc/hosts

echo "blocked. verifying:"
getent hosts "$HOST" || true
if curl -sS --max-time 5 -o /dev/null "https://$HOST/functions/v1/worker" 2>/dev/null; then
  echo "FAIL: production still answered. Do not start the stack."; exit 1
fi
echo "ok: $HOST is unreachable from this machine"
