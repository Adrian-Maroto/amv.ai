/* EVERY PLACE IS ONE MENU AWAY ON A PHONE (owner, Nov 24: "the bar at the
   bottom and the list on the side ... some sections you can't even get to").

   The phone had a bottom bar repeating the menu, and the menu's own bottom row
   - Tasks, Integrations, Memory, Spending - sat under it, as unlabelled icons.
   Held, at 390x844, by what receives the tap (elementFromPoint), not by where
   boxes are:
     · no bottom bar;
     · the top bar's menu button opens the menu;
     · every place in it is on screen, labelled, takes the tap, and goes there;
     · New chat is in the top bar, and Settings is behind the avatar. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 390, height: 844 }, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => { try { localStorage.setItem('amv_consent', JSON.stringify({ v: 1, analytics: false, at: Date.now() })); } catch (e) {} });
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelectorAll('.cc-banner').forEach(b => b.remove()); });

section('One navigation');
ok(await page.evaluate(() => !document.getElementById('bottom-nav')), 'there is no bottom bar');

const PLACES = [['chat', 'New chat'], ['build', 'Build'], ['crew', 'Crew'], ['handoff', 'Handoff'],
                ['tasks', 'Tasks'], ['integrations', 'Integrations'], ['memory', 'Memory'], ['spend', 'Spending']];

section('Every place in the menu is on screen, labelled, and takes the tap');
for (const [tab, label] of PLACES) {
  await page.evaluate(() => { if (S.sbOpen) toggleSb(); setTab('settings'); setTab('help'); });
  await page.click('#tsb');
  await page.waitForTimeout(350);
  const r = await page.evaluate(({ tab, label }) => {
    const el = [...document.querySelectorAll('#sb [data-tab="' + tab + '"]')].find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
    return { found: true, onScreen: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
      labelled: (el.innerText || '').trim() === label, takes: !!(hit && (hit === el || el.contains(hit))), h: Math.round(b.height) };
  }, { tab, label });
  ok(r.found && r.onScreen && r.labelled && r.takes && r.h >= 40, label + ': on screen, labelled, takes the tap', r);
  await page.click('#sb [data-tab="' + tab + '"]:visible');
  await page.waitForTimeout(350);
  const now = await page.evaluate(() => ({ tab: S.tab, open: !!S.sbOpen }));
  ok(now.tab === tab && !now.open, '... and goes to ' + label + ', closing the menu', now);
}

section('New chat in the top bar, Settings behind the avatar');
await page.evaluate(() => setTab('crew'));
await page.click('#nav-new');
await page.waitForTimeout(250);
ok(await page.evaluate(() => S.tab === 'chat'), 'New chat opens chat');
await page.click('#nav-av');
await page.waitForTimeout(250);
ok(await page.evaluate(() => [...document.querySelectorAll('button,[role=menuitem],a')].some(e => /^Settings$/.test((e.innerText || '').trim()) && e.getBoundingClientRect().width > 0)),
   'the avatar opens a menu with Settings');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
