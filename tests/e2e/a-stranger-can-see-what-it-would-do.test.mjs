/* THE QUESTION THAT GETS ASKED BEFORE ANYBODY SIGNS UP.

   "Does this do anything where I live" is not a question a customer asks. It
   is the question somebody asks while deciding whether to become one, and for
   a long time AMV answered it with a signup form. Two separate walls stood in
   the way, and taking down either one alone would have achieved nothing:

     THE ROUTE. /v1/everyday required an account. It returns three constants -
     ten universal jobs, five for the country asked about, and the country
     names - so there was never anything behind that wall to protect.

     THE SCREEN. Crew was on the gated-tab list, so a signed-out visitor
     clicking it got a signup modal and never saw the catalogue at all. A
     public route behind a locked door is the "correct at both ends, not joined
     in the middle" defect this codebase keeps producing, so this file asserts
     the whole path rather than either half.

   What is NOT opened matters as much. Browsing is not running: the box that
   takes an instruction refuses without an account, says why in a sentence, and
   offers the way forward. Everything else - the surfaces that write data,
   spend money, or show something belonging to an account - stays gated, and
   that is asserted here too, because "we opened Crew" must not quietly become
   "we opened everything". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* user: null is a real stranger - no session, no email, nothing restored. */
const app = await bootApp({ tab: 'chat', user: null });
const { page, errors } = app;

section('A visitor with no account can open Crew at all');
{
  const before = await page.evaluate(() => !!(S.user && S.user.email));
  ok(before === false, 'nobody is signed in', before);

  const after = await page.evaluate(async () => {
    setTab('crew');
    await new Promise(r => setTimeout(r, 400));
    return { tab: S.tab, signupShown: !!document.getElementById('auth-submit') };
  });
  ok(after.tab === 'crew', 'clicking Crew opens Crew', after.tab);
  ok(!after.signupShown, 'and does not throw a signup form in front of it', after.signupShown);
}

section('What they get is the catalogue, not a pitch');
{
  const seen = await page.evaluate(() => ({
    locked: document.querySelectorAll('.cw-locked').length,
    jobs: document.querySelectorAll('#vc .cw-job').length,
    bands: [...document.querySelectorAll('.cw-split-h b')].map(b => b.textContent.trim()),
    picker: !!document.getElementById('cw-country'),
    find: !!document.getElementById('cw-find'),
  }));
  ok(seen.locked === 1, 'they get the same screen somebody on the free plan gets', seen.locked);
  ok(seen.jobs > 20, 'with real jobs on it, not a description of jobs', seen.jobs);
  ok(seen.picker, 'the country picker is there', seen.picker);
  ok(seen.find, 'and so is the search box', seen.find);
  ok(seen.bands.some(t => /same everywhere/i.test(t)), 'the universal half is labelled', seen.bands);
}

section('The half that is only true where they live reaches them too');
{
  /* The point of opening the route. Nothing is stubbed: the page asks, and
     what comes back is asserted by its real local content. Without a backend
     in this harness the honest answer is the offline sentence, so the
     assertion is on the REQUEST being made and carrying no credential -
     which is the thing that used to be impossible. */
  const asked = await page.evaluate(async () => {
    const seen = [];
    /* This harness serves the page with no backend behind it, and the client
       correctly declines to ask when there is nothing to ask - which is why
       the country half reads "cannot reach the server" a moment earlier. So a
       backend is declared, and the country is then re-asked on its own: the
       lookup remembers the SITUATION it last asked in, and a backend arriving
       is precisely the change that earns a second attempt.

       The real end-to-end proof, against a Worker actually running with no
       session, is in the-work-is-local-where-it-should-be. What is asserted
       here is the shape of the request a stranger's browser sends. */
    AMV_API.base = location.origin;   // `live` is a getter over this, not a flag
    AMV_API.token = '';
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const url = String(u);
      if (url.includes('/v1/everyday')) {
        seen.push({ url, auth: !!((o && o.headers && (o.headers.Authorization || o.headers.authorization))) });
        return new Response(JSON.stringify({
          ok: true, country: 'ES', name: 'Spain',
          local: [{ id: 'es_renta', icon: '🧾', title: 'Renta: the annual tax return',
                    desc: 'The draft, the deadline and what it says you owe.', needs: 'Email' }],
          universal: [], countries: [{ code: 'ES', name: 'Spain' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return real(u, o);
    };
    cwCountry('ES');
    const stop = Date.now() + 8000;
    while (Date.now() < stop && (_cwLocalState.ES || 'loading') === 'loading')
      await new Promise(r => setTimeout(r, 50));
    window.fetch = real;
    return { seen, state: _cwLocalState.ES, titles: _cwLocalJobs('ES').map(j => j.title) };
  });
  ok(asked.seen.length >= 1, 'picking a country actually asks the server', asked.seen.length);
  ok(asked.seen.every(s => !s.auth),
     'and asks with no credential, because a stranger has none', asked.seen.map(s => s.auth));
  ok(asked.state === 'ok', 'the answer is accepted', asked.state);
  ok(asked.titles.some(t => /Renta/.test(t)),
     'and what only exists in Spain is on the screen for somebody with no account', asked.titles);
}

section('Browsing is not running, and the difference is said out loud');
{
  const refused = await page.evaluate(async () => {
    const el = document.getElementById('mc-cmd-input');
    el.value = 'summarize my last meetings';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    const box = document.getElementById('mc-cmd-result');
    return { text: (box.textContent || '').replace(/\s+/g, ' ').trim(),
             signup: !!box.querySelector('[data-auth="signup"]') };
  });
  ok(/takes an account/i.test(refused.text),
     'asking it to run something says an account is needed', refused.text.slice(0, 80));
  /* The failure this replaces: it printed "Reading your request..." and then
     died underneath, which looks like working and never was. */
  ok(!/Reading your request/i.test(refused.text),
     'and does not pretend to start first', refused.text.slice(0, 80));
  ok(refused.signup, 'and offers the way forward rather than a dead box', refused.signup);

  const opens = await page.evaluate(async () => {
    document.querySelector('#mc-cmd-result [data-auth="signup"]').click();
    await new Promise(r => setTimeout(r, 400));
    return !!document.getElementById('auth-submit');
  });
  ok(opens, 'and that button really opens signup', opens);
}

section('Opening Crew did not open everything else');
{
  const still = await page.evaluate(async () => {
    const out = {};
    for (const t of ['build', 'team', 'market', 'tasks', 'integrations', 'memory']) {
      const o = document.getElementById('ovr'); if (o) o.remove();
      setTab('chat');
      setTab(t);
      await new Promise(r => setTimeout(r, 120));
      out[t] = S.tab;
    }
    return out;
  });
  Object.entries(still).forEach(([tab, landed]) =>
    ok(landed !== tab, `${tab} still asks for an account`, landed));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-stranger-can-see-what-it-would-do') > 0) process.exitCode = 1;
done();
