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
    name: cc === 'UZ' ? 'Uzbekistan' : cc === 'JP' ? 'Japan' : cc,
    countries: ['US', 'UZ', 'JP', 'XX'],
    local: cc === 'XX' ? [] : [
      { id: cc.toLowerCase() + '_a', icon: '📄', title: cc + ' paperwork watch',
        desc: 'Only exists in ' + cc + '.', needs: 'Email' },
      { id: cc.toLowerCase() + '_b', icon: '🧾', title: cc + ' tax dates',
        desc: 'Only exists in ' + cc + '.', needs: 'Email' },
    ],
  });
  AMV_API.crewPopular = async () => { throw new Error('no ranking in this test'); };
});

const catalogue = () => page.evaluate(() => {
  const g = document.getElementById('cw-country-group');
  return {
    group: g ? g.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
    titles: [...document.querySelectorAll('#vc .cw-job-t')].map(e => e.textContent.trim()),
    picked: (document.getElementById('cw-country') || {}).value,
  };
});

section('The five at the top are five real cards');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => ({
    items: document.querySelectorAll('.cw-top5-item').length,
    cards: document.querySelectorAll('.cw-top5-item .cw-job').length,
    toggles: document.querySelectorAll('.cw-top5-item [data-dact="cwToggle"]').length,
    ranks: document.querySelectorAll('.cw-top5-rank').length,
    counts: document.querySelectorAll('.cw-top5-n').length,
    head: (document.querySelector('#cw-pop h3') || {}).textContent || '',
  }));
  ok(out.items === 5, 'five of them', JSON.stringify(out));
  ok(out.cards === 5, 'each one a catalogue card, not a row of text', JSON.stringify(out));
  ok(out.toggles === 5, 'and each one can be turned on from there', JSON.stringify(out));
  /* The ranking endpoint threw, so there is no count - and with no count there
     must be no rank badge and no "N starts" either. */
  ok(out.ranks === 0 && out.counts === 0,
     'with no worldwide count, nothing on them claims one', JSON.stringify(out));
  ok(!/most started/i.test(out.head),
     'and the heading does not say most started', out.head.trim());
}

section('Picking a country puts that country in the list');
{
  await page.evaluate(() => cwCountry('UZ'));
  await page.waitForTimeout(500);
  const a = await catalogue();
  ok(a.picked === 'UZ', 'the control shows what was picked', a.picked);
  ok(/Only in Uzbekistan/.test(a.group), 'the list gains an Uzbekistan group', a.group);
  ok(a.titles.some(t => /^UZ /.test(t)), 'holding work that only exists there',
     a.titles.filter(t => /^UZ /.test(t)).join(' | '));
}

section('Picking a different country changes it');
{
  await page.evaluate(() => cwCountry('JP'));
  await page.waitForTimeout(500);
  const b = await catalogue();
  ok(/Only in Japan/.test(b.group), 'the group follows the choice', b.group);
  ok(b.titles.some(t => /^JP /.test(t)), 'with Japan’s own work in it',
     b.titles.filter(t => /^JP /.test(t)).join(' | '));
  ok(!b.titles.some(t => /^UZ /.test(t)), 'and none of the country left behind',
     b.titles.filter(t => /^UZ /.test(t)).join(' | '));
}

section('A country with nothing written for it says so');
{
  await page.evaluate(() => cwCountry('XX'));
  await page.waitForTimeout(500);
  const c = await catalogue();
  ok(/Nothing specific to/.test(c.group), 'it says nothing is written yet', c.group);
  ok(!c.titles.some(t => /^JP /.test(t)), 'rather than showing another country’s',
     c.titles.filter(t => /^JP /.test(t)).join(' | '));
}

section('Everywhere means everywhere');
{
  await page.evaluate(() => cwCountry(''));
  await page.waitForTimeout(400);
  const d = await catalogue();
  ok(d.group === '', 'choosing Everywhere removes the country group', d.group);
  ok(d.titles.length > 20, 'and the catalogue is still there', String(d.titles.length));
}

section('When there IS a worldwide count, the count is the order');
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
    return {
      head: (document.querySelector('#cw-pop h3') || {}).textContent || '',
      shown: [...document.querySelectorAll('.cw-top5-item .cw-job-t')].map(e => e.textContent.trim()),
      counts: [...document.querySelectorAll('.cw-top5-n')].map(e => e.textContent.trim()),
      ranks: [...document.querySelectorAll('.cw-top5-rank')].map(e => e.textContent.trim()),
      expect: [ids[3], ids[1], ids[5], ids[0], ids[2]].map(i => byId[i]),
    };
  });
  ok(/most started/i.test(out.head), 'the heading says what it is now', out.head.trim());
  ok(out.shown.length === 5, 'still five', String(out.shown.length));
  ok(JSON.stringify(out.shown) === JSON.stringify(out.expect),
     'in the order the server counted, not the order AMV picked',
     out.shown.join(' | '));
  ok(out.ranks.join(',') === '1,2,3,4,5', 'numbered', out.ranks.join(','));
  ok(out.counts[0] === '99 starts', 'and each one carries its real count', out.counts.join(' | '));
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
