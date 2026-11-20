const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout: 4000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 4e6 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

function parseStatus(out) {
  const r = { branch: '', detached: false, ahead: 0, behind: 0, changed: 0, untracked: 0, conflicts: 0 };
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const h = line.slice(14).trim();
      r.detached = h === '(detached)';
      r.branch = r.detached ? '' : h;
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { r.ahead = Number(m[1]); r.behind = Number(m[2]); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) r.changed++;
    else if (line.startsWith('u ')) { r.changed++; r.conflicts++; }
    else if (line.startsWith('? ')) r.untracked++;
  }
  return r;
}

async function inspect(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const paths = await run(cwd, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir']);
  if (!paths) return null;
  const [root, gitDir, common] = paths.trim().split('\n');
  if (!root || !gitDir || !common) return null;
  const status = await run(cwd, ['status', '--porcelain=v2', '--branch']);
  if (status === null) return null;
  const worktree = path.resolve(gitDir) !== path.resolve(common);
  const head = parseStatus(status);
  let branch = head.branch;
  if (head.detached) {
    const sha = await run(cwd, ['rev-parse', '--short', 'HEAD']);
    branch = sha ? sha.trim() : 'detached';
  }
  return {
    root,
    repo: path.basename(path.dirname(path.resolve(common))),
    worktree,
    worktreeName: worktree ? path.basename(root) : '',
    ...head,
    branch,
  };
}

function createGitTracker({ ttlMs = 10000 } = {}) {
  const cache = new Map();
  const inflight = new Set();

  function update(cwd) {
    if (!cwd || inflight.has(cwd)) return Promise.resolve();
    const c = cache.get(cwd);
    if (c && Date.now() - c.at < ttlMs) return Promise.resolve();
    inflight.add(cwd);
    return inspect(cwd)
      .then((info) => { cache.set(cwd, { at: Date.now(), info }); })
      .catch(() => { cache.set(cwd, { at: Date.now(), info: null }); })
      .finally(() => inflight.delete(cwd));
  }

  return { update, get: (cwd) => cache.get(cwd)?.info || null };
}

module.exports = { createGitTracker, inspect, parseStatus };
