/* AN APP CONNECTS BY SIGNING IN, AND CHAT ASKS BEFORE IT ACTS.

   The page half of app connectors (the server half is in
   tests/worker/an-app-you-sign-in-to-is-an-app-amv-can-use). What the page
   must get right:
     · a row for an app with an official connector says Connect, and pressing
       it goes to the app's sign-in the server handed back;
     · coming back with an `r_` state finishes an app sign-in, and a `c_`
       state still finishes a Connected account - neither takes the other's;
     · a connected app's tools are offered to chat - named after the app, run
       through the server - and never to Build's once-per-turn loop;
     · each call is asked for, in the app's name, with its arguments shown;
     · a sign-in the app stopped accepting says so and offers Connect again;
     · a computer connector cannot take an app's name. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'integrations', apiBase: 'https://api.example.workers.dev', user: { name: 'Alex', email: 'alex@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => {
  document.getElementById('cookie-consent-banner')?.remove();
  window.__rm = { started: [], finished: [], removed: [], listed: 0, calls: [], toolsAsked: 0, apps: { notion: { connected: false, broken: false } } };
  const L = () => ({ ok: true, configured: true, apps: Object.entries(window.__rm.apps).map(([slug, a]) => ({ slug, name: slug === 'notion' ? 'Notion' : slug, connected: a.connected, broken: a.broken })) });
  AMV_API.remoteList = async () => { window.__rm.listed++; return L(); };
  AMV_API.remoteStart = async (a, redirect) => { window.__rm.started.push({ a, redirect }); return { ok: true, url: location.origin + location.pathname + '#signed-in-at-' + a }; };
  AMV_API.remoteFinish = async (code, state) => { window.__rm.finished.push({ code, state }); window.__rm.apps.notion.connected = true; return { ok: true, app: 'notion', name: 'Notion' }; };
  AMV_API.remoteRemove = async (a) => { window.__rm.removed.push(a); window.__rm.apps[a].connected = false; return { ok: true, revoked: true, message: 'Disconnected.' }; };
  AMV_API.remoteTools = async (a) => { window.__rm.toolsAsked++; return { ok: true, app: a, name: 'Notion', tools: [{ name: 'search', description: 'Search pages', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] }; };
  AMV_API.remoteCall = async (a, tool, args) => { window.__rm.calls.push({ a, tool, args }); return { ok: true, isError: false, content: [{ type: 'text', text: 'found 3 pages' }] }; };
  rmcpReload();
});
await page.waitForTimeout(400);
const row = (n) => page.evaluate((name) => {
  _paintIntegrations();
  const c = [...document.querySelectorAll('#int-catalog .int-card')].find(x => (x.querySelector('.int-name') || {}).textContent === name);
  if (!c) return null;
  return { text: c.textContent, conn: (c.querySelector('[data-int-conn]') || {}).dataset || null, disc: !!c.querySelector('[data-int-disc]'),
           ok: !!c.querySelector('.int-ok'), notify: !!c.querySelector('[data-app-notify]') };
}, n);

section('An app with an official connector says Connect, and Connect goes to its sign-in');
{
  const r = await row('Notion');
  ok(r && r.conn && r.conn.intConn === 'rmcp' && r.conn.intPreset === 'notion' && !r.notify, 'Notion has Connect, not Notify me', r);
  const canva = await row('Canva');
  ok(canva && canva.conn && canva.conn.intPreset === 'canva', 'and so does Canva', canva);
  /* Work & projects has more apps that connect than fit before Show all. */
  await page.evaluate(() => { _appOpen.add('work'); _appOpen.add('dev'); });
  const jira = await row('Jira'), conf = await row('Confluence');
  ok(jira && conf && jira.conn.intPreset === 'atlassian' && conf.conn.intPreset === 'atlassian', 'Jira and Confluence share their one Atlassian sign-in', [jira && jira.conn, conf && conf.conn]);
  const went = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('#int-catalog [data-int-conn="rmcp"][data-int-preset="notion"]')][0];
    b.click(); await new Promise(r => setTimeout(r, 300));
    return { started: window.__rm.started, hash: location.hash };
  });
  ok(went.started.length === 1 && went.started[0].a === 'notion' && /^https?:\/\/[^/]+\/?$/.test(went.started[0].redirect.replace(/index\.html$/, '')), 'the server is asked to start Notion, returning here', went.started);
  ok(went.hash === '#signed-in-at-notion', 'and the page goes to the address it handed back', went.hash);
}

section('Coming back finishes the app sign-in, and a Connected account return is not taken');
{
  const r = await page.evaluate(async () => {
    const realConn = window._connectFinish; const seen = [];
    window._connectFinish = (c, s) => seen.push({ c, s });
    history.replaceState(null, '', location.pathname + '?code=abc&state=r_xyz');
    checkOAuthCallback();
    await new Promise(r => setTimeout(r, 400));
    const afterApp = { finished: window.__rm.finished.slice(), search: location.search, conn: seen.length };
    history.replaceState(null, '', location.pathname + '?code=def&state=c_uvw');
    checkOAuthCallback();
    await new Promise(r => setTimeout(r, 100));
    const afterConn = { finished: window.__rm.finished.length, conn: seen.slice() };
    history.replaceState(null, '', location.pathname + '?code=ghi&state=zzz');
    checkOAuthCallback();
    const untouched = location.search;
    history.replaceState(null, '', location.pathname);
    window._connectFinish = realConn;
    return { afterApp, afterConn, untouched };
  });
  ok(r.afterApp.finished.length === 1 && r.afterApp.finished[0].state === 'r_xyz' && r.afterApp.conn === 0, 'an r_ return finishes the app sign-in only', r.afterApp);
  ok(r.afterApp.search === '', 'and the code is taken out of the address bar', r.afterApp.search);
  ok(r.afterConn.finished === 1 && r.afterConn.conn.length === 1 && r.afterConn.conn[0].s === 'c_uvw', 'a c_ return still goes to Connected accounts', r.afterConn);
  ok(r.untouched === '?code=ghi&state=zzz', 'and a return that is neither is left alone', r.untouched);
  await page.evaluate(() => setTab('integrations'));
  await page.waitForTimeout(300);
  const n = await row('Notion');
  ok(n && n.ok && n.disc && /ask for it in chat/i.test(n.text), 'Notion now shows connected, with Disconnect', n);
}

section('Chat is offered the app’s tools, named after it, and Build is not');
{
  const r = await page.evaluate(async () => {
    await remoteRefreshTools();
    const chat = mcpTools({ bridge: false, remote: true });
    const build = mcpTools();
    const t = chat.find(x => /search$/.test(x.name));
    return { chat: chat.map(x => x.name), build: build.map(x => x.name), desc: t && t.description, who: t && mcpToolIdentity(t.name),
             shape: t && /^mcp__[a-z0-9_-]{1,40}__[A-Za-z0-9_-]{1,60}$/.test(t.name) };
  });
  ok(r.chat.length === 1 && r.shape, 'the tool is offered to chat under a name the server admits', r.chat);
  ok(/^\[Notion\]/.test(r.desc || ''), 'and says which app it comes from', r.desc);
  ok(r.build.length === 0, 'Build’s loop, which asks once per turn, is not given it', r.build);
  ok(r.who && r.who.remote && r.who.name === 'Notion', 'its identity is the app, for the consent dialog', r.who);
}

section('Each call is asked for in the app’s name, with its arguments, and runs through the server');
{
  const r = await page.evaluate(async () => {
    const name = mcpTools({ bridge: false, remote: true })[0].name;
    const needs = _toolNeedsConsent(name);
    let shown = null;
    const real = window._showModalAsync;
    window._showModalAsync = async (o) => { shown = o; return true; };
    let allowed;
    try { allowed = await _confirmModelTool(name, { q: 'quarterly roadmap' }); } finally { window._showModalAsync = real; }
    const out = await runMcpTool(name, { q: 'quarterly roadmap' });
    return { needs, allowed, title: shown && shown.title, body: shown && shown.body, out, calls: window.__rm.calls };
  });
  ok(r.needs === true, 'every call needs consent', r.needs);
  ok(/your Notion account/.test(r.title || '') && /search/.test(r.title || ''), 'the question names the app and the tool', r.title);
  ok(/quarterly roadmap/.test(r.body || ''), 'and shows the arguments', (r.body || '').slice(0, 200));
  ok(r.calls.length === 1 && r.calls[0].a === 'notion' && r.calls[0].tool === 'search' && r.calls[0].args.q === 'quarterly roadmap', 'the call goes to the server for that app', r.calls);
  ok(r.out.ok && r.out.text === 'found 3 pages', 'and its result comes back to chat', r.out);
}

section('A sign-in the app stopped accepting says so, and offers Connect again');
{
  await page.evaluate(() => { window.__rm.apps.notion.broken = true; return rmcpReload(); });
  const n = await row('Notion');
  ok(n && !n.ok && n.conn && n.conn.intConn === 'rmcp' && /signing in again/i.test(n.text), 'it says it needs signing in again, with Connect', n);
  await page.evaluate(() => { window.__rm.apps.notion.broken = false; return rmcpReload(); });
}

section('Disconnecting asks first, and then the row is Connect again');
{
  const r = await page.evaluate(async () => {
    const real = window.showConfirmAsync; window.showConfirmAsync = async () => true;
    try { await rmcpDisconnect('notion'); } finally { window.showConfirmAsync = real; }
    return { removed: window.__rm.removed, tools: mcpTools({ bridge: false, remote: true }).length };
  });
  ok(r.removed.length === 1 && r.removed[0] === 'notion', 'the server was asked to disconnect it', r.removed);
  ok(r.tools === 0, 'and chat no longer offers its tools', r.tools);
  const n = await row('Notion');
  ok(n && !n.ok && n.conn, 'the row offers Connect again', n);
}

section('An app with a public API: Connect loads what it needs, and chat calls its API through the server');
{
  const r = await page.evaluate(async () => {
    const seen = { api: [] };
    const list = (connected) => ({ ok: true, configured: true,
      items: connected ? [{ id: 'slack:1', provider: 'slack', name: 'Slack', scopes: ['slack.read'], at: Date.now(), unattended: true }] : [],
      providers: [{ id: 'slack', name: 'Slack', ready: true, scopes: ['slack.read', 'slack.write'], api: 'https://slack.com/api/' },
                  { id: 'spotify', name: 'Spotify', ready: false, scopes: ['spotify.read'], api: 'https://api.spotify.com/v1/' }] });
    AMV_API.connectList = async () => list(window.__slackOn);
    AMV_API.connectApi = async (provider, method, path, query, body) => { seen.api.push({ provider, method, path, query, body }); return { ok: true, status: 200, body: '{"ok":true,"channels":[]}' }; };
    window.__slackOn = false;
    connReload(); await new Promise(r => setTimeout(r, 300));
    _appOpen.add('messaging');
    _paintIntegrations(); await new Promise(r => setTimeout(r, 100));
    const row = (n) => [...document.querySelectorAll('#int-catalog .int-card')].find(x => (x.querySelector('.int-name') || {}).textContent === n);
    const slack = row('Slack'), btn = slack && slack.querySelector('[data-int-conn]');
    const out = { conn: btn && btn.dataset.intConn, preset: btn && btn.dataset.intPreset };
    out.addRow = [...document.querySelectorAll('#conn-body .conn-add')].map(b => b.textContent);
    out.darkLine = (document.querySelector('#conn-body') || {}).textContent || '';
    /* Connect with the list NOT loaded: it loads it, then opens the sign-in choice. */
    _connState.state = 'idle'; _connState.data = null;
    connAddWhenReady('slack');   /* not awaited: it resolves when somebody picks */
    await new Promise(r => setTimeout(r, 600));
    out.picker = !!document.getElementById('conn-go');
    document.getElementById('ovr').innerHTML = '';
    window.__slackOn = true; connReload(); await new Promise(r => setTimeout(r, 300));
    await remoteRefreshTools();
    const t = mcpTools({ bridge: false, remote: true }).find(x => /api-slack/.test(x.name));
    out.tool = t && t.name; out.desc = t && t.description; out.build = mcpTools().some(x => /api-slack/.test(x.name));
    out.who = t && mcpToolIdentity(t.name);
    out.res = t ? await runMcpTool(t.name, { method: 'GET', path: 'conversations.list', query: { limit: 5 } }) : null;
    out.api = seen.api;
    return out;
  });
  ok(r.conn === 'prov' && r.preset === 'slack', 'Slack has Connect, through its own sign-in', r);
  ok(r.addRow.length === 1 && /Slack/.test(r.addRow[0]) && /1 more become available/.test(r.darkLine), 'the add row shows only what is set up here, and counts the rest', [r.addRow, r.darkLine.slice(-80)]);
  ok(r.picker, 'Connect loads the list first and opens the sign-in choice, rather than doing nothing', r.picker);
  ok(r.tool === 'mcp__api-slack__request' && /https:\/\/slack\.com\/api\//.test(r.desc || ''), 'chat is offered Slack\u2019s API, with its address', r.tool);
  ok(!r.build, 'and Build\u2019s loop is not', r.build);
  ok(r.who && r.who.name === 'Slack' && r.who.remote, 'named Slack for the consent dialog', r.who);
  ok(r.api.length === 1 && r.api[0].provider === 'slack' && r.api[0].method === 'GET' && r.api[0].path === 'conversations.list' && r.api[0].query.limit === 5, 'the call goes to the server, for Slack, as asked', r.api);
  ok(r.res && r.res.ok && /^HTTP 200/.test(r.res.text), 'and its answer comes back to chat', r.res);
}

section('A computer connector cannot take an app’s name');
{
  const r = await page.evaluate(() => ['app-notion', 'api-slack'].map(n => { try { _mcpAdd(n, 'npx', ['x']); return 'added'; } catch (e) { return e.message; } }));
  ok(r.every(m => /reserved/i.test(m)), 'names starting with app- or api- are refused', r);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
