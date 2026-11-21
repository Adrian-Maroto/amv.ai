/* A RETIRED MARKETPLACE LEAVES THE WORK, NOT THE SIGN (Build 16 audit D16-05, Nov 21).

   The marketplace is gone from the product, and its tab goes to Tasks. Two
   places still named it: Crew drew a "Marketplace plugins" section for crews
   saved from it, promising the seller's details were "swapped for yours
   automatically" - Run does no such swap - and the language settings listed
   "the marketplace" among the screens. The saved crews stay; the shop sign
   goes. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;

section('A crew saved from the marketplace is still in Crew, without the marketplace');
{
  await page.evaluate(() => {
    store('amv_saved_crews', [{ id: 'mk1', fromMarket: true, title: 'Weekly supplier check', seller: 'Ana', agents: [{ role: 'Reader', task: 'Read the supplier emails' }, { role: 'Writer', task: 'Write a short summary' }] }]);
    saveStr('amv_plan', 'pro');
    window.__goal = null; window.openCoworkWith = g => { window.__goal = g; };
    setTab('chat'); setTab('crew');
  });
  await page.waitForSelector('#mc-bought', { timeout: 20000 });
  const r = await page.evaluate(() => { const s = document.getElementById('mc-bought'); return { text: s.textContent.replace(/\s+/g, ' ').trim(), crew: (document.getElementById('vc') || document.body).innerText }; });
  ok(/Saved from others/.test(r.text) && /Weekly supplier check/.test(r.text) && /made by Ana/.test(r.text), 'it is there, with who made it', r.text);
  ok(!/marketplace/i.test(r.crew) && !/Owned|bought|swapped/i.test(r.text), 'and nothing on Crew names the marketplace, buying, or a swap of details', r.text);
  await page.click('#mc-bought [data-dact="_mcUseCrew"]');
  const g = await page.evaluate(() => window.__goal);
  ok(/Reader: Read the supplier emails/.test(g || '') && /Writer: Write a short summary/.test(g || ''), 'Run still starts it with its steps', g);
}

section('A fresh account has no such section');
{
  const r = await page.evaluate(() => { store('amv_saved_crews', []); setTab('chat'); setTab('crew'); return new Promise(res => setTimeout(() => res(!!document.getElementById('mc-bought')), 600)); });
  ok(r === false, 'nothing is drawn when nothing was saved', r);
}

section('Language settings list the screens that exist');
{
  const t = await page.evaluate(async () => {
    S.settingsPane = 'language'; S.tab = 'settings'; setTab('settings');
    for (let i = 0; i < 100 && !/The app itself/i.test(document.body.innerText); i++) await new Promise(r => setTimeout(r, 50));
    return document.body.innerText.replace(/\s+/g, ' ');
  });
  ok(/The app itself/i.test(t) && /Every screen - chat, Crew/.test(t), 'the sentence is there', t.slice(0, 80));
  ok(!/marketplace/i.test(t), 'and it does not name the marketplace', (t.match(/.{60}marketplace.{20}/i) || [''])[0]);
}

section('In Spanish, the same');
{
  await page.click('[data-lang="es"]');
  await page.waitForFunction(() => /Todas las pantallas/.test(document.body.textContent), null, { timeout: 15000 });
  const t = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  ok(/Todas las pantallas \(chat, Crew, Studio, Dev, Lab, ajustes\)/.test(t), 'the translation lists the same screens', (t.match(/Todas las pantallas.{60}/) || [''])[0]);
  await page.evaluate(() => { saveStr('amv_lang', 'en'); });
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
