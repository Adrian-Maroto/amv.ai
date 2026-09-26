/* THE APPS PEOPLE USE, THE ONES AMV CAN REALLY CONNECT FIRST.

   Asked for: the world's top apps rather than random ones, every topic in the
   Email format, the ones AMV can really connect to first, Notify me for the
   rest - and a way found to connect those later.

   Each promise here is one the page makes to somebody deciding whether to
   trust it:
     · Connect means a flow that exists and ends in a connection. Slack, Notion,
       Linear and Discord used to carry a Connect button whose only effect was a
       message saying the sign-in was unfinished.
     · Notify me reports what happened. The older notify-me said "you're on the
       list" whether anything was recorded or not.
     · A named mailbox row opens the picker on that mailbox.
     · Settings lists a sign-in once, however many rows it lights.
     · Nothing tells anybody to install a package AMV does not own. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'integrations', user: { name: 'Alex', email: 'alex@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => { document.getElementById('cookie-consent-banner')?.remove(); setTab('integrations'); });
await page.waitForTimeout(500);

const CONNECTS = ['google', 'outlook', 'github', 'mail', 'telegram', 'sms', 'canvas', 'rmcp'];
const USES = ['bank', 'calfeeds', 'predict', 'jobs', 'everyday', 'coverage', 'chat', 'vscode'];

section('Every topic is the same shape, and there is no "everything else"');
{
  const r = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#int-catalog > .ss2')];
    return {
      n: secs.length, cats: AMV_APP_CATS.length, count: _appCount(),
      shaped: secs.filter(s => s.querySelector('h3') && s.querySelector('.int-list .int-card') && s.querySelector('.int-seeall')).length,
      lump: /Everything else/i.test(document.querySelector('.vi-conn').textContent),
      intro: (document.querySelector('.vi-conn .vsub') || {}).textContent || '',
    };
  });
  ok(r.n === r.cats && r.n >= 30, 'one section per topic', r.n + ' of ' + r.cats);
  ok(r.shaped === r.n, 'each with a heading, rows and its own See all', r.shaped + ' of ' + r.n);
  ok(!r.lump, 'and nothing called "everything else"');
  ok(r.count >= 500, 'the list is hundreds of real apps', r.count);
  ok(r.intro.indexOf(String(r.count)) === 0, 'and the number on the page is the length of the list, not a claim', r.intro.slice(0, 40));
}

section('The apps people named are there');
{
  const names = await page.evaluate(() => AMV_APP_CATS.flatMap(c => c.apps.map(a => a.split('|')[0])));
  for (const n of ['CapCut', 'Canva', 'Spotify', 'WhatsApp', 'Instagram', 'TikTok', 'Notion', 'Uber', 'Airbnb', 'Duolingo', 'Figma', 'YouTube', 'WeChat', 'Mercado Libre'])
    ok(names.includes(n), n + ' is listed', n);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  ok(dup.length === 0, 'and no app is listed twice', dup);
  /* An agent that can read the vault can read every account in it. */
  ok(!names.some(n => /1Password|Bitwarden|LastPass|Dashlane|Keeper/i.test(n)), 'password managers are left out on purpose');
}

section('Connect only where AMV really connects, and those come first');
{
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#int-catalog .int-card')];
    const conn = rows.map(c => c.querySelector('[data-int-conn]')).filter(Boolean).map(b => b.dataset.intConn);
    const use = rows.map(c => c.querySelector('.int-act [data-int-use]')).filter(Boolean).map(b => b.dataset.intUse);
    const byName = (n) => rows.find(c => (c.querySelector('.int-name') || {}).textContent === n);
    const notifyOf = (n) => { const c = byName(n); return !!(c && c.querySelector('[data-app-notify]') && !c.querySelector('[data-int-conn]')); };
    /* In every section, no Notify me row sits above a row that connects. */
    const order = [...document.querySelectorAll('#int-catalog > .ss2')].map(s => {
      const kinds = [...s.querySelectorAll('.int-card')].map(c => c.classList.contains('int-notify') ? 'n' : 'c').join('');
      return { t: s.querySelector('h3').textContent, ok: !/n+c/.test(kinds) };
    });
    return { conn, use, order,
      slack: notifyOf('Slack'), discord: notifyOf('Discord'), spotify: notifyOf('Spotify'),
      canva: (byName('Canva') || {}).querySelector && byName('Canva').querySelector('[data-int-conn="rmcp"]') ? true : false,
      notion: (byName('Notion') || {}).querySelector && byName('Notion').querySelector('[data-int-conn="rmcp"]') ? true : false,
      firstTopic: document.querySelector('#int-catalog > .ss2 h3').textContent };
  });
  ok(r.conn.length >= 8 && r.conn.every(c => CONNECTS.includes(c)), 'every Connect button opens a flow that exists', [...new Set(r.conn)]);
  ok(r.use.every(u => USES.includes(u)), 'and every other action goes somewhere real', [...new Set(r.use)]);
  /* Slack and Discord publish no official connector, so they are Notify me -
     their old Connect only ever said the sign-in was unfinished. Notion and
     Canva do publish one, verified in the registry, so theirs really connects. */
  ok(r.slack && r.discord && r.spotify, 'Slack, Discord and Spotify are Notify me, not a Connect that goes nowhere', r);
  ok(r.notion && r.canva, 'Notion and Canva connect through their own official connectors', r);
  ok(r.order.every(o => o.ok), 'in every topic the ones that connect come before the ones that do not', r.order.filter(o => !o.ok));
  ok(r.firstTopic === 'Email', 'and the page opens on the topic with the most that connect', r.firstTopic);
}

section('A named mailbox opens the picker on that mailbox');
{
  const r = await page.evaluate(async () => {
    const realP = AMV_API.mailProviders;
    AMV_API.mailProviders = async () => ({ countries: 22, providers: [
      { id: 'gmail', name: 'Gmail', flag: '🌐', country: '', setup: 'gmail setup' },
      { id: 'yahoo', name: 'Yahoo Mail', flag: '🌐', country: '', setup: 'yahoo setup' },
      { id: 'custom', name: 'Any other', flag: '🌍', custom: true, setup: '' } ] });
    try { _MAILP = null; } catch (e) {}
    const row = [...document.querySelectorAll('#int-catalog .int-card')].find(c => /^Yahoo Mail$/.test((c.querySelector('.int-name') || {}).textContent));
    const b = row && row.querySelector('[data-int-conn="mail"]');
    if (!b) return { found: false };
    b.click();
    await new Promise(r => setTimeout(r, 400));
    const sel = document.getElementById('ml-prov');
    const out = { found: true, preset: b.dataset.intPreset, chosen: sel && sel.value, setup: (document.getElementById('ml-setup') || {}).textContent };
    document.getElementById('ovr').innerHTML = '';
    AMV_API.mailProviders = realP;
    return out;
  });
  ok(r.found && r.preset === 'yahoo', 'the Yahoo row carries its provider', r);
  ok(r.chosen === 'yahoo' && /yahoo setup/.test(r.setup || ''), 'and the picker opens on Yahoo, with Yahoo’s setup sentence', r);
}

section('Notify me says what happened');
{
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realFetch = AMV_API._fetch;
    const sent = [];
    const click = async (slug) => {
      const b = document.querySelector('[data-app-notify="' + slug + '"]');
      if (!b) return { missing: slug };
      await _appNotify(b);
      return { marked: _appNotifiedSet().has(slug), toast: [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].map(t => t.textContent).join(' ') };
    };
    store('amv_app_notified', []);
    /* No server: nothing recorded, and it says so. */
    AMV_API.base = '';
    const off = await click('spotify');
    /* The server refuses: not marked, and the reason is given. */
    AMV_API.base = 'https://api.example.workers.dev';
    AMV_API._fetch = async (path, o) => { sent.push({ path, body: JSON.parse(o.body) }); return new Response('{"error":"slow down"}', { status: 429 }); };
    const busy = await click('spotify');
    /* The server records it. */
    AMV_API._fetch = async (path, o) => { sent.push({ path, body: JSON.parse(o.body) }); return new Response('{"ok":true}', { status: 200 }); };
    const good = await click('spotify');
    await new Promise(r => setTimeout(r, 200));
    const row = [...document.querySelectorAll('#int-catalog .int-card')].find(c => (c.querySelector('.int-name') || {}).textContent === 'Spotify');
    AMV_API.base = realBase; AMV_API._fetch = realFetch;
    return { off, busy, good, sent, onList: !!(row && row.querySelector('.int-onlist')), stillButton: !!(row && row.querySelector('[data-app-notify]')) };
  });
  ok(!r.off.marked && /could not be recorded/i.test(r.off.toast), 'with no server it records nothing and says so', r.off);
  ok(!r.busy.marked && /try again/i.test(r.busy.toast), 'refused, it is not marked and says why', r.busy);
  ok(r.good.marked, 'recorded, it is marked', r.good);
  const last = r.sent.filter(x => x.path === '/waitlist').pop() || {};
  ok(last.path === '/waitlist' && last.body.product === 'app-spotify' && last.body.email === 'alex@x.com',
     'on the server’s waitlist, one product per app, under the account’s own address', last);
  ok(r.onList && !r.stillButton, 'and the row now says On the list', r);
}

section('Show all opens the rest of a topic, and keeps it open');
{
  const r = await page.evaluate(async () => {
    const sec = () => [...document.querySelectorAll('#int-catalog > .ss2')].find(s => s.querySelector('h3').textContent === 'Shopping');
    const before = sec().querySelectorAll('.int-card').length;
    sec().querySelector('[data-app-more]').click();
    await new Promise(r => setTimeout(r, 200));
    const after = sec().querySelectorAll('.int-card').length;
    _paintIntegrations();
    await new Promise(r => setTimeout(r, 100));
    const repaint = sec().querySelectorAll('.int-card').length;
    const total = AMV_APP_CATS.find(c => c.id === 'shop').apps.length;
    return { before, after, repaint, total };
  });
  ok(r.before === 6, 'a topic shows six at first', r.before);
  ok(r.after === r.total, 'Show all shows every one', r);
  ok(r.repaint === r.total, 'and a repaint does not snap it shut', r);
}

section('Settings lists a sign-in once');
{
  const r = await page.evaluate(() => {
    _connState.data = { configured: true, items: [{ id: 'c1', provider: 'google', scopes: ['mail.read', 'calendar.read', 'drive.read'] }],
                        providers: [{ id: 'google', name: 'Google', ready: true, scopes: ['mail.read'] }] };
    const box = document.createElement('div');
    box.innerHTML = _integrationsCatalogHTML({ connectedOnly: true });
    const names = [...box.querySelectorAll('.int-card .int-name')].map(n => n.textContent);
    const all = document.createElement('div');
    all.innerHTML = _integrationsCatalogHTML();
    const lit = [...all.querySelectorAll('.int-card')].filter(c => c.querySelector('.int-ok')).length;
    _connState.data = null;
    return { names, lit };
  });
  ok(r.lit >= 4, 'one Google grant lights every Google row on the page', r.lit);
  ok(r.names.length === 1 && /^Google/.test(r.names[0]), 'but Settings shows it once, by the name of the grant', r.names);
}

section('Nobody is told to install a package AMV does not own');
{
  const r = await page.evaluate(() => {
    _devConnectVSCode();
    const t = (document.getElementById('ovr') || {}).textContent || '';
    const go = !!document.getElementById('vsc-go');
    document.getElementById('ovr').innerHTML = '';
    return { t, go, src: String(_devConnectVSCode) + String(connectIntegration) };
  });
  ok(!/@amv\/cli|npm install|amv code \./.test(r.t) && !/@amv\/cli/.test(r.src), 'no install command for a package that does not exist', r.t.slice(0, 120));
  ok(/no AMV extension for VS Code yet/i.test(r.t) && r.go, 'it says there is no extension, and offers the connection that works', r.t.slice(0, 120));
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
