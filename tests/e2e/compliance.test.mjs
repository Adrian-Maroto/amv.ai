/* COMPLIANCE - the two protections that decide whether the business gets sued
   or loses money: a real consent record, and an age gate on anything involving
   money. A minor's purchase comes straight back as a chargeback, so the age
   gate protects revenue as much as it protects the child. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

const reset = () => page.evaluate(() => { try { store('amv_consent', {}); } catch (e) {} });

section('Consent is versioned, timestamped and re-prompted on change');
await reset();
const c1 = await page.evaluate(() => {
  const C = window.AMVCompliance;
  const before = C.accepted();
  C.accept();
  const after = C.consentRecord();
  return { before, after, version: C.TERMS_VERSION };
});
ok(c1.before === false, 'nothing is assumed accepted by default');
ok(c1.after.current === true && c1.after.version === c1.version, 'acceptance is recorded against a version', c1.after);
ok(typeof c1.after.at === 'number' && c1.after.at > 0, 'and timestamped - the artifact a dispute needs', c1.after.at);

const stale = await page.evaluate(() => {
  const C = window.AMVCompliance;
  const r = load('amv_consent'); r.termsVersion = 'old-version'; store('amv_consent', r);
  return C.accepted();
});
ok(stale === false, 'an OLD accepted version does not count - a material change re-prompts', stale);

section('Under 13 is refused, and no data is kept for them (COPPA)');
await reset();
const child = await page.evaluate(() => {
  const C = window.AMVCompliance;
  const y = new Date().getFullYear() - 9;
  try { C.setBirthYear(y); return { accepted: true }; }
  catch (e) {
    const rec = load('amv_consent');
    return { accepted: false, code: e.code, msg: e.message, storedYear: rec.birthYear, blocked: !!rec.blockedUnderAge };
  }
});
ok(child.accepted === false && child.code === 'under_age', 'a 9-year-old is refused', child.msg);
ok(child.storedYear === undefined, 'and NO birth data is stored for them', child.storedYear);
ok(child.blocked === true, 'the refusal itself is recorded so the block persists');

section('Teens can use AMV, but not the money features');
await reset();
const teen = await page.evaluate(() => {
  const C = window.AMVCompliance;
  C.accept();
  const r = C.setBirthYear(new Date().getFullYear() - 16);
  return { age: r.age, adult: r.adult,
    chat: C.gate('chat'), spend: C.gate('spend'), bank: C.gate('bank'), payout: C.gate('payout') };
});
ok(teen.age === 16 && teen.adult === false, 'a 16-year-old is allowed in', teen);
ok(teen.chat === null, 'and can use ordinary features', teen.chat);
ok(typeof teen.spend === 'string' && /18 and over/.test(teen.spend), 'but NOT autonomous spending', teen.spend);
ok(typeof teen.bank === 'string' && typeof teen.payout === 'string', 'nor bank access or payouts', [teen.bank, teen.payout]);

section('The age gate cannot be bypassed by calling the spend layer directly');
const bypass = await page.evaluate(() => {
  // a minor, terms accepted, spending fully enabled with generous limits
  const C = window.AMVCompliance, Sp = window.AMVSpend;
  C.accept(); C.setBirthYear(new Date().getFullYear() - 16);
  Sp.save(Object.assign(Sp.cfg(), { enabled: true, autoUnder: 100, perPurchase: 500, monthlyCap: 1000,
    month: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'), spent: 0 }));
  return Sp.check(5);   // a trivial amount, well inside every limit
});
ok(bypass.allow === false, 'even a $5 purchase is refused for a minor', bypass.reason);
ok(/18 and over/.test(bypass.reason || ''), 'and the reason is the age gate, not the limits', bypass.reason);

section('Adults get full access once age and terms are set');
const adult = await page.evaluate(() => {
  const C = window.AMVCompliance, Sp = window.AMVSpend;
  store('amv_consent', {}); C.accept(); C.setBirthYear(new Date().getFullYear() - 30);
  return { adult: C.isAdult(), spend: C.gate('spend'), check: Sp.check(5) };
});
ok(adult.adult === true && adult.spend === null, 'an adult passes the gate', adult.spend);
ok(adult.check.allow === true, 'and can spend within their own limits', adult.check.reason);

section('Unknown age is treated as NOT verified, never as adult');
const unknown = await page.evaluate(() => {
  const C = window.AMVCompliance;
  store('amv_consent', {}); C.accept();
  return { known: C.ageKnown(), adult: C.isAdult(), spend: C.gate('spend') };
});
ok(unknown.known === false && unknown.adult === false, 'no age on file means not an adult (deny by default)');
ok(/Confirm your age/.test(unknown.spend || ''), 'and money features ask for age first', unknown.spend);

section('Nothing risky runs before the terms are accepted');
const noTerms = await page.evaluate(() => {
  store('amv_consent', {});
  return { spend: window.AMVCompliance.gate('spend'), chat: window.AMVCompliance.gate('chat') };
});
ok(/accept the terms/i.test(noTerms.spend || ''), 'money is gated on accepting terms', noTerms.spend);
ok(/accept the terms/i.test(noTerms.chat || ''), 'and so is everything else until accepted', noTerms.chat);

section('The consent record is stored server-side too, not just in the browser');
const clientSrc = await page.evaluate(() => String(window.AMVCompliance.accept));
ok(/v1\/consent/.test(clientSrc), 'acceptance is posted to the server - a browser-only record proves nothing');

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
