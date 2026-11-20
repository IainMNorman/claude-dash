const fs = require('node:fs');
const path = require('node:path');

function tasksDirFor(scratchpadDir) {
  return scratchpadDir ? path.join(path.dirname(scratchpadDir), 'tasks') : null;
}

function syncShellStarts(session, statFn = fs.statSync) {
  const dir = tasksDirFor(session.scratchpadDir);
  if (!dir) return false;
  let changed = false;
  for (const c of session.children || []) {
    if (c.kind !== 'shell' || !c.id || c.fsStart) continue;
    try {
      const st = statFn(path.join(dir, `${c.id}.output`));
      c.startedAt = st.birthtimeMs || st.ctimeMs;
      c.fsStart = true;
      changed = true;
    } catch { /* output file not there (yet) */ }
  }
  return changed;
}

module.exports = { syncShellStarts, tasksDirFor };
