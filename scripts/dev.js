const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const bin = (n) => path.join(__dirname, '..', 'node_modules', '.bin', n);
const vite = spawn(bin('vite'), [], { stdio: 'inherit' });
let app;
let timer;

function start() {
  app = spawn(bin('electron'), ['.'], { stdio: 'inherit', env: { ...process.env, DASH_DEV_URL: 'http://localhost:5173/' } });
  app.on('exit', (code, sig) => { if (!sig && app && !app.restarting) shutdown(); });
}
function restart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!app) return start();
    app.restarting = true;
    app.once('exit', () => start());
    app.kill();
  }, 200);
}
function shutdown() { app && (app.restarting = true) && app.kill(); vite.kill(); process.exit(0); }

fs.watch(path.join(__dirname, '..', 'src'), (_, f) => { if (f && f.endsWith('.js') && !f.includes('renderer')) restart(); });
process.on('SIGINT', shutdown);
setTimeout(start, 1500);
