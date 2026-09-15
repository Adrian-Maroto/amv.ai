/* THE BUTTON WAS A LABEL.

   The founder dashboard's user list renders a Manage button for every account:
   `<button class="adm-user-act" data-admuser="...">Manage</button>`. It has a
   style, it has a hover state, and it had no click handler - and nothing
   anywhere in the bundle read data-admuser. A control on the owner's own screen,
   next to the account it names, that did nothing when pressed.

   /v1/admin/user answers three things: inspect by default, setPlan, and revoke.
   This wires the INSPECT, which is what "Manage" can honestly do without making
   a decision for somebody: entitlement, team, and the usage counters that
   account actually spends against.

   setPlan grants a paid plan and revoke signs somebody out of every device.
   Both are real and both are the owner's to switch on deliberately, so this
   file also asserts they are NOT offered - a later change that quietly adds a
   plan-granting control here should have to delete an assertion that says why.

   Driven through renderAdminView, which is the view that renders this list. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;
await app.connect();

let lastBody = null;
await page.evaluate(() => { window.__calls = []; });
await app.stubFetch(async (u, o) => {
  window.__calls.push({ url: String(u), body: o && o.body ? String(o.body) : '' });
  if (/\/admin\/users\?/.test(u)) {
    return new Response(JSON.stringify({
      users: [{ email: 'sam@example.com', name: 'Sam', plan: 'pro',
                createdAt: Date.now(), monthCostUSD: 2.5 }],
      total: 1, hasMore: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (/\/v1\/admin\/user$/.test(u)) {
    return new Response(JSON.stringify({
      ok: true, email: 'sam@example.com',
      entitlement: { plan: 'elite', source: 'stripe' },
      team: null,
      usage: { dayTokens: 1234, monthTokens: 98765, monthCostUSD: 2.5,
               subject: 'sam@example.com', shared: false },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }),
                      { status: 200, headers: { 'content-type': 'application/json' } });
});

const openList = () => page.evaluate(async () => {
  S.user = { name: 'Owner', email: OWNER_EMAIL, ini: 'O' };
  S._adminTab = 'users';
  renderAdminView();
  await new Promise(r => setTimeout(r, 1500));
  return !!document.querySelector('[data-admuser]');
});

section('Manage opens what the server says about that account');
{
  const listed = await openList();
  ok(listed === true, 'the user list renders a Manage button', listed);

  const r = await page.evaluate(async () => {
    const btn = document.querySelector('[data-admuser]');
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    const ovr = document.getElementById('ovr');
    const text = (ovr.innerText || '').trim();
    return {
      panel: !!document.querySelector('.admu-grid'),
      text,
      asked: (window.__calls || []).filter(c => /\/v1\/admin\/user$/.test(c.url)),
    };
  });
  ok(r.panel === true, 'pressing it opens a panel, rather than doing nothing', r.text.slice(0, 80));
  ok(r.asked.length === 1, 'and it asked the server exactly once', r.asked.length);
  ok(/"email":"sam@example.com"/.test((r.asked[0] || {}).body || ''),
     'about the account whose row was pressed', r.asked[0] || null);
  /* The figures are the server's. Each one is asserted separately because a
     panel that renders the right SHAPE from the wrong field is the defect the
     response-shapes stage exists for. */
  ok(/elite/.test(r.text), 'the plan shown is the one the server returned', r.text.slice(0, 120));
  ok(/stripe/.test(r.text), 'including where it came from', r.text.slice(0, 120));
  ok(/1,234/.test(r.text), "today's tokens are the server's number", r.text.slice(0, 200));
  ok(/98,765/.test(r.text), "and the month's", r.text.slice(0, 200));
  ok(/\$2\.50/.test(r.text), 'as is the cost', r.text.slice(0, 200));
  /* NOT the row's own plan, which said pro. If the panel were reading the list
     it would show pro and look completely plausible. */
  ok(!/\bpro\b/i.test(r.text),
     'the panel reads the server, not the row it was opened from', r.text.slice(0, 200));
}

section('The two actions that change an account are not offered here');
{
  const r = await page.evaluate(() => {
    const ovr = document.getElementById('ovr');
    const text = (ovr.innerText || '');
    const buttons = [...ovr.querySelectorAll('button')].map(b => (b.textContent || '').trim());
    return { text, buttons };
  });
  ok(!r.buttons.some(b => /plan|upgrade|downgrade|comp|grant/i.test(b)),
     'nothing here grants a plan', r.buttons);
  ok(!r.buttons.some(b => /revoke|sign out|log out/i.test(b)),
     'and nothing signs the account out everywhere', r.buttons);
  ok(/not offered here/i.test(r.text),
     'and the panel says so rather than leaving it a mystery', r.text.slice(-90));
}

section('A server that refuses says so');
{
  await app.stubFetch(async (u) => {
    if (/\/admin\/users\?/.test(u)) {
      return new Response(JSON.stringify({
        users: [{ email: 'sam@example.com', name: 'Sam', plan: 'pro', createdAt: Date.now() }],
        total: 1, hasMore: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/\/v1\/admin\/user$/.test(u)) {
      return new Response(JSON.stringify({ error: 'forbidden' }),
                          { status: 403, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }),
                        { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await page.evaluate(() => { const r = document.getElementById('ovr'); if (r) r.innerHTML = ''; });
  await openList();
  const r = await page.evaluate(async () => {
    const toasts = [];
    const real = window.toast;
    window.toast = (m, k, d) => { toasts.push(String(m)); try { return real(m, k, d); } catch (e) {} };
    const btn = document.querySelector('[data-admuser]');
    const label = (btn.textContent || '').trim();
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    return { toasts, panel: !!document.querySelector('.admu-grid'),
             label, backTo: (btn.textContent || '').trim(), disabled: btn.disabled };
  });
  ok(r.panel === false, 'a refused read opens no panel', r);
  ok(r.toasts.some(t => /could not be read/i.test(t)),
     'it says the account could not be read', r.toasts);
  ok(r.toasts.some(t => /forbidden|403/i.test(t)),
     'and passes on the reason rather than swallowing it', r.toasts);
  ok(r.disabled === false && /Manage/.test(r.backTo),
     'and the button is usable again afterwards', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
