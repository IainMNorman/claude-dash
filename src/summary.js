const BASH_RULES = [
  [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b|\bcargo\s+test\b|\bgo\s+test\b|node\s+--test|\bplaywright\b/, 'Running tests'],
  [/\b(npm|pnpm|yarn|bun)\s+run\s+(build|dev|lint|typecheck)\b|\bvite\s+build\b|\btsc\b|\bcargo\s+(build|check|clippy)\b|\bmake\b|\bnode\s+--check\b|\beslint\b|\bnpx\s+vite\b/, 'Building / checking'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+(install|upgrade)\b|\bcargo\s+add\b/, 'Installing packages'],
  [/\bgit\b/, 'Git'],
  [/\bgh\s/, 'GitHub'],
  [/\b(curl|wget)\b/, 'Network request'],
  [/\bdocker\b/, 'Docker'],
  [/<<|\bcat\s*>|\btee\b|\bsed\s+-i|\bpython3?\s+-(\s|$)|\b(mv|cp|rm|mkdir|touch|chmod)\b/, 'Changing files'],
  [/\b(grep|rg|find|fd|ls|tree)\b/, 'Searching files'],
  [/\b(cat|head|tail|sed|wc|stat|less|file|diff)\b/, 'Reading files'],
  [/\b(sleep|pgrep|pkill|ps|lsof|kill|wait)\b/, 'Checking processes'],
];

function mcpLabel(tool) {
  const m = /^mcp__(.+?)__/.exec(tool);
  if (!m) return null;
  const server = m[1].replace(/^plugin_?/, '').replace(/_/g, ' ').replace(/-/g, ' ').trim();
  return `Using ${server}`;
}

function summarise(tool, input = {}) {
  if (!tool) return '';
  if (tool === 'Bash') {
    if (input && input.run_in_background) return 'Starting background task';
    const cmd = String((input && input.command) || '');
    for (const [re, label] of BASH_RULES) if (re.test(cmd)) return label;
    return 'Running a command';
  }
  switch (tool) {
    case 'Read': return 'Reading files';
    case 'Grep': case 'Glob': return 'Searching files';
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return 'Editing files';
    case 'Task': case 'Agent': return 'Delegating to a subagent';
    case 'WebFetch': case 'WebSearch': return 'Browsing the web';
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Planning';
    case 'Skill': return 'Loading a skill';
    case 'AskUserQuestion': return 'Asking you a question';
    default: return mcpLabel(tool) || tool;
  }
}

module.exports = { summarise };
