/* SPENDING CONTROLS - the tiered model: small purchases flow, larger ones take
   one tap, hard caps can never be crossed. These limits are what keep the
   payment processing alive (unauthorised charges return as chargebacks
   whatever the terms say), so they must actually bind. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

/* Spending also passes the compliance gate (terms accepted + adult), so these
   tests establish that first and then exercise the LIMIT behaviour. The gate
   itself is covered in compliance.test.mjs, including that a minor is refused
   even with limits wide open. */
const setup = (cfg) => page.evaluate((c) => {
  const S2 = window.AMVSpend, C = window.AMVCompliance;
  try { store('amv_consent', {}); C.accept(); C.setBirthYear(new Date().getFullYear() - 30); } catch (e) {}
  const d = new Date();
  const month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  S2.save(Object.assign(S2.cfg(), c, { month, spent: c.spent || 0 }));
  return S2.cfg();
}, cfg);

section('Spending is OFF until the user turns it on');
await setup({ enabled: false });
const off = await page.evaluate(() => window.AMVSpend.check(10));
ok(off.allow === false, 'nothing can be spent while it is switched off', off.reason);

section('Small purchases flow with no interruption');
await setup({ enabled: true, autoUnder: 50, perPurchase: 250, monthlyCap: 500, spent: 0 });
const small = await page.evaluate(() => window.AMVSpend.check(19.99));
ok(small.allow === true && small.needsApproval === false, 'under the auto-buy limit it just buys', small.reason);

section('Larger purchases take one tap');
const medium = await page.evaluate(() => window.AMVSpend.check(120));
ok(medium.allow === true && medium.needsApproval === true, 'above the auto-buy limit it asks once', medium.reason);
ok(/auto-buy limit/i.test(medium.reason), 'and explains why in plain language', medium.reason);

section('Hard caps cannot be crossed');
const over = await page.evaluate(() => window.AMVSpend.check(400));
ok(over.allow === false, 'a purchase over the single-purchase limit is refused outright', over.reason);
await setup({ enabled: true, autoUnder: 50, perPurchase: 250, monthlyCap: 500, spent: 460 });
const capped = await page.evaluate(() => window.AMVSpend.check(100));
ok(capped.allow === false && /monthly cap/i.test(capped.reason), 'the monthly cap blocks it once nearly spent', capped.reason);
const fits = await page.evaluate(() => window.AMVSpend.check(30));
ok(fits.allow === true, 'but what still fits inside the cap is allowed', fits.reason);

// REGRESSION: a blank or malformed month must not zero the spent total -
// clearing one field would otherwise reset the monthly cap.
section('A corrupted month field cannot reset the monthly budget');
const wipe = await page.evaluate(() => {
  const S2 = window.AMVSpend;
  S2.save(Object.assign(S2.cfg(), { enabled: true, monthlyCap: 500, spent: 460, month: '' }));
  const afterBlank = S2.spentThisMonth();
  S2.save(Object.assign(S2.cfg(), { spent: 460, month: 'garbage' }));
  const afterJunk = S2.spentThisMonth();
  S2.save(Object.assign(S2.cfg(), { spent: 460, month: '1999-01' }));
  const afterRealRollover = S2.spentThisMonth();
  return { afterBlank, afterJunk, afterRealRollover };
});
ok(wipe.afterBlank === 460, 'a blank month keeps the spent total', wipe.afterBlank);
ok(wipe.afterJunk === 460, 'a malformed month keeps the spent total', wipe.afterJunk);
ok(wipe.afterRealRollover === 0, 'but a genuine new month does reset it', wipe.afterRealRollover);

section('Garbage amounts are refused, never guessed');
const junk = await page.evaluate(() => ({
  nan: window.AMVSpend.check('abc'), zero: window.AMVSpend.check(0),
  neg: window.AMVSpend.check(-50), none: window.AMVSpend.check()
}));
['nan', 'zero', 'neg', 'none'].forEach(k => ok(junk[k].allow === false, `an invalid amount (${k}) never authorises a spend`, junk[k].reason));

section('Every purchase is recorded and counts against the cap');
await setup({ enabled: true, autoUnder: 50, perPurchase: 250, monthlyCap: 500, spent: 0 });
const rec = await page.evaluate(() => {
  const S2 = window.AMVSpend;
  S2.record(25.5, { item: 'Headphones', merchant: 'Shop', approved: false, rule: 'auto-under' });
  S2.record(80, { item: 'Chair', merchant: 'Shop2', approved: true, rule: 'approved' });
  return { spent: S2.spentThisMonth(), remaining: S2.remaining(), history: S2.history(5) };
});
ok(rec.spent === 105.5, 'spending is totalled accurately', rec.spent);
ok(rec.remaining === 394.5, 'and the remaining budget is correct', rec.remaining);
ok(rec.history.length === 2 && rec.history[0].item === 'Chair', 'every purchase is logged with what it was', rec.history[0]);
ok(rec.history[0].approved === true && rec.history[1].approved === false,
  'the log records whether each purchase was approved or auto - the authorisation record', rec.history.map(h => h.approved));

section('Terms are present and honest');
const terms = await page.evaluate(() => window.AMVSpend.TERMS);
ok(/responsible for purchases made within them/i.test(terms), 'the user is told they are responsible within their own limits');
ok(/anyone using your account or device/i.test(terms), 'and that it covers others using their account');
ok(/does not guarantee price, availability, delivery/i.test(terms), 'and that outcomes are not guaranteed', terms.slice(0, 60));

section('Chat can read limits but has no raw "pay" action');
const actions = await page.evaluate(() => window.AMVConnectors.catalog().filter(a => a.connector === 'spend').map(a => a.action));
ok(actions.includes('limits') && actions.includes('can_i_spend'), 'limits are readable from chat', actions);
ok(!actions.some(a => /^(pay|buy|purchase|charge|transfer)$/i.test(a)),
  'there is no direct pay action - money only moves through the gated browser agent', actions);

/* REGRESSION (found in audit): the browser agent can complete a checkout, so
   routing a purchase through it must not bypass the spend limits or the age
   gate. Before this fix, browser.do went straight to the network. */
section('The browser agent cannot be used to bypass the money gates');
const viaAgent = await page.evaluate(async () => {
  const C = window.AMVConnectors, Cm = window.AMVCompliance, Sp = window.AMVSpend;
  const mo = () => new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  const out = {};
  // a minor, with generous limits, tries to buy through the agent
  store('amv_consent', {}); Cm.accept(); Cm.setBirthYear(new Date().getFullYear() - 16);
  Sp.save(Object.assign(Sp.cfg(), { enabled: true, autoUnder: 100, perPurchase: 500, monthlyCap: 1000, month: mo(), spent: 0 }));
  try { await C.run('browser.do', { url: 'https://shop.test/x', goal: 'buy the shoes', spendAmount: 20 }); out.minor = 'ALLOWED'; }
  catch (e) { out.minor = e.code; }
  // an adult, but above the per-purchase limit
  store('amv_consent', {}); Cm.accept(); Cm.setBirthYear(new Date().getFullYear() - 30);
  try { await C.run('browser.do', { url: 'https://shop.test/x', goal: 'buy it', spendAmount: 9999 }); out.over = 'ALLOWED'; }
  catch (e) { out.over = e.code; }
  // an adult, in the approval tier, without approval
  try { await C.run('browser.do', { url: 'https://shop.test/x', goal: 'buy it', spendAmount: 300 }); out.appr = 'ALLOWED'; }
  catch (e) { out.appr = e.code; }
  // ordinary browsing must NOT be gated as a purchase
  try { await C.run('browser.do', { url: 'https://x.test/', goal: 'read the page' }); out.browse = 'ALLOWED'; }
  catch (e) { out.browse = e.code; }
  return out;
});
ok(viaAgent.minor === 'not_permitted', 'a minor cannot buy through the browser agent', viaAgent.minor);
ok(viaAgent.over === 'over_limit', 'an over-limit purchase is refused through the agent', viaAgent.over);
ok(viaAgent.appr === 'needs_approval', 'the approval tier still applies through the agent', viaAgent.appr);
ok(viaAgent.browse === 'needs_service', 'ordinary browsing is NOT treated as a purchase', viaAgent.browse);

section('A limit that cannot be read is a closed door, not an open one');
{
  /* `amt > +c.perPurchase` is FALSE when perPurchase is undefined, empty or a
     leftover string. A config damaged by a half-finished write or an older
     shape therefore passed every ceiling AND came back needsApproval:false -
     the one combination that must never happen, since it spends without even
     stopping to ask. */
  const r = await page.evaluate(() => {
    const S2 = window.AMVSpend, out = {};
    const base = { enabled: true, month: S2._month(), spent: 0 };
    S2.save(Object.assign(S2.cfg(), base, { autoUnder: undefined, perPurchase: undefined, monthlyCap: undefined }));
    out.missing = S2.check(9999);
    S2.save(Object.assign(S2.cfg(), base, { autoUnder: 'abc', perPurchase: 'abc', monthlyCap: 'abc' }));
    out.text = S2.check(9999);
    S2.save(Object.assign(S2.cfg(), base, { autoUnder: -1, perPurchase: -1, monthlyCap: -1 }));
    out.negative = S2.check(50);
    return out;
  });
  ok(r.missing.allow === false, 'a missing limit refuses instead of permitting', r.missing.reason);
  ok(r.missing.needsApproval !== true || r.missing.allow === false,
     'and never lands on allowed-without-asking', r.missing);
  ok(r.text.allow === false, 'so does an unreadable one', r.text.reason);
  ok(r.negative.allow === false, 'and a negative one', r.negative.reason);
}

section('Contradictory limits are reconciled the same way the server does');
{
  /* Otherwise the screen shows one ceiling and the account enforces another,
     and the number somebody trusted is not the number that binds. */
  const r = await page.evaluate(() => {
    const S2 = window.AMVSpend;
    S2.save(Object.assign(S2.cfg(), { enabled: true, month: S2._month(), spent: 0,
      autoUnder: 900, perPurchase: 400, monthlyCap: 100 }));
    return { at120: S2.check(120), at80: S2.check(80) };
  });
  ok(r.at120.allow === false, 'a purchase over the monthly ceiling is refused even though perPurchase allows it', r.at120.reason);
  ok(r.at80.allow === true, 'while one inside every limit goes through', r.at80.reason);
  /* The number in the sentence is the one that binds. Quoting the $900 that was
     typed would tell somebody they have headroom that does not exist. */
  ok(/\$100\.00/.test(r.at80.reason) && !/\$900/.test(r.at80.reason),
     'and the limit it names is the one that really applies, not the one that was typed', r.at80.reason);
}

section('Limits are saved where they cannot be edited');
{
  /* They lived only in localStorage, which is the copy the person being
     protected can rewrite. The screen now writes to the account and shows back
     whatever the account stored. */
  const r = await page.evaluate(async () => {
    const S2 = window.AMVSpend, sent = [];
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API._fetch = async (path, opts) => {
      sent.push({ path, body: JSON.parse((opts && opts.body) || '{}') });
      // The account pulls the monthly ceiling down to its own maximum.
      return { ok: true, json: async () => ({ ok: true, limits: { enabled: true, autoUnder: 10, perPurchase: 60, monthlyCap: 60 } }) };
    };
    const res = await S2.push({ autoUnder: 10, perPurchase: 60, monthlyCap: 90000, enabled: true });
    const after = S2.cfg();
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    return { sent, res, after: { cap: after.monthlyCap, per: after.perPurchase, on: after.enabled } };
  });
  ok(r.sent.length === 1 && r.sent[0].path === '/v1/spend/set',
     'saving reaches the account rather than only this browser', r.sent[0] && r.sent[0].path);
  ok(r.sent[0].body.limits.enabled === true,
     'and carries the on/off switch, so the account knows spending is permitted at all', r.sent[0].body.limits);
  ok(r.after.cap === 60,
     'what the account stored is what the browser then holds, even when it is lower than what was asked for', r.after.cap);
}

section('With no backend, it says so rather than implying a ceiling');
{
  const r = await page.evaluate(() => {
    const realBase = AMV_API.base; AMV_API.base = '';
    const backed = window.AMVSpend.serverBacked();
    AMV_API.base = realBase;
    return backed;
  });
  ok(r === false, 'unconnected is reported as unconnected, not as protected', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
