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
    AMV_MODEL_KEY: 'amv-real', EMAIL_API_KEY: 'em', STRIPE_SECRET_KEY: 'sk_live',
  }));
  ok(find(on, 'ai').on === true, 'and with a key it is reported on');
  ok(find(on, 'email').on === true, 'along with email');
  ok(find(on, 'payments').on === true, 'and payments');
}

section('It NEVER returns a secret, in any form');
{
  const env = Object.assign(bare(), {
    AMV_MODEL_KEY: 'amv-SUPERSECRET1234', JWT_SECRET: 'jwt-SUPERSECRET',
    EMAIL_API_KEY: 'em-SUPERSECRET', STRIPE_SECRET_KEY: 'sk_live_SUPERSECRET',
    STRIPE_WEBHOOK_SECRET: 'whsec_SUPERSECRET',
    /* BOTH halves of Turnstile, because one of them is not a configured
       captcha. The secret verifies a token; TURNSTILE_SITE_KEY is what renders
       the widget that produces one. This env used to set the secret alone and
       call the deployment fully configured - encoding the exact half-state
       that took every sign-up and sign-in on the site down. */
    TURNSTILE_SECRET: 'ts-SUPERSECRET', TURNSTILE_SITE_KEY: '0x4AAAsite-SUPERSECRET',
    GOOGLE_CLIENT_ID: 'gid-SUPERSECRET', IMAGE_API_KEY: 'img-SUPERSECRET',
    IMAGE_API_URL: 'https://img.example', ALERT_WEBHOOK: 'https://hooks.example/SUPERSECRET',
    OWNER_EMAIL: 'owner@example.com', APP_URL: 'https://amv.example',
    VIDEO_API_URL: 'https://v.example', VIDEO_API_KEY: 'vid-SUPERSECRET', VIDEO_MODEL: 'm',
    // Per-seat Teams billing and the model failover endpoint are optional
    // capabilities too, so "everything configured" has to include them.
    STRIPE_PRICE_TEAM_SEAT: 'price_SUPERSECRET', MODEL_API_FALLBACK_URL: 'https://backup.example',
    /* Connected accounts, all three parts, for the same reason as the two
       above: they are optional capabilities and "everything is configured" has
       to include them or the sentence is not true.

       CONNECT_KEY is the one that matters most here. Without it AMV refuses to
       hold an account token at all rather than storing one unencrypted, so a
       deployment missing it is not a deployment with a feature switched off -
       it is one where the safe refusal is doing the work. The registry says so
       and this env sets it, so the green case is a real one. */
    CONNECT_KEY: 'ck-SUPERSECRET',
    GOOGLE_CLIENT_SECRET: 'gsec-SUPERSECRET',
    MS_CLIENT_ID: 'msid-SUPERSECRET', MS_CLIENT_SECRET: 'mssec-SUPERSECRET',
    /* A verified sender is part of being configured, not an extra. With only a
       Resend key the default address delivers to the account owner and nobody
       else, so "everything is configured" while every other person's password
       reset goes nowhere would be exactly the false green this file exists to
       prevent. */
    RESET_EMAIL_FROM: 'AMV <hello@amv.test>',
    // Bindings too, or "everything configured" would not be true - which is
    // the point of the assertion below.
    DB: { prepare(){} }, AMV_COUNTER: {},
  });
  const body = await (await W.adminReadiness(req(env), env)).text();
  ok(!body.includes('SUPERSECRET'), 'no secret value appears anywhere in the response');
  ok(!/sk-ant-|sk_live_|whsec_/.test(body), 'not even a recognisable prefix', body.slice(0, 80));
  ok(!/"len"|length/.test(body), 'and no length, which would narrow a guess');
  ok(body.includes('AMV_MODEL_KEY'), 'the NAME is there, because that is the thing to set');

  const d = JSON.parse(body);
  ok(d.summary.blockingMissing === 0, 'a fully configured deployment has nothing blocking', d.summary);
  ok(/Everything is configured/.test(d.summary.verdict), 'and says so in one sentence', d.summary.verdict);
}

section('An empty secret is not a configured secret');
{
  /* A deploy that sets a variable to "" half-works silently. Treating that as
     configured is how the failure hides. */
  const d = await get(Object.assign(bare(), { AMV_MODEL_KEY: '', EMAIL_API_KEY: '   ' }));
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

  const core = await get(Object.assign(bare(), { AMV_MODEL_KEY: 'k', JWT_SECRET: 'j' }));
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

section('Taking money without the atomic counter is NOT ready');
{
  /* The Durable Object was optional, and on a machine with no customers it
     should be - refusing to run without it would mean AMV does not work without
     a paid Cloudflare plan, and the KV fallback is a documented degradation.

     On a deployment taking payments it is a different thing entirely. Every
     `reserve` becomes a read followed by a write, which is the exact race the
     reservation exists to close: requests arriving together all read the same
     total, all decide they fit, and all proceed. The day's spend ceiling, every
     plan's token allowance and every exactly-once claim are built on it, so
     without it the one control standing between AMV and an unbounded bill is
     bounded only by how many requests arrive at once.

     Same shape as the payment webhook: blocking once, and only once, the thing
     it protects is real money. */
  const noPay = await get(Object.assign(bare(), { AMV_MODEL_KEY: 'k', JWT_SECRET: 'j' }));
  ok(find(noPay, 'counter').blocking === false,
     'a deployment selling nothing is not blocked on it', find(noPay, 'counter').blocking);
  ok(/^Core product is live/.test(noPay.summary.verdict),
     'and can still report the core as live', noPay.summary.verdict);

  const paying = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }));
  ok(find(paying, 'counter').blocking === true,
     'a deployment taking payments IS blocked on it', find(paying, 'counter').blocking);
  ok(/^Not ready/.test(paying.summary.verdict),
     'so the verdict refuses to say ready', paying.summary.verdict);
  ok(/Atomic counter/.test(paying.summary.verdict),
     'and names it, rather than leaving somebody to guess', paying.summary.verdict);
  ok(/REQUIRED NOW/.test(find(paying, 'counter').turnsOn),
     'with a line that says this is required NOW, not one day', find(paying, 'counter').turnsOn);
  ok(/read-then-write|read followed by a write/.test(find(paying, 'counter').turnsOn),
     'and says what the fallback actually does, not just that it is worse', find(paying, 'counter').turnsOn);

  /* And bound, it stops blocking - a gate that stays red once tripped is one
     people learn to ignore. */
  const bound = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x',
    AMV_COUNTER: {} }));
  ok(find(bound, 'counter').on === true && bound.summary.blockingMissing === 0,
     'and binding it clears the block', bound.summary.blockingMissing);
}

section('A rotation in progress is a state the screen reports');
{
  /* CONNECT_KEY_PREV set is not a missing capability, it is a rotation that has
     started and not finished. It reports "on" when ABSENT, because absent is
     the settled state - the inverse of every other line here, which is exactly
     why it needs asserting rather than assuming. */
  const settled = await get(Object.assign(bare(), { AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', CONNECT_KEY: 'ck' }));
  ok(find(settled, 'connectKeyPrev').on === true,
     'no rotation in progress reads as nothing to do', find(settled, 'connectKeyPrev').on);

  const mid = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', CONNECT_KEY: 'ck', CONNECT_KEY_PREV: 'old' }));
  ok(find(mid, 'connectKeyPrev').on === false,
     'a rotation in progress is reported as unfinished', find(mid, 'connectKeyPrev').on);
  ok(/ROTATION IS IN PROGRESS/.test(find(mid, 'connectKeyPrev').turnsOn),
     'saying so in words', find(mid, 'connectKeyPrev').turnsOn);
  ok(find(mid, 'connectKeyPrev').blocking === false,
     'and it does not block a launch, because a rotation is normal work', find(mid, 'connectKeyPrev').blocking);
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

section('A Resend key alone does not mean mail reaches anybody');
{
  /* The failure this exists for: the key is set, "Email delivery" goes green,
     and the default sender is onboarding@resend.dev - which Resend delivers
     ONLY to the address that owns the Resend account. Password resets reach the
     operator and nobody else, every other person who forgets their password is
     locked out permanently, and the screen whose whole job is to say what works
     reported email as on. */
  const env = Object.assign(bare(), { EMAIL_API_KEY: 're_key_only' });
  const d = await get(env);
  const sender = find(d, 'emailSender');
  ok(!!sender, 'deliverability is reported as its own thing', (d.items || []).map(i => i.id).join(','));
  ok(sender.on === false, 'and it is NOT on with only a key', sender.on);
  ok(/only delivers to|nobody else|verified/i.test(sender.turnsOn || ''),
     'saying plainly that mail reaches the owner and no one else', sender.turnsOn);
  ok(/RESET_EMAIL_FROM/.test(JSON.stringify(sender)), 'and naming what to set', sender.how);

  const emailItem = find(d, 'email');
  ok(emailItem && emailItem.on === true,
     'while the key itself is still correctly reported as present', emailItem && emailItem.on);
}

section('With a verified sender, it goes green');
{
  const env = Object.assign(bare(), { EMAIL_API_KEY: 're_key', RESET_EMAIL_FROM: 'AMV <hello@amv.test>' });
  const sender = find(await get(env), 'emailSender');
  ok(sender && sender.on === true, 'a verified sender satisfies it', sender && sender.on);
}

report('readiness');
done();
