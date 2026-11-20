const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_FILE = path.join(os.homedir(), '.claude', 'dashboard-window.json');
const MIN_W = 480;
const MIN_H = 360;
const VIS_W = 100;
const VIS_H = 60;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

function overlap(r, a) {
  const w = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x);
  const h = Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y);
  return { w, h, area: Math.max(0, w) * Math.max(0, h) };
}

function sanitize(state, displays, defaults) {
  const out = { ...defaults, maximized: false, fullscreen: false };
  const s = state && typeof state === 'object' ? state : {};
  out.maximized = s.maximized === true;
  out.fullscreen = s.fullscreen === true;
  delete out.x;
  delete out.y;
  if (num(s.width) && num(s.height)) {
    out.width = Math.round(s.width);
    out.height = Math.round(s.height);
  }
  out.width = Math.max(MIN_W, out.width);
  out.height = Math.max(MIN_H, out.height);

  const areas = (displays || []).map((d) => d && d.workArea).filter((a) => a && [a.x, a.y, a.width, a.height].every(num));
  if (!areas.length) return out;

  const hasPos = num(s.x) && num(s.y);
  const rect = { x: hasPos ? s.x : 0, y: hasPos ? s.y : 0, width: out.width, height: out.height };
  let best = areas[0];
  let bestArea = -1;
  let visible = false;
  for (const a of areas) {
    const o = overlap(rect, a);
    if (o.w >= Math.min(VIS_W, rect.width) && o.h >= Math.min(VIS_H, rect.height)) visible = true;
    if (o.area > bestArea) { bestArea = o.area; best = a; }
  }
  if (!hasPos) best = areas[0];
  out.width = Math.max(MIN_W, Math.min(out.width, best.width));
  out.height = Math.max(MIN_H, Math.min(out.height, best.height));
  if (hasPos && visible) { out.x = Math.round(s.x); out.y = Math.round(s.y); }
  return out;
}

function loadState(file = STATE_FILE, defaults = {}) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? { ...defaults, ...data } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

function saveState(file = STATE_FILE, state = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch { /* non-fatal */ }
}

module.exports = { loadState, saveState, sanitize, STATE_FILE, MIN_W, MIN_H };
