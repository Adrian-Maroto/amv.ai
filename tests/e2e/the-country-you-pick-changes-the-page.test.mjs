/* A CONTROL THAT LOOKED LIKE A FILTER AND FILTERED NOTHING.

   Reported: "when it says country United States it's not specifically focused
   on the countries, and when I pick like Uzbekistan it still says the same
   thing". True, and the interesting part is that the DATA was never the
   problem - the Worker carries 105 country packs of five real jobs each, and
   choosing Uzbekistan really did fetch Uzbekistan's five. They arrived in a
   panel of their own, at the top of the catalogue, under a heading about where
   you live, while the hundred cards below it never moved. So the part of the
   screen that changed was the part that had already scrolled away, and the
   part somebody was looking at was identical before and after.

   What is pinned here is that the control is wired to the LIST: choosing a
   country puts that country's own work in the list, choosing Everywhere takes
   it out, and a country with nothing written for it says so rather than
   showing another country's.

   Also pinned: the five at the top are five, they are real cards you can act
   on, and they only carry a count when a count exists. A curated order wearing
   a number would be the one thing this product may not ship. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const page = app.page;

/* A catalogue the page can actually read, answered from here rather than from
   a server, so the test is about the wiring and not about the network. */
await page.evaluate(() => {
  saveStr('amv_plan', 'pro');
  /* `.live` is a getter over `.base`, so assigning it does nothing at all -
     and doing that is how the first run of this file reported the filter
     broken when it was the stub that was. */
  AMV_API.base = 'https://amv-stub.workers.dev';
  AMV_API.token = 'test-token';
  AMV_API.everyday = async (cc) => ({
    name: cc === 'UZ' ? 'Uzbekistan' : cc === 'JP' ? 'Japan' : cc === 'MN' ? 'Mongolia' : cc === 'US' ? 'United States' : cc,
    countries: ['US', 'UZ', 'JP', 'MN'],
    local: cc === 'MN' ? [] : [
      { id: cc.toLowerCase() + '_a', icon: '📄', title: cc + ' paperwork watch',
        desc: 'Only exists in ' + cc + '.', needs: 'Email' },
      { id: cc.toLowerCase() + '_b', icon: '🧾', title: cc + ' tax dates',
        desc: 'Only exists in ' + cc + '.', needs: 'Email' },
    ],
  });
  AMV_API.crewPopular = async () => { throw new Error('no ranking in this test'); };
  /* Where the visitor is, as the network would say it. */
  AMV_API.where = async () => ({ country: 'US', name: 'United States' });
});

const catalogue = () => page.evaluate(() => {
  const g = document.getElementById('cw-foryou');
  return {
    head: g ? ((g.querySelector('h3') || {}).textContent || '').replace(/\s+/g, ' ').trim() : '',
    top: g ? [...g.querySelectorAll('.cw-job-t')].map(e => e.textContent.trim()) : [],
    note: g ? ((g.querySelector('.cw-foryou-note') || {}).textContent || '') : '',
    dropdown: !!document.getElementById('cw-country'),
  };
});

const CW_N = await page.evaluate(() => CW_WORLD_COUNTRIES.length);

/* THE COUNTRY IS WHERE SOMEBODY IS, NOT A DROPDOWN.

   The owner: the first thing under the box is the top five for YOU, for the
   country you are in, with no countries control - and every other country at
   the very bottom. So what is pinned now is that the top five follow the
   country, that another country is one press away at the bottom, and that a
   country with nothing written for it says so rather than borrowing another's. */
section('The five at the top are five real cards, for the country you are in');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => ({
    items: document.querySelectorAll('#cw-foryou .cw-top5-item').length,
    cards: document.querySelectorAll('#cw-foryou .cw-top5-item .cw-job').length,
    toggles: document.querySelectorAll('#cw-foryou .cw-top5-item [data-dact="cwToggle"]').length,
    ranks: document.querySelectorAll('#cw-foryou .cw-top5-rank').length,
  }));
  const a = await catalogue();
  ok(out.items === 5 && out.cards === 5, 'five of them, each a catalogue card', JSON.stringify(out));
  ok(out.toggles === 5, 'and each one can be turned on from there', JSON.stringify(out));
  ok(out.ranks === 0, 'with nothing on them claiming a worldwide count', JSON.stringify(out));
  ok(/^Top 5 for you in .*United States/.test(a.head), 'headed for where the visitor is', a.head);
  ok(a.top.filter(t => /^US /.test(t)).length === 2, 'led by the work written for that country', a.top);
  ok(!a.dropdown, 'and there is no country dropdown', a.dropdown);
}

section('A server that never says where you are does not leave the five as placeholders');
{
  const r = await page.evaluate(async () => {
    const real = AMV_API.where;
    AMV_API.where = () => new Promise(() => {});        // asked, never answered
    _cwHere = ''; _cwHereAsked = false; _cwHereDone = false; cwCountry('-');
    try { sessionStorage.removeItem('amv_cw_here'); } catch (e) {}
    setTab('chat'); setTab('crew');
    await new Promise(res => setTimeout(res, 200));
    const early = !!document.querySelector('#cw-foryou[aria-busy]');
    await new Promise(res => setTimeout(res, 2000));
    const out = { early, busy: !!document.querySelector('#cw-foryou[aria-busy]'),
      cards: document.querySelectorAll('#cw-foryou .cw-job').length,
      head: ((document.querySelector('#cw-foryou h3') || {}).textContent || '').trim() };
    AMV_API.where = real;
    return out;
  });
  ok(r.early, 'it waits a moment for the answer', r);
  ok(!r.busy && r.cards === 5, 'and then shows five anyway, for the browser\u2019s best guess', r);
}

section('A different country changes the five');
{
  await page.evaluate(() => cwCountry('UZ'));
  await page.waitForTimeout(500);
  const a = await catalogue();
  ok(/Uzbekistan/.test(a.head), 'the heading names Uzbekistan', a.head);
  ok(a.top.some(t => /^UZ /.test(t)), 'holding work that only exists there', a.top);
  await page.evaluate(() => cwCountry('JP'));
  await page.waitForTimeout(500);
  const b = await catalogue();
  ok(/Japan/.test(b.head) && b.top.some(t => /^JP /.test(t)), 'and Japan’s own work when it is Japan', b.top);
  ok(!b.top.some(t => /^UZ /.test(t)), 'with none of the country left behind', b.top);
}

section('A country with nothing written for it says so');
{
  await page.evaluate(() => cwCountry('MN'));
  await page.waitForTimeout(500);
  const c = await catalogue();
  ok(/Mongolia/.test(c.head) && c.top.length === 5, 'Mongolia still gets five', c);
  ok(!c.top.some(t => /^(JP|UZ|US) /.test(t)), 'none of them another country’s', c.top);
  const panel = await page.evaluate(async () => {
    cwMoreCountries(); cwBrowse('MN');
    await new Promise(r => setTimeout(r, 300));
    return (document.getElementById('cw-browse') || {}).textContent || '';
  });
  ok(/Nothing written only for Mongolia/.test(panel), 'and its page says nothing is written only for it yet', panel.replace(/\s+/g, ' ').slice(0, 160));
}

section('Every other country is at the bottom, one press away');
{
  const r = await page.evaluate(async () => {
    cwCountry('US'); await new Promise(res => setTimeout(res, 300));
    cwMoreCountries(); await new Promise(res => setTimeout(res, 100));
    const n = document.querySelectorAll('#cw-morec .cw-cc').length;
    cwBrowse('JP'); await new Promise(res => setTimeout(res, 300));
    const b = document.getElementById('cw-browse');
    const titles = b ? [...b.querySelectorAll('.cw-job-t')].map(e => e.textContent.trim()) : [];
    const mine = b ? !!b.querySelector('[data-dact="cwCountry"][data-darg="JP"]') : false;
    const secs = [...document.querySelectorAll('.crew-jobs-sec > *')].map(e => e.id || e.className);
    return { n, titles, mine, last: secs.indexOf('cw-morec') === secs.length - 1, secs: secs.slice(-3) };
  });
  ok(r.n === CW_N, 'every country with work written for it is listed', r.n);
  ok(r.titles.length === 2 && r.titles.every(t => /^JP /.test(t)), 'choosing Japan shows Japan’s own work', r.titles);
  ok(r.mine, 'with a way to make it the country the page is for', r.mine);
  ok(r.last, 'and it is the last thing on the page', r.secs);
}

section('When there IS a worldwide count, it is shown under the list, in its order');
{
  const out = await page.evaluate(async () => {
    const ids = (_cwJobs() || []).slice(0, 6).map(j => j.id);
    AMV_API.crewPopular = async () => ({
      enough: true, total: 412,
      top: [{ id: ids[3], n: 99 }, { id: ids[1], n: 70 }, { id: ids[5], n: 55 },
            { id: ids[0], n: 40 }, { id: ids[2], n: 31 }, { id: ids[4], n: 12 }],
    });
    cwPopReload();
    await new Promise(r => setTimeout(r, 300));
    const byId = {}; (_cwJobs() || []).forEach(j => { byId[j.id] = j.title; });
    const box = document.getElementById('cw-popc') || document;
    return {
      head: (box.querySelector('h3') || {}).textContent || '',
      shown: [...box.querySelectorAll('.cw-top5-item .cw-job-t')].map(e => e.textContent.trim()),
      counts: [...box.querySelectorAll('.cw-top5-n')].map(e => e.textContent.trim()),
      ranks: [...box.querySelectorAll('.cw-top5-rank')].map(e => e.textContent.trim()),
      expect: [ids[3], ids[1], ids[5], ids[0], ids[2]].map(i => byId[i]),
      topStill: /^Top 5 for you/.test(((document.querySelector('#cw-foryou h3') || {}).textContent || '').trim()),
    };
  });
  ok(/most started/i.test(out.head), 'the counted block says what it is', out.head.trim());
  ok(JSON.stringify(out.shown) === JSON.stringify(out.expect),
     'in the order the server counted, not the order AMV picked', out.shown.join(' | '));
  ok(out.ranks.join(',') === '1,2,3,4,5', 'numbered', out.ranks.join(','));
  ok(out.counts[0] === '99 starts', 'and each one carries its real count', out.counts.join(' | '));
  ok(out.topStill, 'while the top of the page stays the five for you', out.topStill);
}

section('Nothing follows the catalogue');
{
  const out = await page.evaluate(() => {
    const page_ = document.querySelector('.crew-page');
    const cat = document.querySelector('.crew-jobs-sec');
    const kids = [...page_.children];
    return { last: kids.indexOf(cat) === kids.length - 1,
             after: kids.slice(kids.indexOf(cat) + 1).map(e => e.className).join(',') };
  });
  ok(out.last, 'the list of what Crew can do is the last thing on the page', out.after);
}

await app.close();
if (report('the-country-you-pick-changes-the-page') > 0) process.exitCode = 1;
done();
