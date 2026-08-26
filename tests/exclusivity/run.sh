#!/usr/bin/env bash
# Replay the migrations into a throwaway Postgres, then probe the real ceiling on
# one grant by calling claim_approach() directly. No worker, no orders, no models,
# no production, no network.
#
#   tests/exclusivity/run.sh
#
# Exits non-zero while a ceiling exists. That is deliberate: it is the failing test
# for the P0, and it turns green only when a grant can serve any number of applicants.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
RUNDIR="${RUNDIR:-/tmp/ktebli-exclusivity}"
PORT="${PORT:-5434}"
DB=ktebli_exclusivity

psql_() { su postgres -c "psql -h $RUNDIR -p $PORT -v ON_ERROR_STOP=1 $*"; }

rm -rf "$RUNDIR"; mkdir -p "$RUNDIR"; chown postgres:postgres "$RUNDIR"
su postgres -c "$PGBIN/initdb -D $RUNDIR/data -A trust" >/dev/null 2>&1
cp "$REPO"/tests/replay/fake-extensions/* "$(su postgres -c "$PGBIN/pg_config --sharedir")/extension/"
su postgres -c "$PGBIN/pg_ctl -D $RUNDIR/data -l $RUNDIR/pg.log -o '-k $RUNDIR -p $PORT -c listen_addresses=' -w start" >/dev/null
trap 'su postgres -c "'"$PGBIN"'/pg_ctl -D '"$RUNDIR"'/data -m immediate stop" >/dev/null 2>&1 || true' EXIT

psql_ "-d postgres -qc 'create database $DB'"
psql_ "-d $DB -q -f $REPO/tests/replay/shim.sql"
for f in "$REPO"/supabase/migrations/*.sql; do psql_ "-d $DB -q -f $f" >/dev/null; done

psql_ "-d $DB -f $REPO/tests/exclusivity/ceiling_test.sql"
rc=$?
echo
if [ $rc -ne 0 ]; then
  echo "EXCLUSIVITY TEST FAILING — a ceiling still exists on a single grant."
else
  echo "EXCLUSIVITY TEST PASSING — no ceiling."
fi
exit $rc
