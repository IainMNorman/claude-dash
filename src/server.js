const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PORT = 47821;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const DEBUG_FILE = path.join(os.homedir(), '.claude', 'dashboard-debug.jsonl');
const PORT_FILE =path.join(os.homedir(), '.claude', 'dashboard.port');

function isChildEvent(ev) {
  const n = ev.hook_event_name;
  return n === 'SubagentStop' || n === 'SubagentStart' || ev.tool_name === 'Task' || ev.tool_name === 'Agent' || !!(ev.tool_input && ev.tool_input.run_in_background) || (Array.isArray(ev.background_tasks) && ev.background_tasks.some((b) => b && b.type !== 'subagent'));
}

function createServer(store, { staticDir } = {}) {
  const sampled = new Set();
  const clients = new Set();
  const push = () => {
    const data = `data: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  };
  store.onChange(push);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/event') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const ev = JSON.parse(body);
          if (process.env.CLAUDE_DASH_DEBUG !== '0' && ev.hook_event_name && 'background_tasks' in ev) {
            const k = `${ev.hook_event_name}|${Array.isArray(ev.background_tasks) ? ev.background_tasks.length > 0 : 'x'}`;
            if (!sampled.has(k)) { sampled.add(k); fs.appendFile(DEBUG_FILE, JSON.stringify({ t: Date.now(), sample: k, ...ev }) + '\n', () => {}); }
          }
          if (process.env.CLAUDE_DASH_DEBUG !== '0' && isChildEvent(ev)) fs.appendFile(DEBUG_FILE, JSON.stringify({ t: Date.now(), ...ev }) + '\n', () => {});
          store.ingest(ev);
        } catch (e) { if (!(e instanceof SyntaxError)) console.error('event failed:', e); }
        res.writeHead(204).end();
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/prefs') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try { const { key, value } = JSON.parse(body); store.setPref(key, value); ok = true; } catch { /* ignore */ }
        res.writeHead(ok ? 204 : 400).end();
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/layout') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try { ok = store.setLayout(JSON.parse(body).updates) || true; } catch { /* ignore */ }
        res.writeHead(ok ? 204 : 400).end();
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try {
          const { id, flag, value } = JSON.parse(body);
          ok = store.setFlag(id, flag, value);
        } catch { /* ignore */ }
        res.writeHead(ok ? 204 : 400).end();
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(store.snapshot()));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && staticDir) {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(staticDir, rel);
      if (file.startsWith(path.resolve(staticDir) + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
        return;
      }
    }
    res.writeHead(404).end();
  });

  const tick = setInterval(push, 5000);
  tick.unref();

  server.listenOn = (port = Number(process.env.CLAUDE_DASH_PORT) || DEFAULT_PORT) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        try {
          fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true });
          fs.writeFileSync(PORT_FILE, String(server.address().port));
        } catch { /* non-fatal */ }
        resolve(server.address().port);
      });
    });
  return server;
}

module.exports = { createServer, DEFAULT_PORT, PORT_FILE };
