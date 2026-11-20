let snap = { sessions: [], feed: [], now: Date.now() };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
let sortBy = 'status';
try { sortBy = localStorage.getItem('dash.sort') || 'status'; } catch {}
const sorters = {
  status: null,
  latest: (a, b) => b.lastEvent - a.lastEvent,
  name: (a, b) => a.project.localeCompare(b.project) || b.lastEvent - a.lastEvent,
  state: (a, b) => a.stateSince - b.stateSince,
  tools: (a, b) => b.toolCount - a.toolCount,
  started: (a, b) => b.startedAt - a.startedAt,
};
let filterBy = 'live';
try { filterBy = localStorage.getItem('dash.filter') || 'live'; } catch {}
let query = '';
const filters = {
  live: (s) => s.displayState !== 'ended',
  waiting: (s) => s.displayState === 'waiting',
  working: (s) => s.displayState === 'working',
  stale: (s) => s.displayState === 'stale',
  ended: (s) => s.displayState === 'ended',
  all: () => true,
};
function visible() {
  const q = query.trim().toLowerCase();
  let list = snap.sessions.filter(filters[filterBy] || filters.live);
  if (q) list = list.filter((s) => (s.project + ' ' + s.cwd + ' ' + s.prompt + ' ' + s.toolDetail).toLowerCase().includes(q));
  const fn = sorters[sortBy];
  return fn ? [...list].sort(fn) : list;
}
$('filter').value = filterBy;
$('filter').onchange = (e) => {
  filterBy = e.target.value;
  try { localStorage.setItem('dash.filter', filterBy); } catch {}
  render();
};
$('q').oninput = (e) => { query = e.target.value; render(); };
$('sort').value = sortBy;
$('sort').onchange = (e) => {
  sortBy = e.target.value;
  try { localStorage.setItem('dash.sort', sortBy); } catch {}
  render();
};

function render() {
  const now = snap.now;
  const by = (st) => snap.sessions.filter((s) => s.displayState === st).length;
  $('stats').innerHTML = `<b>${by('working')}</b> working · <b>${by('waiting')}</b> waiting · <b>${by('idle')}</b> idle`;
  const list = visible();
  $('cards').innerHTML = list.length ? list.map((s) => `
    <div class="card ${s.displayState}">
      <div class="top"><span class="proj">${esc(s.project)}</span><span class="badge">${s.displayState} · ${dur(now - s.stateSince)}</span></div>
      <div class="mut">${esc(s.cwd)} · ${s.toolCount} tools${s.subagents ? ` · ${s.subagents} subagent${s.subagents > 1 ? 's' : ''}` : ''} · up ${dur(now - s.startedAt)}</div>
      ${s.message ? `<div class="msg">${esc(s.message)}</div>` : ''}
      ${s.tool ? `<div class="tool">▸ ${esc(s.tool)} ${esc(s.toolDetail)}</div>` : ''}
      ${s.prompt ? `<div class="prompt">“${esc(s.prompt)}”</div>` : ''}
    </div>`).join('') : `<div class="empty">${snap.sessions.length ? 'No sessions match this filter.' : 'No sessions yet. Start a new Claude Code session with the claude-dash hooks enabled.'}</div>`;
  $('feed').innerHTML = snap.feed.map((f) => `
    <div class="row"><span class="mut">${new Date(f.t).toLocaleTimeString([], { hour12: false })}</span>
    <span><b>${esc(f.project)}</b> ${esc(f.event)} ${esc(f.tool)}<div class="d">${esc(f.detail)}</div></span></div>`).join('');
}
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
  import.meta.hot.dispose(() => { es.close(); clearInterval(timer); });
  import.meta.hot.accept();
}
