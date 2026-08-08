/* THE PRODUCT COULD BREAK FOR EVERYONE AND NOBODY WOULD BE TOLD.

   Browser errors were collected into a well-built index - grouped by
   fingerprint, deduplicated, bounded, with distinct-user counts kept without
   storing who anybody is - and nothing anywhere ever said a word about them.
   A release that breaks checkout for every visitor filled this quietly, and the
   first anybody would hear is a customer email.

   Frequently not even that. The people a broken sign-up or a broken checkout
   fails are the ones who cannot get far enough into the product to have an
   account, a support route, or any reason to persist. The worst outages are
   the quietest ones.

   The signal has to be DISTINCT PEOPLE in a short window, not raw count. One
   person in a retry loop produces a thousand events and is not an outage; five
   different people hitting the same fingerprint within fifteen minutes almost
   always is. Counting occurrences would page on the loop and stay silent on
   the outage, which is precisely backwards - so that is the first case here. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'errburst.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, errorsReport, errorsList, ERR_BURST_PEOPLE };\n');
const W = await import(harness + '?t=' + Date.now());

let paged = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  paged.push(String((opts && opts.body) || ''));
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv() {
  const m = new Map();
  const vals = new Map();
  paged = [];
  return {
    ALERT_WEBHOOK: 'https://hooks.example/pager',
    ADMIN_TOKEN: 'admin-secret',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const cur = (vals.get(n) || 0) + 1;
        vals.set(n, cur);
        if (b.op === 'rateCheck') return new Response(JSON.stringify({ allowed: cur <= (b.limit || 999) }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };
const THE_BUG = { kind: 'error', msg: 'Cannot read properties of null (reading \'submit\')',
                  where: 'openPaymentSheet', stack: 'at openPaymentSheet (app.js:1)', ver: '2.4.1' };

/* One report, from a named person, at a named address. */
const report1 = (env, who, ip, over) =>
  W.errorsReport(new Request('https://api.amv.dev/errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || '1.1.1.1' },
    body: JSON.stringify({ events: [Object.assign({}, THE_BUG, over || {}, who ? { uid: who } : {})] }),
  }), env, ctx);

section('One person in a retry loop is not an outage');
{
  /* The case that decides the whole design. Twenty events, one person. If this
     pages, the pager is worthless within a day and somebody mutes it - which
     is the same as not having one. */
  const env = mkEnv();
  for (let i = 0; i < 20; i++) await report1(env, 'same-person', '1.1.1.1');
  ok(paged.length === 0, 'nobody is woken up for one unlucky person', paged.length);

  const idx = await W.DB.get(env, 'errors', 'index');
  const g = Object.values(idx.groups)[0];
  ok(g.count === 20, 'while the bug is still recorded, twenty times', g.count);
}

section('Five different people hitting the same thing is');
{
  const env = mkEnv();
  for (let i = 0; i < W.ERR_BURST_PEOPLE; i++) await report1(env, 'person-' + i, '2.2.2.' + i);
  ok(paged.length > 0, 'somebody is paged', paged.length);
  const said = paged.join(' ');
  ok(/different people/.test(said), 'and told how many people it is', said.slice(0, 140));
  ok(/openPaymentSheet/.test(said),
     'and where it is happening, which is the part that says how bad it is', true);
  ok(/2\.4\.1/.test(said), 'and which build, so a bad deploy is obvious', true);
}

section('Signed-out visitors count, because they are who a broken page fails');
{
  /* Nobody in this case has an account. That is the whole point: the people a
     broken landing page or a broken sign-up fails cannot be signed in, and
     counting only known users would make the worst outage invisible. */
  const env = mkEnv();
  for (let i = 0; i < W.ERR_BURST_PEOPLE; i++) await report1(env, null, '3.3.3.' + i);
  ok(paged.length > 0, 'a burst from anonymous visitors still pages', paged.length);
}

section('And the same anonymous visitor retrying does not');
{
  /* The mirror of it: falling back to the address must not turn one person
     into a crowd. */
  const env = mkEnv();
  for (let i = 0; i < 20; i++) await report1(env, null, '4.4.4.4');
  ok(paged.length === 0, 'one address is one person', paged.length);
}

section('It pages once, not once per event');
{
  /* A real outage produces thousands of these a minute. */
  const env = mkEnv();
  for (let i = 0; i < 40; i++) await report1(env, 'p' + i, '5.5.5.' + (i % 250));
  ok(paged.length === 1, 'exactly one page for one bug', paged.length);
}

section('A different bug is a different page');
{
  /* Collapsing everything into one alert would hide the second failure behind
     the first, which during a bad deploy is when there are most of them. */
  const env = mkEnv();
  for (let i = 0; i < W.ERR_BURST_PEOPLE; i++) await report1(env, 'a' + i, '6.6.6.' + i);
  for (let i = 0; i < W.ERR_BURST_PEOPLE; i++) {
    await report1(env, 'b' + i, '6.6.7.' + i, { msg: 'Failed to fetch', where: 'syncEntitlement' });
  }
  ok(paged.length === 2, 'two bugs, two pages', paged.length);
  ok(paged.some(p => /openPaymentSheet/.test(p)) && paged.some(p => /syncEntitlement/.test(p)),
     'each naming its own', paged.length);
}

section('Nobody’s identity is stored to do it');
{
  /* This is a public, unauthenticated sink. Whatever it keeps in order to
     count people has to be something that cannot name one. */
  const env = mkEnv();
  await report1(env, 'alice@example.com', '7.7.7.7');
  const stored = JSON.stringify([...env.AMV_KV._map.values()]);
  ok(!/alice@example\.com/.test(stored), 'the identifier is not kept', stored.slice(0, 160));
  ok(!/7\.7\.7\.7/.test(stored), 'nor the address', true);

  const idx = await W.DB.get(env, 'errors', 'index');
  const g = Object.values(idx.groups)[0];
  ok(Array.isArray(g.burst) && g.burst.length === 1, 'only a count of hashes', g.burst.length);
  ok(/^[0-9a-f]{8,32}$/.test(g.burst[0].w), 'each a one-way hash', g.burst[0].w);
}

section('The burst window is bounded, in time and in size');
{
  /* This index is read and rewritten on every single error report, so anything
     that grows without limit here is a cost on the hot path of a system that
     is by definition already having a bad day. */
  const env = mkEnv();
  for (let i = 0; i < 120; i++) await report1(env, 'q' + i, '8.8.8.' + (i % 250));
  const idx = await W.DB.get(env, 'errors', 'index');
  const g = Object.values(idx.groups)[0];
  ok(g.burst.length <= 40, 'the recent-people list stays small', g.burst.length);

  /* And entries age out, or a slow trickle over a week eventually looks like a
     burst and pages for something that is not happening. */
  ok(/ERR_BURST_MS/.test(src) && /now0 - b\.t < ERR_BURST_MS/.test(src),
     'and older ones are dropped by time, not just by length', true);
}

section('With no pager configured it is silent, not broken');
{
  const env = mkEnv();
  delete env.ALERT_WEBHOOK;
  for (let i = 0; i < W.ERR_BURST_PEOPLE + 2; i++) {
    const r = await report1(env, 'r' + i, '9.9.9.' + i);
    if (r.status !== 200) { ok(false, 'reporting still works', r.status); break; }
  }
  ok(paged.length === 0, 'nothing is sent when there is nowhere to send it', paged.length);
  const idx = await W.DB.get(env, 'errors', 'index');
  ok(Object.keys(idx.groups).length === 1,
     'and the errors are still collected for the dashboard', Object.keys(idx.groups).length);
}

globalThis.fetch = realFetch;
if (report('an-outage-pages-somebody') > 0) process.exitCode = 1;
done();
