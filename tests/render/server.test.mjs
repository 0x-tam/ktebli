import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderServer, renderDocx } from '../../render-service/server.mjs';

async function server(t, options) {
  const s = createRenderServer({ secret: 'test-only-secret', ...options });
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); }));
  const base = `http://127.0.0.1:${s.address().port}`;
  return { base, post: (body = 'doc', auth = true) => fetch(`${base}/render`, {
    method: 'POST', headers: auth ? { authorization: 'Bearer test-only-secret' } : {}, body,
  }) };
}
test('health is public; conversion requires a configured matching secret', async t => {
  let calls = 0;
  const { base, post } = await server(t, { convert: async () => { calls++; return {}; } });
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await post('doc', false)).status, 401);
  assert.equal(calls, 0);
  const absent = await server(t, { secret: '' });
  assert.equal((await absent.post()).status, 401);
});
test('oversized body is rejected before conversion', async t => {
  let calls = 0;
  const { post } = await server(t, { maxBytes: 2, convert: async () => { calls++; } });
  assert.equal((await post('123')).status, 413);
  assert.equal(calls, 0);
});
test('busy conversion does not block health and holds capacity until completion', async t => {
  let started;
  const entered = new Promise(r => { started = r; });
  let finish;
  const pending = new Promise(r => { finish = r; });
  const { base, post } = await server(t, { maxConcurrent: 1, convert: async () => {
    started(); await pending; return { ok: true, pages: 1, images: ['page'] };
  } });
  const first = post(); await entered;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await post()).status, 429);
  finish(); assert.equal((await first).status, 200);
  assert.equal((await post()).status, 200);
});
test('watchdog aborts conversion and releases capacity', async t => {
  let calls = 0, aborted = false;
  const { post } = await server(t, { watchdogMs: 40, maxConcurrent: 1, convert: async (_, signal) => {
    if (++calls > 1) return { ok: true };
    await new Promise((_, reject) => signal.addEventListener('abort', () => {
      aborted = true; reject(new Error('private child output'));
    }, { once: true }));
  } });
  const r = await post(); assert.equal(r.status, 504);
  assert.deepEqual(await r.json(), { ok: false, code: 'timeout' });
  assert.equal(aborted, true);
  assert.equal((await post()).status, 200);
});
test('internal exceptions never expose content', async t => {
  const { post } = await server(t, { convert: async () => { throw new Error('confidential proposal text'); } });
  assert.deepEqual(await (await post()).json(), { ok: false, code: 'internal' });
});
test('invalid DOCX rejected without invoking external programs', async () => {
  await assert.rejects(renderDocx(Buffer.from('plain text')), /invalid_docx/);
});
