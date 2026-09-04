/* THE LOOP A BUILD SURFACE HAS TO CLOSE: it wrote the code, now put it
   somewhere real. Downloading a zip is not that.

   Pushing is AMV writing to somebody's repository, so the confirmation is
   the whole feature and not decoration around it. THE FAILURE THIS GUARDS is
   a "Push to GitHub" button that pushes: a dialog that appears after the
   fact, or a confirm step that says "3 files" without naming them, is one
   people press once and then stop trusting.

   So every assertion below reads what was SENT. The dialog must list every
   path and the branch before anything leaves, cancelling must send nothing,
   and a disconnected account must be told which of the three things is
   actually wrong rather than a flat "not connected". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* Captures every call the flow makes to the server, so "it did not push" is
   a fact. Returns whatever the test queued as answers. */
const arm = () => page.evaluate(() => {
  window.__sent = [];
  window.__ghConn = { ok: true };
  window._ghConnection = async () => window.__ghConn;
  window._connActRun = async (action, args) => {
    window.__sent.push({ action, args });
    if (action === 'github.repos') {
      return [{ full: 'me/site', private: false, branch: 'main' },
              { full: 'me/other', private: true, branch: 'trunk' }];
    }
    if (action === 'github.push') {
      return { repo: args.repo, branch: args.branch, base: args.base,
               files: args.files.length, commit: 'abc1234',
               url: 'https://github.com/' + args.repo + '/tree/' + args.branch };
    }
    if (action === 'github.pr') return { number: 12, url: 'https://github.com/x/y/pull/12' };
    return null;
  };
});

await page.evaluate(async () => {
  setTab('dev');
  await new Promise(s => setTimeout(s, 400));
  _DEV.project = {}; _DEV.log = [{ role: 'sys', text: 'x' }];
  _devSetFile('index.html', '<h1>hi</h1>\n<p>two</p>', 'html');
  _devSetFile('app.js', 'console.log(1)', 'js');
  _devRenderLog();
});

section('There is a way to push at all, on the surface that built the code');
{
  const b = await page.evaluate(() => {
    const el = document.getElementById('dev-github');
    return { present: !!el, title: el ? el.title : '', inBar: !!(el && el.closest('.rb')) };
  });
  ok(b.present, 'Dev has a GitHub control', b.present);
  ok(/push/i.test(b.title), 'that says what it does', b.title);
  ok(b.inBar, 'beside the other things you do with a finished result', b.inBar);
}

section('Not connected is four different problems, and it says which');
{
  const msgs = await page.evaluate(() => ({
    engine: _ghNotReadyMessage('engine'),
    none: _ghNotReadyMessage('none'),
    scope: _ghNotReadyMessage('scope'),
    unconfigured: _ghNotReadyMessage('unconfigured'),
  }));
  ok(/engine/i.test(msgs.engine), 'no backend says so', msgs.engine.slice(0, 50));
  ok(/Connect GitHub/i.test(msgs.none), 'nothing connected sends you to connect it', msgs.none.slice(0, 50));
  ok(/not for writing code|permission/i.test(msgs.scope),
     'and connected-without-the-permission is its own answer, not "not connected"',
     msgs.scope.slice(0, 70));
  ok(/operator/i.test(msgs.unconfigured),
     'and a deployment with no GitHub credentials says so, rather than sending somebody to a button that cannot work',
     msgs.unconfigured.slice(0, 70));
  ok(new Set(Object.values(msgs)).size === 4,
     'four problems, four sentences - collapsing them sends people to the wrong fix',
     Object.values(msgs).length);
}

section('It reads the shape the server actually returns');
{
  /* The seam. The first version of this read `connections` and `caps` - names
     that exist nowhere in the response - so it found nothing and told
     everybody they were not connected, forever. This drives the real function
     against the real response shape. */
  const r = await page.evaluate(async () => {
    const saved = window.AMV_API.connectList;
    const withList = async (payload) => {
      window.AMV_API.connectList = async () => payload;
      /* live is a getter off base, so it is made true the way the app does. */
      AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
      return await window.__realGhConnection();
    };
    window.__realGhConnection = window.__realGhConnection || _ghConnection;
    const out = {
      connected: await withList({ ok: true, configured: true,
        items: [{ id: 'g1', provider: 'github', scopes: ['repo.read', 'code.write'] }],
        providers: [{ id: 'github', ready: true }] }),
      readOnly: await withList({ ok: true, configured: true,
        items: [{ id: 'g1', provider: 'github', scopes: ['repo.read'] }],
        providers: [{ id: 'github', ready: true }] }),
      none: await withList({ ok: true, configured: true, items: [],
        providers: [{ id: 'github', ready: true }] }),
      unconfigured: await withList({ ok: true, configured: true, items: [],
        providers: [{ id: 'github', ready: false }] }),
    };
    window.AMV_API.connectList = saved;
    return out;
  });
  ok(r.connected.ok === true,
     'a GitHub connection carrying code.write is recognised', r.connected);
  ok(r.readOnly.ok === false && r.readOnly.why === 'scope',
     'a read-only one is short of the permission, not missing', r.readOnly);
  ok(r.none.why === 'none', 'no connection at all says so', r.none);
  ok(r.unconfigured.why === 'unconfigured',
     'and a provider the deployment has no credentials for is the operator’s problem',
     r.unconfigured);
}

section('A connection without the write permission pushes nothing');
{
  await arm();
  const r = await page.evaluate(async () => {
    window.__ghConn = { ok: false, why: 'scope' };
    await _devPushToGitHub();
    await new Promise(s => setTimeout(s, 250));
    return { sent: window.__sent.length, dialog: !!document.getElementById('ghp-bg') };
  });
  ok(r.sent === 0, 'nothing was asked of GitHub', r.sent);
  ok(!r.dialog, 'and no dialog was opened to imply otherwise', r.dialog);
}

section('The confirmation lists every file and names the branch');
{
  await arm();
  const d = await page.evaluate(async () => {
    _devPushToGitHub();
    await new Promise(s => setTimeout(s, 300));
    /* First the repository picker. */
    const repos = [...document.querySelectorAll('[data-ghr]')].map(b => b.textContent);
    document.querySelector('[data-ghr="0"]').click();
    await new Promise(s => setTimeout(s, 300));
    const box = document.querySelector('.ghp-ob');
    return {
      repos,
      sentSoFar: window.__sent.map(s => s.action),
      title: box ? box.querySelector('h2').textContent : '',
      files: box ? [...box.querySelectorAll('.ghp-p')].map(e => e.textContent) : [],
      counts: box ? [...box.querySelectorAll('.ghp-n')].map(e => e.textContent) : [],
      meta: box ? box.querySelector('.ghp-meta').textContent.replace(/\s+/g, ' ') : '',
      lead: box ? box.querySelector('.ob-sub').textContent : '',
    };
  });
  ok(d.repos.length === 2, 'the repositories you can write to are offered', d.repos.length);
  ok(d.sentSoFar.join(',') === 'github.repos',
     'and reading them is the only thing done so far', d.sentSoFar);
  ok(/me\/site/.test(d.title), 'the confirmation names the repository', d.title);
  ok(d.files.join(',') === 'app.js,index.html',
     'and lists every file that would be sent', d.files);
  ok(d.counts.some(c => /2 lines/.test(c)),
     'with how big each one is', d.counts);
  ok(/branch amv\//.test(d.meta) && /off main/.test(d.meta),
     'the new branch and the base it comes off are both shown', d.meta);
  ok(/not touched/i.test(d.lead) && /nothing is merged/i.test(d.lead),
     'and it says plainly that the default branch is safe', d.lead);
}

section('Cancelling sends nothing');
{
  const r = await page.evaluate(async () => {
    document.getElementById('ghp-no').click();
    await new Promise(s => setTimeout(s, 250));
    return { actions: window.__sent.map(s => s.action), open: !!document.getElementById('ghp-bg') };
  });
  ok(!r.actions.includes('github.push'), 'no push was made', r.actions);
  ok(!r.open, 'and the dialog is gone', r.open);
}

section('Confirming pushes exactly what was shown');
{
  await arm();
  const r = await page.evaluate(async () => {
    _devPushToGitHub();
    await new Promise(s => setTimeout(s, 300));
    document.querySelector('[data-ghr="0"]').click();
    await new Promise(s => setTimeout(s, 300));
    const shown = [...document.querySelectorAll('.ghp-p')].map(e => e.textContent);
    document.getElementById('ghp-go').click();
    await new Promise(s => setTimeout(s, 500));
    const push = window.__sent.find(s => s.action === 'github.push');
    return { shown, args: push ? push.args : null,
             card: !!document.querySelector('#dev-log .ghd'),
             link: (document.querySelector('#dev-log .ghd-l') || {}).textContent || '' };
  });
  ok(!!r.args, 'the push happens on confirm', !!r.args);
  ok(r.args.files.map(f => f.path).sort().join(',') === r.shown.sort().join(','),
     'sending exactly the files the dialog listed, no more', r.args.files.map(f => f.path));
  ok(r.args.repo === 'me/site' && r.args.base === 'main',
     'to the repository and base that were shown', [r.args.repo, r.args.base]);
  ok(/^amv\//.test(r.args.branch) && r.args.branch !== 'main',
     'onto a new branch, never the base', r.args.branch);
  ok(r.args.files.find(f => f.path === 'app.js').content === 'console.log(1)',
     'with the real file contents', true);
  ok(r.card && /me\/site/.test(r.link),
     'and the turn leaves a card pointing at what was pushed', r.link);
}

section('The pull request is a second decision, not part of the push');
{
  /* Pushing a branch and putting it in front of other people are two
     different acts. Doing the second automatically is how somebody ends up
     having opened a PR they were not ready for. */
  const r = await page.evaluate(async () => {
    const beforePR = window.__sent.filter(s => s.action === 'github.pr').length;
    document.querySelector('#dev-log .ghd-pr').click();
    await new Promise(s => setTimeout(s, 400));
    const pr = window.__sent.find(s => s.action === 'github.pr');
    return { beforePR, args: pr ? pr.args : null,
             disabled: document.querySelector('#dev-log .ghd-pr') ? document.querySelector('#dev-log .ghd-pr').disabled : null };
  });
  ok(r.beforePR === 0, 'the push alone opened no pull request', r.beforePR);
  ok(!!r.args, 'and the button on the card opens one', !!r.args);
  ok(r.args.head !== r.args.base && r.args.base === 'main',
     'from the pushed branch onto the base', [r.args.head, r.args.base]);
}

section('The two old GitHub tools no longer reach for a browser token');
{
  /* They read `amv_github` out of localStorage - a key no connect flow has
     ever written - so they threw "GitHub not connected" at accounts that
     were. And a repo-scoped credential in localStorage is one injected
     script away from being somebody else's. */
  const r = await page.evaluate(() => ({
    list: String(INTEGRATION_ACTIONS.github_list_issues.run),
    create: String(INTEGRATION_ACTIONS.github_create_issue.run),
  }));
  ok(!/amv_github/.test(r.list) && !/amv_github/.test(r.create),
     'neither reads a token out of this browser any more', [r.list.slice(0, 60), r.create.slice(0, 60)]);
  ok(/github\.issues/.test(r.list) && /github\.issue\.create/.test(r.create),
     'both go through the server, where the token actually lives', true);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('pushing-code-asks-first') > 0) process.exitCode = 1;
done();
