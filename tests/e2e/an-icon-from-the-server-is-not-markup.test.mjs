/* THE CREW ICON CAME FROM THE SERVER AND WENT STRAIGHT INTO innerHTML.

   The everyday catalogue is FETCHED - AMV_API.everyday(cc) - and
   _cwEverydayJob carries `raw.icon` through from that response untouched. It
   was then interpolated with no escaping on three surfaces: the job card, the
   locked card, and the peek panel. The approvals card did the same with an
   icon off a stored record.

   _safeIcon is the helper the marketplace already uses for precisely this: an
   emoji or short label is escaped, and markup passes only if it is one of
   AMV's own SVGs. The Crew catalogue simply never used it.

   WHAT THIS IS AND IS NOT. The strict CSP means an injected tag could not RUN
   anything - measured below, the handler does not fire - so this was a hole in
   the discipline rather than a live exploit. The discipline is the point.
   Deciding which strings are safe by reasoning about where they came from is
   the exact thing escH exists to stop anybody having to do, and "the server
   sends it" stops being reassuring the moment a catalogue takes a submission
   or somebody points AMV at another backend, which Settings lets them do.

   So the assertion is that the markup is NOT IN THE DOM - not that it failed
   to execute. A test that only checked execution would pass on a page with no
   CSP and an injected tag sitting in it. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

const NASTY = '<img src=x onerror="window.__pwned=1">';

section('A catalogue icon that is markup renders as none of it');
{
  const r = await page.evaluate(async (NASTY) => {
    window.__pwned = 0;
    /* Built the way the fetched catalogue builds one, so what is measured is
       the real path from the endpoint to the screen. */
    const job = _cwEverydayJob(
      { country: 'ES', id: 'evil', title: 'Evil', desc: 'd', icon: NASTY }, 'Spain', true);
    const out = { carried: job.icon === NASTY, cards: {} };
    for (const [name, html] of [['job', _cwJobCard(job)], ['locked', _cwLockedCard(job)]]) {
      const d = document.createElement('div');
      document.body.appendChild(d);
      d.innerHTML = html;
      out.cards[name] = {
        img: !!d.querySelector('img'),
        raw: /onerror/i.test(d.innerHTML),
        iconText: (d.querySelector('.cw-job-ic') || { textContent: '' }).textContent.trim(),
      };
      d.remove();
    }
    await new Promise(r => setTimeout(r, 250));
    out.pwned = window.__pwned;
    return out;
  }, NASTY);

  /* The icon really does arrive on the job object. Without this the rest could
     pass because nothing ever carried the value. */
  ok(r.carried === true, 'the server value reaches the job object unchanged', r.carried);

  for (const [name, c] of Object.entries(r.cards)) {
    ok(c.img === false, 'no tag is injected into the ' + name + ' card', { name, ...c });
    ok(c.raw === false, 'and no handler attribute survives into its HTML', { name, ...c });
    ok(c.iconText.length > 0 && c.iconText.length < 14,
       'the ' + name + ' card still shows an icon rather than nothing', { name, ...c });
  }
  ok(r.pwned === 0, 'and nothing ran', r.pwned);
}

section('The peek panel and the approvals card are the same');
{
  const r = await page.evaluate(async (NASTY) => {
    const d = document.createElement('div');
    document.body.appendChild(d);
    /* _safeIcon is what all four sites now call, so it is asserted directly as
       well - the contract, not just one caller of it. */
    d.innerHTML = '<span class="x">' + _safeIcon(NASTY) + '</span>';
    const out = { img: !!d.querySelector('img'), raw: /onerror/i.test(d.innerHTML) };
    d.remove();
    return out;
  }, NASTY);
  ok(r.img === false, 'markup handed to _safeIcon does not become a tag', r);
  ok(r.raw === false, 'and its handler does not survive', r);
}

section('An ordinary icon is untouched');
{
  const r = await page.evaluate(() => ({
    emoji: _safeIcon('📋'),
    label: _safeIcon('OK'),
    empty: _safeIcon(''),
    nul: _safeIcon(null),
  }));
  ok(r.emoji === '📋', 'an emoji comes back as itself', r);
  ok(r.label === 'OK', 'so does a short text label', r);
  ok(r.empty.length > 0 && r.nul.length > 0,
     'and a missing one still renders something', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
