/* EVERY SCREEN SPEAKS THE LANGUAGE YOU CHOSE (failure sweep, Nov 22).

   The cookie notice was English in every language and nothing said so - it
   was found by looking at a screenshot. A sweep of every main screen and
   every Settings pane, drawn in English and again in Spanish, then found the
   Billing screen, the chat composer's hint and a Usage line the same in both:
   never translated. This keeps the sweep: anything drawn identically in both
   languages is a leftover, unless it is a name that stays a name. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const LANGS = ['en', 'es'];
const SCREENS = [
  ['chat', () => setTab('chat')], ['crew', () => setTab('crew')], ['tasks', () => setTab('tasks')],
  ['integrations', () => setTab('integrations')], ['billing', () => setTab('billing')], ['plans', () => setTab('plans')],
  ['help', () => setTab('help')], ['usage', () => setTab('usage')], ['team', () => setTab('team')], ['build', () => setTab('apps')],
  ...['account', 'appearance', 'integrations', 'spending', 'security', 'privacy', 'notifications', 'memory', 'usage', 'teamset', 'family', 'apikeys', 'projects', 'skills', 'widget']
    .map(p => ['settings:' + p, new Function('S.settingsPane=' + JSON.stringify(p) + ';setTab("settings")')]),
];
/* Names: the same in every language, on purpose. */
const NAMES = new Set(['AMV Auto', 'AMV Forge', 'AMV Apex', 'Mission Control', 'Bahasa Indonesia', 'Email marketing.']);
const out = {};
for (const lang of LANGS) {
  const app = await bootApp({ viewport: { width: 1280, height: 900 }, user: { name: 'Ana', email: 'ana@x.com', ini: 'A' } });
  const { page } = app;
  await page.evaluate(async (c) => { saveStr('amv_plan', 'pro'); saveStr('amv_lang', c); await _i18nLoadPack(c); _translateUI(); }, lang);
  for (const [name, fn] of SCREENS) {
    try { await page.evaluate(`(${fn.toString()})()`); } catch (e) { continue; }
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { _translateUI(); } catch (e) {} });
    await page.waitForTimeout(500);
    const left = await page.evaluate(() => {
      const res = new Set();
      const roots = [document.getElementById('app'), document.getElementById('ovr'), document.getElementById('cookie-consent-banner')].filter(Boolean);
      const STOP = /^(AMV|AMV\.AI|Pro|Max|Ultra|Elite|Free|OK|API|URL|PDF|CSV|JSON|GitHub|Google|Slack|Gmail|Notion|Stripe|PayPal|Chrome|VS Code|JetBrains|Ana|ana@x\.com|A)$/;
      for (const root of roots) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const el = n.parentElement; if (!el) continue;
          if (el.closest('[data-no-i18n],script,style,code,pre,textarea,svg,.cm,#cm')) continue;
          const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const t = n.textContent.replace(/\s+/g, ' ').trim();
          if (t.length < 4 || STOP.test(t)) continue;
          if (!/[a-z]{3}.*\s.*[a-z]{2}/i.test(t)) continue;
          res.add(t.slice(0, 160));
        }
      }
      return [...res];
    });
    for (const t of left) (out[t] = out[t] || new Set()).add(lang + ':' + name);
  }
  await app.close();
}

const left = [];
for (const [t, w] of Object.entries(out)) {
  if (NAMES.has(t)) continue;
  const where = [...w];
  const en = new Set(where.filter(x => x.startsWith('en:')).map(x => x.slice(3)));
  const other = where.filter(x => !x.startsWith('en:') && en.has(x.split(':').slice(1).join(':')));
  if (other.length) left.push(t.slice(0, 90) + '  [' + other.map(x => x.split(':').slice(1).join(':')).join(', ') + ']');
}

section('Drawn in Spanish, no line on a main screen is still the English one');
ok(Object.keys(out).length > 150, 'the screens drew enough text to measure', Object.keys(out).length);
ok(left.length === 0, 'nothing is left in English', left);

/* The second sweep (Nov 22) looked where the first did not: signed out, and
   inside dialogs. The whole sign-in form was English in every language, and
   34 Crew job titles with 35 descriptions were in no pack at all - each job
   panel opened in English. One page per view, because the sign-in form is
   only drawn for somebody who is not signed in. */
const VIEWS = [
  ['signin', null, () => openAuth('login')],
  ['signup', null, () => openAuth('signup')],
  ['crew-job', 'in', async () => { setTab('crew'); for (let i = 0; i < 80 && !document.querySelector('.cj-card-b'); i++) await new Promise(r => setTimeout(r, 100)); cwPeek(document.querySelector('.cj-card-b').dataset.darg); }],
  ['crew-buy-job', 'in', async () => { setTab('crew'); for (let i = 0; i < 80 && !document.querySelector('.cj-card-b'); i++) await new Promise(r => setTimeout(r, 100)); cwPeek('target_buy'); }],
];
const seen = {};
for (const lang of LANGS) {
  for (const [name, who, fn] of VIEWS) {
    const app = await bootApp({ viewport: { width: 1280, height: 900 }, user: who ? { name: 'Ana', email: 'ana@x.com', ini: 'A' } : null });
    const { page } = app;
    await page.evaluate(async (c) => { saveStr('amv_plan', 'pro'); saveStr('amv_lang', c); if (c !== 'en') await _i18nLoadPack(c); _translateUI(); }, lang);
    try { await page.evaluate(`(${fn.toString()})()`); } catch (e) { (seen['(could not open ' + name + ': ' + e.message + ')'] = new Set()).add(lang + ':' + name); }
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { _translateUI(); } catch (e) {} });
    await page.waitForTimeout(400);
    const texts = await page.evaluate(() => {
      const res = new Set();
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement; if (!el || el.closest('[data-no-i18n],script,style,code,pre,textarea,svg,noscript')) continue;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const t = n.textContent.replace(/\s+/g, ' ').trim();
        if (t.length >= 4 && /[a-z]{3}.*\s.*[a-z]{2}/i.test(t)) res.add(t.slice(0, 160));
      }
      return [...res];
    });
    for (const t of texts) (seen[t] = seen[t] || new Set()).add(lang + ':' + name);
    await app.close();
  }
}
const left2 = [];
for (const [t, w] of Object.entries(seen)) {
  if (NAMES.has(t)) continue;
  const where = [...w];
  if (/^\(could not open/.test(t)) { left2.push(t); continue; }
  const en = new Set(where.filter(x => x.startsWith('en:')).map(x => x.slice(3)));
  const other = where.filter(x => !x.startsWith('en:') && en.has(x.split(':').slice(1).join(':')));
  if (other.length) left2.push(t.slice(0, 90) + '  [' + other.map(x => x.split(':').slice(1).join(':')).join(', ') + ']');
}
section('Signed out, and inside a Crew job, nothing is left in English either');
ok(Object.keys(seen).length > 30, 'the views drew enough text to measure', Object.keys(seen).length);
ok(left2.length === 0, 'nothing is left in English', left2);
report();
done();
