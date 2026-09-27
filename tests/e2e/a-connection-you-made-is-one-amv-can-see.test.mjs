/* THE CONNECTORS ASKED A DRAWER NOBODY WRITES TO ANY MORE.

   This is LESSONS 435 again, on the other side of the wire. There it was a KV
   kind read after its writer was replaced; here it is seven localStorage keys.

   The browser used to run the OAuth itself and keep the token: amv_github,
   amv_slack, amv_outlook, amv_discord, amv_linear, amv_notion, amv_vscode.
   The server took the whole handshake over - _OAUTH_COMPLETABLE is empty and
   the comment on it explains that is deliberate - so nothing writes any of
   those keys anywhere in the bundle. The catalogue kept reading them.

   A connection check that can only answer "no" is not a visible fault. It is
   indistinguishable from the product: somebody who really had connected GitHub
   through Connected accounts saw a Connect button, no Disconnect, and no way
   to run anything. The tools underneath had already been moved to the server -
   the comment on github_list_issues names this exact symptom - and the two
   questions ABOUT them were left behind.

   And the second half, which the first half hides: the server calls it
   `microsoft`, the catalogue calls the row `outlook`, and nothing translated.
   So _connOwnsProvider('outlook') was false, and pressing Connect on Microsoft
   365 skipped Connected accounts and answered "it needs its API key added by
   the operator" - about the one non-Google provider fully built on the server.

   Driven against a stubbed _connState rather than the source, because the
   claim is about what the ROW RENDERS, not about which expression it holds. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* What the real endpoint answers: the three providers the Worker's
   CONN_PROVIDERS actually defines, and a GitHub grant this account holds. */
const serve = (items) => page.evaluate((items) => {
  _connState.data = {
    configured: true,
    providers: [{ id: 'google', name: 'Google', ready: true },
                { id: 'microsoft', name: 'Microsoft', ready: true },
                { id: 'github', name: 'GitHub', ready: true }],
    items,
  };
  const html = _integrationsCatalogHTML();
  const d = document.createElement('div'); d.innerHTML = html;
  const row = (id) => {
    const c = [...d.querySelectorAll('.int-card')].find(x =>
      x.querySelector('[data-int-conn="' + id + '"],[data-int-disc="' + id + '"]'));
    if (!c) return 'no-row';
    return c.querySelector('[data-int-disc="' + id + '"]') ? 'connected' : 'not-connected';
  };
  const cap = (id) => {
    const c = TASK_CAPABILITIES.find(c => c.id === id);
    return c ? !!c.isConnected() : null;
  };
  return {
    rows: { github: row('github'), outlook: row('outlook'), google: row('google'),
            slack: row('slack'), discord: row('discord'), linear: row('linear'),
            notion: row('notion') },
    caps: { github: cap('github'), gmail: cap('gmail') },
    routing: { outlookId: _provIdFor('outlook'),
               ownsOutlook: _connOwnsProvider(_provIdFor('outlook')),
               ownsGithub: _connOwnsProvider(_provIdFor('github')) },
  };
}, items);

section('A grant the server holds shows as connected');
{
  const r = await serve([
    { provider: 'github', unattended: true, broken: false, scopes: ['repo.read', 'issues.write'] },
    { provider: 'microsoft', unattended: true, broken: false, scopes: ['mail.read'] },
  ]);
  ok(r.rows.github === 'connected',
     'a connected GitHub account makes the GitHub row connected', r.rows);
  ok(r.rows.outlook === 'connected',
     'and a Microsoft grant reaches the row the catalogue calls Outlook', r.rows);
  ok(r.caps.github === true,
     'the capability check agrees, so AMV may be asked to touch GitHub', r.caps);
}

section('And no grant means no, for the same reason rather than by accident');
{
  const r = await serve([]);
  ok(r.rows.github === 'not-connected', 'no grant, no GitHub tick', r.rows);
  ok(r.rows.outlook === 'not-connected', 'no grant, no Microsoft tick', r.rows);
  ok(r.caps.github === false, 'and the capability says no', r.caps);
}

section('A broken or attended grant is not a connection AMV can act on');
{
  const broken = await serve([
    { provider: 'github', unattended: true, broken: true, scopes: ['repo.read'] }]);
  ok(broken.rows.github === 'not-connected',
     'a broken grant does not show as connected', broken.rows);
  const attended = await serve([
    { provider: 'github', unattended: false, broken: false, scopes: ['repo.read'] }]);
  /* This used to assert the opposite: a grant that ends with the tab "cannot
     be asked to". The server's action route calls connUse with attended:true,
     so it DOES act on that grant while somebody is here - and the capability
     list is asked only by chat and the runner, both of which have somebody
     here. The no was wrong; Crew's own check (_cwConnHas) keeps the stricter
     question for work that runs with AMV closed. */
  ok(attended.caps.github === true,
     'and one that ends with the tab can be asked to while the tab is open', attended.caps);
  ok((await page.evaluate(() => _cwConnHas('repo.read'))) === false,
     'while Crew still will not plan on it overnight');
}

section('The row id is translated to the provider the server knows');
{
  const r = await serve([]);
  ok(r.routing.outlookId === 'microsoft',
     'the outlook row asks about microsoft', r.routing);
  ok(r.routing.ownsOutlook === true,
     'so Connect on Microsoft 365 routes into Connected accounts', r.routing);
  ok(r.routing.ownsGithub === true,
     'and GitHub does too', r.routing);
}

section('Nothing answers a connection question from a key with no writer');
{
  /* The keys themselves. Written nowhere in the bundle, so any expression that
     reads one to decide whether something is connected can only answer no.

     Both spellings are checked - isConn('k') and a bare loadStr('k') - because
     the first draft of this only knew the second, and the mutation that put
     the defect back used the first and walked straight past it. A source check
     can only say a line is absent; it is worth having only if it knows every
     way the line can be written. */
  const dead = await page.evaluate(async () => {
    const src = await (await fetch('app.js')).text().catch(() => '');
    if (!src) return null;
    const keys = ['amv_github', 'amv_slack', 'amv_outlook', 'amv_discord',
                  'amv_linear', 'amv_notion', 'amv_vscode'];
    const out = {};
    const count = (re) => (src.match(re) || []).length;
    for (const k of keys) {
      out[k] = {
        writes: count(new RegExp("(saveStr|store)\\( *'" + k + "'", 'g')),
        asksConnected:
          count(new RegExp("connected: *(!!? *)?(isConn|loadStr)\\( *'" + k + "'", 'g')) +
          count(new RegExp("isConnected: *\\( *\\) *=> *(!!? *)?(isConn|loadStr)\\( *'" + k + "'", 'g')),
      };
    }
    return out;
  });
  /* NO EXCEPTIONS LEFT.

     amv_slack used to be the one, excused per reader because "not connected"
     was then the true answer: there was no Slack sign-in anywhere. That stopped
     being true when Slack became a server-held sign-in, and the excuse became
     the defect - Slack connected, and the capability still said no. It asks the
     server's list now, like GitHub. */
  ok(dead !== null, 'the built bundle was readable to check', dead);
  if (dead) {
    for (const [k, v] of Object.entries(dead)) {
      ok(!(v.writes === 0 && v.asksConnected > 0),
         k + ' is not used to answer "is it connected" while nothing writes it',
         { k, ...v });
    }
  }
}

section('A server-held Slack or GitHub sign-in is one the runner can use');
{
  const r = await page.evaluate(() => {
    const saved = _connState.data;
    const wasLive = AMV_API.live;
    const cap = TASK_CAPABILITIES.find(c => c.id === 'slack');
    const out = {};
    _connState.data = { items: [] };
    out.none = { slack: cap.isConnected(), gh: AMVConnectors.live('github'), sl: AMVConnectors.live('slack') };
    _connState.data = { items: [{ id: 'c1', provider: 'slack', scopes: ['slack.read'] }] };
    out.readOnly = cap.isConnected();
    _connState.data = { items: [{ id: 'c1', provider: 'slack', scopes: ['slack.read', 'slack.write'] },
                                { id: 'c2', provider: 'github', scopes: ['repo.read'] }] };
    out.both = { slack: cap.isConnected(), gh: AMVConnectors.live('github'), sl: AMVConnectors.live('slack') };
    _connState.data = { items: [{ id: 'c1', provider: 'slack', scopes: ['slack.write'], broken: 'revoked' }] };
    out.broken = cap.isConnected();
    _connState.data = saved;
    return out;
  });
  ok(!r.none.slack && !r.none.gh && !r.none.sl, 'nothing connected, nothing live', r.none);
  ok(r.readOnly === false, 'a Slack sign-in without the post permission cannot post', r.readOnly);
  ok(r.both.slack && r.both.gh && r.both.sl, 'a real sign-in is seen by the capability and the registry', r.both);
  ok(r.broken === false, 'a broken sign-in is not connected', r.broken);
}
{
  /* The runner's own list of tools - what the model is told it may use. It
     asked loadStr('amv_'+needs) too, so the GitHub and Slack tools were never
     offered to anybody. */
  const r = await page.evaluate(async () => {
    const saved = _connState.data, realAi = window.aiComplete;
    const realLive = Object.getOwnPropertyDescriptor(AMV_API, 'live');
    Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
    let sys = '';
    window.aiComplete = async (i, s) => { sys = s; return '[]'; };
    const out = {};
    try {
      _connState.data = { items: [{ id: 'c1', provider: 'slack', scopes: ['slack.write'] },
                                  { id: 'c2', provider: 'github', scopes: ['repo.read'] }] };
      await runAgentTask('post the release notes');
      out.connected = { slack: /slack_post/.test(sys), gh: /github_list_issues/.test(sys) };
      _connState.data = { items: [{ id: 'c2', provider: 'github', scopes: ['repo.read'] }] };
      sys = '';
      await runAgentTask('post the release notes');
      out.githubOnly = { slack: /slack_post/.test(sys), gh: /github_list_issues/.test(sys) };
    } finally {
      _connState.data = saved; window.aiComplete = realAi;
      Object.defineProperty(AMV_API, 'live', realLive);
    }
    return out;
  });
  ok(r.connected && r.connected.slack && r.connected.gh,
     'with Slack and GitHub connected, the runner offers their tools', r.connected);
  ok(r.githubOnly && !r.githubOnly.slack && r.githubOnly.gh,
     'and it offers only what is connected', r.githubOnly);
}

section('An app that connects is not called unavailable');
{
  /* Notion, Linear, Microsoft, Discord, Canvas and Stripe were listed as "not
     currently available in AMV" after every one of them could be connected.
     The runner still cannot drive them, so it says where they do work. */
  const r = await page.evaluate(() => {
    const notion = analyzeTaskIntent('add these notes to my notion page');
    const tweet = analyzeTaskIntent('tweet the launch');
    const algebra = analyzeTaskIntent('explain linear algebra');
    return { notion, notionMsg: taskRequirementMessage(notion), tweetMsg: taskRequirementMessage(tweet), algebra };
  });
  ok(r.notion.matched && !r.notion.ready && r.notion.unsupported.length === 0 && r.notion.inChat.length === 1,
     'Notion is recognised as working in chat, not as missing', r.notion);
  ok(!/not currently available/i.test(r.notionMsg) && /works in chat/i.test(r.notionMsg),
     'and the message says where to ask', r.notionMsg);
  ok(/not currently available/i.test(r.tweetMsg), 'while an app with no route still says so', r.tweetMsg);
  ok(!r.algebra.matched, 'and "linear" in a maths question is not the Linear app', r.algebra);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
