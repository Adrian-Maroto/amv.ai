/* EVERY PLACE IS ONE TAP OR ONE MENU AWAY ON A PHONE (owner, Nov 24: "the bar
   at the bottom and the list on the side ... some sections you can't even get
   to"; Nov 25: a bar of four - Chat, Build, Crew, Tasks - with the menu for the
   rest, the shape the two most used assistants moved to that week).

   Held, at 390x844, by what receives the tap (elementFromPoint), not by where
   boxes are:
     · the bar holds exactly Chat, Build, Crew, Tasks, labelled, each taking
       the tap and going there, the current one marked;
     · the menu does not list those four again (New chat stays: it starts one);
     · every other place in the menu is on screen, labelled, takes the tap, and
       goes there;
     · the bar steps aside while somebody types;
     · New chat is in the top bar, and Settings is behind the avatar. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 390, height: 844 }, user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => { try { localStorage.setItem('amv_consent', JSON.stringify({ v: 1, analytics: false, at: Date.now() })); } catch (e) {} });
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelectorAll('.cc-banner').forEach(b => b.remove()); });

section('The bar of four');
const BAR = [['chat', 'Chat'], ['build', 'Build'], ['crew', 'Crew'], ['tasks', 'Tasks']];
const bar = await page.evaluate(() => [...document.querySelectorAll('#bottom-nav [data-bntab]')].map(b => [b.dataset.bntab, b.innerText.trim()]));
ok(JSON.stringify(bar) === JSON.stringify(BAR), 'Chat, Build, Crew, Tasks - in that order, labelled', bar);
for (const [tab, label] of BAR) {
  await page.evaluate(() => { setTab('help'); });
  const r = await page.evaluate((tab) => {
    const el = document.querySelector('#bottom-nav [data-bntab="' + tab + '"]'); const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
    return { onScreen: b.top >= 0 && b.bottom <= innerHeight + 1, takes: !!(hit && (hit === el || el.contains(hit))), h: Math.round(b.height), w: Math.round(b.width) };
  }, tab);
  ok(r.onScreen && r.takes && r.h >= 44 && r.w >= 44, label + ': on screen, big enough, takes the tap', r);
  await page.click('#bottom-nav [data-bntab="' + tab + '"]');
  await page.waitForTimeout(300);
  const now = await page.evaluate((tab) => ({ tab: S.tab, marked: document.querySelector('#bottom-nav [data-bntab="' + tab + '"]').getAttribute('aria-current') }), tab);
  ok(now.tab === tab && now.marked === 'page', '... goes to ' + label + ' and marks it', now);
}
const shown = await page.evaluate(() => { const r = document.getElementById('bottom-nav').getBoundingClientRect(); return { bottom: Math.round(innerHeight - r.bottom), h: Math.round(r.height) }; });
ok(shown.bottom <= 1 && shown.h >= 56, 'the bar sits on the bottom edge', shown);

section('The menu does not repeat the four');
await page.evaluate(() => { if (!S.sbOpen) toggleSb(); });
await page.waitForTimeout(350);
const dup = await page.evaluate(() => ['build', 'crew', 'tasks'].filter(t => [...document.querySelectorAll('#sb [data-tab="' + t + '"]')].some(e => e.getBoundingClientRect().width > 0)));
ok(dup.length === 0, 'Build, Crew and Tasks are not listed again in the menu', dup);
await page.evaluate(() => { if (S.sbOpen) toggleSb(); });

section('The bar steps aside while somebody types');
await page.evaluate(() => setTab('chat'));
await page.waitForTimeout(300);
await page.focus('#mta');
await page.waitForTimeout(150);
ok(await page.evaluate(() => getComputedStyle(document.getElementById('bottom-nav')).display === 'none'), 'hidden while the box has the keyboard');
await page.evaluate(() => document.activeElement.blur());
await page.waitForTimeout(150);
ok(await page.evaluate(() => getComputedStyle(document.getElementById('bottom-nav')).display !== 'none'), 'and back when it does not');

const PLACES = [['chat', 'New chat'], ['handoff', 'Handoff'],
                ['integrations', 'Integrations'], ['memory', 'Memory'], ['spend', 'Spending']];

section('Every other place in the menu is on screen, labelled, and takes the tap');
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
