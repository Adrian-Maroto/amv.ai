/* CREW HAS POPULAR, AND THE COUNTRY'S OWN INBOX & CALENDAR (Nov 17, the owner:
   "make a section after All which says Popular - the top 50 most popular jobs
   for all countries that AMV can do"; "inbox and calendar is not updated for
   countries"; "don't write 5000").

     · Popular sits right after All, and holds exactly the country's first
       fifty by the list's own research-backed order - with the jobs somebody
       has switched on NOT lifted into it, since that is their list, not what
       is popular;
     · Inbox & calendar names the country's own mailboxes (Naver Mail in
       Korea, WEB.DE in Germany) and its public holidays, and they open;
     · no grand total is written on the page. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
const country = (cc) => page.evaluate(async (cc) => { saveStr('amv_plan', 'pro'); try{ saveStr('amv_cw_country', cc); }catch(e){} try{ _cwSetCountry && _cwSetCountry(cc); }catch(e){} setTab('crew'); }, cc);

section('Popular comes right after All, and is the first fifty');
{
  await country('US');
  await page.waitForSelector('#cj-cats .cj-chip', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#cj-cats .cj-chip')].map(c => c.dataset.darg));
  ok(chips[0] === 'all' && chips[1] === 'popular', 'All, then Popular', chips.slice(0, 3));
  const r = await page.evaluate(() => {
    /* Since Nov 23 Popular IS the researched everyday fifty (crew-data.js
       popular, docs/RESEARCH.md), in their order. */
    const ranked = _cwPopularJobs('US').slice(0, 50).map(j => j.id);
    cjCat('popular');
    const cards = [...document.querySelectorAll('#cj-grid .cj-card-b')].map(b => b.dataset.darg);
    return { ranked, cards: cards.slice(0, 24), n: _cjFiltered().length };
  });
  ok(r.n === 50, 'it holds fifty', r.n);
  ok(r.cards.every((id, i) => id === r.ranked[i]), 'in the order the research ranks them', r.cards.slice(0, 4));
  const on = await page.evaluate(() => {
    /* One job the person has on - the last one in the written list, so its
       research rank is nowhere near the top. */
    const real = window._cwJobs, list = real() || [], last = list[list.length - 1]; if(!last) return null;
    window._cwJobs = () => real().map(j => j.id === last.id ? Object.assign({}, j, { on: true }) : j);
    _cjCache = null; _cjRankCache = null; cjCat('popular');
    const top = _cjList()[0], pop = _cjFiltered().map(x => x.id);
    window._cwJobs = real; _cjCache = null; _cjRankCache = null;
    return { id: last.id, allFirst: !!top && top.id === last.id, inPopularTop: pop.indexOf(last.id) === 0 };
  });
  ok(on && on.allFirst && !on.inPopularTop, 'a job somebody switched on leads All, but is not lifted to the top of Popular', on);
  await page.evaluate(() => cjCat('all'));
}

section('Korea: Naver Mail and its public holidays, in Inbox & calendar');
{
  await country('KR');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const l = _cjList().filter(j => _cjCat(j) === 'Inbox & calendar').map(j => j.title); return l; });
  ok(r.some(t => /Naver/.test(t)) && r.some(t => /Daum|Hanmail/.test(t)), 'the national mailboxes are there', r.filter(t => /Naver|Daum/.test(t)).slice(0, 4));
  ok(r.some(t => /Public holidays in/.test(t)), 'and the country\'s public holidays', r.find(t => /holidays/.test(t)));
  const opened = await page.evaluate(async () => { const j = _cjList().find(x => /Naver/.test(x.title)); cwPeek(j.id); await new Promise(r => setTimeout(r, 300)); return { title: j.title, open: !!document.querySelector('#ovr .cwp, #ovr [role="dialog"]') }; });
  ok(opened.open, 'and one opens like any other job', opened);
  await page.evaluate(() => { try{ closeOvr(); }catch(e){} });
}

section('Germany has its own');
{
  await country('DE');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => _cjList().filter(j => _cjCat(j) === 'Inbox & calendar').map(j => j.title));
  ok(r.some(t => /WEB\.DE|T-Online/.test(t)) && !r.some(t => /Naver/.test(t)), 'WEB.DE, and not Korea\'s', r.filter(t => /WEB|Online|Naver/.test(t)).slice(0, 3));
}

section('Tasks: Popular after All, the country\'s first fifty, and no total sentence');
{
  await page.evaluate(() => { _cwSetCountry('ES'); setTab('tasks'); });
  await page.waitForFunction(() => document.querySelectorAll('#tk2-body .tk-row').length > 5, null, { timeout: 20000 });
  const r = await page.evaluate(async () => {
    const chips = [...document.querySelectorAll('#tk2-cats [data-tkcat]')].map(c => c.dataset.tkcat);
    document.querySelector('#tk2-cats [data-tkcat="popular"]').click(); await new Promise(r => setTimeout(r, 80));
    const rows = [...document.querySelectorAll('#tk2-body .tk-row')].map(b => b.dataset.darg);
    for (let i = 0; i < 5 && document.getElementById('tk-more'); i++){ document.getElementById('tk-more').click(); await new Promise(r => setTimeout(r, 40)); }
    const all = [...document.querySelectorAll('#tk2-body .tk-row')].map(b => b.dataset.darg);
    const sub = document.getElementById('tk2-sub');
    return { chips: chips.slice(0, 3), first: rows.slice(0, 5), n: all.length, want: _tkList.slice(0, 50).map(t => t.id), line: sub.hidden ? '' : sub.textContent };
  });
  ok(r.chips[0] === 'all' && r.chips[1] === 'popular', 'All, then Popular', r.chips);
  ok(r.n === 50 && r.first.every((id, i) => id === r.want[i]), 'fifty, in the list\'s most-visited order', { n: r.n, first: r.first.slice(0, 2) });
  ok(!/\d{1,3}(,\d{3})+|\d{4,}/.test(r.line), 'and no "5,000 tasks naming real services there"', r.line);
  await page.evaluate(() => setTab('crew'));
  await page.waitForTimeout(800);
}

section('No grand total on the page');
{
  const t = await page.evaluate(() => ({ text: document.getElementById('vc').textContent, count: !!document.getElementById('cj-count') }));
  ok(!/\d[\d,.]{3,}\s*(jobs|tasks)\b/i.test(t.text) && !t.count, 'no "23,043 jobs" line', (t.text.match(/\d[\d,.]{3,}\s*(jobs|tasks)/i) || [''])[0]);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
