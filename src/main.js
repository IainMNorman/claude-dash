const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, nativeTheme, screen } = require('electron');
const path = require('node:path');
const { loadState, saveState, sanitize, STATE_FILE: WINDOW_FILE } = require('./windowstate');
const WINDOW_DEFAULTS = { width: 980, height: 700 };
const { Store } = require('./core');
const { createServer } = require('./server');
const { persist } = require('./persist');
const { enrich } = require('./enrich');
const { createAttentionTracker } = require('./attention');

let win;
let tray;
const store = new Store();
persist(store);
enrich(store);
const attention = createAttentionTracker();
const server = createServer(store, { staticDir: path.join(__dirname, '..', 'dist', 'renderer') });

function createWindow(port) {
  const { x, y, width, height, maximized, fullscreen } = sanitize(loadState(WINDOW_FILE, WINDOW_DEFAULTS), screen.getAllDisplays(), WINDOW_DEFAULTS);
  win = new BrowserWindow({
    x, y, width, height, title: 'Claude Dash', backgroundColor: nativeTheme.shouldUseDarkColors ? '#111315' : '#f5f6f7',
    titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 19 },
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(process.env.DASH_DEV_URL || `http://127.0.0.1:${port}/`);
  if (maximized) win.maximize();
  if (fullscreen) win.setFullScreen(true);
  let saveTimer;
  const flushWindowState = () => {
    clearTimeout(saveTimer);
    if (!win || win.isDestroyed()) return;
    saveState(WINDOW_FILE, { ...win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  };
  const queueWindowState = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flushWindowState, 400); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, queueWindowState);
  app.on('before-quit', flushWindowState);
  win.on('close', (e) => { flushWindowState(); if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function updateTray() {
  if (!tray) return;
  const { sessions } = store.snapshot();
  const waiting = sessions.filter((s) => s.displayState === 'waiting').length;
  const working = sessions.filter((s) => s.displayState === 'working').length;
  tray.setTitle(`${working}▶${waiting ? ` ${waiting}⏸` : ''}`);
  const { fresh, count } = attention.check(store.snapshot());
  if (app.dock) app.dock.setBadge(count ? String(count) : '');
  for (const item of fresh) {
    const n = new Notification({ title: `${item.who} needs you`, body: item.message || 'Waiting for your input', silent: false });
    n.on('click', () => {
      if (item.session.link) shell.openExternal(item.session.link);
      else { win.show(); win.focus(); }
    });
    n.show();
  }
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
