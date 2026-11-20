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

test('background shell: pre/post capture id; reconcile marks it done when it leaves the list', () => {
  const { store } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'sleep 99', run_in_background: true } }));
  store.ingest(ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { run_in_background: true }, tool_response: { backgroundTaskId: 'sh1' } }));
  const s = store.sessions.get('s1');
  assert.equal(s.children[0].kind, 'shell');
  assert.equal(s.children[0].id, 'sh1');
  store.ingest(ev('SubagentStop', { agent_id: 'zz', background_tasks: [{ id: 'sh1', type: 'shell', status: 'running', description: 'sleep 99' }] }));
  assert.equal(s.children.find((c) => c.id === 'sh1').status, 'running');
  store.ingest(ev('SubagentStop', { agent_id: 'zz2', background_tasks: [] }));
  assert.equal(s.children.find((c) => c.id === 'sh1').status, 'done');
});

test('reconcile creates unknown tasks and honours finished statuses', () => {
  const { store } = mk();
  store.ingest(ev('SubagentStop', { agent_id: 'x', background_tasks: [
    { id: 'a9', type: 'subagent', status: 'running', description: 'M7', agent_type: 'general-purpose' },
    { id: 'sh2', type: 'shell', status: 'completed', description: 'npm test' },
  ] }));
  const kids = store.sessions.get('s1').children;
  const a = kids.find((c) => c.id === 'a9');
  const sh = kids.find((c) => c.id === 'sh2');
  assert.equal(a.status, 'running');
  assert.equal(a.kind, 'subagent');
  assert.equal(sh.status, 'done');
  assert.equal(sh.kind, 'shell');
});

test('id-less shell is closed when a task list arrives with no shells after 15s', () => {
  const { store, tick } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b2', tool_input: { command: 'x', run_in_background: true } }));
  tick(5000);
  store.ingest(ev('Notification', { notification_type: 'idle_prompt', background_tasks: [] }));
  assert.equal(store.sessions.get('s1').children[0].status, 'running');
  tick(11000);
  store.ingest(ev('Notification', { notification_type: 'idle_prompt', background_tasks: [] }));
  assert.equal(store.sessions.get('s1').children[0].status, 'done');
});

test('sessions saved by older versions (no children/flags) still ingest after hydrate', () => {
  const { store } = mk();
  store.hydrate({ version: 1, feed: [], sessions: [{ id: 'old1', cwd: '/o/old', project: 'old', state: 'working', tool: null, toolDetail: '', prompt: '', message: '', toolCount: 3, startedAt: 1, lastEvent: 1, stateSince: 1, transcript: '' }] });
  assert.doesNotThrow(() => store.ingest({ session_id: 'old1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't', tool_input: { description: 'x' } }));
  const s = store.sessions.get('old1');
  assert.equal(s.children.length, 1);
  assert.equal(s.pinned, false);
  assert.equal(store.snapshot().sessions[0].subagents, 1);
});

test('an in-memory session missing children does not break ingest', () => {
  const { store } = mk();
  store.ingest(ev('SessionStart'));
  delete store.sessions.get('s1').children;
  assert.doesNotThrow(() => store.ingest(ev('PreToolUse', { tool_name: 'Read', tool_input: {} })));
});

const { createSubagentScanner } = require('../src/subagents');

function fakeSession(metas) {
  const root = tmp();
  const transcript = path.join(root, 'sess1.jsonl');
  fs.writeFileSync(transcript, '');
  const dir = path.join(root, 'sess1', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, meta, touch] of metas) {
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), '{}\n');
    if (touch) { const t = new Date(touch); fs.utimesSync(path.join(dir, `agent-${id}.jsonl`), t, t); fs.utimesSync(path.join(dir, `agent-${id}.meta.json`), t, t); }
  }
  return transcript;
}

test('scanner: running = unfinished and recently active; finished flag honoured; abandoned and ancient ignored', () => {
  const tr = fakeSession([
    ['run1', { description: 'M7 Task 5', agentType: 'general-purpose', toolUseId: 'tu5' }],
    ['fin1', { description: 'Task 4', agentType: 'general-purpose', toolUseId: 'tu4', finished: true }],
    ['dead1', { description: 'abandoned', toolUseId: 'tu0' }, Date.now() - 60 * 60 * 1000],
    ['old1', { description: 'ancient', finished: true }, Date.now() - 3 * 24 * 3600 * 1000],
  ]);
  const list = createSubagentScanner().scan(tr);
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(by).sort(), ['fin1', 'run1']);
  assert.equal(by.run1.status, 'running');
  assert.equal(by.run1.desc, 'M7 Task 5');
  assert.equal(by.run1.toolUseId, 'tu5');
  assert.equal(by.fin1.status, 'done');
  assert.deepEqual(createSubagentScanner().scan('/no/such.jsonl'), []);
  assert.deepEqual(createSubagentScanner().scan(''), []);
});

test('syncChildren: adds already-running agents, matches hook children by toolUseId, never revives done', () => {
  const { store, tick } = mk();
  tick(2 * 3600 * 1000);
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tuA', tool_input: { description: 'A' } }));
  const fsList = [
    { id: 'aA', toolUseId: 'tuA', desc: 'A', type: 'general-purpose', status: 'running', startedAt: 500 },
    { id: 'aB', toolUseId: 'tuB', desc: 'B pre-existing', type: 'general-purpose', status: 'running', startedAt: 400 },
    { id: 'aC', toolUseId: 'tuC', desc: 'C long finished', status: 'done', startedAt: 100, endedAt: 200 },
  ];
  assert.equal(store.syncChildren('s1', fsList), true);
  const kids = store.sessions.get('s1').children;
  assert.equal(kids.length, 2, 'finished-long-ago agent not added');
  assert.equal(kids[0].id, 'aA');
  assert.equal(kids[1].desc, 'B pre-existing');
  assert.equal(store.sessions.get('s1').subagents, 2);
  assert.equal(store.syncChildren('s1', fsList), false, 'idempotent');
  fsList[0] = { ...fsList[0], status: 'done', endedAt: 900 };
  store.syncChildren('s1', fsList);
  assert.equal(kids[0].status, 'done');
  fsList[0] = { ...fsList[0], status: 'running' };
  store.syncChildren('s1', fsList);
  assert.equal(kids[0].status, 'done', 'done is never revived');
  assert.equal(store.syncChildren('nope', fsList), false);
});

test('syncChildren leaves a hook-reported waiting child alone', () => {
  const { store } = mk();
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tuW', tool_input: { description: 'W' } }));
  store.ingest(ev('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tuW', tool_response: { isAsync: true, agentId: 'aW' } }));
  store.ingest(ev('Notification', { agent_id: 'aW', message: 'perm' }));
  store.syncChildren('s1', [{ id: 'aW', toolUseId: 'tuW', desc: 'W', status: 'running', startedAt: 1 }]);
  assert.equal(store.sessions.get('s1').children[0].status, 'waiting');
});

const { syncShellStarts, tasksDirFor } = require('../src/shells');

test('shell start time comes from the task output file birthtime', () => {
  const root = tmp();
  const scratch = path.join(root, 'sess', 'scratchpad');
  fs.mkdirSync(path.join(root, 'sess', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sess', 'tasks', 'bAAA.output'), '');
  const session = { scratchpadDir: scratch, children: [
    { kind: 'shell', id: 'bAAA', startedAt: 1 },
    { kind: 'shell', id: 'bMISSING', startedAt: 2 },
    { kind: 'subagent', id: 'aX', startedAt: 3 },
  ] };
  assert.equal(syncShellStarts(session), true);
  assert.ok(session.children[0].startedAt > 1e12);
  assert.equal(session.children[0].fsStart, true);
  assert.equal(session.children[1].startedAt, 2);
  assert.equal(session.children[2].startedAt, 3);
  assert.equal(syncShellStarts(session), false, 'already synced');
  assert.equal(syncShellStarts({ children: [] }), false);
  assert.equal(tasksDirFor(scratch), path.join(root, 'sess', 'tasks'));
  assert.equal(tasksDirFor(''), null);
});

test('scratchpad_dir from events is remembered on the session', () => {
  const { store } = mk();
  store.ingest(ev('SessionStart', { scratchpad_dir: '/tmp/x/sess/scratchpad' }));
  assert.equal(store.sessions.get('s1').scratchpadDir, '/tmp/x/sess/scratchpad');
});
