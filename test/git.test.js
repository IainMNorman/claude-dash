const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspect, parseStatus, createGitTracker } = require('../src/git');

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'pipe' });

function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-git-')));
  const main = path.join(dir, 'myrepo');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), '1');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  return { dir, main };
}

test('parseStatus counts changed, untracked, ahead/behind, conflicts, detached', () => {
  const r = parseStatus('# branch.oid x\n# branch.head feat\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f\n2 R. N... 100644 100644 100644 a b R100 n o\nu UU N... 1 1 1 1 a b c d\n? new.txt\n? n2.txt\n');
  assert.deepEqual(r, { branch: 'feat', detached: false, ahead: 2, behind: 1, changed: 3, untracked: 2, conflicts: 1 });
  assert.equal(parseStatus('# branch.head (detached)\n').detached, true);
});

test('clean repo, then dirty, with branch and repo name', async () => {
  const { main } = repo();
  let g = await inspect(main);
  assert.equal(g.repo, 'myrepo');
  assert.equal(g.branch, 'main');
  assert.equal(g.worktree, false);
  assert.equal(g.changed + g.untracked, 0);
  fs.writeFileSync(path.join(main, 'a.txt'), '2');
  fs.writeFileSync(path.join(main, 'b.txt'), 'x');
  g = await inspect(path.join(main));
  assert.equal(g.changed, 1);
  assert.equal(g.untracked, 1);
});

test('subdirectory resolves to the repo root', async () => {
  const { main } = repo();
  fs.mkdirSync(path.join(main, 'sub'));
  const g = await inspect(path.join(main, 'sub'));
  assert.equal(g.root, main);
});

test('linked worktree is detected and names the main repo', async () => {
  const { dir, main } = repo();
  const wt = path.join(dir, 'myrepo-feature');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', wt);
  const g = await inspect(wt);
  assert.equal(g.worktree, true);
  assert.equal(g.worktreeName, 'myrepo-feature');
  assert.equal(g.repo, 'myrepo');
  assert.equal(g.branch, 'feature');
});

test('detached HEAD shows short sha', async () => {
  const { main } = repo();
  git(main, 'checkout', '-q', '--detach');
  const g = await inspect(main);
  assert.equal(g.detached, true);
  assert.match(g.branch, /^[0-9a-f]{7,}$/);
});

test('non-git and missing dirs give null; tracker caches and does not throw', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-plain-'));
  assert.equal(await inspect(plain), null);
  assert.equal(await inspect('/definitely/not/here'), null);
  assert.equal(await inspect(''), null);
  const { main } = repo();
  const tr = createGitTracker({ ttlMs: 60000 });
  assert.equal(tr.get(main), null);
  await tr.update(main);
  assert.equal(tr.get(main).branch, 'main');
  fs.writeFileSync(path.join(main, 'z.txt'), 'z');
  await tr.update(main);
  assert.equal(tr.get(main).untracked, 0, 'cached within ttl');
  await tr.update(plain);
  assert.equal(tr.get(plain), null);
});
