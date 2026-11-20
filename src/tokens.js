const fs = require('node:fs');

function createTokenTracker() {
  const files = new Map();

  function update(file) {
    if (!file) return null;
    let size;
    try { size = fs.statSync(file).size; } catch { return files.get(file)?.totals || null; }
    let st = files.get(file);
    if (!st || size < st.offset) st = { offset: 0, seen: new Set(), totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    files.set(file, st);
    if (size === st.offset) return st.totals;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - st.offset);
      fs.readSync(fd, buf, 0, buf.length, st.offset);
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n');
      if (end < 0) return st.totals;
      st.offset += Buffer.byteLength(text.slice(0, end + 1));
      for (const line of text.slice(0, end).split('\n')) {
        if (!line.includes('"usage"')) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        const m = j.message;
        const u = m && m.usage;
        if (!u) continue;
        const key = m.id || j.uuid;
        if (key && st.seen.has(key)) continue;
        if (key) st.seen.add(key);
        st.totals.input += u.input_tokens || 0;
        st.totals.output += u.output_tokens || 0;
        st.totals.cacheRead += u.cache_read_input_tokens || 0;
        st.totals.cacheWrite += u.cache_creation_input_tokens || 0;
      }
    } finally {
      fs.closeSync(fd);
    }
    return st.totals;
  }

  return { update, get: (file) => files.get(file)?.totals || null };
}

module.exports = { createTokenTracker };
