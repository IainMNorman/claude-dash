const fs = require('node:fs');
const { messageCost } = require('./pricing');

const MINUTE = 60000;
const KEEP_MINUTES = 90;

function fresh() {
  return {
    offset: 0,
    seen: new Set(),
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0, model: '', lastText: '' },
    cost: { usd: 0, unpriced: 0, byMinute: new Map() },
  };
}

function createTokenTracker({ now = Date.now } = {}) {
  const files = new Map();

  function update(file, { sidechain = false, budgetBytes = Infinity } = {}) {
    if (!file) return null;
    let size;
    try { size = fs.statSync(file).size; } catch { return files.get(file)?.totals || null; }
    let st = files.get(file);
    if (!st || size < st.offset) st = fresh();
    files.set(file, st);
    if (size === st.offset) return st.totals;
    const fd = fs.openSync(file, 'r');
    try {
      const want = Math.min(size - st.offset, budgetBytes);
      const buf = Buffer.alloc(want);
      fs.readSync(fd, buf, 0, want, st.offset);
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n');
      if (end < 0) return st.totals;
      st.offset += Buffer.byteLength(text.slice(0, end + 1));
      for (const line of text.slice(0, end).split('\n')) {
        const userLine = line.includes('"type":"user"') && !line.includes('"tool_use_id"');
        if (!userLine && !line.includes('"usage"')) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.isSidechain && !sidechain) continue;
        const m = j.message;
        if (userLine) {
          const c = m && m.content;
          const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ') : '';
          if (!j.isSidechain && t.trim() && !/^\s*<(agent-message|task-notification|system-reminder|command-)/.test(t)) st.totals.lastText = '';
          continue;
        }
        if (!j.isSidechain && Array.isArray(m && m.content)) {
          const t = m.content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
          if (t) st.totals.lastText = t.slice(0, 240);
        }
        const u = m && m.usage;
        if (!u) continue;
        const key = m.id || j.uuid;
        if (key && st.seen.has(key)) continue;
        if (key) st.seen.add(key);
        st.totals.input += u.input_tokens || 0;
        st.totals.output += u.output_tokens || 0;
        st.totals.cacheRead += u.cache_read_input_tokens || 0;
        st.totals.cacheWrite += u.cache_creation_input_tokens || 0;
        st.totals.context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (m.model) st.totals.model = m.model;
        const c = messageCost(u, m.model);
        if (c === null) { st.cost.unpriced++; continue; }
        const ts = Date.parse(j.timestamp) || now();
        const bucket = Math.floor(ts / MINUTE);
        st.cost.usd += c;
        st.cost.byMinute.set(bucket, (st.cost.byMinute.get(bucket) || 0) + c);
      }
      const cutoff = Math.floor(now() / MINUTE) - KEEP_MINUTES;
      for (const k of st.cost.byMinute.keys()) if (k < cutoff) st.cost.byMinute.delete(k);
    } finally {
      fs.closeSync(fd);
    }
    return st.totals;
  }

  function costOf(file, windowMin = 10) {
    const st = files.get(file);
    if (!st) return { usd: 0, perHour: 0, unpriced: 0 };
    const nowMin = Math.floor(now() / MINUTE);
    let recent = 0;
    for (const [k, v] of st.cost.byMinute) if (k > nowMin - windowMin) recent += v;
    return { usd: st.cost.usd, perHour: recent * (60 / windowMin), unpriced: st.cost.unpriced };
  }

  const offsetOf = (file) => files.get(file)?.offset || 0;

  return { update, costOf, offsetOf, get: (file) => files.get(file)?.totals || null };
}

module.exports = { createTokenTracker };
