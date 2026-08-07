/* PAYMENT / MARKETPLACE SECURITY (AMV-025, AMV-027, AMV-028).

   AMV-025  payment redirect URLs reflected the request Origin header, letting a
            direct caller point a victim's post-payment redirect at a phishing
            site. The server-configured APP_URL is now authoritative.
   AMV-027  PayPal capture trusted the order's custom_id email as the grant
            target. It was hardened to require a match with the authenticated
            caller, and the route was later removed outright for a reason the
            hardening could not fix: see the section below.
   AMV-028  marketplace listings accepted unbounded base64 file payloads
            (storage amplification / decompression bombs). Now size-bounded. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'payment-security.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, marketBuy, marketPublish, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

/* Money endpoints now require a recorded adult age - an account that has never
   been asked is refused with age_required, which is a prompt rather than a
   verdict. Production accounts answer it once; fixtures have to say it too. */
async function _adult(env, email){
  await W.DB.put(env, 'consent', String(email).toLowerCase(),
    { birthYear: new Date().getUTCFullYear() - 30, ageSetAt: Date.now(), history: [] });
}

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
  ...extra,
});
const tok = async (env, email) => (await W.issueTokens(env, email, email.split('@')[0])).token;
const req = (body, token, headers = {}) => new Request('https://api.amv.dev/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...headers }, body: JSON.stringify(body),
});
const jget = async (r) => { try { return await r.json(); } catch { return {}; } };

/* ── AMV-025: payment redirect uses APP_URL, not a spoofed Origin ───────── */
section('AMV-025: checkout redirect ignores a spoofed Origin');
{
  store.clear();
  const env = mkEnv({ STRIPE_SECRET_KEY: 'sk_test', APP_URL: 'https://app.amv.example' });
  store.set('market:usr_seed1', JSON.stringify({ id: 'usr_seed1', authorEmail: 'seller@x.com', price: 5, title: 'Thing', status: 'active' }));
  const buyerTok = await tok(env, 'buyer@x.com');
  await _adult(env, 'buyer@x.com');
  const realFetch = globalThis.fetch;
  let capturedBody = '';
  globalThis.fetch = async (url, opts) => { capturedBody = (opts && opts.body) || ''; return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe', id: 'cs_1' }) }; };
  const r = await W.marketBuy(req({ id: 'usr_seed1' }, buyerTok, { Origin: 'https://attacker.example' }), env);
  globalThis.fetch = realFetch;
  const params = new URLSearchParams(capturedBody);
  const successUrl = params.get('success_url') || '';
  ok(r.status === 200, 'checkout was created', r.status);
  ok(successUrl.startsWith('https://app.amv.example'), 'success_url uses the server APP_URL', successUrl);
  ok(!successUrl.includes('attacker.example'), 'the spoofed Origin is NOT reflected into the redirect', successUrl);
}

/* ── AMV-027: the one-time PayPal order routes are gone ─────────────────── */
section('AMV-027: a one-time payment cannot buy a recurring plan');
{
  /* This section used to prove that paypalCapture bound the grant to the
     authenticated caller, which it did. The binding was correct and the route
     was still wrong.

     A one-time PayPal ORDER has no renewal. paypalCapture called
     setEntitlement, which writes no expiry, so nothing downstream would ever
     revoke the plan: no invoice.payment_failed, no subscription.cancelled, no
     period end. Fifteen dollars, once, bought Pro for ever. And the browser
     flow that used the pair was removed for separate reasons, leaving two
     authenticated routes that any signed-in account could still drive with
     curl, long after nothing in the product pointed at them.

     Hardening could not fix that. The shape was wrong: AMV sells
     subscriptions, and only a subscription keeps paying. So the assertion is
     that the routes do not exist - a deleted route cannot regress. */
  ok(!/case '\/v1\/paypal\/create'/.test(src),
     'there is no one-time order route', true);
  ok(!/case '\/v1\/paypal\/capture'/.test(src),
     'and no route that grants a plan from capturing one', true);
  ok(!/function paypalCapture/.test(src),
     'the handler is gone too, not merely unrouted', true);

  /* The subscription route IS still here, because that is the one that keeps
     paying and that the webhook can revoke. Losing it by accident during the
     deletion would take PayPal off the product entirely. */
  ok(/case '\/v1\/paypal\/subscribe'/.test(src),
     'PayPal is still sellable, as a subscription', true);
  ok(/case '\/v1\/paypal\/webhook'/.test(src),
     'and its webhook still grants and revokes against that subscription', true);
}

/* ── AMV-028: marketplace listing file payloads are size-bounded ────────── */
section('AMV-028: inline listing files are size-bounded');
{
  store.clear();
  const env = mkEnv();
  const sellerTok = await tok(env, 'seller2@x.com');
  const big = 'A'.repeat(800 * 1024);   // > 700KB per-file cap
  let r = await W.marketPublish(req({ title: 'Helper Tool', text: 'legit', files: [{ name: 'big.bin', data: big }] }, sellerTok), env);
  ok(r.status === 413, 'an oversized inline file is rejected (413)', r.status);
  r = await W.marketPublish(req({ title: 'Helper Tool', text: 'a legit deliverable', files: [{ name: 'ok.txt', data: 'aGVsbG8=' }] }, sellerTok), env);
  ok(r.status < 400, 'a normal small file is accepted', r.status);
}

if (report() > 0) process.exitCode = 1;
done();
