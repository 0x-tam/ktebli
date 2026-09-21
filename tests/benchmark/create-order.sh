#!/usr/bin/env bash
# Create ONE benchmark Draft order directly via the service role, on the LOCAL
# stack only. This deliberately bypasses checkout: the invariant-2 gates
# (save-intake sufficiency clearance -> checkout_token -> stripe-webhook
# consume_checkout_token) protect the REAL payment path, and a benchmark that
# forged a clearance would be testing its own forgery. The bypass is recorded
# per order in tests/benchmark/manifest.json (CLAUDE.md: benchmark runs carry
# their own manifest and never create orders in the production project).
#
# The intake is IDENTITY-ONLY (org name, an explicitly-unverified test
# registration string, website URL). No intake answers are fabricated:
# intake_answers stays NULL and the live crawl of the applicant's real site is
# the only evidence source, exactly like a legacy/ungated order.
#
#   tests/benchmark/create-order.sh <slug> <org-name> <website> <test-reg>
#
# Refuses to run against anything but the local stack.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "FATAL: refusing non-local DB_URL" >&2; exit 1 ;;
esac
SLUG="$1"; ORG_NAME="$2"; WEBSITE="$3"; REG="$4"
GRANT_FILE="$REPO/tests/benchmark/grant-lbf-new-beginnings-2026-guidance.txt"
[ -s "$GRANT_FILE" ] || { echo "FATAL: grant fixture missing: $GRANT_FILE" >&2; exit 1; }

GRANT_TEXT="$(cat "$GRANT_FILE")"
export GRANT_TEXT ORG_NAME WEBSITE REG SLUG
python3 - "$DB_URL" <<'PY'
import json, os, subprocess, sys
db = sys.argv[1]
slug = os.environ["SLUG"]; org = os.environ["ORG_NAME"]
web = os.environ["WEBSITE"]; reg = os.environ["REG"]
grant = os.environ["GRANT_TEXT"]
email = f"bench-{slug}@ktebli.invalid"

def q(s):  # SQL string literal
    return "'" + s.replace("'", "''") + "'"

sql = f"""
begin;
with o as (
  insert into organisations (name, registration_number, email, sanctions_status)
  values ({q(org)}, {q(reg)}, {q(email)}, 'pending')
  on conflict (registration_number) do update set name = excluded.name
  returning id
), ord as (
  insert into orders (stripe_session_id, organisation_id, email, org_name, org_reg,
                      org_website, tier, amount_usd, grant_input, deadline,
                      uploads_expected, status)
  select 'BENCH-PH6-' || {q(slug)}, o.id, {q(email)}, {q(org)}, {q(reg)},
         {q(web)}, 'draft', 149, {q(grant)}, '2026-09-09', 0, 'paid'
  from o returning id, order_no, token
), prop as (
  insert into order_proposals (order_id, title, revisions_cap)
  select id, 'Proposal 1', 1 from ord returning id, order_id
), st as (
  insert into job_stages (proposal_id, seq, key, label)
  select prop.id, s.seq, s.key, s.label from prop, (values
    (1,'analyze','Analysing the opportunity and donor requirements'),
    (2,'org','Reviewing your organisation'),
    (3,'voice','Reviewing your previous proposals'),
    (4,'strategy','Developing your proposal approach'),
    (5,'design','Designing your project'),
    (6,'gen:narrative','Drafting the proposal'),
    (7,'validate','Checking requirements, facts and consistency'),
    (8,'check','Checking it against every other proposal on this grant'),
    (9,'package','Preparing your documents and checking layout'),
    (10,'deliver','Finalising')
  ) as s(seq,key,label)
  returning proposal_id
)
select json_build_object('order_id', ord.id, 'order_no', ord.order_no,
                         'proposal_id', prop.id)
from ord, prop;
commit;
"""
r = subprocess.run(["psql", db, "-v", "ON_ERROR_STOP=1", "-qtA"],
                   input=sql, capture_output=True, text=True)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(1)
out = [l for l in r.stdout.splitlines() if l.strip().startswith("{")]
print(out[-1])
PY
