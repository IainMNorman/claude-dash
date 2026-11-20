const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const { Store } = require('./core');
const { createServer } = require('./server');
const { persist } = require('./persist');

let win;
let tray;
const store = new Store();
persist(store);
const server = createServer(store, { staticDir: path.join(__dirname, '..', 'dist', 'renderer') });

function createWindow(port) {
  win = new BrowserWindow({
    width: 980, height: 700, title: 'Claude Dash', backgroundColor: '#111315',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(process.env.DASH_DEV_URL || `http://127.0.0.1:${port}/`);
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function updateTray() {
  if (!tray) return;
  const { sessions } = store.snapshot();
  const waiting = sessions.filter((s) => s.displayState === 'waiting').length;
  const working = sessions.filter((s) => s.displayState === 'working').length;
  tray.setTitle(`${working}▶${waiting ? ` ${waiting}⏸` : ''}`);
}

app.whenReady().then(async () => {
  let port;
  try { port = await server.listenOn(); } catch (e) { console.error('listen failed', e.message); app.quit(); return; }
  createWindow(port);
  tray = new Tray(nativeImage.createEmpty());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show dashboard', click: () => { win.show(); win.focus(); } },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
  store.onChange(updateTray);
  setInterval(updateTray, 5000);
  updateTray();
});

app.on('activate', () => win && win.show());
app.on('before-quit', () => { app.isQuitting = true; });
