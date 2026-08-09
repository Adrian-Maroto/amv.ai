/* THE INVESTING CHECK-IN.

   "Tell me how my money is doing" needs the one thing a balance endpoint cannot
   give on its own: what it was last time. A balance is a number; a check-in is a
   change. So each run stores a snapshot and reports the difference from the
   previous one.

   Everything below is really about one property: it must never invent a figure.
   A confident wrong number about somebody's savings is the most damaging thing
   this product could produce, so a first run says it has nothing to compare
   against, a percentage off a zero balance is refused rather than rendered, and
   a failed provider read never becomes the baseline the next run measures from. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'invest.harness.mjs');
writeFileSync(harness, src + `
export { _investCheckin, _investShape, _investDelta, _isInvestAccount, financeCheckin,
         _investText, _autoExecute, issueTokens, DB };
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40), FINANCE_CLIENT_ID: 'cid', FINANCE_SECRET: 'sec',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; },
  },
  ...extra,
});
const realFetch = globalThis.fetch;
const serveBalances = (accounts, opts = {}) => {
  globalThis.fetch = async () => {
    if (opts.fail) return { ok: false, json: async () => ({ error_message: 'institution down' }) };
    if (opts.throw) throw new Error('network');
    return { ok: true, json: async () => ({ accounts }) };
  };
};
const acct = (id, name, type, balance) => ({
  account_id: id, name, subtype: type, balances: { current: balance, iso_currency_code: 'USD' } });

section('Only investment accounts count');
{
  ok(W._isInvestAccount({ type: 'brokerage' }), 'a brokerage does');
  ok(W._isInvestAccount({ type: 'ira' }), 'so does an IRA');
  ok(W._isInvestAccount({ type: '401k' }), 'and a 401k');
  ok(!W._isInvestAccount({ type: 'checking' }), 'a current account does not');
  ok(!W._isInvestAccount({ type: 'credit card' }), 'and neither does a card');

  /* A salary landing and rent leaving is enormous noise in a question about
     whether investments went up. */
  const shape = W._investShape([
    { id: 'a', type: 'brokerage', balance: 1000, currency: 'USD' },
    { id: 'b', type: 'checking', balance: 99999, currency: 'USD' },
  ]);
  ok(shape.total === 1000, 'so the total ignores the current account entirely', shape.total);
  ok(shape.accounts.length === 1, 'and it is not even listed', shape.accounts.length);
}

section('The first check-in says it has nothing to compare against');
{
  store.clear();
  const env = mkEnv();
  await W.DB.put(env, 'fin', 'a@x.com', { accessToken: 'tok' });
  serveBalances([acct('1', 'Brokerage', 'brokerage', 10000)]);

  const r = await W._investCheckin(env, 'a@x.com');
  ok(r.ok === true, 'it runs', r);
  ok(r.first === true, 'and says this is the first one', r.first);
  ok(r.changePct === undefined, 'rather than reporting 0% as though the market stood still', r.changePct);
  ok(r.total === 10000, 'while still giving the real total', r.total);
}

section('The second one is the actual answer');
{
  const env = mkEnv();
  serveBalances([acct('1', 'Brokerage', 'brokerage', 11500)]);
  const r = await W._investCheckin(env, 'a@x.com');
  ok(r.first === false, 'it has something to compare against now');
  ok(r.changeUSD === 1500, 'the money change is exact', r.changeUSD);
  ok(r.changePct === 15, 'and the percentage is the one a person would work out', r.changePct);
  ok(r.direction === 'up', 'with the direction named, not left to a minus sign', r.direction);
  ok(r.since > 0, 'and since when', r.since);
}

section('Down is reported as plainly as up');
{
  const env = mkEnv();
  serveBalances([acct('1', 'Brokerage', 'brokerage', 8625)]);
  const r = await W._investCheckin(env, 'a@x.com');
  ok(r.changeUSD === -2875, 'a loss is a negative number, not an absolute one', r.changeUSD);
  ok(r.changePct === -25, 'and a negative percentage', r.changePct);
  ok(r.direction === 'down', 'said out loud', r.direction);
}

section('A percentage off nothing is refused, not rendered');
{
  ok(W._investDelta({ total: 500, accounts: [] }, { at: 1, total: 0, accounts: [] }).changePct === null,
     'growing from zero has no percentage - it is not infinite, it is undefined');
  ok(W._investDelta({ total: 500, accounts: [] }, { at: 1, total: 0, accounts: [] }).changeUSD === 500,
     'while the money figure is still exact and still useful');
  ok(W._investDelta({ total: 100, accounts: [] }, null).first === true,
     'and no previous snapshot is a first run, not a zero baseline');
}

section('Each account is broken out, including one that is new');
{
  const env = mkEnv();
  serveBalances([
    acct('1', 'Brokerage', 'brokerage', 9000),
    acct('2', 'Roth IRA', 'roth', 4000),
  ]);
  const r = await W._investCheckin(env, 'a@x.com');
  const roth = r.byAccount.find(a => a.name === 'Roth IRA');
  const brok = r.byAccount.find(a => a.name === 'Brokerage');
  ok(roth && roth.isNew === true, 'an account seen for the first time is marked new', roth);
  ok(roth.change === undefined, 'rather than being reported as a gain it did not make', roth.change);
  ok(brok.change === 375, 'while a known account shows its own change', brok.change);
}

section('A failed read never becomes the baseline');
{
  /* The trap: a provider error returns a total of zero, that gets stored, and
     the next check-in cheerfully reports the account is up infinitely. */
  const env = mkEnv();
  const before = await W.DB.get(env, 'invsnap', 'a@x.com');
  serveBalances([], { fail: true });
  const bad = await W._investCheckin(env, 'a@x.com');
  ok(bad.ok === false, 'the failure is a failure', bad);
  ok(bad.code === 'provider_error', 'with a code', bad.code);

  const after = await W.DB.get(env, 'invsnap', 'a@x.com');
  ok(JSON.stringify(after) === JSON.stringify(before),
     'and the stored snapshot is untouched, so the next run still compares against real data');

  serveBalances([], { throw: true });
  const threw = await W._investCheckin(env, 'a@x.com');
  ok(threw.ok === false && threw.code === 'provider_error',
     'a network failure is the same answer, not an exception', threw);
}

section('It refuses honestly when there is nothing to check');
{
  store.clear();
  const env = mkEnv();
  const none = await W._investCheckin(env, 'nobody@x.com');
  ok(none.ok === false && none.code === 'needs_auth',
     'an account with nothing linked is told to link something', none);

  await W.DB.put(env, 'fin', 'b@x.com', { accessToken: 'tok' });
  serveBalances([acct('9', 'Everyday', 'checking', 2000)]);
  const cash = await W._investCheckin(env, 'b@x.com');
  ok(cash.ok === false && cash.code === 'no_investments',
     'and an institution with no investment accounts is told that, not shown a zero', cash);

  const unset = await W._investCheckin(mkEnv({ FINANCE_CLIENT_ID: '', FINANCE_SECRET: '' }), 'b@x.com');
  ok(unset.ok === false && unset.code === 'needs_service',
     'with no provider configured it says so rather than inventing a balance', unset);
}

section('Peeking does not move the baseline');
{
  /* Looking at where you stand should not silently reset what the next
     scheduled check-in measures from. */
  store.clear();
  const env = mkEnv();
  await W.DB.put(env, 'fin', 'c@x.com', { accessToken: 'tok' });
  serveBalances([acct('1', 'Brokerage', 'brokerage', 100)]);
  await W._investCheckin(env, 'c@x.com');

  serveBalances([acct('1', 'Brokerage', 'brokerage', 200)]);
  await W._investCheckin(env, 'c@x.com', { store: false });
  const snap = await W.DB.get(env, 'invsnap', 'c@x.com');
  ok(snap.total === 100, 'a peek leaves the stored snapshot where it was', snap.total);

  const real = await W._investCheckin(env, 'c@x.com');
  ok(real.changeUSD === 100, 'so the next real check-in still measures the whole move', real.changeUSD);
}

section('It can only look');
{
  /* Running unattended on a schedule, the correct set of powers is exactly
     one: read. */
  const block = src.slice(src.indexOf('async function _investCheckin'), src.indexOf('async function financeCheckin'));
  ok(!/transfer|payment|\/payments|move.*money/i.test(block),
     'the check-in has no path that could move money');
  ok(/accounts\/balance\/get/.test(block), 'it reads balances and nothing else');
}

section('The scheduled one reads the accounts rather than asking a model');
{
  /* This is the part that runs while nobody is watching, and it was the real
     hole: the job was filed as a plain task, so the cron handed the wording
     "tell me how my investments are doing" to a model with no way to read an
     account. It would have had to either apologise every morning or invent a
     figure about somebody's retirement. */
  store.clear();
  const env = mkEnv();
  await W.DB.put(env, 'fin', 'd@x.com', { accessToken: 'tok' });

  let modelCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/accounts/balance/get'))
      return { ok: true, json: async () => ({ accounts: [acct('1', 'Brokerage', 'brokerage', 10000)] }) };
    modelCalls++;
    return { ok: true, json: async () => ({ content: [{ text: 'invented' }], usage: {} }) };
  };

  const first = await W._autoExecute(env, { kind: 'invest', detail: 'check my investments' }, {}, 'd@x.com');
  ok(modelCalls === 0, 'no model is asked anything at all', modelCalls);
  ok(/10,000\.00/.test(first.text), 'the institution\'s own total is reported', first.text.slice(0, 80));
  ok(/nothing to compare it against/.test(first.text),
     'and a first run says so instead of claiming the market stood still');
  ok(first.usage.input === 0 && first.usage.output === 0,
     'it costs no tokens, so a daily check-in cannot eat a monthly allowance', first.usage);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ accounts: [acct('1', 'Brokerage', 'brokerage', 8000)] }) });
  const second = await W._autoExecute(env, { kind: 'invest' }, {}, 'd@x.com');
  ok(/Down/.test(second.text), 'a loss is named as a loss', second.text.slice(0, 120));
  ok(/-\$2,000\.00/.test(second.text), 'with the exact money figure', second.text);
  ok(/-20%/.test(second.text), 'and the percentage a person would work out');
  ok(/not financial advice/.test(second.text), 'and it does not pretend to be advice');
}

section('A bank having a bad week does not switch the check-in off');
{
  const env = mkEnv();
  serveBalances([], { fail: true });
  const bad = await W._autoExecute(env, { kind: 'invest' }, {}, 'd@x.com');
  ok(/institution down|could not/i.test(bad.text), 'the run says what went wrong', bad.text.slice(0, 120));
  ok(!/\$\s*[\d,]/.test(bad.text),
     'and shows no money figure at all rather than yesterday\'s dressed as today\'s', bad.text);
  ok(/nothing here is estimated/i.test(bad.text), 'saying outright that nothing was guessed');
  ok(bad.soft === 'provider_error',
     'it is flagged soft, so the cron records it without counting toward giving up', bad.soft);

  const none = await W._autoExecute(mkEnv(), { kind: 'invest' }, {}, 'nobody@x.com');
  ok(none.soft === 'needs_auth', 'nothing linked is the same shape of answer', none.soft);
  ok(/link/i.test(none.text), 'and it says what to do about it', none.text.slice(0, 120));
}

section('A busy month in chat does not switch the check-in off');
{
  /* The cron skips a due job when the account is at its monthly SPEND ceiling.
     This one spends nothing, so that gate is about a different resource - and
     applying it anyway would silently stop the savings check-in of somebody
     whose only sin was using chat a lot. */
  /* The WHOLE function, found by where the next one starts. A fixed character
     window here went stale the moment the tick grew a comment, and reported a
     correct implementation as broken - which is the failure mode that teaches
     people to ignore this suite. */
  const at = src.indexOf('async function runDueAutomations');
  const ends = [src.indexOf('\nasync function ', at + 1), src.indexOf('\nfunction ', at + 1)].filter(i => i > 0);
  const loop = src.slice(at, Math.min(...ends));
  ok(ends.length > 0 && loop.length > 2000, 'the tick was located in full', loop.length);
  ok(/item\.kind !== 'invest'/.test(loop),
     'the ceiling check deliberately does not apply to it');
  ok(loop.indexOf("item.kind !== 'invest'") < loop.indexOf('monthly allowance reached'),
     'and it is the check that is skipped, not the job');
}

section('The check-in survives creation as itself');
{
  /* The free-tier reshaping turns an unaffordable job into a plain task. Doing
     that to this one would convert "read my accounts" into "have a model guess
     at my accounts", which is the exact failure this whole file is about. */
  const create = src.slice(src.indexOf('async function autoCreate'), src.indexOf('async function autoUpdate'));
  ok(/body\.kind === 'invest'/.test(create), 'the kind is accepted rather than flattened to a task');
  ok(/kind !== 'invest'/.test(create), 'and reshaping deliberately leaves it alone');
}

globalThis.fetch = realFetch;
if (report('invest-checkin') > 0) process.exitCode = 1;
done();
