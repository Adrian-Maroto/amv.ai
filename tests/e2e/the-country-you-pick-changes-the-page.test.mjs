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

   Also pinned: no card wears a count. A curated order wearing a number would
   be the one thing this product may not ship. */
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

/* Crew is one list since Nov 15: "Jobs for <country>", the country as a
   button beside it, and the country's own work leading the list. */
/* Crew opens on Popular since Nov 23; the country's own work leads All. */
const catalogue = () => page.evaluate(() => { try{ if (_cjC !== 'all') cjCat('all'); }catch(e){} }).then(() => page.evaluate(() => ({
  head: ((document.getElementById('cx-jobs-h') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  top: [...document.querySelectorAll('#cj-grid .cj-card-t')].slice(0, 8).map(e => e.textContent.trim()),
  all: (typeof _cjList === 'function' ? _cjList() : []).map(j => j.title),
  dropdown: !!document.getElementById('cw-country'),
  numbers: [...document.querySelectorAll('#cj-grid .cj-card')].filter(c => /\b\d+ (starts|people|uses)\b/.test(c.textContent)).length,
})));

const CW_N = await page.evaluate(() => CW_WORLD_COUNTRIES.length);

section('The list is for the country you are in, led by its own work');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(600);
  const a = await catalogue();
  ok(/^Jobs for .*United States/.test(a.head), 'headed for where the visitor is', a.head);
  ok(a.top.filter(t => /^US /.test(t)).length === 2, 'led by the work written for that country', a.top);
  ok(a.numbers === 0, 'with nothing on a card claiming a worldwide count', a.numbers);
  ok(!a.dropdown, 'and there is no country dropdown', a.dropdown);
  const sw = await page.evaluate(() => document.querySelectorAll('#cj-grid .cj-card [data-dact="cwToggle"]').length === document.querySelectorAll('#cj-grid .cj-card').length);
  ok(sw, 'and every card can be turned on from there', sw);
}

section('A server that never says where you are does not leave the list waiting');
{
  const r = await page.evaluate(async () => {
    const real = AMV_API.where;
    AMV_API.where = () => new Promise(() => {});        // asked, never answered
    _cwHere = ''; _cwHereAsked = false; _cwHereDone = false; cwCountry('-');
    try { sessionStorage.removeItem('amv_cw_here'); } catch (e) {}
    setTab('chat'); setTab('crew');
    await new Promise(res => setTimeout(res, 2200));
    const out = { cards: document.querySelectorAll('#cj-grid .cj-card').length,
      head: ((document.getElementById('cx-jobs-h') || {}).textContent || '').trim() };
    AMV_API.where = real;
    return out;
  });
  ok(r.cards > 0 && r.head.length > 3, 'it shows the list anyway, for the browser’s best guess', r);
}

section('A different country changes the list');
{
  await page.evaluate(() => cwCountry('UZ'));
  await page.waitForTimeout(500);
  const a = await catalogue();
  ok(/Uzbekistan/.test(a.head), 'the heading names Uzbekistan', a.head);
  ok(a.top.some(t => /^UZ /.test(t)), 'led by work that only exists there', a.top);
  await page.evaluate(() => cwCountry('JP'));
  await page.waitForTimeout(500);
  const b = await catalogue();
  ok(/Japan/.test(b.head) && b.top.some(t => /^JP /.test(t)), 'and Japan’s own work when it is Japan', b.top);
  ok(!b.all.some(t => /^UZ /.test(t)), 'with none of the last country left anywhere in the list', b.all.filter(t => /^UZ /.test(t)));
}

section('A country with nothing written for it borrows nothing');
{
  await page.evaluate(() => cwCountry('MN'));
  await page.waitForTimeout(500);
  const c = await catalogue();
  ok(/Mongolia/.test(c.head) && c.all.length > 0, 'Mongolia still gets a list', c.head);
  ok(!c.all.some(t => /^(JP|UZ|US) /.test(t)), 'none of it another country’s', c.all.filter(t => /^(JP|UZ|US) /.test(t)));
}

section('Every other country is one press away');
{
  const r = await page.evaluate(async () => {
    cwCountry('US'); await new Promise(res => setTimeout(res, 300));
    cjCountry(); for (let i = 0; i < 40 && !document.getElementById('ccp-list'); i++) await new Promise(res => setTimeout(res, 50));
    const n = document.querySelectorAll('#ccp-list [data-ccp]').length;
    document.querySelector('#ccp-list [data-ccp="JP"]').click();
    await new Promise(res => setTimeout(res, 500));
    const titles = (_cjList() || []).map(j => j.title);
    const out = { n, titles: titles.slice(0, 8), jp: titles.filter(t => /^JP /.test(t)).length, other: titles.filter(t => /^(UZ|US) /.test(t)).length,
      mine: loadStr('amv_cw_country') === 'JP', head: document.getElementById('cx-jobs-h').textContent };
    cwCountry('US');
    return out;
  });
  ok(r.n === CW_N, 'every country with work written for it is listed', r.n);
  ok(/Japan/.test(r.head) && r.jp === 2 && r.other === 0, 'choosing Japan makes the list Japan’s, with Japan’s own work', r);
  ok(r.mine, 'and choosing it makes it the country the page is for', r.mine);
}

section('Nothing follows the catalogue');
{
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const page_ = document.querySelector('.crew-page');
    const kids = [...page_.children];
    const cat = document.getElementById('cj-jobs');
    return { last: kids.indexOf(cat) === kids.length - 1,
             after: kids.slice(kids.indexOf(cat) + 1).map(e => e.className).join(',') };
  });
  ok(out.last, 'the list of what Crew can do is the last thing on the page', out.after);
}

await app.close();
if (report('the-country-you-pick-changes-the-page') > 0) process.exitCode = 1;
done();
