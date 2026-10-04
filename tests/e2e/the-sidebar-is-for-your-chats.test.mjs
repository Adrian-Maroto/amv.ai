/* THE SIDEBAR IS FOR YOUR CHATS.

   Asked for: "make the recent chat section a bit bigger - remove the profile
   section on the bottom left and just keep the thing at the top right, and
   remove all systems operational too".

   The bottom of the sidebar held a profile button that opened the same menu
   as the avatar at the top right, and a line saying "All systems operational"
   on every screen of every visit. Both are gone, and Recents has the room.
   The status line still appears the moment something is wrong - a status that
   could not say "offline" would be removing a warning, not a line. And What's
   New, which only that sidebar menu offered, moved to the one account menu. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;
await page.setViewportSize({ width: 1280, height: 800 });
await page.evaluate(() => { document.getElementById('cookie-consent-banner')?.remove(); _setStatusIndicator('ok'); });
await page.waitForTimeout(300);

section('No second profile at the bottom of the sidebar');
{
  const r = await page.evaluate(() => ({
    user: !!document.querySelector('#sb .sb-user, #sb-user-btn, #sb-popup'),
    avatar: !!document.getElementById('nav-av'),
    status: (() => { const b = document.getElementById('sb-status'); return b && b.offsetParent !== null; })(),
  }));
  ok(!r.user, 'no profile button or its menu in the sidebar', r);
  ok(r.avatar, 'the avatar at the top right is the account menu', r);
  ok(!r.status, 'and no status line while everything works', r);
}

section('Recents has the room');
{
  const r = await page.evaluate(() => {
    const h = document.getElementById('hist').getBoundingClientRect();
    const tools = document.getElementById('sb-tools').getBoundingClientRect();
    return { top: Math.round(h.top), room: Math.round(tools.top - h.top) };
  });
  ok(r.room >= 330, 'Recents runs down to the tool row - room for about nine chats at 800px tall', r);
}

section('A problem still shows, and goes again when it is fixed');
{
  const r = await page.evaluate(() => {
    _setStatusIndicator('offline');
    const b = document.getElementById('sb-status');
    const off = { shown: b.offsetParent !== null, text: b.textContent.trim() };
    _setStatusIndicator('ok');
    return { off, back: b.offsetParent !== null };
  });
  ok(r.off.shown && /offline/i.test(r.off.text), 'offline is said in the sidebar', r.off);
  ok(!r.back, 'and the line leaves when the connection is back', r);
}

section("What's New lives in the account menu");
{
  const r = await page.evaluate(async () => {
    localStorage.removeItem('amv_changelog_seen'); _checkWhatsNew();
    const dotOnAvatar = document.getElementById('nav-av').classList.contains('has-news');
    document.getElementById('nav-av').click();
    await new Promise(r => setTimeout(r, 100));
    const item = document.getElementById('pm-whatsnew');
    const badge = !!(item && item.querySelector('.smi-badge'));
    if (item) item.click();
    await new Promise(r => setTimeout(r, 200));
    const modal = !!document.querySelector('.wn-modal');
    try { closeOvr(); } catch (e) {}
    return { item: !!item, badge, modal, dotOnAvatar, after: document.getElementById('nav-av').classList.contains('has-news') };
  });
  ok(r.item && r.modal, "What's New is in the menu and opens", r);
  ok(r.dotOnAvatar && r.badge, 'an unread note shows on the avatar and on the item', r);
  ok(!r.after, 'and reading it clears the dot', r);
}

section('Help and What\u2019s New say where things are now');
{
  /* "Make sure all is updated for tasks, settings, help". A Help Center that
     still sends people to a sidebar profile, or a Team plan behind Elite, is
     a page explaining a product that is not there. */
  const r = await page.evaluate(async () => {
    setTab('help'); await new Promise(r => setTimeout(r, 300));
    const t = document.getElementById('vc').textContent;
    return { avatar: /avatar at the top right/.test(t), team: /per person a month/.test(t) && !/Teams unlocks on/.test(t),
             mail: /email me when it is done/i.test(t), news: /Settings opens in the middle/.test(CHANGELOG[0].items.join(' ')) };
  });
  ok(r.avatar && r.team && r.mail, 'Help answers where the account menu is, how Team is sold, and the done email', r);
  ok(r.news, 'and What\u2019s New leads with this round', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('the-sidebar-is-for-your-chats') > 0) process.exitCode = 1;
done();
