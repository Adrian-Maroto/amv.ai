/* GITHUB WAS IN THE PROVIDER TABLE AND COULD DO NOTHING.

   Two capability names, `repo.read` and `issues.write`, and not one action
   using either - so an account could complete the whole OAuth handshake,
   appear connected, and then have no way to do a single thing. Meanwhile the
   browser carried two GitHub tools that read a token out of localStorage
   under a key no flow has ever written, so they threw "GitHub not connected"
   at people whose account was.

   This is the security half of fixing that, and it is the half worth
   testing hardest: pushing code is AMV writing to somebody's repository.

   WHAT MUST HOLD, whatever arrives in the arguments:

     Nothing can move an existing ref. The push CREATES a branch and there is
     no argument that names one to overwrite - so a prompt injection, a
     confused caller, or a bug upstream cannot land anything on `main`.

     A repo, a branch and a path are validated, not coerced. A nearly-right
     name is a request that should not be sent; quietly repairing one is how
     a caller ends up pushing somewhere it did not mean to.

     The capability is checked before the call, not after. GitHub grants one
     `repo` scope covering everything, so the narrowing AMV can enforce is
     the only narrowing there is.

   Every assertion reads what was actually SENT to GitHub, because a refusal
   that returns 200 while the request still went out is the failure. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'gh.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { CONN_ACTIONS, CONN_PROVIDERS, _ghRepo, _ghBranch, _ghPath, GH_MAX_FILES };\n');
const W = await import(harness + '?t=' + Date.now());

/* Everything that left, so "it did not push" is a fact rather than an
   inference from a thrown error. */
let sent = [];
const realFetch = globalThis.fetch;
const jsonRes = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url), m = (init && init.method) || 'GET';
  sent.push({ url: u, method: m, body: init && init.body ? JSON.parse(init.body) : null });
  if (/\/git\/ref\/heads\//.test(u)) return jsonRes({ object: { sha: 'basesha000' } });
  if (/\/git\/blobs$/.test(u))       return jsonRes({ sha: 'blob' + sent.length });
  if (/\/git\/trees$/.test(u))       return jsonRes({ sha: 'treesha000' });
  if (/\/git\/commits$/.test(u))     return jsonRes({ sha: 'commitsha0000000' });
  if (/\/git\/refs$/.test(u))        return jsonRes({ ref: 'refs/heads/x' });
  if (/\/pulls$/.test(u))            return jsonRes({ number: 7, html_url: 'https://github.com/o/r/pull/7' });
  if (/\/user\/repos/.test(u))       return jsonRes([
    { full_name: 'me/mine', private: false, default_branch: 'main', permissions: { push: true } },
    { full_name: 'them/theirs', private: true, default_branch: 'trunk', permissions: { push: false } },
  ]);
  return jsonRes({});
};
const run = (name, args) => W.CONN_ACTIONS[name].run('tok', args || {});
const threw = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message || e); } };

section('The actions exist at all, which is the thing that was missing');
{
  for (const n of ['github.repos', 'github.push', 'github.pr', 'github.issues', 'github.issue.create']) {
    ok(!!W.CONN_ACTIONS[n], n + ' is a real action', !!W.CONN_ACTIONS[n]);
  }
  ok(W.CONN_PROVIDERS.github.scopes['code.write'] === 'repo',
     'and pushing code has a capability of its own to be granted',
     W.CONN_PROVIDERS.github.scopes['code.write']);
  ok(W.CONN_ACTIONS['github.push'].need === 'code.write',
     'which the push requires, so a read-only connection cannot be talked into one',
     W.CONN_ACTIONS['github.push'].need);
  ok(W.CONN_ACTIONS['github.push'].writes === true
     && W.CONN_ACTIONS['github.pr'].writes === true,
     'and both are marked as writes, so the harder rate limit binds them', true);
  ok(W.CONN_ACTIONS['github.repos'].writes === false,
     'while reading your repositories is not', W.CONN_ACTIONS['github.repos'].writes);
}

section('A push creates a branch and can never move one');
{
  sent = [];
  const r = await run('github.push', {
    repo: 'me/mine', base: 'main', branch: 'amv/thing-0101-1200',
    message: 'hello', files: [{ path: 'index.html', content: '<h1>a</h1>' }],
  });
  const refCall = sent.find(x => /\/git\/refs$/.test(x.url));
  ok(!!refCall, 'the branch is created through the refs endpoint', !!refCall);
  ok(refCall.method === 'POST',
     'by POST, which CREATES - a PATCH here would be what moves a branch', refCall.method);
  ok(refCall.body.ref === 'refs/heads/amv/thing-0101-1200',
     'onto the branch it was told to make', refCall.body.ref);
  /* The property, stated the other way round: nothing in the whole exchange
     updates an existing ref. */
  ok(!sent.some(x => x.method === 'PATCH' || /\/git\/refs\/heads\//.test(x.url)),
     'and nothing anywhere in the push updates an existing ref', sent.map(x => x.method + ' ' + x.url.slice(-30)));
  ok(r.branch === 'amv/thing-0101-1200' && r.base === 'main',
     'the result says where it went', r);
}

section('One commit, not one per file');
{
  sent = [];
  await run('github.push', {
    repo: 'me/mine', base: 'main', branch: 'amv/b',
    files: [{ path: 'a.js', content: '1' }, { path: 'b.js', content: '2' }, { path: 'c.js', content: '3' }],
  });
  const commits = sent.filter(x => /\/git\/commits$/.test(x.url));
  const blobs = sent.filter(x => /\/git\/blobs$/.test(x.url));
  ok(blobs.length === 3, 'each file becomes a blob', blobs.length);
  ok(commits.length === 1,
     'and the three land in ONE commit, not three - a change should not be a wall of history',
     commits.length);
  const tree = sent.find(x => /\/git\/trees$/.test(x.url));
  ok(tree.body.base_tree === 'basesha000',
     'built on the base tree, so files it did not touch survive', tree.body.base_tree);
}

section('A name that is nearly right is refused, never repaired');
{
  const cases = [
    ['repo with no owner',        { repo: 'mine', branch: 'amv/b' }],
    ['repo with a path in it',    { repo: 'me/mine/extra', branch: 'amv/b' }],
    ['a branch that starts with a dash', { repo: 'me/mine', branch: '-delete-everything' }],
    ['a branch climbing with ..', { repo: 'me/mine', branch: 'amv/../main' }],
    ['a branch ending in a slash',{ repo: 'me/mine', branch: 'amv/' }],
  ];
  for (const [label, args] of cases) {
    sent = [];
    const msg = await threw(() => run('github.push',
      Object.assign({ files: [{ path: 'a.js', content: 'x' }] }, args)));
    ok(/bad_repo|bad_branch/.test(msg), label + ' is refused', msg);
    ok(sent.length === 0, '  and nothing was sent while finding out', sent.length);
  }
}

section('A path cannot climb out of the tree, or into .git');
{
  for (const bad of ['../../etc/passwd', '.git/config', 'a/../../b', '/abs/path/../..']) {
    sent = [];
    const msg = await threw(() => run('github.push',
      { repo: 'me/mine', branch: 'amv/b', files: [{ path: bad, content: 'x' }] }));
    ok(msg === 'bad_path', bad + ' is refused', msg);
    ok(sent.length === 0, '  with nothing sent', sent.length);
  }
  /* A leading slash is the one case that is repaired rather than refused,
     because it is unambiguous and means the repository root. */
  sent = [];
  await run('github.push', { repo: 'me/mine', branch: 'amv/b', files: [{ path: '/index.html', content: 'x' }] });
  const tree = sent.find(x => /\/git\/trees$/.test(x.url));
  ok(tree.body.tree[0].path === 'index.html',
     'a leading slash is dropped, because it can only mean the root', tree.body.tree[0].path);
}

section('The size of a push is bounded before anything leaves');
{
  sent = [];
  const many = Array.from({ length: W.GH_MAX_FILES + 1 }, (_, i) => ({ path: 'f' + i + '.js', content: 'x' }));
  const msg = await threw(() => run('github.push', { repo: 'me/mine', branch: 'amv/b', files: many }));
  ok(msg === 'too_many_files', 'too many files is refused', msg);
  ok(sent.length === 0, 'before a single blob is uploaded', sent.length);

  sent = [];
  const huge = [{ path: 'big.txt', content: 'x'.repeat(3 * 1024 * 1024) }];
  const msg2 = await threw(() => run('github.push', { repo: 'me/mine', branch: 'amv/b', files: huge }));
  ok(msg2 === 'too_large', 'and so is too much content', msg2);
  ok(sent.length === 0, 'also before anything is sent', sent.length);

  sent = [];
  const none = await threw(() => run('github.push', { repo: 'me/mine', branch: 'amv/b', files: [] }));
  ok(none === 'no_files', 'an empty push is refused rather than making an empty commit', none);
}

section('Only repositories you can actually write to are offered');
{
  sent = [];
  const repos = await run('github.repos');
  ok(repos.length === 1 && repos[0].full === 'me/mine',
     'a repo without push permission is not in the list', repos.map(r => r.full));
  ok(repos[0].branch === 'main',
     'and each carries its own default branch, not an assumed one', repos[0].branch);
  ok(!('permissions' in repos[0]) && !('id' in repos[0]),
     'with only the fields the picker needs, not the eighty a repo carries', Object.keys(repos[0]));
}

section('A branch that already exists is a refusal, not an overwrite');
{
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (/\/git\/refs$/.test(u)) return new Response('{}', { status: 422 });
    if (/\/git\/ref\/heads\//.test(u)) return jsonRes({ object: { sha: 'basesha000' } });
    if (/\/git\/blobs$/.test(u)) return jsonRes({ sha: 'b' });
    if (/\/git\/trees$/.test(u)) return jsonRes({ sha: 't' });
    if (/\/git\/commits$/.test(u)) return jsonRes({ sha: 'c' });
    return jsonRes({});
  };
  const msg = await threw(() => run('github.push',
    { repo: 'me/mine', branch: 'amv/b', files: [{ path: 'a.js', content: 'x' }] }));
  ok(msg === 'branch_exists',
     'GitHub refusing the ref is reported as a collision, not retried as an update', msg);
}

globalThis.fetch = realFetch;
if (report('a-push-cannot-move-somebody-elses-branch') > 0) process.exitCode = 1;
done();
