const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('../src/core');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'arrange.js')).href);
const S = (...ids) => ids.map((id) => ({ id }));

test('foldCols orders by order, clamps columns beyond n into the last, reports unplaced', async () => {
  const { foldCols } = await load();
  const layout = { a: { col: 0, order: 2 }, b: { col: 0, order: 1 }, c: { col: 5, order: 0 }, d: { col: 1, order: 0 } };
  const { cols, unplaced } = foldCols(S('a', 'b', 'c', 'd', 'e'), layout, 2);
  assert.deepEqual(cols.map((c) => c.map((s) => s.id)), [['b', 'a'], ['c', 'd']]);
  assert.deepEqual(unplaced.map((s) => s.id), ['e']);
});

test('neededColumns is the highest used column plus one (at least 1)', async () => {
  const { neededColumns } = await load();
  assert.equal(neededColumns(S('a', 'b'), { a: { col: 0, order: 0 }, b: { col: 3, order: 0 } }), 4);
  assert.equal(neededColumns(S('a'), {}), 1);
});

test('placeUnplaced puts newcomers at the end of the shortest column and updates layout', async () => {
  const { foldCols, placeUnplaced } = await load();
  const layout = { a: { col: 0, order: 0 }, b: { col: 0, order: 1 }, c: { col: 1, order: 0 } };
  const { cols, unplaced } = foldCols(S('a', 'b', 'c', 'x', 'y'), layout, 3);
  const ups = placeUnplaced(cols, unplaced, layout);
  assert.deepEqual(ups, [{ id: 'x', col: 2, order: 0 }, { id: 'y', col: 1, order: 1 }]);
  assert.deepEqual(layout.y, { col: 1, order: 1 });
});

test('orderFor gives a sort key between neighbours, before the first and after the last', async () => {
  const { orderFor } = await load();
  const layout = { a: { col: 0, order: 1 }, b: { col: 0, order: 2 } };
  assert.equal(orderFor(['a', 'b'], 1, layout), 1.5);
  assert.equal(orderFor(['a', 'b'], 0, layout), 0);
  assert.equal(orderFor(['a', 'b'], 2, layout), 3);
  assert.equal(orderFor([], 0, layout), 0, 'empty column');
});

test('dropIndex counts card midpoints above the pointer; columnAt picks the nearest column', async () => {
  const { dropIndex, columnAt } = await load();
  assert.equal(dropIndex([100, 300, 500], 50), 0);
  assert.equal(dropIndex([100, 300, 500], 350), 2);
  assert.equal(dropIndex([100, 300, 500], 900), 3);
  assert.equal(dropIndex([], 10), 0);
  const rects = [{ left: 0, right: 100 }, { left: 112, right: 212 }, { left: 224, right: 324 }];
  assert.equal(columnAt(rects, 50), 0);
  assert.equal(columnAt(rects, 105), 0);
  assert.equal(columnAt(rects, 108), 1);
  assert.equal(columnAt(rects, 400), 2);
  assert.equal(columnAt(rects, -50), 0);
});

test('store layout: validates input, persists through dump/hydrate, appears in snapshot', () => {
  const store = new Store();
  store.ingest({ session_id: 'a', cwd: '/a', hook_event_name: 'SessionStart' });
  let notified = 0;
  store.onChange(() => notified++);
  assert.equal(store.setLayout([{ id: 'a', col: 2, order: 1.5 }]), true);
  assert.equal(store.setLayout([{ id: 'a', col: 2, order: 1.5 }]), false, 'unchanged');
  assert.equal(store.setLayout([{ id: 'nope', col: 0, order: 0 }]), false, 'unknown session');
  assert.equal(store.setLayout([{ id: 'a', col: -1, order: 0 }, { id: 'a', col: 1.5, order: 0 }, { id: 'a', col: 99, order: 0 }, { id: 'a', col: 0, order: NaN }]), false);
  assert.equal(store.setLayout('junk'), false);
  assert.equal(notified, 1);
  assert.deepEqual(store.snapshot().layout.a, { col: 2, order: 1.5 });
  const copy = new Store();
  copy.hydrate(store.dump());
  assert.deepEqual(copy.layout, { a: { col: 2, order: 1.5 } });
  const old = new Store();
  old.hydrate({ version: 1, sessions: [], feed: [] });
  assert.deepEqual(old.layout, {}, 'state files from before layout existed still load');
});

test('chooseColumns: stays put under width-dependent heights (no 1<->2 flicker) and still reacts to real changes', async () => {
  const { chooseColumns } = await load();
  const H = 600;
  const W = 1000;
  const cardsTotal = (n) => 8 * ((n === 1 ? 70 : 105) + 12);
  let memo = null;
  let t = 0;
  let n = 1;
  const seen = [];
  for (let i = 0; i < 40; i++) {
    t += 1000;
    const r = chooseColumns({ nMin: 1, nMax: 2, total: cardsTotal(n), H, w: W, memo, now: t });
    memo = r.memo;
    n = r.n;
    seen.push(n);
  }
  const flips = seen.filter((v, i) => i && v !== seen[i - 1]).length;
  assert.ok(flips <= 1, `flipped ${flips} times: ${seen.join('')}`);
  assert.equal(seen[seen.length - 1], 2);
});

test('chooseColumns: dwell blocks rapid changes, a width change resets, shrinking needs slack', async () => {
  const { chooseColumns } = await load();
  const base = { nMin: 1, nMax: 3, H: 500, w: 1200 };
  let r = chooseColumns({ ...base, total: 400, memo: null, now: 0 });
  assert.equal(r.n, 1);
  r = chooseColumns({ ...base, total: 800, memo: r.memo, now: 100 });
  assert.equal(r.n, 2, 'growing is allowed immediately');
  r = chooseColumns({ ...base, total: 100, memo: r.memo, now: 500 });
  assert.equal(r.n, 2, 'shrinking blocked during dwell');
  r = chooseColumns({ ...base, total: 480, memo: r.memo, now: 9000 });
  assert.equal(r.n, 2, 'no slack: a near-full single column does not win');
  r = chooseColumns({ ...base, total: 200, memo: r.memo, now: 9500 });
  assert.equal(r.n, 1, 'plenty of slack after dwell: shrink');
  r = chooseColumns({ ...base, w: 800, total: 800, memo: r.memo, now: 9600 });
  assert.equal(r.n, 2, 'width change ignores memory');
});

test('effectiveColumnBounds: each session gets its own column up to nMin, never more columns than sessions', async () => {
  const { effectiveColumnBounds: b } = await load();
  assert.deepEqual(b({ nMin: 2, nMax: 3, count: 2 }), { nMin: 2, nMax: 2 });
  assert.deepEqual(b({ nMin: 2, nMax: 3, count: 1 }), { nMin: 1, nMax: 1 });
  assert.deepEqual(b({ nMin: 2, nMax: 3, count: 5 }), { nMin: 2, nMax: 3 });
  assert.deepEqual(b({ nMin: 1, nMax: 4, count: 0 }), { nMin: 1, nMax: 1 });
  assert.deepEqual(b({ nMin: 2, nMax: 3 }), { nMin: 2, nMax: 3 });
});

test('chooseColumns with count: 2 sessions at nMin 2 split even when they fit one column', async () => {
  const { chooseColumns } = await load();
  assert.equal(chooseColumns({ nMin: 2, nMax: 3, total: 300, H: 800, w: 1400, memo: null, now: 0, count: 2 }).n, 2);
  assert.equal(chooseColumns({ nMin: 2, nMax: 3, total: 300, H: 800, w: 1400, memo: null, now: 0, count: 1 }).n, 1);
  assert.equal(chooseColumns({ nMin: 2, nMax: 3, total: 5000, H: 800, w: 1400, memo: null, now: 0, count: 5 }).n, 3);
  assert.equal(chooseColumns({ nMin: 2, nMax: 3, total: 300, H: 800, w: 1400, memo: null, now: 0, count: 5 }).n, 2);
});

test('chooseColumns: growth near the threshold does not flip each call; real overflow still grows', async () => {
  const { chooseColumns } = await load();
  const base = { nMin: 1, nMax: 3, H: 500, w: 1200, count: 6 };
  let r = chooseColumns({ ...base, total: 400, memo: null, now: 0 });
  const seen = [];
  for (let i = 1; i <= 6; i++) {
    r = chooseColumns({ ...base, total: i % 2 ? 520 : 480, memo: r.memo, now: i * 100 });
    seen.push(r.n);
  }
  assert.deepEqual(seen, [1, 1, 1, 1, 1, 1], 'slightly over H inside dwell stays put');
  r = chooseColumns({ ...base, total: 520, memo: r.memo, now: 5000 });
  assert.equal(r.n, 2, 'grows once calm');
  r = chooseColumns({ ...base, total: 480, memo: r.memo, now: 5100 });
  assert.equal(r.n, 2, 'no flip back');
  r = chooseColumns({ ...base, total: 1400, memo: r.memo, now: 5200 });
  assert.equal(r.n, 3, 'large overflow grows immediately');
});

test('chooseColumns: shrink dwell still works with count', async () => {
  const { chooseColumns } = await load();
  const base = { nMin: 1, nMax: 3, H: 500, w: 1200, count: 4 };
  let r = chooseColumns({ ...base, total: 800, memo: null, now: 0 });
  assert.equal(r.n, 2);
  r = chooseColumns({ ...base, total: 100, memo: r.memo, now: 500 });
  assert.equal(r.n, 2);
  r = chooseColumns({ ...base, total: 100, memo: r.memo, now: 4000 });
  assert.equal(r.n, 1);
});
