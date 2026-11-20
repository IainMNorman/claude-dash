const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadState, saveState, sanitize } = require('../src/windowstate');

const defaults = { width: 980, height: 700 };
const d1 = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const d2 = { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 'win.json');

test('round trip save/load', () => {
  const f = tmp();
  const s = { x: 10, y: 20, width: 800, height: 600, maximized: false, fullscreen: false };
  saveState(f, s);
  assert.deepStrictEqual(loadState(f, defaults), { ...defaults, ...s });
});

test('missing file returns defaults', () => {
  assert.deepStrictEqual(loadState(path.join(tmp(), 'nope.json'), defaults), defaults);
});

test('corrupt JSON returns defaults', () => {
  const f = tmp();
  fs.writeFileSync(f, '{not json');
  assert.deepStrictEqual(loadState(f, defaults), defaults);
  fs.writeFileSync(f, '[1,2]');
  assert.deepStrictEqual(loadState(f, defaults), defaults);
});

test('atomic write leaves no tmp file', () => {
  const f = tmp();
  saveState(f, { width: 600, height: 500 });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(f)), ['win.json']);
});

test('on-screen rectangle kept', () => {
  const r = sanitize({ x: 100, y: 50, width: 900, height: 700 }, [d1], defaults);
  assert.deepStrictEqual(r, { x: 100, y: 50, width: 900, height: 700, maximized: false, fullscreen: false });
});

test('off-screen rectangle (display removed) drops x/y', () => {
  const r = sanitize({ x: 2500, y: 100, width: 900, height: 700 }, [d1], defaults);
  assert.ok(!('x' in r) && !('y' in r));
  assert.strictEqual(r.width, 900);
  assert.ok(sanitize({ x: 2500, y: 100, width: 900, height: 700 }, [d1, d2], defaults).x === 2500);
});

test('partially visible window kept', () => {
  const r = sanitize({ x: 1800, y: 1000, width: 900, height: 700 }, [d1], defaults);
  assert.strictEqual(r.x, 1800);
  assert.strictEqual(r.y, 1000);
});

test('barely visible window dropped', () => {
  const r = sanitize({ x: 1900, y: 100, width: 900, height: 700 }, [d1], defaults);
  assert.ok(!('x' in r));
});

test('oversized window clamped to work area', () => {
  const r = sanitize({ x: 0, y: 0, width: 5000, height: 4000 }, [d1], defaults);
  assert.strictEqual(r.width, 1920);
  assert.strictEqual(r.height, 1080);
});

test('too-small window clamped to min', () => {
  const r = sanitize({ x: 0, y: 0, width: 10, height: 10 }, [d1], defaults);
  assert.strictEqual(r.width, 480);
  assert.strictEqual(r.height, 360);
});

test('maximized and fullscreen flags preserved', () => {
  const r = sanitize({ x: 0, y: 0, width: 900, height: 700, maximized: true, fullscreen: true }, [d1], defaults);
  assert.strictEqual(r.maximized, true);
  assert.strictEqual(r.fullscreen, true);
});

test('corrupt values fall back to defaults', () => {
  for (const bad of [null, 'x', 42, { width: 'a', height: NaN, x: 'q', y: {} }]) {
    const r = sanitize(bad, [d1], defaults);
    assert.strictEqual(r.width, 980);
    assert.strictEqual(r.height, 700);
    assert.ok(!('x' in r));
    assert.strictEqual(r.maximized, false);
  }
});

test('no displays: size sanitised, position dropped', () => {
  const r = sanitize({ x: 5, y: 5, width: 700, height: 500 }, [], defaults);
  assert.strictEqual(r.width, 700);
  assert.ok(!('x' in r));
});
