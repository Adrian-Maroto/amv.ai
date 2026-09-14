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

section('Ten of each category, with a way to see the rest');
{
  await CONNECT('ok');
  await open();
  const r = await page.evaluate(() => ({
    rows: document.querySelectorAll('.cdir-row').length,
    perRow: [...document.querySelectorAll('.cdir-row')].map(x => x.querySelectorAll('.cdir-tile').length),
    seeAll: document.querySelectorAll('[data-dact="cdirAll"]').length,
    queries: window.__asked.map(a => a.q),
  }));
  ok(r.rows >= 10, 'there are categories, not one long list', String(r.rows));
  ok(r.perRow.every(n => n === 10), 'ten in each of them', r.perRow.join(','));
  ok(r.seeAll === r.rows, 'and every one has a way to see the rest', String(r.seeAll));
  /* The row headings are not decoration: each one really asked the registry
     its own question, which is what stops a row being a label over whatever
     happened to come back first. */
  ok(new Set(r.queries).size === r.rows, 'each row asked its own question', r.queries.join(','));
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
    return { rows: document.querySelectorAll('.cdir-row').length, full: !!document.querySelector('.cdir-full') };
  });
  ok(!r.full && r.rows >= 10, 'the categories are back', JSON.stringify(r));
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
  const r = await page.evaluate(async () => {
    document.querySelector('.cdir-tile').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(x => setTimeout(x, 400));
    const el = document.querySelector('.cwp');
    const t = el ? el.textContent.replace(/\s+/g, ' ') : '';
    return {
      shown: !!el,
      codes: [...document.querySelectorAll('.cdir-code')].map(c => c.textContent.trim()),
      warns: /somebody else/i.test(t),
      says: /AMV did not write it/i.test(t),
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
  await page.evaluate(() => { for (const k in _cdir) delete _cdir[k]; });
  await open();
  const r = await page.evaluate(() => {
    const t = document.querySelector('.cdir').textContent.replace(/\s+/g, ' ');
    return { tiles: document.querySelectorAll('.cdir-tile').length,
             saysDown: /could not be loaded/i.test(t),
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
  await page.evaluate(() => { AMV_API.base = ''; for (const k in _cdir) delete _cdir[k]; });
  await open();
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
