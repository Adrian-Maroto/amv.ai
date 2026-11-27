/* EACH SECTION LEADS WITH WHAT PEOPLE USE (Nov 27, the owner: "when I go to
   tasks, work and career, why does it say improve my CV at adidas.com and then
   complain to Tesla? The first couple should be improve my CV, write a cover
   letter, find jobs at LinkedIn ... any stupid job goes all the way at the
   bottom. Every section, every country - and I bet it's the same with crew").

   It was: after the opening tasks, "Facebook at a glance", "Jobs at
   Microsoft", "Complain to Tesla", "Contact the National Hockey League" - and
   "Jobs at xHamster" - with LinkedIn nineteenth; Crew opened Work & career on
   "Microsoft in the news" and "National Football League outages". Measured
   here as a person reads the first screen of a section, in five countries. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 } });
const { page, errors } = app;
await page.evaluate(() => setTab('integrations'));
await page.waitForFunction(() => typeof window.ccLoad === 'function' && typeof window.ccTasks === 'function', null, { timeout: 15000 });

const LOW = /^(Complain to|Contact) |at a glance$/;
const CREW_LOW = /in the news|\bresults\b|leadership|patents|share price|outages$|recalls and safety/;
const r = await page.evaluate(async () => {
  const out = {};
  for (const cc of ['US', 'ES', 'DE', 'IN', 'GB']) {
    const d = await ccLoad(cc); if (!d) continue;
    const cat = (x) => _cjCat({ ccKind: x.kind });
    const tasks = ccTasks(d), jobs = ccJobs(d), by = {}, jb = {};
    for (const t of tasks) (by[cat(t)] = by[cat(t)] || []).push(t);
    for (const j of jobs) (jb[cat(j)] = jb[cat(j)] || []).push(j);
    const work = by['Work & career'] || [];
    const near = work.find(t => t.lead && t.tpl === 'Find jobs near me');
    out[cc] = {
      work: work.map(t => ({ title: t.title, kind: t.kind, lead: !!t.lead, n: t.e.n })).slice(0, 14),
      near: near ? near.prompt : '',
      firstScreens: Object.fromEntries(Object.entries(by).map(([c, l]) => [c, l.slice(0, 20).map(t => t.title)])),
      crewWork: (jb['Work & career'] || []).slice(0, 10).map(j => ({ title: j.title, kind: j.kind })),
      crewFirst: Object.fromEntries(Object.entries(jb).map(([c, l]) => [c, l.slice(0, 12).map(j => j.title)])),
      travel: (by.Travel || []).slice(0, 20).map(t => t.e.n),
      shop: (by.Shopping || []).slice(0, 20).map(t => t.title),
    };
  }
  return out;
});

for (const [cc, x] of Object.entries(r)) {
  section(cc + ': Work & career');
  const after = x.work.filter(t => !t.lead);
  ok(x.work.slice(0, 2).map(t => t.title).join('|') === 'Improve my CV|Write a cover letter', 'opens with improving a CV and writing a cover letter', x.work.slice(0, 3).map(t => t.title));
  ok(after[0] && after[0].kind === 'jobsite' && /^Find jobs on /.test(after[0].title), 'then finding jobs on the country’s most used job site', after.slice(0, 3).map(t => t.title));
  ok(/LinkedIn|Indeed|InfoJobs|StepStone|naukri|Reed|XING/i.test(x.near), '"Find jobs near me" names the job sites people there use', x.near.slice(0, 160));
  const low = Object.entries(x.firstScreens).flatMap(([c, l]) => l.filter(t => LOW.test(t)).map(t => c + ': ' + t));
  ok(low.length === 0, 'no section’s first screen has a complaint, a contact page or a company brief', low.slice(0, 5));
  ok(x.crewWork[0] && x.crewWork[0].kind === 'jobsite', 'Crew’s Work & career opens with new jobs on a job site', x.crewWork.slice(0, 3));
  const clow = Object.entries(x.crewFirst).flatMap(([c, l]) => l.filter(t => CREW_LOW.test(t)).map(t => c + ': ' + t));
  ok(clow.length === 0, 'and no Crew section opens on a company’s news, results, outages or share price', clow.slice(0, 5));
  ok(!x.travel.some(n => /cargo|\bUPS\b|fedex|\bDHL\b/i.test(n)), 'Travel names no cargo carrier', x.travel.filter(n => /cargo|UPS|fedex|DHL/i.test(n)));
  ok(!x.shop.some(t => /^Best price (at|on) .*(pizza|burger|chicken|mcdonald|starbucks|cinema|theatre)/i.test(t)), 'Shopping prices no restaurant or cinema', x.shop.filter(t => /pizza|burger|cinema|theatre/i.test(t)));
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
