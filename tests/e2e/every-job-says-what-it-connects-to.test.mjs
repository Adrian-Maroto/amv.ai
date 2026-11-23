/* EVERY JOB SAYS WHAT IT CONNECTS TO, AND RUNS AGAIN (owner, Nov 23).

   "Everything has some sort of connection, either the web or this account";
   "for family and school it should be connect to your school account, your
   billing account"; "they can do it every week, every month, every day - not
   a one-time thing". So: every job in Crew repeats; every job's panel has a
   Connects to row (the web, built in, for the ones that search it); and the
   school, family and bill jobs offer the account that makes them about you. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;
const RECUR = /^(hourly|daily|weekdays|weekly|monthly)$/;

section('Every job repeats');
{
  const r = await page.evaluate(async () => {
    saveStr('amv_plan', 'pro'); _cwSetCountry('ES'); setTab('crew');
    await new Promise(r => setTimeout(r, 2500));
    const cat = await ccCrewLoad('ES');
    const D = window.AMV_CREW_DATA || {};
    return {
      builtIn: (D.jobs || []).map(j => [j.id, j.every || 'daily']),
      more: (D.madeMore || []).map(m => [m[1], m[4], m[2]]),
      made: (D.madeFor || []).map(m => [m.k, m.every, m.cat]),
      catalogue: cat.map(j => [j.id, j.every]),
      connects: window.CW_CONNECTS || null,
    };
  });
  const RECUR_ALL = /^(hourly|daily|weekdays|weekly|monthly)$/;
  const bad = [...r.builtIn, ...r.more, ...r.made, ...r.catalogue].filter(x => !RECUR_ALL.test(String(x[1])));
  ok(r.catalogue.length > 100, 'the country catalogue is there to check', r.catalogue.length);
  ok(bad.length === 0, 'no job runs only once', bad.slice(0, 5));

  const C = r.connects || {};
  const school = r.more.filter(m => m[2] === 'Family & kids' || m[2] === 'Learning').concat(r.made.filter(m => m[2] === 'Learning'));
  const noAcct = school.filter(m => !C[m[0]]);
  ok(noAcct.length === 0, 'every family and learning job offers an account', noAcct.map(m => m[0]));
  ok(/Classroom/.test(C.schoolfees || '') && /Email/.test(C.schoolfees || ''), 'school fees offers the school account and the mailbox the bills come to', C.schoolfees);
  ok(/Email/.test(C.broadband || '') && /Email/.test(C.phoneplan || ''), 'and a bill check the mailbox its bills come to', [C.broadband, C.phoneplan]);
}

section('The panel always says what it connects to');
{
  const rows = await page.evaluate(async () => {
    const cat = await ccCrewLoad('ES');
    const pick = ['university', 'bank', 'newspaper'].map(k => cat.find(j => j.ccKind === k)).filter(Boolean);
    const out = {};
    for (const j of pick) {
      try { closeOvr(); } catch (e) {}
      cwPeek(j.id); await new Promise(r => setTimeout(r, 250));
      out[j.ccKind] = [...document.querySelectorAll('.cwp-u')].map(li => li.textContent.replace(/\s+/g, ' ').trim());
    }
    try { closeOvr(); } catch (e) {}
    return out;
  });
  ok((rows.newspaper || []).some(t => /^The web/.test(t)), 'a web job lists the web, built in', rows.newspaper);
  ok((rows.university || []).some(t => /^School account/.test(t)), 'a university job offers the school account', rows.university);
  ok((rows.bank || []).some(t => /^Bank account/.test(t)), 'a bank job offers the bank account', rows.bank);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
