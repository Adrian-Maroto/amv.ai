/* TWO TRUE THINGS WERE INVISIBLE, AND BETWEEN THEM THE PRODUCT LOOKED SMALL.

   The per-country catalogue holds five everyday jobs for each of forty-five
   countries. It exists to answer "does this do anything where I live" for
   somebody who has not signed up yet, so it is a MENU OF EXAMPLES - but a
   screen showing five things and nothing else is read as five things being
   all there is. The honest catalogue was doing the work of a limit.

   And the connector directory - the bridge starting any server in the public
   registry that ships a package, which is the real answer to "can it do X"
   for almost any X - lived behind one row inside Integrations.

   So this screen states the ceiling first and the examples last, which is the
   reverse of how they sat before. What this file holds is that ordering, that
   every line goes somewhere real, and that nothing on it claims a number the
   product cannot check. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: 'https://backend.example.workers.dev',
                            user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* The two endpoints this screen reads, answered so the test drives what the
   page is told rather than what a network happens to do. */
async function open(opts) {
  const o = opts || {};
  await page.route('**/v1/connectors**', r => o.connectorsDown
    ? r.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ ok: false, error: 'unreachable' }) })
    : r.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ ok: true, servers: [
                    { name: 'filesystem' }, { name: 'github' }, { name: 'postgres' },
                    { name: 'slack' }, { name: 'stripe' }] }) }));
  await page.route('**/v1/coverage**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, byContinent: {}, countries: [],
      totals: { countries: 45, continents: 6, everydayJobs: 235, jobBoards: 120,
                mailProviders: 40, mailGlobal: 6 } }) }));

  return page.evaluate(async () => {
    saveStr('amv_api_base', 'https://backend.example.workers.dev');
    saveStr('amv_api_token', 'tok'); saveStr('amv_token_exp', String(Date.now() + 3e6));
    S.tab = 'abilities';
    await renderAbilitiesView();
    await new Promise(r => setTimeout(r, 300));
    const txt = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : ''; };
    const top = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().top) : -1; };
    return {
      heading: txt('.ab-t'),
      sub: txt('.ab-sub'),
      ceiling: txt('.ab-ceiling'),
      chips: [...document.querySelectorAll('.ab-chip')].map(c => c.textContent.trim()),
      world: txt('.ab-world'),
      rows: [...document.querySelectorAll('.ab-row')].map(r => ({
        name: (r.querySelector('.ab-n') || {}).textContent || '',
        go: r.dataset.abGo,
        tag: r.tagName,
      })),
      ceilingTop: top('.ab-ceiling'),
      worldTop: top('.ab-world'),
      whole: txt('.ab'),
    };
  });
}

section('It is reachable from the rail, beside the other sections');
{
  const r = await page.evaluate(() => {
    const b = document.querySelector('#sb-tools [data-tab="abilities"]');
    const tools = [...document.querySelectorAll('#sb-tools .sb-tool')].map(x => x.dataset.tab);
    return { there: !!b, label: b ? b.getAttribute('aria-label') : '', tools };
  });
  ok(r.there, 'the rail has an entry for it', r.tools);
  ok(r.tools.indexOf('abilities') === r.tools.indexOf('tasks') + 1,
     'sitting next to Tasks, where it was asked for', r.tools);
  ok(/what amv can do/i.test(r.label), 'and it says what it is', r.label);
}

section('The ceiling is stated before the examples');
{
  const r = await open();
  ok(r.ceilingTop > 0 && r.worldTop > 0, 'both sections rendered', [r.ceilingTop, r.worldTop]);
  /* THE WHOLE POINT OF THE SCREEN. Put the country list first and it reads as
     the edge of what works, which is the impression this exists to correct. */
  ok(r.ceilingTop < r.worldTop,
     'connectors above the country catalogue, not below it', [r.ceilingTop, r.worldTop]);
  ok(/programs other people wrote/i.test(r.ceiling),
     'and the ceiling is said plainly', r.ceiling.slice(0, 90));
}

section('The country list is named as examples, not as a limit');
{
  const r = await open();
  ok(/45/.test(r.world), 'it still says how many countries', r.world.slice(0, 80));
  /* One sentence does most of the work here. Without it the number reads as a
     boundary rather than a set of worked examples. */
  ok(/not a limit/i.test(r.world),
     'and says explicitly that those are examples rather than the edge', r.world.slice(0, 200));
  ok(/works everywhere/i.test(r.world),
     'with what IS true everywhere said in the same breath', r.world.slice(0, 200));
}

section('Nothing on the screen claims a number it cannot check');
{
  /* There is a figure in the connector directory's own comment for how many
     servers are startable. The endpoint returns a PAGE and carries no total,
     so putting that number here would be a claim nothing in the product could
     verify - and an unverifiable headline is the first thing a sceptical
     reader tests. */
  const r = await open();
  ok(!/9,?451|20,?000|thousands of/i.test(r.whole),
     'no invented count of connectors appears', (r.whole.match(/[\d,]{4,}/g) || []).join(' '));
  ok(r.chips.length > 0, 'it shows what actually came back instead', r.chips);
  ok(r.chips.indexOf('github') >= 0, 'named from the response, not from a list in the page', r.chips);
}

section('A deployment that cannot reach the registry says so');
{
  const r = await open({ connectorsDown: true });
  ok(r.chips.length === 0, 'no chips are invented', r.chips);
  ok(/could not be reached/i.test(r.ceiling),
     'it says the directory could not be reached', r.ceiling.slice(0, 140));
  /* Specific about WHICH failure. "Check your connection" when the answer is
     a missing backend wastes somebody's afternoon. */
  ok(/backend connected/i.test(r.ceiling),
     'and names the actual cause rather than blaming the network', r.ceiling.slice(0, 200));
}

section('Every line goes somewhere real');
{
  /* A capability list you cannot press is a brochure. This is the difference
     between the screen working and the screen being marketing. */
  const r = await open();
  ok(r.rows.length >= 8, 'there are real rows', r.rows.length);
  ok(r.rows.every(x => x.tag === 'BUTTON'), 'each is a control, not a paragraph', r.rows[0]);

  const known = await page.evaluate((gos) => {
    /* Resolved against the tabs the app actually dispatches, so a row naming
       a screen that does not exist fails here rather than silently landing on
       a 404 for whoever presses it. */
    const WHERE = { bridge: 'integrations', games: 'crew' };
    return gos.map(g => {
      const t = WHERE[g] || g;
      try { setTab(t); return { g, t, landed: S.tab }; }
      catch (e) { return { g, t, landed: 'threw' }; }
    });
  }, r.rows.map(x => x.go));
  const lost = known.filter(x => x.landed === 'threw' || x.landed === 'notfound');
  ok(lost.length === 0, 'and every one of them opens a screen that exists', lost);
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('the-ceiling-is-stated-before-the-examples') > 0) process.exitCode = 1;
done();
