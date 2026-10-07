const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('order.html','utf8');
const start=html.indexOf("var query = path[1] === 'session'");
const middle=html.indexOf('var REP = {',start);
const helperStart=html.indexOf('function setControlLabel(');
const helperEnd=html.indexOf('\nfunction captureOrderView',helperStart);
const intakeStart=html.indexOf('function completeIntake(');
const intakeEnd=html.indexOf('\nfunction setupIntake',intakeStart);
const pollStart=html.indexOf('function tick(force)',middle);
const pollEnd=html.indexOf('\ntick(true);',pollStart);
const source=html.slice(helperStart,helperEnd)+html.slice(start,middle).replace('var ORDER_STATUS_TIMEOUT=12000, ACTION_TIMEOUT=20000;','var ORDER_STATUS_TIMEOUT=35,ACTION_TIMEOUT=35;')+html.slice(middle,intakeStart)+html.slice(intakeStart,intakeEnd)+html.slice(pollStart,pollEnd);
let writes=0, responseQueue=[], requestUrls=[], scrollCalls=[];
const link={href:'',getAttribute(name){return name==='data-proposal-index'?'0':name==='data-file-index'?'0':null;}};
const foot={innerHTML:''}, template={innerHTML:''}, span={textContent:''};
const error={hidden:true,querySelector(){return span;}};
const app={_html:'',contains(node){return node===document.activeElement||node===restoredField;},querySelectorAll(selector){if(selector==='details')return details; if(selector==='[data-proposal-index][data-file-index]')return [link]; return [];},set innerHTML(value){this._html=value;writes++;},get innerHTML(){return this._html;}};
let details=[],restoredField=null;
const otherNodes=new Map([['foot',foot],['paid-intake-template',template],['order-poll-error',error]]);
function fakeNode(tag){let text='';return {tagName:tag.toUpperCase(),children:[],attributes:{},listeners:{},value:'',set textContent(v){text=String(v);},get innerHTML(){return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');},set innerHTML(v){text=String(v);},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]||null;},appendChild(node){node.parentNode=this;this.children.push(node);return node;},removeChild(node){this.children=this.children.filter(child=>child!==node);node.parentNode=null;return node;},addEventListener(name,fn){this.listeners[name]=fn;},focus(){document.activeElement=this;},setSelectionRange(a,b,d){this.selection=[a,b,d];},querySelectorAll(selector){let out=[];function visit(node){node.children.forEach(child=>{if(selector==='.rep-row'&&child.className==='rep-row')out.push(child);if(selector==='[data-k]'&&child.attributes['data-k'])out.push(child);visit(child);});}visit(this);return out;}};}
const repContainers=new Map([['rep-people',fakeNode('div')]]);
const document={activeElement:null,createElement(tag){return fakeNode(tag);},querySelectorAll(selector){const match=selector.match(/^#([^ ]+) \.rep-row$/);return match?(repContainers.get(match[1])||fakeNode('div')).querySelectorAll('.rep-row'):[];},getElementById(id){return id==='app'?app:repContainers.get(id)||otherNodes.get(id)|| (restoredField&&restoredField.id===id?restoredField:null);}};
const ctx={crypto:require('node:crypto').webcrypto,document,app,path:['orders','local-token'],query:'token=local-token',FN:'/local-only',formState:{},timer:null,misses:0,URL,AbortController,setTimeout,clearTimeout,ORDER_STATUS_TIMEOUT:35,ACTION_TIMEOUT:35,window:{scrollY:0,scrollTo(x,y){scrollCalls.push([x,y]);}},clearInterval(){},setInterval(){return 1;},fetch(url){requestUrls.push(url);return responseQueue.shift()();},console};
vm.createContext(ctx);vm.runInContext(source,ctx);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function payload(note='Reading source',url='https://example.test/file?ticket=one'){
 return {pending:false,order:{token:'local-token',order_no:'LOCAL',org_name:'Synthetic organisation',tier:'full',status:'processing'},proposals:[{id:'p1',title:'Synthetic proposal',status:'processing',stages:[{label:'Source review',status:'running',note,started_at:'2026-10-06T10:00:00Z'}],files:[{name:'Synthetic file.docx',url}]}]};
}
(async()=>{
 // Stable snapshots must not replace an edited interface, while signed URLs refresh in place.
 ctx.render(payload());const initialWrites=writes;
 ctx.render(payload('Reading source','https://example.test/file?ticket=two'));
 assert.equal(writes,initialWrites,'signed URL rotation does not replace the app');
 assert.equal(link.href,'https://example.test/file?ticket=two','fresh signed links are patched in place');
 ctx.render(payload('New source update'));
 assert.equal(writes,initialWrites+1,'a meaningful changed update is rendered');

 // Repeater rows retain stable field ids and an intentionally blank row across a changed render.
 ctx.addRep('people');const people=repContainers.get('rep-people'),firstPerson=people.children[0],firstName=firstPerson.querySelectorAll('[data-k]')[0];
 assert.equal(firstName.id,'rep-people-0-name');firstName.value='Mira';ctx.rememberIntakeRows();ctx.addRep('people');
 assert.equal(ctx.intakeRows.key_people.length,2);assert.deepEqual(Array.from(ctx.intakeRows.key_people[1]&&Object.values(ctx.intakeRows.key_people[1])),['','']);
 document.activeElement=firstName;firstName.selectionStart=2;firstName.selectionEnd=2;firstName.selectionDirection='forward';app.contains=node=>node===document.activeElement||node===restoredField;
 const repeaterView=ctx.captureOrderView();people.children=[];
 ctx.intakeRows.key_people.forEach((person,index)=>{const row=ctx.repRow('people',index);row.querySelectorAll('[data-k]').forEach(input=>{input.value=person[input.getAttribute('data-k')]||'';});people.appendChild(row);});
 const rebuiltName=people.children[0].querySelectorAll('[data-k]')[0];restoredField=rebuiltName;document.getElementById=id=>id===rebuiltName.id?rebuiltName:otherNodes.get(id)||null;
 ctx.restoreOrderView(repeaterView);assert.equal(people.children.length,2,'an added but blank row survives refresh');assert.equal(rebuiltName.value,'Mira');assert.deepEqual(rebuiltName.selection,[2,2,'forward'],'caret returns to the stable repeated field');
 ctx.addRep('people');const removedRow=people.children[1],removeButton=removedRow.children[1];removeButton.listeners.click();ctx.addRep('people');
 const rowIds=people.children.flatMap(row=>row.querySelectorAll('[data-k]').map(input=>input.id));assert.equal(new Set(rowIds).size,rowIds.length,'removing a middle row and adding another cannot reuse field ids');assert.ok(rowIds.every(id=>/^rep-people-[0-2]-/.test(id)),'remaining repeated fields have contiguous stable indexes');

 // A changed update retains open disclosures, focused input/caret, and even top-of-page scroll.
 const oldDetails={open:true,id:'',tagName:'DETAILS',getAttribute:n=>n==='data-poll-key'?'background':null};
 const oldField={id:'rd-p1',tagName:'TEXTAREA',selectionStart:4,selectionEnd:9,selectionDirection:'forward'};
 details=[oldDetails];document.activeElement=oldField;app.contains=node=>node===oldField||node===restoredField;
 const view=ctx.captureOrderView();
 const newDetails={open:false,id:'',tagName:'DETAILS',getAttribute:n=>n==='data-poll-key'?'background':null};
 const newField={id:'rd-p1',tagName:'TEXTAREA',setSelectionRange(a,b,d){this.selection=[a,b,d];},focus(){document.activeElement=this;}};
 details=[newDetails];restoredField=newField;document.getElementById=id=>id==='rd-p1'?newField:otherNodes.get(id)||null;
 ctx.restoreOrderView(view);
 assert.equal(newDetails.open,true);assert.deepEqual(newField.selection,[4,9,'forward']);assert.ok(scrollCalls.some(call=>call[0]===0&&call[1]===0),'scroll position 0 is explicitly restored');

 // Repeated callers coalesce into one follow-up request; responses never overlap.
 responseQueue=[];requestUrls=[];const first=deferred(),second=deferred();
 ctx.fetch=url=>{requestUrls.push(url);return (responseQueue.shift())();};
 responseQueue.push(()=>first.promise,()=>second.promise);
 const beforePollWrites=writes;ctx.tick(true);ctx.tick(true);ctx.tick(false);
 assert.equal(requestUrls.length,1,'only one request may be in flight');
 first.resolve({json:async()=>payload('First result')});await flush();await flush();
 assert.equal(requestUrls.length,2,'one queued refresh starts after the first request finishes');
 second.resolve({json:async()=>payload('Second result')});await flush();await flush();
 assert.ok(writes>=beforePollWrites+1,'poll response updates the rendered order');

 // A query change invalidates the older response and the queued request uses the new token.
 const stale=deferred(),fresh=deferred();responseQueue.push(()=>stale.promise,()=>fresh.promise);
 ctx.query='token=old';ctx.tick(true);ctx.query='token=new';ctx.tick(true);
 stale.resolve({json:async()=>payload('Stale token result')});await flush();await flush();
 assert.match(requestUrls.at(-1),/token=new/);
 const beforeFresh=writes;fresh.resolve({json:async()=>payload('Fresh token result')});await flush();await flush();
 assert.ok(writes>beforeFresh,'only the fresh-query result changes the view');

 // Poll errors appear inline and a later success clears the message.
 ctx.fetch=()=>Promise.reject(new Error('offline'));ctx.tick(true);await flush();await flush();
 assert.equal(error.hidden,false);assert.match(span.textContent,/current details are still here/);
 ctx.fetch=()=>Promise.resolve({json:async()=>payload('Recovered')});ctx.tick(true);await flush();await flush();
 assert.equal(error.hidden,true);

 // A status request that hangs is aborted and releases the poll lock for the next scheduled refresh.
 let pollAborted=0,pollCalls=0;
 ctx.fetch=(url,options)=>{pollCalls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{pollAborted++;const e=new Error('aborted');e.name='AbortError';reject(e);},{once:true}));};
 ctx.tick(true);await new Promise(resolve=>setTimeout(resolve,60));await flush();
 assert.equal(pollAborted,1);assert.equal(ctx.pollActive,false,'a hung poll cannot hold the poll lock forever');
 const afterAbort=pollCalls;ctx.fetch=()=>{pollCalls++;return Promise.resolve({json:async()=>payload('After timeout')});};ctx.tick(true);await flush();await flush();
 assert.equal(pollCalls,afterAbort+1,'the next explicit poll can start after timeout');

 // A poll arriving during intake save is queued; controls stay attached until POST settles, then the latest revision renders.
 const intakeButton={disabled:false,querySelector(){return {textContent:''};}};
 const intakeMessage={textContent:'',className:''};otherNodes.set('save-intake-button',intakeButton);otherNodes.set('intake-message',intakeMessage);
 ctx.readIntake=()=>({facts:{site_activity:'A sufficiently detailed synthetic scope'},directions:'Keep the draft'});
 async function intakeRace(serverOk){
   let postBody=null,post=deferred(),rendered=null;
   const latest=payload('Changed while saving');latest.intake={required:true,revision:'revision-2',facts:{},directions:''};
   ctx.render=d=>{rendered=d;if(d.intake)ctx.intakeServerRevision=d.intake.revision;};
   ctx.intakeDraft=null;ctx.intakeServerRevision='revision-1';ctx.intakeSubmitting=false;ctx.intakeSaved=false;ctx.intakeStatus='';ctx.deferredOrderData=null;
   ctx.fetch=(url,options)=>{if(String(url).includes('complete-intake')){postBody=JSON.parse(options.body);return post.promise;}return Promise.resolve({json:async()=>latest});};
   ctx.completeIntake('local-token');assert.equal(ctx.intakeSubmitting,true);assert.equal(postBody.revision,'revision-1');
   ctx.tick(true);await flush();await flush();
   assert.equal(ctx.deferredOrderData,latest,'changed server data waits while the live form is submitting');
   assert.equal(rendered,null,'the active form is not detached during its POST');
   post.resolve({json:async()=>serverOk?{ok:true}:{ok:false,message:'The source revision changed'}});await flush();await flush();
   assert.equal(ctx.intakeSubmitting,false);assert.equal(rendered,latest,'settlement applies the freshest server revision');
   assert.equal(ctx.intakeServerRevision,'revision-2','a retry uses the current server revision');
   assert.equal(ctx.intakeDraft.directions,'Keep the draft','the draft survives a concurrent update');
   assert.equal(intakeButton.disabled,serverOk,'the currently attached button receives the settled state');
   if(serverOk)assert.match(intakeMessage.textContent,/Saved/);else assert.match(intakeMessage.textContent,/revision changed/);
 }
 await intakeRace(true);await intakeRace(false);

 // An ambiguous hung save recovers to an inline state and never submits itself again.
 let hungPostCount=0;
 ctx.intakeSubmitting=false;ctx.intakeSaved=false;ctx.intakeDraft=null;ctx.deferredOrderData=null;ctx.intakeServerRevision='revision-3';
 ctx.readIntake=()=>({facts:{site_activity:'Keep this work'},directions:'Keep this draft'});
 ctx.render=()=>{};ctx.fetch=(url,options)=>{if(String(url).includes('complete-intake')){hungPostCount++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{const e=new Error('aborted');e.name='AbortError';reject(e);},{once:true}));}return Promise.resolve({json:async()=>payload()});};
 ctx.completeIntake('local-token');await new Promise(resolve=>setTimeout(resolve,60));await flush();await flush();
 assert.equal(ctx.intakeSubmitting,false);assert.equal(hungPostCount,1);assert.equal(ctx.intakeDraft.directions,'Keep this draft');assert.match(intakeMessage.textContent,/check the order before trying again/);

 // Revision requests expose inline state and suppress repeated submissions.
 const revisionText={value:'Please tighten the delivery plan.'};
 const revisionButton={disabled:false,textContent:'Send revision request',attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};
 const revisionMessage={textContent:'',className:''};
 document.getElementById=id=>id==='rd-p1'?revisionText:id==='rs-p1'?revisionButton:id==='rm-p1'?revisionMessage:otherNodes.get(id)||null;
 ctx.formState={p1:{opts:['Make it more concise'],details:revisionText.value,open:true,pending:false,sent:false,message:'',messageType:''}};
 const revision=deferred();let revisionRequests=0,revisionPayload=null;
 ctx.fetch=(url,options)=>{if(String(url).indexOf('request-revision')<0)return Promise.resolve({json:async()=>payload('Revision request refresh')});revisionRequests++;revisionPayload=JSON.parse(options.body);return revision.promise;};
 ctx.submitRevision('p1');ctx.submitRevision('p1');
 assert.equal(revisionRequests,1,'pending revisions cannot be submitted twice');
 assert.equal(revisionButton.disabled,true);assert.match(revisionMessage.textContent,/Sending/);
 assert.deepEqual(revisionPayload.options,['Make it more concise']);assert.equal(revisionPayload.details,revisionText.value);
 revision.resolve({json:async()=>({ok:true})});await flush();await flush();
 assert.equal(ctx.formState.p1.sent,true);assert.equal(revisionButton.textContent,'Request sent');assert.match(revisionMessage.textContent,/request was sent/);
 ctx.submitRevision('p1');assert.equal(revisionRequests,1,'a successful revision remains non-repeatable while its confirmation is shown');
 assert.doesNotMatch(html,/alert\(/,'revision validation and errors use inline messages rather than browser alerts');
 console.log('Paid order polling preserves stable edits, refreshes signed links, coalesces requests, drops stale responses, and reports inline errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
