const fs = require('node:fs');
const { execFile } = require('node:child_process');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CLAUDE_BIN = /(?:^|\/)claude(?:\.exe)?(?:\s|$)|claude-code\/(?:cli|bin)/;

const psExec = () => new Promise((resolve, reject) => {
  execFile('ps', ['-wwaxo', 'pid,command'], { timeout: 3000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

function claudeSessionIds(out) {
  const ids = new Set();
  for (const line of String(out).split('\n')) {
    if (/claude-dash/i.test(line) || !CLAUDE_BIN.test(line)) continue;
    for (const m of line.match(UUID) || []) ids.add(m.toLowerCase());
  }
  return ids;
}

function createLivenessChecker({ exec = psExec, now = Date.now, graceMs = 30000, missesToEnd = 2, quietMs = 6 * 3600 * 1000 } = {}) {
  const misses = new Map();
  const seen = new Set();
  const exempt = new Set();
  const endedByUs = new Set();
  const mtime = (f) => { try { return f ? fs.statSync(f).mtimeMs : 0; } catch { return 0; } };

  async function check(store) {
    let out;
    try { out = await exec(); } catch { return []; }
    const ids = claudeSessionIds(out);
    const t = now();
    const ended = [];
    const active = new Set();
    for (const s of store.sessions.values()) {
      if (s.state === 'ended' || s.dismissed) continue;
      active.add(s.id);
      const m = misses.get(s.id);
      if (m && m.lastEvent !== s.lastEvent) misses.delete(s.id);
      if (endedByUs.delete(s.id)) exempt.add(s.id);
      if (ids.has(s.id.toLowerCase())) { seen.add(s.id); exempt.delete(s.id); misses.delete(s.id); continue; }
      const info = store.resolver ? store.resolver(s) : null;
      const trackable = !exempt.has(s.id) && ids.size > 0 && (seen.has(s.id) || !store.resolver || !!(info && info.link));
      if (!trackable) {
        if (t - s.lastEvent > quietMs && t - mtime(s.transcript) > quietMs && store.markEnded(s.id, 'quiet')) ended.push(s.id);
        continue;
      }
      const n = (misses.get(s.id) ? misses.get(s.id).n : 0) + 1;
      misses.set(s.id, { n, lastEvent: s.lastEvent });
      if (n >= missesToEnd && t - s.startedAt > graceMs && t - s.lastEvent > graceMs && store.markEnded(s.id, 'process gone')) {
        ended.push(s.id);
        endedByUs.add(s.id);
        misses.delete(s.id);
      }
    }
    for (const id of misses.keys()) if (!active.has(id)) misses.delete(id);
    return ended;
  }

  return { check };
}

module.exports = { createLivenessChecker, claudeSessionIds };
