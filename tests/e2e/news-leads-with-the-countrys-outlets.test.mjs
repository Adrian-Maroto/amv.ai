/* NEWS LEADS WITH THE COUNTRY'S OUTLETS (owner, Nov 23: "News should have all
   the popular news sources - for the US AP, Reuters, the Wall Street Journal,
   the New York Times, CNN, Fox News - in every country").

   News & reading opens on the outlets people in the country visit, ahead of
   the reading apps; inside a visit band an outlet on the country's own web
   domain comes first, so Germany opens on German papers rather than the BBC.
   Streaming and sport channels are not counted as news. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

const first = (cc) => page.evaluate(async (cc) => {
  _cwSetCountry(cc); setTab('integrations');
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    const sec = document.querySelector('#int-catalog [data-topic="news"]');
    if (sec && sec.querySelector('.cc-svc')) break;
  }
  const sec = document.querySelector('#int-catalog [data-topic="news"]');
  if (!sec) return null;
  return [...sec.querySelectorAll('.int-card')].filter(c => getComputedStyle(c).display !== 'none')
    .map(c => ({ n: (c.querySelector('.int-name') || c).textContent.trim(), svc: c.classList.contains('cc-svc'),
                 s: (c.querySelector('.int-desc') || {}).textContent || '' }));
}, cc);

section('The United States');
{
  const r = await first('US');
  ok(Array.isArray(r) && r.length === 9, 'nine on the first screen', r && r.length);
  const names = (r || []).map(x => x.n);
  ok((r || []).every(x => x.svc), 'all of them outlets, none a reading app', names);
  for (const want of ['The New York Times', 'CNN', 'Fox News', 'The Wall Street Journal', 'The Washington Post'])
    ok(names.includes(want), want + ' is on the first screen', names);
  ok(!names.some(n => /Prime Video|Crunchyroll|ESPN|Weather Channel/.test(n)), 'no streaming or sport channel among them', names);
  ok(new Set(names).size === names.length, 'and none twice', names);
}

section('Germany opens on German outlets');
{
  const r = await first('DE');
  const de = (r || []).filter(x => /\.de$/.test(x.s.trim())).length;
  ok(de >= 6, 'most of the first screen is on .de', (r || []).map(x => x.n + ' ' + x.s));
  ok(!(r || []).slice(0, 3).some(x => /British Broadcasting|New York Times/.test(x.n)), 'not the BBC or the New York Times first', (r || []).map(x => x.n));
}

section('The reading apps are still there, behind See the remaining');
{
  const r = await page.evaluate(() => {
    const sec = document.querySelector('#int-catalog [data-topic="news"]');
    const b = sec && sec.querySelector('.int-seemore');
    return { btn: !!b, hidden: sec ? sec.querySelectorAll('.int-card.cc-pushed').length : 0 };
  });
  ok(r.btn && r.hidden > 0, 'the apps move behind the button, not off the page', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
