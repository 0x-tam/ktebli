const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const home = fs.readFileSync('index.html', 'utf8');
const order = fs.readFileSync('order.html', 'utf8');
assert.match(home,/id="wiz-reset-confirm"[^>]*role="group"/,'restart confirmation is in the dialog');
assert.match(home,/id="wiz-keep-current"/);
assert.match(home,/id="wiz-confirm-reset"/);
assert.doesNotMatch(home,/window\.confirm\(/,'restart never blocks the browser with a native confirmation');
const flush = () => new Promise(resolve => setImmediate(resolve));
const storage = new Map();
const sessionStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};

const fields = new Map([
  ['w-grant', { id:'w-grant', type:'textarea', matches:()=>true }],
  ['w-name', { id:'w-name', type:'text', matches:()=>true }],
  ['w-deadline-confirm', { id:'w-deadline-confirm', type:'checkbox', matches:()=>true }],
]);
const wizRoot = { contains: field => [...fields.values()].includes(field) };
const publicDocument = { getElementById: id => id === 'wiz' ? wizRoot : fields.get(id) };
const publicCtx = { document:publicDocument, window:{location:{origin:'https://ktebli.example'}}, URL, URLSearchParams, Date, sessionStorage,
  ownerTestInvite:'', taskOwner:null, TASK_DRAFT_AGE:6*60*60*1000, TASK_DRAFT_KEY:'ktebli-proposal-task-v1', REP:{people:{fields:[['name','Name']]}} };
vm.createContext(publicCtx);
vm.runInContext(home.slice(home.indexOf('function safeReturnTo('),home.indexOf('var requestedReturnTo')),publicCtx);
vm.runInContext(home.slice(home.indexOf('function readTaskDraft('),home.indexOf('function clearTaskDraft(')),publicCtx);
assert.equal(publicCtx.safeReturnTo('/account/dashboard?tab=saved&q=cedar&unknown=x'),'/account/dashboard?tab=saved&q=cedar');
for(const unsafe of ['https://evil.example/account/dashboard','//evil.example/account/dashboard','/account/dashboard#x','/account/dashboard\nevil','/account/dashboard\\evil'])assert.equal(publicCtx.safeReturnTo(unsafe),'');
const valid={version:1,owner:null,savedAt:Date.now(),step:2,tier:'full',fields:{'w-grant':'https://issuer.example/call','w-name':'Mira'},checks:{'w-deadline-confirm':false},rows:{people:[{name:'Mira'}]}};
assert.equal(publicCtx.validTaskDraft(valid),true);
sessionStorage.setItem('ktebli-proposal-task-v1',JSON.stringify(valid));
assert.equal(publicCtx.readTaskDraft().fields['w-name'],'Mira');
for(const bad of [{...valid,fields:{unknown:'x'}},{...valid,fields:{'w-grant':'x'.repeat(200001)}},{...valid,rows:{people:[null]}}])assert.equal(publicCtx.validTaskDraft(bad),false);
sessionStorage.setItem('ktebli-proposal-task-v1',JSON.stringify({...valid,step:99}));
assert.equal(publicCtx.readTaskDraft(),null);
assert.equal(sessionStorage.getItem('ktebli-proposal-task-v1'),null);

const paySource=home.slice(home.indexOf('  pay: function () {'),home.indexOf('\n};\n\n// openers',home.indexOf('  pay: function () {')));
let resolveSave, payments=0, saveCalls=0;
const payButton={disabled:false,textContent:''};
const payCtx={analysisOk:true,lastAnalyzed:'https://issuer.example/call',handoffConflict:false,ownerTestInvite:'',analyzing:false,
  PRICES:{full:'$449'},FN:'/local',AbortController,document:{getElementById:()=>payButton},renderSuff(){},goToPayment(){payments++;},analyzeGrant(){},
  fetch(){saveCalls++;return new Promise(resolve=>{resolveSave=resolve;});}};
vm.createContext(payCtx);
vm.runInContext('var checkoutGate={'+paySource+'\n};',payCtx);
let currentSource='https://issuer.example/call';
const checkout={step:3,last:3,tier:'full',pendingToken:null,checkoutGeneration:0,checkoutController:null,checkoutPending:false,intakeId:null,
  el:{classList:{contains:()=>true}},val:()=>currentSource,collect:()=>({grant:currentSource,tier:'full',email:'mira@example.test'}),render(){}};
(async()=>{
  payCtx.checkoutGate.pay.call(checkout);
  assert.equal(saveCalls,1);
  checkout.checkoutGeneration++;currentSource='https://issuer.example/other';
  resolveSave({json:async()=>({id:'stale-intake',cleared:true,checkout_token:'stale-clearance'})});
  await flush();await flush();
  assert.equal(payments,0,'late clearance cannot redirect after source change');
  assert.equal(checkout.intakeId,null,'late clearance cannot replace the active intake');
  currentSource='https://issuer.example/call';checkout.checkoutPending=false;
  payCtx.checkoutGate.pay.call(checkout);
  resolveSave({json:async()=>({id:'current-intake',cleared:true,checkout_token:'current-clearance'})});
  await flush();await flush();
  assert.equal(payments,1,'current clearance advances to payment');

  const ownerSource=home.slice(home.indexOf('function goToPayment('),home.indexOf('// Public review mirrors'));
  let resolveOwner;
  const ownerButton={disabled:false,textContent:''};
  const ownerCtx={ownerTestInvite:'a'.repeat(64),FN:'/local',AbortController,document:{getElementById:()=>ownerButton},
    window:{location:{href:''}},renderSuff(){},memberIntent:false,MEMBERSHIP_CHECKOUT_PATH:'',PAYLINKS:{},PRICES:{full:'$449'},
    wiz:{tier:'full',checkoutGeneration:0,checkoutController:null,checkoutPending:false,val:()=> 'https://issuer.example/call',el:{classList:{contains:()=>true}}},
    fetch(){return new Promise(resolve=>{resolveOwner=resolve;});}};
  vm.createContext(ownerCtx);vm.runInContext(ownerSource,ownerCtx);
  ownerCtx.goToPayment('mira@example.test','local-clearance');
  ownerCtx.wiz.checkoutGeneration++;
  resolveOwner({json:async()=>({ok:true,order_token:'00000000-0000-4000-8000-000000000001'})});
  await flush();await flush();
  assert.equal(ownerCtx.window.location.href,'','late owner-test completion cannot redirect after task change');
  ownerCtx.goToPayment('mira@example.test','local-clearance');
  resolveOwner({json:async()=>({ok:true,order_token:'00000000-0000-4000-8000-000000000001'})});
  await flush();await flush();
  assert.equal(ownerCtx.window.location.href,'/orders/00000000-0000-4000-8000-000000000001');

  const orderStorage = new Map();
  const orderCtx={Date,URL,URLSearchParams,TextEncoder,Uint8Array,Promise,window:{crypto:webcrypto},location:{origin:'https://ktebli.example'},
    sessionStorage:{getItem:key=>orderStorage.get(key)||null,setItem:(key,value)=>orderStorage.set(key,value),removeItem:key=>orderStorage.delete(key)},
    document:{getElementById:()=>null},formState:{},intakeDraft:null,intakeSaved:false,intakeServerRevision:'revision-1',intakeRows:{},intakeTouched:{},latestOrderData:null,
    REP:{people:{fields:[['name','Name']]}},INTAKE_FIELDS:{site_activity:'w-activity'},INTAKE_CHECKS:{never_delivered:'w-never'},INTAKE_LISTS:{key_people:'people'},REV_OPTIONS:['Tone / writing style'],revisionMarker:()=> '0:1'};
  vm.createContext(orderCtx);
  vm.runInContext(order.slice(order.indexOf('var ORDER_DRAFT_AGE='),order.indexOf('if(app.addEventListener)')),orderCtx);
  await orderCtx.ensureOrderDraftKey('local-order-token');
  assert.match(orderCtx.orderDraftKey,/^ktebli-order-draft-v1:[0-9a-f]{64}$/);
  assert.doesNotMatch(orderCtx.orderDraftKey,/local-order-token/);
  orderCtx.orderReturnTo='/account/dashboard?tab=saved';orderCtx.intakeRows={key_people:[{name:'Mira'}]};orderCtx.intakeDraft={facts:{site_activity:'A local draft'},directions:'Keep this'};
  orderCtx.saveOrderDraft();
  const stored=JSON.parse(orderStorage.get(orderCtx.orderDraftKey));
  assert.equal(stored.intake.revision,'revision-1');
  assert.equal(stored.returnTo,'/account/dashboard?tab=saved');
  assert.equal(orderCtx.validOrderDraft(stored),true);
  assert.equal(orderCtx.validOrderDraft({...stored,intake:{...stored.intake,revision:1}}),true,'numeric server revisions remain restorable');
  assert.equal(orderCtx.validOrderDraft({...stored,revisions:{p1:{marker:'0:1',opts:'bad',details:'x'}}}),false);
  assert.equal(orderCtx.validOrderDraft({...stored,intake:{...stored.intake,rows:{key_people:[null]}}}),false);
  assert.match(order,/revisionState\.requestMarker!==currentRevisionMarker\)\{revisionState\.stale=true/,'live polling gates a draft when the server marker changes');
  assert.match(order,/hasStaleSavedRevision\?'':'<button class="revbtn" data-open/,'an older saved request must be recovered before a blank form can replace it');
  assert.match(order,/state\.pending\|\|state\.sent\|\|state\.blocked\|\|state\.stale\|\|\(state\.uncertain&&!state\.retryAllowed\)/,'uncertain submissions cannot bypass the retry gate');
  const revisionData={order:{token:'local'},proposals:[{id:'p1',revisions_used:0,files:[{version:1}]}]};
  const revisionState={opts:['Tone / writing style'],details:'Keep this request',open:true,pending:false,sent:false,uncertain:true,requestMarker:'0:1'};
  let statusCalls=0, revisionPosts=0, marker='0:1';
  const revisionCtx={formState:{p1:revisionState},latestOrderData:revisionData,query:'token=local',FN:'/local',ORDER_STATUS_TIMEOUT:12000,ACTION_TIMEOUT:20000,
    path:['orders','local'],app:{querySelectorAll:()=>[]},document:{getElementById:()=>({value:'Keep this request'})},
    revisionMarker:()=>marker,boundedJson:(url)=>{if(url.includes('order-status')){statusCalls++;return Promise.resolve(revisionData);}revisionPosts++;return Promise.resolve({ok:true});},
    render(){},saveOrderDraft(){},setControlLabel(){},tick(){},refreshStageDurations(){},setInterval:()=>1,timer:1,lastRenderKey:'old'};
  vm.createContext(revisionCtx);
  vm.runInContext(order.slice(order.indexOf('function submitRevision('),order.indexOf('var ORDER_STATUS_TIMEOUT=',order.indexOf('function submitRevision('))),revisionCtx);
  revisionCtx.submitRevision('p1');assert.equal(revisionPosts,0,'an uncertain request cannot be resubmitted directly');
  revisionCtx.checkRevisionBeforeRetry('p1');await flush();
  assert.equal(statusCalls,1);assert.equal(revisionState.uncertain,true);assert.equal(revisionState.retryChecked,true);
  revisionCtx.submitRevision('p1');assert.equal(revisionPosts,0,'fresh status alone does not submit again');
  revisionCtx.checkRevisionBeforeRetry('p1');assert.equal(revisionState.retryAllowed,true);assert.equal(revisionState.uncertain,true,'retry permission is tab-only and uncertainty remains in the saved draft');
  marker='1:2';revisionState.retryAllowed=false;revisionState.retryChecked=false;
  revisionCtx.checkRevisionBeforeRetry('p1');await flush();
  assert.equal(revisionState.stale,true,'a changed server marker requires review instead of retry');
  console.log('Journey draft and checkout continuation checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
