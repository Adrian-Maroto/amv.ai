/* TWO MORE PLACES A VALUE FROM SOMEBODY ELSE REACHED innerHTML RAW.

   Same class as the Crew icon, found by widening that search from template
   literals to the concatenation this codebase actually uses.

   1. THE PROJECT ICON. renderWsGrid wrote `ws.icon` straight into the card.
      `workspaces` is in _SYNC_KEYS, so that value goes to the server and
      merges back in from other devices - the local picker that sets it says
      nothing about what comes back. The same field was ALREADY read through
      _safeIcon in the project switcher, so the codebase disagreed with itself
      about one field, which is how this survived.

   2. THE MARKETPLACE KIND, AND THIS ONE IS AN ATTRIBUTE. The card built
      `class="mk-kind mk-kind-' + it.kind + '"`. The text beside it was escaped;
      the class was not. `kind` comes off the listing form and travels through
      the server to everybody browsing, so a crafted listing closes the quote
      and adds an attribute of its own on every viewer's card.

   Measured the same way as before: the assertion is that the markup is NOT IN
   THE DOM, not that it failed to run. The strict CSP stops the handler firing
   either way, which is why these are holes in the discipline rather than live
   exploits - and a test that only watched for execution would pass on a page
   with no CSP and an injected attribute sitting in it.

   Both are driven through the real render - the Projects grid inside Settings,
   and _mktBrowse against a stubbed AMVMarket.list - because the claim is about
   what those screens put on the page. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

const NASTY = '<img src=x onerror="window.__p=1">';
const ATTR = 'prompt" onmouseover="window.__q=1';

const r = await page.evaluate(async ({ NASTY, ATTR }) => {
  window.__p = 0; window.__q = 0;
  const out = {};

  S.settingsPane = 'projects'; setTab('settings');
  await new Promise(r => setTimeout(r, 600));
  out.gridExists = !!document.getElementById('ws-grid');
  S.workspaces = [{ id: 'ws1', name: 'Shared', icon: NASTY, desc: '',
                    created: Date.now(), convs: [] }];
  renderWsGrid();
  await new Promise(r => setTimeout(r, 300));
  const g = document.getElementById('ws-grid') || { innerHTML: '', querySelector: () => null };
  out.ws = {
    carried: S.workspaces[0].icon === NASTY,
    wsic: !!g.querySelector('.wsic'),
    img: !!g.querySelector('.wsic img'),
    raw: /onerror/i.test(g.innerHTML),
    text: (g.querySelector('.wsic') || { textContent: '' }).textContent.trim(),
  };

  AMVMarket.list = async () => ([{ id: 'm1', title: 'T', kind: ATTR, price: 0,
    author: 'a', rating: 0, ratings: 0, desc: 'd', icon: '📋', sales: 0 }]);
  const body = document.createElement('div');
  document.body.appendChild(body);
  _mktBrowse(body);
  await new Promise(r => setTimeout(r, 700));
  const span = body.querySelector('.mk-kind');
  out.kind = {
    rendered: !!span,
    cls: span ? String(span.getAttribute('class')) : null,
    brokeOut: !!body.querySelector('[onmouseover]'),
  };
  body.remove();

  await new Promise(r => setTimeout(r, 200));
  out.p = window.__p; out.q = window.__q;
  return out;
}, { NASTY, ATTR });

section('A project icon that arrived from a sync is not markup');
{
  ok(r.gridExists === true, 'the Projects grid is on screen to be measured', r.gridExists);
  /* Without this the rest could pass because nothing ever held the value. */
  ok(r.ws.carried === true, 'the hostile value really is on the workspace record', r.ws);
  ok(r.ws.wsic === true, 'the card renders its icon slot', r.ws);
  ok(r.ws.img === false, 'no tag is injected into it', r.ws);
  ok(r.ws.raw === false, 'and no handler attribute survives into the grid HTML', r.ws);
  ok(r.ws.text.length > 0 && r.ws.text.length < 14,
     'and an icon is still shown rather than nothing', r.ws);
}

section('A marketplace kind cannot break out of the class it is put in');
{
  ok(r.kind.rendered === true, 'the listing card renders its kind tag', r.kind);
  ok(r.kind.brokeOut === false,
     'no element gained an attribute the listing asked for', r.kind);
  /* The quote is INSIDE the class value rather than ending it - which is the
     difference between data and markup, and is what the escape buys. */
  ok((r.kind.cls || '').indexOf('onmouseover') > 0,
     'the whole string stayed inside the class, quote and all', r.kind);
}

section('Neither ran, which is the CSP and not the escaping');
{
  ok(r.p === 0 && r.q === 0, 'no injected handler fired', { p: r.p, q: r.q });
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
