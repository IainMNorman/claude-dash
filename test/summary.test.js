const test = require('node:test');
const assert = require('node:assert');
const { summarise } = require('../src/summary');
const { Store } = require('../src/core');

const bash = (command, extra = {}) => summarise('Bash', { command, ...extra });

test('bash commands collapse to a category, never the command text', () => {
  assert.equal(bash('npm test -- --run src/engine'), 'Running tests');
  assert.equal(bash('node --test test/*.test.js'), 'Running tests');
  assert.equal(bash('npx vite build 2>&1 | tail -1'), 'Building / checking');
  assert.equal(bash('node --check src/core.js'), 'Building / checking');
  assert.equal(bash('cd ~/git/x && git add -A && git commit -qm "msg"'), 'Git');
  assert.equal(bash('gh pr view 12'), 'GitHub');
  assert.equal(bash('curl -s localhost:47821/api/state'), 'Network request');
  assert.equal(bash('cat > src/a.js <<\'EOF\'\nx\nEOF'), 'Changing files');
  assert.equal(bash('grep -rn foo src'), 'Searching files');
  assert.equal(bash('head -20 README.md'), 'Reading files');
  assert.equal(bash('sleep 5; pgrep -f cargo'), 'Checking processes');
  assert.equal(bash('some-custom-binary --flag'), 'Running a command');
  assert.equal(bash('anything', { run_in_background: true }), 'Starting background task');
  assert.equal(bash('npm i && git status'), 'Installing packages');
  assert.equal(bash('npm test && git commit'), 'Running tests', 'tests outrank git in compound commands');
  assert.equal(bash(''), 'Running a command');
});

test('other tools and mcp servers', () => {
  assert.equal(summarise('Read', {}), 'Reading files');
  assert.equal(summarise('Glob', {}), 'Searching files');
  assert.equal(summarise('Edit', {}), 'Editing files');
  assert.equal(summarise('Agent', {}), 'Delegating to a subagent');
  assert.equal(summarise('WebSearch', {}), 'Browsing the web');
  assert.equal(summarise('mcp__Claude_Browser__navigate', {}), 'Using Claude Browser');
  assert.equal(summarise('Mystery', {}), 'Mystery');
  assert.equal(summarise('', {}), '');
  assert.equal(summarise(undefined), '');
});

const ev = (name, extra = {}) => ({ session_id: 's1', cwd: '/x/p', hook_event_name: name, ...extra });

test('activity survives PostToolUse (no flicker) and clears on Stop', () => {
  const store = new Store();
  store.ingest(ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' } }));
  const s = store.sessions.get('s1');
  assert.equal(s.activity, 'Git');
  store.ingest(ev('PostToolUse', { tool_name: 'Bash' }));
  assert.equal(s.activity, 'Git');
  store.ingest(ev('Stop'));
  assert.equal(s.activity, '');
});

test('child activity is kept on the child, feed shows summaries and skips PostToolUse', () => {
  const store = new Store();
  store.ingest(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 't', tool_input: { description: 'd' } }));
  store.ingest(ev('PostToolUse', { tool_name: 'Agent', tool_use_id: 't', tool_response: { isAsync: true, agentId: 'a1' } }));
  store.ingest(ev('PreToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  const s = store.sessions.get('s1');
  assert.equal(s.children[0].activity, 'Running tests');
  assert.equal(s.activity, 'Delegating to a subagent');
  const feed = store.snapshot().feed;
  assert.ok(feed.every((f) => f.event !== 'PostToolUse'));
  assert.equal(feed[0].text, 'Running tests');
  assert.equal(feed[0].child, true);
});

test('status sort is stable: same-status cards never swap on new events', () => {
  let t = 1000;
  const store = new Store({ now: () => t });
  for (const [id, cwd] of [['b', '/x/beta'], ['a', '/x/alpha'], ['c', '/x/gamma']]) store.ingest({ session_id: id, cwd, hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  const order = () => store.snapshot().sessions.map((s) => s.project).join(',');
  const first = order();
  t += 500;
  store.ingest({ session_id: 'c', cwd: '/x/gamma', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  t += 500;
  store.ingest({ session_id: 'a', cwd: '/x/alpha', hook_event_name: 'Stop' });
  assert.equal(first, 'alpha,beta,gamma');
  assert.equal(order(), 'alpha,beta,gamma', 'working<->idle flips and fresher events do not reorder');
  store.ingest({ session_id: 'b', cwd: '/x/beta', hook_event_name: 'Notification', message: 'perm?' });
  assert.equal(order(), 'beta,alpha,gamma', 'needs-you still floats to the top');
});
