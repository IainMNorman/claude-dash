const path = require('node:path');
const { Store } = require('./core');
const { createServer } = require('./server');

const store = new Store();
const server = createServer(store, { staticDir: path.join(__dirname, 'renderer') });
server.listenOn().then((p) => console.log(`claude-dash on http://127.0.0.1:${p}`));
