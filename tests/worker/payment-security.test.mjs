/* PAYMENT / MARKETPLACE SECURITY (AMV-025, AMV-027, AMV-028).

   AMV-025  payment redirect URLs reflected the request Origin header, letting a
            direct caller point a victim's post-payment redirect at a phishing
            site. The server-configured APP_URL is now authoritative.
   AMV-027  PayPal capture trusted the order's custom_id email as the grant
            target; it must match the authenticated caller.
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
writeFileSync(harness, src + '\nexport { marketBuy, paypalCapture, marketPublish, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

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

/* ── AMV-027: PayPal capture must belong to the caller ──────────────────── */
section('AMV-027: PayPal capture is bound to the authenticated caller');
{
  store.clear();
  const env = mkEnv({ PAYPAL_CLIENT_ID: 'id', PAYPAL_SECRET: 'sec', PAYPAL_MODE: 'sandbox' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'ppt' }) };
    if (u.includes('/capture')) return { ok: true, json: async () => ({ id: 'ORDER1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', custom_id: 'victim@x.com|pro', amount: { value: '75.00', currency_code: 'USD' } }] } }] }) };
    return { ok: true, json: async () => ({}) };
  };
  const attackerTok = await tok(env, 'attacker@x.com');
  let r = await W.paypalCapture(req({ orderId: 'ORDER1' }, attackerTok), env);
  ok(r.status === 403, 'an order whose custom_id is another user is rejected (403)', r.status);
  const victimTok = await tok(env, 'victim@x.com');
  r = await W.paypalCapture(req({ orderId: 'ORDER1' }, victimTok), env);
  const d = await jget(r);
  globalThis.fetch = realFetch;
  ok(r.status === 200 && d.plan === 'pro', 'the legitimate buyer CAN capture their own order', { status: r.status, d });
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
