/* POPULAR SAYS WHAT IT MEASURED (Build 16 audit D16-07, Nov 21).

   Popular on Tasks is the head of the country's list in visit order - the
   Chrome UX Report's visits from that country to each service - and on Crew
   the jobs picked for the country come first. Nothing on the screen said
   so, and "Popular" reads as "what people run in AMV", which it is not. Now
   a line under the chips says what the order is, from which month's report,
   and says plainly when a country's file has no visit data at all. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
const note = () => page.evaluate(() => { const n = document.querySelector('.cc-measure'); return n ? n.textContent : null; });

section('Tasks');
{
  await page.evaluate(() => { saveStr('amv_plan', 'pro'); _cwSetCountry('ES'); setTab('tasks'); });
  await page.waitForFunction(() => document.querySelectorAll('#tk2-body .tk-row').length > 5, null, { timeout: 20000 });
  ok(await note() === null, 'All has no such line - it is not a ranking claim', await note());
  await page.click('#tk2-cats [data-tkcat="popular"]');
  const n = await note();
  /* Since Nov 28 Popular is everyday tasks naming no company, in turns
     across the parts of life; inside each, the kinds of service people in
     the country visit most first. */
  ok(/what people in Spain visit most/.test(n || '') && /Chrome UX Report, October 2026/.test(n || ''), 'Popular says it is what people in Spain visit, and from which month', n);
  ok(/not how often a task is run in AMV/.test(n || ''), 'and that it is not use in AMV', n);
}

section('A country whose file has no visit data');
{
  const n = await page.evaluate(async () => {
    const real = await ccLoad('ES');
    const bare = {}; for (const [k, l] of Object.entries(real.kinds)) bare[k] = l.map(e => { const c = Object.assign({}, e); delete c.r; return c; });
    _ccDone.ES = Object.assign({}, real, { kinds: bare });
    try { return { t: ccPopularNote('ES') }; } finally { _ccDone.ES = real; }
  });
  ok(/There is no visit data for Spain/.test(n.t) && /not a measure of what is popular/.test(n.t), 'it says the order is the catalogue\'s, not a measure', n.t);
}

section('An old measurement says it is old (Build 19 audit B19-R-13, NEW-13)');
{
  const r = await page.evaluate(() => {
    const real = Date.now, at = (y, m) => { Date.now = () => Date.UTC(y, m - 1, 15); try { return ccPopularNote('ES'); } finally { Date.now = real; } };
    return { now: at(2026, 11), seven: at(2027, 5), two: at(2028, 10) };
  });
  ok(!/months old|year and a half/.test(r.now), 'a month ago: no caveat', r.now);
  ok(/over six months old, so the order may have changed/.test(r.seven), 'seven months on, it says the order may have changed', r.seven);
  ok(/too old to say what is most visited there now/.test(r.two), 'two years on, it says it is too old to say what is most visited', r.two);
}

section('Crew');
{
  await page.evaluate(() => setTab('crew'));
  await page.waitForSelector('#cj-cats .cj-chip', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => cjCat('popular'));
  const n = await note();
  /* Since Nov 23 Crew's Popular is the researched everyday fifty, and it
     names the research. */
  ok(/^Everyday jobs, in order of how many people use each kind of service/.test(n || '') && /GWI/.test(n || '') && /Pew/.test(n || ''), 'Popular says it is the everyday jobs and names the research', n);
  const counted = await page.evaluate(() => ccPopularNote('ES', 'counted'));
  ok(/switch on most in AMV/.test(counted), 'and where the server has counted switch-ons there, it says that too', counted);
  await page.evaluate(() => cjCat('all'));
  ok(await note() === null, 'All has no such line', await note());
}

section('In Spanish');
{
  const n = await page.evaluate(async () => {
    saveStr('amv_lang', 'es'); await _i18nLoadPack('es');
    return ccPopularNote('ES');
  }).catch(e => String(e));
  ok(/lo que más visita la gente de España/.test(n) && /octubre de 2026/.test(n), 'the sentence and the month are Spanish', n);
  await page.evaluate(() => saveStr('amv_lang', 'en'));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
