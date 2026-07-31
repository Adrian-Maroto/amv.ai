/* GO-LIVE READINESS - what is actually switched on.

   The screen that answers "is this real yet" was a list of guesses made in the
   browser. Three rows were hardcoded to "not set up" whatever the truth was,
   and the row for the AI engine reported whether THAT BROWSER had a session -
   which says nothing about whether the Worker holds an API key.

   The report replacing it has one hard rule: it says whether a secret exists
   and never anything about its value. A screen that leaks the shape of a key
   is worse than one that guesses. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'readiness.harness.mjs');
writeFileSync(harness, src + '\nexport { adminReadiness, _readinessReport, _has };\n');
const W = await import(harness + '?t=' + Date.now());

const bare = () => ({ ADMIN_TOKEN: 'admin-secret', AMV_KV: {} });
const req = (env) => new Request('https://w/admin/readiness',
  { headers: { Authorization: 'Bearer ' + (env.ADMIN_TOKEN || '') } });
const get = async (env) => (await (await W.adminReadiness(req(env), env)).json());
const find = (d, id) => (d.items || []).concat(d.storage || []).find(i => i.id === id);

section('It reports what the server knows, not what the browser guessed');
{
  const off = await get(bare());
  ok(find(off, 'ai').on === false, 'with no API key the AI engine is reported off');
  ok(find(off, 'email').on === false, 'so is email delivery');
  ok(find(off, 'payments').on === false, 'and payments');

  const on = await get(Object.assign(bare(), {
    ANTHROPIC_API_KEY: 'sk-ant-real', EMAIL_API_KEY: 'em', STRIPE_SECRET_KEY: 'sk_live',
  }));
  ok(find(on, 'ai').on === true, 'and with a key it is reported on');
  ok(find(on, 'email').on === true, 'along with email');
  ok(find(on, 'payments').on === true, 'and payments');
}

section('It NEVER returns a secret, in any form');
{
  const env = Object.assign(bare(), {
    ANTHROPIC_API_KEY: 'sk-ant-SUPERSECRET1234', JWT_SECRET: 'jwt-SUPERSECRET',
    EMAIL_API_KEY: 'em-SUPERSECRET', STRIPE_SECRET_KEY: 'sk_live_SUPERSECRET',
    STRIPE_WEBHOOK_SECRET: 'whsec_SUPERSECRET', TURNSTILE_SECRET: 'ts-SUPERSECRET',
    GOOGLE_CLIENT_ID: 'gid-SUPERSECRET', IMAGE_API_KEY: 'img-SUPERSECRET',
    IMAGE_API_URL: 'https://img.example', ALERT_WEBHOOK: 'https://hooks.example/SUPERSECRET',
    OWNER_EMAIL: 'owner@example.com', APP_URL: 'https://amv.example',
    VIDEO_API_URL: 'https://v.example', VIDEO_API_KEY: 'vid-SUPERSECRET', VIDEO_MODEL: 'm',
    // Bindings too, or "everything configured" would not be true - which is
    // the point of the assertion below.
    DB: { prepare(){} }, AMV_COUNTER: {},
  });
  const body = await (await W.adminReadiness(req(env), env)).text();
  ok(!body.includes('SUPERSECRET'), 'no secret value appears anywhere in the response');
  ok(!/sk-ant-|sk_live_|whsec_/.test(body), 'not even a recognisable prefix', body.slice(0, 80));
  ok(!/"len"|length/.test(body), 'and no length, which would narrow a guess');
  ok(body.includes('ANTHROPIC_API_KEY'), 'the NAME is there, because that is the thing to set');

  const d = JSON.parse(body);
  ok(d.summary.blockingMissing === 0, 'a fully configured deployment has nothing blocking', d.summary);
  ok(/Everything is configured/.test(d.summary.verdict), 'and says so in one sentence', d.summary.verdict);
}

section('An empty secret is not a configured secret');
{
  /* A deploy that sets a variable to "" half-works silently. Treating that as
     configured is how the failure hides. */
  const d = await get(Object.assign(bare(), { ANTHROPIC_API_KEY: '', EMAIL_API_KEY: '   ' }));
  ok(find(d, 'ai').on === false, 'an empty string is off', find(d, 'ai').on);
  ok(find(d, 'email').on === false, 'and so is whitespace');
  ok(W._has({ X: 'v' }, 'X') === true && W._has({ X: '' }, 'X') === false, 'the check itself is the strict one');
}

section('The verdict answers "can I launch" in one line');
{
  const noKey = await get(bare());
  ok(/^Not ready/.test(noKey.summary.verdict), 'missing something essential says NOT ready first', noKey.summary.verdict);
  ok(/AI engine/.test(noKey.summary.verdict), 'and names what is missing', noKey.summary.verdict);
  ok(noKey.summary.blockingMissing >= 2, 'counting each blocker', noKey.summary.blockingMissing);

  const core = await get(Object.assign(bare(), { ANTHROPIC_API_KEY: 'k', JWT_SECRET: 'j' }));
  ok(/Core product is live/.test(core.summary.verdict), 'with the essentials in, it says the core is live', core.summary.verdict);
  ok(core.summary.blockingMissing === 0, 'and nothing is blocking', core.summary.blockingMissing);
}

section('Every entry says what it turns on and how to set it');
{
  const d = await get(bare());
  const all = d.items.concat(d.storage);
  ok(all.length >= 13, 'the whole surface is covered, not a sample', all.length);
  ok(all.every(i => i.turnsOn && i.turnsOn.length > 20), 'each says what it enables, in a sentence');
  ok(all.every(i => i.how && i.how.length > 5), 'and how to set it');
  ok(d.items.every(i => /wrangler secret put/.test(i.how)), 'secrets carry the exact command', d.items[0].how);
  ok(find(d, 'kv').how.includes('wrangler.toml'), 'a binding says where it is bound instead', find(d, 'kv').how);
}

section('Storage bindings are reported, including what their absence costs');
{
  const none = await get(bare());
  ok(find(none, 'd1').on === false, 'no D1 is reported as no D1');
  ok(/two devices/.test(find(none, 'd1').turnsOn), 'and says what that actually costs', find(none, 'd1').turnsOn);
  ok(find(none, 'counter').on === false, 'the atomic counter too');

  const bound = await get(Object.assign(bare(), { DB: { prepare(){} }, AMV_COUNTER: {} }));
  ok(find(bound, 'd1').on === true, 'a real D1 binding is detected', find(bound, 'd1').on);
  ok(find(bound, 'counter').on === true, 'and so is the counter');
}

section('It is operator-only');
{
  const env = bare();
  const anon = await W.adminReadiness(new Request('https://w/admin/readiness'), env);
  ok(anon.status === 403, 'an unauthenticated caller learns nothing about the deployment', anon.status);
  const wrong = await W.adminReadiness(new Request('https://w/admin/readiness',
    { headers: { Authorization: 'Bearer not-the-token' } }), env);
  ok(wrong.status === 403, 'and neither does a wrong token', wrong.status);
}

report('readiness');
done();
