const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hooks = require('../src/hooks');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-hooks-')), 'settings.json');
const script = '/opt/x/claude-dash/plugin/hooks/post.sh';

test('install creates settings, is idempotent, and reports status', () => {
  const f = tmp();
  assert.equal(hooks.status(f, script).installed, false);
  assert.equal(hooks.install(f, script).installed, true);
  hooks.install(f, script);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of hooks.EVENTS) assert.equal(s.hooks[e].length, 1);
  assert.equal(s.hooks.PreToolUse[0].matcher, '*');
});

test('install preserves existing settings and hooks, and backs up', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: '/bin/other' }] }] } }));
  hooks.install(f, script);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(s.model, 'x');
  assert.equal(s.hooks.Stop.length, 2);
  assert.ok(fs.existsSync(`${f}.bak-claude-dash`));
});

test('reinstall from a new location replaces the stale path; uninstall removes only ours', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/bin/other' }] }] } }));
  hooks.install(f, '/old/claude-dash/plugin/hooks/post.sh');
  assert.equal(hooks.status(f, script).installed, false);
  hooks.install(f, script);
  assert.equal(hooks.status(f, script).installed, true);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).hooks.SessionEnd.length, 1);
  hooks.uninstall(f, script);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(Object.keys(s.hooks), ['Stop']);
  assert.equal(s.hooks.Stop[0].hooks[0].command, '/bin/other');
});

test('invalid settings.json is reported and never overwritten', () => {
  const f = tmp();
  fs.writeFileSync(f, '{ nope');
  assert.match(hooks.status(f, script).error, /not valid/);
  assert.throws(() => hooks.install(f, script));
  assert.equal(fs.readFileSync(f, 'utf8'), '{ nope');
});
