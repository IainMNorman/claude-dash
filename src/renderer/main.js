import { createMenu } from './menu.js';
import { icon, STATE_ICON } from './icons.js';
import { neededColumns, foldCols, placeUnplaced, orderFor, dropIndex, columnAt, chooseColumns } from './arrange.js';

if (/Electron\//.test(navigator.userAgent)) document.documentElement.classList.add('electron');

let snap = { sessions: [], feed: [], now: Date.now() };
const $ = (id) => document.getElementById(id);
$('drawerBtn').innerHTML = icon('list') + 'Activity';
$('pinBtn').innerHTML = icon('pin');
$('closeBtn').innerHTML = icon('x');
$('q').insertAdjacentHTML('beforebegin', icon('search', 'qico'));
$('filterDd').insertAdjacentHTML('beforebegin', icon('filter', 'ddico'));
$('sortDd').insertAdjacentHTML('beforebegin', icon('sort', 'ddico'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PREF_KEYS = { 'dash.sort': 'sort', 'dash.filter': 'filter', 'dash.cols': 'cols', 'dash.drawer': 'drawer', 'dash.pinned': 'pinned' };
let localTouch = 0;
const FEED_ICON = { PreToolUse: 'wrench', SessionStart: 'play', SessionEnd: 'flag', Stop: 'check', SubagentStop: 'bot', Notification: 'bell', UserPromptSubmit: 'list' };
const store = {
  get(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set(k, v, persist = true) {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
    if (persist && PREF_KEYS[k]) {
      localTouch = Date.now();
      fetch('/api/prefs', { method: 'POST', body: JSON.stringify({ key: PREF_KEYS[k], value: v }) }).catch(() => {});
    }
  },
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
  if (sortBy === 'manual') return list;
  const fn = sorters[sortBy];
  if (fn) list = [...list].sort(fn);
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

function childRow(c, now) {
  const end = c.endedAt || now;
  const shell = c.kind === 'shell';
  const label = c.status === 'waiting' ? 'needs you' : c.status;
  const showType = !shell && c.type && c.type !== 'general-purpose';
  const title = icon(shell ? 'terminal' : 'bot') + (shell ? `<span class="sh">${esc(c.desc || 'shell')}</span>` : esc(c.desc || (showType ? c.type : 'subagent')));
  const badge = showType && c.desc ? ` <span class="ctype">${esc(c.type)}</span>` : shell ? ' <span class="ctype">shell</span>' : '';
  return `<div class="child ${c.status} ${shell ? 'shell' : ''}">
    <div class="ctop"><span class="ct">${title}${badge}</span><span class="cb">${label} · ${dur(end - c.startedAt)}</span></div>
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
      <span title="cache write ${num(tk.cacheWrite)} · new input ${num(tk.input)}"><i class="tin"></i>new ${num(tk.input + tk.cacheWrite)}</span>
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
  return `<div class="git mut">${icon('branch')}<b>${esc(g.branch || 'detached')}</b>${g.worktree ? ` <span class="wt">worktree ${esc(g.worktreeName)}</span>` : ''} · ${esc(g.repo)} · <span class="${g.changed || g.untracked ? 'dirty' : ''}">${state}</span></div>`;
}

const shortPath = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');

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
        <span class="proj">${sortBy === 'manual' ? `<span class="grip" draggable="true" title="Drag to move">${icon('grip')}</span>` : ''}${s.pinned ? icon('pin', 'pinned-ico') : ''}${esc(s.title || s.project)}</span>
        <span class="badge">${icon(STATE_ICON[s.displayState] || 'check', 'st-' + s.displayState)}${badge} · ${dur(now - s.stateSince)}</span>
      </div>
      <div class="mut" title="${esc(s.cwd)}">${esc(shortPath(s.cwd))} · ${s.toolCount} tools · up ${dur(now - s.startedAt)}</div>
      ${gitLine(s.git)}
      ${tk ? tokenBlock(tk, s.cost) : costLine(s.cost)}
      ${s.message ? `<div class="msg">${esc(s.message)}</div>` : ''}
      ${s.displayState === 'working' || s.displayState === 'waiting' ? `<div class="act"><span class="adot"></span>${esc(s.activity || (s.displayState === 'working' ? 'Working…' : ''))}</div>` : ''}
      ${s.prompt ? `<div class="prompt">“${esc(s.prompt)}”</div>` : ''}
      ${active.length ? `<div class="kids">${active.map((c) => childRow(c, now)).join('')}</div>` : ''}
      ${shells.length ? shellGroup(s.id, shells, now) : ''}
      ${done.length ? `<details class="fin" data-id="${esc(s.id)}"${openFinished.has(s.id) ? ' open' : ''}><summary>${done.length} finished</summary><div class="kids">${done.slice().reverse().map((c) => childRow(c, now)).join('')}</div></details>` : ''}
      <div class="acts">
        ${s.link ? `<a href="${esc(s.link)}" data-act="open">${icon('open')}Open</a>` : ''}
        <button data-act="pin" type="button">${icon('pin')}${s.pinned ? 'Unpin' : 'Pin'}</button>
        <button data-act="dismiss" type="button" class="quiet">${icon(s.dismissed ? 'undo' : 'x')}${s.dismissed ? 'Restore' : 'Dismiss'}</button>
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
  colsMenu.refresh();
  $('colsDd').hidden = sortBy !== 'manual';
  const list = visible();
  drawCards(list, now, 0);
  $('feed').innerHTML = snap.feed.map((f) => `
    <div class="row${f.child ? ' kid' : ''}"><span class="mut">${icon(FEED_ICON[f.event] || 'wrench')}${new Date(f.t).toLocaleTimeString([], { hour12: false })}</span>
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
let colsPref = store.get('dash.cols', 'auto');
const colsMenu = createMenu($('colsDd'), {
  prefix: 'Columns',
  getValue: () => colsPref,
  onSelect: (v) => { colsPref = v; store.set('dash.cols', v); render(); },
  groups: [{ items: [
    { value: 'auto', label: 'Auto (fit width, one spare)' },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} column${n > 1 ? 's' : ''}` })),
  ] }],
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
    { value: 'manual', label: 'Manual (drag ⠿ to arrange)' },
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
  const post = (value) => fetch('/api/session', { method: 'POST', body: JSON.stringify({ id, flag, value }) });
  post(!s[flag]);
  if (flag === 'dismissed' && !s.dismissed) toast(`Dismissed ${s.title || s.project}`, () => post(false));
});

let toastTimer;
function toast(text, undo) {
  const el = $('toast');
  el.innerHTML = `<span></span><button type="button">Undo</button>`;
  el.firstChild.textContent = text;
  el.lastChild.onclick = () => { undo(); el.hidden = true; };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

let drawerOpen = store.get('dash.drawer', 'open') === 'open';
let drawerPinned = store.get('dash.pinned', 'pinned') === 'pinned';
function applyDrawer(persist = true) {
  document.body.classList.toggle('drawer-open', drawerOpen);
  document.body.classList.toggle('drawer-pinned', drawerPinned);
  $('drawerBtn').classList.toggle('on', drawerOpen);
  $('drawerBtn').setAttribute('aria-expanded', String(drawerOpen));
  $('pinBtn').classList.toggle('on', drawerPinned);
  $('pinBtn').title = drawerPinned ? 'Unpin drawer' : 'Pin drawer open';
  store.set('dash.drawer', drawerOpen ? 'open' : 'closed', persist);
  store.set('dash.pinned', drawerPinned ? 'pinned' : 'floating', persist);
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
applyDrawer(false);

const CARD_MIN = 360;
const CARD_MAX = 800;
const GAP = 12;
const heights = new Map();
let lastW = 0;
let layoutMemo = null;

function autoLayout(list) {
  const el = $('cards');
  const w = el.clientWidth || 0;
  const nMin = Math.max(1, Math.ceil((w + GAP) / (CARD_MAX + GAP)));
  const nMax = Math.max(nMin, Math.floor((w + GAP) / (CARD_MIN + GAP)));
  const top = el.getBoundingClientRect().top + window.scrollY;
  const H = Math.max(320, window.innerHeight - top - 20);
  const hs = list.map((s) => heights.get(s.id) || 220);
  const total = hs.reduce((a, h) => a + h + GAP, 0);
  const chosen = chooseColumns({ nMin, nMax, total, H, w, memo: layoutMemo, now: Date.now() });
  layoutMemo = chosen.memo;
  const n = chosen.n;
  const cols = Array.from({ length: n }, () => []);
  let c = 0;
  let used = 0;
  list.forEach((s, i) => {
    if (used > 0 && used + hs[i] > H && c < n - 1) { c++; used = 0; }
    cols[c].push(s);
    used += hs[i] + GAP;
  });
  return cols;
}

const pending = {};
let drag = null;
const postLayout = (updates) => {
  if (updates.length) fetch('/api/layout', { method: 'POST', body: JSON.stringify({ updates }) }).catch(() => {});
};

function widthRange() {
  const w = $('cards').clientWidth || 0;
  const nMin = Math.max(1, Math.ceil((w + GAP) / (CARD_MAX + GAP)));
  return { nMin, nMax: Math.max(nMin, Math.floor((w + GAP) / (CARD_MIN + GAP))) };
}

function drawManual(list, now) {
  const layout = { ...(snap.layout || {}), ...pending };
  const { nMin, nMax } = widthRange();
  if (list.every((s) => !layout[s.id])) {
    const ups = [];
    autoLayout(list).forEach((col, ci) => col.forEach((s, i) => {
      layout[s.id] = { col: ci, order: i };
      ups.push({ id: s.id, col: ci, order: i });
    }));
    for (const u of ups) pending[u.id] = { col: u.col, order: u.order };
    postLayout(ups);
  }
  const n = colsPref !== 'auto' && Number(colsPref) > 0 ? Number(colsPref) : Math.min(nMax, Math.max(nMin, neededColumns(list, layout) + 1));
  const { cols, unplaced } = foldCols(list, layout, n);
  if (unplaced.length) {
    const ups = placeUnplaced(cols, unplaced, layout);
    for (const u of ups) pending[u.id] = { col: u.col, order: u.order };
    postLayout(ups);
  }
  $('cards').innerHTML = cols.map((col, i) => `<div class="col manual" data-col="${i}">${col.map((s) => card(s, now)).join('')}</div>`).join('');
}

function dropTarget(x, y) {
  const colEls = [...$('cards').querySelectorAll('.col')];
  const col = columnAt(colEls.map((c) => c.getBoundingClientRect()), x);
  const cardEls = [...colEls[col].querySelectorAll(':scope > .card')].filter((c) => c.dataset.id !== drag.id);
  const mids = cardEls.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
  return { col, idx: dropIndex(mids, y), ids: cardEls.map((c) => c.dataset.id), colEl: colEls[col], cardEls };
}

function showDrop(x, y) {
  const t = dropTarget(x, y);
  $('cards').querySelectorAll('.dropline').forEach((d) => d.remove());
  $('cards').querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
  t.colEl.classList.add('over');
  const line = document.createElement('div');
  line.className = 'dropline';
  t.colEl.insertBefore(line, t.cardEls[t.idx] || null);
}

function endDrag() {
  drag = null;
  $('cards').classList.remove('dnd');
  render();
}

$('cards').addEventListener('dragstart', (e) => {
  const grip = e.target.closest && e.target.closest('.grip');
  if (!grip) return;
  const cardEl = grip.closest('.card');
  drag = { id: cardEl.dataset.id };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.id);
  e.dataTransfer.setDragImage(cardEl, 24, 16);
  $('cards').classList.add('dnd');
  requestAnimationFrame(() => cardEl.classList.add('dragging'));
});
$('cards').addEventListener('dragover', (e) => {
  if (drag) { e.preventDefault(); showDrop(e.clientX, e.clientY); }
});
$('cards').addEventListener('drop', (e) => {
  if (!drag) return;
  e.preventDefault();
  const t = dropTarget(e.clientX, e.clientY);
  const layout = { ...(snap.layout || {}), ...pending };
  const order = orderFor(t.ids, t.idx, layout);
  pending[drag.id] = { col: t.col, order };
  postLayout([{ id: drag.id, col: t.col, order }]);
  endDrag();
});
$('cards').addEventListener('dragend', () => { if (drag) endDrag(); });

let pressing = false;
const onDown = () => { pressing = true; };
const onUp = () => setTimeout(() => { pressing = false; render(); }, 80);
document.addEventListener('pointerdown', onDown, true);
document.addEventListener('pointerup', onUp, true);
document.addEventListener('pointercancel', onUp, true);

function drawCards(list, now, depth) {
  if (drag || pressing) return;
  if (sortBy === 'manual' && list.length) return drawManual(list, now);
  if (!list.length) {
    $('cards').innerHTML = `<div class="empty">${snap.sessions.length ? 'No sessions match this filter.' : 'No sessions yet. Start a new Claude Code session with the claude-dash hooks enabled.'}</div>`;
    return;
  }
  const cols = autoLayout(list);
  $('cards').innerHTML = cols.map((col) => `<div class="col">${col.map((s) => card(s, now)).join('')}</div>`).join('');
  for (const el of $('cards').querySelectorAll('.card')) heights.set(el.dataset.id, el.getBoundingClientRect().height);
  if (depth < 2) {
    const sig = (cs) => cs.map((col) => col.map((s) => s.id).join(',')).join('|');
    if (sig(autoLayout(list)) !== sig(cols)) drawCards(list, now, depth + 1);
  }
}

const ro = new ResizeObserver(() => {
  const w = $('cards').clientWidth;
  if (w !== lastW) { lastW = w; render(); }
});
ro.observe($('cards'));
const onResize = () => render();
window.addEventListener('resize', onResize);

let prefsSynced = false;
function syncPrefs(p) {
  const mine = { sort: sortBy, filter: filterBy, cols: colsPref, drawer: drawerOpen ? 'open' : 'closed', pinned: drawerPinned ? 'pinned' : 'floating' };
  if (!prefsSynced) {
    prefsSynced = true;
    for (const [k, v] of Object.entries(mine)) if (p[k] === undefined) {
      const lk = Object.keys(PREF_KEYS).find((x) => PREF_KEYS[x] === k);
      if (store.get(lk, null) !== null) fetch('/api/prefs', { method: 'POST', body: JSON.stringify({ key: k, value: v }) }).catch(() => {});
    }
  } else if (Date.now() - localTouch < 3000) return;
  let drawerChanged = false;
  if (p.sort && p.sort !== sortBy) { sortBy = p.sort; store.set('dash.sort', sortBy, false); }
  if (p.filter && p.filter !== filterBy) { filterBy = p.filter; store.set('dash.filter', filterBy, false); }
  if (p.cols && p.cols !== colsPref) { colsPref = p.cols; store.set('dash.cols', colsPref, false); }
  if (p.drawer && (p.drawer === 'open') !== drawerOpen) { drawerOpen = p.drawer === 'open'; drawerChanged = true; }
  if (p.pinned && (p.pinned === 'pinned') !== drawerPinned) { drawerPinned = p.pinned === 'pinned'; drawerChanged = true; }
  if (drawerChanged) applyDrawer(false);
}

let es;
let timer;
function connect() {
  es = new EventSource('/api/stream');
  es.onopen = () => { $('conn').textContent = 'live'; };
  es.onmessage = (m) => {
    snap = JSON.parse(m.data);
    syncPrefs(snap.prefs || {});
    for (const [id, p] of Object.entries(pending)) {
      const l = (snap.layout || {})[id];
      if (l && l.col === p.col && l.order === p.order) delete pending[id];
    }
    render();
  };
  es.onerror = () => { $('conn').textContent = 'reconnecting…'; };
}
connect();
timer = setInterval(() => { snap.now = Date.now(); render(); }, 1000);

if (import.meta.hot) {
  import.meta.hot.dispose(() => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('pointerup', onUp, true); document.removeEventListener('pointercancel', onUp, true); ro.disconnect(); window.removeEventListener('resize', onResize); filterMenu.destroy(); sortMenu.destroy(); es.close(); clearInterval(timer); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); });

}
