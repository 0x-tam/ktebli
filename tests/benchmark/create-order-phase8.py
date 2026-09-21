#!/usr/bin/env python3
"""Create ONE phase-8 Draft order on the LOCAL stack, injecting the REAL public-materials
intake_answers from stack/out/phase8-research/<slug>.json.

Unlike tests/benchmark/create-order.sh (identity-only, intake_answers NULL), this carries the
expanded evidence-interview answers the phase-8 intake collects, so the worker's
intakeAnswerLedger() folds them into the Evidence Ledger and the proposal can be grounded.

Still a LOCAL benchmark that bypasses checkout (the invariant-2 gates protect the real payment
path; a benchmark forging a clearance would test its own forgery). The registration number is the
applicant's REAL, independently-verified charity number — not a test placeholder.

    tests/benchmark/create-order-phase8.py <slug>
"""
import json, os, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.environ.get("DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
if "127.0.0.1" not in DB and "localhost" not in DB:
    sys.exit("FATAL: refusing non-local DB_URL")

slug = sys.argv[1]
research = json.load(open(f"{REPO}/stack/out/phase8-research/{slug}.json", encoding="utf8"))
grant = open(f"{REPO}/tests/benchmark/grant-lbf-new-beginnings-2026-guidance.txt", encoding="utf8").read()

org = research["org_name"]
reg = research["registration_number"]
web = {"sufra": "https://www.sufra-nwlondon.org.uk", "magpie": "https://themagpieproject.org",
       "glassdoor": "https://www.glassdoor.org.uk",
       "nourish": "https://www.nourishcommunityfoodbank.org.uk"}[slug]
email = f"ph8-{slug}@ktebli.invalid"
# intake_answers = the whole research object; the worker maps every non-empty field.
intake = json.dumps(research)


def q(s):
    return "'" + s.replace("'", "''") + "'"


sql = f"""
begin;
with o as (
  insert into organisations (name, registration_number, email, sanctions_status)
  values ({q(org)}, {q(reg)}, {q(email)}, 'cleared')
  on conflict (registration_number) do update set name = excluded.name, sanctions_status = 'cleared'
  returning id
), ord as (
  insert into orders (stripe_session_id, organisation_id, email, org_name, org_reg,
                      org_website, tier, amount_usd, grant_input, deadline,
                      uploads_expected, status, intake_answers)
  select 'PH8-' || {q(slug)}, o.id, {q(email)}, {q(org)}, {q(reg)},
         {q(web)}, 'draft', 149, {q(grant)}, '2026-09-09', 0, 'paid', {q(intake)}::jsonb
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
select json_build_object('order_id', ord.id, 'order_no', ord.order_no, 'proposal_id', prop.id)
from ord, prop;
commit;
"""
r = subprocess.run(["psql", DB, "-v", "ON_ERROR_STOP=1", "-qtA"],
                   input=sql, capture_output=True, text=True)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)
out = [l for l in r.stdout.splitlines() if l.strip().startswith("{")]
print(out[-1])
