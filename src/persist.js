const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_FILE = path.join(os.homedir(), '.claude', 'dashboard-state.json');

function load(store, file = STATE_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    store.hydrate(data);
    store.prune();
    return true;
  } catch {
    return false;
  }
}

function save(store, file = STATE_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store.dump()));
    fs.renameSync(tmp, file);
  } catch { /* non-fatal */ }
}

function persist(store, { file = STATE_FILE, delayMs = 1000 } = {}) {
  load(store, file);
  let timer;
  store.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => save(store, file), delayMs);
  });
  const flush = () => { clearTimeout(timer); save(store, file); };
  process.on('exit', flush);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
  return flush;
}

module.exports = { persist, load, save, STATE_FILE };
