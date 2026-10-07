Deno.env.set('SUPABASE_URL', 'http://revision.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
let handler: (r: Request) => Promise<Response>;
Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as typeof Deno.serve;
let mode = 'ok', calls = 0;
const body = {token:'00000000-0000-4000-8000-000000000102',proposal_id:'00000000-0000-4000-8000-000000000103',request_id:'00000000-0000-4000-8000-000000000104',expected_revision:0,options:['Clarity'],details:'Please clarify'};
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), {status});
globalThis.fetch = async (input, init) => {
 const url=String(input);
 if(url==='http://revision.invalid/rest/v1/rpc/rl_hit'){if(mode==='limiter_network')throw Error('private transport '+body.token);if(mode==='limiter_http')return json({},503);return json(true);}
 if(url==='http://revision.invalid/rest/v1/rpc/get_secret')return json(null);
 if(url==='http://revision.invalid/rest/v1/rpc/submit_revision_request'){
  calls++;
  const args=JSON.parse(String(init?.body));
  if(args.p_token!==body.token||args.p_proposal!==body.proposal_id||args.p_request!==body.request_id||args.p_expected_revision!==0)throw Error('Invalid atomic request binding');
  if(mode==='network')throw Error('private network detail');
  if(mode==='http')return json({error:'private database detail'},500);
  return mode==='ok'?json({ok:true,remaining:2,version:2,request_id:body.request_id}):json({ok:false,reason:mode});
 }
 throw Error('Forbidden external or non-atomic call '+url);
};
await import('../../supabase/functions/request-revision/index.ts');
function assert(v: unknown, label: string) {if(!v)throw Error(label);}
async function call(b: Record<string, unknown>) {const r=await handler!(new Request('http://fixture/',{method:'POST',body:JSON.stringify(b)}));return {status:r.status,body:await r.json()};}
for(const bad of [{...body,request_id:undefined},{...body,expected_revision:-1},{...body,expected_revision:'0'},{...body,request_id:'invalid'}]) {
 const before=calls,r=await call(bad);assert(r.status===400&&calls===before,'bad identity reached mutation');
}
let r=await call(body);assert(r.status===200&&r.body.ok&&r.body.version===2,'success response');
for(const reason of ['request_conflict','stale_revision','not_complete','not_found','no_revisions_left']){
 mode=reason;r=await call(body);assert(r.status===(reason==='not_found'?404:reason==='no_revisions_left'?400:409)&&r.body.reason===reason,'typed refusal '+reason);
}
for(const failure of ['network','http']){mode=failure;r=await call(body);assert(r.status===503&&r.body.reason==='temporarily_unavailable'&&!JSON.stringify(r.body).includes('private'),'ambiguous failure safe');}
const logs: string[]=[];const originalError=console.error;console.error=(...args: unknown[])=>logs.push(args.join(' '));
try {for(const failure of ['limiter_network','limiter_http']){mode=failure;const before=calls;r=await call(body);assert(r.status===429&&calls===before,'limiter fails closed');}} finally {console.error=originalError;}
assert(logs.length===2&&!logs.join('').includes(body.token)&&!logs.join('').includes('private'),'rate-limit logs exclude token and raw errors');
console.log('Revision endpoint: validation, atomic RPC binding, conflict statuses and uncertain transport failures pass. No external requests.');
