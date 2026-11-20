const { createDesktopIndex } = require('./desktop');
const fs = require('node:fs');
const path = require('node:path');
const { createTokenTracker } = require('./tokens');
const { createGitTracker } = require('./git');
const { createSubagentScanner, subagentsDir } = require('./subagents');
const { syncShellStarts } = require('./shells');
const { createLivenessChecker } = require('./liveness');

function enrich(store, { desktop = createDesktopIndex(), tokens = createTokenTracker(), git = createGitTracker(), subagents = createSubagentScanner(), liveness = createLivenessChecker(), intervalMs = 5000 } = {}) {
  const costs = new Map();
  const DAY = 24 * 3600 * 1000;
  const subFiles = (transcript) => {
    const dir = subagentsDir(transcript);
    if (!dir) return [];
    try {
      return fs.readdirSync(dir).filter((n) => /^agent-.+\.jsonl$/.test(n)).map((n) => path.join(dir, n)).filter((f) => {
        try { return Date.now() - fs.statSync(f).mtimeMs < DAY; } catch { return false; }
      });
    } catch { return []; }
  };
  const refreshCost = (s) => {
    const files = [s.transcript, ...subFiles(s.transcript)].filter(Boolean);
    let budget = 8 * 1024 * 1024;
    let usd = 0;
    let perHour = 0;
    let unpriced = 0;
    for (const f of files) {
      if (budget > 0 || f === s.transcript) {
        const before = tokens.offsetOf(f);
        tokens.update(f, { sidechain: f !== s.transcript, budgetBytes: f === s.transcript ? Infinity : budget });
        budget -= tokens.offsetOf(f) - before;
      }
      const c = tokens.costOf(f);
      usd += c.usd; perHour += c.perHour; unpriced += c.unpriced;
    }
    costs.set(s.id, { usd, perHour, unpriced, subagents: files.length - (s.transcript ? 1 : 0) });
  };
  store.resolver = (s) => {
    const d = desktop.lookup(s.id);
    return { title: d ? d.title : '', link: d ? d.link : '', tokens: tokens.get(s.transcript), cost: costs.get(s.id) || null, git: git.get(s.cwd) };
  };
  const refresh = () => {
    const cwds = new Set();
    for (const s of store.sessions.values()) {
      if (s.state !== 'ended' || !costs.has(s.id)) refreshCost(s);
      if (s.state !== 'ended' && !s.dismissed) { cwds.add(s.cwd); store.syncChildren(s.id, subagents.scan(s.transcript), { authoritative: !!s.transcript }); syncShellStarts(s); }
    }
    for (const c of cwds) git.update(c);
  };
  let checking = false;
  const checkLiveness = () => {
    if (checking) return;
    checking = true;
    Promise.resolve().then(() => liveness.check(store)).catch(() => {}).finally(() => { checking = false; });
  };
  refresh();
  const timer = setInterval(() => { refresh(); checkLiveness(); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { enrich };
