#!/usr/bin/env bash
# The six-site live crawl.
#
#   stack/live-run.sh sites.txt [outdir]
#
# WHAT THIS IS FOR. Ktebli's crawler has never been run against a real nonprofit
# website by anyone who then looked at what it returned. It fetched the HTTP status
# and discarded it (worker/ssrf.ts returns it; no caller read it), so a 403 from a
# WAF, a 404, a JavaScript-only shell and a site with genuinely nothing to say all
# produced the same thing: `pages: []`, a `meta` with no error key, and one useless
# sentence for the customer. This run exercises the real crawl path against real
# sites and prints, for each one, WHICH of those happened.
#
# It is the test set for the outcome taxonomy in
# supabase/functions/worker/crawl_outcome.ts, and the pre-payment sufficiency gate
# depends on it: a silent failure used to yield a generic proposal, and now costs a
# sale or forces a refund.
#
# WHAT RUNS HERE IS WHAT RUNS IN PRODUCTION. The traversal, the robots parser, the
# challenge detector, the paragraph filter, the referent counter and the identity
# gate are imported from the worker's own module — none of them is reimplemented
# here. The script refuses to run if `worker/index.ts` does not delegate to that
# module, because then it would be measuring something the pipeline does not use.
#
# PRODUCTION IS UNREACHABLE, AND THAT IS VERIFIED RATHER THAN ASSUMED. Three
# independent guards, all environmental:
#   1. /etc/hosts must blackhole the production project (stack/guard-egress.sh);
#   2. Deno runs with --deny-net on the production hosts, which overrides
#      --allow-net, so this process cannot open that socket even if DNS lied;
#   3. before crawling anything the driver TRIES to reach production and requires
#      the attempt to fail. A run that could reach production stops there.
# No database, no Vault, no OpenRouter key and no Stripe key are used or needed, so
# this run cannot touch a customer, a card or a model bill.
#
# THE IDENTITY GATE IS NOT SOFTENED TO MAKE THE TABLE LOOK BETTER. An empty
# surviving-referents column is the correct result for a site we cannot confidently
# attribute to the applicant. Discarding good evidence is the trade the gate exists
# to make, and no flag here changes it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_REF="uocauqflcqefgdixbzpf"
DENO="${DENO:-npx --yes deno@2.9.5}"
MODULE="$REPO/supabase/functions/worker/crawl_outcome.ts"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

SITES="${1:-}"
OUT="${2:-$REPO/stack/out/live-run-$(date -u +%Y%m%dT%H%M%SZ)}"

if [ -z "$SITES" ]; then
  cat >&2 <<'USAGE'
usage: stack/live-run.sh <sites.txt> [outdir]

sites.txt carries one site per line: the URL and the applicant's organisation
name, separated by a pipe. The name is REQUIRED. It is what the identity gate
matches against, and deriving it from the domain would make the gate pass by
construction and the column meaningless.

    # the six-site live run
    https://thefelixproject.org.uk  | The Felix Project
    https://www.magicbreakfast.com  | Magic Breakfast
    https://www.ukyouth.org         | UK Youth

Lines beginning with # are ignored.
USAGE
  exit 2
fi
[ -f "$SITES" ] || die "no such sites file: $SITES"
# Absolute paths: the Deno permission flags below are exact, and a relative path
# would be granted against the wrong root.
SITES="$(cd "$(dirname "$SITES")" && pwd)/$(basename "$SITES")"

# ---------------------------------------------------------------- 0. guards
say "checking that production is unreachable from this machine"
if ! grep -q "$PROD_REF" /etc/hosts 2>/dev/null; then
  die "production is still routable.
  Run:  sudo stack/guard-egress.sh
  This blackholes ${PROD_REF}.supabase.co. Refusing to run a live crawl from a
  machine that can still reach a customer's worker."
fi
if getent hosts "${PROD_REF}.supabase.co" | grep -qv '^127\.0\.0\.1\|^0\.0\.0\.0'; then
  die "${PROD_REF}.supabase.co does not resolve to a blackhole. Re-run stack/guard-egress.sh"
fi
echo "  ok: ${PROD_REF}.supabase.co is blackholed in /etc/hosts"

if grep -qiE "supabase\.(co|com)|${PROD_REF}" "$SITES"; then
  die "$SITES names a Supabase host. This harness crawls applicant websites only."
fi
echo "  ok: the sites file names no Supabase host"

say "checking that this measures the pipeline's own crawl path"
[ -f "$MODULE" ] || die "missing $MODULE"
if ! grep -q 'crawl_outcome.ts' "$REPO/supabase/functions/worker/index.ts"; then
  die "worker/index.ts does not import crawl_outcome.ts.
  The crawler patch has not been applied yet, so a run now would measure a module
  the pipeline does not call. Apply the patch spec first (qloop/inv/patch-crawl.md)."
fi
echo "  ok: worker/index.ts delegates to crawl_outcome.ts"

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# ---------------------------------------------------------------- 1. driver
# Written to a temp directory rather than into the repo: it is scaffolding for one
# run, not a module anything ships. It implements no crawling of its own.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DRIVER="$WORK/live_run_driver.ts"

cat > "$DRIVER" <<'DRIVER_EOF'
// Generated by stack/live-run.sh. Every behaviour under test is imported.
import {
  classifyCrawl, crawlCorpus, crawlSiteObserved, identityVerdict,
  siteNameCandidates, siteReferents,
} from "__CRAWL_MODULE__";
import type { ClassifyInput, CrawlReport } from "__CRAWL_MODULE__";

const sitesFile = Deno.args[0];
const outDir = Deno.args[1];
const prodHost = Deno.args[2];

// GUARD 3: production must be unreachable in fact, not merely in intention.
try {
  await fetch(`https://${prodHost}/functions/v1/worker`);
  console.error(`FATAL: production (${prodHost}) answered. Refusing to crawl.`);
  Deno.exit(3);
} catch {
  // Either --deny-net refused the socket or the /etc/hosts blackhole did.
}

interface Row { site: string; org: string; report: CrawlReport; referents: string[] }
const rows: Row[] = [];

for (const raw of (await Deno.readTextFile(sitesFile)).split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const [urlPart, ...rest] = line.split("|");
  const site = urlPart.trim();
  const org = rest.join("|").trim();
  if (!org) { console.error(`  skipped (no organisation name): ${site}`); continue; }

  const started = Date.now();
  const crawl = await crawlSiteObserved(site);
  const corpus = crawlCorpus(crawl.pages);
  const referents = siteReferents(corpus, org);

  // The identity gate needs the name the SITE states about itself. In the pipeline
  // that is `profile.legal_name` from the extraction call. Here it is the single
  // most authoritative name the homepage declares — og:site_name, then
  // application-name, then a JSON-LD name, then the <title>. ONE candidate is
  // used, never "whichever one clears": trying several would make the gate easier
  // to pass, and the asymmetry is the point.
  const home = crawl.observations.pages.find((p) => p.role === "home");
  const statedName = home ? (siteNameCandidates(home.body_sample)[0] ?? null) : null;

  const siteDerived = crawl.pages.length > 0;
  const gate = crawl.observations.domain && (referents.length || siteDerived)
    ? identityVerdict(org, statedName, crawl.observations.domain)
    : "not_run";

  const input: ClassifyInput = {
    ...crawl.observations,
    referents_extracted: referents.length,
    referents_surviving: gate === "cleared" ? referents.length : 0,
    identity_gate: gate,
    site_derived_output: siteDerived,
  };
  const report = classifyCrawl(input);
  rows.push({ site, org, report, referents });

  await Deno.writeTextFile(
    `${outDir}/${(crawl.observations.domain ?? "bad-url").replace(/[^a-z0-9.-]/gi, "_")}.json`,
    JSON.stringify({
      site, org, stated_name: statedName, report, referents,
      pages: crawl.pages.map((p) => ({ url: p.url, chars: p.text.length })),
      observations: crawl.observations, wall_ms: Date.now() - started,
    }, null, 2),
  );
}

const W_SITE = 34, W_OUT = 18, W_N = 8;
const pad = (s: string, n: number) =>
  (s.length > n ? s.slice(0, n - 1) + "…" : s + " ".repeat(n - s.length));

console.log("");
console.log(
  pad("SITE", W_SITE) + pad("OUTCOME", W_OUT) +
  "FETCHED".padStart(W_N) + "PARSED".padStart(W_N) +
  "REFS".padStart(W_N) + "KEPT".padStart(W_N) + "  REASON",
);
console.log("-".repeat(W_SITE + W_OUT + W_N * 4 + 10));
for (const r of rows) {
  console.log(
    pad(r.site.replace(/^https?:\/\//, ""), W_SITE) +
    pad(r.report.outcome, W_OUT) +
    String(r.report.pages_fetched).padStart(W_N) +
    String(r.report.pages_parsed).padStart(W_N) +
    String(r.report.referents_extracted).padStart(W_N) +
    String(r.report.referents_surviving).padStart(W_N) +
    "  " + r.report.reason.slice(0, 88),
  );
}
console.log("");
console.log("REFS = named referents extracted.  KEPT = those surviving the identity gate.");

console.log("");
console.log("REASONS IN FULL");
for (const r of rows) {
  console.log(`  ${r.site}  (${r.org})`);
  console.log(`    ${r.report.outcome}: ${r.report.reason}`);
  console.log(`    identity gate: ${r.report.detail.identity_gate}` +
    `   robots: ${r.report.detail.robots.allowed ? "allowed" : "DISALLOWED"}` +
    `   prose pages: ${r.report.detail.prose_pages}   ${r.report.detail.elapsed_ms} ms`);
  if (r.referents.length) {
    console.log(`    referents: ${r.referents.slice(0, 12).join(", ")}` +
      `${r.referents.length > 12 ? " …" : ""}`);
  }
}

const tally = new Map<string, number>();
for (const r of rows) tally.set(r.report.outcome, (tally.get(r.report.outcome) ?? 0) + 1);
console.log("");
console.log("TALLY");
for (const [k, v] of [...tally.entries()].sort()) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log("");
console.log(`  ${rows.length} site(s); per-site JSON written to ${outDir}`);

console.log("");
console.log("READ THIS WITH GROUND TRUTH. stack/ground-truth.sh renders the same sites in a real");
console.log("browser and counts referents with the same counter. A large gap on a site reported");
console.log("`succeeded` is an extraction bug; the same gap on one reported `js_only` is the");
console.log("taxonomy working correctly. Only one of those is a defect, and without ground truth");
console.log("they are indistinguishable — which is how the silent failure survived this long.");

if (!rows.length) Deno.exit(2);
DRIVER_EOF

sed -i "s|__CRAWL_MODULE__|file://$MODULE|g" "$DRIVER"

# ---------------------------------------------------------------- 2. run
say "typechecking the driver against the production module"
$DENO check "$DRIVER" >/dev/null || die "the driver does not typecheck against $MODULE"
echo "  ok"

say "crawling"
echo "  sites:   $SITES"
echo "  output:  $OUT"
echo "  network: --allow-net, with --deny-net on the production hosts"

# --deny-net overrides --allow-net, so the production project cannot be opened by
# this process even if /etc/hosts were reverted mid-run. Deno.resolveDns — which
# the worker's SSRF guard calls on every host — needs unrestricted net access to
# reach the system resolver, which is why this is a denylist and not an allowlist.
set +e
$DENO run \
  --allow-net \
  --deny-net="${PROD_REF}.supabase.co,db.${PROD_REF}.supabase.co" \
  --allow-read="$REPO,$SITES" \
  --allow-write="$OUT" \
  "$DRIVER" "$SITES" "$OUT" "${PROD_REF}.supabase.co"
rc=$?
set -e

if [ $rc -eq 3 ]; then die "production answered. Nothing was crawled."; fi
if [ $rc -eq 2 ]; then die "no usable lines in $SITES (each line needs 'url | Organisation Name')"; fi
if [ $rc -ne 0 ]; then die "the live run failed (exit $rc)"; fi

say "done"
echo "  next:  stack/ground-truth.sh $SITES $OUT/ground-truth"
exit 0
