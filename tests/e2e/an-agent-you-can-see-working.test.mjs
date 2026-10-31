/* AN AGENT YOU CAN SEE WORKING - THE PAGE.

   Owner decision #44 (Oct 31): persistent agents, kept out of the way. Crew
   stays one box: nobody sees an Agents section until they keep one, and the
   way to keep one is "Keep as an agent" on a job that has already worked.
   Through the real page and the real Worker (an-agent-works-within-what-it-
   was-given in tests/worker drives the runner): the job is handed to the new
   agent on the server; the agent's card appears with its budget; Running jobs
   says whose job it is; pausing says so; deleting asks first, stops its job
   and the section goes away again. And it fits a phone. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const outbound = makeOutbound();
const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9257', AMV_MODEL_KEY: 'k', CONNECT_KEY: 'c'.repeat(44), MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) }),
});
const L = await bootLive({ env, outbound, port: 9257 });
const { page } = L;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

await page.evaluate(async () => {
  openAuth('signup'); await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Rui'); type('#a-email', 'rui@example.com'); type('#a-pass', 'A-real-Passw0rd!');
  document.getElementById('auth-submit').click(); await __amvSignedIn();
});
await env.AMV_KV.put('ent:rui@example.com', JSON.stringify({ plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} });

const agentsRec = async () => JSON.parse((await env.AMV_KV.get('agents:rui@example.com')) || '{"list":[]}');
const autoRec = async () => JSON.parse((await env.AMV_KV.get('auto:rui@example.com')) || '{"items":[]}');

section('Crew stays one box: no Agents section until one is kept');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => { const el = document.getElementById('mc-agents'); return { there: !!el, hidden: !el || el.hidden, text: el ? el.textContent.trim() : '' }; });
  ok(s.hidden && !s.text, 'nothing about agents is on the screen yet', s);
}

section('A job that has worked offers "Keep as an agent"; keeping it hands the job over');
{
  await page.evaluate(async () => { await _autoApi('/auto/create', { detail: 'Brief me on solar energy news', repeat: 'daily', kind: 'task', notify: 'app', approval: 'require' }); });
  /* It has run once, as the cron would have recorded. */
  const rec = await autoRec(); rec.items.forEach(i => { if (/solar/.test(i.detail)) i.runs = 1; });
  await env.AMV_KV.put('auto:rui@example.com', JSON.stringify(rec));
  await page.evaluate(async () => { try { await _autoRefresh(); } catch (e) {} setTab('crew'); });
  await page.waitForSelector('#mc-sched [data-dact="mcKeepAsAgent"]', { timeout: 20000 });
  ok(true, 'the running job offers to be kept as an agent');
  await page.click('#mc-sched [data-dact="mcKeepAsAgent"]');
  await page.waitForSelector('#ag-name');
  ok(/Brief me/.test(await page.inputValue('#ag-name')), 'the name starts from the job', await page.inputValue('#ag-name'));
  await page.fill('#ag-name', 'Solar scout');
  await page.fill('#ag-budget', '5');
  await page.click('#ag-save');
  await page.waitForFunction(() => document.querySelectorAll('#mc-agents .mc-agent').length === 1, null, { timeout: 15000 });
  const card = await page.evaluate(() => document.querySelector('#mc-agents .mc-agent').textContent);
  ok(/Solar scout/.test(card) && /Brief me on solar energy news/.test(card), 'the card shows the agent and its job', card.slice(0, 220));
  ok(/\$0\.00 of its \$5\.00 monthly budget/.test(card), 'and its month\u2019s spend against its own budget', card);
  const stored = await agentsRec();
  const job = (await autoRec()).items.find(i => /solar/.test(i.detail));
  ok(stored.list.length === 1 && job && job.agent === stored.list[0].id, 'on the server, the job is now the agent\u2019s', { agent: stored.list[0] && stored.list[0].id, job: job && job.agent });
  await page.waitForFunction(() => /Agent: Solar scout/.test(document.getElementById('mc-sched')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => /Agent: Solar scout/.test(document.getElementById('mc-sched').textContent)), 'Running jobs says whose job it is');
  ok(await page.evaluate(() => !document.querySelector('#mc-sched [data-dact="mcKeepAsAgent"]')), 'and no longer offers to keep it - it is kept');
}

section('Pausing says so, and the server holds it');
{
  await page.click('#mc-agents [data-dact="mcAgentPause"]');
  await page.waitForFunction(() => /Paused/.test(document.querySelector('#mc-agents .mc-agent-state')?.textContent || ''), null, { timeout: 15000 });
  ok((await agentsRec()).list[0].paused === true, 'paused on the server');
  ok(await page.evaluate(() => document.querySelector('#mc-agents [data-dact="mcAgentJob"]').disabled), 'and a paused agent cannot be given new work from its card');
}

section('It fits a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const s = document.getElementById('mc-agents'); const r = s.getBoundingClientRect();
    const btns = [...s.querySelectorAll('.mc-agent-acts button')].map(b => b.getBoundingClientRect());
    return { right: r.right, vw: innerWidth, scroll: document.documentElement.scrollWidth, small: btns.filter(b => b.height < 24).length };
  });
  ok(fit.right <= fit.vw + 1 && fit.scroll <= fit.vw + 1, 'nothing runs off the side at 390 pixels', fit);
  ok(fit.small === 0, 'and its buttons are big enough to hit', fit);
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('Saved sign-ins: offered only where they can work, and the card says what it holds');
{
  /* This deployment has no hosted browser, so the switch is not offered -
     one line says why instead. */
  await page.click('#mc-agents .mc-agent [data-dact="mcAgentEdit"]');
  await page.waitForSelector('#ag-name');
  const off = await page.evaluate(() => ({ box: !!document.getElementById('ag-keep'), text: document.querySelector('.ob').textContent }));
  ok(!off.box && /need AMV\u2019s browser/.test(off.text), 'without AMV\u2019s browser the switch is not offered, and it says why', off.box);
  await page.click('#ag-cancel');
  /* An agent already keeping sign-ins (set from elsewhere) shows its sites, and can still be switched off. */
  const id = (await agentsRec()).list[0].id;
  const set = await page.evaluate(async (id) => { try { return await _autoApi('/v1/agents/save', { id, browserKeep: true, browserSites: ['tracker.example.com'] }); } catch (e) { return { err: e.message }; } }, id);
  ok(set && set.agent && set.agent.browser.keep, 'the server keeps the setting', set);
  await page.evaluate(() => mcAgentsReload());
  await page.waitForFunction(() => /tracker\.example\.com/.test(document.querySelector('#mc-agents .mc-agent-si')?.textContent || ''), null, { timeout: 15000 });
  const si = await page.evaluate(() => document.querySelector('#mc-agents .mc-agent-si').textContent);
  ok(/not signed in yet/.test(si) && await page.evaluate(() => !!document.querySelector('#mc-agents [data-dact="mcAgentSignIn"]')),
     'the card lists the site, says it holds no sign-in yet, and offers to sign in for it', si);
  await page.click('#mc-agents .mc-agent [data-dact="mcAgentEdit"]');
  await page.waitForSelector('#ag-keep', { state: 'attached' });
  ok(await page.isChecked('#ag-keep') && /tracker\.example\.com/.test(await page.inputValue('#ag-sites')), 'its edit dialog shows the switch on, with its site');
  await page.click('label.cr-mode-opt:has(#ag-keep)');
  ok(!(await page.isChecked('#ag-keep')), 'the switch is turned off by pressing its label');
  await page.click('#ag-save');
  await page.waitForFunction(() => !document.querySelector('#mc-agents .mc-agent-si'), null, { timeout: 15000 });
  ok((await agentsRec()).list[0].browser.keep === false, 'switching it off is saved, and the card no longer lists sign-ins');
}

section('Deleting asks first, stops its job and takes the card away');
{
  await page.click('#mc-agents [data-dact="mcAgentDelete"]');
  await page.waitForSelector('#modal-ok');
  ok(/Its jobs stop running/.test(await page.textContent('.ov, #ovr, body')), 'it says what deleting does');
  await page.click('#modal-ok');
  await page.waitForFunction(() => { const el = document.getElementById('mc-agents'); return !el || el.hidden; }, null, { timeout: 15000 });
  ok(true, 'with no agents left, the section goes away again');
  const job = (await autoRec()).items.find(i => /solar/.test(i.detail));
  ok(job && job.active === false && /agent was deleted/.test(job.lastError || ''), 'its job is stopped and says why', job);
}

section('No JavaScript errors');
ok(L.errors.length === 0, 'zero uncaught page errors', L.errors.slice(0, 3));

await L.close();
if (report('an-agent-you-can-see-working') > 0) process.exitCode = 1;
done();
