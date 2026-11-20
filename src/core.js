const path = require('node:path');

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

function detail(tool, input = {}) {
  const v = input.command || input.file_path || input.pattern || input.url || input.description || input.query || '';
  return String(v).slice(0, 120);
}

class Store {
  constructor({ staleMs = 10 * 60 * 1000, feedSize = 200, now = Date.now } = {}) {
    this.sessions = new Map();
    this.feed = [];
    this.staleMs = staleMs;
    this.feedSize = feedSize;
    this.now = now;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  ingest(ev) {
    const id = ev && ev.session_id;
    const name = ev && ev.hook_event_name;
    if (!id || !name) return false;
    const t = this.now();
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id, cwd: ev.cwd || '', project: ev.cwd ? path.basename(ev.cwd) : id.slice(0, 8),
        state: 'idle', tool: null, toolDetail: '', prompt: '', message: '',
        subagents: 0, toolCount: 0, startedAt: t, lastEvent: t, stateSince: t,
        transcript: ev.transcript_path || '',
      };
      this.sessions.set(id, s);
    }
    if (ev.cwd && !s.cwd) { s.cwd = ev.cwd; s.project = path.basename(ev.cwd); }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    s.lastEvent = t;
    const set = (state) => { if (s.state !== state) { s.state = state; s.stateSince = t; } };

    switch (name) {
      case 'SessionStart':
        set('idle'); break;
      case 'UserPromptSubmit':
        set('working'); s.prompt = String(ev.prompt || '').slice(0, 200); s.message = ''; break;
      case 'PreToolUse':
        set('working'); s.tool = ev.tool_name || null; s.toolDetail = detail(ev.tool_name, ev.tool_input);
        s.toolCount++; s.message = '';
        if (SUBAGENT_TOOLS.has(ev.tool_name)) s.subagents++;
        break;
      case 'PostToolUse':
        s.tool = null; s.toolDetail = ''; break;
      case 'Notification':
        set('waiting'); s.message = String(ev.message || '').slice(0, 200); break;
      case 'SubagentStop':
        s.subagents = Math.max(0, s.subagents - 1); break;
      case 'Stop':
        set('idle'); s.tool = null; s.toolDetail = ''; s.subagents = 0; break;
      case 'SessionEnd':
        set('ended'); s.tool = null; s.subagents = 0; break;
      default:
        break;
    }

    this.feed.push({ t, session: id, project: s.project, event: name, tool: ev.tool_name || '', detail: name === 'PreToolUse' ? s.toolDetail : (ev.message || '') });
    if (this.feed.length > this.feedSize) this.feed.splice(0, this.feed.length - this.feedSize);
    for (const fn of this.listeners) fn();
    return true;
  }

  dump() {
    return { version: 1, sessions: [...this.sessions.values()], feed: this.feed };
  }

  hydrate(data) {
    if (!data || data.version !== 1) return;
    for (const s of data.sessions || []) if (s && s.id) this.sessions.set(s.id, s);
    this.feed = (data.feed || []).slice(-this.feedSize);
  }

  snapshot() {
    const t = this.now();
    const sessions = [...this.sessions.values()].map((s) => {
      const stale = s.state !== 'ended' && t - s.lastEvent > this.staleMs;
      return { ...s, displayState: stale ? 'stale' : s.state };
    });
    const rank = { waiting: 0, working: 1, idle: 2, stale: 3, ended: 4 };
    sessions.sort((a, b) => rank[a.displayState] - rank[b.displayState] || b.lastEvent - a.lastEvent);
    return { now: t, sessions, feed: this.feed.slice(-100).reverse() };
  }

  prune(maxAgeMs = 24 * 3600 * 1000) {
    const t = this.now();
    for (const [id, s] of this.sessions) if (s.state === 'ended' && t - s.lastEvent > maxAgeMs) this.sessions.delete(id);
  }
}

module.exports = { Store };
