/* FRAUD MONITOR FAIRNESS - AMVFraud must catch abuse WITHOUT profiling. These
   assertions encode the owner's non-negotiable fairness rules: no protected
   characteristic ever decides an outcome, a refund/chargeback alone never
   auto-punishes, and high-impact calls go to a human. If one goes red, the
   monitor has become unfair. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp();
const { page, errors } = app;

const r = await page.evaluate(() => {
  const F = window.AMVFraud;
  if (!F) return { missing: true };
  return {
    missing: false,
    geoOnly: F.evaluate({ type: 'login', subject: 'a', signals: { geo_mismatch: true } }),
    refundBig: F.evaluate({ type: 'refund', subject: 'b', amount: 9000, signals: { chargeback: true } }),
    refundOnly: F.evaluate({ type: 'refund', subject: 'b2', amount: 20, signals: { refund_request: true } }),
    selfBuy: F.evaluate({ type: 'purchase', subject: 'c', amount: 50, signals: { self_purchase: true }, entities: { transactions: ['t1'] } }),
    ato: F.evaluate({ type: 'payout', subject: 'd', amount: 500, signals: { auth_fail_burst: true, payout_after_selfbuy: true } }),
    cats: F.CATS.length
  };
});

ok(!r.missing, 'AMVFraud is exposed on window');

section('No profiling: a protected-characteristic signal never decides alone');
ok(r.geoOnly.insufficientEvidence === true, 'a region/VPN mismatch ALONE is insufficient evidence', r.geoOnly.risk);
ok(r.geoOnly.action === 'allow', 'region mismatch alone -> allow / monitor only', r.geoOnly.action);
ok(r.geoOnly.signals.length === 0 && r.geoOnly.context.length === 1, 'it is recorded as context, never a scored signal');

section('A refund or chargeback never auto-punishes on its own');
ok(['allow', 'request_verification'].includes(r.refundBig.action), 'a $9000 chargeback alone never exceeds request-verification', r.refundBig.action);
ok(r.refundBig.risk !== 'high' && r.refundBig.risk !== 'critical', 'chargeback-alone risk is capped', r.refundBig.risk);
ok(r.refundOnly.legitimate.some(x => /right|not an admission/i.test(x)), 'the assessment states the refund may be legitimate');

section('Real abuse is still caught, high-impact goes to a human');
ok(r.selfBuy.category === 'wash_trading' && !r.selfBuy.insufficientEvidence, 'self-purchase is flagged as wash trading with enough evidence', r.selfBuy.action);
ok(r.selfBuy.linked.transactions[0] === 't1', 'linked entities are surfaced for review');
ok(r.ato.humanReview === true, 'ATO + payout routes to human review', r.ato.action);
ok(r.cats >= 50, '50+ fraud categories are covered', r.cats);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
