const assert = require('node:assert/strict');
const fs = require('node:fs');

const home = fs.readFileSync('index.html', 'utf8');
const order = fs.readFileSync('order.html', 'utf8');
const sourceDetails = home.indexOf('<details class="intake-extra"><summary>Opportunity details');
const sourceDetailsEnd = home.indexOf('</details>', sourceDetails) + '</details>'.length;
assert.ok(sourceDetails >= 0 && sourceDetailsEnd > sourceDetails, 'opportunity details use native disclosure');
assert.ok(home.indexOf('id="deadline-manual"') > sourceDetailsEnd, 'issuer deadline entry remains visible outside collapsed opportunity details');
assert.ok(home.indexOf('id="deadline-confirmation"') > sourceDetailsEnd, 'required deadline confirmation remains visible outside collapsed opportunity details');
assert.match(home, /this\.step === 0 && analysisOk && \(deadlineRequiresManual \|\| deadlineNeedsVerification\) && !cb\('w-deadline-confirm'\)/, 'wizard validates deadline confirmation before leaving the source step');
assert.match(home, /deadlineRequiresManual \? 'Required to continue:/, 'required deadline consent is named before continuing');
assert.match(home, /radio\.checked = selected/, 'visual package selection and radio state stay in sync');
assert.match(order, /esc\(p\.page\)/, 'source passage page labels are escaped before insertion');
assert.ok(order.indexOf('if(d.source_summary){') < order.indexOf('if(d.intake && d.intake.required) h += document.getElementById("paid-intake-template")'), 'source title and deadline appear before the long paid intake');
console.log('Proposal journey keeps required deadlines visible, gated, and accessible; order source labels are escaped.');
