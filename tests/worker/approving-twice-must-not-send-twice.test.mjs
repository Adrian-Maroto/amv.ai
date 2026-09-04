/* APPROVING IS WHAT SENDS IT, AND THERE WAS NOTHING TO STOP IT HAPPENING TWICE.

   `crewApprovalAct` reads the queued item, sends the email, and THEN removes it
   from the queue under a lock. The removal is serialized; the send is not. So
   two requests carrying the same approval id - a double press, a retry after a
   slow response, two tabs - both find the item, both send, and both then remove
   it and report success.

   The result leaves AMV: somebody's draft goes to their client twice, from a
   flow whose entire purpose is that the person decides once. Every other
   irreversible path in this file takes `_claimOnce` first; this one did not.

   Proved by running it, with a fake that counts sends. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'approveonce.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, crewApprovalAct, signToken };\n');
const W = await import(harness + '?t=' + Date.now());

const USER = 'ada@example.com';

/* The provider, counted. A slow send is the point: it widens the window the
   two requests overlap in, which is exactly what a real network does. */
let sends = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (/api\.resend\.com|email/.test(String(url))) {
    sends++;
    await new Promise(r => setTimeout(r, 60));
    return new Response(JSON.stringify({ id: 'em_' + sends }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch ? new Response('{}', { status: 200 }) : new Response('{}', { status: 200 });
};

function makeEnv() {
  const kv = new Map(); const vals = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'amv@amv.test', APP_URL: 'https://amv.test',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }),
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        /* A claim that is never released is not a claim, it is a deadlock -
           the first fake here held every lock for ever, so the second request
           could not even reach the queue and the file died on "approvals is
           busy" instead of measuring the sends. */
        if (b.op === 'claim') {
          const had = vals.has('claim:' + n);
          if (!had) vals.set('claim:' + n, 1);
          return new Response(JSON.stringify({ claimed: !had }));
        }
        if (b.op === 'release') { vals.delete('claim:' + n); return new Response(JSON.stringify({ released: true })); }
        const cur = vals.get(n) || 0;
        if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: cur + b.amount })); }
        if (b.op === 'incr') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const act = (env, token, id, action) => W.crewApprovalAct(new Request('https://w/api/approvals/act',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ id, action }) }), env);

async function seed(env) {
  await W.DB.put(env, 'approvals', USER, { items: [
    { id: 'ap_1', title: 'Weekly note to the team', actionType: 'send',
      preview: 'Here is this week.', result: { body: 'Here is this week.' } } ] });
}

section('One approval sends once');
{
  const env = makeEnv(); sends = 0;
  await seed(env);
  const tok = await tokenFor(env, USER);
  const d = await (await act(env, tok, 'ap_1', 'approve')).json();
  ok(d.ok === true && d.delivered === true, 'it is delivered', d);
  ok(sends === 1, 'exactly one email left AMV', sends);
}

section('Two approvals of the same item send once, not twice');
/* The whole finding. Both requests are in flight together, which is a double
   press or a retry, not an exotic race. */
{
  const env = makeEnv(); sends = 0;
  await seed(env);
  const tok = await tokenFor(env, USER);
  const [a, b] = await Promise.all([act(env, tok, 'ap_1', 'approve'), act(env, tok, 'ap_1', 'approve')]);
  const [da, db] = [await a.json(), await b.json()];
  ok(sends === 1, 'the person’s draft goes out ONCE', sends);
  const okd = [da, db].filter(x => x && x.ok);
  ok(okd.length >= 1, 'and at least one caller is told it worked', [da, db]);
  const delivered = [da, db].filter(x => x && x.delivered === true).length;
  ok(delivered === 1, 'exactly one of them claims the delivery', { da, db });
}

section('And the item is gone afterwards either way');
{
  const env = makeEnv(); sends = 0;
  await seed(env);
  const tok = await tokenFor(env, USER);
  await Promise.all([act(env, tok, 'ap_1', 'approve'), act(env, tok, 'ap_1', 'approve')]);
  const rec = (await W.DB.get(env, 'approvals', USER)) || { items: [] };
  ok((rec.items || []).length === 0, 'the queue is empty, so nothing is re-offered', rec.items);
}

section('A second approval of a DIFFERENT item still sends');
/* The guard must be per item, or approving two things in quick succession
   would silently drop the second - a fix that breaks the feature. */
{
  const env = makeEnv(); sends = 0;
  await W.DB.put(env, 'approvals', USER, { items: [
    { id: 'ap_1', title: 'One', actionType: 'send', result: { body: 'a' } },
    { id: 'ap_2', title: 'Two', actionType: 'send', result: { body: 'b' } } ] });
  const tok = await tokenFor(env, USER);
  await Promise.all([act(env, tok, 'ap_1', 'approve'), act(env, tok, 'ap_2', 'approve')]);
  ok(sends === 2, 'two different approvals send two emails', sends);
}

section('Rejecting twice is harmless and sends nothing');
{
  const env = makeEnv(); sends = 0;
  await seed(env);
  const tok = await tokenFor(env, USER);
  await Promise.all([act(env, tok, 'ap_1', 'reject'), act(env, tok, 'ap_1', 'reject')]);
  ok(sends === 0, 'nothing left AMV', sends);
}

report();
done();
