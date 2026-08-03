/* THE SIGNATURE IS WHAT MAKES A SALE REAL.

   Every marketplace credit, every plan upgrade and every renewal is granted by
   the Stripe webhook. Nothing else stands between "somebody POSTed JSON at the
   worker" and "the seller's balance went up", so this one function is the
   boundary the whole money path rests on - and it had no coverage whatsoever.

   Two directions matter equally. A forged event must never be accepted, or
   anybody can grant themselves a plan. And a GENUINE event must never be
   rejected, because a rejected webhook means a customer paid and got nothing,
   which they experience as theft and charge back.

   The second direction is where the bug was: Stripe sends every valid signature
   for an event, and during a webhook-secret rotation that is more than one v1.
   The header was parsed with Object.fromEntries, which keeps only the LAST. If
   the configured secret produced the first, every real event was rejected as
   forged - at exactly the moment somebody is rotating a secret. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'wsig.harness.mjs');
writeFileSync(harness, src + `
export { verifyStripeSignature };
`);
const W = await import(harness + '?t=' + Date.now());

/* Sign exactly the way Stripe does, so the test exercises the real format. */
async function sign(secret, payload, t){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const now = () => Math.floor(Date.now() / 1000);
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
const SECRET = 'whsec_test_secret_value';

section('A genuine event is accepted');
{
  const t = now();
  const v1 = await sign(SECRET, BODY, t);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${v1}`) === true,
     'a correctly signed event passes', true);
}

section('A forged event is not');
{
  const t = now();
  const v1 = await sign('whsec_the_wrong_secret', BODY, t);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${v1}`) === false,
     'signed with the wrong secret, it is refused', false);

  const good = await sign(SECRET, BODY, t);
  ok(await W.verifyStripeSignature(SECRET, JSON.stringify({ id: 'evt_1', type: 'tampered' }), `t=${t},v1=${good}`) === false,
     'and a valid signature for DIFFERENT content does not carry over to this one', false);

  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=` + '0'.repeat(64)) === false,
     'nor does a made-up signature of the right shape', false);
}

section('During a secret rotation, real events still get through');
{
  /* Stripe signs with the old AND the new secret while both are active, and
     sends both. Only reading the last one meant a rotation rejected genuine
     events - a customer pays, the webhook is refused as forged, and they get
     nothing for their money. */
  const t = now();
  const mine = await sign(SECRET, BODY, t);
  const other = await sign('whsec_the_other_one_in_rotation', BODY, t);

  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${other},v1=${mine}`) === true,
     'accepted when our signature is the last offered', true);
  /* The case that used to fail. */
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${mine},v1=${other}`) === true,
     'and accepted when it is the FIRST, which is where this broke', true);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${other},v1=${mine},v1=${other}`) === true,
     'and among several', true);

  /* Accepting any of several must not become accepting anything. */
  const wrongA = await sign('whsec_nope_one', BODY, t);
  const wrongB = await sign('whsec_nope_two', BODY, t);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${t},v1=${wrongA},v1=${wrongB}`) === false,
     'while several wrong signatures are still all wrong', false);
}

section('An old signature cannot be replayed');
{
  const old = now() - 600;                       // ten minutes ago
  const v1 = await sign(SECRET, BODY, old);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${old},v1=${v1}`) === false,
     'a correctly signed but stale event is refused', false);

  const future = now() + 600;
  const v1f = await sign(SECRET, BODY, future);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${future},v1=${v1f}`) === false,
     'and so is one timestamped in the future', false);

  const recent = now() - 60;
  const v1r = await sign(SECRET, BODY, recent);
  ok(await W.verifyStripeSignature(SECRET, BODY, `t=${recent},v1=${v1r}`) === true,
     'while an ordinary slightly-delayed delivery still works', true);
}

section('Malformed input is refused rather than throwing');
{
  const t = now();
  const v1 = await sign(SECRET, BODY, t);
  const cases = [
    ['no header', ''],
    ['no timestamp', `v1=${v1}`],
    ['no signature', `t=${t}`],
    ['nonsense', 'garbage'],
    ['empty parts', ',,,'],
  ];
  for(const [label, hdr] of cases){
    const r = await W.verifyStripeSignature(SECRET, BODY, hdr);
    ok(r === false, label + ' is refused', { label, r });
  }
  ok(await W.verifyStripeSignature('', BODY, `t=${t},v1=${v1}`) === false,
     'and with no secret configured, nothing is trusted', false);
}

section('The worker verifies before it parses');
{
  /* Parsing first would run JSON.parse on unauthenticated input and, worse,
     invites a later edit that reads a field before the check. */
  const at = src.indexOf('async function stripeWebhook');
  const body = src.slice(at, at + 900);
  ok(body.indexOf('verifyStripeSignature') < body.indexOf('JSON.parse'),
     'the signature is checked before the payload is read', true);
  ok(/audit\(env, 'forged_webhook'/.test(body),
     'and a refused event is recorded, because a forged webhook is an attack', true);
}

if (report('webhook-signature') > 0) process.exitCode = 1;
done();
