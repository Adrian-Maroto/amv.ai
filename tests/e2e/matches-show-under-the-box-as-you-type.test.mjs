/* MATCHES SHOW UNDER THE BOX AS YOU TYPE (Nov 17, the owner: "as you type,
   things start showing up like a little tab below - the way ChatGPT and
   Claude do it. Don't make it so you have to type the full thing").

   For Crew's jobs, Tasks and Integrations' apps:
     · part of a word is enough, and the list appears without pressing Enter;
     · it is a real combobox (role, expanded, the highlighted option);
     · arrows and Enter pick, Escape closes, a click picks;
     · picking does that screen's thing - opens the job, starts the task,
       puts the app's row on the page. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
const list = () => page.evaluate(() => { const l = document.querySelector('.ta-list'); return l ? [...l.querySelectorAll('.ta-opt .ta-l')].map(x => x.textContent) : null; });
const combo = (sel) => page.evaluate((sel) => { const i = document.querySelector(sel); return { role: i.getAttribute('role'), exp: i.getAttribute('aria-expanded'), act: i.getAttribute('aria-activedescendant') }; }, sel);

section('Crew: part of a word, and the jobs are there');
{
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
  await page.waitForSelector('#cx-q', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click('#cx-q');
  await page.keyboard.type('new', { delay: 30 });
  await page.waitForTimeout(250);
  const l = await list();
  ok(l && l.length > 0 && l.length <= 8, 'a short list appears under the box, without Enter', l);
  const subs = await page.evaluate(() => [...document.querySelectorAll('.ta-opt')].map(o => o.textContent));
  ok(subs.every(t => /(^|[^\p{L}])new/iu.test(t)), 'every match has a word starting with what was typed, in its name or the line under it', subs.slice(0, 3));
  const c = await combo('#cx-q');
  ok(c.role === 'combobox' && c.exp === 'true', 'and the box says so to a screen reader', c);
  await page.keyboard.press('ArrowDown');
  const c2 = await combo('#cx-q');
  ok(!!c2.act, 'the arrow highlights the first match', c2);
  const picked = await page.evaluate(() => new Promise(res => { const was = window.cwPeek; window.cwPeek = (id) => { window.cwPeek = was; res(id); }; setTimeout(() => res(null), 1500); document.getElementById('cx-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }));
  ok(!!picked, 'and Enter opens that job', picked);
  ok(await page.evaluate(() => !document.querySelector('.ta-list')), 'the list goes away once one is picked');
}

section('Escape closes it');
{
  await page.click('#cx-q'); await page.fill('#cx-q', ''); await page.keyboard.type('pri', { delay: 30 }); await page.waitForTimeout(250);
  const before = await list();
  await page.keyboard.press('Escape');
  ok(before && before.length && await page.evaluate(() => !document.querySelector('.ta-list')), 'open, then closed by Escape', before && before.length);
}

section('Integrations: "spot" finds Spotify, and picking it shows its row');
{
  await page.evaluate(() => setTab('integrations'));
  await page.waitForSelector('#cdir-find', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('#cdir-find');
  await page.keyboard.type('spot', { delay: 30 });
  await page.waitForTimeout(250);
  const l = await list();
  ok(l && l.some(t => /Spotify/.test(t)), 'Spotify is in the list after four letters', l);
  await page.evaluate(() => { const o = [...document.querySelectorAll('.ta-opt')].find(o => /Spotify/.test(o.textContent)); o.click(); });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ val: document.getElementById('cdir-find').value, row: [...document.querySelectorAll('#vc .int-name, #vc .int-card')].some(e => /Spotify/.test(e.textContent)) }));
  ok(r.val === 'Spotify' && r.row, 'its name is searched and its row is on the page', r);
}

section('Tasks: the matching tasks, and picking one starts it');
{
  await page.evaluate(() => setTab('tasks'));
  await page.waitForSelector('#tk-find', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.tk2-row').length > 5, null, { timeout: 15000 }).catch(() => {});
  const word = await page.evaluate(() => { const t = document.querySelector('.tk2-row .tk-t'); return t ? t.textContent.split(/\s+/).find(w => w.length >= 5) || '' : ''; });
  await page.click('#tk-find');
  await page.keyboard.type(word.slice(0, 3), { delay: 30 });
  await page.waitForTimeout(250);
  const l = await list();
  ok(word && l && l.length > 0, 'three letters of a task word bring matches', { word, l: l && l.slice(0, 3) });
  const picked = await page.evaluate(() => new Promise(res => { const was = window.launchTask; window.launchTask = (id) => { window.launchTask = was; res(id); }; setTimeout(() => res(null), 1500); document.querySelector('.ta-opt').click(); }));
  ok(!!picked, 'and a click starts that task', picked);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
