/* A LANGUAGE ARRIVES WHEN IT IS CHOSEN, AND ONLY THEN.

   Every visitor used to download every label in nineteen languages - about a
   tenth of the page - to read it in one. The build now takes the dictionary
   out of the page and writes one small file per language; the page fetches
   the one somebody chooses.

   What has to hold, measured on the wire and on the screen:
     · an English visitor downloads no translation at all;
     · choosing Spanish fetches exactly the Spanish pack, and the interface
       becomes Spanish;
     · until the pack is here, nothing is sent to be machine-translated - the
       whole-page pass falls back to the model for missing strings, and firing
       it before the dictionary arrives would send every label on the screen;
     · a pack that cannot be fetched leaves the interface in English and says
       so once, and the next attempt after the connection returns succeeds;
     · the merge recovered translations the old page dropped (a Bengali
       "Agents" among them) - checked, not assumed. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('The page itself carries no translations');
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const es = JSON.parse(readFileSync(join(ROOT, 'i18n', 'es.json'), 'utf8'));
  const samples = ['Clear chats', 'Recurring work', 'Marketplace'].map(k => es[k]).filter(Boolean);
  ok(samples.length === 3, 'the Spanish pack has the words this checks for', samples);
  ok(samples.every(w => !html.includes(w)), 'and none of them is in the page a visitor downloads', samples);
}

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

const packs = [];
let failPacks = false, htmlForPacks = false;
/* On the CONTEXT, not the page: the service worker makes this request, and a
   page-level route never sees it - the first run of this suite counted zero
   requests while the pack arrived perfectly well. */
await page.context().route('**/i18n/*.json', (route) => {
  packs.push(new URL(route.request().url()).pathname);
  if (failPacks) return route.fulfill({ status: 503, body: 'down' });
  if (htmlForPacks) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sites":[]}' });
  return route.continue();
});
/* The machine-translation fallback only runs with a backend, and this harness
   has none - so, left alone, "nothing was sent" would be true for the wrong
   reason. The page is told a backend is ready and every call to the model is
   recorded instead of made. */
await page.evaluate(() => {
  window.__aiCalls = [];
  window._aiBackendReady = () => true;
  window.aiComplete = async (p) => { window.__aiCalls.push(String(p).slice(0, 80)); return ''; };
});
const aiCalls = () => page.evaluate(() => window.__aiCalls.length);

section('An English visitor fetches no language');
{
  await page.evaluate(() => { saveStr('amv_lang', 'en'); _translateUI(); });
  await page.waitForTimeout(600);
  ok(packs.length === 0, 'nothing was fetched', packs);
  ok(await aiCalls() === 0, 'and nothing was machine-translated', await aiCalls());
}

section('Choosing Spanish fetches Spanish, once, and the interface follows');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_lang', 'es');
    try { _i18nRoots().forEach(x => _restoreI18nDOM(x)); } catch (e) {}
    try { setTab('chat'); } catch (e) {}
    _translateUI();
    for (let i = 0; i < 50 && !_i18nPackHave('es'); i++) await new Promise(s => setTimeout(s, 100));
    await new Promise(s => setTimeout(s, 400));
    const nav = [...document.querySelectorAll('.snb[data-tab]')].map(b => b.textContent.trim());
    return { have: _i18nPackHave('es'), settings: T('Settings'), nav };
  });
  ok(r.have === true, 'the Spanish pack is in', r.have);
  ok(packs.filter(p => p === '/i18n/es.json').length === 1 && packs.every(p => p === '/i18n/es.json'),
     'exactly one request, for the Spanish pack', packs);
  const esPack = JSON.parse(readFileSync(join(ROOT, 'i18n', 'es.json'), 'utf8'));
  ok(r.settings === esPack['Settings'] && r.settings !== 'Settings', 'a label translates, to what the pack says', r.settings);
  const again = await page.evaluate(async () => { _translateUI(); await new Promise(s => setTimeout(s, 300)); return true; });
  ok(again && packs.length === 1, 'translating again does not fetch it again', packs);
}

section('The merge kept translations the old page threw away');
{
  const r = await page.evaluate(async () => { await _i18nLoadPack('bn'); return { agents: I18N['Agents'] && I18N['Agents'].bn, build: I18N['Build'] && I18N['Build'].bn }; });
  ok(r.agents && r.agents !== 'Agents' && r.build && r.build !== 'Build',
     'Bengali "Agents" and "Build" exist - an object literal that repeated the key used to erase them', r);
}

section('A pack that cannot be fetched leaves English, says so once, and recovers');
{
  failPacks = true;
  /* Counted from HERE. With the Spanish pack in, the model is legitimately
     asked for the few strings the dictionary does not have; what must not
     happen is the same thing with NO dictionary at all. */
  await page.evaluate(() => { window.__aiCalls = []; });
  const toasts = await page.evaluate(async () => {
    const said = [];
    const real = window.toast;
    window.toast = (m) => said.push(String(m));
    saveStr('amv_lang', 'fr');
    _translateUI();
    await new Promise(s => setTimeout(s, 800));
    _translateUI();                                   // a second pass inside the pause does not ask again
    await new Promise(s => setTimeout(s, 400));
    /* And a real second attempt that ALSO fails - the connection "returns"
       while the server is still down - is not a second toast. */
    window.dispatchEvent(new Event('online'));
    await new Promise(s => setTimeout(s, 800));
    window.toast = real;
    return { said, settings: T('Settings'), have: _i18nPackHave('fr') };
  });
  ok(toasts.have === false && toasts.settings === 'Settings', 'the interface stays in English, not half-translated', toasts);
  ok(toasts.said.length === 1 && /could not be loaded/.test(toasts.said[0]), 'and says so once', toasts.said);
  ok(packs.filter(p => p === '/i18n/fr.json').length === 2,
     'one attempt, then exactly one more when the connection returns - not one per pass', packs);
  ok(await aiCalls() === 0, 'and without sending the screen to be machine-translated instead - with a backend ready to take it', await aiCalls());

  failPacks = false;
  const back = await page.evaluate(async () => {
    window.dispatchEvent(new Event('online'));
    for (let i = 0; i < 50 && !_i18nPackHave('fr'); i++) await new Promise(s => setTimeout(s, 100));
    return { have: _i18nPackHave('fr'), settings: T('Settings') };
  });
  ok(back.have === true && back.settings !== 'Settings', 'when the connection returns, French arrives', back);
  await page.evaluate(() => { saveStr('amv_lang', 'en'); _translateUI(); });
}

section('A 200 that is not a dictionary is not a pack');
{
  /* Valid JSON, status 200, and not a translation pack - a proxy, a captive
     portal, or a stub answering every request alike (one suite here did
     exactly that, and the language was marked "loaded" with nothing in it,
     which stops it ever being fetched again). HTML would already fail to
     parse; this is the case only the shape check catches. */
  htmlForPacks = true;
  const r = await page.evaluate(async () => {
    const ok = await _i18nLoadPack('de');
    return { ok, have: _i18nPackHave('de') };
  });
  htmlForPacks = false;
  ok(r.ok === false && r.have === false, 'it is treated as a failure, so it will be fetched again', r);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
