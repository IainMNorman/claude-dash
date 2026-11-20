function createAttentionTracker() {
  const seen = new Map();
  let primed = false;

  function items(snap) {
    const out = [];
    for (const s of snap.sessions) {
      if (s.dismissed) continue;
      if (s.displayState === 'waiting') {
        const w = (s.children || []).find((c) => c.status === 'waiting');
        out.push({ key: s.id, session: s, message: s.message, who: w ? `${w.desc || w.type || 'subagent'} · ${s.title || s.project}` : (s.title || s.project) });
      }
    }
    return out;
  }

  return {
    check(snap) {
      const now = items(snap);
      const keys = new Set(now.map((i) => i.key));
      const fresh = primed ? now.filter((i) => seen.get(i.key) !== i.message) : [];
      seen.clear();
      for (const i of now) seen.set(i.key, i.message);
      primed = true;
      for (const k of [...seen.keys()]) if (!keys.has(k)) seen.delete(k);
      return { fresh, count: now.length };
    },
  };
}

module.exports = { createAttentionTracker };
