const { createDesktopIndex } = require('./desktop');
const { createTokenTracker } = require('./tokens');
const { createGitTracker } = require('./git');

function enrich(store, { desktop = createDesktopIndex(), tokens = createTokenTracker(), git = createGitTracker(), intervalMs = 5000 } = {}) {
  store.resolver = (s) => {
    const d = desktop.lookup(s.id);
    return { title: d ? d.title : '', link: d ? d.link : '', tokens: tokens.get(s.transcript), git: git.get(s.cwd) };
  };
  const refresh = () => {
    const cwds = new Set();
    for (const s of store.sessions.values()) {
      if (s.state !== 'ended' || !tokens.get(s.transcript)) tokens.update(s.transcript);
      if (s.state !== 'ended' && !s.dismissed) cwds.add(s.cwd);
    }
    for (const c of cwds) git.update(c);
  };
  refresh();
  const timer = setInterval(refresh, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { enrich };
