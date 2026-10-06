const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
const uuid = '00000000-0000-4000-8000-000000000001';
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { id, value: '', hidden: false, children: [], classList: { contains: () => true }, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, dispatchEvent(event) { if (event.type === 'input') { context.catalogueHandoffEpoch++; context.catalogueHandoffPending = false; } } });
  return nodes.get(id);
}
const location = { search: `?prepare=${uuid}&membership=1` };
const context = { URLSearchParams, AbortController, window: { location }, document: { getElementById: node, createElement: () => ({}) }, ownerTestInvite: false, wiz: { el: node('wiz'), open() { context.catalogueHandoffEpoch++; }, close() { context.catalogueHandoffEpoch++; context.catalogueHandoffPending = false; node('catalogue-context').hidden = true; } }, catalogueHandoffEpoch: 0, catalogueHandoffPending: false, setTimeout: () => 1, clearTimeout() {}, Event: class { constructor(type) { this.type = type; } }, fetch: null };
vm.createContext(context);
vm.runInContext(html.slice(html.indexOf('var prepareReference ='), html.indexOf('// Server-owned Stripe tier links.')), context);
assert.equal(context.memberIntent, false, 'prepare intent cannot enter membership credit checkout');
const tail = html.slice(html.indexOf('if (ownerTestInvite) wiz.open'), html.lastIndexOf('</script>'));
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
(async () => {
  let request = deferred();
  context.fetch = () => request.promise;
  vm.runInContext(tail, context);
  const field = node('w-grant');
  field.value = 'https://issuer.example/manual-choice';
  context.catalogueHandoffEpoch++;
  context.catalogueHandoffPending = false;
  request.resolve({ ok: true, json: async () => ({ title: 'Old notice', sourceUrl: 'https://issuer.example/old' }) });
  await flush(); await flush();
  assert.equal(field.value, 'https://issuer.example/manual-choice', 'late result cannot replace a user choice');
  request = deferred();
  field.value = '';
  vm.runInContext(tail, context);
  context.wiz.close();
  request.resolve({ ok: true, json: async () => ({ title: 'Closed modal', sourceUrl: 'https://issuer.example/old' }) });
  await flush(); await flush();
  assert.equal(field.value, '', 'late result cannot fill a closed wizard');
  assert.equal(node('catalogue-context').hidden, true, 'pending hint clears when closed');
  console.log('Catalogue one-off handoff intent and stale-response checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
