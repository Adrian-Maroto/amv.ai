/* THE ROW CANCELLED THE CLICK IT WAS WAITING FOR.

   A chat preview inside a project card was written like this:

     <div class="wsc-chat" data-dact="loadConv" data-darg="..."
          onclick="event.stopPropagation()">

   Both at once. `data-dact` is dispatched by ONE listener on `document` - that
   is the whole design - so a stopPropagation on the row runs first, during the
   bubble, and the click never reaches the dispatcher. Clicking a recent chat
   inside a project did nothing. No error, no console line, nothing: the most
   expensive kind of broken, because it looks like the app ignoring you.

   The guard was there to keep the click off the surrounding card, which has its
   own data-dact="openWorkspace" - and it was never needed for that. The
   dispatcher resolves with e.target.closest('[data-dact]'), which finds the
   NEAREST one. Clicking the row finds the row. The card's action was never
   going to fire.

   So the guard did nothing except break the element it was attached to, which
   is LESSONS #5 written out in one line of markup, and it shipped.

   This file drives the real thing: build a project with chats in it, click a
   preview row, and check the conversation actually opens. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page } = app;

/* A project with three chats in it, as the app stores them. */
async function seed() {
  return page.evaluate(() => {
    S.workspaces = [{ id: 'ws1', name: 'Quarterly', desc: 'the numbers', icon: '📁', created: Date.now() }];
    S.convs = [
      { id: 'c1', title: 'Revenue model', wsId: 'ws1', msgs: [{ r: 'u', c: 'first chat' }], _t: Date.now() },
      { id: 'c2', title: 'Headcount plan', wsId: 'ws1', msgs: [{ r: 'u', c: 'second chat' }], _t: Date.now() },
    ];
    renderWorkspacesView();
    return document.querySelectorAll('.wsc-chat').length;
  });
}

section('The project card shows the chats inside it');
{
  const rows = await seed();
  ok(rows === 2, 'both chats are listed as preview rows', rows);

  const wired = await page.evaluate(() =>
    [...document.querySelectorAll('.wsc-chat')].map(el => ({
      dact: el.dataset.dact || null,
      darg: el.dataset.darg || null,
    })));
  ok(wired.every(w => w.dact === 'loadConv'), 'each row says which action it is', wired);
  ok(wired.map(w => w.darg).join(',') === 'c1,c2', 'and which conversation', wired.map(w => w.darg));
}

section('THE FINDING: no row cancels the click that runs it');
{
  /* The attribute itself, because it is the defect: an inline onclick on an
     element that is dispatched by delegation is a click that never arrives. */
  const guards = await page.evaluate(() =>
    [...document.querySelectorAll('.wsc-chat')].filter(el => el.getAttribute('onclick')).length);
  ok(guards === 0, 'no preview row carries an inline onclick', guards);

  const anywhere = await page.evaluate(() =>
    [...document.querySelectorAll('[data-dact]')]
      .filter(el => /stopPropagation/.test(el.getAttribute('onclick') || ''))
      .map(el => el.className || el.tagName));
  ok(anywhere.length === 0,
     'and nothing anywhere on the page both delegates and stops the click', anywhere);
}

section('And clicking one really opens that conversation');
{
  /* The point of all of it. Measured on the outcome a person sees, not on the
     attribute - the attribute could be gone and the wiring still wrong. */
  await seed();
  const opened = await page.evaluate(async () => {
    let loaded = null;
    const real = window.loadConv;
    window.loadConv = (id) => { loaded = id; };
    document.querySelectorAll('.wsc-chat')[1].click();
    await new Promise(r => setTimeout(r, 60));
    window.loadConv = real;
    return loaded;
  });
  ok(opened === 'c2', 'clicking the second row loads the second chat', opened);

  const first = await page.evaluate(async () => {
    let loaded = null;
    const real = window.loadConv;
    window.loadConv = (id) => { loaded = id; };
    document.querySelectorAll('.wsc-chat')[0].click();
    await new Promise(r => setTimeout(r, 60));
    window.loadConv = real;
    return loaded;
  });
  ok(first === 'c1', 'and the first row loads the first', first);
}

section('While the card around it still opens the project');
{
  /* What the stopPropagation was FOR. It has to keep being true, or this
     traded one broken click for another. */
  await seed();
  const got = await page.evaluate(async () => {
    let openedWs = null, loadedConv = null;
    const rw = window.openWorkspace, rl = window.loadConv;
    window.openWorkspace = (id) => { openedWs = id; };
    window.loadConv = (id) => { loadedConv = id; };
    /* A part of the card that is NOT a preview row - the project's name. */
    document.querySelector('.wsc .wsn').click();
    await new Promise(r => setTimeout(r, 60));
    window.openWorkspace = rw; window.loadConv = rl;
    return { openedWs, loadedConv };
  });
  ok(got.openedWs === 'ws1', 'clicking the card opens the project', got);
  ok(got.loadedConv === null, 'and does not also open a chat', got);
}

section('Clicking a row does not ALSO open the project behind it');
{
  /* The other direction, and the reason somebody reached for stopPropagation in
     the first place. It holds because the dispatcher takes the nearest
     data-dact, not every one on the way up. */
  await seed();
  const got = await page.evaluate(async () => {
    let openedWs = null, loadedConv = null;
    const rw = window.openWorkspace, rl = window.loadConv;
    window.openWorkspace = (id) => { openedWs = id; };
    window.loadConv = (id) => { loadedConv = id; };
    document.querySelectorAll('.wsc-chat')[0].click();
    await new Promise(r => setTimeout(r, 60));
    window.openWorkspace = rw; window.loadConv = rl;
    return { openedWs, loadedConv };
  });
  ok(got.loadedConv === 'c1', 'the chat opens', got);
  ok(got.openedWs === null, 'and the project does not open behind it', got);
}

if (report('a-button-that-stops-the-click-it-needs') > 0) process.exitCode = 1;
await app.close();
done();
