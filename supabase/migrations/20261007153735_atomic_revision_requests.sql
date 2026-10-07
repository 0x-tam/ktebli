-- A request, its revision allowance, and all work stages commit together.
-- The key survives retries; the expected revision also fences separate tabs.
alter table public.revision_requests
  add column idempotency_key uuid,
  add column expected_revision integer,
  add column response jsonb;
create unique index revision_requests_idempotency
  on public.revision_requests(proposal_id, idempotency_key)
  where idempotency_key is not null;

create function public.submit_revision_request(
  p_token uuid, p_proposal uuid, p_request uuid, p_expected_revision integer,
  p_options text[], p_details text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.order_proposals;
  v_existing public.revision_requests;
  v_order uuid;
  v_base integer;
  v_response jsonb;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_options text[] := coalesce(p_options, '{}'::text[]);
begin
  if p_request is null or p_expected_revision is null or p_expected_revision < 0
    or cardinality(v_options) > 8 or length(coalesce(v_details,'')) > 4000
    or exists (select 1 from unnest(v_options) x where x is null or length(x)>60)
    or (cardinality(v_options)=0 and v_details is null) then
    return jsonb_build_object('ok',false,'reason','bad_input');
  end if;
  select id into v_order from public.orders where token=p_token;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  select * into v from public.order_proposals
    where id=p_proposal and order_id=v_order for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;

  select * into v_existing from public.revision_requests
    where proposal_id=p_proposal and idempotency_key=p_request;
  if found then
    if v_existing.options is distinct from v_options
      or v_existing.details is distinct from v_details
      or v_existing.expected_revision is distinct from p_expected_revision then
      return jsonb_build_object('ok',false,'reason','request_conflict');
    end if;
    return v_existing.response || jsonb_build_object('replayed',true);
  end if;
  if v.revisions_used <> p_expected_revision then
    return jsonb_build_object('ok',false,'reason','stale_revision');
  end if;
  if v.status <> 'complete' then
    return jsonb_build_object('ok',false,'reason','not_complete');
  end if;
  if v.revisions_used >= v.revisions_cap then
    return jsonb_build_object('ok',false,'reason','no_revisions_left','remaining',0);
  end if;

  v_response := jsonb_build_object('ok',true,'remaining',v.revisions_cap-v.revisions_used-1,
    'version',v.revisions_used+2,'request_id',p_request);
  insert into public.revision_requests(proposal_id,options,details,idempotency_key,expected_revision,response)
    values(p_proposal,v_options,v_details,p_request,p_expected_revision,v_response);
  select coalesce(max(seq),0) into v_base from public.job_stages where proposal_id=p_proposal;
  insert into public.job_stages(proposal_id,seq,key,label) values
    (p_proposal,v_base+1,'revise','Making your requested changes'),
    (p_proposal,v_base+2,'check','Checking it against every other proposal on this grant'),
    (p_proposal,v_base+3,'package','Preparing your Version '||(v.revisions_used+2)||' files'),
    (p_proposal,v_base+4,'deliver','Delivering Version '||(v.revisions_used+2));
  update public.order_proposals set revisions_used=revisions_used+1,status='processing' where id=p_proposal;
  update public.orders set status='processing',completion_email_sent=false where id=v_order;
  return v_response;
end;
$$;
revoke all on function public.submit_revision_request(uuid,uuid,uuid,integer,text[],text) from public,anon,authenticated;
grant execute on function public.submit_revision_request(uuid,uuid,uuid,integer,text[],text) to service_role;
