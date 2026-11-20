const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core');
const { createLivenessChecker } = require('../src/liveness');

const A = '4243a0b9-375d-4f32-9cfe-02bde44c8c55';
const B = '36e16850-551f-455e-8428-56e2b26ae5a0';
const BIN = '/Users/x/Library/Application Support/Claude/claude-code/2.1.326/abc/claude.app/Contents/MacOS/claude --output-format stream-json --verbose';
const psLine = (id, wrap) => `${100} ${wrap ? '/Applications/Claude.app/Contents/Helpers/disclaimer --pgroup -- ' : ''}${BIN} --resume=${id} --allowedTools=x`;

function setup({ ps, ...opts } = {}) {
  let t = 1000000;
  const store = new Store({ now: () => t });
  const state = { out: ps || '' };
  const exec = async () => { if (state.out instanceof Error) throw state.out; return state.out; };
  const checker = createLivenessChecker({ exec, now: () => t, ...opts });
  const ev = (id, name, extra = {}) => store.ingest({ session_id: id, cwd: '/p/' + id.slice(0, 4), hook_event_name: name, ...extra });
  return { store, checker, state, ev, tick: (ms) => { t += ms; }, set: (v) => { state.out = v; } };
}

test('live session stays', async () => {
  const x = setup({ ps: psLine(A) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  for (let i = 0; i < 4; i++) await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
});

test('absent once stays, twice ends with process gone', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  const ended = await x.checker.check(x.store);
  const s = x.store.sessions.get(A);
  assert.deepEqual(ended, [A]);
  assert.equal(s.state, 'ended');
  assert.equal(s.endedReason, 'process gone');
  assert.equal(x.store.feed.at(-1).text, 'ended (process gone)');
});

test('seen alive resets the miss counter', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store);
  x.set(psLine(A) + '\n' + psLine(B));
  await x.checker.check(x.store);
  x.set(psLine(B));
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
});

test('grace period respected', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.tick(10000);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  x.tick(25000);
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
});

test('grace counts from lastEvent too', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'SessionStart'); x.tick(600000);
  await x.checker.check(x.store); x.ev(A, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  x.tick(5000);
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
});

test('ps failure changes nothing', async () => {
  const x = setup({ ps: new Error('boom') });
  x.ev(A, 'UserPromptSubmit'); x.tick(600000);
  for (let i = 0; i < 4; i++) await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  x.set(psLine(B));
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
});

test('no claude process with ids falls back to quiet detection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const tr = path.join(dir, 't.jsonl');
  fs.writeFileSync(tr, '{}');
  const x = setup({ ps: '1 /sbin/launchd\n2 /Applications/Claude.app/Contents/MacOS/Claude' });
  x.ev(A, 'UserPromptSubmit', { transcript_path: tr });
  const q = 6 * 3600 * 1000;
  x.tick(q + 1000);
  fs.utimesSync(tr, new Date(), new Date());
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  const old = new Date(Date.now() - 7 * 3600 * 1000);
  fs.utimesSync(tr, old, old);
  x.tick(q);
  const mtimeNow = fs.statSync(tr).mtimeMs;
  const ck = createLivenessChecker({ exec: async () => '1 /sbin/launchd', now: () => mtimeNow + q + 1000 });
  x.store.sessions.get(A).lastEvent = mtimeNow - q - 1000;
  await ck.check(x.store);
  const s = x.store.sessions.get(A);
  assert.equal(s.state, 'ended');
  assert.equal(s.endedReason, 'quiet');
  fs.rmSync(dir, { recursive: true });
});

test('revived session stays up after being ended by us', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
  x.ev(A, 'UserPromptSubmit');
  assert.equal(x.store.sessions.get(A).state, 'working');
  x.tick(60000);
  await x.checker.check(x.store);
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working', 'revived sessions are exempt from process-gone, so no flip-flop');
  x.ev(A, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(x.store.sessions.get(A).state, 'working');
});

test('dismissed and ended sessions are skipped', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.ev(B, 'SessionEnd'); x.tick(60000);
  x.store.setFlag(A, 'dismissed', true);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  assert.equal(x.store.sessions.get(B).endedReason, undefined);
});

test('wrapper and child lines with same id are fine', async () => {
  const x = setup({ ps: psLine(A, true) + '\n' + psLine(A) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
});

test('dashboard and electron lines are ignored', async () => {
  const noise = [
    `10 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --session=${A}`,
    `11 node /Users/x/git/claude-dash/src/headless.js ${A}`,
    `12 /x/claude-dash/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --id=${A}`,
  ].join('\n');
  const x = setup({ ps: noise + '\n' + psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
});

test('markEnded: unknown or already ended returns false, closes children', () => {
  const x = setup();
  assert.equal(x.store.markEnded('nope', 'r'), false);
  x.ev(A, 'PreToolUse', { tool_name: 'Task', tool_use_id: 'u1', tool_input: { description: 'd', subagent_type: 't' } });
  assert.equal(x.store.markEnded(A, 'r'), true);
  const s = x.store.sessions.get(A);
  assert.equal(s.tool, null);
  assert.ok(s.children.every((c) => c.status === 'done' && c.endedAt));
  assert.equal(x.store.markEnded(A, 'r'), false);
});

test('terminal session without an id in ps args is not ended by process-gone; quiet rule still applies', async () => {
  const x = setup({ ps: psLine(B), quietMs: 3600000 });
  x.store.resolver = () => ({ link: '' });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  for (let i = 0; i < 4; i++) await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
  x.tick(2 * 3600000);
  await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
  assert.equal(x.store.sessions.get(A).endedReason, 'quiet');
});

test('desktop session (has link) never seen in ps is still ended when the process is gone', async () => {
  const x = setup({ ps: psLine(B) });
  x.store.resolver = () => ({ link: 'claude://code/continue?session=local_x' });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
});

test('a session that revives after being ended by us is exempt from process-gone (no flip-flop)', async () => {
  const x = setup({ ps: psLine(B) });
  x.ev(A, 'UserPromptSubmit'); x.tick(60000);
  await x.checker.check(x.store); await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'ended');
  x.ev(A, 'PreToolUse', { tool_name: 'Read', tool_input: {} });
  assert.equal(x.store.sessions.get(A).state, 'working');
  assert.equal(x.store.sessions.get(A).endedReason, '', 'reason cleared on revive');
  x.tick(60000);
  for (let i = 0; i < 5; i++) await x.checker.check(x.store);
  assert.equal(x.store.sessions.get(A).state, 'working');
});
