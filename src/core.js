const path = require('node:path');
const { summarise } = require('./summary');

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

function detail(tool, input = {}) {
  const v = input.command || input.file_path || input.pattern || input.url || input.description || input.query || '';
  return String(v).slice(0, 120);
}

const DONE_STATUS = /^(completed|complete|done|failed|error|killed|stopped|cancelled|canceled)$/i;

function reconcile(s, list, t) {
  const kids = s.children;
  const listed = new Set();
  for (const b of list) {
    if (!b || !b.id) continue;
    listed.add(String(b.id));
    const kind = b.type === 'subagent' ? 'subagent' : 'shell';
    let c = kids.find((k) => k.id === String(b.id));
    if (!c && kind === 'shell') c = kids.find((k) => k.kind === 'shell' && !k.id && k.status !== 'done');
    if (c && !c.id) c.id = String(b.id);
    if (!c) {
      c = { kind, id: String(b.id), toolUseId: null, desc: String(b.description || b.command || '').slice(0, 160), type: b.agent_type || b.type || '', status: 'running', startedAt: t, lastEvent: t, tool: null, toolDetail: '' };
      kids.push(c);
    }
    if (DONE_STATUS.test(b.status || '')) { if (c.status !== 'done') { c.status = 'done'; c.endedAt = t; } }
  }
  const hasShell = list.some((b) => b && b.type !== 'subagent');
  for (const c of kids) {
    if (c.status === 'done') continue;
    if (c.id && !listed.has(c.id)) { c.status = 'done'; c.endedAt = t; c.tool = null; c.toolDetail = ''; }
    else if (!c.id && c.kind === 'shell' && !hasShell && t - c.startedAt > 15000) { c.status = 'done'; c.endedAt = t; }
  }
}

const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const askText = (i) => { const q = i && Array.isArray(i.questions) && i.questions[0]; return String((q && q.question) || 'Has a question for you').slice(0, 200); };
const PSEUDO_PROMPT = /^\s*<(agent-message|task-notification|system-reminder|command-)/;

function normalise(s) {
  if (s && PSEUDO_PROMPT.test(String(s.prompt || ''))) s.prompt = '';
  if (!Array.isArray(s.children)) s.children = [];
  if (typeof s.pinned !== 'boolean') s.pinned = false;
  if (typeof s.dismissed !== 'boolean') s.dismissed = false;
  if (typeof s.subagents !== 'number') s.subagents = 0;
  return s;
}

const PREF_KEYS = new Set(['sort', 'filter', 'cols', 'drawer', 'pinned']);

class Store {
  constructor({ staleMs = 10 * 60 * 1000, feedSize = 200, now = Date.now } = {}) {
    this.sessions = new Map();
    this.feed = [];
    this.staleMs = staleMs;
    this.feedSize = feedSize;
    this.now = now;
    this.listeners = new Set();
    this.resolver = null;
    this.layout = {};
    this.prefs = {};
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
        children: [], pinned: false, dismissed: false, subagents: 0, activity: '', toolCount: 0, startedAt: t, lastEvent: t, stateSince: t,
        transcript: ev.transcript_path || '',
      };
      this.sessions.set(id, s);
    }
    normalise(s);
    if (ev.cwd && !s.cwd) { s.cwd = ev.cwd; s.project = path.basename(ev.cwd); }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    if (ev.scratchpad_dir) s.scratchpadDir = ev.scratchpad_dir;
    s.lastEvent = t;
    if (s.dismissed && name !== 'SessionEnd') s.dismissed = false;
    const set = (state) => { if (s.state !== state) { if (s.state === 'ended') s.endedReason = ''; s.state = state; s.stateSince = t; } };

    let feedText = '';
    const kids = s.children;
    const findChild = (id) => (id ? kids.find((c) => c.id === id || c.toolUseId === id) : undefined);
    const child = name !== 'SubagentStop' ? findChild(ev.agent_id) : undefined;

    switch (name) {
      case 'SessionStart':
        set('idle'); break;
      case 'UserPromptSubmit':
        set('working');
        if (!PSEUDO_PROMPT.test(String(ev.prompt || ''))) s.prompt = String(ev.prompt || '').slice(0, 200);
        s.message = ''; break;
      case 'PreToolUse': {
        set('working'); s.message = '';
        const d = detail(ev.tool_name, ev.tool_input);
        const act = summarise(ev.tool_name, ev.tool_input);
        feedText = act;
        const ask = ASKS.has(ev.tool_name);
        if (ask) { const q = askText(ev.tool_input); set('waiting'); s.message = q; if (child) { child.status = 'waiting'; child.message = q; child.lastEvent = t; } }
        if (child) { if (!ask) child.status = 'running'; child.tool = ev.tool_name || null; child.toolDetail = d; child.activity = act; child.lastEvent = t; break; }
        s.tool = ev.tool_name || null; s.toolDetail = d; s.activity = act; s.toolCount++;
        if (ev.tool_name === 'Bash' && ev.tool_input && ev.tool_input.run_in_background) {
          kids.push({ kind: 'shell', id: null, toolUseId: ev.tool_use_id || null, desc: String(ev.tool_input.description || ev.tool_input.command || '').slice(0, 160), type: 'shell', status: 'running', startedAt: t, lastEvent: t, tool: null, toolDetail: '' });
        }
        if (SUBAGENT_TOOLS.has(ev.tool_name)) {
          const i = ev.tool_input || {};
          kids.push({ kind: 'subagent', id: null, toolUseId: ev.tool_use_id || null, desc: String(i.description || '').slice(0, 120), type: i.subagent_type || '', status: 'running', startedAt: t, lastEvent: t, tool: null, toolDetail: '' });
        }
        break;
      }
      case 'PermissionRequest': {
        const m = `Permission to use ${ev.tool_name || 'a tool'}${detail(ev.tool_name, ev.tool_input) ? ': ' + detail(ev.tool_name, ev.tool_input) : ''}`.slice(0, 200);
        if (child) { child.status = 'waiting'; child.message = m; child.lastEvent = t; }
        set('waiting'); s.message = m; break;
      }
      case 'PostToolUse': {
        if (!child && s.state === 'waiting' && !kids.some((c) => c.status === 'waiting')) { set('working'); s.message = ''; }
        if (ASKS.has(ev.tool_name)) { set('working'); s.message = ''; if (child) { child.status = 'running'; child.message = ''; } }
        if (child) { child.tool = null; child.toolDetail = ''; child.lastEvent = t; break; }
        s.tool = null; s.toolDetail = '';
        if (ev.tool_name === 'Bash' && ev.tool_input && ev.tool_input.run_in_background) {
          const c = findChild(ev.tool_use_id);
          const r = ev.tool_response || {};
          const sid = r.backgroundTaskId || r.shellId || r.bash_id || r.bashId || r.task_id || r.taskId;
          if (c && sid) c.id = String(sid);
        }
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
        if (!c) { c = { kind: 'subagent', id: ev.agent_id || null, toolUseId: null, desc: '', type: ev.agent_type || '', status: 'done', startedAt: t, lastEvent: t, tool: null, toolDetail: '' }; kids.push(c); }
        if (!c.id && ev.agent_id) c.id = ev.agent_id;
        if (!c.type && ev.agent_type) c.type = ev.agent_type;
        c.status = 'done'; c.endedAt = t; c.tool = null; c.toolDetail = ''; c.activity = ''; c.message = '';
        break;
      }
      case 'Stop':
        set('idle'); s.tool = null; s.toolDetail = ''; s.activity = ''; break;
      case 'SessionEnd':
        set('ended'); s.tool = null; s.activity = '';
        for (const c of kids) if (c.status !== 'done') { c.status = 'done'; c.endedAt = t; }
        break;
      default:
        break;
    }
    if (Array.isArray(ev.background_tasks)) reconcile(s, ev.background_tasks, t);
    if (s.state === 'waiting' && !kids.some((c) => c.status === 'waiting') && name !== 'Notification' && name !== 'PermissionRequest' && !(name === 'PreToolUse' && ASKS.has(ev.tool_name))) s.message = '';
    s.subagents = kids.filter((c) => c.status !== 'done').length;
    if (kids.length > 60) {
      const done = kids.filter((c) => c.status === 'done');
      const drop = new Set(done.slice(0, kids.length - 60));
      s.children = kids.filter((c) => !drop.has(c));
    }

    if (name !== 'PostToolUse') {
      const text = name === 'PreToolUse' ? feedText : name === 'Notification' ? String(ev.message || '').slice(0, 120) : '';
      this.feed.push({ t, session: id, project: s.project, event: name, text, child: !!(ev.agent_id && name !== 'SubagentStop') });
    }
    if (this.feed.length > this.feedSize) this.feed.splice(0, this.feed.length - this.feedSize);
    for (const fn of this.listeners) fn();
    return true;
  }

  markEnded(id, reason) {
    const s = this.sessions.get(id);
    if (!s || s.state === 'ended') return false;
    const t = this.now();
    s.state = 'ended'; s.tool = null; s.toolDetail = ''; s.activity = '';
    for (const c of s.children) if (c.status !== 'done') { c.status = 'done'; c.endedAt = t; }
    s.subagents = 0;
    s.endedReason = reason;
    s.stateSince = t;
    this.feed.push({ t, session: id, project: s.project, event: 'SessionEnd', text: 'ended (' + reason + ')', child: false });
    if (this.feed.length > this.feedSize) this.feed.splice(0, this.feed.length - this.feedSize);
    for (const fn of this.listeners) fn();
    return true;
  }

  syncChildren(id, list, { authoritative = false } = {}) {
    const s = this.sessions.get(id);
    if (!s) return false;
    normalise(s);
    const t = this.now();
    let changed = false;
    for (const f of list) {
      const c = s.children.find((k) => (f.id && k.id === f.id) || (f.toolUseId && k.toolUseId === f.toolUseId));
      if (!c) {
        const recent = f.endedAt && t - f.endedAt < 30 * 60 * 1000;
        if (f.status === 'running' || recent) {
          s.children.push({ kind: 'subagent', id: f.id, toolUseId: f.toolUseId, desc: f.desc, type: f.type, model: f.model || '', status: f.status, startedAt: f.startedAt || t, endedAt: f.endedAt || undefined, lastEvent: t, tool: null, toolDetail: '' });
          changed = true;
        }
        continue;
      }
      if (!c.id && f.id) { c.id = f.id; changed = true; }
      if (!c.desc && f.desc) { c.desc = f.desc; changed = true; }
      if (!c.type && f.type) { c.type = f.type; changed = true; }
      if (f.model && c.model !== f.model) { c.model = f.model; changed = true; }
      if (c.status !== 'done' && f.status === 'done') { c.status = 'done'; c.endedAt = f.endedAt || t; c.tool = null; c.toolDetail = ''; changed = true; }
    }
    if (authoritative) {
      const known = new Set(list.map((f) => f.toolUseId).filter(Boolean));
      const before = s.children.length;
      s.children = s.children.filter((c) => !(c.kind === 'subagent' && !c.id && c.status === 'running' && c.toolUseId && !known.has(c.toolUseId) && t - c.startedAt > 60000));
      if (s.children.length !== before) changed = true;
    }
    if (changed) {
      s.subagents = s.children.filter((c) => c.status !== 'done').length;
      for (const fn of this.listeners) fn();
    }
    return changed;
  }

  setLayout(updates) {
    let changed = false;
    for (const u of Array.isArray(updates) ? updates : []) {
      if (!u || typeof u.id !== 'string' || !this.sessions.has(u.id)) continue;
      const col = Number(u.col);
      const order = Number(u.order);
      if (!Number.isInteger(col) || col < 0 || col > 24 || !Number.isFinite(order)) continue;
      const cur = this.layout[u.id];
      if (cur && cur.col === col && cur.order === order) continue;
      this.layout[u.id] = { col, order };
      changed = true;
    }
    if (changed) for (const fn of this.listeners) fn();
    return changed;
  }

  setPref(key, value) {
    if (!PREF_KEYS.has(key) || typeof value !== 'string' || value.length > 40) return false;
    if (this.prefs[key] === value) return false;
    this.prefs[key] = value;
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
    return { version: 1, sessions: [...this.sessions.values()], feed: this.feed, layout: this.layout, prefs: this.prefs };
  }

  hydrate(data) {
    if (!data || data.version !== 1) return;
    for (const s of data.sessions || []) if (s && s.id) this.sessions.set(s.id, normalise(s));
    this.feed = (data.feed || []).slice(-this.feedSize);
    this.layout = data.layout && typeof data.layout === 'object' ? { ...data.layout } : {};
    this.prefs = {};
    if (data.prefs && typeof data.prefs === 'object') for (const [k, v] of Object.entries(data.prefs)) if (PREF_KEYS.has(k) && typeof v === 'string') this.prefs[k] = v;
  }

  snapshot() {
    const t = this.now();
    const sessions = [...this.sessions.values()].map((s) => {
      const stale = s.state !== 'ended' && t - s.lastEvent > this.staleMs;
      const stuck = s.state === 'working' && !stale && t - s.lastEvent > this.stuckMs;
      const extra = this.resolver ? this.resolver(s) : null;
      return { ...s, ...extra, displayState: stale ? 'stale' : s.state, stuck };
    });
    const rank = { waiting: 0, working: 1, idle: 1, stale: 2, ended: 3 };
    sessions.sort((a, b) => rank[a.displayState] - rank[b.displayState] || a.project.localeCompare(b.project) || a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    const live = sessions.filter((s) => !s.dismissed);
    const global = {
      perHour: live.reduce((a, s) => a + ((s.cost && s.cost.perHour) || 0), 0),
      usd: live.reduce((a, s) => a + ((s.cost && s.cost.usd) || 0), 0),
      active: live.filter((s) => s.cost && s.cost.perHour > 0).length,
    };
    return { now: t, sessions, global, layout: this.layout, prefs: this.prefs, feed: this.feed.slice(-100).reverse() };
  }

  prune(maxAgeMs = 24 * 3600 * 1000) {
    const t = this.now();
    for (const [id, s] of this.sessions) if (s.state === 'ended' && t - s.lastEvent > maxAgeMs) this.sessions.delete(id);
  }
}

module.exports = { Store };
