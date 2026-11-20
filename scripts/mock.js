const port = process.env.CLAUDE_DASH_PORT || 47821;
const send = (ev) => fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', body: JSON.stringify(ev) }).catch(() => {});
const sessions = [
  { session_id: 'mock-a', cwd: '/Users/me/git/charb' },
  { session_id: 'mock-b', cwd: '/Users/me/git/writingapp' },
  { session_id: 'mock-c', cwd: '/Users/me/git/claude-dash' },
];
const tools = [
  ['Bash', { command: 'npm test' }], ['Read', { file_path: 'src/engine.ts' }],
  ['Edit', { file_path: 'src/rules.ts' }], ['Grep', { pattern: 'TODO' }], ['Task', { description: 'review' }],
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
for (const s of sessions) send({ ...s, hook_event_name: 'SessionStart' });
setInterval(() => {
  const s = pick(sessions);
  const r = Math.random();
  if (r < 0.15) send({ ...s, hook_event_name: 'UserPromptSubmit', prompt: 'Refactor the thing and add tests' });
  else if (r < 0.2) send({ ...s, hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
  else if (r < 0.3) send({ ...s, hook_event_name: 'Stop' });
  else {
    const [tool_name, tool_input] = pick(tools);
    send({ ...s, hook_event_name: 'PreToolUse', tool_name, tool_input });
    setTimeout(() => send({ ...s, hook_event_name: 'PostToolUse', tool_name }), 800);
  }
}, 1200);
console.log('mock events -> port', port);
