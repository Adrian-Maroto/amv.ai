/* A TOP TEN IS EITHER MEASURED OR IT IS A LIE.

   The owner asked for a page showing the ten most used jobs "based on actual
   data", and the entire value of the request is in those last two words. The
   easy version of this feature is a hand-picked order in a nice list, and it
   would look identical to the real one on the day it shipped and be wrong
   forever after. So this file's job is to prove the list can only ever say
   what was counted:

     - with no backend there is nothing counted, so there is no order at all;
     - below the server's floor it says so plainly and shows no ranking;
     - above it, the order is the order the counts give, unedited;
     - an id the catalogue no longer carries is dropped, not printed raw;
     - a failed read says it failed instead of rendering an empty leaderboard.

   Every case drives the real Crew screen and reads the DOM, because a helper
   called directly would have passed for as long as nothing rendered it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFile } from 'node:fs/promises';

const app = await bootApp({ tab: 'chat', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

/* Render the Crew tab with a given server answer in place, and read back what
   the screen actually shows. `reply` is what /crew/popular returns; null means
   "no backend configured at all". */
async function showCrew(reply, opts = {}) {
  return page.evaluate(async (o) => {
    saveStr('amv_plan', o.plan || 'free');
    if (o.reply === null) {
      AMV_API.base = '';
      delete AMV_API.crewPopular;
    } else {
      AMV_API.base = 'https://stub.amv.dev';
      AMV_API.crewPopular = async () => {
        if (o.reply && o.reply.__throw) throw new Error(o.reply.__throw);
        return o.reply;
      };
    }
    _cwPop = { state: 'idle', data: null, err: '' };
    setTab('crew');
    await new Promise(r => setTimeout(r, 120));
    const body = document.getElementById('cw-pop-body');
    const sec = document.getElementById('cw-pop');
    return {
      present: !!sec,
      text: body ? body.textContent.replace(/\s+/g, ' ').trim() : '',
      rows: [...(body ? body.querySelectorAll('.cw-pop-row') : [])].map(r => ({
        rank: (r.querySelector('.cw-pop-rank') || {}).textContent || '',
        title: (r.querySelector('.cw-pop-t') || {}).textContent || '',
        id: (r.querySelector('.cw-pop-b') || {}).dataset?.darg || '',
        n: ((r.querySelector('.cw-pop-n-t b') || {}).textContent || ''),
      })),
      hasList: !!(body && body.querySelector('.cw-pop-list')),
      retry: !!(body && body.querySelector('[data-dact="cwPopReload"]')),
    };
  }, { reply, plan: opts.plan });
}

/* Two real ids out of the shipped catalogue, so the rows resolve to jobs
   somebody can actually open. Hardcoding invented ids would have tested the
   renderer against a catalogue that does not exist. */
const catalogue = await page.evaluate(() => _cwJobs().slice(0, 4).map(j => ({ id: j.id, title: j.title })));
ok(catalogue.length === 4, 'the catalogue has jobs to rank', catalogue.map(j => j.id).join(', '));

section('With no backend there is nothing counted, and nothing is invented');
{
  const r = await showCrew(null);
  ok(r.present, 'the most-used band is on the Crew page');
  ok(!r.hasList, 'no ranking is drawn');
  ok(/not connected|servers/i.test(r.text), 'and it says why there is none', r.text.slice(0, 120));
}

section('Below the floor it says so, and still shows no order');
{
  const r = await showCrew({ enough: false, total: 6, need: 25, top: [] });
  ok(!r.hasList, 'six starts do not become a top ten');
  ok(/not enough/i.test(r.text), 'it says there is not enough data yet', r.text.slice(0, 100));
  ok(/6 \/ 25/.test(r.text), 'and shows the real distance to a real sample', r.text.slice(0, 160));
}

section('Above the floor the order is the counts, unedited');
{
  /* Deliberately handed to the client out of order in one respect: the payload
     is already sorted by the server, so the client must not re-sort, re-weight
     or re-arrange it. Rank 1 is whatever arrived first. */
  const top = [
    { id: catalogue[2].id, n: 91 },
    { id: catalogue[0].id, n: 40 },
    { id: catalogue[3].id, n: 12 },
  ];
  const r = await showCrew({ enough: true, total: 143, top }, { plan: 'pro' });
  ok(r.hasList, 'the ranking is drawn');
  ok(r.rows.length === 3, 'one row per counted job', r.rows.length);
  ok(r.rows.map(x => x.id).join(',') === top.map(x => x.id).join(','),
     'in exactly the order the counts gave', r.rows.map(x => x.id).join(','));
  ok(r.rows.map(x => x.rank).join(',') === '1,2,3', 'numbered from the top', r.rows.map(x => x.rank).join(','));
  ok(r.rows.map(x => x.n).join(',') === '91,40,12', 'showing the real counts', r.rows.map(x => x.n).join(','));
  ok(r.rows[0].title === catalogue[2].title, 'and naming the actual job', r.rows[0].title);
  ok(/143/.test(r.text), 'the sample size is stated, not hidden', r.text.slice(-90));
}

section('A row opens the job it names');
{
  await page.click('.cw-pop-row:first-child .cw-pop-b');
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => {
    const t = document.querySelector('#cwp-t');
    const title = t ? t.textContent.trim() : '';
    document.getElementById('cwp-close')?.click();
    return title;
  });
  ok(opened === catalogue[2].title, 'clicking the top row opens that job', opened);
}

section('An id the catalogue no longer carries is dropped, not printed raw');
{
  const r = await showCrew({
    enough: true, total: 143,
    top: [{ id: 'a_job_that_was_deleted', n: 200 }, { id: catalogue[1].id, n: 30 }],
  }, { plan: 'pro' });
  ok(r.rows.length === 1, 'only the job that still exists is listed', r.rows.length);
  ok(r.rows[0].id === catalogue[1].id, 'and it is the right one', r.rows[0].id);
  ok(!/a_job_that_was_deleted/.test(r.text), 'the dead id is not shown to anybody');
}

section('Every id gone means an empty band, not an empty leaderboard');
{
  const r = await showCrew({ enough: true, total: 143, top: [{ id: 'gone', n: 9 }] }, { plan: 'pro' });
  ok(!r.hasList, 'no list frame is drawn around nothing');
  ok(r.text.length > 20, 'a sentence explains it instead', r.text.slice(0, 120));
}

section('A failed read says it failed');
{
  const r = await showCrew({ __throw: 'network down' }, { plan: 'pro' });
  ok(!r.hasList, 'a failure does not render as "nobody uses anything"');
  ok(/could not be loaded/i.test(r.text), 'it says the ranking could not load', r.text.slice(0, 120));
  ok(r.retry, 'and offers a way to try again');
}

section('Try again really re-requests');
{
  const after = await page.evaluate(async () => {
    let calls = 0;
    AMV_API.crewPopular = async () => { calls++; return { enough: false, total: 3, need: 25, top: [] }; };
    document.querySelector('[data-dact="cwPopReload"]')?.click();
    await new Promise(r => setTimeout(r, 150));
    const body = document.getElementById('cw-pop-body');
    return { calls, text: body ? body.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  ok(after.calls === 1, 'the button asks the server again', after.calls);
  ok(/not enough/i.test(after.text), 'and the band updates with the new answer', after.text.slice(0, 90));
}

section('The band is reachable from the shipped bundle, not just from a test');
{
  const uses = await page.evaluate(() => {
    const src = (document.getElementById('amv-app-code') || {}).textContent || '';
    return {
      render: (src.match(/_cwPopularHTML\s*\(/g) || []).length,
      load: (src.match(/_cwLoadPopular\s*\(/g) || []).length,
      endpoint: /\/crew\/popular/.test(src),
    };
  });
  /* One is the definition. A caller makes two, and this one has two callers -
     the locked catalogue and the unlocked one. */
  ok(uses.render >= 3, '_cwPopularHTML is rendered by both Crew views', uses.render);
  ok(uses.load >= 2, 'and the load is actually invoked', uses.load);
  ok(uses.endpoint, 'the bundle really calls /crew/popular');
}

section('The floor lives on the server, where the client cannot move it');
{
  /* A client that decides when its own ranking is trustworthy can be told
     otherwise by anybody with a console. The refusal has to be the server's. */
  const worker = await readFile(new URL('../../amv-backend.js', import.meta.url), 'utf8');
  const floor = worker.match(/const CREW_POPULAR_MIN\s*=\s*(\d+)/);
  ok(!!floor, 'the worker names a minimum sample size', floor && floor[1]);
  ok(Number(floor[1]) >= 20, 'and it is big enough to mean something', floor && floor[1]);
  ok(/total\s*<\s*CREW_POPULAR_MIN[\s\S]{0,160}enough\s*:\s*false/.test(worker),
     'below it the server returns enough:false rather than a short list');
  ok(/case '\/crew\/popular'/.test(worker), 'and the endpoint is actually routed');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
