const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Store } = require('../src/core');
const { createServer } = require('../src/server');

const base = { session_id: 's1', cwd: '/x/proj' };
const ev = (name, extra = {}) => ({ ...base, hook_event_name: name, ...extra });

function mk(opts) {
  let t = 1000;
  const store = new Store({ ...opts, now: () => t });
  return { store, tick: (ms) => { t += ms; } };
}

test('ignores events without session or name', () => {
  const { store } = mk();
  assert.equal(store.ingest({}), false);
  assert.equal(store.ingest({ session_id: 'a' }), false);
  assert.equal(store.sessions.size, 0);
});

test('session lifecycle', () => {
  const { store } = mk();
  store.ingest(ev('SessionStart'));
  assert.equal(store.sessions.get('s1').state, 'idle');
  assert.equal(store.sessions.get('s1').project, 'proj');
  store.ingest(ev('UserPromptSubmit', { prompt: 'hi' }));
  assert.equal(store.sessions.get('s1').state, 'working');
  store.ingest(ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  const s = store.sessions.get('s1');
  assert.equal(s.tool, 'Bash');
  assert.equal(s.toolDetail, 'ls');
  assert.equal(s.toolCount, 1);
  store.ingest(ev('PostToolUse'));
  assert.equal(s.tool, null);
  store.ingest(ev('Stop'));
  assert.equal(s.state, 'idle');
  store.ingest(ev('SessionEnd'));
  assert.equal(s.state, 'ended');
});

test('notification sets waiting; next tool clears message', () => {
  const { store } = mk();
  store.ingest(ev('Notification', { message: 'need perm' }));
  const s = store.sessions.get('s1');
  assert.equal(s.state, 'waiting');
  assert.equal(s.message, 'need perm');
  store.ingest(ev('PreToolUse', { tool_name: 'Read', tool_input: {} }));
  assert.equal(s.state, 'working');
  assert.equal(s.message, '');
});

test('subagent counting never goes negative', () => {
  const { store } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Task', tool_input: {} }));
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_input: {} }));
  assert.equal(store.sessions.get('s1').subagents, 2);
  store.ingest(ev('SubagentStop'));
  store.ingest(ev('SubagentStop'));
  store.ingest(ev('SubagentStop'));
  assert.equal(store.sessions.get('s1').subagents, 0);
});

test('stale detection and ordering', () => {
  const { store, tick } = mk({ staleMs: 5000 });
  store.ingest(ev('PreToolUse', { tool_name: 'Read', tool_input: {} }));
  store.ingest({ session_id: 's2', cwd: '/y/other', hook_event_name: 'Notification', message: 'x' });
  tick(6000);
  store.ingest({ session_id: 's3', cwd: '/z/fresh', hook_event_name: 'SessionStart' });
  const snap = store.snapshot();
  assert.deepEqual(snap.sessions.map((s) => s.displayState), ['idle', 'stale', 'stale']);
  store.ingest({ session_id: 's2', cwd: '/y/other', hook_event_name: 'Notification', message: 'x' });
  assert.equal(store.snapshot().sessions[0].id, 's2');
});

test('feed is capped and newest first', () => {
  const { store } = mk({ feedSize: 3 });
  for (let i = 0; i < 5; i++) store.ingest(ev('PreToolUse', { tool_name: 'T' + i, tool_input: {} }));
  const feed = store.snapshot().feed;
  assert.equal(feed.length, 3);
  assert.equal(feed[0].text, 'T4');
});

test('prune removes only old ended sessions', () => {
  const { store, tick } = mk();
  store.ingest(ev('SessionEnd'));
  store.ingest({ session_id: 's2', hook_event_name: 'SessionStart' });
  tick(100);
  store.prune(50);
  assert.equal(store.sessions.has('s1'), false);
  assert.equal(store.sessions.has('s2'), true);
});

test('http: POST /event updates /api/state; malformed ignored', async () => {
  const store = new Store();
  const server = createServer(store);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const post = (body) => fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', body });
  assert.equal((await post(JSON.stringify(ev('SessionStart')))).status, 204);
  assert.equal((await post('{nope')).status, 204);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].project, 'proj');
  assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  server.close();
  server.closeAllConnections?.();
});

test('persist: state survives restart; ended sessions older than a day pruned', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { load, save } = require('../src/persist');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-')), 'state.json');
  const a = mk();
  a.store.ingest(ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  a.store.ingest({ session_id: 'old', cwd: '/o', hook_event_name: 'SessionEnd' });
  a.tick(2 * 24 * 3600 * 1000);
  save(a.store, file);
  const b = new Store({ now: () => 1000 + 2 * 24 * 3600 * 1000 });
  assert.equal(load(b, file), true);
  assert.equal(b.sessions.has('s1'), true);
  assert.equal(b.sessions.get('s1').tool, 'Bash');
  assert.equal(b.sessions.has('old'), false);
  assert.equal(b.snapshot().feed.length, 2);
  assert.equal(load(new Store(), path.join(os.tmpdir(), 'nope-missing.json')), false);
  fs.writeFileSync(file, '{bad');
  assert.equal(load(new Store(), file), false);
});

test('agent/notification pseudo-prompts do not overwrite the last real prompt', () => {
  const { Store } = require('../src/core');
  const st = new Store();
  st.ingest({ hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd: '/x', prompt: 'real ask' });
  st.ingest({ hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd: '/x', prompt: '<agent-message from="a">hand-back</agent-message>' });
  st.ingest({ hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd: '/x', prompt: '<task-notification><task-id>1</task-id></task-notification>' });
  assert.equal(st.sessions.get('p1').prompt, 'real ask');
});

test('hydrate drops a stored pseudo-prompt but keeps a real one', () => {
  const { Store } = require('../src/core');
  const st = new Store();
  const base = { cwd: '/x', state: 'idle', startedAt: 1, lastEvent: 1, stateSince: 1, toolCount: 0 };
  st.hydrate({ version: 1, sessions: [{ ...base, id: 'a', project: 'a', prompt: '<agent-message from="x">hi</agent-message>' }, { ...base, id: 'b', project: 'b', prompt: 'real' }] });
  assert.equal(st.sessions.get('a').prompt, '');
  assert.equal(st.sessions.get('b').prompt, 'real');
});
