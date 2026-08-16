/* THE MOST SENSITIVE THING AMV EVER HOLDS.

   A bank connection is a live credential that reads somebody's money. Nothing
   else in the product is close: a leaked chat is embarrassing, a leaked bank
   token is an incident with a regulator on the other end of it.

   The design is right - the token is stored server-side, redacted out of the
   data export, revoked at the provider when somebody disconnects, and the
   check-in reports figures that came from the institution or reports nothing.
   Every one of those routes appeared in no test, which for this particular
   record means the difference between "we hold it correctly" and "we believe we
   hold it correctly".

   These cases are the four questions somebody would ask in an incident review:
   can it leave the server, can another account reach it, does disconnecting
   actually disconnect, and does AMV ever state a balance it did not read. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'fin.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, EXPORT_REDACTED, PER_USER_KINDS, _investText };\n');
const W = await import(harness + '?t=' + Date.now());

const ME = 'me@example.com';
const THEM = 'them@example.com';
const PW = 'A-real-Passw0rd!';
const TOKEN = 'access-sandbox-THE-LIVE-BANK-CREDENTIAL';

/* What the bank provider says, and what AMV asked it. */
/* An investment account, because the check-in is about investments and filters
   everything else out - a current account here would produce "no investment
   accounts found" and read as a broken check-in rather than a wrong fixture. */
let providerAccounts = [{ account_id: 'a1', name: 'Brokerage', subtype: 'brokerage',
                          balances: { current: 1234.56, available: 1200, iso_currency_code: 'USD' } }];
let providerUp = true;
const providerCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/plaid|finance/i.test(u)) {
    providerCalls.push({ url: u, body: String((opts && opts.body) || '') });
    if (!providerUp) return { ok: false, status: 502, json: async () => ({ error_message: 'the bank is unreachable' }) };
    if (/item\/remove/.test(u)) return { ok: true, status: 200, json: async () => ({ removed: true }) };
    return { ok: true, status: 200, json: async () => ({ accounts: providerAccounts }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map(); providerCalls.length = 0; providerUp = true;
  return Object.assign({
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    FINANCE_CLIENT_ID: 'fc', FINANCE_SECRET: 'fs', FINANCE_API_URL: 'https://sandbox.plaid.com',
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const req = (env, path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || (body === undefined ? 'GET' : 'POST'),
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '33.33.33.33',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };

async function signup(env, email) {
  return (await jsonOf(await req(env, '/auth/signup', { email, name: 'X', password: PW }))).token;
}
async function linked(env, email) {
  await W.DB.put(env, 'fin', email, { accessToken: TOKEN, itemId: 'item1', institution: 'A Bank', linkedAt: Date.now() });
}

section('A linked account works, and the figures come from the bank');
{
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);
  const d = await jsonOf(await req(env, '/v1/finance/checkin', {}, tok));
  ok(d.ok === true, 'the check-in runs', d.error || 'ok');
  ok(JSON.stringify(d).includes('1234.56'), 'and reports the balance the bank returned', true);
  ok(providerCalls.some(c => c.body.includes(TOKEN)),
     'having actually asked the bank, using the stored credential', providerCalls.length);
}

section('The credential itself never comes back');
{
  /* The whole point of holding it server-side. A route that echoes it turns
     every other protection into decoration. */
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);

  const seen = [];
  for (const [path, body] of [['/v1/finance/checkin', {}], ['/v1/finance/link/start', {}], ['/v1/account/export', undefined]]) {
    const r = await req(env, path, body, tok);
    const text = JSON.stringify(await jsonOf(r));
    if (text.includes(TOKEN)) seen.push(path);
  }
  ok(seen.length === 0, 'no route hands the bank credential back to the browser', seen);
}

section('And an export says the record exists without giving it away');
{
  /* Somebody is entitled to know AMV holds a bank connection for them. They
     are not entitled to download a live key, and neither is anybody who gets
     hold of their session for a minute. */
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);
  const d = await jsonOf(await req(env, '/v1/account/export', undefined, tok));
  const text = JSON.stringify(d);
  ok(!text.includes(TOKEN), 'the credential is not in the export', true);
  ok(/bank connection credential|withheld|redact/i.test(text),
     'but its existence is disclosed rather than hidden', text.slice(0, 200));

  /* And the redaction list has not drifted from what is actually held. */
  ok(!!W.EXPORT_REDACTED.fin && !!W.EXPORT_REDACTED.finlink,
     'both the connection and the link session are on the redaction list', Object.keys(W.EXPORT_REDACTED));
  ok(W.PER_USER_KINDS.includes('fin') && W.PER_USER_KINDS.includes('finlink'),
     'and both are erased with the account', true);
}

section('Nobody else can reach it');
{
  const env = mkEnv();
  const mine = await signup(env, ME);
  const theirs = await signup(env, THEM);
  await linked(env, ME);

  const d = await jsonOf(await req(env, '/v1/finance/checkin', {}, theirs));
  ok(d.ok !== true, 'somebody else gets no check-in from my bank', d.error || d);
  ok(!JSON.stringify(d).includes('1234.56'), 'and none of my figures', true);

  /* And they cannot disconnect mine either, which would be a denial of
     service on somebody else's account. */
  await req(env, '/v1/finance/unlink', {}, theirs);
  const still = await W.DB.get(env, 'fin', ME);
  ok(!!(still && still.accessToken), 'nor disconnect it', !!still);

  /* And they cannot ASK for mine by name. The obvious attack on any route that
     works on "the caller's" record is to send somebody else's identifier in the
     body and see whether the server prefers it to the token. Sending an empty
     body, as the case above does, never tests that - it falls back to their own
     account and passes against a server that would have handed mine over. */
  for (const body of [{ email: ME }, { user: ME }, { account: ME }]) {
    const r = await jsonOf(await req(env, '/v1/finance/checkin', body, theirs));
    const text = JSON.stringify(r);
    ok(!text.includes('1234.56'),
       'naming my account in the request body does not fetch my balance: ' + JSON.stringify(body),
       text.slice(0, 100));
  }

  const anon = await req(env, '/v1/finance/checkin', {});
  ok(anon.status === 401, 'and a stranger with no account gets nothing at all', anon.status);
}

section('Disconnecting tells the bank, not just AMV');
{
  /* Deleting our copy and leaving the connection live at the provider means
     consent ended on a screen and nowhere else. */
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);

  await req(env, '/v1/finance/unlink', {}, tok);
  ok(providerCalls.some(c => /item\/remove/.test(c.url) && c.body.includes(TOKEN)),
     'the provider is told to revoke it', providerCalls.map(c => c.url.split('/').pop()));
  ok(!(await W.DB.get(env, 'fin', ME)), 'and AMV no longer holds it', await W.DB.get(env, 'fin', ME));
}

section('And disconnects even when the bank is unreachable');
{
  /* A user who presses disconnect must not stay connected because a third
     party was down. Our copy goes either way. */
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);
  providerUp = false;

  await req(env, '/v1/finance/unlink', {}, tok);
  ok(!(await W.DB.get(env, 'fin', ME)),
     'the connection is gone from AMV regardless', await W.DB.get(env, 'fin', ME));
}

section('Deleting the account takes the bank connection with it');
{
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);
  /* AMV-015: erasure asks the person to confirm they are still there. */
  await req(env, '/auth/delete', { password: PW }, tok);
  ok(!(await W.DB.get(env, 'fin', ME)), 'no credential is left behind', await W.DB.get(env, 'fin', ME));
  ok(!(await W.DB.get(env, 'finlink', ME)), 'and no link session either', true);
}

section('With nothing linked, AMV says so rather than inventing a number');
{
  const env = mkEnv();
  const tok = await signup(env, ME);
  const d = await jsonOf(await req(env, '/v1/finance/checkin', {}, tok));
  ok(d.ok === false && d.code === 'needs_auth', 'it reports that nothing is linked', d);
  ok(!/\d+\.\d\d/.test(JSON.stringify(d)), 'and states no figures at all', JSON.stringify(d).slice(0, 120));
}

section('With the feature switched off, it degrades honestly');
{
  const env = mkEnv({ FINANCE_CLIENT_ID: '', FINANCE_SECRET: '' });
  const tok = await signup(env, ME);
  await linked(env, ME);
  const d = await jsonOf(await req(env, '/v1/finance/checkin', {}, tok));
  ok(d.ok === false && d.code === 'needs_service', 'it says the feature is not switched on', d);

  const start = await jsonOf(await req(env, '/v1/finance/link/start', {}, tok));
  ok(/not switched on/i.test(start.error || ''), 'and linking says the same', start.error);
  ok(/FINANCE_CLIENT_ID/.test(start.error || ''), 'naming exactly what would switch it on', start.error);
}

section('And when the bank will not answer, AMV reports that instead of guessing');
{
  /* The one thing this feature must never do is state a balance it did not
     read. A wrong figure about somebody's money is worse than no figure. */
  const env = mkEnv();
  const tok = await signup(env, ME);
  await linked(env, ME);
  providerUp = false;

  const d = await jsonOf(await req(env, '/v1/finance/checkin', {}, tok));
  ok(d.ok === false, 'the check-in fails rather than succeeding emptily', d);
  ok(!/\$\s?\d/.test(JSON.stringify(d)), 'with no figure in it', JSON.stringify(d).slice(0, 140));

  /* The words a scheduled check-in would send are built from the provider's
     numbers, never written by a model - so a failure has nothing to embellish. */
  const words = W._investText({ ok: false, code: 'provider_error' });
  ok(typeof words === 'string' && !/\$\s?\d/.test(words),
     'and the message for a failed run quotes no balance', words.slice(0, 120));
}

globalThis.fetch = realFetch;
if (report('a-bank-connection-is-not-yours') > 0) process.exitCode = 1;
done();
