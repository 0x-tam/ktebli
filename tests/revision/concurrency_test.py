#!/usr/bin/env python3
"""Run only against the disposable migration replay database, never production."""
import concurrent.futures, json, os, subprocess
from pathlib import Path
host=os.environ.get('PGHOST','')
if not host.startswith(('/private/tmp/ktebli-pg-','/tmp/ktebli-pg-','/tmp/ktebli-replay','/private/tmp/ktebli-replay')):
    raise SystemExit('Disposable replay socket required')
psql=str(Path(os.environ.get('PGBIN','/opt/homebrew/opt/postgresql@16/bin'))/'psql')
def sql(query):
    return subprocess.check_output([psql,'-h',host,'-p',os.environ.get('PGPORT','55433'),'-U','postgres','-d',os.environ.get('PGDATABASE','postgres'),'-v','ON_ERROR_STOP=1','-tA','-c',query],text=True).strip()
sql("""insert into public.orders(id,token,email,org_name,tier,grant_input,status) values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202','revision-race@example.invalid','Revision race','full','Fixture','complete');
 insert into public.order_proposals(id,order_id,status,revisions_cap) values
 ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000201','complete',3);""")
def request(i):
    return json.loads(sql("select public.submit_revision_request('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000204',0,'{Clarity}','Concurrent request')"))
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    results=list(pool.map(request,range(16)))
assert all(r['ok'] and r['version']==2 for r in results)
assert sum(not r.get('replayed',False) for r in results)==1
assert sql("select revisions_used from public.order_proposals where id='00000000-0000-4000-8000-000000000203'")=='1'
assert sql("select count(*) from public.revision_requests where proposal_id='00000000-0000-4000-8000-000000000203'")=='1'
assert sql("select count(*) from public.job_stages where proposal_id='00000000-0000-4000-8000-000000000203'")=='4'
sql("delete from public.orders where id='00000000-0000-4000-8000-000000000201'")
print('16 concurrent revision retries: one allowance, one request, four stages, 15 stable replays')
