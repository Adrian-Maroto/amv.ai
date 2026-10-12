/* EVERY WORD ON THE SCREEN IS IN THE LANGUAGE YOU CHOSE.

   The owner's instruction: "make sure every single thing translates". The
   only way to make that true and keep it true is to look - so this opens every
   screen, every Settings section and the windows people open, once in English
   and once in Spanish, and reads back every word a person can see: the text,
   the hover tips and the labels a screen reader speaks. Anything that is the
   same in both is still English.

   Two lists sit beside it in tests/fixtures:
   - same-in-every-language.json: the words that really are the same
     everywhere - AMV's own names, the names of other companies' products.
     Short, and every entry is a proper noun.
   - untranslated-baseline.json: what is known to still be English, screen by
     screen. It is a ratchet. A string that is not on it fails this suite, so
     nothing new ships in English; a string that IS on it but has since been
     translated is reported, so the list only ever gets shorter. The work is
     done when it is empty.

   Spanish stands in for the other sixteen because the build refuses a
   dictionary entry that lacks any of them (build.mjs, foldI18nFiles) - so a
   string that translates here translates everywhere.

   AMV_I18N_BASELINE=write rewrites the baseline from what is on screen now.
   Only for shrinking it: the diff of that file is the review. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const FIX = new URL('../fixtures/', import.meta.url);
const SAME = new Set(JSON.parse(readFileSync(new URL('same-in-every-language.json', FIX), 'utf8')));
const BASE_URL = new URL('untranslated-baseline.json', FIX);
const BASE = existsSync(BASE_URL) ? JSON.parse(readFileSync(BASE_URL, 'utf8')) : {};
const WRITE = process.env.AMV_I18N_BASELINE === 'write';
/* Some words are the same in Spanish on purpose ("Chat"). The pack says so:
   a key whose Spanish value is the key itself was translated, and the
   translation happens to match. */
const ES_PACK = JSON.parse(readFileSync(new URL('../../i18n/es.json', import.meta.url), 'utf8'));
const sameInSpanish = s => ES_PACK[s] === s;

const app = await bootApp({ tab: 'chat', user: { name: 'Kim', email: 'kim@example.com', ini: 'K' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

/* Each state: how to get there, and which part of the page is its own. The
   sidebar and the top bar are one state of their own ("shell"), so a label
   there is counted once and not on every screen. */
const MAIN = ['#vc', '#set-modal', '#ovr', '.prof-menu', '.ctxm'];
const STATES = [
  ['shell', `setTab('chat')`, ['#sb', '#anav', '.bnav', '#bnav']],
  ...['chat', 'build', 'crew', 'handoff', 'dev', 'lab', 'studio', 'workspaces', 'memory', 'tasks', 'integrations',
      'market', 'spend', 'plans', 'billing', 'usage', 'team', 'help', 'apps', 'prompts', 'dashboard']
    .map(t => [t, `setTab('${t}')`, MAIN]),
  ['upgrade', `openUpgrade('elite')`, MAIN],
  ['modal: upgrade', `setTab('chat'); openUpgradeModal('smart')`, ['#ovr']],
  ['modal: compare plans', `setTab('chat'); openPlanCompare('pro')`, ['#ovr']],
  ['modal: custom plan', `setTab('chat'); openCustomPlan()`, ['#ovr']],
  ['menu: profile', `setTab('chat'); showProfMenu(document.querySelector('#nav-av') || document.body)`, ['.prof-menu']],
  ['modal: shortcuts', `setTab('chat'); openShortcuts()`, ['#ovr', 'body > .ov', '.kbd-modal']],
  ['modal: command palette', `setTab('chat'); openCommandPalette()`, ['#ovr', '.cmdk', '.cp-modal', 'body > .ov']],
];

const collect = (roots) => page.evaluate((roots) => {
  const out = new Set();
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const els = [...new Set(roots.flatMap(s => [...document.querySelectorAll(s)]))];
  for (const root of els) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement; if (!p) continue;
      if (p.closest('script, style, svg, code, pre, textarea')) continue;
      /* Live model output is marked data-no-i18n and is left alone - unless a
         data-i18n inside it opts AMV's own labels back in, as the page does. */
      const nb = p.closest('[data-no-i18n]'), ni = p.closest('[data-i18n]');
      if (nb && !(ni && nb.contains(ni))) continue;
      if (!vis(p)) continue;
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && /[A-Za-z]{2}/.test(t)) out.add(t);
    }
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => {
      if (e.closest('[data-no-i18n]') && !e.closest('[data-i18n]')) return;
      for (const a of ['placeholder', 'title', 'aria-label']) {
        const v = (e.getAttribute(a) || '').trim();
        if (v.length > 1 && /[A-Za-z]{2}/.test(v)) out.add('@' + a + ' ' + v);
      }
    });
  }
  return [...out];
}, roots);

const visit = async (lang) => {
  await page.evaluate(async (c) => {
    saveStr('amv_lang', c);
    try { _translateUI(); } catch (e) {}
    for (let i = 0; i < 60 && c !== 'en' && !_i18nPackHave(c); i++) await new Promise(s => setTimeout(s, 100));
  }, lang);
  const seen = {};
  const panes = await page.evaluate(async () => {
    S.settingsPane = 'account'; setTab('settings'); await new Promise(s => setTimeout(s, 600));
    const p = [...new Set([...document.querySelectorAll('[data-sp]')].map(e => e.dataset.sp))];
    try { closeSettings(); } catch (e) {}
    return p;
  });
  const all = STATES.concat(panes.map(sp => ['settings: ' + sp, `S.settingsPane='${sp}'; setTab('settings')`, ['#set-modal', '#vc']]));
  for (const [name, js, roots] of all) {
    await page.evaluate(async (js) => {
      document.getElementById('ovr').innerHTML = '';
      document.querySelectorAll('.prof-menu, .ctxm').forEach(e => e.remove());
      try { (0, eval)(js); } catch (e) { console.warn('state failed', js, e && e.message); }
      await new Promise(s => setTimeout(s, 900));
      /* The observer translates what was drawn after the switch; one pass
         here makes sure it has run before the words are read. */
      try { _translateUI(); } catch (e) {}
      await new Promise(s => setTimeout(s, 150));
    }, js);
    seen[name] = await collect(roots);
    await page.evaluate(() => { try { closeSettings(); } catch (e) {} });
  }
  return seen;
};

const en = await visit('en');
const es = await visit('es');
await page.evaluate(() => { saveStr('amv_lang', 'en'); try { _translateUI(); } catch (e) {} });

const now = {};
for (const name of Object.keys(en)) {
  const spanish = new Set(es[name] || []);
  now[name] = en[name].filter(s => { const t = s.replace(/^@\S+ /, ''); return spanish.has(s) && !SAME.has(t) && !sameInSpanish(t); }).sort();
}

section('Every screen was reached');
for (const name of Object.keys(en)) ok(en[name].length > 0, name + ' was opened and read', en[name].length);

section('Nothing on screen is English unless it is already known to be');
let left = 0, newly = 0, cleared = 0;
for (const [name, list] of Object.entries(now)) {
  const known = new Set(BASE[name] || []);
  const fresh = list.filter(s => !known.has(s));
  left += list.length; newly += fresh.length;
  cleared += [...known].filter(s => !list.includes(s)).length;
  if (!WRITE) ok(fresh.length === 0, name + ': nothing new is in English', fresh.slice(0, 12));
}
console.log('\n  still English: ' + left + ' (across ' + Object.keys(now).length + ' screens)' + (cleared ? ' - ' + cleared + ' translated since the baseline; shrink it with AMV_I18N_BASELINE=write' : ''));
if (WRITE) { writeFileSync(BASE_URL, JSON.stringify(now, null, 1) + '\n'); console.log('  baseline written'); }

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('every-word-is-in-your-language') > 0) process.exitCode = 1;
done();
