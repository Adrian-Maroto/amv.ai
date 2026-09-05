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
    /* AMV-402: the thirty capabilities this screen could not see.

       Every one of these was already built and reachable in the Worker with no
       row on the readiness screen, so "Everything is configured" was a sentence
       about sixteen things out of forty-six. Setting them here is what makes
       the assertion below mean what it says - and it is why the assertion is
       worth having: it is the one place a new capability with no row shows up
       as a failing test rather than as a screen quietly under-reporting. */
    STRIPE_PRICE_PRO: 'price_pro_SUPERSECRET', STRIPE_PRICE_ELITE: 'price_elite_SUPERSECRET',
    STRIPE_PRICE_ULTRA: 'price_ultra_SUPERSECRET',
    PAYPAL_CLIENT_ID: 'ppid-SUPERSECRET', PAYPAL_SECRET: 'ppsec-SUPERSECRET',
    PAYPAL_WEBHOOK_ID: 'ppwh-SUPERSECRET', PAYPAL_MODE: 'live',
    PAYPAL_PLAN_PRO: 'P-pro-SUPERSECRET', PAYPAL_PLAN_ELITE: 'P-elite-SUPERSECRET',
    PAYPAL_PLAN_ULTRA: 'P-ultra-SUPERSECRET',
    TWILIO_ACCOUNT_SID: 'AC-SUPERSECRET', TWILIO_AUTH_TOKEN: 'tw-SUPERSECRET',
    TWILIO_FROM_NUMBER: '+15550000000',
    SUPPORT_EMAIL: 'help@amv.test', AUDIT_WEBHOOK: 'https://audit.example/SUPERSECRET',
    GH_CLIENT_ID: 'ghid-SUPERSECRET', GH_CLIENT_SECRET: 'ghsec-SUPERSECRET',
    MAIL_CRED_KEY: 'mck-SUPERSECRET',
    FINANCE_CLIENT_ID: 'finid-SUPERSECRET', FINANCE_SECRET: 'finsec-SUPERSECRET',
    SENTRY_DSN: 'https://SUPERSECRET@sentry.example/1',
    POSTHOG_KEY: 'phc_SUPERSECRET',
    ALLOWED_ORIGIN: 'https://amv.test',
    // Bindings too, or "everything configured" would not be true - which is
    // the point of the assertion below.
    DB: { prepare(){} }, AMV_COUNTER: {}, BROWSER: {},
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

section('Payments green with no price is the trap this screen exists to catch');
{
  /* STRIPE_SECRET_KEY alone turns the Payments row green. Checkout then
     refuses every plan by name, because the price id was never set - the right
     refusal at the endpoint, and the wrong thing to learn from a customer.

     Same shape as the Turnstile and Resend rows: the capability is
     half-configured, and the missing half is the one that takes the money. */
  const half = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', STRIPE_SECRET_KEY: 'sk_live_x' }));
  ok(find(half, 'payments').on === true, 'payments reads as on, because the key is there', find(half, 'payments').on);
  ok(find(half, 'stripePrices').on === false, 'and the prices read as missing', find(half, 'stripePrices').on);
  ok(/REQUIRED NOW/.test(find(half, 'stripePrices').turnsOn),
     'saying it is required NOW rather than one day', find(half, 'stripePrices').turnsOn);
  ok(/cannot be bought|refused/i.test(find(half, 'stripePrices').turnsOn),
     'and what actually happens to somebody who tries', find(half, 'stripePrices').turnsOn);

  const whole = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', STRIPE_SECRET_KEY: 'sk_live_x',
    STRIPE_PRICE_PRO: 'p1', STRIPE_PRICE_ELITE: 'p2', STRIPE_PRICE_ULTRA: 'p3' }));
  ok(find(whole, 'stripePrices').on === true, 'all three ids clears it', find(whole, 'stripePrices').on);

  /* TWO OF THREE IS NOT CONFIGURED. A row that goes green on a partial set is
     the same false green as the Turnstile one, one plan further along. */
  const two = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', STRIPE_SECRET_KEY: 'sk_live_x',
    STRIPE_PRICE_PRO: 'p1', STRIPE_PRICE_ELITE: 'p2' }));
  ok(find(two, 'stripePrices').on === false, 'two of the three is still not configured', find(two, 'stripePrices').on);
}

section('A PayPal subscription nothing can cancel is blocking');
{
  /* The PayPal half of the Stripe webhook rule, and blocking for the same
     reason: a subscription that can start and can never be revoked is the one
     configuration that puts a deployment in front of somebody's bank. */
  const noPP = await get(Object.assign(bare(), { AMV_MODEL_KEY: 'k', JWT_SECRET: 'j' }));
  ok(find(noPP, 'paypalHook').blocking === false,
     'a deployment not using PayPal is not blocked on its webhook', find(noPP, 'paypalHook').blocking);

  const pp = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', PAYPAL_CLIENT_ID: 'id', PAYPAL_SECRET: 'sec' }));
  ok(find(pp, 'paypal').on === true, 'PayPal switched on is reported on', find(pp, 'paypal').on);
  ok(find(pp, 'paypalHook').blocking === true,
     'and now its webhook IS blocking', find(pp, 'paypalHook').blocking);
  ok(/^Not ready/.test(pp.summary.verdict), 'so the verdict refuses to say ready', pp.summary.verdict);
  ok(/PayPal webhooks/.test(pp.summary.verdict), 'and names it', pp.summary.verdict);

  const done = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', PAYPAL_CLIENT_ID: 'id', PAYPAL_SECRET: 'sec',
    PAYPAL_WEBHOOK_ID: 'wh' }));
  ok(done.summary.blockingMissing === 0, 'and setting it clears the block', done.summary.blockingMissing);
}

section('Sandbox and a wide-open API are states, reported as states');
{
  /* Neither is a missing capability. PAYPAL_MODE defaults to sandbox and
     ALLOWED_ORIGIN defaults to '*', and both defaults are correct for a
     deployment that has not launched. They are here because "we launched and
     no PayPal money ever arrived" is exactly what this screen exists to stop
     somebody finding out later. */
  const def = await get(Object.assign(bare(), { AMV_MODEL_KEY: 'k', JWT_SECRET: 'j' }));
  ok(find(def, 'paypalLive').on === false, 'sandbox is reported as not live', find(def, 'paypalLive').on);
  ok(/SANDBOX/.test(find(def, 'paypalLive').turnsOn), 'in those words', find(def, 'paypalLive').turnsOn);
  ok(find(def, 'paypalLive').blocking === false, 'and it does not block, because sandbox is a valid state');
  ok(find(def, 'apiOrigin').on === false, 'and a wildcard origin is reported as not pinned', find(def, 'apiOrigin').on);
  ok(/ANY site/.test(find(def, 'apiOrigin').turnsOn), 'saying what that means', find(def, 'apiOrigin').turnsOn);

  const star = await get(Object.assign(bare(), { AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', ALLOWED_ORIGIN: '*' }));
  ok(find(star, 'apiOrigin').on === false,
     'an explicit "*" is the same as none, not a configured origin', find(star, 'apiOrigin').on);

  const pinned = await get(Object.assign(bare(), {
    AMV_MODEL_KEY: 'k', JWT_SECRET: 'j', ALLOWED_ORIGIN: 'https://amv.homes', PAYPAL_MODE: 'live' }));
  ok(find(pinned, 'apiOrigin').on === true, 'a real origin is pinned', find(pinned, 'apiOrigin').on);
  ok(find(pinned, 'paypalLive').on === true, 'and live mode reads as live', find(pinned, 'paypalLive').on);
}

section('Nothing the Worker can switch on is missing from the screen');
{
  /* THE PROPERTY, NOT THE COUNT. The screen listed sixteen capabilities while
     the Worker read forty-nine names, so thirty things it could actually do
     were invisible on the one screen whose job is to name them - including the
     three price ids above.

     A count assertion would go stale the day somebody adds a row. This reads
     the Worker's own source for every name it reaches for, and asks whether
     each one has somewhere on this screen to appear. The gate carries the same
     check as a stage; it is here as well because a suite that runs in eight
     seconds is what somebody actually runs while writing the capability. */
  const used = new Set();
  for (const m of src.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
  for (const m of src.matchAll(/_has\(env,\s*'([A-Z][A-Z0-9_]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/(?:idEnv|secretEnv)\s*:\s*'([A-Z][A-Z0-9_]+)'/g)) used.add(m[1]);
  ok(used.size >= 40, 'the scan found the Worker’s env reads at all', used.size);

  const d = await get(bare());
  /* What the SCREEN can show: every row's how/turnsOn, plus the tuning list,
     which is where a knob with a working default is named. Assembled from the
     response rather than from the source, because the response is what an
     operator actually sees. */
  const shown = JSON.stringify([].concat(d.items, d.storage, d.tuning || []));
  const missing = [...used].filter(n => !new RegExp('\\b' + n + '\\b').test(shown)).sort();
  ok(missing.length === 0,
     'every name the Worker reads is named somewhere an operator can see it', missing);
}

section('Rows are grouped, and settings with a default are not shown as faults');
{
  const d = await get(bare());
  ok(Array.isArray(d.groupOrder) && d.groupOrder.length >= 5,
     'the server sends the heading order, because it decides the grouping', d.groupOrder);
  ok(d.items.every(i => i.group), 'every row carries a group');
  ok(d.items.every(i => d.groupOrder.includes(i.group)),
     'and no row lands under a heading the browser was not told to render',
     d.items.filter(i => !d.groupOrder.includes(i.group)).map(i => i.id));
  ok(!d.items.some(i => i.group === 'Other'),
     'nothing fell into the catch-all bucket', d.items.filter(i => i.group === 'Other').map(i => i.id));

  ok(Array.isArray(d.tuning) && d.tuning.length >= 5,
     'knobs with working defaults are reported separately', (d.tuning || []).length);
  ok(d.tuning.every(t => t.env && t.effect && t.effect.length > 30),
     'each names its variable and what it does');
  ok(d.tuning.every(t => t.set === false), 'and on a bare deployment each is on its default', d.tuning.map(t => t.set));
  ok(!d.tuning.some(t => 'blocking' in t || 'on' in t),
     'they are not shaped like capabilities, so nothing renders them as missing');

  /* AND THE VALUE IS NEVER REPORTED. A spend ceiling is not a secret, but a
     screen that prints one env var's value is one that will print the next
     one's - and the next one will be a key. */
  const withVals = await get(Object.assign(bare(), {
    GLOBAL_DAILY_USD_CAP: '31337', NONESSENTIAL_WRITE_CAP: '4242',
    MODEL_API_URL: 'https://proxy.SUPERSECRET.example' }));
  const body = JSON.stringify(withVals);
  ok(!/31337|4242|SUPERSECRET/.test(body), 'a set knob reports that it is set, never what to');
  ok(withVals.tuning.find(t => t.id === 'spendCap').set === true, 'while still reporting that it is set');
}

section('The checklist somebody reads before launching names every one of them');
{
  /* THE READINESS SCREEN NEEDS AN ADMIN TOKEN AND A DEPLOYED WORKER.

     GO-LIVE.md needs neither, which makes it the thing somebody actually reads
     while deciding what to switch on - and it was missing six capabilities
     that were documented only in DEPLOY.md: error reporting, product
     analytics, bank connections, browser rendering, and RESET_EMAIL_FROM,
     which is the difference between password resets reaching everybody and
     reaching only the owner.

     An existing suite already requires each secret to appear in GO-LIVE.md OR
     DEPLOY.md. That rule is about not losing a secret entirely. This one is
     narrower and about a different failure: the file named "Go Live Checklist"
     has to be complete on its own, because somebody reading it to decide
     whether they are ready will not know to go and read the other file. */
  const goLive = readFileSync(join(ROOT, 'GO-LIVE.md'), 'utf8');

  const named = new Set();
  for (const m of src.matchAll(/_has\(env,\s*'([A-Z][A-Z0-9_]+)'/g)) named.add(m[1]);
  for (const m of src.matchAll(/(?:idEnv|secretEnv)\s*:\s*'([A-Z][A-Z0-9_]+)'/g)) named.add(m[1]);
  const d = await get(bare());
  for (const t of d.tuning || []) named.add(t.env);
  /* Every name the readiness rows carry in their `how` line, which is where a
     row states the command - so a capability added to the screen is picked up
     here without anybody having to add it to a list twice. */
  for (const i of d.items) for (const m of String(i.how).matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) named.add(m[1]);

  ok(named.size >= 30, 'the scan found the capabilities at all', named.size);
  const missing = [...named].filter(n => !goLive.includes(n)).sort();
  ok(missing.length === 0,
     'every capability on the readiness screen is also on the go-live checklist', missing);

  /* And the checklist says what each COSTS, which is the question the readiness
     screen cannot answer and the one that decides whether to switch it on. */
  ok(/\|\s*Costs\s*\|/.test(goLive), 'the checklist has a cost column at all');
  for (const phrase of ['PAYPAL_MODE', 'sandbox', 'ALLOWED_ORIGIN'])
    ok(goLive.includes(phrase), `it warns about ${phrase}`, true);
}

report('readiness');
done();
