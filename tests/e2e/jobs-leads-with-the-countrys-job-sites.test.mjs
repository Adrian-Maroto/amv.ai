/* JOBS & CAREERS LEADS WITH THE COUNTRY'S JOB SITES (owner, Nov 25: "instead
   of job boards worldwide, the popular ones of the country - in the US
   LinkedIn, Indeed; Germany, Spain, Italy, China, Vietnam their own - and
   the popular ones at the top for every country").

   The section opens on the job sites people in the country visit, by visits
   from there (Chrome UX Report); the employers come after the app cards;
   and the "Job boards worldwide" row is gone. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

const jobs = (cc) => page.evaluate(async (cc) => {
  _cwSetCountry(cc); setTab('integrations');
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    const sec = document.querySelector('#int-catalog [data-topic="jobs"]');
    if (sec && sec.querySelector('.cc-svc')) break;
  }
  const sec = document.querySelector('#int-catalog [data-topic="jobs"]');
  if (!sec) return null;
  return [...sec.querySelectorAll('.int-card')].filter(c => getComputedStyle(c).display !== 'none')
    .map(c => ({ n: (c.querySelector('.int-name') || c).textContent.trim(), kind: c.dataset.cc || 'app' }));
}, cc);

const WANT = { US: /Indeed|LinkedIn|Glassdoor|ZipRecruiter/, DE: /StepStone|XING|Indeed|Arbeitsagentur|LinkedIn/i, ES: /InfoJobs|LinkedIn|Indeed/i,
  IN: /Naukri|LinkedIn|Indeed|foundit/i, GB: /Indeed|Reed|LinkedIn|Totaljobs|CV-Library/i };
for (const cc of Object.keys(WANT)) {
  section(cc);
  const r = await jobs(cc);
  const names = (r || []).map(x => x.n);
  ok(Array.isArray(r) && r.length === 9, 'nine on the first screen', names);
  ok(r && r[0] && (r[0].kind === 'jobsite' || r[0].kind === 'global'), 'it opens on a job site, not an employer or an app', r && r[0]);
  ok(names.slice(0, 4).some(n => WANT[cc].test(n)), 'and one of the sites people there use is in the first four', names);
  const firstApp = (r || []).findIndex(x => x.kind === 'app'), firstEmp = (r || []).findIndex(x => x.kind === 'employer' || x.kind === 'company');
  ok(firstEmp < 0 || (firstApp >= 0 && firstApp < firstEmp), 'an employer never comes before the app cards', names);
  ok(!names.includes('Job boards worldwide'), 'and there is no "Job boards worldwide" row', names);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));
await app.close();
report();
done();
