/* A REPOSITORY OPENED IN THE CLOUD WORKSPACE GOES BACK AS A BRANCH.

   The page half of cloud coding (36c-cloud-repo.js). What changed is asked of
   git in the workspace; every file is listed before anything leaves; and the
   push builds on the commit that was copied, can remove files, and offers the
   pull request as a separate press. The workspace and GitHub are stood in for
   at the page's own seams (bridgeExec, bridgeRead, _connActRun). */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
const BASE = 'a'.repeat(40);

section('What changed is read from git, renames and removals included');
{
  const r = await page.evaluate(() => _cloudRepoChanges(' M src/a.js\0?? new.txt\0 D old.txt\0R  b.js\0a.js\0 M .amv-checkout.json\0'));
  ok(r.changed.join() === 'src/a.js,new.txt,b.js', 'changed and new files, and the new name of a renamed one', r.changed);
  ok(r.deleted.join() === 'old.txt,a.js', 'removed files, and the old name of a renamed one', r.deleted);
}

section('The card says what was opened and what was not copied');
{
  const h = await page.evaluate((b) => {
    CLOUD_REPO_STATE.open = { repo: 'octo/hello', ref: 'main', base: b, folder: 'repos/hello', files: 2, tracked: true,
      skipped: [{ path: 'logo.png', why: 'not text' }, { path: '<img src=x onerror=1>', why: 'not text' }], skippedCount: 2 };
    const d = document.createElement('div'); d.innerHTML = _cloudRepoHTML(); document.body.appendChild(d);
    const t = d.textContent; const img = !!d.querySelector('img'); d.remove(); return { t, img };
  }, BASE);
  ok(/octo\/hello/.test(h.t) && /repos\/hello/.test(h.t) && /2 files at aaaaaaa/.test(h.t) && /2 not copied/.test(h.t), 'which repository, where, how many, at which commit, and how many were left out', h.t.slice(0, 200));
  ok(/logo\.png/.test(h.t) && !h.img, 'each file left out is named, as text', h.img);
}

section('Sending lists every file first, then pushes from the copied commit');
{
  const r = await page.evaluate(async (b) => {
    const real = { exec: window.bridgeExec, read: window.bridgeRead, act: window._connActRun };
    const calls = [];
    window.bridgeExec = async (cmd, o) => { calls.push(['exec', cmd, o.cwd]); return { exitCode: 0, stdout: ' M src/app.js\0 D README.md\0' }; };
    window.bridgeRead = async (p) => { calls.push(['read', p]); return { content: 'export const answer = 43;\n' }; };
    window._connActRun = async (name, args) => { calls.push(['act', name, args]); return { repo: args.repo, branch: args.branch, verified: true }; };
    try {
      const p = _cloudRepoSend();
      await new Promise(x => setTimeout(x, 200));
      const shown = (document.querySelector('#ovr') || {}).textContent || '';
      const before = calls.filter(c => c[0] === 'act').length;
      document.getElementById('ghp-go').click();
      await p; await new Promise(x => setTimeout(x, 200));
      const toasts = [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent);
      return { calls, shown, before, toasts };
    } finally { Object.assign(window, { bridgeExec: real.exec, bridgeRead: real.read, _connActRun: real.act }); }
  }, BASE);
  const exec = r.calls.find(c => c[0] === 'exec'), push = r.calls.find(c => c[0] === 'act');
  ok(exec && /git status --porcelain=v1 -z/.test(exec[1]) && exec[2] === 'repos/hello', 'git is asked, in the repository’s folder', exec);
  ok(/src\/app\.js/.test(r.shown) && /README\.md/.test(r.shown) && /removed/.test(r.shown) && /aaaaaaa/.test(r.shown), 'every file, the removal and the starting commit are shown first', r.shown.slice(0, 300));
  ok(r.before === 0, 'nothing was sent before Send was pressed', r.before);
  ok(push && push[1] === 'github.push' && push[2].baseSha === BASE && push[2].deletes.join() === 'README.md'
     && push[2].files.length === 1 && push[2].files[0].path === 'src/app.js' && push[2].repo === 'octo/hello', 'the push builds on the copied commit, with the change and the removal', push && push[2]);
  ok(r.toasts.some(t => /Open pull request/.test(t)), 'and the pull request is offered as its own press', r.toasts);
}

section('A workspace that slept says so, and sends nothing');
{
  const r = await page.evaluate(async () => {
    const real = { exec: window.bridgeExec, act: window._connActRun }; let acted = 0;
    window.bridgeExec = async () => ({ exitCode: 128, stdout: '', stderr: 'not a git repository' });
    window._connActRun = async () => { acted++; return {}; };
    document.querySelectorAll('#toast-wrap .toast').forEach(t => t.remove());
    try { await _cloudRepoSend(); } finally { Object.assign(window, { bridgeExec: real.exec, _connActRun: real.act }); }
    return { acted, toasts: [...document.querySelectorAll('#toast-wrap .toast')].map(t => t.textContent) };
  });
  ok(r.acted === 0 && r.toasts.some(t => /may have slept/.test(t)), 'the folder being gone is said in those words', r);
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('a-repository-goes-back-as-a-branch') > 0) process.exitCode = 1;
done();
