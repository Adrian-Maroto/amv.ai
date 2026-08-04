/* THE EXPORT AND THE ERASURE HAVE TO BE THE SAME LIST.

   "Export my data" sits next to "Delete account", which is the moment somebody
   most needs it to be complete. It collected what lived in the BROWSER and said
   so - honest about its scope, and not the whole answer. Automations, approvals,
   handoffs, purchases, the wallet, listings, teams and the activity log are all
   held on the server, and none of them were in the file.

   The fix that matters is not "add an endpoint", it is "add an endpoint that
   cannot drift". Erasure already maintains the authoritative list of everything
   AMV holds for one account, because it has to delete all of it. The export is
   built from that same constant, so the two can only ever disagree by somebody
   editing the list - which changes both at once, in the right direction.

   The direction of drift is the point. An export that omits a record the
   product is still holding tells somebody they have everything when they do
   not, which is precisely the question a data-access request is asking.

   And the limit on it: a live credential is not somebody's data to download.
   Those are reported as present and withheld, so the export cannot become a way
   to read a key back out. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'account-export.harness.mjs');
writeFileSync(harness, src + `
export { accountExport, authDeleteAccount, PER_USER_KINDS, EXPORT_REDACTED, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const counters = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (id) => ({
      async fetch(_u, init) {
        const b = JSON.parse((init && init.body) || '{}');
        const cur = counters.get(id) || 0;
        if (b.op === 'rateCheck') { counters.set(id, cur + 1); return new Response(JSON.stringify({ allowed: cur + 1 <= b.limit })); }
        if (b.op === 'reserve') { counters.set(id, cur + 1); return new Response(JSON.stringify({ allowed: cur < b.cap })); }
        return new Response(JSON.stringify({ value: cur, allowed: true }));
      },
    }),
  },
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
W.__setRequireUser(async () => ({ email: 'me@x.com', plan: 'pro', customCfg: null }));

const get = () => W.accountExport(new Request('https://api.amv.dev/v1/account/export', {
  headers: { Authorization: 'Bearer t' },
}), env);

section('It is built from the list erasure walks, not a second one');
{
  /* The whole design. If somebody adds a record kind, they add it here, and
     both the deletion and the export pick it up in the same commit. */
  ok(Array.isArray(W.PER_USER_KINDS) && W.PER_USER_KINDS.length > 20,
     'one shared list of everything held for an account', W.PER_USER_KINDS.length);
  const exportBody = src.slice(src.indexOf('async function accountExport'), src.indexOf('async function authDeleteAccount'));
  ok(/for \(const kind of PER_USER_KINDS\)/.test(exportBody),
     'the export iterates it rather than naming kinds itself', true);
  const eraseBody = src.slice(src.indexOf('async function authDeleteAccount'));
  ok(/const perUserKinds = PER_USER_KINDS;/.test(eraseBody),
     'and so does erasure', true);
}

section('What the server holds comes back');
{
  await W.DB.put(env, 'acct', 'me@x.com', { email: 'me@x.com', name: 'Me' });
  await W.DB.put(env, 'auto', 'me@x.com', { items: [{ id: 'a1', detail: 'daily digest' }] });
  await W.DB.put(env, 'approvals', 'me@x.com', { items: [{ id: 'ap1', kind: 'send' }] });
  await W.DB.put(env, 'wallet', 'me@x.com', { balance: 42.5 });
  await W.DB.put(env, 'purchases', 'me@x.com', [{ id: 'p1', title: 'A template' }]);
  store.set('alog:me@x.com', JSON.stringify([{ kind: 'login', at: 1 }]));
  store.set('resume:me@x.com:r1', 'an answer that was parked for me');

  const d = await (await get()).json();
  ok(d.ok === true, 'the export succeeds', d.ok);
  ok(d.records.auto && d.records.auto.items[0].detail === 'daily digest',
     'the automations somebody set up', d.records.auto);
  ok(d.records.approvals && d.records.approvals.items.length === 1, 'their approvals', d.records.approvals);
  ok(d.records.wallet && d.records.wallet.balance === 42.5, 'their balance', d.records.wallet);
  ok(Array.isArray(d.records.purchases) && d.records.purchases.length === 1, 'what they bought', d.records.purchases);
  ok(!!d.loose.activity_log, 'the activity log kept about them', !!d.loose.activity_log);
  ok(!!d.loose['resume:me@x.com:r1'], 'and an answer parked on their behalf', Object.keys(d.loose));
}

section('A live credential is named, not handed over');
{
  await W.DB.put(env, 'fin', 'me@x.com', { accessToken: 'access-sandbox-SECRET' });
  await W.DB.put(env, 'apikeys', 'me@x.com', { items: [{ id: 'k1', hash: 'HASHVALUE' }] });
  store.set('smsverify:me@x.com:+15550001111', '994422');

  const d = await (await get()).json();
  const blob = JSON.stringify(d);
  ok(!/access-sandbox-SECRET/.test(blob), 'the bank token is not in the file', true);
  ok(!/HASHVALUE/.test(blob), 'nor an API key hash', true);
  ok(!/994422/.test(blob), 'nor a pending verification code', true);

  ok(!!d.withheld.fin, 'but its existence is disclosed', d.withheld.fin);
  ok(!!d.withheld.apikeys, 'and so is theirs', d.withheld.apikeys);
  ok(Object.keys(d.withheld).some(k => k.startsWith('smsverify:')),
     'and the pending code is accounted for', Object.keys(d.withheld));
}

section('It says what is deliberately kept back');
{
  const d = await (await get()).json();
  ok(/retention/i.test((d.alsoRetained && d.alsoRetained.billing) || ''),
     'invoices are named as retained, with the reason', d.alsoRetained);
  ok(/will not hand a key back/i.test(d.note || ''), 'and the credential rule is stated', d.note);
}

section('It is only ever the caller’s own data');
{
  counters.clear();   // the limiter is exercised on purpose further down
  await W.DB.put(env, 'wallet', 'someone@else.com', { balance: 9999 });
  const d = await (await get()).json();
  ok(d.account === 'me@x.com', 'the export names the caller', d.account);
  ok(!/9999/.test(JSON.stringify(d)), 'and holds nobody else’s balance', true);
}

section('And it cannot be used as a scraping loop');
{
  /* Every call reads every record this account has. Unbounded, it is a way to
     make the platform do a lot of work per request. */
  counters.clear();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await get()).status);
  ok(codes.some(c => c === 429), 'repeated exports are rate limited', codes);
}

section('Signed out, it returns nothing');
{
  W.__setRequireUser(async () => null);
  const r = await get();
  ok(r.status === 401, 'unauthorized', r.status);
  const d = await r.json();
  ok(!d.records, 'and no records at all', Object.keys(d));
}

if (report('account-export') > 0) process.exitCode = 1;
done();
