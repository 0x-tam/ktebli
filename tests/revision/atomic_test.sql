-- Run on a throwaway migrated database only. Rolls back all fixtures.
begin;
insert into public.orders(id,token,email,org_name,tier,grant_input,status) values
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','revision-test@example.invalid','Revision fixture','full','Fixture','complete');
insert into public.order_proposals(id,order_id,status,revisions_cap) values
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000101','complete',3);
set local role service_role;
do $$
declare r jsonb; first_response jsonb;
begin
 r:=public.submit_revision_request('00000000-0000-4000-8000-000000000999','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000104',0,'{}','Test');
 assert r->>'reason'='not_found','wrong token rejected';
 r:=public.submit_revision_request('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000104',0,'{Clarity}','Test');
 assert (r->>'ok')::boolean and (r->>'version')::integer=2 and (r->>'remaining')::integer=2,'first request';
 first_response:=r;
 r:=public.submit_revision_request('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000104',0,'{Clarity}','Test');
 assert (r-'replayed')=first_response and (r->>'replayed')::boolean,'replay stable response';
 assert (select revisions_used=1 from public.order_proposals where id='00000000-0000-4000-8000-000000000103'),'one allowance';
 assert (select count(*)=4 from public.job_stages where proposal_id='00000000-0000-4000-8000-000000000103'),'one stage batch';
 assert (select count(*)=1 from public.revision_requests where proposal_id='00000000-0000-4000-8000-000000000103'),'one request';
 r:=public.submit_revision_request('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000104',0,'{Clarity}','Changed');
 assert r->>'reason'='request_conflict','cannot change accepted payload';
 update public.order_proposals set status='complete' where id='00000000-0000-4000-8000-000000000103';
 r:=public.submit_revision_request('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000105',0,'{}','Other tab');
 assert r->>'reason'='stale_revision','different tab cannot duplicate even after completion';
 -- Force stage insertion failure and prove no request or allowance is consumed.
 insert into public.job_stages(proposal_id,seq,key,label) values('00000000-0000-4000-8000-000000000103',32767,'deliver','Failure fixture');
 begin
  perform public.submit_revision_request('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000106',1,'{}','Rollback');
  raise exception 'Expected overflow';
 exception when numeric_value_out_of_range then null;
 end;
 assert (select revisions_used=1 from public.order_proposals where id='00000000-0000-4000-8000-000000000103'),'rollback allowance';
 assert not exists(select 1 from public.revision_requests where idempotency_key='00000000-0000-4000-8000-000000000106'),'rollback request';
 assert not has_function_privilege('anon','public.submit_revision_request(uuid,uuid,uuid,integer,text[],text)','execute'),'anon cannot call';
 assert not has_function_privilege('authenticated','public.submit_revision_request(uuid,uuid,uuid,integer,text[],text)','execute'),'authenticated cannot call';
 assert has_function_privilege('service_role','public.submit_revision_request(uuid,uuid,uuid,integer,text[],text)','execute'),'service can call';
end $$;
rollback;
