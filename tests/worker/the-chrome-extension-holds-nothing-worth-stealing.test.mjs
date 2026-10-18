/* AMV FOR CHROME HOLDS NOTHING WORTH STEALING, AND READS ONLY WHAT YOU PRESS.

   The extension's background script, run against a stand-in for Chrome's API,
   and its manifest, read as the store would:

   - its permissions are the four it needs and nothing else: no host access to
     any site, no tabs, no history, no key - and its one script runs only on
     AMV's own address;
   - what you share never goes in the address bar (it would sit in your
     history): the tab opens with ?amvext=1 and the share waits in session
     storage, for that tab;
   - only a tab on AMV's address gets it, only its own, only once, and only
     while it is fresh; long text is cut to a bound;
   - a page Chrome will not let it read still gives its title and address;
   - and it never makes a network request of its own. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'chrome', 'manifest.json'), 'utf8'));
const bgSrc = readFileSync(join(ROOT, 'chrome', 'background.js'), 'utf8');
const shareSrc = readFileSync(join(ROOT, 'chrome', 'share.js'), 'utf8');
const AMV = 'https://amv.example';

section('It asks for four permissions, and no site');
{
  ok(manifest.manifest_version === 3, 'a current extension (Manifest V3)', manifest.manifest_version);
  ok(JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(['activeTab', 'contextMenus', 'scripting', 'storage']),
     'activeTab, the menu, running a script where you pressed, and its own storage - nothing more', manifest.permissions);
  ok(!manifest.host_permissions && !manifest.optional_host_permissions && !manifest.optional_permissions && !manifest.web_accessible_resources && !manifest.externally_connectable,
     'no host access, no optional extras, nothing exposed to pages', Object.keys(manifest));
  ok(manifest.content_scripts.length === 1 && manifest.content_scripts[0].matches.join() === '__AMV_ORIGIN__/*',
     'its one script runs on AMV’s own address, filled in when it is packed', manifest.content_scripts);
  ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts/.test(bgSrc + shareSrc), 'and neither script makes a network request', true);
}

/* ── A stand-in for Chrome ────────────────────────────────────────────── */
let nextTab = 100, created = [], menus = [], store = {}, onMsg = null, onMenu = null, onAction = null, script = null;
const chrome = {
  tabs: { create: async ({ url }) => { const t = { id: nextTab++, url }; created.push(t); return t; } },
  storage: { session: {
    set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    get: async (k) => ({ [k]: store[k] }),
    remove: async (k) => { delete store[k]; },
  } },
  contextMenus: { create: (m) => menus.push(m), onClicked: { addListener: (f) => { onMenu = f; } } },
  action: { onClicked: { addListener: (f) => { onAction = f; } } },
  runtime: { onInstalled: { addListener: (f) => f() }, onMessage: { addListener: (f) => { onMsg = f; } } },
  scripting: { executeScript: async () => script() },
};
vm.runInNewContext(bgSrc.replace("const AMV = '__AMV_ORIGIN__'", 'const AMV = ' + JSON.stringify(AMV)), { chrome, URLSearchParams, Date, Promise, String });
const ask = (sender) => new Promise(res => { const keep = onMsg({ amv: 'share?' }, sender, res); if (keep !== true) {} });
const flush = () => new Promise(r => setTimeout(r, 10));

section('A selection opens AMV - and is not in the address');
{
  ok(menus.map(m => m.id).join() === 'amv-selection,amv-link,amv-page', 'three menu items: a selection, a link, the page', menus.map(m => m.id));
  await onMenu({ menuItemId: 'amv-selection', selectionText: 'the clause about notice periods' }, { title: 'Lease', url: 'https://landlord.example/lease' });
  await flush();
  const t = created[0];
  ok(t && t.url === AMV + '/?amvext=1', 'it opens AMV with only a marker in the address', t && t.url);
  ok(!/notice|landlord|lease/i.test(t.url), 'and nothing you shared is in it - so nothing of it is in your history', t.url);
  ok(store['share:' + t.id] && store['share:' + t.id].text === 'the clause about notice periods' && store['share:' + t.id].url === 'https://landlord.example/lease',
     'it waits in session storage, for that tab', store);
}

section('Only AMV’s own tab gets it, only its own, only once');
{
  const t = created[0];
  ok(await ask({ tab: { id: t.id }, origin: 'https://evil.example' }) === null, 'a tab on another address gets nothing', true);
  ok(await ask({ tab: { id: 999 }, origin: AMV }) === null, 'another AMV tab gets nothing', true);
  const got = await ask({ tab: { id: t.id }, origin: AMV });
  ok(got && got.text === 'the clause about notice periods' && got.title === 'Lease', 'the tab it opened gets it', got);
  ok(await ask({ tab: { id: t.id }, origin: AMV }) === null && !store['share:' + t.id], 'once - and then it is gone', store);
  ok(await ask({ origin: AMV }) === null, 'and a message from no tab at all gets nothing', true);
}

section('A share left waiting too long is not handed over');
{
  await onMenu({ menuItemId: 'amv-link', linkUrl: 'https://news.example/a' }, { title: 'x', url: 'y' });
  await flush();
  const t = created[created.length - 1];
  store['share:' + t.id].at -= 61000;
  ok(await ask({ tab: { id: t.id }, origin: AMV }) === null && !store['share:' + t.id], 'a minute old: dropped, not delivered', true);
}

section('The page itself, and a page it may not read');
{
  script = () => [{ result: { sel: '', text: 'x'.repeat(20000) } }];
  await onAction({ id: 7, title: 'Long article', url: 'https://site.example/long' });
  await flush();
  let t = created[created.length - 1], s = store['share:' + t.id];
  ok(s && s.text.length === 8000 && s.title === 'Long article', 'the page’s text, cut to 8,000 characters', s && s.text.length);
  script = () => [{ result: { sel: 'just this bit', text: 'the whole page' } }];
  await onAction({ id: 8, title: 'P', url: 'https://site.example/p' });
  await flush();
  t = created[created.length - 1];
  ok(store['share:' + t.id].text === 'just this bit', 'what you selected, when you selected something', store['share:' + t.id].text);
  script = () => { throw new Error('Cannot access a chrome:// URL'); };
  await onAction({ id: 9, title: 'Settings', url: 'chrome://settings' });
  await flush();
  t = created[created.length - 1];
  ok(store['share:' + t.id] && store['share:' + t.id].title === 'Settings' && store['share:' + t.id].text === '', 'a page Chrome will not let it read still gives its title and address', store['share:' + t.id]);
}

if (report('the-chrome-extension-holds-nothing-worth-stealing') > 0) process.exitCode = 1;
done();
