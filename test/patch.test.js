const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'patch.js')).href);
const card = (s, since) => `<div class="card ${s.state}" data-id="${s.id}"><span data-t="${since(s.lastEvent)}"></span>${s.tools} tools</div>`;

test('dur formats seconds, minutes, hours', async () => {
  const { dur } = await load();
  assert.strictEqual(dur(-5), '0s');
  assert.strictEqual(dur(59999), '59s');
  assert.strictEqual(dur(83000), '1m 23s');
  assert.strictEqual(dur(5_000_000), '1h 23m');
});

test('timeText renders since specs relative to now', async () => {
  const { since, timeText } = await load();
  assert.strictEqual(since(1000.4), 'since:1000');
  assert.strictEqual(timeText('since:1000', 61000), '1m 0s');
  assert.strictEqual(timeText('since:5000', 1000), '0s');
  assert.strictEqual(timeText('finder', 1000), '');
  assert.strictEqual(timeText(undefined, 1000), '');
});

test('timeTitle joins prefix and duration', async () => {
  const { timeTitle } = await load();
  assert.strictEqual(timeTitle('idle', 'since:0', 3000), 'idle · 3s');
  assert.strictEqual(timeTitle('', 'since:0', 3000), '3s');
  assert.strictEqual(timeTitle('idle', 'bad', 3000), 'idle');
});

test('unchanged data yields no replace', async () => {
  const { since, diffKeyed } = await load();
  const s = { id: 'a', state: 'idle', lastEvent: 1000, tools: 3 };
  const prev = new Map([['a', card(s, since)]]);
  const d = diffKeyed(prev, [{ key: 'a', sig: card({ ...s }, since) }]);
  assert.deepStrictEqual(d, { create: [], replace: [], keep: ['a'], remove: [] });
});

test('changed data yields replace', async () => {
  const { since, diffKeyed } = await load();
  const s = { id: 'a', state: 'idle', lastEvent: 1000, tools: 3 };
  const prev = new Map([['a', card(s, since)]]);
  assert.deepStrictEqual(diffKeyed(prev, [{ key: 'a', sig: card({ ...s, tools: 4 }, since) }]).replace, ['a']);
  assert.deepStrictEqual(diffKeyed(prev, [{ key: 'a', sig: card({ ...s, lastEvent: 2000 }, since) }]).replace, ['a']);
});

test('time-only change (clock advancing) yields no replace', async () => {
  const { since, diffKeyed, timeText } = await load();
  const s = { id: 'a', state: 'idle', lastEvent: 1000, tools: 3 };
  const sig = card(s, since);
  const prev = new Map([['a', sig]]);
  assert.deepStrictEqual(diffKeyed(prev, [{ key: 'a', sig: card(s, since) }]).keep, ['a']);
  assert.notStrictEqual(timeText(since(s.lastEvent), 2000), timeText(since(s.lastEvent), 90000));
});

test('diffKeyed reports creates and removes', async () => {
  const { diffKeyed } = await load();
  const d = diffKeyed(new Map([['a', '1'], ['b', '2']]), [{ key: 'b', sig: '2' }, { key: 'c', sig: '3' }]);
  assert.deepStrictEqual(d, { create: ['c'], replace: [], keep: ['b'], remove: ['a'] });
});

test('feedKeys caps rows and keeps keys unique and stable', async () => {
  const { feedKeys } = await load();
  const feed = Array.from({ length: 80 }, (_, i) => ({ t: 1000 - i, session: 's', event: 'PreToolUse', text: 'x' }));
  const k = feedKeys(feed);
  assert.strictEqual(k.length, 50);
  assert.strictEqual(new Set(k.map((r) => r.key)).size, 50);
  const dup = feedKeys([{ t: 1, event: 'Stop' }, { t: 1, event: 'Stop' }]);
  assert.notStrictEqual(dup[0].key, dup[1].key);
  const grown = feedKeys([{ t: 2000, event: 'Stop' }, ...feed]);
  assert.strictEqual(grown[1].key, k[0].key);
});

test('colsSig compares column assignment', async () => {
  const { colsSig } = await load();
  assert.strictEqual(colsSig([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]), 'a,b|c');
  assert.notStrictEqual(colsSig([[{ id: 'a' }], [{ id: 'b' }]]), colsSig([[{ id: 'a' }, { id: 'b' }]]));
});
