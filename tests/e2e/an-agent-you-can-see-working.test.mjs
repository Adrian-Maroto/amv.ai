/* AN AGENT YOU CAN SEE WORKING - THE PAGE.

   Oct 26 audit: persistent named Agents. Through the real page and the real
   Worker (an-agent-works-within-what-it-was-given in tests/worker drives the
   runner): Crew shows an Agents section; a new agent is created from it and
   read back from the server; it is given a job, which appears on its card and
   in Running jobs with its name; pausing says so; deleting asks first, stops
   its job and takes the card away. And the section fits a phone. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9257', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: { idFromName: n => n, get: n => ({ async fetch(_u, init) {
    const b = JSON.parse(init.body); const cur = vals.get(n) || 0; const r = o => new Response(JSON.stringify(o));
    if (b.op === 'reserve') { vals.set(n, cur + b.amount); return r({ allowed: true, value: vals.get(n) }); }
    if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return r({ value: vals.get(n) }); }
    if (b.op === 'get') return r({ value: cur });
    return r({ allowed: true, value: cur });
  } }) },
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

section('Crew has an Agents section, empty and saying what an agent is for');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForFunction(() => /No agents yet/.test(document.getElementById('mc-agents')?.textContent || ''), null, { timeout: 20000 });
  ok(true, 'the section loads from the server and says how to start');
}

section('A new agent is made from it and read back from the server');
{
  await page.click('#mc-agents [data-dact="mcAgentEdit"]');
  await page.waitForSelector('#ag-name');
  await page.fill('#ag-name', 'Solar scout');
  await page.fill('#ag-role', 'Reads solar energy news');
  await page.fill('#ag-instr', 'Always lead with policy changes in Spain.');
  await page.fill('#ag-budget', '5');
  await page.click('#ag-save');
  await page.waitForFunction(() => document.querySelectorAll('#mc-agents .mc-agent').length === 1, null, { timeout: 15000 });
  const card = await page.evaluate(() => document.querySelector('#mc-agents .mc-agent').textContent);
  ok(/Solar scout/.test(card) && /Reads solar energy news/.test(card), 'the card shows its name and role', card.slice(0, 200));
  ok(/\$0\.00 of its \$5\.00 monthly budget/.test(card), 'and its month’s spend against its own budget', card);
  const stored = await agentsRec();
  ok(stored.list.length === 1 && stored.list[0].instructions === 'Always lead with policy changes in Spain.', 'the server holds exactly what was typed', stored.list[0]);
}

section('Given a job, it is on the card and in Running jobs with its name');
{
  await page.click('#mc-agents [data-dact="mcAgentJob"]');
  await page.waitForSelector('#ag-job');
  await page.click('#ag-save');
  ok(/Say what the job is/.test(await page.textContent('#ag-msg')), 'an empty job is refused on the spot');
  await page.fill('#ag-job', 'Brief me on solar energy news');
  await page.click('#ag-save');
  await page.waitForFunction(() => /Brief me on solar energy news/.test(document.querySelector('#mc-agents .mc-agent')?.textContent || ''), null, { timeout: 15000 });
  const job = (await autoRec()).items.find(i => /solar/.test(i.detail));
  const id = (await agentsRec()).list[0].id;
  ok(job && job.agent === id && job.approval === 'require', 'the server job belongs to the agent and asks first by default', job);
  await page.waitForFunction(() => /Agent: Solar scout/.test(document.getElementById('mc-sched')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => /Agent: Solar scout/.test(document.getElementById('mc-sched').textContent)), 'Running jobs says whose job it is');
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

section('Deleting asks first, stops its job and takes the card away');
{
  await page.click('#mc-agents [data-dact="mcAgentDelete"]');
  await page.waitForSelector('#modal-ok');
  ok(/Its jobs stop running/.test(await page.textContent('.ov, #ovr, body')), 'it says what deleting does');
  await page.click('#modal-ok');
  await page.waitForFunction(() => /No agents yet/.test(document.getElementById('mc-agents')?.textContent || ''), null, { timeout: 15000 });
  const job = (await autoRec()).items.find(i => /solar/.test(i.detail));
  ok(job && job.active === false && /agent was deleted/.test(job.lastError || ''), 'its job is stopped and says why', job);
}

section('Companion is offered, and set up from the same parts as any agent');
{
  await page.waitForSelector('#mc-agents [data-dact="mcCompanionSetup"]', { timeout: 15000 });
  await page.click('#mc-agents [data-dact="mcCompanionSetup"]');
  await page.waitForSelector('input[name="cp-level"]');
  await page.check('input[name="cp-level"][value="helpful"]');
  await page.selectOption('#cp-hour', '7');
  await page.click('#ag-save');
  await page.waitForFunction(() => [...document.querySelectorAll('#mc-agents .mc-agent h4')].some(h => h.textContent === 'Companion'), null, { timeout: 15000 });
  const agent = (await agentsRec()).list.find(a => a.name === 'Companion' && !a.deleted);
  const job = (await autoRec()).items.find(i => agent && i.agent === agent.id);
  ok(agent && /never sent|has not been sent/.test(agent.instructions), 'a Companion agent exists, told its drafts are never sent', agent && agent.instructions.slice(0, 120));
  ok(job && job.repeat === 'daily' && job.sched && job.sched.hour === 7, 'with a daily brief at the hour chosen', job && job.sched);
  ok(job && job.approval === 'require' && job.uses.includes('mail.read') && job.uses.includes('calendar.read'), 'Helpful: the brief waits for approval, and reads only what was ticked', job && [job.approval, job.uses]);
  ok(await page.evaluate(() => !document.querySelector('#mc-agents [data-dact="mcCompanionSetup"]')), 'and it is no longer offered once it exists');
}

section('No JavaScript errors');
ok(L.errors.length === 0, 'zero uncaught page errors', L.errors.slice(0, 3));

await L.close();
if (report('an-agent-you-can-see-working') > 0) process.exitCode = 1;
done();
