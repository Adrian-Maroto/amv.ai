/* CREW KNOWS THE COUNTRY FROM THE NETWORK, NOT FROM THE BROWSER.

   Crew guessed the country from the browser's language, so somebody in Madrid
   with an English (US) browser was shown the United States. /v1/where answers
   from the edge's own record of where the request came from. Country level
   only, nothing stored, nothing read - and never cached, because the answer
   belongs to one visitor and a cache would hand it to the next. */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { makeEnv } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?where=' + Date.now())).default;
const env = makeEnv({});
const ask = async (cf) => {
  const req = new Request('https://api.test/v1/where', { method: 'GET' });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  const r = await worker.fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
  return { status: r.status, cache: r.headers.get('cache-control') || '', body: await r.json().catch(() => ({})) };
};

section('It answers with the country the request came from');
{
  const es = await ask({ country: 'ES' });
  ok(es.status === 200 && es.body.country === 'ES' && es.body.name === 'Spain', 'from Spain it says Spain', es.body);
  const jp = await ask({ country: 'jp' });
  ok(jp.body.country === 'JP' && jp.body.name === 'Japan', 'and from Japan, Japan', jp.body);
  ok(!/public|max-age=[1-9]/.test(es.cache) && /no-store|private/.test(es.cache), 'and is never cached - it belongs to one visitor', es.cache);
  ok(Object.keys(es.body).sort().join(',') === 'country,name,ok', 'and says nothing but the country', Object.keys(es.body));
}

section('An unknown country is no country, not a guess');
{
  for (const cf of [{ country: 'XX' }, { country: 'T1' }, { country: '' }, null]) {
    const r = await ask(cf);
    ok(r.status === 200 && r.body.country === '' && r.body.name === '', 'from ' + JSON.stringify(cf) + ' it says it does not know', r.body);
  }
}

section('It needs no account');
{
  const r = await ask({ country: 'BR' });
  ok(r.status === 200 && r.body.country === 'BR', 'a visitor who has not signed up is answered', r.status);
}

report();
done();
