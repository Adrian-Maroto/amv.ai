/* NOTIFY ME IS COUNTED, IN PEOPLE, AND THE COUNT SAYS WHEN IT IS A SAMPLE.

   The Integrations page tells somebody pressing Notify me that the most-asked-
   for apps are connected next. That is only true if the owner can see which
   ones those are: this is the tally the dashboard shows. A request is one
   waitlist entry per person per app, so pressing twice is one person - and a
   tally that cannot read everything says so instead of passing a partial count
   off as the whole. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'notifycount.harness.mjs');
writeFileSync(harness, src + `
export { waitlistAdd, _appRequestCounts };
`);
const W = await import(harness + '?t=' + Date.now());

const mkEnv = (pageSize = 1000) => {
  const store = new Map();
  return { store, JWT_SECRET: 'x'.repeat(40),
    AMV_KV: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, String(v)); },
      async delete(k) { store.delete(k); },
      async list({ prefix, cursor, limit }) {
        const all = [...store.keys()].filter(k => k.startsWith(prefix || '')).sort();
        const from = cursor ? Number(cursor) : 0, n = Math.min(limit || 1000, pageSize);
        const keys = all.slice(from, from + n).map(name => ({ name }));
        const next = from + n;
        return next < all.length ? { keys, list_complete: false, cursor: String(next) } : { keys, list_complete: true };
      },
    } };
};
let ip = 1;
const notify = (env, app, email) => W.waitlistAdd(new Request('https://api.amv.test/waitlist', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.' + (ip++ % 250) },
  body: JSON.stringify({ product: 'app-' + app, email }),
}), env);

section('People, not presses, most asked-for first');
{
  const env = mkEnv();
  for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await notify(env, 'canva', e);
  await notify(env, 'canva', 'a@x.com');                 // the same person again
  for (const e of ['a@x.com', 'd@x.com']) await notify(env, 'spotify', e);
  await notify(env, 'capcut', 'e@x.com');
  env.store.set('waitlist:ios:z@x.com', '{}');              // not an app request
  const r = await W._appRequestCounts(env);
  ok(r.complete === true, 'everything was read', r);
  ok(JSON.stringify(r.top) === JSON.stringify([{ app: 'canva', people: 3 }, { app: 'spotify', people: 2 }, { app: 'capcut', people: 1 }]),
     'canva 3, spotify 2, capcut 1 - a second press by the same person is not a second person', r.top);
}

section('Past the read ceiling it says it is a sample');
{
  const env = mkEnv(3);                                     // three keys a page, so ten pages is thirty keys
  for (let i = 0; i < 40; i++) env.store.set('waitlist:app-canva:p' + i + '@x.com', '{}');
  const r = await W._appRequestCounts(env);
  ok(r.complete === false, 'the tally says it is not the whole list', r.complete);
  ok(r.top[0] && r.top[0].people === 30, 'and counts what it did read', r.top);
}

section('A store that cannot be read is an error, not "nobody asked"');
{
  const env = mkEnv();
  env.AMV_KV.list = async () => { throw new Error('down'); };
  const r = await W._appRequestCounts(env);
  ok(r.top.length === 0 && r.complete === false && /could not read/.test(r.error || ''), 'it says it could not read the waitlist', r);
}

if (report('notify-me-is-counted') > 0) process.exitCode = 1;
done();
