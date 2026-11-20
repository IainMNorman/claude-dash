#!/bin/sh
PORT="${CLAUDE_DASH_PORT:-$(cat "$HOME/.claude/dashboard.port" 2>/dev/null)}"
PORT="${PORT:-47821}"
curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- "http://127.0.0.1:$PORT/event" >/dev/null 2>&1
exit 0
