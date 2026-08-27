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
run "contact-detail fabrication"           $DENO run "$REPO/tests/contact-claims/contact_claims_test.ts"
run "crawler outcome taxonomy"             $DENO run "$REPO/tests/crawl-outcome/crawl_outcome_test.ts"
run "donor-scoped word limit"              $DENO run --allow-read "$REPO/tests/word-limit/word_limit_test.ts"
run "referent weight"                      $DENO run --allow-read "$REPO/tests/referent-weight/referent_weight_test.ts"
run "donor limit literal forms"            $DENO run --allow-read "$REPO/tests/donor-limits/donor_limits_test.ts"
# Written by agents trying to BREAK each invariant. All four broke it on first contact
# and every one of these failed against the code as shipped. They stay in the suite.
for t in "$REPO"/tests/adversarial/*_test.ts; do
  run "adversarial: $(basename "$t" _test.ts)" $DENO run --allow-read "$t"
done

echo
if [ $rc -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "SUITE FAILURES (exit $rc)"; fi
exit $rc
