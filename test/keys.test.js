const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'keys.js')).href);
const ev = (key, o = {}) => ({ key, ...o });
const A = async (e, typing = false) => (await load()).actionFor(e, { typing });

test('cmd/ctrl+F focuses search, even while typing', async () => {
  assert.equal(await A(ev('f', { metaKey: true })), 'focusSearch');
  assert.equal(await A(ev('F', { ctrlKey: true })), 'focusSearch');
  assert.equal(await A(ev('f', { metaKey: true }), true), 'focusSearch');
  assert.equal(await A(ev('f', { metaKey: true, shiftKey: true })), null);
  assert.equal(await A(ev('f', { metaKey: true, altKey: true })), null);
});

test('Escape clears only while typing', async () => {
  assert.equal(await A(ev('Escape'), true), 'clearSearch');
  assert.equal(await A(ev('Escape'), false), null);
  assert.equal(await A(ev('Escape', { metaKey: true }), true), null);
});

test('cmd+1..4 select filters 0..3, others ignored', async () => {
  for (const n of [1, 2, 3, 4]) assert.equal(await A(ev(String(n), { metaKey: true })), `filter:${n - 1}`);
  assert.equal(await A(ev('5', { metaKey: true })), null);
  assert.equal(await A(ev('0', { metaKey: true })), null);
  assert.equal(await A(ev('1')), null);
  assert.equal(await A(ev('1', { metaKey: true }), true), null);
  assert.equal(await A(ev('1', { metaKey: true, shiftKey: true })), null);
});

test('cmd+shift+A toggles drawer', async () => {
  assert.equal(await A(ev('A', { metaKey: true, shiftKey: true })), 'toggleDrawer');
  assert.equal(await A(ev('a', { ctrlKey: true, shiftKey: true })), 'toggleDrawer');
  assert.equal(await A(ev('a', { metaKey: true })), null);
  assert.equal(await A(ev('A', { shiftKey: true })), null);
  assert.equal(await A(ev('A', { metaKey: true, shiftKey: true }), true), null);
});

test('J/K/Enter/P work bare, case-insensitively', async () => {
  assert.equal(await A(ev('j')), 'next');
  assert.equal(await A(ev('J')), 'next');
  assert.equal(await A(ev('k')), 'prev');
  assert.equal(await A(ev('Enter')), 'open');
  assert.equal(await A(ev('p')), 'pin');
});

test('J/K/Enter/P ignored with modifiers', async () => {
  for (const key of ['j', 'k', 'Enter', 'p']) {
    for (const m of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) assert.equal(await A(ev(key, { [m]: true })), null, `${key}+${m}`);
  }
});

test('J/K/Enter/P ignored while typing', async () => {
  for (const key of ['j', 'k', 'Enter', 'p']) assert.equal(await A(ev(key), true), null);
});

test('defaultPrevented and unknown keys give null', async () => {
  assert.equal(await A(ev('j', { defaultPrevented: true })), null);
  assert.equal(await A(ev('f', { metaKey: true, defaultPrevented: true })), null);
  assert.equal(await A(ev('x')), null);
  assert.equal(await A(ev('')), null);
  assert.equal(await A({}), null);
  assert.equal(await A(null), null);
});

test('SHORTCUTS lists keys and labels', async () => {
  const { SHORTCUTS } = await load();
  assert.ok(SHORTCUTS.length >= 7);
  for (const s of SHORTCUTS) assert.ok(s.keys && s.label);
});

test('initKeys dispatches to api and preventDefaults', async () => {
  const { initKeys } = await load();
  const calls = [];
  let handler;
  const doc = { activeElement: null, addEventListener: (_, h) => { handler = h; }, removeEventListener: () => { handler = null; } };
  const api = new Proxy({}, { get: (_, name) => (...a) => calls.push([name, ...a]) });
  const off = initKeys(api, doc);
  let prevented = 0;
  const fire = (key, o = {}) => handler({ key, preventDefault: () => prevented++, ...o });
  fire('j'); fire('k'); fire('Enter'); fire('p'); fire('2', { metaKey: true }); fire('f', { metaKey: true }); fire('a', { metaKey: true, shiftKey: true });
  assert.deepEqual(calls, [['moveSelection', 1], ['moveSelection', -1], ['openSelected'], ['togglePinSelected'], ['setFilter', 1], ['focusSearch'], ['toggleDrawer']]);
  assert.equal(prevented, 7);
  calls.length = 0;
  doc.activeElement = { tagName: 'INPUT' };
  fire('j'); fire('Escape');
  assert.deepEqual(calls, [['clearSearch']]);
  doc.activeElement = { tagName: 'DIV', isContentEditable: true };
  fire('p');
  assert.equal(calls.length, 1);
  off();
  assert.equal(handler, null);
});
