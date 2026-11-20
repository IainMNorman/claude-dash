const path = require('node:path');
const { Store } = require('./core');
const { createServer } = require('./server');
const { persist } = require('./persist');
const { enrich } = require('./enrich');

const store = new Store();
persist(store);
enrich(store);
const server = createServer(store, { staticDir: path.join(__dirname, '..', 'dist', 'renderer') });
server.listenOn().then((p) => console.log(`claude-dash on http://127.0.0.1:${p}`));
