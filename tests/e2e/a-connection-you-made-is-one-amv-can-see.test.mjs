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
  ok(attended.caps.github === false,
     'and one that cannot run unattended cannot be asked to', attended.caps);
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
  /* ONE EXCEPTION, NAMED, WITH ITS READER - not a key excused outright.

     amv_slack is still read by the Slack capability's isConnected, and nothing
     writes it. It is left because the answer it gives is TRUE: there is no
     Slack provider in the Worker's CONN_PROVIDERS, no slack_post on the
     server, and no flow anywhere that could produce the token - so "not
     connected" is the honest answer rather than a wrong one, which is what
     separates this from the GitHub case above it.

     What it is NOT is settled. Slack sits in TASK_CAPABILITIES, which is the
     list of things AMV says it can do once connected, next to a Connect button
     that cannot lead anywhere. Whether that entry belongs in
     PLANNED_CAPABILITIES instead is a product call about what AMV advertises,
     and it is the owner's, so it is recorded here rather than decided quietly.
     The exception is deliberately per READER: if a SECOND thing starts asking
     amv_slack whether Slack is connected, this fails. */
  const EXPECTED_DEAD_READERS = { amv_slack: 1 };
  ok(dead !== null, 'the built bundle was readable to check', dead);
  if (dead) {
    for (const [k, v] of Object.entries(dead)) {
      const allowed = EXPECTED_DEAD_READERS[k] || 0;
      ok(!(v.writes === 0 && v.asksConnected > allowed),
         k + ' is not used to answer "is it connected" while nothing writes it',
         { k, ...v, allowed });
    }
    ok(dead.amv_slack.asksConnected === EXPECTED_DEAD_READERS.amv_slack,
       'the one recorded exception still has exactly its one reader',
       dead.amv_slack);
  }
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
