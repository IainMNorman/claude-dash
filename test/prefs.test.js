const test = require('node:test');
const assert = require('node:assert');
const { Store } = require('../src/core');
const { createServer } = require('../src/server');

test('prefs: whitelisted string keys only, change detection, persistence, old state files', () => {
  const store = new Store();
  let n = 0;
  store.onChange(() => n++);
  assert.equal(store.setPref('sort', 'manual'), true);
  assert.equal(store.setPref('sort', 'manual'), false, 'unchanged');
  assert.equal(store.setPref('evil', 'x'), false, 'unknown key');
  assert.equal(store.setPref('cols', 3), false, 'non-string');
  assert.equal(store.setPref('filter', 'x'.repeat(41)), false, 'too long');
  assert.equal(n, 1);
  assert.deepEqual(store.snapshot().prefs, { sort: 'manual' });
  const copy = new Store();
  copy.hydrate(store.dump());
  assert.deepEqual(copy.prefs, { sort: 'manual' });
  const tampered = new Store();
  tampered.hydrate({ version: 1, sessions: [], feed: [], prefs: { sort: 'name', evil: 'x', cols: 5 } });
  assert.deepEqual(tampered.prefs, { sort: 'name' }, 'unknown keys and non-strings dropped on load');
  const old = new Store();
  old.hydrate({ version: 1, sessions: [], feed: [] });
  assert.deepEqual(old.prefs, {});
});

test('http: POST /api/prefs stores a pref; malformed body is a 400; unknown key is ignored', async () => {
  const store = new Store();
  const server = createServer(store);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/prefs`, { method: 'POST', body });
  assert.equal((await post(JSON.stringify({ key: 'drawer', value: 'closed' }))).status, 204);
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post(JSON.stringify({ key: 'bogus', value: 'x' }))).status, 204);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(state.prefs, { drawer: 'closed' });
  server.close();
  server.closeAllConnections?.();
});
