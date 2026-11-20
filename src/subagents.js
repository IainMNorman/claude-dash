const fs = require('node:fs');
const path = require('node:path');

function subagentsDir(transcript) {
  if (!transcript || !transcript.endsWith('.jsonl')) return null;
  return path.join(transcript.slice(0, -'.jsonl'.length), 'subagents');
}

function createSubagentScanner({ activeMs = 15 * 60 * 1000, lookbackMs = 24 * 3600 * 1000, now = Date.now } = {}) {
  const metaCache = new Map();

  function scan(transcript) {
    const dir = subagentsDir(transcript);
    if (!dir) return [];
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const t = now();
    const out = [];
    for (const n of names) {
      const m = n.match(/^agent-(.+)\.meta\.json$/);
      if (!m) continue;
      const metaFile = path.join(dir, n);
      const jsonl = path.join(dir, `agent-${m[1]}.jsonl`);
      let ms;
      let js;
      try { ms = fs.statSync(metaFile); } catch { continue; }
      try { js = fs.statSync(jsonl); } catch { js = null; }
      const last = Math.max(ms.mtimeMs, js ? js.mtimeMs : 0);
      if (t - last > lookbackMs) continue;
      const key = metaFile;
      let cached = metaCache.get(key);
      if (!cached || cached.mtime !== ms.mtimeMs) {
        try { cached = { mtime: ms.mtimeMs, meta: JSON.parse(fs.readFileSync(metaFile, 'utf8')) }; } catch { continue; }
        metaCache.set(key, cached);
      }
      const meta = cached.meta;
      const finished = !!meta.finished;
      if (!finished && t - last > activeMs) continue;
      out.push({
        id: m[1],
        toolUseId: meta.toolUseId || null,
        desc: String(meta.description || '').slice(0, 120),
        type: meta.agentType || '',
        status: finished ? 'done' : 'running',
        startedAt: ms.birthtimeMs || ms.ctimeMs,
        endedAt: finished ? last : null,
      });
    }
    return out;
  }

  return { scan };
}

module.exports = { createSubagentScanner, subagentsDir };
