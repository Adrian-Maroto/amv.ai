/* THE MONEY JOBS THAT ASKED FOR A BANK AND WERE HANDED NOTHING.

   Five entries in the catalogue said `needs:'Bank connection'` - Morning money
   summary, Unusual transaction alerts, Low balance warning, Budget pace, Credit
   watch - and the runner had no `bank.read` to give them. `_cwUsesFor` had no
   row for that name, so `uses` arrived empty, so `_autoAccountContext` opened
   nothing, so each of those jobs ran every morning on its instruction alone.
   They did not invent figures, because each prompt says never to state a
   balance it cannot read. They simply could not work, and nothing at any layer
   said so.

   The sixth job is the one this suite is named for. The money leak detector
   reads receipts, and a receipt is what a merchant SAID it would charge. A
   debit is what LEFT THE ACCOUNT. Those differ in exactly the case the job
   exists to catch: a price that went up quietly is invisible in receipts until
   the next one arrives, and visible on a statement the same month.

   What is measured here:

     1. RECURRENCE IS ARITHMETIC, NEVER A MODEL. Two charges to one merchant,
        amounts that hold, spacing that matches a cadence. Anything less is not
        a subscription, because THE FALSE POSITIVE IS THE EXPENSIVE ONE -
        somebody cancels the wrong thing on the strength of it.
     2. THE PAUSE REACHES THE BANK. "Pause all autonomous" is the control
        somebody uses when they want AMV to stop touching their things, and the
        bank is the most sensitive thing it can touch. A pause that stopped the
        mailbox and left this readable would be the pause failing at the only
        moment anybody uses it.
     3. THE GATE AND THE RUNNER AGREE. The screen that says "this will need a
        bank connection" and the runner that opens one read the same field. Two
        answers to one question is how this codebase has produced a gate that
        was always shut and a job that passed a gate and then read nothing.
     4. NO TYPED PHRASE STARTS A BANK READ. Every other capability is derived
        from words in the instruction. This one is not, and cannot be.
     5. AN OPTIONAL SOURCE THAT IS ABSENT IS NOT A BROKEN JOB. A missing
        `boost` changes which evidence the answer stands on. Reported as that,
        never as a failure, because telling somebody in a country the
        aggregator does not cover that their working job is broken is worse
        than saying nothing. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'bankevidence.harness.mjs');
writeFileSync(harness, src + `
export { DB, AUTO_USES_ALLOWED, AUTO_USES_FROM_TEXT, AUTO_CAPABILITIES,
         AUTO_USE_TO_CAPABILITY, AUTO_TXN_DAYS,
         _autoUsesFromText, _autoNeedsFor, _autoConnected, _autoAccountContext,
         _bankUse, _bankFlow, _txnMerchant, _subTotals,
         _detectSubscriptions, _detectSubscriptionsFromTxns, _mergeSubscriptionSources };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const TOKEN = 'access-sandbox-THE-LIVE-BANK-CREDENTIAL';
const DAY = 86400000;

/* Dates as the provider sends them: plain YYYY-MM-DD, counted back from today
   so the window the reader asks for always contains them. */
const ago = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
/* Plaid's sign convention, which is the one the detector reads: a POSITIVE
   amount is money out. Getting this backwards would turn every deposit into a
   subscription, which is why it is written once, here. */
const debit = (name, amount, daysAgo, extra) => Object.assign(
  { name, merchant_name: name, amount, date: ago(daysAgo), iso_currency_code: 'USD', pending: false },
  extra || {});
const credit = (name, amount, daysAgo) => debit(name, -Math.abs(amount), daysAgo);

/* ───────────────────────────────────────────────────────────────────────── */
section('A repeated debit is a subscription. Nothing less is.');
{
  const two = W._detectSubscriptionsFromTxns([debit('Netflix', 9.99, 60), debit('Netflix', 9.99, 30)]);
  ok(two.length === 1, 'two matching monthly charges to one merchant make one row', two);
  ok(two[0] && two[0].amount === 9.99, 'at the amount that was actually charged', two[0]);
  ok(two[0] && two[0].cadence === 'monthly', 'with the cadence read off the spacing', two[0]);
  ok(two[0] && two[0].source === 'bank',
     'marked as coming from the bank, so the answer can say which figures are real debits', two[0]);
  ok(two[0] && two[0].charges === 2, 'and carrying how many charges it stands on', two[0]);

  ok(W._detectSubscriptionsFromTxns([debit('Netflix', 9.99, 30)]).length === 0,
     'ONE charge is a purchase, not a subscription', true);

  ok(W._detectSubscriptionsFromTxns([debit('Tesco', 4.99, 60), debit('Tesco', 71.00, 30)]).length === 0,
     'a shop charged twice for different amounts is somebody shopping', true);

  ok(W._detectSubscriptionsFromTxns([debit('Corner Shop', 6.20, 9), debit('Corner Shop', 6.20, 6)]).length === 0,
     'two charges three days apart match no cadence anybody would recognise', true);

  ok(W._detectSubscriptionsFromTxns([credit('Payroll', 2100, 60), credit('Payroll', 2100, 30)]).length === 0,
     'money coming IN is never a subscription, however regular it is', true);

  /* A refund must not erase a charge either: it is a separate row with the
     opposite sign, and the two are not netted before the test. */
  const withRefund = W._detectSubscriptionsFromTxns([
    debit('Spotify', 11.99, 62), debit('Spotify', 11.99, 32), credit('Spotify', 11.99, 31)]);
  ok(withRefund.length === 1 && withRefund[0].charges === 2,
     'a refund alongside two charges leaves the two charges standing', withRefund);
}

section('A pending charge and the posted one that replaces it are one payment');
{
  const rows = W._detectSubscriptionsFromTxns([
    debit('Adobe', 19.99, 60),
    debit('Adobe', 19.99, 30),
    debit('Adobe', 19.99, 30, { pending: true }),
  ]);
  ok(rows.length === 1, 'still one subscription', rows);
  ok(rows[0].charges === 2,
     'counted twice and not three times - evidence that overstates itself is the failure this path exists to avoid',
     rows[0]);
}

section('The statement descriptor is not the merchant');
{
  ok(W._txnMerchant({ name: 'TESCO STORES 4471 LONDON' }) === 'TESCO STORES LONDON',
     'a store number is stripped, so one merchant does not read as several', W._txnMerchant({ name: 'TESCO STORES 4471 LONDON' }));
  ok(W._txnMerchant({ merchant_name: 'Netflix', name: 'NETFLIX.COM 866-579-7172' }) === 'Netflix',
     'and the provider’s clean merchant name wins over the raw descriptor', true);
  ok(W._txnMerchant({ name: '' }) === '', 'an unnamed row names nobody', true);
  const varied = W._detectSubscriptionsFromTxns([
    debit('SPOTIFY POS 1182', 11.99, 60), debit('SPOTIFY POS 9930', 11.99, 30)]);
  ok(varied.length === 1, 'two charges whose reference codes differ are still one subscription', varied);
}

section('Currencies are never folded into one row');
{
  const rows = W._detectSubscriptionsFromTxns([
    debit('Netflix', 9.99, 60), debit('Netflix', 9.99, 30),
    Object.assign(debit('Netflix', 9.99, 61), { iso_currency_code: 'EUR' }),
    Object.assign(debit('Netflix', 9.99, 31), { iso_currency_code: 'EUR' }),
  ]);
  ok(rows.length === 2, 'the same merchant in two currencies is two rows', rows);
  ok(new Set(rows.map(r => r.currency)).size === 2, 'each carrying its own currency', rows.map(r => r.currency));
  const tot = W._subTotals(rows);
  ok(tot.byCurrency.length === 2, 'and the total keeps them apart, because a mixed total is wrong in both', tot);
}

section('Where both exist, the bank wins and the receipt keeps the address');
{
  const mail = [{ merchant: 'Netflix', amount: 12.99, currency: 'USD', cadence: 'monthly',
                  evidence: 'Your Netflix receipt', from: 'billing@netflix.com', deliverable: true },
                { merchant: 'Figma', amount: 15.00, currency: 'USD', cadence: 'monthly',
                  evidence: 'Figma invoice', from: 'invoice@figma.com', deliverable: true }];
  const bank = W._detectSubscriptionsFromTxns([debit('Netflix', 15.99, 60), debit('Netflix', 15.99, 30)]);
  const merged = W._mergeSubscriptionSources(mail, bank);

  const nf = merged.filter(r => r.merchant.toLowerCase() === 'netflix');
  ok(nf.length === 1, 'a merchant in both is ONE row, not two', merged);
  ok(nf[0].amount === 15.99,
     'at the figure that left the account, not the one the receipt announced - this is the quiet price rise the job is named for',
     nf[0]);
  ok(nf[0].source === 'bank', 'marked as a debit', nf[0]);
  ok(nf[0].from === 'billing@netflix.com',
     'and it keeps the cancellation address, which is the one thing a statement has never carried', nf[0]);

  const fg = merged.find(r => r.merchant === 'Figma');
  ok(fg && fg.source === 'mail', 'a merchant only the mail saw survives, marked as a receipt', fg);

  ok(W._mergeSubscriptionSources(mail, []).every(r => r.source === 'mail'),
     'with no bank at all, every row is honestly a receipt', true);
  ok(W._mergeSubscriptionSources([], bank).every(r => r.source === 'bank'),
     'and with no mail at all, every row is honestly a debit', true);
}

section('In and out is AMV’s arithmetic, per currency');
{
  const flow = W._bankFlow([
    debit('A', 10, 3), debit('B', 5.5, 2), credit('Payroll', 100, 1),
    Object.assign(debit('C', 7, 1), { iso_currency_code: 'GBP' }),
    debit('Pending', 999, 1, { pending: true }),
  ]);
  const usd = flow.find(f => f.currency === 'USD');
  ok(usd && usd.out === 15.5, 'debits are totalled', flow);
  ok(usd && usd.in === 100, 'credits are totalled separately, never netted into one figure', flow);
  ok(flow.some(f => f.currency === 'GBP'), 'a second currency gets its own line', flow);
  ok(!flow.some(f => f.out === 999 || f.in === 999), 'a pending row is in no total', flow);
}

/* ───────────────────────────────────────────────────────────────────────── */
/* From here the worker's own machinery is driven, so it needs an env and a
   provider to answer. */
const providerCalls = [];
let providerAccounts = [{ account_id: 'a1', name: 'Everyday', mask: '4471', subtype: 'checking',
                          balances: { current: 812.40, available: 790.00, iso_currency_code: 'USD' } }];
let providerTxns = [debit('Netflix', 15.99, 60), debit('Netflix', 15.99, 30),
                    debit('Tesco Stores 4471', 42.10, 4)];
let providerUp = true;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/plaid|finance/i.test(u)) {
    providerCalls.push({ url: u, body: String((opts && opts.body) || '') });
    if (!providerUp) return { ok: false, status: 502, json: async () => ({ error_message: 'the bank is unreachable' }) };
    if (/\/transactions\/get/.test(u)) return { ok: true, status: 200, json: async () => ({ transactions: providerTxns }) };
    if (/\/accounts\/balance\/get/.test(u)) return { ok: true, status: 200, json: async () => ({ accounts: providerAccounts }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map();
  providerCalls.length = 0; providerUp = true;
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
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
    FINANCE_CLIENT_ID: 'fc', FINANCE_SECRET: 'fs', FINANCE_API_URL: 'https://sandbox.plaid.com',
  }, extra || {});
}
const link = (env) => W.DB.put(env, 'fin', ME, { accessToken: TOKEN, itemId: 'i1', institution: 'A Bank' });

section('The emergency stop reaches the most sensitive account of the set');
{
  const env = mkEnv();
  await link(env);
  await W.DB.put(env, 'auto', ME, { items: [], results: [], paused: true });
  const r = await W._bankUse(env, ME, 'money_leaks', { attended: false });
  ok(r.ok === false && r.code === 'autonomy_paused',
     'paused means the bank is not opened, not that the schedule merely stopped', r);

  /* THE DOOR REFUSING IS NOT THE SAME CLAIM AS THE BANK NOT BEING ASKED.

     Asserting `providerCalls` is empty right here would pass whatever
     `_bankUse` returned, because `_bankUse` never talks to the provider - the
     reader above it does. So the run is driven instead, and THAT is where an
     empty call list means something. A refusal the caller ignores is a refusal
     that does nothing, which is the shape of defect this file is full of. */
  const run = await W._autoAccountContext(env, { id: 'money_morning', uses: ['bank.read'] }, ME, []);
  ok(!providerCalls.length, 'and the run that asked for it reached no provider at all', providerCalls);
  ok(!/812\.40/.test(run.text), 'so no balance was put in front of the model', run.text);
  ok(run.missing.some(m => /paused/.test(m.why)), 'and the run says why, rather than reporting an empty account', run.missing);

  /* Attended is a person sitting in front of it, which the pause is not about. */
  const a = await W._bankUse(env, ME, 'money_leaks', { attended: true });
  ok(a.ok === true, 'an attended call is unaffected - the person is present', a);
}

section('A stop that cannot be read is not a stop');
{
  const env = mkEnv();
  await link(env);
  const realGet = env.AMV_KV.get.bind(env.AMV_KV);
  env.AMV_KV.get = async (k) => { if (String(k).startsWith('auto:')) throw new Error('KV is down'); return realGet(k); };
  const r = await W._bankUse(env, ME, 'money_leaks', { attended: false });
  ok(r.ok === false && r.code === 'autonomy_unknown',
     'unable to tell whether work is paused, it REFUSES - the cost of being wrong this way is a job that waits', r);
  const run = await W._autoAccountContext(env, { id: 'money_morning', uses: ['bank.read'] }, ME, []);
  ok(!providerCalls.length, 'and the run behind it reaches no provider either', providerCalls);
  ok(!/812\.40/.test(run.text), 'no balance reaches the model', run.text);
}

section('No link, no keys, no read');
{
  const noLink = mkEnv();
  const r1 = await W._bankUse(noLink, ME, 'money_leaks', { attended: false });
  ok(r1.ok === false && r1.code === 'not_connected', 'no bank linked is said as that', r1);

  const noKeys = mkEnv({ FINANCE_CLIENT_ID: '', FINANCE_SECRET: '' });
  await link(noKeys);
  const r2 = await W._bankUse(noKeys, ME, 'money_leaks', { attended: false });
  ok(r2.ok === false && r2.code === 'bank_not_configured',
     'and a deployment with no aggregator keys says THAT, rather than telling somebody to reconnect', r2);
}

section('The run reads the real accounts and states only what it read');
{
  const env = mkEnv();
  await link(env);
  const acct = await W._autoAccountContext(env, { id: 'money_morning', uses: ['bank.read'] }, ME, []);
  ok(acct.missing.length === 0, 'nothing is missing', acct.missing);
  ok(/Everyday/.test(acct.text) && /812\.40/.test(acct.text),
     'the balance the institution returned is in front of the model, to the penny', acct.text.slice(0, 300));
  ok(/\.\.\.4471/.test(acct.text), 'with the account it belongs to named', true);
  ok(/read-only/.test(acct.text),
     'and the model is told plainly that AMV cannot move money on this link', true);
  ok(/no credit score/i.test(acct.text),
     'what the link does NOT carry is named too, so a rich block of bank data is not mistaken for a credit report', true);
  ok(providerCalls.some(c => c.body.includes(TOKEN)),
     'the stored credential is what asked the bank', providerCalls.length);

  /* The only two routes this feature may ever touch. A transfer or payment
     endpoint appearing here would be a different product. */
  ok(providerCalls.every(c => /\/accounts\/balance\/get|\/transactions\/get/.test(c.url)),
     'and it called nothing but the two read endpoints', providerCalls.map(c => c.url));

  ok(/Netflix/.test(acct.text), 'the recurring charge is found in the transactions', true);
  ok(/15\.99/.test(acct.text), 'at the amount that actually left the account', true);
  ok(/YOUR STATEMENT/.test(acct.text),
     'and each figure says which kind of evidence it is', true);
}

section('An empty account list is not an empty account');
{
  const env = mkEnv();
  await link(env);
  providerAccounts = [];
  const acct = await W._autoAccountContext(env, { id: 'money_morning', uses: ['bank.read'] }, ME, []);
  ok(/could not be listed/.test(acct.text),
     'said in words, because handed an empty list a model writes whichever of the two reads better', acct.text.slice(0, 400));
  ok(!/balance 0/.test(acct.text), 'and never as a zero balance', true);
  providerAccounts = [{ account_id: 'a1', name: 'Everyday', mask: '4471', subtype: 'checking',
                        balances: { current: 812.40, available: 790.00, iso_currency_code: 'USD' } }];
}

section('A provider that will not answer fails loudly, and never quietly');
{
  const env = mkEnv();
  await link(env);
  providerUp = false;
  const acct = await W._autoAccountContext(env, { id: 'money_morning', uses: ['bank.read'] }, ME, []);
  ok(acct.missing.some(m => m.need === 'bank.read'),
     'a required bank that could not be read is reported as missing, not skipped', acct.missing);
  ok(!/balance/i.test(acct.text), 'and no figure is put in front of the model at all', acct.text);
}

section('An optional source that is absent is a note about the evidence');
{
  const env = mkEnv();
  /* Mail connected, bank not. This is the money leak detector in most of the
     world, and it is a working job. */
  const acct = await W._autoAccountContext(env,
    { id: 'money_leaks', uses: [], boosts: ['bank.read'] }, ME, []);
  ok(acct.missing.length === 0,
     'NOT reported as something the job needs - a boost that leaked into that list would tell somebody a working job is broken',
     acct.missing);
  ok(acct.soft.some(m => m.need === 'bank.read'),
     'it is reported separately, so the answer can say which evidence it stands on', acct.soft);
}

section('A boost that IS connected is read exactly like a requirement');
{
  const env = mkEnv();
  await link(env);
  const acct = await W._autoAccountContext(env,
    { id: 'money_leaks', uses: [], boosts: ['bank.read'] }, ME, []);
  ok(acct.soft.length === 0, 'nothing to note', acct.soft);
  ok(/812\.40/.test(acct.text), 'the bank was opened and read', acct.text.slice(0, 200));
  ok(providerCalls.some(c => c.body.includes(TOKEN)), 'through the same credential', true);

  /* And the pause covers it too. An optional source is not a smaller
     permission. */
  const paused = mkEnv();
  await W.DB.put(paused, 'fin', ME, { accessToken: TOKEN });
  await W.DB.put(paused, 'auto', ME, { items: [], results: [], paused: true });
  const p = await W._autoAccountContext(paused,
    { id: 'money_leaks', uses: [], boosts: ['bank.read'] }, ME, []);
  ok(p.soft.some(m => /paused/.test(m.why)) && !/812\.40/.test(p.text),
     'paused stops an optional bank read as firmly as a required one', p.soft);
}

section('A name in both lists is opened once');
{
  const env = mkEnv();
  await link(env);
  const acct = await W._autoAccountContext(env,
    { id: 'x', uses: ['bank.read'], boosts: ['bank.read'] }, ME, []);
  ok(acct.missing.length === 0 && acct.soft.length === 0, 'it is simply required', { m: acct.missing, s: acct.soft });
  const balanceCalls = providerCalls.filter(c => /\/accounts\/balance\/get/.test(c.url)).length;
  ok(balanceCalls === 1,
     'and the account is opened once, not twice - two audit lines for one run is a lie about what happened',
     balanceCalls);
}

section('The gate and the runner read the same field');
{
  /* The claim this replaces: the screen said a job was ready and the runner
     then found nothing. Both now answer off `uses`, through one table. */
  ok(W.AUTO_USE_TO_CAPABILITY['bank.read'] === 'bank',
     'there is exactly one bridge from a declared use to a gate capability', W.AUTO_USE_TO_CAPABILITY);
  ok(Object.keys(W.AUTO_USE_TO_CAPABILITY).length === 1,
     'and it holds only bank.read - mapping the others would gate an Outlook calendar on a Google account it does not need',
     W.AUTO_USE_TO_CAPABILITY);

  const job = { id: 'a1', detail: 'Report the real balances from the linked accounts.', uses: ['bank.read'] };
  const shut = W._autoNeedsFor(job, { bank: false });
  ok(shut.ready === false && shut.missing.some(m => m.id === 'bank'),
     'a job declaring bank.read with no bank linked is refused BEFORE the run, on the list screen', shut);
  ok(shut.missing.some(m => /never sees your password/.test(String(m.needs))),
     'and the remedy says the one thing everybody asks about this feature', shut.missing);

  const open = W._autoNeedsFor(job, { bank: true });
  ok(open.ready === true, 'with one linked it is ready', open);

  const boosted = W._autoNeedsFor({ id: 'a2', detail: 'Find money leaks.', uses: [], boosts: ['bank.read'] }, { bank: false });
  ok(boosted.ready === true,
     'a job that only WOULD BE BETTER with a bank is never held up for one', boosted);
}

section('"is a bank linked" has one definition');
{
  const env = mkEnv();
  const before = await W._autoConnected(env, ME);
  ok(before.bank === false, 'no record, no bank', before);
  await link(env);
  const after = await W._autoConnected(env, ME);
  ok(after.bank === true, 'the record the runner opens is the record the gate asks', after);

  /* A row with no token in it is not a connection. This is the shape a
     half-finished link leaves behind. */
  await W.DB.put(env, 'fin', ME, { institution: 'A Bank' });
  const partial = await W._autoConnected(env, ME);
  ok(partial.bank === false, 'a row with no access token is not a link', partial);
}

section('No sentence anybody types starts a bank read');
{
  const phrases = ['check my spending each week', 'what am I paying for every month',
                   'look at my bank account', 'find my subscriptions',
                   'summarise my transactions', 'how much money did I spend'];
  for (const p of phrases) {
    ok(W._autoUsesFromText(p).indexOf('bank.read') < 0,
       'nothing is derived from "' + p + '"', W._autoUsesFromText(p));
  }
  ok(!W.AUTO_USES_FROM_TEXT.some(([, use]) => use === 'bank.read'),
     'because no row in the table produces it - the absence is the control, not a gap in the phrases above',
     W.AUTO_USES_FROM_TEXT.map(r => r[1]));

  const cap = W.AUTO_CAPABILITIES.find(c => c.id === 'bank');
  ok(!!cap, 'the gate has a bank capability', true);
  ok(!cap.match.test('bank balance transactions spending money statement'),
     'whose matcher can never fire on text either, so the DECLARATION is the only signal', true);
}

section('Nothing here is a write');
{
  ok(W.AUTO_USES_ALLOWED.indexOf('bank.read') >= 0, 'bank.read is a capability an unattended run may hold', W.AUTO_USES_ALLOWED);
  ok(W.AUTO_USES_ALLOWED.every(u => /\.read$/.test(String(u))),
     'and every entry in that list still ends in .read, so a payment could not be added quietly', W.AUTO_USES_ALLOWED);
  ok(!/\/transfer|\/payment_initiation|\/item\/public_token\/exchange[\s\S]{0,200}_bankPost/.test(src),
     'and _bankPost is not wired to a money-moving endpoint', true);
}

report();
done();
