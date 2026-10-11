/* YOUR RULES FOR YOUR COMPUTER.

   Beyond each turn's consent, somebody can tell AMV how to work on their
   machine - and a team's owner or admin can tell everybody's AMV:
   - never run (the computer card's own list, one store);
   - ask first, even in a Build turn consented to as a whole;
   - never change these files - in chat and Build, said to the model up
     front and refused at the door;
   - after every file AMV changes, run a check, and hand its result back;
   - before AMV says it is done, run a check - and if it fails, AMV is told
     and keeps going (twice at most);
   - a team's rules apply on top of a member's own, and the refusal says so.

   The bridge is stood in for at `fetch`, on its real address; the engine is
   stood in for at aiAgentLoop's own fetch. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' } });
const { page, errors } = app;

await page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  Object.assign(BRIDGE, { connected: true, port: 45672, token: 'tok', folder: 'proj', fence: 'on' });
  window.__execs = []; window.__writes = []; window.__exit = {};
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('http://127.0.0.1:45672/')) return real(url, init);
    const body = JSON.parse((init && init.body) || '{}');
    const reply = (d, s) => new Response(JSON.stringify(d), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/amv-bridge/exec')) { window.__execs.push(body.command); const x = window.__exit[body.command] || 0; return reply({ exitCode: x, ms: 5, stdout: x ? 'lint: 2 errors' : 'ok', stderr: '' }); }
    if (u.endsWith('/amv-bridge/write')) { window.__writes.push(body.path); return reply({ ok: true, path: body.path, bytes: String(body.content || '').length }); }
    if (u.endsWith('/amv-bridge/read')) return reply({ error: 'not_found' }, 404);
    return reply({ ok: true });
  };
});

section('The rules are written in Settings, and saved where AMV reads them');
{
  await page.evaluate(() => goSettings('skills'));
  await page.waitForSelector('#rl-save', { timeout: 15000 });
  await page.fill('#rl-block', 'npm publish');
  await page.fill('#rl-ask', 'git commit');
  await page.fill('#rl-protect', '.env\nmigrations/**');
  await page.fill('#rl-afterWrite', 'npm run lint');
  await page.fill('#rl-onFinish', 'npm test');
  await page.click('#rl-save');
  const r = await page.evaluate(() => ({ never: neverRunRules(), rules: _agentRules(), at: loadStr('amv_profile_at') }));
  ok(r.never.includes('npm publish'), 'never-run goes to the computer card’s own list', r.never);
  ok(r.rules.ask.join() === 'git commit' && r.rules.protect.join() === '.env,migrations/**' && r.rules.afterWrite.join() === 'npm run lint' && r.rules.onFinish.join() === 'npm test',
     'the rest are what AMV reads', r.rules);
  ok(+r.at > 0, 'and they travel with the profile to the person’s other devices', r.at);
  /* The box is one line, so the page cannot send a second command - but the
     rules are checked as data too, the way the server checks a team's. */
  const bad = await page.evaluate(() => ({ two: _rulesClean({ afterWrite: 'npm test\nrm -rf /' }).error || '', long: _rulesClean({ ask: ['x'.repeat(121)] }).error || '' }));
  ok(/one command on one line/.test(bad.two) && /under 120/.test(bad.long), 'a check with a second line hidden in it, or an over-long rule, is refused', bad);
}

section('A protected file is never written - in chat or in Build - and the model is told up front');
{
  const r = await page.evaluate(async () => {
    window.__writes = [];
    const a = await runBridgeTool('write_file', { path: 'config/.env', content: 'x' });
    const b = await runBridgeTool('write_file', { path: 'migrations/2024/001.sql', content: 'x' });
    const c = await runBridgeTool('write_file', { path: 'src/app.js', content: 'x' });
    const desc = bridgeToolsOffered().find(t => t.name === 'write_file').description;
    return { a, b, c, writes: window.__writes.slice(), desc };
  });
  ok(r.a.ok === false && /\.env/.test(r.a.error) && r.b.ok === false, '.env anywhere, and anything under migrations/, is refused', [r.a.error, r.b.error]);
  ok(r.writes.join() === 'src/app.js', 'only the unprotected file reached the computer', r.writes);
  const odd = await page.evaluate(() => ({
    hits: ['/home/me/proj/migrations/2024/001.sql', 'src/../migrations/x.sql', './/config//.env', 'C:\\proj\\.env', 'MIGRATIONS/a.sql']
      .map(p => _rulePathHit(p, ['.env', 'migrations/**'])),
    misses: ['src/old-migrations/x.sql', 'src/migrations.txt', 'env', 'src/app.js', 'migrations/../src/app.js']
      .map(p => _rulePathHit(p, ['.env', 'migrations/**'])),
  }));
  ok(odd.hits.every(Boolean), 'a protected file is still protected by its full path, a roundabout path, or a Windows one', odd.hits);
  ok(odd.misses.every(h => h === ''), 'and nothing that merely looks similar is caught', odd.misses);
  ok(/protected these/.test(r.desc) && /migrations\/\*\*/.test(r.desc), 'and write_file tells the model which files before it tries', r.desc.slice(-120));
}

section('Build: ask first, a check after each change, and a finishing check that keeps it going');
{
  const r = await page.evaluate(async () => {
    window.__execs = []; window.__exit = { 'npm test': 1 };
    _AGENT.before = {}; _AGENT.after = {}; _AGENT.created = {}; _AGENT.seen = {}; _AGENT.steps = []; _AGENT.hookRuns = 0;
    /* Asked first: the person says no. */
    const realModal = window._showModalAsync; let asked = '';
    window._showModalAsync = async (o) => { asked = o.body; return false; };
    const commit = await _agentRunTool('run_command', { command: 'git add . && git commit -m wip' }, {});
    window._showModalAsync = realModal;
    /* A write, followed by the person's lint. */
    const wrote = await _agentRunTool('write_file', { path: 'src/new.js', content: 'let x' }, {});
    /* A protected file is refused before Build reads or records it, so it is
       never listed as changed and never offered to Undo. */
    const prot = await _agentRunTool('write_file', { path: 'config/.env', content: 'x' }, {});
    const protSeen = !!(_AGENT.seen['config/.env'] || _AGENT.created['config/.env'] || 'config/.env' in _AGENT.before);
    /* The finishing check fails, so the engine is told to keep going. */
    const end1 = await _agentBeforeEnd();
    window.__exit = {};
    const end2 = await _agentBeforeEnd();
    return { commit, asked, wrote, prot, protSeen, end1, end2, execs: window.__execs.slice(), steps: _AGENT.steps.filter(s => s.hook).map(s => s.input.command) };
  });
  ok(/git commit/.test(r.asked) && r.commit.ok === false && /chose not to run/.test(r.commit.text), 'a command the person said to ask about is asked about, and "no" holds', r.commit.text);
  ok(!r.execs.some(c => /git commit/.test(c)), 'and it never reached the computer', r.execs);
  ok(/Wrote src\/new\.js/.test(r.wrote.text) && /npm run lint/.test(r.wrote.text) && /passed/.test(r.wrote.text), 'after the write, the person’s check ran and its result went back to the engine', r.wrote.text);
  ok(r.prot.ok === false && /protects/.test(r.prot.text) && !r.protSeen, 'a protected file is refused in Build before it is read, so Undo never touches it', { text: r.prot.text, seen: r.protSeen });
  ok(/npm test/.test(r.end1) && /FAILED/.test(r.end1) && /Fix what it reports/.test(r.end1), 'a failing finishing check is handed back as what to do next', r.end1);
  ok(r.end2 === '', 'and once it passes, the turn may end', r.end2);
  ok(r.steps.join('|') === 'npm run lint|npm test|npm test', 'each check shows in the step list', r.steps);
}

section('The loop honours the finishing check, at most twice');
{
  const r = await page.evaluate(async () => {
    let calls = 0;
    const api = window.AMV_API, prevBase = localStorage.getItem('amv_api_base'), prevRestoring = api._restoring;
    localStorage.setItem('amv_api_base', 'https://stub.invalid'); api._restoring = true;
    const realFetch = window.fetchDeadline, realRead = window._aiReadStream;
    window.fetchDeadline = async () => ({ ok: true, headers: { get: () => '' } });
    window._aiReadStream = async () => { calls++; return { content: [{ type: 'text', text: 'Done ' + calls }], stop_reason: 'end_turn', usage: {} }; };
    let ends = 0;
    let out;
    try { out = await aiAgentLoop({ prompt: 'do it', tools: [], runTool: async () => ({ ok: true, text: '' }), beforeEnd: async () => { ends++; return 'Your finishing check failed. Fix it.'; } }); }
    catch (e) { out = { err: String(e && e.message || e) }; }
    window.fetchDeadline = realFetch; window._aiReadStream = realRead; api._restoring = prevRestoring;
    if (prevBase === null) localStorage.removeItem('amv_api_base'); else localStorage.setItem('amv_api_base', prevBase);
    return { calls, ends, why: out.why, err: out.err };
  });
  ok(!r.err, 'the loop runs with a stand-in engine', r.err);
  ok(r.ends === 2 && r.calls === 3 && r.why === 'done', 'a failing check sends it back to work twice, then it stops rather than loop for ever', r);
}

section('A team’s rules apply on top, and say whose they are');
{
  const r = await page.evaluate(async () => {
    window.__execs = []; window.__writes = [];
    window.AMVTeam._cache = { name: 'Acme', members: [], policy: { agentRules: { block: ['terraform apply'], protect: ['secrets/*'] } } };
    const cmd = await runBridgeTool('run_command', { command: 'cd infra && terraform apply -auto-approve' });
    const file = await runBridgeTool('write_file', { path: 'secrets/key.pem', content: 'x' });
    const mine = await runBridgeTool('run_command', { command: 'npm publish' });
    window.AMVTeam._cache = null;
    return { cmd, file, mine, execs: window.__execs.slice(), writes: window.__writes.slice() };
  });
  ok(r.cmd.ok === false && /team/.test(r.cmd.error) && /terraform apply/.test(r.cmd.error), 'the team’s never-run is refused, and says it is the team’s', r.cmd.error);
  ok(r.file.ok === false && r.writes.length === 0, 'the team’s protected file is not written', r.file);
  ok(r.mine.ok === false && !/team/.test(r.mine.error), 'the person’s own rule still holds, in their name', r.mine.error);
  ok(r.execs.length === 0, 'none of it reached the computer', r.execs);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('your-rules-for-your-computer') > 0) process.exitCode = 1;
done();
