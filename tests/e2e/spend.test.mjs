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

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
