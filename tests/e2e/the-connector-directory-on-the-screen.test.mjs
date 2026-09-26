/* THE DIRECTORY, AS SOMEBODY ACTUALLY MEETS IT.

   The Worker half is pinned next door, in the-directory-only-offers-what-can-
   run. This is the screen: ten to a row with a See all on each, a real page
   behind that rather than a longer scroll, and a panel that names the exact
   command before anything is added - because a connector is a program somebody
   else wrote and AMV is about to start it on this person's computer.

   The two failures worth having a test for are both quiet ones. A directory
   that cannot be reached must not render as a directory with nothing in it -
   "nothing matches" and "the server could not be asked" are different facts and
   only one of them says this product connects to nothing. And See all used to
   render the full list UNDER the connected accounts, the machine panel and the
   whole native catalogue, so pressing it left somebody looking at exactly what
   they had been looking at with more of it somewhere below. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

const CONNECT = (mode) => page.evaluate((m) => {
  saveStr('amv_plan', 'pro');
  AMV_API.base = 'https://stub.amv.dev';
  AMV_API.token = 'test-token';
  AMV_API.connectList = async () => ({ configured: true, items: [], providers: [] });
  window.__asked = [];
  AMV_API.connectors = async (q, cursor, limit) => {
    window.__asked.push({ q, cursor, limit });
    if (m === 'down') throw new Error('The connector directory could not be reached.');
    if (m === 'empty') return { ok: true, q, cursor: '', servers: [] };
    return { ok: true, q, cursor: cursor ? '' : 'next',
      servers: Array.from({ length: Math.min(limit, 36) }, (_, i) => ({
        id: 'io.github.someone/' + (q || 'all') + '-' + i,
        name: (q || 'all') + ' connector ' + i,
        desc: 'Works with ' + (q || 'things') + ', entry ' + i + '.',
        version: '1.2.' + i, command: 'npx', args: ['-y', '@someone/' + (q || 'all') + '-' + i],
        env: i % 2 ? [{ name: 'API_KEY', required: true, secret: true, desc: 'Your key.' }] : [],
      })) };
  };
}, mode);

const open = async () => {
  await page.evaluate(async () => {
    try { MCP.servers = []; _mcpSave(); } catch (e) {}
    setTab('chat');
    await new Promise(r => setTimeout(r, 100));
    setTab('integrations');
    await new Promise(r => setTimeout(r, 900));
  });
};

/* WHAT THIS SECTION USED TO HOLD, AND WHY IT CHANGED.

   It asserted twenty-six rows of five tiles, each row having asked the
   registry its own question on paint. That was the structure the owner asked
   for and then asked to have taken away: "remove the things below the search
   bar entirely", "none of the thing that it says now", "make it like chat
   gpt", and - the reason - "the search bar is very laggy".

   The lag and the rows were one defect. The search box was rendered inside the
   node every registry answer replaced, so it was destroyed and rebuilt under
   anybody typing into it, and its value came from a variable only written on
   submit, so each rebuild dropped what had been typed. Twenty-six rows meant
   that happened for several seconds on arrival.

   The claims did not disappear, they moved. A topic still runs a real query,
   still has a door, and its page still fills with tiles - measured below and
   on the topic page rather than on a row. What is new and worth holding is
   that the overview asks for NOTHING, because that is what makes the search
   box usable and the page instant. */
section('A topic is a door, and the page asks for nothing until one is opened');
{
  await CONNECT('ok');
  await open();
  const r = await page.evaluate(() => ({
    doors: document.querySelectorAll('.int-seeall [data-dact="cdirAll"]').length,
    rows: document.querySelectorAll('.cdir-row').length,
    tiles: document.querySelectorAll('.cdir-tile').length,
    /* Every door carries the query it really sends, so a heading cannot
       promise a search it does not run. */
    queries: [...document.querySelectorAll('.int-seeall [data-dact="cdirAll"]')].map(x => x.dataset.darg),
    titles: [...document.querySelectorAll('#int-catalog .ss2 > h3')].map(x => x.textContent.trim()),
    asked: window.__asked.length,
    find: !!document.getElementById('cdir-find'),
  }));
  ok(r.doors >= 20, 'there are topics, not one long list', String(r.doors));
  ok(r.rows === 0, 'and none of them is a row that loads on arrival', String(r.rows));
  ok(r.tiles === 0, 'so nothing is drawn from the registry yet', String(r.tiles));
  /* THE ASSERTION THE LAG WAS ABOUT. Twenty-six requests on paint, each answer
     replacing the node the search box lived in, is the whole of what somebody
     felt as a laggy search bar. Zero is the fix, and it is measurable. */
  ok(r.asked === 0, 'the overview makes NO registry requests at all', String(r.asked));
  ok(new Set(r.queries).size === r.doors, 'each door carries its own query', r.queries.join(','));
  ok(r.queries.every(Boolean), 'and none of them is a heading with no search behind it', r.queries.join(','));
  ok(r.titles.length === r.doors, 'each one is named', r.titles.slice(0, 4).join(','));
  ok(r.find, 'and the search box is on the page', String(r.find));
  /* EXACTLY ONE, and this assertion exists because of what happened when the
     box was moved back inside `.cdir` to check that the survival test below
     really bites. It did not bite - because the directory rendering one did
     not REPLACE the view's, it added a second element with the same id, and
     `getElementById` kept returning the one that survives. Two inputs sharing
     an id is a defect on its own (a label points at one of them, and which one
     is not defined), and it is the only way the test below can be fooled. */
  const one = await page.evaluate(() => document.querySelectorAll('#cdir-find').length);
  ok(one === 1, 'and there is exactly one of it, not one per section', String(one));
}

section('A registry answer does not reach into the box somebody is typing in');
{
  /* THE DEFECT, MEASURED AT ITS MECHANISM.

     `_cdirPaint` is what every registry answer calls, and it replaces the
     whole `.cdir` node. The input used to be inside that node, so each answer
     destroyed the element being typed into and rebuilt it from `_cdirFind` -
     a variable only written on submit - which put back the last SEARCHED term
     and threw away the half-typed one, caret at the end. Twenty-six rows
     answering on arrival meant that happened over and over for the first
     several seconds of the page. That is what "the search bar is very laggy"
     was.

     Measured on a topic page, because that is where answers still land. The
     first attempt at this provoked a NAVIGATION instead and failed honestly:
     opening a different page rebuilds the page, which is correct and is not
     the thing that was broken. */
  await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirAll"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 900));
  });
  const r = await page.evaluate(async () => {
    const f = document.getElementById('cdir-find');
    if(!f) return { missing: true };
    f.focus();
    f.value = 'postgre';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.setSelectionRange(4, 4);
    const before = f;
    const cdirBefore = document.querySelector('.cdir');
    /* The exact call an arriving answer makes. */
    _cdirPaint();
    await new Promise(x => setTimeout(x, 400));
    const after = document.getElementById('cdir-find');
    return {
      same: before === after,
      swapped: cdirBefore !== document.querySelector('.cdir'),
      value: after ? after.value : null,
      caret: after ? after.selectionStart : -1,
      focused: document.activeElement === after,
    };
  });
  ok(!r.missing, 'the box is on a topic page too, so searching does not need going back first', JSON.stringify(r));
  ok(r.swapped, 'the directory really did repaint, so this is not passing by doing nothing', String(r.swapped));
  ok(r.same, 'and the very same input element survived it', String(r.same));
  ok(r.value === 'postgre', 'holding what was typed', r.value);
  ok(r.caret === 4, 'with the caret where it was left rather than thrown to the end', String(r.caret));
  ok(r.focused, 'and it did not lose focus mid-word', String(r.focused));
}

section('A full re-render restores what was typed, not what was last submitted');
{
  /* The box is outside the directory now, which stops the repaints. This
     screen is still rebuilt for other reasons - a connection added, the
     bridge connecting, a language switch - and dropping a half-typed query to
     any of those is the same defect in a different coat. `_cdirFind` tracks
     every keystroke for this case. */
  const r = await page.evaluate(async () => {
    const f = document.getElementById('cdir-find');
    f.value = 'figma';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    renderIntegrationsView();
    await new Promise(x => setTimeout(x, 300));
    const after = document.getElementById('cdir-find');
    return { rebuilt: after !== f, value: after ? after.value : null };
  });
  ok(r.rebuilt, 'the page really was rebuilt', String(r.rebuilt));
  ok(r.value === 'figma', 'and the half-typed query came back with it', r.value);

  /* Back to the overview with the box cleared, so the sections below start
     where they expect to. */
  await page.evaluate(async () => {
    const f = document.getElementById('cdir-find');
    if(f){ f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
    const b = document.querySelector('[data-dact="cdirBack"]');
    if(b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 500));
  });
}

section('See all opens a page, not a longer scroll');
{
  const r = await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirAll"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 600));
    return {
      full: !!document.querySelector('.cdir-full'),
      tiles: document.querySelectorAll('.cdir-tile').length,
      /* The things that were above it are gone, which is what makes it a page. */
      natives: document.querySelectorAll('.int-card').length,
      machine: document.querySelectorAll('.conn-machine').length,
      back: !!document.querySelector('[data-dact="cdirBack"]'),
    };
  });
  ok(r.full, 'a full directory page is showing');
  ok(r.tiles > 10, 'with more than the row had', String(r.tiles));
  ok(r.natives === 0 && r.machine === 0, 'and nothing else on it', JSON.stringify(r));
  ok(r.back, 'with a way back to the categories');
}

section('And the way back works');
{
  const r = await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirBack"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 500));
    return { doors: document.querySelectorAll('.int-seeall [data-dact="cdirAll"]').length, full: !!document.querySelector('.cdir-full') };
  });
  ok(!r.full && r.doors >= 20, 'the topics are back', JSON.stringify(r));
}

section('A page somebody left is not where they are when they return');
{
  const r = await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirAll"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 400));
    const wasOpen = !!document.querySelector('.cdir-full');
    setTab('chat');
    await new Promise(x => setTimeout(x, 200));
    setTab('integrations');
    await new Promise(x => setTimeout(x, 700));
    return { wasOpen, stillOpen: !!document.querySelector('.cdir-full') };
  });
  ok(r.wasOpen, 'the page was open when they left', r.wasOpen);
  ok(!r.stillOpen, 'and coming back starts at the categories', r.stillOpen);
}

section('The panel names the command before anything is added');
{
  /* A TOPIC PAGE, BECAUSE THAT IS WHERE TILES LIVE NOW. The overview used to
     carry five per row and this section reached for the first of them. It
     draws nothing until a door is opened, which is the change, so the door is
     opened. */
  await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirAll"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 800));
  });
  const r = await page.evaluate(async () => {
    document.querySelector('.cdir-tile').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 400));
    const el = document.querySelector('.cwp');
    const t = el ? el.textContent.replace(/\s+/g, ' ') : '';
    return {
      shown: !!el,
      codes: [...document.querySelectorAll('.cdir-code')].map(c => c.textContent.trim()),
      /* THE CLAIM, NOT THE SENTENCE. This used to grep for "somebody else" and
         "AMV did not write it" - the exact words of a four-line paragraph that
         was replaced by one line, because a wall of warning is read as
         boilerplate and skipped. The thing worth protecting is that the panel
         still says whose program this is and where it runs, so that is what is
         matched. The apostrophe is a character class because the copy uses a
         typographic one. */
      warns: /runs on your( connected)? computer/i.test(t),
      says: /AMV (did|didn.t) ?n?o?t? ?write/i.test(t),
      added: MCP.servers.length,
    };
  });
  ok(r.shown, 'a panel opens for the one that was picked');
  ok(r.codes.some(c => /^npx -y @someone\//.test(c)),
     'showing the exact command that will run', r.codes.join(' | '));
  ok(r.codes.some(c => /io\.github\.someone\//.test(c)),
     'and the package it really is', r.codes.join(' | '));
  ok(r.warns && r.says, 'and saying plainly whose program it is');
  ok(r.added === 0, 'opening it has added nothing', String(r.added));
}

section('Adding it goes through the rule that refuses a credential in a command');
{
  const r = await page.evaluate(async () => {
    document.getElementById('cdir-add').click();
    await new Promise(x => setTimeout(x, 400));
    const s = MCP.servers[0] || {};
    return { n: MCP.servers.length, cmd: s.command, args: (s.args || []).join(' '),
             /* It is CONFIGURED, not started. Starting a program is a separate,
                visible act and this button is not it. */
             live: Object.keys(MCP.live || {}).length };
  });
  ok(r.n === 1, 'it is in the connector list', String(r.n));
  ok(r.cmd === 'npx' && /^-y @someone\//.test(r.args), 'with the command the panel showed', r.cmd + ' ' + r.args);
  ok(r.live === 0, 'and nothing has been started', String(r.live));
}

section('A directory that cannot be reached does not read as an empty one');
{
  await CONNECT('down');
  /* Both, because asking is guarded by two things: what came back, and whether
     the question has already been put. Clearing only the first is a reset that
     resets nothing - the screen stays idle and never asks again. */
  await page.evaluate(() => {
    for (const k in _cdir) delete _cdir[k];
    for (const k in _cdirTried) delete _cdirTried[k];
  });
  await open();
  /* ON A TOPIC PAGE, WHICH IS THE ONLY PLACE A REGISTRY FAILURE CAN SHOW.

     This used to read the overview, where twenty-six rows each carried their
     own error state. The overview asks for nothing now, so an unreachable
     registry is invisible there - correctly, since nothing was attempted. The
     claim itself is unchanged and still matters: when AMV DOES ask and cannot
     get an answer, it must say so rather than showing an empty topic, because
     those are different facts and one of them tells somebody this product
     connects to nothing. */
  await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirAll"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 2500));
  });
  const r = await page.evaluate(() => {
    const t = document.querySelector('.cdir').textContent.replace(/\s+/g, ' ');
    return { tiles: document.querySelectorAll('.cdir-tile').length,
             saysDown: /could not be reached|could not be loaded/i.test(t),
             saysEmpty: /Nothing in the directory matches/i.test(t),
             retry: document.querySelectorAll('[data-dact="cdirRetry"]').length };
  });
  ok(r.tiles === 0, 'nothing is shown', String(r.tiles));
  ok(r.saysDown, 'it says it could not be loaded', r.saysDown);
  ok(!r.saysEmpty, 'and never that nothing matches, which would be a different claim', r.saysEmpty);
  ok(r.retry > 0, 'with a way to try again', String(r.retry));
}

section('A deployment with no backend says that instead');
{
  await page.evaluate(() => {
    AMV_API.base = '';
    for (const k in _cdir) delete _cdir[k];
    for (const k in _cdirTried) delete _cdirTried[k];
  });
  await open();
  /* Same reason as above: with no backend there is nothing to ask, so the
     sentence belongs on the page that would have asked. */
  await page.evaluate(async () => {
    document.querySelector('[data-dact="cdirAll"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 700));
  });
  const r = await page.evaluate(() => {
    const t = document.querySelector('.cdir').textContent.replace(/\s+/g, ' ');
    return { tiles: document.querySelectorAll('.cdir-tile').length,
             says: /not connected to one/i.test(t) };
  });
  ok(r.tiles === 0, 'nothing is invented', String(r.tiles));
  ok(r.says, 'and it says the directory is read from a server this copy has not got', r.says);
}

ok(errors.length === 0, 'and none of it raised a page error', errors.slice(0, 3).join(' | '));

await app.close();
if (report('the-connector-directory-on-the-screen') > 0) process.exitCode = 1;
done();
