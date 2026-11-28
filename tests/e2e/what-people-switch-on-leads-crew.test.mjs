/* WHAT PEOPLE SWITCH ON LEADS CREW, AND UNTIL THEN IT SAYS "SUGGESTED"
   (Nov 28, Build 19 audit B19-R-01, R-11, D-02, NEW-01, NEW-02, NEW-03, NEW-25).

   Popular was the researched fifty in a fixed order, then everything else, so
   a job people really switch on could never come first however many did; the
   chip said Popular with no count behind it; and All, which Crew opens on,
   without the server's facts led the United States with "Xfinity inbox
   digest" and Pakistan with public holidays. The server half (one account counted once
   per job, floors before anything is named) is in
   tests/worker/every-job-knows-its-country. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.waitForFunction(() => typeof window._ccReady === 'function', null, { timeout: 15000 });

const view = (cc) => page.evaluate(async (cc) => {
  _cwSetCountry(cc); setTab('crew'); await new Promise(x => setTimeout(x, 3000));
  return {
    on: (document.querySelector('.cj-chip.on') || {}).textContent || '',
    chips: [...document.querySelectorAll('.cj-chip')].map(b => b.textContent.trim()),
    note: (document.querySelector('#cj-grid .cc-measure, .cc-measure') || {}).textContent || '',
    first: _cjFiltered().slice(0, 3).map(j => j.id + ' ' + j.title),
  };
}, cc);

section('With no counts, the chip says Suggested and the note says why');
for (const cc of ['PK', 'US', 'BD']) {
  const r = await view(cc);
  ok(r.chips.includes('Suggested') && !r.chips.includes('Popular'), cc + ': the chip is Suggested, not Popular', r.chips.slice(0, 3));
  ok(/inbox/i.test(r.first[0]) && !/Xfinity|AT&T|holiday/i.test(r.first.join(' ')), cc + ': Crew opens on the inbox, not one provider or the holidays', r.first);
  const p = await page.evaluate(async () => { cjCat('popular'); await new Promise(x => setTimeout(x, 200));
    const n = (document.querySelector('.cc-measure') || {}).textContent || ''; cjCat('all'); return n; });
  ok(/Not yet enough people here have used AMV/.test(p), cc + ': and Suggested says there is no count yet', p.slice(0, 160));
}

section('Without the server, All no longer leads with one named mailbox (B19-D-02)');
{
  const r = await page.evaluate(async () => {
    _cwSetCountry('US'); setTab('crew'); await new Promise(x => setTimeout(x, 1500));
    cjCat('all'); await new Promise(x => setTimeout(x, 300));
    return _cjFiltered().slice(0, 5).map(j => j.title);
  });
  ok(!/Xfinity|AT&T|Cox|Spectrum/.test(r.slice(0, 3).join(' ')), 'the United States’ All starts with everyday jobs, not Xfinity', r);
}

section('A job enough people switch on enters position one (NEW-01)');
{
  const r = await page.evaluate(async () => {
    _cwSetCountry('US'); setTab('crew'); await new Promise(x => setTimeout(x, 1500));
    const fifty = new Set((_cwPopularJobs('US') || []).map(j => j.id));
    const pick = _cjRanked().filter(j => !fifty.has(j.id) && ['daily', 'weekly', 'hourly'].includes(String(j.every || 'daily')) && !CJ_ONE_OFF.test(j.title)).slice(-1)[0];
    const two = _cjRanked().filter(j => !fifty.has(j.id) && j !== pick && ['daily', 'weekly'].includes(String(j.every || 'daily')) && !CJ_ONE_OFF.test(j.title))[3];
    const meta = _cwMeta.US || (_cwMeta.US = {});
    const keep = meta.ranked;
    meta.ranked = { enough: true, total: 40, need: 25, each: 3, counts: { [pick.id]: 9, [two.id]: 2 } };
    try{
      cjCat('popular'); await new Promise(x => setTimeout(x, 300));
      const list = _cjFiltered();
      return { pick: pick.id, two: two.id, first: list[0] && list[0].id, twoAt: list.findIndex(j => j.id === two.id),
               on: (document.querySelector('.cj-chip.on') || {}).textContent || '',
               note: (document.querySelector('.cc-measure') || {}).textContent || '' };
    } finally { meta.ranked = keep; }
  });
  ok(r.first === r.pick, 'a job outside the researched fifty, switched on by nine accounts, is first', r);
  ok(r.twoAt !== 0 && r.twoAt !== 1, 'while one with two starts - under the floor of three - is not lifted', r.twoAt);
  ok(r.on.trim() === 'Popular' && /counted once per account/.test(r.note), 'and only now is the chip Popular, saying what it counted', r);
}

section('Each section is ordered the same way (NEW-02, B19-R-11)');
{
  const r = await page.evaluate(async () => {
    _cwSetCountry('US'); setTab('crew'); await new Promise(x => setTimeout(x, 1500));
    const cats = {}; _cjList().forEach(j => { const c = _cjCat(j); (cats[c] = cats[c] || []).push(j); });
    const cat = Object.keys(cats).find(c => cats[c].length >= 6 && c !== 'all');
    const last = cats[cat][cats[cat].length - 1];
    const meta = _cwMeta.US || (_cwMeta.US = {});
    const keep = meta.ranked;
    try{
      meta.ranked = { enough: true, total: 40, need: 25, each: 3, counts: { [last.id]: 5 } };
      cjCat(cat); await new Promise(x => setTimeout(x, 200));
      const lifted = _cjFiltered()[0].id;
      meta.ranked = keep;
      cjCat(cat); await new Promise(x => setTimeout(x, 200));
      const plain = _cjFiltered()[0].id;
      return { cat, last: last.id, lifted, plain };
    } finally { meta.ranked = keep; cjCat('popular'); }
  });
  ok(r.lifted === r.last, 'in "' + r.cat + '", the counted job leads the section', r);
  ok(r.plain !== r.last, 'and without the count it goes back to its place', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
