/* CHATS, THEN A LINE, THEN BUILDS.

   Asked for (Oct 31): "for recent chats make it organized like build, and
   normal. So under recent chats it should be actual chats and then below it
   there should be like a thin line and like recent builds".

   Recents was one list, newest first, with Dev, Lab and Studio work mixed in
   among the chats - so a project sat between two conversations and where to
   look for either depended on which was touched last. Now: "Recent chats" and
   the chats, a hairline, "Recent builds" and the builds. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('cookie-consent-banner')?.remove());

const read = () => page.evaluate(() => {
  const area = document.getElementById('hist');
  const seq = [...area.children].map(el =>
    el.classList.contains('hist-split') ? 'LINE'
    : el.classList.contains('hist-builds-h') ? 'BUILDS:' + el.textContent.trim()
    : el.classList.contains('hi-sess') ? 'build:' + (el.querySelector('.hit') || {}).textContent
    : el.classList.contains('hi') ? 'chat:' + (el.querySelector('.hit') || {}).textContent
    : el.className);
  const h = document.getElementById('hist-header');
  return { seq, header: h ? h.textContent.trim() : '', headerShown: !!h && !h.classList.contains('hh-off') };
});

section('Chats first, then a thin line, then builds - whatever was touched last');
{
  await page.evaluate(() => {
    const now = Date.now();
    S.convs = [
      { id: 'c1', title: 'Trip to Lisbon', msgs: [{ r: 'user', c: 'hi' }], _t: now - 5000 },
      { id: 'c2', title: 'Tax questions', msgs: [{ r: 'user', c: 'hi' }], _t: now - 1000 },
    ];
    /* The newest thing of all is a build: it must still sit under the line. */
    _SESSIONS.length = 0;
    _SESSIONS.push({ id: 's1', kind: 'dev', title: 'Landing page', updated: now });
    _SESSIONS.push({ id: 's2', kind: 'lab', title: 'Data script', updated: now - 9000 });
    renderHist();
  });
  const r = await read();
  ok(r.headerShown && /Recent chats/.test(r.header), 'the heading says "Recent chats"', r.header);
  ok(JSON.stringify(r.seq) === JSON.stringify(['chat:Tax questions', 'chat:Trip to Lisbon', 'LINE', 'BUILDS:Recent builds', 'build:Landing page', 'build:Data script']),
     'chats newest first, the line, "Recent builds", builds newest first', r.seq);
  const line = await page.evaluate(() => { const l = document.querySelector('#hist .hist-split'); const cs = getComputedStyle(l); return { h: l.getBoundingClientRect().height, bg: cs.backgroundColor }; });
  ok(line.h >= 1 && line.h <= 2 && line.bg !== 'rgba(0, 0, 0, 0)', 'the line is a visible hairline', line);
  await page.screenshot({ path: 'tests/e2e/.shots/chats-then-builds-desktop.png', clip: { x: 0, y: 0, width: 300, height: 760 } }).catch(() => {});
}

section('Only builds: no empty chats heading, just the builds');
{
  await page.evaluate(() => { S.convs = []; renderHist(); });
  const r = await read();
  ok(!r.headerShown, 'no "Recent chats" heading over nothing', r);
  ok(r.seq[0] === 'LINE' || r.seq[0] === 'BUILDS:Recent builds', 'the builds and their heading are what shows', r.seq);
  ok(r.seq.includes('build:Landing page'), 'with the builds listed', r.seq);
}

section('Only chats: no line and no builds heading');
{
  await page.evaluate(() => {
    S.convs = [{ id: 'c3', title: 'Just a chat', msgs: [{ r: 'user', c: 'hi' }], _t: Date.now() }];
    _SESSIONS.length = 0; renderHist();
  });
  const r = await read();
  ok(JSON.stringify(r.seq) === JSON.stringify(['chat:Just a chat']), 'just the chat', r.seq);
}

section('On a phone too');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const now = Date.now();
    S.convs = [{ id: 'c1', title: 'Trip to Lisbon', msgs: [{ r: 'user', c: 'hi' }], _t: now }];
    _SESSIONS.length = 0; _SESSIONS.push({ id: 's1', kind: 'studio', title: 'Poster', updated: now });
    renderHist();
  });
  const r = await read();
  ok(r.seq.indexOf('LINE') === 1 && r.seq.includes('build:Poster'), 'the same order', r.seq);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
if (report('chats-then-a-line-then-builds') > 0) process.exitCode = 1;
done();
