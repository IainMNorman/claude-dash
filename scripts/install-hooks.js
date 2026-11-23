const hooks = require('../src/hooks');
const remove = process.argv.includes('--remove');
const r = remove ? hooks.uninstall() : hooks.install();
console.log(remove ? 'Claude Dash hooks removed.' : r.installed ? 'Claude Dash hooks installed. Start a new Claude session to see it.' : `Install incomplete, missing: ${r.missing.join(', ')}`);
