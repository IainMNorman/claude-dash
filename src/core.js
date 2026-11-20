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
    this.resolver = null;
    this.stuckMs = 3 * 60 * 1000;
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
        children: [], pinned: false, dismissed: false, subagents: 0, toolCount: 0, startedAt: t, lastEvent: t, stateSince: t,
        transcript: ev.transcript_path || '',
      };
      this.sessions.set(id, s);
    }
    if (ev.cwd && !s.cwd) { s.cwd = ev.cwd; s.project = path.basename(ev.cwd); }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    s.lastEvent = t;
    if (s.dismissed && name !== 'SessionEnd') s.dismissed = false;
    const set = (state) => { if (s.state !== state) { s.state = state; s.stateSince = t; } };

    const kids = s.children;
    const findChild = (id) => (id ? kids.find((c) => c.id === id || c.toolUseId === id) : undefined);
    const child = name !== 'SubagentStop' ? findChild(ev.agent_id) : undefined;

    switch (name) {
      case 'SessionStart':
        set('idle'); break;
      case 'UserPromptSubmit':
        set('working'); s.prompt = String(ev.prompt || '').slice(0, 200); s.message = ''; break;
      case 'PreToolUse': {
        set('working'); s.message = '';
        const d = detail(ev.tool_name, ev.tool_input);
        if (child) { child.tool = ev.tool_name || null; child.toolDetail = d; child.status = 'running'; child.lastEvent = t; break; }
        s.tool = ev.tool_name || null; s.toolDetail = d; s.toolCount++;
        if (SUBAGENT_TOOLS.has(ev.tool_name)) {
          const i = ev.tool_input || {};
          kids.push({ id: null, toolUseId: ev.tool_use_id || null, desc: String(i.description || '').slice(0, 120), type: i.subagent_type || '', status: 'running', startedAt: t, lastEvent: t, tool: null, toolDetail: '' });
        }
        break;
      }
      case 'PostToolUse': {
        if (child) { child.tool = null; child.toolDetail = ''; child.lastEvent = t; break; }
        s.tool = null; s.toolDetail = '';
        if (SUBAGENT_TOOLS.has(ev.tool_name)) {
          const c = findChild(ev.tool_use_id);
          const r = ev.tool_response || {};
          if (c) {
            if (r.agentId) c.id = r.agentId;
            if (!r.isAsync) { c.status = 'done'; c.endedAt = t; }
          }
        }
        break;
      }
      case 'Notification': {
        const idle = ev.notification_type === 'idle_prompt' || /waiting for your input/i.test(ev.message || '');
        if (child) { child.status = 'waiting'; child.message = String(ev.message || '').slice(0, 200); child.lastEvent = t; set('waiting'); s.message = child.message; break; }
        if (idle) { set('idle'); s.message = ''; break; }
        set('waiting'); s.message = String(ev.message || '').slice(0, 200); break;
      }
      case 'SubagentStop': {
        let c = findChild(ev.agent_id) || kids.find((k) => k.status !== 'done' && !k.id);
        if (!c) { c = { id: ev.agent_id || null, toolUseId: null, desc: '', type: ev.agent_type || '', status: 'done', startedAt: t, lastEvent: t, tool: null, toolDetail: '' }; kids.push(c); }
        if (!c.id && ev.agent_id) c.id = ev.agent_id;
        if (!c.type && ev.agent_type) c.type = ev.agent_type;
        c.status = 'done'; c.endedAt = t; c.tool = null; c.toolDetail = ''; c.message = '';
        break;
      }
      case 'Stop':
        set('idle'); s.tool = null; s.toolDetail = ''; break;
      case 'SessionEnd':
        set('ended'); s.tool = null;
        for (const c of kids) if (c.status !== 'done') { c.status = 'done'; c.endedAt = t; }
        break;
      default:
        break;
    }
    if (s.state === 'waiting' && !kids.some((c) => c.status === 'waiting') && name !== 'Notification') s.message = '';
    s.subagents = kids.filter((c) => c.status !== 'done').length;
    if (kids.length > 60) {
      const done = kids.filter((c) => c.status === 'done');
      const drop = new Set(done.slice(0, kids.length - 60));
      s.children = kids.filter((c) => !drop.has(c));
    }

    this.feed.push({ t, session: id, project: s.project, event: name, tool: ev.tool_name || '', detail: name === 'PreToolUse' ? s.toolDetail : (ev.message || '') });
    if (this.feed.length > this.feedSize) this.feed.splice(0, this.feed.length - this.feedSize);
    for (const fn of this.listeners) fn();
    return true;
  }

  setFlag(id, flag, value) {
    const s = this.sessions.get(id);
    if (!s || (flag !== 'pinned' && flag !== 'dismissed')) return false;
    s[flag] = !!value;
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
      const stuck = s.state === 'working' && !stale && t - s.lastEvent > this.stuckMs;
      const extra = this.resolver ? this.resolver(s) : null;
      return { ...s, ...extra, displayState: stale ? 'stale' : s.state, stuck };
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
