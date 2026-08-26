#!/usr/bin/env bash
# Every test in the repo. No network, no production, no deploys.
#
#   tests/run-all.sh
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DENO="${DENO:-npx --yes deno@2.9.5}"
rc=0
run() { echo; echo "=============== $1"; shift; "$@"; local s=$?; [ $s -ne 0 ] && rc=$s; return 0; }

run "migration replay and schema parity"   "$REPO/tests/replay/run.sh"
run "exclusivity: ceiling, stranded claims, concurrency" "$REPO/tests/exclusivity/run.sh"
run "proper-noun audit"                    $DENO run "$REPO/tests/proper-nouns/proper_nouns_test.ts"
run "numeric register"                     $DENO run "$REPO/tests/numeric-register/numeric_register_test.ts"
# --allow-read: these assert against their own module source, so that a threshold or a
# gate constant cannot quietly grow a second definition somewhere else in the file.
run "pre-delivery quality gate"            $DENO run --allow-read "$REPO/tests/delivery-gate/delivery_gate_test.ts"
run "pre-payment sufficiency gate"         $DENO run --allow-read "$REPO/tests/sufficiency/sufficiency_test.ts"

echo
if [ $rc -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "SUITE FAILURES (exit $rc)"; fi
exit $rc
