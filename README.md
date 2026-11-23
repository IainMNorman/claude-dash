# claude-dash

> Unofficial community project. Not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" is a trademark of Anthropic.

Live dashboard for Claude Code sessions on this machine. Hooks POST events to a local server; an Electron tray app (or any browser) shows them.

## Setup

1. Install and run the dashboard (macOS; needs Node 20+):
   ```bash
   git clone <this-repo-url> claude-dash
   cd claude-dash && npm install && npm start
   ```
   `npm start` builds the UI with Vite, then launches Electron. No Electron? `npm run headless`, then open http://127.0.0.1:47821.
   Developing? `npm run dev` runs Vite with HMR for the UI and restarts Electron when `src/*.js` changes.

2. Install the hooks. On first launch the dashboard shows an **Install hooks** banner; click it. (Also available from the app menu: *Claude Hooks > Install Hooks*, or `npm run install-hooks` from the checkout.) This adds entries to `~/.claude/settings.json` (works for Claude desktop's Code tab and the CLI), keeping a one-time backup at `settings.json.bak-claude-dash`. Alternative for a single CLI session: `claude --plugin-dir <path-to-checkout>/plugin`.

   If you move the checkout, click **Repair hooks** (or run `npm run install-hooks` again) to update the path.

3. Start a **new** Claude session (hooks load at session start). It appears in the dashboard within seconds. If not, quit and reopen Claude desktop.

## Features

- Session cards: desktop thread title, state, current tool, token totals (from transcripts), subagent rows (running / needs you / finished), "quiet?" flag after 3 min without events.
- **Needs you:** permission prompts highlight the card (and the subagent that asked), set the window title count and Dock badge, and fire a desktop notification. Clicking it opens the thread in Claude desktop.
- **Open** button on each card uses `claude://code/continue?session=local_<id>` (needs Claude desktop's entry-point deep links enabled).
- Filter (Live, Waiting, Working, Quiet?, Stale, Ended, Dismissed, All), search, sort (status, latest event, name, longest in state, most tools, newest), pin and dismiss.
- Activity drawer: toggle with the Activity button; Pin docks it as a column, unpinned it floats (Esc or click outside closes).
- State persists in `~/.claude/dashboard-state.json`.

## Notes

- Child-event payloads are logged to `~/.claude/dashboard-debug.jsonl`; set `CLAUDE_DASH_DEBUG=0` to disable.
- Background shells (`run_in_background` Bash) are not tracked as children yet.

- Port: 47821, override with `CLAUDE_DASH_PORT`. The server writes its port to `~/.claude/dashboard.port`, which the hook script reads.
- The hook script fails silently if the dashboard isn't running, so Claude is never blocked.
- Try it without real sessions: `npm run mock`.
- Tests: `npm test`.
- Remove: *Claude Hooks > Remove Hooks* in the app menu, or `npm run install-hooks -- --remove`.

## Privacy and security

- Everything stays on your machine. The server binds to `127.0.0.1` only, and nothing is sent anywhere. Session prompts, paths and transcripts are read locally and shown in the dashboard.
- State files live in `~/.claude/` (`dashboard-state.json`, `dashboard.port`, `dashboard-debug.jsonl`).
- Write endpoints (`/api/hooks`, `/api/open`, ...) reject requests from foreign browser origins.
- UI fonts are loaded from an installed Claude desktop app if present, otherwise system fonts are used. No font files are bundled.

## License

MIT. See [LICENSE](LICENSE).
