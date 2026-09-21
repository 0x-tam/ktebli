#!/usr/bin/env bash
# Replay every migration into a throwaway Postgres and print the schema fingerprint.
#
# Why this exists: repo/production schema parity was verified once, by hand, in a
# scratch directory that no longer exists. This makes it reproducible.
#
# It never touches production and never makes a network call: pg_net is shimmed to
# record requests, and pg_cron is shimmed to record jobs rather than run them.
#
#   tests/replay/run.sh            # replay + fingerprint
#   tests/replay/run.sh --keep     # leave the server running for inspection
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
RUNDIR="${RUNDIR:-/tmp/ktebli-replay}"
PORT="${PORT:-5433}"
DB=ktebli_replay
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

psql_() { su postgres -c "psql -h $RUNDIR -p $PORT -v ON_ERROR_STOP=1 $*"; }

echo "==> preparing throwaway cluster in $RUNDIR"
rm -rf "$RUNDIR"; mkdir -p "$RUNDIR"; chown postgres:postgres "$RUNDIR"
su postgres -c "$PGBIN/initdb -D $RUNDIR/data -A trust" >/dev/null

echo "==> installing replay shims for pgvector / pg_cron / pg_net"
EXTDIR="$(su postgres -c "$PGBIN/pg_config --sharedir")/extension"
cp "$REPO"/tests/replay/fake-extensions/* "$EXTDIR/"

su postgres -c "$PGBIN/pg_ctl -D $RUNDIR/data -l $RUNDIR/pg.log -o '-k $RUNDIR -p $PORT -c listen_addresses=' -w start" >/dev/null
trap '[ "$KEEP" = 0 ] && su postgres -c "'"$PGBIN"'/pg_ctl -D '"$RUNDIR"'/data -m immediate stop" >/dev/null 2>&1 || true' EXIT

psql_ "-d postgres -qc 'create database $DB'"
echo "==> applying shim"
psql_ "-d $DB -q -f $REPO/tests/replay/shim.sql"

echo "==> replaying migrations in order"
for f in "$REPO"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql_ "-d $DB -q -f $f"
done

echo
echo "==> schema fingerprint (must match what the migration history produces)"
EXPECTED="$REPO/tests/replay/expected-fingerprint.txt"
ACTUAL="$RUNDIR/actual-fingerprint.txt"
psql_ "-d $DB -tAF'|' --no-align -f $REPO/db/verify_schema_fingerprint.sql" \
  | grep -E '^[a-z_]+\|[0-9a-f]{32}$' | sort > "$ACTUAL"
cat "$ACTUAL"

fail=0
if ! diff -u "$EXPECTED" "$ACTUAL" >/dev/null; then
  echo
  echo "FAIL: fingerprint differs from production. -expected +actual"
  diff -u "$EXPECTED" "$ACTUAL" || true
  fail=1
else
  echo "  -> all 8 categories match the recorded migration-history fingerprint"
fi

# The repo may legitimately be AHEAD of production while a migration is written but
# not yet deployed. That is not a parity failure, but it must never be invisible.
echo
echo "==> deployment state"
PROD="$RUNDIR/prod-fingerprint.txt"
grep -vE '^\s*(#|$)' "$REPO/tests/replay/production-fingerprint.txt" | sort > "$PROD"
if diff -q "$EXPECTED" "$PROD" >/dev/null 2>&1; then
  echo "  in sync: the migration history produces exactly what production last reported"
else
  echo "  UNDEPLOYED MIGRATIONS: the repo is ahead of production in these categories:"
  { diff "$PROD" "$EXPECTED" || true; } | grep -E '^[<>]' | awk '{print "    " $0}'
  echo "  (production-fingerprint.txt records the live project as last observed;"
  echo "   re-read it from the live project after deploying, in the same commit.)"
fi

echo
echo "==> replay safety"
# 20260820145930 used to hardcode the production project URL in cron.schedule.
# Replayed anywhere else that job would tick production's worker every minute.
if psql_ "-d $DB -tAc \"select command from cron.job where jobname='ktebli-worker-tick'\"" \
   | grep -q uocauqflcqefgdixbzpf; then
  echo "  FAIL: cron command hardcodes the production project"
  fail=1
else
  echo "  ok: cron target is resolved from Vault, not hardcoded to production"
fi

# Nothing may leave the machine during a replay.
n=$(psql_ "-d $DB -tAc 'select count(*) from net.http_request_log'" | tr -d ' ')
if [ "$n" != "0" ]; then echo "  FAIL: $n outbound request(s) during replay"; fail=1
else echo "  ok: zero outbound requests"; fi

# The worker secret must be generated, never a literal from version control.
if grep -qE "create_secret\('[A-Za-z0-9_-]{8,}'" "$REPO"/supabase/migrations/*.sql; then
  echo "  FAIL: a migration carries a literal secret"; fail=1
else echo "  ok: no literal secret in any migration"; fi

[ "$KEEP" = 1 ] && echo "server left running on $RUNDIR:$PORT (db $DB)"
if [ "$fail" != 0 ]; then echo; echo "REPLAY FAILED"; exit 1; fi
echo; echo "REPLAY OK"
exit 0
