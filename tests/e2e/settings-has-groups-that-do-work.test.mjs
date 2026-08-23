/* EIGHTEEN PANES, AND A GROUP CALLED "THE REST" (AMV-D009).

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

section('No group is a dumping ground any more');
{
  const g = await page.evaluate(() => {
    const out = {}; let cur = null;
    USER_SET_SECTIONS.forEach(s => {
      if (s.group !== undefined) { cur = s.group || '(divider)'; out[cur] = out[cur] || 0; return; }
      if (cur) out[cur]++;
    });
    return { groups: out, panes: USER_SET_SECTIONS.filter(s => s.id).length };
  });
  const counts = Object.entries(g.groups);
  ok(g.panes <= 13, 'eighteen user panes became thirteen or fewer', g.panes);
  ok(counts.every(([, n]) => n <= 3),
     'and no group holds more than three', JSON.stringify(g.groups));
  ok(!Object.keys(g.groups).includes('General'),
     'the group that meant "the rest" is gone', Object.keys(g.groups).join(', '));
  ok(counts.filter(([, n]) => n > 0).length >= 5,
     'the panes are spread across real groups', JSON.stringify(g.groups));
}

section('Every retired address still goes somewhere');
{
  /* The regression that would be invisible until a customer hit it: a deep
     link set from elsewhere in the product silently landing on Account. */
  const r = await page.evaluate(async () => {
    const out = [];
    for (const id of ['security', 'usage', 'skills', 'language', 'invite']) {
      S.settingsPane = id; renderSettingsView();
      await new Promise(s => setTimeout(s, 300));
      const pane = document.getElementById('set-pane');
      const on = [...document.querySelectorAll('.sn-btn.on')].map(b => b.textContent.trim());
      out.push({ id,
        chars: (pane ? pane.textContent : '').replace(/\s+/g, ' ').trim().length,
        nav: on.join('|'),
        anchored: !!document.getElementById('set-sec-' + id),
        onAccount: on.join('|') === 'Account' });
    }
    return out;
  });
  for (const x of r) {
    ok(!x.onAccount, x.id + ' does not silently fall back to Account', x.nav);
    ok(x.chars > 400, 'and renders a real pane rather than an empty one', x.id + ' ' + x.chars);
    ok(!!x.nav, 'with a row highlighted in the nav', x.id + ' -> ' + x.nav);
    ok(x.anchored, 'and an anchor to the half it asked for', x.id);
  }
}

section('A merge is two sections, not one of them absorbed');
{
  const r = await page.evaluate(async () => {
    const want = { privacy: 'Security', billing: 'Usage', capabilities: 'Skills',
                   appearance: 'Language', teamset: 'Invite' };
    const out = [];
    for (const host of Object.keys(want)) {
      S.settingsPane = host; renderSettingsView();
      await new Promise(s => setTimeout(s, 320));
      const m = document.querySelector('#set-pane .set-merged');
      const cs = m ? getComputedStyle(m) : null;
      out.push({ host, expect: want[host], merged: !!m,
        title: ((m && m.querySelector('.set-title')) || {}).textContent || '',
        seam: cs ? parseFloat(cs.borderTopWidth) : 0 });
    }
    return out;
  });
  for (const x of r) {
    ok(x.merged, x.host + ' carries its merged section', x.merged);
    ok(x.title.trim() === x.expect,
       'which keeps the heading it always had', x.host + ' -> "' + x.title.trim() + '"');
    ok(x.seam >= 1, 'and is separated, so it does not read as the page continuing', x.seam);
  }
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
  ok(/Privacy/.test(r.picker), 'the phone picker names the merged pane', r.picker);
  ok(r.overflow <= 1, 'and nothing spills off the screen', r.overflow);
  ok(r.chars > 400, 'with the pane actually rendered', r.chars);
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
  ok(panes.length >= 10, 'there are panes to sweep', panes.length);

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
