/* "ANYTHING FOREIGN COUNTRY MAKE SURE IT CAN ACTUALLY RECOGNIZE WHAT IT'S
   ASKING FOR EVEN IF IT'S NICHE."

   Recognition is the planner's job, and it is good at it - given the one fact
   it was not being given. "Pay my Bizum", "renew my NIE", "file my BIR 2316",
   "check my Aadhaar", "sort my PAYE" each mean one specific thing where they
   are said and nothing at all anywhere else. Crew already knows the country:
   somebody chose it in the filter, or the browser was asked on the first
   visit. It simply was not travelling with the request, so every plan was made
   as though it came from nowhere.

   What is measured here is that the fact ARRIVES, and arrives on the data side
   of the turn rather than in the instructions - the same rule everything read
   off somebody's settings follows here, because information about a person
   must not share a channel with the rules. Whether the model then resolves
   Bizum correctly is not something a suite can assert, and this does not
   pretend to. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'crew', user: { name: 'Adrian', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('Choosing a country puts it in the sentence');
{
  const r = await page.evaluate(() => {
    cwCountry('ES');
    const es = _feasWhere();
    cwCountry('JP');
    const jp = _feasWhere();
    /* "Everywhere" had a control, and it is gone: Crew is for the country
       somebody is in. A stored "everywhere" from before is no choice at all,
       so the planner is told where they actually are, not nothing. */
    cwCountry('-');
    const none = _feasWhere();
    return { es, jp, none, here: (CW_WORLD_COUNTRIES.find(c => c[0] === _cwCountryGuess()) || [])[1] || '' };
  });
  ok(/Spain/.test(r.es), 'the country is named, not coded', r.es.slice(0, 60));
  ok(/Japan/.test(r.jp), 'and it changes when the choice changes', r.jp.slice(0, 60));
  ok(r.here && r.none.indexOf(r.here) >= 0, 'with no choice, it is where they are that is sent', JSON.stringify(r.none).slice(0, 80));
}

section('It tells the planner an unfamiliar service is a thing to look up');
{
  const r = await page.evaluate(() => { cwCountry('BR'); return _feasWhere(); });
  ok(/local service, tax, form/.test(r), 'it names what kinds of thing to resolve locally');
  ok(/not a reason to say it cannot be done/.test(r),
     'and says outright that an unfamiliar local service is not an impossibility');
}

section('It reaches the planner, on the data side of the turn');
{
  const r = await page.evaluate(async () => {
    cwCountry('ES');
    /* Stubbed at the two seams the planner actually uses, so what is captured
       is the real call this code makes rather than a re-reading of it. */
    const realReady = window._aiBackendReady, realComplete = window.aiComplete;
    let seen = null;
    window._aiBackendReady = () => true;
    window.aiComplete = async (user, sys) => { seen = { user, sys }; return '[]'; };
    await AMVUniversal.plan('pay my Bizum and check the Seguridad Social letter');
    window._aiBackendReady = realReady; window.aiComplete = realComplete;
    return { inUser: /Spain/.test(seen ? seen.user : ''), inSys: /Spain/.test(seen ? seen.sys : ''),
             hasRequest: /Bizum/.test(seen ? seen.user : '') };
  });
  ok(r.hasRequest, 'the request itself is there');
  ok(r.inUser, 'and so is where they are');
  ok(!r.inSys, 'but not in the system prompt, where data does not belong');
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
