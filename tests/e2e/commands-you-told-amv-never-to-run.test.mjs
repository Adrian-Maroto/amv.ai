/* COMMANDS YOU TOLD AMV NEVER TO RUN, IT NEVER RUNS.

   The bridge refuses the catastrophic shapes on its own - rm -rf, sudo, a
   force push. What it cannot know is what THIS person never wants run on
   their computer: `git push` because they review first, `npm publish`, a
   deploy script. So the person writes their own list, on the computer card,
   and every command AMV starts - chat, Build, a background job - is checked
   against it at the one place they all pass through before the bridge.

   Checked here by driving it:
   - the list is saved, cleaned, bounded, and survives a reload;
   - a listed command is refused without ever reaching the computer, in its
     plain form and dressed up (a path, a chained command, `bash -c`, flags
     between the words, capital letters, .exe);
   - a command that only looks similar still runs;
   - chat refuses it BEFORE asking permission, and says why to the model;
   - Build's step reads as refused, naming the rule;
   - the model is told the list up front, in the tool's own description;
   - the card shows the list and saves edits.

   The bridge is stood in for at `fetch`, on its real address. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
const { page, errors } = app;

const stub = () => page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  Object.assign(BRIDGE, { connected: true, port: 45672, token: 'tok', folder: 'proj', fence: 'on' });
  window.__execs = [];
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('http://127.0.0.1:45672/')) return real(url, init);
    const body = JSON.parse((init && init.body) || '{}');
    const reply = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/amv-bridge/exec')) { window.__execs.push(body.command); return reply({ exitCode: 0, ms: 5, stdout: 'ran', stderr: '' }); }
    return reply({ ok: true });
  };
});
await stub();

section('The list is saved, cleaned and bounded');
{
  const r = await page.evaluate(() => {
    neverRunSave('  git   push \n\nnpm publish\nGIT PUSH\n' + 'x'.repeat(500) + '\n./deploy.sh');
    return neverRunRules();
  });
  ok(JSON.stringify(r.slice(0, 3)) === JSON.stringify(['git push', 'npm publish', 'x'.repeat(120)]) && r[3] === './deploy.sh' && r.length === 4,
     'spaces collapsed, blanks and repeats dropped, each rule capped', r);
  const many = await page.evaluate(() => { neverRunSave(Array.from({ length: 80 }, (_, i) => 'cmd' + i).join('\n')); return neverRunRules().length; });
  ok(many === 50, 'at most fifty rules', many);
  await page.evaluate(() => neverRunSave('git push\nnpm publish\n./deploy.sh\nrm'));
}

section('A listed command never reaches the computer, however it is written');
{
  const tries = ['git push', 'git push origin main', '/usr/bin/git push', 'npm test && git push', 'bash -c "git push"',
                 'git -C sub --no-pager push', 'GIT PUSH', 'git.exe push', 'echo hi; npm publish --access public',
                 'sh ./deploy.sh', 'cd app && ./deploy.sh', 'rm notes.txt', '$(rm notes.txt)'];
  const r = await page.evaluate(async (tries) => {
    window.__execs = [];
    const out = [];
    for (const c of tries) out.push(await runBridgeTool('run_command', { command: c }));
    return { out, execs: window.__execs.slice() };
  }, tries);
  ok(r.execs.length === 0, 'none of them was sent to the bridge', r.execs);
  ok(r.out.every(o => o.ok === false && /never to run/.test(o.error || '')), 'each answer says it was refused by the person’s own list', r.out.map(o => o.error));
  ok(/"git push"/.test(r.out[1].error) && /"npm publish"/.test(r.out[8].error), 'naming the rule that matched', [r.out[1].error, r.out[8].error]);
}

section('A command that only looks similar still runs');
{
  const r = await page.evaluate(async () => {
    window.__execs = [];
    for (const c of ['git pull', 'git status', 'npm test', 'git commit -m "wip"', 'cat deploy.sh.bak', 'npm run format'])
      await runBridgeTool('run_command', { command: c });
    return window.__execs.slice();
  });
  ok(r.length === 6, 'all six ran', r);
}

section('Chat refuses before asking, and tells the model why');
{
  const r = await page.evaluate(async () => {
    window.__asked = 0;
    const realConfirm = _confirmModelTool;
    window._confirmModelTool = async () => { window.__asked++; return true; };
    const why = neverRunRefusal('run_command', { command: 'git push' });
    const fine = neverRunRefusal('run_command', { command: 'git status' });
    const other = neverRunRefusal('read_file', { path: 'git push' });
    window._confirmModelTool = realConfirm;
    return { why, fine, other };
  });
  ok(/never to run "git push"/.test(r.why) && /Do not try another way/.test(r.why), 'the refusal names the rule and tells the model not to work around it', r.why);
  ok(r.fine === '' && r.other === '', 'nothing is refused that is not on the list, and only commands are checked', r);
}

section('The other surfaces refuse before asking too');
{
  /* runAgentic is the loop every non-chat surface shares. The model's turn is
     stood in for, so the run_command it asks for goes through the surface's
     own runTool - the part that asks permission. */
  const r = await page.evaluate(async () => {
    window.__asked = 0; window.__execs = [];
    const realLoop = aiAgentLoop, realAsk = _confirmModelTool;
    window._confirmModelTool = async () => { window.__asked++; return true; };
    let got = null;
    window.aiAgentLoop = async (opts) => { got = await opts.runTool('run_command', { command: 'npm publish' }); return { text: '', content: [] }; };
    try { await runAgentic('code', 'publish it', {}); } catch (e) {}
    window.aiAgentLoop = realLoop; window._confirmModelTool = realAsk;
    return { got, asked: window.__asked, execs: window.__execs.slice() };
  });
  ok(r.asked === 0, 'nobody is asked to approve it', r);
  ok(r.execs.length === 0 && r.got && r.got.ok === false && /never to run "npm publish"/.test(r.got.text), 'and the model is told why', r.got);
}

section('Build’s step reads as refused');
{
  const r = await page.evaluate(async () => {
    window.__execs = [];
    const step = {};
    const out = await _agentRunTool('run_command', { command: 'git push' }, step);
    return { out, execs: window.__execs.slice() };
  });
  ok(r.execs.length === 0 && r.out.ok === false && /never to run "git push"/.test(r.out.text), 'not run, and the step says which rule', r.out);
}

section('The model is told the list up front');
{
  const d = await page.evaluate(() => bridgeToolsOffered().find(t => t.name === 'run_command').description);
  ok(/never to run/.test(d) && /git push/.test(d) && /npm publish/.test(d), 'run_command’s description names the rules', d);
  const plain = await page.evaluate(() => { const keep = neverRunRules().join('\n'); neverRunSave(''); const d = bridgeToolsOffered().find(t => t.name === 'run_command').description; neverRunSave(keep); return d; });
  ok(!/never to run/.test(plain), 'and says nothing when there is no list', plain);
}

section('The card shows the list and saves edits');
{
  await page.evaluate(() => { document.getElementById('cookie-consent-banner')?.remove(); setTab('integrations'); });
  await page.click('details.conn-machine > summary', { timeout: 8000 });
  await page.waitForSelector('#nr-list', { state: 'visible' });
  const shown = await page.$eval('#nr-list', el => el.value);
  ok(/git push/.test(shown) && /npm publish/.test(shown), 'the saved rules are in the box', shown);
  await page.fill('#nr-list', 'git push\nterraform apply');
  await page.click('#nr-save');
  const after = await page.evaluate(() => ({ rules: neverRunRules(), msg: document.getElementById('nr-msg').textContent }));
  ok(after.rules.join('|') === 'git push|terraform apply' && /2 commands/.test(after.msg), 'saved, and it says how many', after);
  const box = await page.$eval('#nr-list', el => { const r = el.getBoundingClientRect(); return { w: r.width, fits: r.right <= innerWidth }; });
  ok(box.fits, 'the box fits a phone', box);
}

section('It survives a reload');
{
  await page.reload();
  await page.waitForFunction(() => typeof neverRunRules === 'function');
  const r = await page.evaluate(() => neverRunRules());
  ok(r.join('|') === 'git push|terraform apply', 'the list is still there', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('commands-you-told-amv-never-to-run') > 0) process.exitCode = 1;
done();
