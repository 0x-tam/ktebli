#!/usr/bin/env bash
# Race-safety proof for the composition lock.
#
# The ceiling test runs serially, so it proves the space is open but not that the
# database arbitrates it correctly under contention. This fires real concurrent
# sessions and asserts two things:
#
#   1. Same fingerprint, N racing sessions -> exactly one wins, N-1 get
#      fingerprint_taken. The partial unique index is the arbiter, not the worker.
#   2. 40 applicants claiming CONCURRENTLY on one grant -> all 40 served. If
#      anything serialized them into a queue, or if contention caused a refusal,
#      this is where it shows.
#
# Called by tests/exclusivity/run.sh against the already-replayed database.
set -uo pipefail
RUNDIR="${RUNDIR:-/tmp/ktebli-exclusivity}"
PORT="${PORT:-5434}"
DB="${DB:-ktebli_exclusivity}"
RACERS="${RACERS:-16}"
WORK="$(mktemp -d)"; chmod 777 "$WORK"
q() {  # run a statement via a file: nested shell quoting mangles ::jsonb casts
  local f; f=$(mktemp "$WORK/q.XXXXXX.sql"); printf '%s\n' "$1" > "$f"; chmod 644 "$f"
  su postgres -c "psql -h $RUNDIR -p $PORT -d $DB -tAq -f $f"
}

echo "=== 1. $RACERS sessions racing ONE fingerprint ==="
q "insert into public.grants (funder,title,title_normalized,guidelines_text)
   values ('Race','Race Grant','race grant','x') on conflict do nothing" >/dev/null
GRANT=$(q "select id from public.grants where title='Race Grant'")

for i in $(seq 1 "$RACERS"); do
  q "insert into auth.users (email) values ('race$i@example.invalid')" >/dev/null
  q "insert into public.organisations (owner_id,name,registration_number,email)
     select id,'Race Org $i','REG-R$i',email from auth.users where email='race$i@example.invalid'" >/dev/null
done

# Every racer submits the SAME digest at the same moment, from its own session.
tmp=$(mktemp -d)
for i in $(seq 1 "$RACERS"); do
  (
    vp=$(q "insert into public.voice_profiles (organisation_id,kind,profile)
            select id,'custom','{}' from public.organisations where name='Race Org $i' returning id")
    org=$(q "select id from public.organisations where name='Race Org $i'")
    q "select public.claim_approach('$org'::uuid,'$GRANT'::uuid,
         'i$i','d$i','b$i','g$i','m$i',
         repeat('f',64), jsonb_build_object('spine','place'), '{}'::jsonb,
         1::smallint, '$vp'::uuid, 'custom')" > "$tmp/$i.out" 2>&1
  ) &
done
wait

won=$(grep -l '"granted": true' "$tmp"/*.out 2>/dev/null | wc -l)
taken=$(grep -l 'fingerprint_taken' "$tmp"/*.out 2>/dev/null | wc -l)
rows=$(q "select count(*) from public.claims where grant_id='$GRANT' and status in ('hold','confirmed')")
echo "  granted: $won   fingerprint_taken: $taken   live claims on the grant: $rows"

fail=0
[ "$won" = "1" ] || { echo "  FAIL: expected exactly 1 winner, got $won"; fail=1; }
[ "$taken" = "$((RACERS-1))" ] || { echo "  FAIL: expected $((RACERS-1)) fingerprint_taken, got $taken"; fail=1; }
[ "$rows" = "1" ] || { echo "  FAIL: the index let $rows rows through"; fail=1; }
[ $fail = 0 ] && echo "  ok: the partial unique index arbitrated, not the worker"

echo
echo "=== 2. 40 applicants claiming CONCURRENTLY on one grant ==="
q "insert into public.grants (funder,title,title_normalized,guidelines_text)
   values ('Conc','Concurrent Grant','concurrent grant','x') on conflict do nothing" >/dev/null
CG=$(q "select id from public.grants where title='Concurrent Grant'")
tmp2=$(mktemp -d)
for i in $(seq 1 40); do
  (
    q "insert into auth.users (email) values ('conc$i@example.invalid')" >/dev/null
    q "insert into public.organisations (owner_id,name,registration_number,email)
       select id,'Conc Org $i','REG-C$i',email from auth.users where email='conc$i@example.invalid'" >/dev/null
    org=$(q "select id from public.organisations where name='Conc Org $i'")
    vp=$(q "insert into public.voice_profiles (organisation_id,kind,profile)
            values ('$org'::uuid,'custom','{}') returning id")
    # Each draws its own composition, as the composer does.
    q "select public.claim_approach('$org'::uuid,'$CG'::uuid,
         'i$i','d$i','b$i','g$i','m$i',
         encode(sha256(('draw-'||'$i')::bytea),'hex'), jsonb_build_object('n',$i), '{}'::jsonb,
         1::smallint, '$vp'::uuid, 'custom')" > "$tmp2/$i.out" 2>&1
  ) &
done
wait

served=$(grep -l '"granted": true' "$tmp2"/*.out 2>/dev/null | wc -l)
refused=$(grep -L '"granted": true' "$tmp2"/*.out 2>/dev/null | wc -l)
echo "  served: $served   refused: $refused"
if [ "$served" != "40" ]; then
  echo "  FAIL: concurrent claiming refused $refused applicant(s):"
  grep -h 'blocked_by' "$tmp2"/*.out 2>/dev/null | sort | uniq -c | head
  fail=1
else
  echo "  ok: 40 concurrent applicants on one grant, none refused, none queued"
fi

rm -rf "$tmp" "$tmp2" "$WORK"
exit $fail
