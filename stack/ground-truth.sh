#!/usr/bin/env bash
# Capture what a site ACTUALLY contains, using a real browser, so the crawler's
# output can be compared against ground truth rather than against an assumption.
#
#   stack/ground-truth.sh sites.txt out/
#
# WHY A BROWSER, AND WHY IT IS NOT THE CRAWLER. The production crawler is a Deno
# edge function: it does one HTTP fetch per page and cannot execute JavaScript. That
# is a fixed constraint (eight edge functions, no new services), so a JS-rendered
# site is correctly reported as the js_only outcome rather than worked around.
#
# But "the crawler got nothing" and "there was nothing to get" are different
# findings, and only one of them is a bug. This renders each site the way a person's
# browser would, extracts the visible text, and counts named referents with the same
# deterministic counter the pipeline uses. The six-site live run compares the two:
#
#   referents visible in a real browser   vs   referents the crawler extracted
#
# A large gap on a site the crawler called "succeeded" is an extraction bug. A large
# gap on one it called "js_only" is the taxonomy working correctly.
#
# This is a TEST HARNESS. It never runs in production and nothing in the pipeline
# depends on it.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITES="${1:?usage: ground-truth.sh <sites.txt> <outdir>}"
OUT="${2:?usage: ground-truth.sh <sites.txt> <outdir>}"
CHROME="${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome)"
[ -x "$CHROME" ] || { echo "no chromium found; set CHROME=/path/to/chrome"; exit 1; }
mkdir -p "$OUT"

printf '%-38s %10s %10s\n' SITE TEXT_CHARS REFERENTS
while read -r url; do
  [ -z "$url" ] && continue
  case "$url" in \#*) continue ;; esac
  name="$(echo "$url" | sed 's|https\?://||; s|/.*||')"
  timeout 90 "$CHROME" --headless --disable-gpu --no-sandbox \
    --dump-dom --virtual-time-budget=20000 "$url" > "$OUT/$name.html" 2>/dev/null || true
  python3 - "$OUT/$name.html" "$OUT/$name.txt" <<'PY'
import re, sys
h = open(sys.argv[1], encoding='utf8', errors='replace').read()
t = re.sub(r'<script.*?</script>|<style.*?</style>|<!--.*?-->', ' ', h, flags=re.S)
t = re.sub(r'<[^>]+>', ' ', t)
open(sys.argv[2], 'w').write(re.sub(r'\s+', ' ', t).strip())
PY
  chars=$(wc -c < "$OUT/$name.txt")
  refs=$(cd "$REPO" && npx --yes deno@2.9.5 eval "
    import { properNouns } from './supabase/functions/worker/proper_nouns.ts';
    const t = await Deno.readTextFile('$OUT/$name.txt');
    console.log(properNouns(t).filter(p => p.split(/\s+/).length > 1).length);
  " 2>/dev/null || echo "?")
  printf '%-38s %10s %10s\n' "$name" "$chars" "$refs"
done < "$SITES"
