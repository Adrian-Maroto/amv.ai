/* IS IT ANY GOOD?

   Cost, latency, margin, abuse and growth are all instrumented. Answer QUALITY
   was not measured anywhere - so a routing change, a prompt edit or a model
   swap could make AMV materially worse and every dashboard would stay green.

   What matters as much as the number is what is NOT kept: no message text, no
   prompt, no answer, not a snippet. Storing conversations in order to measure
   quality trades the thing being measured for the measurement. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'quality.harness.mjs');
writeFileSync(harness, src + '\nexport { feedbackRecord, _qualityReport, signToken, counter, monthKey, ENGINES };\n');
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map();
  return { _kv: kv, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }) } };
}
const tokenFor = (env, email) => W.signToken({ email }, env.JWT_SECRET, 3600, env, 'access');
const rate = (env, token, body) => W.feedbackRecord(new Request('https://w/v1/feedback',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }), env);

section('A rating is counted, per engine');
{
  const env = makeEnv();
  const t = await tokenFor(env, 'a@x.com');
  for (let i = 0; i < 9; i++) await rate(env, t, { rating: 'up', engine: 'amv-core' });
  for (let i = 0; i < 3; i++) await rate(env, t, { rating: 'down', engine: 'amv-core', reason: 'wrong' });
  const q = await W._qualityReport(env);
  const core = q.engines.find(e => e.engine === 'amv-core');
  ok(core.up === 9 && core.down === 3, 'both directions are counted', core);
  ok(core.approvalPct === 75, 'and turned into an approval rate', core.approvalPct);
  ok(q.reasons[0].reason === 'wrong' && q.reasons[0].count === 3, 'with the reason people gave', q.reasons);
}

section('A rate with almost nothing behind it is not reported as a rate');
{
  const env = makeEnv();
  const t = await tokenFor(env, 'a@x.com');
  await rate(env, t, { rating: 'down', engine: 'amv-core' });
  const q = await W._qualityReport(env);
  const core = q.engines.find(e => e.engine === 'amv-core');
  ok(core.votes === 1, 'the vote is counted', core.votes);
  ok(core.approvalPct === null, 'but 0% off one rating is noise, not a signal', core.approvalPct);
  ok(q.minVotes >= 5, 'and the threshold is stated', q.minVotes);
}

section('It stores the signal and NOTHING else');
{
  const env = makeEnv();
  const t = await tokenFor(env, 'a@x.com');
  await rate(env, t, {
    rating: 'down', engine: 'amv-core', reason: 'wrong',
    // Everything a careless client might send along.
    prompt: 'MY PRIVATE QUESTION', answer: 'THE PRIVATE ANSWER',
    text: 'PRIVATE', messages: [{ r: 'u', c: 'PRIVATE' }],
  });
  const dump = [...env._kv.entries()].map(([k, v]) => k + '=' + v).join('\n');
  ok(!/PRIVATE/.test(dump), 'no message content is stored anywhere', dump.slice(0, 120));
  ok(/qual:amv-core:down/.test(dump), 'only that a rating happened, and on which engine');
  ok(!/a@x\.com.*PRIVATE/.test(dump), 'and nothing ties an account to what it asked');
}

section('A made-up engine or reason cannot create junk counters');
{
  const env = makeEnv();
  const t = await tokenFor(env, 'a@x.com');
  await rate(env, t, { rating: 'up', engine: '../../etc/passwd', reason: 'made-up-reason' });
  const keys = [...env._kv.keys()].join(' ');
  ok(!/etc\/passwd/.test(keys), 'an invented engine does not become a key', keys.slice(0, 120));
  ok(/qual:unknown:up/.test(keys), 'it lands under unknown instead');
  ok(!/qualwhy:made/.test(keys), 'and an invented reason is dropped rather than recorded');
}

section('It has to be a real rating, from a real account');
{
  const env = makeEnv();
  const t = await tokenFor(env, 'a@x.com');
  ok((await rate(env, t, { rating: 'maybe' })).status === 400, 'a rating that is neither up nor down is refused');
  const anon = await W.feedbackRecord(new Request('https://w/v1/feedback', { method: 'POST', body: '{}' }), env);
  ok(anon.status === 401, 'and an unauthenticated caller cannot stuff the numbers', anon.status);
}

report('quality');
done();
