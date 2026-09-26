/* SETTINGS: SIX SHORT SECTIONS, AND EVERY OLD ADDRESS STILL WORKS.

   History: eighteen panes with a group called "the rest" (AMV-D009), then
   thirteen, then nine under four headings - and then the owner: "Fix
   settings. WAY TOO MUCH." They chose six sections. What follows is kept for
   the rules it still holds.

   Originally - EIGHTEEN PANES, AND A GROUP CALLED "THE REST".

   Measured before anything moved. The groups already existed and did no work:
   General held TWELVE of the eighteen user panes, Workspace held one. A group
   holding two-thirds of everything is a list with a title on it.

   Five merges, each of two panes answering the same question - privacy with
   security, billing with usage, capabilities with skills, appearance with
   language, and invite folded into Team because it was 180 characters and no
   controls at all: a button on the Team pane that had been given its own
   address.

   The part that matters most is not the count. `S.settingsPane` is set BY NAME
   from at least six places in the product - Mission Control's connect link, the
   marketplace pay button, the team invite flow, the profile menu - so a retired
   id that stopped resolving would be a dead link somewhere nobody would think
   to look. Every one of them still works, still highlights the right row, and
   still lands on the half it asked for. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('Six short sections, in the order the owner chose');
{
  /* "Fix settings. WAY TOO MUCH." Nine sections under four headings became the
     six the owner picked. Six need no headings - a heading over two items is a
     label read twice - so none are drawn for a person; the operator group is
     still there, and only for the owner. */
  const g = await page.evaluate(() => ({
    ids: USER_SET_SECTIONS.filter(s => s.id).map(s => s.id),
    labels: USER_SET_SECTIONS.filter(s => s.id).map(s => s.label),
    groups: USER_SET_SECTIONS.filter(s => s.group !== undefined).length,
    navGroups: (renderSettingsView(), document.querySelectorAll('.sn-group').length),
  }));
  ok(JSON.stringify(g.ids) === JSON.stringify(['account','billing','family','integrations','privacy','appearance']),
     'Account, Plan & billing, Family, Connectors, Privacy, Appearance', g.ids);
  ok(JSON.stringify(g.labels) === JSON.stringify(['Account','Plan & billing','Family','Connectors','Privacy','Appearance']),
     'named as a person would look for them', g.labels);
  ok(g.groups === 0 && g.navGroups === 0, 'and no headings over them', g);
}

section('Every old address still goes where its content now lives');
{
  /* `S.settingsPane` is set BY NAME from many places in the product - Mission
     Control's connect link, the marketplace, the team invite flow, the profile
     menu. A retired id that stopped resolving is a dead link somewhere nobody
     would think to look. Each one lands on the section that now holds it, with
     that row lit, and opens the folded part it asked for. */
  const want = { security:'Privacy', usage:'Plan & billing', skills:'Connectors', language:'Appearance',
                 invite:'Account', teamset:'Account', about:'Account', capabilities:'Privacy',
                 api:'Connectors', projects:'Account' };
  const r = await page.evaluate(async (want) => {
    const out = [];
    for (const id of Object.keys(want)) {
      S.settingsPane = id; renderSettingsView();
      await new Promise(s => setTimeout(s, 350));
      const on = [...document.querySelectorAll('.sn-btn.on')].map(b => b.textContent.trim()).join('|');
      const anchor = document.getElementById('set-sec-' + id);
      const fold = anchor && anchor.closest('details');
      out.push({ id, on, anchored: !!anchor, openIfFolded: !fold || fold.open,
                 visible: !!(anchor && anchor.getClientRects().length) });
    }
    return out;
  }, want);
  for (const x of r) {
    ok(x.on === want[x.id], x.id + ' lights ' + want[x.id], x.on);
    ok(x.anchored && x.visible, 'and its part is on screen', x);
    ok(x.openIfFolded, 'opened, if it was folded', x);
  }
}

section('Each section fits: the secondary parts are one tap away');
{
  const r = await page.evaluate(async () => {
    const out = {};
    for (const id of ['account','billing','family','integrations','privacy','appearance']) {
      S.settingsPane = id; renderSettingsView();
      await new Promise(s => setTimeout(s, 350));
      const p = document.getElementById('set-pane');
      out[id] = { chars: p.innerText.length, folds: p.querySelectorAll('details.set-fold').length };
    }
    return out;
  });
  /* Measured before: Account 3,111 characters, Connectors 5,234 (the whole
     integrations catalogue a second time), Privacy 2,075. A ceiling set well
     above what they are now, so it trips on a regression and not on a word. */
  ok(r.account.chars < 1500 && r.account.folds >= 3, 'Account is short, with Team, projects and About folded', r.account);
  ok(r.integrations.chars < 1500, 'Connectors lists what is connected, not the catalogue again', r.integrations);
  ok(r.privacy.chars < 2000 && r.privacy.folds >= 1, 'Privacy folds the password and security detail', r.privacy);
  const fold = await page.evaluate(async () => {
    S.settingsPane = 'account'; renderSettingsView();
    await new Promise(s => setTimeout(s, 350));
    const d = document.querySelector('#set-pane details.set-fold');
    const closedH = d.getBoundingClientRect().height;
    d.querySelector('summary').click();
    await new Promise(s => setTimeout(s, 100));
    return { closedH, open: d.open, openH: d.getBoundingClientRect().height };
  });
  ok(fold.open && fold.openH > fold.closedH + 40, 'and a folded part opens in place when tapped', fold);
}

section('It still works on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await page.evaluate(async () => {
    S.settingsPane = 'security'; renderSettingsView();
    await new Promise(s => setTimeout(s, 400));
    const pane = document.getElementById('set-pane');
    const picker = document.getElementById('set-picker');
    const right = [...pane.querySelectorAll('*')].reduce((a, e) => Math.max(a, e.getBoundingClientRect().right), 0);
    return { picker: picker ? picker.textContent.trim() : '',
             overflow: Math.round(right - pane.getBoundingClientRect().right),
             chars: (pane.textContent || '').trim().length };
  });
  ok(/Privacy/.test(r.picker), 'the phone picker names the section it lives in', r.picker);
  ok(r.overflow <= 1, 'and nothing spills off the screen', r.overflow);
  ok(r.chars > 300, 'with the pane actually rendered', r.chars);
  await page.setViewportSize({ width: 1440, height: 900 });
}

section('Every pane behaves on a phone')
{
  /* THE RULE, NOT A PROXY FOR IT.

     A sweep asking "is any element wider than its container" reported the API
     keys pane overflowing by 40px, and it was wrong: the culprit was a <code>
     inside a <pre class="ak-code"> that carries `overflow-x:auto`. A code block
     scrolling inside itself is the CORRECT behaviour and fails that question
     every time.

     What the standard actually says is that the page body must never scroll
     sideways. That is what is asked here. Same for tap targets: the number that
     matters is the 40px this product promises, measured on the control. */
  await page.setViewportSize({ width: 390, height: 844 });
  const panes = await page.evaluate(() => USER_SET_SECTIONS.filter(s => s.id).map(s => s.id));
  /* A floor on the SAMPLE, not on the product: this sweep visits every pane
     and would pass vacuously if there were almost none to visit. Eight is
     still a real sweep. */
  ok(panes.length >= 6, 'there are sections to sweep', panes.length);

  const bad = [];
  const small = [];
  for (const id of panes) {
    const m = await page.evaluate(async (id) => {
      S.settingsPane = id; renderSettingsView();
      await new Promise(s => setTimeout(s, 300));
      const p = document.getElementById('set-pane');
      const under = [...p.querySelectorAll('button,a[href],select,input:not([type=checkbox]):not([type=radio])')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && __under(r.height, 40); })
        .map(e => ((e.textContent || '').trim().slice(0, 16) || e.className.slice(0, 16))
                  + ':' + Math.round(e.getBoundingClientRect().height));
      return {
        pageScrolls: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        under,
      };
    }, id);
    if (m.pageScrolls > 0) bad.push(id + ' +' + m.pageScrolls + 'px');
    if (m.under.length) small.push(id + ': ' + m.under.slice(0, 4).join(', '));
  }
  ok(bad.length === 0, 'no settings pane makes the page scroll sideways', bad.join(' | '));
  ok(small.length === 0, 'and nothing interactive is under the 40px tap target', small.join(' | '));
  await page.setViewportSize({ width: 1440, height: 900 });
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
