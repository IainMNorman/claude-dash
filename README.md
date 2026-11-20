# claude-dash

Live dashboard for Claude Code sessions on this machine. Hooks POST events to a local server; an Electron tray app (or any browser) shows them.

## Setup

1. Install and run the dashboard:
   ```bash
   git clone https://github.com/IainMNorman/claude-dash ~/git/claude-dash
   cd ~/git/claude-dash && npm install && npm start
   ```
   No Electron? `npm run headless`, then open http://127.0.0.1:47821.

2. Add the hooks to `~/.claude/settings.json` (works for Claude desktop's Code tab and the CLI). Run once:
   ```bash
   node -e '
   const fs=require("fs"),f=process.env.HOME+"/.claude/settings.json";
   let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
   const cmd=process.env.HOME+"/git/claude-dash/plugin/hooks/post.sh";
   s.hooks=s.hooks||{};
   for(const e of ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","Notification","Stop","SubagentStop","SessionEnd"]){
     const a=s.hooks[e]=s.hooks[e]||[];
     if(JSON.stringify(a).includes("claude-dash"))continue;
     const g={hooks:[{type:"command",command:cmd}]};
     if(e.endsWith("ToolUse"))g.matcher="*";
     a.push(g);
   }
   fs.writeFileSync(f,JSON.stringify(s,null,2)+"\n");'
   ```
   Alternative for a single CLI session: `claude --plugin-dir ~/git/claude-dash/plugin`.

3. Start a **new** Claude session (hooks load at session start). It appears in the dashboard within seconds. If not, quit and reopen Claude desktop.

## Notes

- Port: 47821, override with `CLAUDE_DASH_PORT`. The server writes its port to `~/.claude/dashboard.port`, which the hook script reads.
- The hook script fails silently if the dashboard isn't running, so Claude is never blocked.
- Try it without real sessions: `npm run mock`.
- Tests: `npm test`.
- Remove: delete the `claude-dash` entries from `~/.claude/settings.json` hooks.
