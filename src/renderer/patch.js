export function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

export const since = (ms) => `since:${Math.round(Number(ms) || 0)}`;

export function timeText(spec, now) {
  const m = /^since:(-?\d+)$/.exec(String(spec || ''));
  return m ? dur(now - Number(m[1])) : '';
}

export function timeTitle(prefix, spec, now) {
  const t = timeText(spec, now);
  return prefix ? (t ? `${prefix} · ${t}` : prefix) : t;
}

export function diffKeyed(prev, next) {
  const out = { create: [], replace: [], keep: [], remove: [] };
  const seen = new Set();
  for (const { key, sig } of next) {
    seen.add(key);
    if (!prev.has(key)) out.create.push(key);
    else if (prev.get(key) !== sig) out.replace.push(key);
    else out.keep.push(key);
  }
  for (const key of prev.keys()) if (!seen.has(key)) out.remove.push(key);
  return out;
}

export function feedKeys(feed, cap = 50) {
  const counts = new Map();
  return feed.slice(0, cap).map((f) => {
    const base = `${f.t}|${f.session || ''}|${f.event}|${f.text || ''}`;
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return { key: n ? `${base}#${n}` : base, item: f };
  });
}

export const colsSig = (cols) => cols.map((col) => col.map((s) => s.id).join(',')).join('|');
