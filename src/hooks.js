const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'PermissionRequest', 'Stop', 'SubagentStop', 'SessionEnd'];
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const SCRIPT = path.join(__dirname, '..', 'plugin', 'hooks', 'post.sh');
const isOurs = (cmd) => typeof cmd === 'string' && /[\\/]plugin[\\/]hooks[\\/]post\.sh$/.test(cmd);
const ownsGroup = (g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => isOurs(h.command));

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}

function status(file = SETTINGS, script = SCRIPT) {
  let s;
  try { s = read(file); } catch { return { installed: false, missing: EVENTS, error: 'settings.json is not valid JSON' }; }
  const hooks = (s && s.hooks) || {};
  const missing = EVENTS.filter((e) => !(Array.isArray(hooks[e]) && hooks[e].some((g) => ownsGroup(g) && g.hooks.some((h) => h.command === script))));
  return { installed: missing.length === 0, missing };
}

function write(file, s) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(`${file}.bak-claude-dash`)) fs.copyFileSync(file, `${file}.bak-claude-dash`);
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

function strip(hooks) {
  for (const e of Object.keys(hooks)) {
    if (!Array.isArray(hooks[e])) continue;
    hooks[e] = hooks[e].filter((g) => !ownsGroup(g));
    if (!hooks[e].length) delete hooks[e];
  }
}

function install(file = SETTINGS, script = SCRIPT) {
  const s = read(file);
  s.hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  strip(s.hooks);
  for (const e of EVENTS) {
    const g = { hooks: [{ type: 'command', command: script }] };
    if (e.endsWith('ToolUse')) g.matcher = '*';
    (s.hooks[e] = s.hooks[e] || []).push(g);
  }
  write(file, s);
  try { fs.chmodSync(script, 0o755); } catch { /* ignore */ }
  return status(file, script);
}

function uninstall(file = SETTINGS, script = SCRIPT) {
  const s = read(file);
  if (s.hooks) { strip(s.hooks); if (!Object.keys(s.hooks).length) delete s.hooks; }
  write(file, s);
  return status(file, script);
}

module.exports = { EVENTS, SETTINGS, SCRIPT, status, install, uninstall };
