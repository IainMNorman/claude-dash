const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core');
const { createTokenTracker } = require('../src/tokens');
const { createDesktopIndex } = require('../src/desktop');
const { createAttentionTracker } = require('../src/attention');

const ev = (name, extra = {}) => ({ session_id: 's1', cwd: '/x/proj', hook_event_name: name, ...extra });
function mk(opts) {
  let t = 1000;
  return { store: new Store({ ...opts, now: () => t }), tick: (ms) => { t += ms; } };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dash-f-'));

test('async subagent: pre -> post(agentId) -> stop matched by agent_id', () => {
  const { store } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { description: 'Task 5', subagent_type: 'general-purpose' } }));
  store.ingest(ev('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_response: { isAsync: true, agentId: 'aA' } }));
  const s = store.sessions.get('s1');
  assert.equal(s.children.length, 1);
  assert.equal(s.children[0].id, 'aA');
  assert.equal(s.children[0].status, 'running');
  assert.equal(s.subagents, 1);
  store.ingest(ev('Stop'));
  assert.equal(s.subagents, 1, 'session Stop must not end async children');
  store.ingest(ev('SubagentStop', { agent_id: 'aA', agent_type: '' }));
  assert.equal(s.children[0].status, 'done');
  assert.equal(s.subagents, 0);
});

test('two parallel subagents are matched by id, not order', () => {
  const { store } = mk();
  for (const [tu, id, d] of [['t1', 'a1', 'one'], ['t2', 'a2', 'two']]) {
    store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: tu, tool_input: { description: d } }));
    store.ingest(ev('PostToolUse', { tool_name: 'Agent', tool_use_id: tu, tool_response: { isAsync: true, agentId: id } }));
  }
  store.ingest(ev('SubagentStop', { agent_id: 'a2' }));
  const c = store.sessions.get('s1').children;
  assert.deepEqual(c.map((x) => x.status), ['running', 'done']);
});

test('sync agent finishes on non-async post; SessionEnd closes the rest', () => {
  const { store } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Task', tool_use_id: 't1', tool_input: { description: 'sync' } }));
  store.ingest(ev('PostToolUse', { tool_name: 'Task', tool_use_id: 't1', tool_response: { content: 'done' } }));
  assert.equal(store.sessions.get('s1').children[0].status, 'done');
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 't2', tool_input: {} }));
  store.ingest(ev('SessionEnd'));
  assert.equal(store.sessions.get('s1').subagents, 0);
});

test('events carrying agent_id update the child, not the session tool', () => {
  const { store } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 't1', tool_input: { description: 'd' } }));
  store.ingest(ev('PostToolUse', { tool_name: 'Agent', tool_use_id: 't1', tool_response: { isAsync: true, agentId: 'aX' } }));
  store.ingest(ev('PreToolUse', { agent_id: 'aX', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  const s = store.sessions.get('s1');
  assert.equal(s.children[0].tool, 'Bash');
  assert.equal(s.tool, null);
  store.ingest(ev('Notification', { agent_id: 'aX', message: 'perm?' }));
  assert.equal(s.children[0].status, 'waiting');
  assert.equal(s.state, 'waiting');
  assert.equal(s.message, 'perm?');
});

test('idle_prompt notification is idle, not needs-you', () => {
  const { store } = mk();
  store.ingest(ev('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }));
  assert.equal(store.sessions.get('s1').state, 'idle');
  store.ingest(ev('Notification', { message: 'Claude needs your permission to use Bash' }));
  assert.equal(store.sessions.get('s1').state, 'waiting');
});

test('pin/dismiss flags; dismissed session returns on new activity', () => {
  const { store } = mk();
  store.ingest(ev('SessionStart'));
  assert.equal(store.setFlag('s1', 'pinned', true), true);
  assert.equal(store.setFlag('s1', 'bogus', true), false);
  assert.equal(store.setFlag('nope', 'pinned', true), false);
  store.setFlag('s1', 'dismissed', true);
  assert.equal(store.snapshot().sessions[0].dismissed, true);
  store.ingest(ev('PreToolUse', { tool_name: 'Read', tool_input: {} }));
  assert.equal(store.sessions.get('s1').dismissed, false);
  assert.equal(store.sessions.get('s1').pinned, true);
});

test('stuck: working and quiet beyond threshold', () => {
  const { store, tick } = mk();
  store.stuckMs = 5000;
  store.ingest(ev('PreToolUse', { tool_name: 'Bash', tool_input: {} }));
  assert.equal(store.snapshot().sessions[0].stuck, false);
  tick(6000);
  assert.equal(store.snapshot().sessions[0].stuck, true);
});

test('resolver enriches snapshot', () => {
  const { store } = mk();
  store.resolver = (s) => ({ title: 'T-' + s.id });
  store.ingest(ev('SessionStart'));
  assert.equal(store.snapshot().sessions[0].title, 'T-s1');
});

test('tokens: incremental, dedupes message ids, tolerates partial last line', () => {
  const f = path.join(tmp(), 't.jsonl');
  const line = (id, i, o) => JSON.stringify({ uuid: 'u' + id, message: { id, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 10, cache_creation_input_tokens: 1 } } }) + '\n';
  fs.writeFileSync(f, line('m1', 5, 7) + line('m1', 5, 7) + '{"partial');
  const tr = createTokenTracker();
  assert.deepEqual(tr.update(f), { input: 5, output: 7, cacheRead: 10, cacheWrite: 1 });
  fs.appendFileSync(f, '":1}\n' + line('m2', 3, 2));
  assert.deepEqual(tr.update(f), { input: 8, output: 9, cacheRead: 20, cacheWrite: 2 });
  assert.equal(tr.update('/nonexistent/x.jsonl'), null);
  assert.equal(tr.update(''), null);
});

test('desktop index maps cliSessionId to title and claude:// link', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'b', 'local_abc-1.json'), JSON.stringify({ sessionId: 'local_abc-1', cliSessionId: 'cli-9', title: 'My thread' }));
  fs.writeFileSync(path.join(dir, 'a', 'b', 'local_bad.json'), '{nope');
  const idx = createDesktopIndex({ dir, ttlMs: 0 });
  assert.deepEqual(idx.lookup('cli-9'), { title: 'My thread', link: 'claude://code/continue?session=local_abc-1' });
  assert.equal(idx.lookup('unknown'), null);
  assert.equal(createDesktopIndex({ dir: path.join(dir, 'missing') }).lookup('x'), null);
});

test('attention: notifies on new waiting only, not on first load or repeats', () => {
  const { store } = mk();
  const att = createAttentionTracker();
  store.ingest(ev('Notification', { message: 'old' }));
  assert.equal(att.check(store.snapshot()).fresh.length, 0, 'primed on first call');
  assert.equal(att.check(store.snapshot()).fresh.length, 0);
  store.ingest(ev('PreToolUse', { tool_name: 'Read', tool_input: {} }));
  assert.equal(att.check(store.snapshot()).count, 0);
  store.ingest(ev('Notification', { message: 'perm' }));
  const r = att.check(store.snapshot());
  assert.equal(r.fresh.length, 1);
  assert.equal(r.count, 1);
  assert.equal(att.check(store.snapshot()).fresh.length, 0);
  store.setFlag('s1', 'dismissed', true);
  assert.equal(att.check(store.snapshot()).count, 0);
});
