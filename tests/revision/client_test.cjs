const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('order.html','utf8');
const source=html.slice(html.indexOf('function submitRevision('),html.indexOf('var ORDER_STATUS_TIMEOUT=',html.indexOf('function submitRevision(')));
const draftSource=html.slice(html.indexOf('function saveOrderDraft('),html.indexOf('function clearPublicTaskOnOrder('));
const flush=()=>new Promise(r=>setImmediate(r));
let mode='timeout',saved,posts=[];
const field={value:'Keep these exact changes',disabled:false};
const button={setAttribute(){},removeAttribute(){}};
const state={opts:['Tone / writing style'],details:field.value,open:true,requestMarker:'0:1'};
const ctx={formState:{p:state},latestOrderData:{},revisionMarker:()=> '0:1',FN:'/fixture',path:['orders','token'],ACTION_TIMEOUT:1,
 document:{getElementById:id=>id==='rd-p'?field:id==='rs-p'?button:null},app:{querySelectorAll:()=>[]},crypto:require('node:crypto').webcrypto,
 setControlLabel(){},timer:1,render(){},tick(){},orderDraftKey:'fixture',orderDraft:null,orderReturnTo:'',intakeDraft:null,intakeSaved:false,
 sessionStorage:{setItem(key,value){saved=JSON.parse(value);}},boundedJson(url,options){posts.push(JSON.parse(options.body));return mode==='timeout'?Promise.reject(new Error('timeout')):Promise.resolve(mode==='rate'?{ok:false,reason:'rate_limited'}:{ok:true});}};
vm.createContext(ctx);vm.runInContext(draftSource+source,ctx);
(async()=>{
 ctx.submitRevision('p');await flush();
 assert.equal(posts.length,1);assert.match(posts[0].request_id,/^[0-9a-f-]{36}$/);assert.equal(posts[0].expected_revision,0);
 assert.equal(state.uncertain,true);assert.equal(field.disabled,true);assert.equal(saved.revisions.p.requestId,posts[0].request_id);
 ctx.submitRevision('p');assert.equal(posts.length,1,'uncertain request gated');
 // Simulate a tab refresh restoring the bounded draft; the UUID stays attached.
 ctx.formState.p={...saved.revisions.p,requestId:saved.revisions.p.requestId,requestMarker:saved.revisions.p.marker,pending:false,sent:false,retryAllowed:true};
 mode='rate';ctx.submitRevision('p');await flush();
 assert.deepEqual(posts[1],posts[0],'refresh retry sends identical identity and payload');
 assert.equal(ctx.formState.p.uncertain,true,'rate-limit refusal cannot prove earlier request failed');
 assert.equal(field.disabled,true,'uncertain payload remains immutable');
 ctx.formState.p.retryAllowed=true;mode='ok';ctx.submitRevision('p');await flush();
 assert.deepEqual(posts[2],posts[0],'later successful retry preserves identity');
 assert.equal(ctx.formState.p.sent,true);assert.equal(saved.revisions.p,undefined,'success clears draft');
 console.log('Revision client: timeout, refresh, rate-limited retry and success retain one immutable request identity.');
})().catch(e=>{console.error(e);process.exitCode=1;});
