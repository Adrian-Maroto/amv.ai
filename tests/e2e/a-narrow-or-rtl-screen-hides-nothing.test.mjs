/* A NARROW OR RIGHT-TO-LEFT SCREEN HIDES NOTHING (Build 16 audit D16-13, Nov 21).

   Read from the source, the audit found three floors that could not yield:
   Connected accounts laid out on a 300px track with no min(100%), the team
   invite row a flex line that could not wrap, and the Crew card's toggle
   pinned with `right:` - so in Arabic or Urdu it sat on the title, in the
   room kept for it on the other side. Measured here on a 320px screen, with a
   long address, and right to left. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ viewport: { width: 320, height: 640 }, tab: 'chat', user: { name: 'Owner', email: 'owner@x.com', ini: 'O' } });
const { page, errors } = app;
const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1;

section('Connected accounts on a 320px screen');
{
  await page.evaluate(() => {
    try{ Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true }); }catch(e){}
    AMV_API.connectList = async () => ({ configured: true, items: [
      { id: 'c1', provider: 'google', name: 'Google Workspace for a very long organisation name', scopes: ['mail.read', 'calendar.read'], unattended: true, at: Date.now() - 864e6, lastUsed: Date.now() - 72e5 },
      { id: 'c2', provider: 'github', name: 'GitHub', scopes: ['repo.read'], unattended: false, at: Date.now() - 1728e5, lastUsed: 0, broken: true } ] });
    setTab('integrations');
  });
  await page.waitForSelector('#conn-sec:not([hidden]) .conn-grid .conn-row:not(.conn-skel)', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const g = document.querySelector('#conn-sec .conn-grid'); const gr = g.getBoundingClientRect();
    return { over: g.scrollWidth - g.clientWidth, vw: innerWidth, grid: { left: gr.left, right: gr.right },
      cards: [...g.querySelectorAll('.conn-row')].map(c => { const b = c.getBoundingClientRect(); const x = c.querySelector('.conn-x').getBoundingClientRect(); return { card: { left: b.left, right: b.right }, x: { left: x.left, right: x.right } }; }) };
  });
  ok(r.over <= 1 && r.grid.right <= r.vw + 1, 'the grid fits the screen', r);
  ok(r.cards.length === 2 && r.cards.every(c => c.card.right <= r.vw + 1 && inside(c.x, c.card)), 'every card, and its Disconnect, is on screen', r.cards);
}

section('Inviting a teammate with a long address on a 320px screen');
{
  await page.evaluate(() => {
    window.AMVTeam.enabled = () => true; window.AMVTeam._cache = null;
    const team = { id: 'team_abc', name: 'Acme', ownerEmail: 'owner@x.com', plan: 'elite', seats: { used: 1, limit: 10, over: 0 },
      members: [{ email: 'owner@x.com', role: 'owner', joinedAt: 1, seated: true }] };
    window.AMV_API._fetch = async (path) => ({ ok: true, status: 200, json: async () => path === '/team/get' ? { ok: true, team } : { ok: true } });
    saveStr('amv_plan', 'elite'); S.tab = 'team'; setTab('team');
  });
  await page.waitForSelector('#team-invite-email', { timeout: 15000 });
  const r = await page.evaluate(() => {
    const e = document.getElementById('team-invite-email'); e.value = 'a.very.long.name.for.a.teammate@subsidiary.example-company.com';
    const box = e.closest('.sf').getBoundingClientRect();
    const rc = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, w: b.width }; };
    return { vw: innerWidth, box: rc(e.closest('.sf')), mail: rc(e), role: rc(document.getElementById('team-invite-role')), btn: rc(document.getElementById('team-invite-btn')) };
  });
  ok([r.mail, r.role, r.btn].every(x => x.right <= r.vw + 1 && x.left >= -1), 'the address, the role and Invite are all on screen', r);
  ok(r.mail.w >= 200, 'and the address keeps room to be read, not squeezed beside the buttons', r.mail);
}

section('A Crew card read right to left');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; setTab('chat'); setTab('crew'); });
  await page.waitForSelector('.cj-card .cj-tg', { timeout: 20000 });
  const r = await page.evaluate(() => [...document.querySelectorAll('.cj-card')].filter(c => c.querySelector('.cj-tg')).slice(0, 6).map(c => {
    const t = c.querySelector('.cj-card-t').getBoundingClientRect(); const g = c.querySelector('.cj-tg').getBoundingClientRect(); const b = c.getBoundingClientRect();
    return { overlap: !(g.right <= t.left + 1 || g.left >= t.right - 1 || g.bottom <= t.top + 1 || g.top >= t.bottom - 1), start: g.left - b.left < b.right - g.right };
  }));
  ok(r.length > 0 && r.every(x => !x.overlap), 'the toggle never covers the job\'s name', r);
  ok(r.length > 0 && r.every(x => x.start), 'it sits at the end of the line in reading order - the left, in Arabic', r);
  await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
  const l = await page.evaluate(() => [...document.querySelectorAll('.cj-card')].filter(c => c.querySelector('.cj-tg')).slice(0, 6).map(c => {
    const t = c.querySelector('.cj-card-t').getBoundingClientRect(); const g = c.querySelector('.cj-tg').getBoundingClientRect(); const b = c.getBoundingClientRect();
    return { overlap: !(g.right <= t.left + 1 || g.left >= t.right - 1 || g.bottom <= t.top + 1 || g.top >= t.bottom - 1), end: b.right - g.right < g.left - b.left };
  }));
  ok(l.length > 0 && l.every(x => !x.overlap && x.end), 'and on the right, clear of the name, left to right', l);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
