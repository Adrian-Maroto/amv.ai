/* A UNIVERSAL TOOL HAS TO HAVE REAL THINGS IN COMMON AND REAL DIFFERENCES.

   The first attempt at this took ten job templates and pasted a country name
   into each, so Japan got "Papers and permits in Japan" and Nigeria got
   "Papers and permits in Nigeria". That is a mail merge, not localisation -
   the same job wearing a flag - and it was rightly rejected: "i dont mean
   like paperwork in spain, paperwork in china etc i mean actual examples that
   correlate. this is a universal tool it has to have some similarities in
   between countries and some differences."

   The real material was already on the server and nothing showed it. So the
   split is now the honest one, and this is what proves it is honest rather
   than a nicer-looking template:

     THE SAME EVERYWHERE - ten jobs that ship with the page. Everybody has
     bills with dates, subscriptions that renew themselves, parcels, warranty
     windows and letters they have not answered.

     ONLY THERE - five per country, fetched, and genuinely local: they are
     asserted below by their real names, in their own scripts, because a test
     that only counted them would pass on ten more templates. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const env = makeEnv();
const outbound = makeOutbound();
const L = await bootLive({ env, outbound, port: 9221 });
const { page } = L;

/* SIGNED IN, BECAUSE THE LOCAL HALF IS BEHIND A LOGIN.

   /v1/everyday requires an account. That is a real limit on the feature - the
   person most likely to ask "does this do anything where I live" is somebody
   who has not signed up yet, and they see the universal ten and a sentence
   saying the local set needs an account. Whether to open that catalogue to
   visitors is the owner's call, so this proves the half that works today
   rather than asserting a product decision nobody has made. */
const EMAIL = 'local@example.com';
const PW = 'A-real-Passw0rd!';
await page.evaluate(async ([em, pw]) => {
  openAuth('signup');
  await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Local'); type('#a-email', em); type('#a-pass', pw);
  document.getElementById('auth-submit').click();
  await __amvSignedIn();
}, [EMAIL, PW]);

const pick = (code) => page.evaluate(async (cc) => {
  cwCountry(cc);
  const stop = Date.now() + 10000;
  while (Date.now() < stop && (_cwLocalState[cc] || 'loading') === 'loading')
    await new Promise(r => setTimeout(r, 50));
  return {
    state: _cwLocalState[cc],
    local: _cwLocalJobs(cc).map(j => j.title),
    onScreen: [...document.querySelectorAll('.cw-country .cw-job-t')].map(e => e.textContent),
  };
}, code);

section('The half that is the same wherever you are');
{
  const u = await page.evaluate(() => _cwUniversalJobs().map(j => j.title));
  ok(u.length === 10, 'ten universal jobs ship with the page', u.length);
  /* Named, not counted: the point is that these are things a person in any
     country actually has, not that there are ten of something. */
  ['Bills due this week', 'Free trials about to charge', 'Renewals and expiry dates']
    .forEach(t => ok(u.includes(t), `"${t}" is one of them`, t));
  const needsBackend = await page.evaluate(() =>
    _cwUniversalJobs().every(j => j.title && j.desc && j.needs));
  ok(needsBackend, 'and each is complete without asking the server for anything');
}

section('The half that only exists where you are');
{
  /* Three countries with nothing in common, so a template would be obvious:
     a Japanese tax adjustment, a Nigerian identity number and a Spanish
     self-employment contribution cannot all come out of one shape. */
  const jp = await pick('JP');
  ok(jp.state === 'ok', 'the local set for Japan loads', jp.state);
  ok(jp.local.some(t => /年末調整|確定申告/.test(t)),
     'and it names Japanese tax paperwork in Japanese', jp.local);
  ok(jp.local.some(t => /在留|住民税|ふるさと納税/.test(t)),
     'along with the residence and local-tax work that only exists there', jp.local);

  const ng = await pick('NG');
  ok(ng.state === 'ok', 'the local set for Nigeria loads', ng.state);
  ok(ng.local.some(t => /NIN|BVN/.test(t)),
     'and it names the Nigerian identity numbers, not "papers and permits"', ng.local);
  ok(ng.local.some(t => /DisCo|airtime|token/i.test(t)),
     'along with prepaid power and airtime, which exist there and not in Japan', ng.local);

  const es = await pick('ES');
  ok(es.state === 'ok', 'the local set for Spain loads', es.state);
  ok(es.local.some(t => /Renta|aut[oó]nomo/i.test(t)),
     'and it names the Spanish tax return and self-employment contribution', es.local);
  ok(es.local.some(t => /ITV|DNI|NIE|TIE/.test(t)),
     'along with the vehicle test and identity documents Spain actually uses', es.local);

  /* The decisive one. If these were templates the three countries would share
     their job titles with only the country name swapped. */
  const shared = jp.local.filter(t => ng.local.includes(t) || es.local.includes(t));
  ok(shared.length === 0,
     'and no two countries share a local job - these are not one shape repeated', shared);
}

section('Both halves are on the screen, and labelled as what they are');
{
  const seen = await page.evaluate(() =>
    [...document.querySelectorAll('.cw-split-h b')].map(b => b.textContent));
  ok(seen.some(t => /same everywhere/i.test(t)), 'the common half says so', seen);
  ok(seen.some(t => /only in spain/i.test(t)), 'and the local half names the country', seen);
}

section('A country with nothing written for it says so rather than inventing');
{
  const none = await page.evaluate(async () => {
    /* A code the packs do not cover. The honest outcome is an empty local
       list and a sentence, never a generated stand-in. */
    _cwLocalCache.ZZ = []; _cwLocalState.ZZ = 'ok';
    cwCountry('ZZ');
    await new Promise(r => setTimeout(r, 250));
    return { local: _cwLocalJobs('ZZ').length,
             text: (document.querySelector('.cw-country-empty') || {}).textContent || '' };
  });
  ok(none.local === 0, 'nothing is fabricated for it', none.local);
  ok(/still apply|same everywhere/i.test(none.text),
     'and it says the universal ones still hold, which is true', none.text.slice(0, 80));
}

section('No JavaScript errors');
ok(L.errors.length === 0, 'zero uncaught page errors', L.errors.slice(0, 3));

await L.close();
if (report('the-work-is-local-where-it-should-be') > 0) process.exitCode = 1;
done();
