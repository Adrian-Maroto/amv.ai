/* SETTINGS OPENS IN THE MIDDLE, OVER YOUR WORK, AND ENDS WHERE ITS ITEMS END.

   Asked for, first: "fix settings, make sure it actually looks good - there is
   a huge blank space below Platform, looks off - delete Apps and Extensions".
   Then: "make it when you click it, it opens in the middle", with search at the
   top of its list, and "you removed Teams, put it in the top right menu where
   Settings is - make sure it actually works".

   So Settings is a centred panel on top of the page, which stays underneath,
   dimmed. Its list is a column of that panel, so it is exactly as tall as the
   panel - no tall empty frame of its own below Platform. It closes on X or
   Esc, and the layer goes with it. A phone gets the whole screen. And the
   account menu has Team beside Settings, and Team opens. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'Adrian Maroto', email: 'kubikam@icloud.com', ini: 'A' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1280, height: 900 });
await page.evaluate(() => setTab('crew'));
await page.waitForTimeout(400);
await page.evaluate(() => setTab('settings'));
await page.waitForTimeout(600);

section('Settings opens in the middle, over the page it was opened from');
{
  const r = await page.evaluate(() => {
    const m = document.getElementById('set-modal'), sh = m && m.querySelector('.settings-shell');
    const b = sh ? sh.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    return { layer: !!m, fixed: m && getComputedStyle(m).position, dialog: m && m.getAttribute('role') + '/' + m.getAttribute('aria-modal'),
             w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), right: Math.round(innerWidth - b.right),
             top: Math.round(b.top), bottom: Math.round(innerHeight - b.bottom),
             under: !!document.querySelector('#vc > *') && !document.querySelector('#vc .settings-shell'),
             focus: document.activeElement && document.activeElement.id };
  });
  ok(r.layer && r.fixed === 'fixed' && r.dialog === 'dialog/true', 'a dialog layer on top of the page', r);
  ok(r.w < 1280 - 100 && r.h < 900 - 40, 'a panel smaller than the window, not the whole page', r);
  ok(Math.abs(r.left - r.right) <= 2 && Math.abs(r.top - r.bottom) <= 2, 'and centred both ways', r);
  ok(r.under, 'the page it was opened from is still there underneath', r);
  ok(r.focus === 'set-search', 'the keyboard lands in its search', r.focus);
}

section('Search sits at the top of the list, and the list ends with the panel');
{
  const r = await page.evaluate(() => {
    const nav = document.querySelector('#set-modal .settings-nav'), btns = [...nav.querySelectorAll('.sn-btn')];
    const s = nav.querySelector('.set-search').getBoundingClientRect(), first = btns[0].getBoundingClientRect();
    const n = nav.getBoundingClientRect(), shell = document.querySelector('#set-modal .settings-shell').getBoundingClientRect();
    return { lastLabel: btns[btns.length - 1].textContent.trim(), searchAbove: s.bottom <= first.top + 1,
             navBottom: Math.round(shell.bottom - n.bottom), navTop: Math.round(n.top - shell.top) };
  });
  ok(r.searchAbove, 'search comes before the first section', r);
  ok(r.lastLabel === 'Platform', 'the owner sees the operator sections, Platform last', r.lastLabel);
  ok(Math.abs(r.navBottom) <= 2 && Math.abs(r.navTop) <= 2, 'the list is a column of the panel - no frame of its own hanging below Platform', r);
  const find = (q) => page.evaluate(async (q) => {
    const si = document.getElementById('set-search'); si.focus(); si.value = q; si.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return { layer: !!document.getElementById('set-modal'), still: document.activeElement && document.activeElement.id,
             found: [...document.querySelectorAll('#set-modal .sn-btn')].map(b => b.dataset.sp) };
  }, q);
  for (const [q, want] of [['password', 'privacy'], ['language', 'appearance'], ['dark mode', 'appearance'], ['team', 'account'],
                           ['api keys', 'integrations'], ['invoice', 'billing'], ['export', 'privacy'], ['Platform', 'platform']]) {
    const r = await find(q);
    ok(r.layer && r.found[0] === want, 'searching "' + q + '" finds ' + want, r.found);
  }
  const typing = await find('passw');
  ok(typing.still === 'set-search', 'and the cursor stays in the search box while typing', typing.still);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => ({ pane: S.settingsPane, text: (document.querySelector('#set-modal .settings-content') || {}).textContent || '' }));
  ok(opened.pane === 'privacy' && /password/i.test(opened.text), 'Enter opens the section it found', opened.pane);
  const none = await find('zzqx');
  ok(none.found.length === 0 && /No settings match/.test(await page.evaluate(() => document.querySelector('#set-modal .settings-nav').textContent)), 'and a search that finds nothing says so', none);
  await find('');
}

section('Every word search answers to is really in that section');
{
  /* A search word that is not on the pane sends somebody to a section that is
     not about what they asked. Each one is checked against the pane drawn. */
  const bad = await page.evaluate(async () => {
    const out = [];
    for (const s of USER_SET_SECTIONS) {
      S.settingsPane = s.id; renderSettingsView(); await new Promise(r => setTimeout(r, 500));
      const t = ((document.querySelector('#set-modal .settings-content') || {}).textContent || '').toLowerCase();
      for (const w of (s.find || [])) if (!t.includes(w)) out.push(s.id + ':' + w);
      if (!(s.find || []).length) out.push(s.id + ': no words');
    }
    S.settingsPane = 'account'; renderSettingsView();
    return out;
  });
  ok(bad.length === 0, 'none missing', bad);
}

section('The heading sits on its own subtitle');
{
  const r = await page.evaluate(() => {
    const t = document.querySelector('.settings-content .set-title').getBoundingClientRect();
    const s = document.querySelector('.settings-content .set-title + .set-sub').getBoundingClientRect();
    return { gap: Math.round(s.top - t.bottom) };
  });
  ok(r.gap >= 0 && r.gap <= 12, 'heading and subtitle read as one block', r.gap);
}

section('It closes on X and on Esc, back to where it was opened, and leaves nothing behind');
{
  const x = await page.evaluate(async () => {
    document.getElementById('set-close').click(); await new Promise(r => setTimeout(r, 300));
    return { tab: S.tab, layer: !!document.getElementById('set-modal'), lock: document.body.classList.contains('set-open') };
  });
  ok(x.tab === 'crew' && !x.layer && !x.lock, 'X: back on Crew, layer and scroll lock gone', x);
  await page.evaluate(() => setTab('settings'));
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const e = await page.evaluate(() => ({ tab: S.tab, layer: !!document.getElementById('set-modal') }));
  ok(e.tab === 'crew' && !e.layer, 'Esc: the same', e);
  const t = await page.evaluate(async () => {
    setTab('settings'); await new Promise(r => setTimeout(r, 200)); setTab('tasks'); await new Promise(r => setTimeout(r, 300));
    return { layer: !!document.getElementById('set-modal'), tasks: !!document.querySelector('#vc .tasks-page') };
  });
  ok(!t.layer && t.tasks, 'going to any other screen from inside it removes the panel', t);
}

section('The account menu has Team beside Settings, and Team works');
{
  const r = await page.evaluate(async () => {
    document.getElementById('nav-av').click(); await new Promise(r => setTimeout(r, 100));
    const ids = [...document.querySelectorAll('.prof-item')].map(b => b.id);
    const t = (document.querySelector('.prof-menu, #prof-menu') || document.body).textContent;
    const team = document.getElementById('pm-team'); if (team) team.click();
    await new Promise(r => setTimeout(r, 500));
    return { ids, apps: /Apps\s*&\s*Extensions/.test(t), tab: S.tab,
             view: ((document.getElementById('vc') || {}).textContent || '').slice(0, 4000) };
  });
  ok(!r.apps && r.ids.indexOf('pm-apps') < 0, 'no Apps & Extensions item', r.ids);
  ok(r.ids.indexOf('pm-team') === r.ids.indexOf('pm-settings') + 1, 'Team sits right after Settings', r.ids);
  ok(r.tab === 'team' && /How Teams works/.test(r.view) && /Invite/i.test(r.view), 'and opens the Team screen: seats, invites, roles', { tab: r.tab, view: r.view.slice(0, 120) });
}

section('On a phone it takes the whole screen');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => setTab('settings'));
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const b = document.querySelector('#set-modal .settings-shell').getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top), wide: document.documentElement.scrollWidth,
             picker: !!(document.getElementById('set-picker') || {}).offsetParent };
  });
  ok(r.w === 390 && r.h === 844 && r.x === 0 && r.y === 0, 'edge to edge', r);
  ok(r.picker && r.wide <= 390, 'with the section picker, and nothing wider than the screen', r);
}

section('Every rule that styles a screen reaches Settings too');
{
  /* Settings is drawn outside #vc, so a rule written "#vc .card" silently
     stops applying to it - which is how the light-theme plan list fell to
     1.05:1 contrast. Descendant rules name both containers. */
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const bare = (css.match(/[^,{}]*(?<!:is\()#vc(?=\s+[^>\s{,])[^{,]*/g) || []).map(s => s.trim());
  ok(bare.length === 0, 'no "#vc ..." descendant rule that misses the Settings panel', bare.slice(0, 5));
  const r = await page.evaluate(async () => {
    document.body.classList.add('light'); S.settingsPane = 'billing'; setTab('settings');
    await new Promise(r => setTimeout(r, 700));
    const v = document.querySelector('#set-modal .vi-bill');
    const out = { card: !!v, radius: v ? getComputedStyle(v).maxWidth : '' };
    document.body.classList.remove('light');
    return out;
  });
  ok(r.card && r.radius === '720px', 'and the billing pane in Settings gets the rules written for it', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('settings-ends-where-its-items-end') > 0) process.exitCode = 1;
done();
