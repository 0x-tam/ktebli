const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('order.html','utf8'),elements={};
function element(id){return elements[id]||(elements[id]={value:'',checked:false,hidden:false,disabled:false,required:false});}
const ctx={document:{getElementById:element},collectRep:()=>[]};vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf('var INTAKE_FIELDS='),html.indexOf('function setupIntake(d)')),ctx);
element('w-currency').value='USD';ctx.syncPaidCurrency();assert.equal(element('paid-currency-other').hidden,true);assert.equal(ctx.readIntake().facts.currency,'USD');
element('w-currency').value='other';element('w-currency-other').value='aed';ctx.syncPaidCurrency();assert.equal(element('w-currency-other').required,true);assert.equal(element('w-currency-other').disabled,false);assert.equal(ctx.readIntake().facts.currency,'AED');
assert.equal(ctx.readIntake().facts.safeguarding_policy,null);element('w-sg-policy').checked=true;assert.equal(ctx.readIntake().facts.safeguarding_policy,true);
const activity=html.indexOf('id="w-activity"'),background=html.indexOf('<details class="work-background"');
assert.ok(activity>html.indexOf('id="w-response-language"')&&activity<background,'required work description follows required type, currency and language, before optional background');
for(const id of ['w-place','w-venue','w-venue-escape','w-last-what','w-never','w-last-when','w-trigger'])assert.ok(html.indexOf(`id="${id}"`)>background,`${id} stays in the optional background disclosure`);
assert.match(html,/<input type="text" id="w-activity" minlength="20" required/);
element('w-never').checked=true;assert.equal(ctx.readIntake().facts.never_delivered,true);
assert.match(html,/<input id="w-currency-other" maxlength="3" pattern="\[A-Za-z\]\{3\}"/);
assert.match(html,/Confirm both before saving/);assert.match(html,/No reliable deadline has been confirmed/);
console.log('Paid form required work-first order, optional background disclosure, field serialization and currency choices passed.');
