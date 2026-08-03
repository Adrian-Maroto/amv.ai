/* THE MARKETPLACE SCREENS THAT TALK ABOUT MONEY.

   Three reads sat behind `catch(e){ return [] }` or, worse,
   `catch(e){ return {balance:0} }`. So a request that simply failed was
   rendered as a fact about the account:

     - a seller with money in their balance was shown $0 owed to them,
       indistinguishable from having earned nothing;
     - somebody who had paid for things was shown "No purchases yet";
     - a seller was shown "No listings yet. Create one above." and invited to
       publish a duplicate of a listing that already exists.

   None of those failures were visible as failures. A wrong number on a payout
   screen is worse than no screen, so each one now says it could not read, says
   nothing has changed, and offers to try again. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'S', email: 's@x.com', ini: 'S' } });
const { page, errors } = app;

/* Put the client in "backend connected" mode and make every market request
   fail the way a flaky connection does. */
const withDeadServer = (fn) => page.evaluate(async (body) => {
  const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
  AMV_API.base = 'https://api.test'; AMV_API.token = 't';
  AMV_API._fetch = async () => { throw new Error('network down'); };
  let out;
  try { out = await (new Function('return (' + body + ')')())(); }
  finally { AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch; }
  return out;
}, fn.toString());

section('A balance that could not be read is not a balance of zero');
{
  const r = await withDeadServer(async () => {
    let threw = null, value = null;
    try { value = await AMVMarket.earnings(); } catch (e) { threw = e.message || 'error'; }
    return { threw, value };
  });
  ok(r.threw !== null, 'the read fails instead of answering', r.threw);
  ok(r.value === null, 'and never hands back a fabricated figure', r.value);
}

section('The earnings screen says so, rather than showing $0.00');
{
  const r = await withDeadServer(async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    _mktEarnings(box);
    await new Promise(r2 => setTimeout(r2, 250));
    const text = box.textContent || '';
    box.remove();
    return { text, hasZero: /\$0\.00/.test(text), retry: /try again/i.test(text) };
  });
  ok(!r.hasZero, 'no zero balance is drawn from a failed read', r.text.slice(0, 120));
  ok(/could not load/i.test(r.text), 'it says it could not load them', r.text.slice(0, 120));
  ok(/whatever it was|has changed/i.test(r.text),
     'and that nothing about the account has changed', r.text.slice(0, 160));
  ok(r.retry, 'with a way to try again', r.retry);
}

section('Purchases somebody paid for are never reported as none');
{
  const r = await withDeadServer(async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    _mktPurchases(box);
    await new Promise(r2 => setTimeout(r2, 250));
    const text = box.textContent || '';
    box.remove();
    return { text };
  });
  ok(!/No purchases yet/i.test(r.text),
     '"No purchases yet" is not the answer to a failed request', r.text.slice(0, 120));
  ok(/could not load/i.test(r.text), 'the failure is stated as a failure', r.text.slice(0, 120));
  ok(/still yours/i.test(r.text), 'and what they own is confirmed to be intact', r.text.slice(0, 160));
}

section('And a working server still renders the real numbers');
{
  /* A fix that makes the failure honest but breaks the success path is not a
     fix, so the ordinary case is asserted too. */
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API._fetch = async () => ({ ok: true, json: async () => ({
      ok: true, balance: 42.5, lifetime: 108, sellerPct: 80, minWithdraw: 10,
      tx: [{ type: 'sale', amount: 12.5, title: 'A thing', ts: Date.now() }] }) });
    const box = document.createElement('div');
    document.body.appendChild(box);
    _mktEarnings(box);
    await new Promise(r2 => setTimeout(r2, 250));
    const text = box.textContent || '';
    box.remove();
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    return { text };
  });
  ok(/\$42\.50/.test(r.text), 'the real balance is shown', r.text.slice(0, 100));
  ok(/\$108\.00/.test(r.text), 'and lifetime earnings', r.text.slice(0, 100));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('market-honesty') > 0) process.exitCode = 1;
done();
