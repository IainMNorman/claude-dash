const { createDesktopIndex } = require('./desktop');
const { createTokenTracker } = require('./tokens');

function enrich(store, { desktop = createDesktopIndex(), tokens = createTokenTracker(), intervalMs = 5000 } = {}) {
  store.resolver = (s) => {
    const d = desktop.lookup(s.id);
    return { title: d ? d.title : '', link: d ? d.link : '', tokens: tokens.get(s.transcript) };
  };
  const refresh = () => {
    for (const s of store.sessions.values()) if (s.state !== 'ended' || !tokens.get(s.transcript)) tokens.update(s.transcript);
  };
  refresh();
  const timer = setInterval(refresh, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { enrich };
