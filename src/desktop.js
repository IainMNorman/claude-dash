const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');

function createDesktopIndex({ dir = DIR, ttlMs = 10000 } = {}) {
  const byCli = new Map();
  const mtimes = new Map();
  let last = 0;

  function walk(d, depth, out) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(full, depth + 1, out);
      else if (e.isFile() && /^local_.*\.json$/.test(e.name)) out.push(full);
    }
  }

  function refresh() {
    const now = Date.now();
    if (now - last < ttlMs) return;
    last = now;
    const files = [];
    walk(dir, 0, files);
    for (const f of files) {
      let m;
      try { m = fs.statSync(f).mtimeMs; } catch { continue; }
      if (mtimes.get(f) === m) continue;
      mtimes.set(f, m);
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j.cliSessionId && j.sessionId) byCli.set(j.cliSessionId, { desktopId: j.sessionId, title: j.title || '' });
      } catch { /* skip unreadable */ }
    }
  }

  return {
    lookup(cliId) {
      refresh();
      const d = byCli.get(cliId);
      if (!d) return null;
      return { title: d.title, link: `claude://code/continue?session=${d.desktopId}` };
    },
  };
}

module.exports = { createDesktopIndex };
