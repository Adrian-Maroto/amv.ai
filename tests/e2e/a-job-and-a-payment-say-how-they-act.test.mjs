/* A JOB AND A PAYMENT SAY HOW THEY ACT (Build 17 audit B17-032, B17-033, Nov 21).

   Spending named limits and purchases, and nothing on it said that a
   purchase, the AMV plan and a connected bank are three separate things -
   so a person who had linked a bank could read it as AMV paying from it.
   A Crew job's panel said what it connects to and when, but not whether it
   searches the web, works through an account, or drives websites in AMV's
   browser - which decides what it can touch. And a job written "each
   evening" opened at 8:00 in the morning. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 390, height: 844 }, tab: 'chat', user: { name: 'Ana', email: 'ana@x.com', ini: 'A' } });
const { page, errors } = app;

section('Spending names the three kinds of money apart');
{
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); S.settingsPane = 'spending'; setTab('settings'); });
  await page.waitForSelector('.mf-src', { state: 'attached', timeout: 15000 });
  /* Folded under "How this works" since Nov 27 - read when wanted. */
  await page.click('details.mf-what > summary');
  const r = await page.evaluate(() => [...document.querySelectorAll('.mf-src > div')].map(d => d.innerText.replace(/\s+/g, ' ')));
  ok(r.length === 3, 'three rows', r);
  ok(/store’s own checkout/.test(r[0]) && /never holds or sees it/.test(r[0]), 'a purchase is paid at the store, and AMV never holds the card', r[0]);
  ok(/Billed separately/.test(r[1]), 'the AMV plan is billed apart', r[1]);
  ok(/Read only/.test(r[2]) && /cannot pay from them/.test(r[2]), 'and a connected bank is read only', r[2]);
  await page.click('.mf-src [data-darg="billing"]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => S.tab) === 'billing', 'Billing is one tap away');
}

section('A job says how it acts, before it is switched on');
{
  const r = await page.evaluate(async () => {
    setTab('crew');
    for (let i = 0; i < 100 && !document.querySelector('.cj-card-b'); i++) await new Promise(r => setTimeout(r, 100));
    const say = (id) => { cwPeek(id); const h = document.querySelector('.cwp-how'); const t = h ? h.innerText.replace(/\s+/g, ' ') : null; closeOvr(); return t; };
    const first = document.querySelector('.cj-card-b').dataset.darg;
    return { buy: say('target_buy'), first, firstSays: say(first), firstJob: (() => { const j = _cwFindJob(first); return { needs: j.needs, when: _cwJobWhen(j) }; })() };
  });
  ok(r.buy && /AMV’s browser on your computer/.test(r.buy) && /asks you before paying/.test(r.buy), 'a job that buys says it works in AMV’s browser and asks before paying', r.buy);
  ok(r.firstSays && /How it works/i.test(r.firstSays) && /Runs (with|while)/.test(r.firstSays), 'every job’s panel has the line, with where it runs', r.firstSays);
}

section('"Each evening" opens in the evening');
{
  const r = await page.evaluate(() => {
    const ids = Object.keys(window._cjInboxCalById || {}).filter(k => /_digest$/.test(k));
    const j = ids.length ? window._cjInboxCalById[ids[0]] : null;
    return j ? { id: j.id, desc: j.desc, when: _cwJobWhen(j) } : null;
  });
  ok(r && /evening/i.test(r.desc) && r.when.hour === 18, 'an evening digest opens at 18:00, not 8:00', r);
  const t = await page.evaluate(() => [_cwEveningTpl('Every evening, the stories'), _cwEveningTpl('Each morning, check'), _cwEveningTpl('What is on tonight')]);
  ok(t[0] === true && t[1] === false && t[2] === true, 'and the rule reads the English template it is written from', t);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
