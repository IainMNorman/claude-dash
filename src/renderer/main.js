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
    ${c.status === 'running' ? `<div class="act sm"><span class="adot"></span>${esc(c.activity || 'Working…')}</div>` : ''}
  </div>`;
}

function contextWindow(tk) {
  if (tk.context > 200000 || /\[1m\]|-1m/.test(tk.model || '')) return 1000000;
  return 200000;
}
function money(n) {
  if (!n) return '$0';
  if (n < 0.01) return '<$0.01';
  return '$' + (n >= 100 ? Math.round(n) : n.toFixed(2));
}
function costLine(c) {
  if (!c) return '';
  const tip = `API list-price equivalent. Rate = last 10 min x6${c.subagents ? `; includes ${c.subagents} subagent transcript${c.subagents > 1 ? 's' : ''} from the last 24h` : ''}${c.unpriced ? `; ${c.unpriced} messages from unpriced models excluded` : ''}`;
  return `<div class="cost" title="${esc(tip)}"><b>≈ ${money(c.perHour)}/h</b><span class="mut">now</span><span class="mut">·</span><b>${money(c.usd)}</b><span class="mut">session</span></div>`;
}
function tokenBlock(tk, c) {
  const total = tk.input + tk.cacheWrite + tk.cacheRead + tk.output;
  if (!total) return costLine(c);
  const pct = (n) => ((n / total) * 100).toFixed(2);
  const prompt = tk.input + tk.cacheWrite + tk.cacheRead;
  const hit = prompt ? Math.round((tk.cacheRead / prompt) * 100) : 0;
  const win = contextWindow(tk);
  const ctx = Math.min(100, Math.round((tk.context / win) * 100));
  const tone = ctx >= 90 ? 'hot' : ctx >= 70 ? 'warm' : '';
  return `<div class="tok">
    ${costLine(c)}
    <div class="tbar" title="Share of all tokens">
      <i class="tcr" style="width:${pct(tk.cacheRead)}%"></i><i class="tcw" style="width:${pct(tk.cacheWrite)}%"></i><i class="tin" style="width:${pct(tk.input)}%"></i><i class="tout" style="width:${pct(tk.output)}%"></i>
    </div>
    <div class="tleg">
      <span><i class="tcr"></i>cache read ${num(tk.cacheRead)} <b>${hit}% hit</b></span>
      <span><i class="tcw"></i>cache write ${num(tk.cacheWrite)}</span>
      <span><i class="tin"></i>new in ${num(tk.input)}</span>
      <span><i class="tout"></i>out ${num(tk.output)}</span>
    </div>
    <div class="ctx ${tone}" title="Latest prompt size vs a ${num(win)} window${win === 200000 ? ' (assumed unless it exceeds 200k)' : ''}">
      <span class="mut">Context</span><div class="cbar"><i style="width:${ctx}%"></i></div><b>${num(tk.context)}</b><span class="mut">${ctx}%</span>
    </div>
  </div>`;
}

function shellGroup(id, shells, now) {
  const groups = new Map();
  for (const c of shells) {
    const k = c.desc || 'shell';
    const g = groups.get(k) || { desc: k, n: 0, oldest: c.startedAt };
    g.n++;
    g.oldest = Math.min(g.oldest, c.startedAt);
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.oldest - b.oldest);
  const oldest = Math.min(...shells.map((c) => c.startedAt));
  return `<details class="shells" data-id="${esc(id)}" data-kind="shells"${openFinished.has(id + ':shells') ? ' open' : ''}>
    <summary>${shells.length} background shell${shells.length > 1 ? 's' : ''} running · oldest ${dur(now - oldest)}</summary>
    <div class="kids">${rows.map((g) => `<div class="child shell"><div class="ctop"><span class="ct"><span class="sh">$ ${esc(g.desc)}</span>${g.n > 1 ? ` <span class="mut">×${g.n}</span>` : ''}</span><span class="cb">running · ${dur(now - g.oldest)}</span></div></div>`).join('')}</div>
  </details>`;
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
  const active = kids.filter((c) => c.status !== 'done' && c.kind !== 'shell');
  const shells = kids.filter((c) => c.status !== 'done' && c.kind === 'shell');
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
      ${tk ? tokenBlock(tk, s.cost) : costLine(s.cost)}
      ${s.message ? `<div class="msg">${esc(s.message)}</div>` : ''}
      ${s.displayState === 'working' || s.displayState === 'waiting' ? `<div class="act"><span class="adot"></span>${esc(s.activity || (s.displayState === 'working' ? 'Working…' : ''))}</div>` : ''}
      ${s.prompt ? `<div class="prompt">“${esc(s.prompt)}”</div>` : ''}
      ${active.length ? `<div class="kids">${active.map((c) => childRow(c, now)).join('')}</div>` : ''}
      ${shells.length ? shellGroup(s.id, shells, now) : ''}
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
  const g = snap.global;
  $('burn').innerHTML = g ? `<b>≈ ${money(g.perHour)}/h</b>` : '';
  $('burn').title = g ? `API list-price equivalent across all sessions, last 10 min x6. Session totals: ${money(g.usd)}. ${g.active} session${g.active === 1 ? '' : 's'} spending now.` : '';
  $('stats').innerHTML = `${waiting ? `<b class="need">${waiting} need you</b> · ` : ''}<b>${by('working')}</b> working · <b>${by('idle')}</b> idle`;
  document.title = waiting ? `(${waiting}) Claude Dash` : 'Claude Dash';
  filterMenu.refresh();
  sortMenu.refresh();
  const list = visible();
  cardCount = list.length;
  fitColumns();
  $('cards').innerHTML = list.length ? list.map((s) => card(s, now)).join('') : `<div class="empty">${snap.sessions.length ? 'No sessions match this filter.' : 'No sessions yet. Start a new Claude Code session with the claude-dash hooks enabled.'}</div>`;
  $('feed').innerHTML = snap.feed.map((f) => `
    <div class="row${f.child ? ' kid' : ''}"><span class="mut">${new Date(f.t).toLocaleTimeString([], { hour12: false })}</span>
    <span class="rt" title="${esc(f.text || f.event)}"><b>${esc(f.project)}</b> ${esc(f.event === 'PreToolUse' ? f.text : f.event + (f.text ? ' · ' + f.text : ''))}</span></div>`).join('');
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
  if (!d.classList || !(d.classList.contains('fin') || d.classList.contains('shells'))) return;
  const key = d.classList.contains('shells') ? d.dataset.id + ':shells' : d.dataset.id;
  if (d.open) openFinished.add(key); else openFinished.delete(key);
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

const CARD_MIN = 360;
const CARD_MAX = 560;
const GAP = 12;
let cardCount = 0;
function fitColumns() {
  const w = $('cards').clientWidth;
  if (!w) return;
  const nMin = Math.max(1, Math.ceil((w + GAP) / (CARD_MAX + GAP)));
  const nMax = Math.max(nMin, Math.floor((w + GAP) / (CARD_MIN + GAP)));
  let best = nMin;
  let bestWaste = Infinity;
  for (let n = nMin; n <= nMax; n++) {
    const waste = cardCount ? (n - (cardCount % n)) % n : 0;
    if (waste < bestWaste) { best = n; bestWaste = waste; }
  }
  if ($('cards').style.getPropertyValue('--cols') !== String(best)) $('cards').style.setProperty('--cols', String(best));
}
const ro = new ResizeObserver(fitColumns);
ro.observe($('cards'));

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
  import.meta.hot.dispose(() => { ro.disconnect(); filterMenu.destroy(); sortMenu.destroy(); es.close(); clearInterval(timer); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); });
  import.meta.hot.accept();
}
