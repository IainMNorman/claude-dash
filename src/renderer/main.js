import { createMenu } from './menu.js';

if (/Electron\//.test(navigator.userAgent)) document.documentElement.classList.add('electron');

let snap = { sessions: [], feed: [], now: Date.now() };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
function num(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(1) + 'M';
}

let sortBy = store.get('dash.sort', 'status');
let filterBy = store.get('dash.filter', 'live');
let query = '';
const openFinished = new Set();

const sorters = {
  status: null,
  latest: (a, b) => b.lastEvent - a.lastEvent,
  name: (a, b) => (a.title || a.project).localeCompare(b.title || b.project) || b.lastEvent - a.lastEvent,
  state: (a, b) => a.stateSince - b.stateSince,
  tools: (a, b) => b.toolCount - a.toolCount,
  started: (a, b) => b.startedAt - a.startedAt,
};
const live = (s) => !s.dismissed;
const filters = {
  live: (s) => live(s) && s.displayState !== 'ended',
  waiting: (s) => live(s) && s.displayState === 'waiting',
  idle: (s) => live(s) && s.displayState === 'idle',
  working: (s) => live(s) && s.displayState === 'working',
  stuck: (s) => live(s) && s.stuck,
  stale: (s) => live(s) && s.displayState === 'stale',
  ended: (s) => live(s) && s.displayState === 'ended',
  dismissed: (s) => s.dismissed,
  all: () => true,
};

function visible() {
  const q = query.trim().toLowerCase();
  let list = snap.sessions.filter(filters[filterBy] || filters.live);
  if (q) list = list.filter((s) => `${s.project} ${s.title} ${s.cwd} ${s.git ? s.git.branch + ' ' + s.git.repo : ''} ${s.prompt} ${s.toolDetail}`.toLowerCase().includes(q));
  const fn = sorters[sortBy];
  if (fn) list = [...list].sort(fn);
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

function childRow(c, now) {
  const end = c.endedAt || now;
  const shell = c.kind === 'shell';
  const label = c.status === 'waiting' ? 'needs you' : c.status;
  const title = shell ? `<span class="sh">$ ${esc(c.desc || 'shell')}</span>` : esc(c.desc || c.type || 'subagent');
  const sub = shell ? 'background shell' : c.desc && c.type ? esc(c.type) : '';
  return `<div class="child ${c.status} ${shell ? 'shell' : ''}">
    <div class="ctop"><span class="ct">${title}</span><span class="cb">${label} · ${dur(end - c.startedAt)}</span></div>
    ${sub ? `<div class="csub mut">${sub}</div>` : ''}
    ${c.status === 'waiting' ? `<div class="cmsg">${esc(c.message || 'Needs your input')}</div>` : ''}
    ${c.status === 'running' && c.tool ? `<div class="tool">▸ ${esc(c.tool)} ${esc(c.toolDetail)}</div>` : ''}
  </div>`;
}

function gitLine(g) {
  if (!g) return '';
  const bits = [];
  if (g.changed) bits.push(`±${g.changed}`);
  if (g.untracked) bits.push(`?${g.untracked}`);
  if (g.ahead) bits.push(`↑${g.ahead}`);
  if (g.behind) bits.push(`↓${g.behind}`);
  if (g.conflicts) bits.push(`⚠${g.conflicts}`);
  const state = bits.length ? bits.join(' ') : 'clean';
  return `<div class="git mut">⎇ <b>${esc(g.branch || 'detached')}</b>${g.worktree ? ` <span class="wt">worktree ${esc(g.worktreeName)}</span>` : ''} · ${esc(g.repo)} · <span class="${g.changed || g.untracked ? 'dirty' : ''}">${state}</span></div>`;
}

function card(s, now) {
  const kids = s.children || [];
  const active = kids.filter((c) => c.status !== 'done');
  const done = kids.filter((c) => c.status === 'done');
  const tk = s.tokens;
  const badge = s.displayState === 'waiting' ? 'needs you' : s.stuck ? 'quiet?' : s.displayState;
  return `
    <div class="card ${s.displayState}${s.stuck ? ' stuck' : ''}${s.pinned ? ' pinned' : ''}" data-id="${esc(s.id)}">
      <div class="top">
        <span class="proj">${s.pinned ? '📌 ' : ''}${esc(s.title || s.project)}</span>
        <span class="badge">${badge} · ${dur(now - s.stateSince)}</span>
      </div>
      <div class="mut">${s.title ? esc(s.project) + ' · ' : ''}${esc(s.cwd)} · ${s.toolCount} tools · up ${dur(now - s.startedAt)}</div>
      ${gitLine(s.git)}
      ${tk ? `<div class="mut">↑ ${num(tk.input + tk.cacheWrite)} · ↓ ${num(tk.output)} · cache ${num(tk.cacheRead)}</div>` : ''}
      ${s.message ? `<div class="msg">${esc(s.message)}</div>` : ''}
      ${s.tool ? `<div class="tool">▸ ${esc(s.tool)} ${esc(s.toolDetail)}</div>` : ''}
      ${s.prompt ? `<div class="prompt">“${esc(s.prompt)}”</div>` : ''}
      ${active.length ? `<div class="kids">${active.map((c) => childRow(c, now)).join('')}</div>` : ''}
      ${done.length ? `<details class="fin" data-id="${esc(s.id)}"${openFinished.has(s.id) ? ' open' : ''}><summary>${done.length} finished</summary><div class="kids">${done.slice().reverse().map((c) => childRow(c, now)).join('')}</div></details>` : ''}
      <div class="acts">
        ${s.link ? `<a href="${esc(s.link)}" data-act="open">Open</a>` : ''}
        <button data-act="pin" type="button">${s.pinned ? 'Unpin' : 'Pin'}</button>
        <button data-act="dismiss" type="button">${s.dismissed ? 'Restore' : 'Dismiss'}</button>
      </div>
    </div>`;
}

function render() {
  const now = snap.now;
  const all = snap.sessions.filter(live);
  const by = (st) => all.filter((s) => s.displayState === st).length;
  const waiting = by('waiting') + all.filter((s) => (s.children || []).some((c) => c.status === 'waiting') && s.displayState !== 'waiting').length;
  $('stats').innerHTML = `${waiting ? `<b class="need">${waiting} need you</b> · ` : ''}<b>${by('working')}</b> working · <b>${by('idle')}</b> idle`;
  document.title = waiting ? `(${waiting}) Claude Dash` : 'Claude Dash';
  filterMenu.refresh();
  sortMenu.refresh();
  const list = visible();
  $('cards').innerHTML = list.length ? list.map((s) => card(s, now)).join('') : `<div class="empty">${snap.sessions.length ? 'No sessions match this filter.' : 'No sessions yet. Start a new Claude Code session with the claude-dash hooks enabled.'}</div>`;
  $('feed').innerHTML = snap.feed.map((f) => `
    <div class="row"><span class="mut">${new Date(f.t).toLocaleTimeString([], { hour12: false })}</span>
    <span><b>${esc(f.project)}</b> ${esc(f.event)} ${esc(f.tool)}<div class="d">${esc(f.detail)}</div></span></div>`).join('');
}

const countOf = (k) => snap.sessions.filter(filters[k]).length;
const filterMenu = createMenu($('filterDd'), {
  prefix: 'Show',
  getValue: () => filterBy,
  onSelect: (v) => { filterBy = v; store.set('dash.filter', v); render(); },
  count: countOf,
  groups: [
    { label: () => `Live · ${countOf('live')} = waiting + working + idle + stale`, items: [
      { value: 'live', label: 'All live' },
      { value: 'waiting', label: 'Waiting', dot: 'waiting' },
      { value: 'working', label: 'Working', dot: 'working' },
      { value: 'idle', label: 'Idle', dot: 'idle' },
      { value: 'stale', label: 'Stale', dot: 'stale' },
      { value: 'stuck', label: 'Quiet?', dot: 'waiting', sub: true, note: 'part of Working' },
    ] },
    { label: 'Not live', items: [
      { value: 'ended', label: 'Ended', dot: 'ended' },
      { value: 'dismissed', label: 'Dismissed', dot: 'hollow' },
    ] },
    { label: 'Everything', items: [{ value: 'all', label: 'All sessions' }] },
  ],
});
const sortMenu = createMenu($('sortDd'), {
  prefix: 'Sort',
  getValue: () => sortBy,
  onSelect: (v) => { sortBy = v; store.set('dash.sort', v); render(); },
  groups: [{ items: [
    { value: 'status', label: 'Status (needs you first)' },
    { value: 'latest', label: 'Latest event' },
    { value: 'name', label: 'Name' },
    { value: 'state', label: 'Longest in state' },
    { value: 'tools', label: 'Most tools' },
    { value: 'started', label: 'Newest session' },
  ] }],
});
$('q').oninput = (e) => { query = e.target.value; render(); };

$('cards').addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.classList || !d.classList.contains('fin')) return;
  if (d.open) openFinished.add(d.dataset.id); else openFinished.delete(d.dataset.id);
}, true);
$('cards').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.closest('.card').dataset.id;
  const s = snap.sessions.find((x) => x.id === id);
  if (el.dataset.act === 'open') return;
  const flag = el.dataset.act === 'pin' ? 'pinned' : 'dismissed';
  fetch('/api/session', { method: 'POST', body: JSON.stringify({ id, flag, value: !s[flag] }) });
});

let drawerOpen = store.get('dash.drawer', 'open') === 'open';
let drawerPinned = store.get('dash.pinned', 'pinned') === 'pinned';
function applyDrawer() {
  document.body.classList.toggle('drawer-open', drawerOpen);
  document.body.classList.toggle('drawer-pinned', drawerPinned);
  $('drawerBtn').classList.toggle('on', drawerOpen);
  $('drawerBtn').setAttribute('aria-expanded', String(drawerOpen));
  $('pinBtn').classList.toggle('on', drawerPinned);
  $('pinBtn').textContent = drawerPinned ? 'Pinned' : 'Pin';
  store.set('dash.drawer', drawerOpen ? 'open' : 'closed');
  store.set('dash.pinned', drawerPinned ? 'pinned' : 'floating');
}
$('drawerBtn').onclick = (e) => { e.stopPropagation(); drawerOpen = !drawerOpen; applyDrawer(); };
$('closeBtn').onclick = () => { drawerOpen = false; applyDrawer(); };
$('pinBtn').onclick = () => { drawerPinned = !drawerPinned; applyDrawer(); };
const onDocClick = (e) => {
  if (drawerOpen && !drawerPinned && !e.target.closest('#drawer') && !e.target.closest('#drawerBtn')) { drawerOpen = false; applyDrawer(); }
};
const onKey = (e) => { if (e.key === 'Escape' && drawerOpen && !drawerPinned) { drawerOpen = false; applyDrawer(); } };
document.addEventListener('click', onDocClick);
document.addEventListener('keydown', onKey);
applyDrawer();

let es;
let timer;
function connect() {
  es = new EventSource('/api/stream');
  es.onopen = () => { $('conn').textContent = 'live'; };
  es.onmessage = (m) => { snap = JSON.parse(m.data); render(); };
  es.onerror = () => { $('conn').textContent = 'reconnecting…'; };
}
connect();
timer = setInterval(() => { snap.now = Date.now(); render(); }, 1000);

if (import.meta.hot) {
  import.meta.hot.dispose(() => { filterMenu.destroy(); sortMenu.destroy(); es.close(); clearInterval(timer); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); });
  import.meta.hot.accept();
}
