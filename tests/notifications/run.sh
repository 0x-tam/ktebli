#!/usr/bin/env bash
# Notification suites (phase 6.1). Offline: no Supabase stack, no model calls,
# no email delivery. The stub test runs the REAL worker under plain Deno with
# localhost-only network permission and needs host port 8000 free (the worker's
# Deno.serve default).
#
#   tests/notifications/run.sh
#
# NOTE: tests/run-all.sh does not include this directory (it is owned by
# another workstream); run this script directly, or add the two lines below to
# run-all.sh when merging.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DENO="${DENO:-npx --yes deno@2.9.5}"
rc=0

echo "=============== notification wordings and class separation"
$DENO run --node-modules-dir=none --allow-read "$REPO/tests/notifications/wording_test.ts" || rc=1

echo
echo "=============== terminal notification, executed against the stub stack"
$DENO run --node-modules-dir=none --allow-net=127.0.0.1,0.0.0.0,localhost --allow-read --allow-env --allow-run \
  "$REPO/tests/notifications/terminal_notify_stub_test.ts" || rc=1

echo
if [ $rc -eq 0 ]; then echo "ALL NOTIFICATION TESTS PASSED"; else echo "NOTIFICATION TEST FAILURES"; fi
exit $rc
