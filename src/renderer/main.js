let snap = { sessions: [], feed: [], now: Date.now() };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
function render() {
  const now = snap.now;
  const by = (st) => snap.sessions.filter((s) => s.displayState === st).length;
  $('stats').innerHTML = `<b>${by('working')}</b> working · <b>${by('waiting')}</b> waiting · <b>${by('idle')}</b> idle`;
  $('cards').innerHTML = snap.sessions.length ? snap.sessions.map((s) => `
    <div class="card ${s.displayState}">
      <div class="top"><span class="proj">${esc(s.project)}</span><span class="badge">${s.displayState} · ${dur(now - s.stateSince)}</span></div>
      <div class="mut">${esc(s.cwd)} · ${s.toolCount} tools${s.subagents ? ` · ${s.subagents} subagent${s.subagents > 1 ? 's' : ''}` : ''} · up ${dur(now - s.startedAt)}</div>
      ${s.message ? `<div class="msg">${esc(s.message)}</div>` : ''}
      ${s.tool ? `<div class="tool">▸ ${esc(s.tool)} ${esc(s.toolDetail)}</div>` : ''}
      ${s.prompt ? `<div class="prompt">“${esc(s.prompt)}”</div>` : ''}
    </div>`).join('') : '<div class="empty">No sessions yet. Start Claude Code with the claude-dash plugin enabled.</div>';
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
