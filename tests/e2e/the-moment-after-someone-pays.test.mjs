/* THE PLAN CAME BACK AND THE CLIENT LOOKED IN THE WRONG POCKET.

   `/v1/entitlement` answers `{ok, entitlement:{plan,...}, billing, bonusTokens,
   referralEarned}`. Two functions on the post-payment path read `ent.plan` off
   the whole RESPONSE - always undefined - so their conditions were never true.

   `_checkPayReturn` is what runs when somebody comes back from the checkout.
   Its "trust the SERVER's entitlement" branch never fired, so it fell to the
   "payment not yet confirmed" branch instead: no welcome, no card recorded, no
   billing screen refresh, at the one moment a customer is looking for proof
   their money did something. And `_verifyEntitlement`, whose comment says it
   exists to prevent faked unlocks, has never once run its check.

   Nothing reported it because `syncEntitlement` elsewhere reads
   `d.entitlement.plan` correctly and corrects the plan on the next load. The
   defect was invisible in the end state and total in the moment. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';

/* The real shape, copied from getEntitlement. Built here and passed IN to
   each evaluate - a helper defined in Node is not in the page's scope, and
   referencing it there throws rather than failing an assertion. */
const RESPONSE = (plan, billing) => ({
  ok: true,
  entitlement: { plan, sold: plan, updatedAt: Date.now() },
  billing: billing || null,
  bonusTokens: 0,
  referralEarned: 0,
});

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@x.com', ini: 'A' } });
try {
  await app.connect();
  await app.stubFetch(async (u) => {
    if (u.includes('/v1/entitlement')) {
      window.__entCalls = (window.__entCalls || 0) + 1;
      return { ok: true, json: async () => window.__ent };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });

  section('The response really does keep the plan one level down');
  /* Stated as an assertion so the fix cannot be "read .plan again" if the
     server shape is ever misremembered. */
  {
    const r = await app.page.evaluate(async () => {
      window.__ent = { ok: true, entitlement: { plan: 'pro' }, billing: null };
      const d = await AMV_API.entitlement('ada@x.com');
      return { top: d.plan, nested: d.entitlement && d.entitlement.plan };
    });
    ok(r.top === undefined, 'there is no plan on the response itself', r.top);
    ok(r.nested === 'pro', 'it is on `entitlement`', r.nested);
  }

  section('Verifying against the server moves the plan');
  {
    const r = await app.page.evaluate(async (ent) => {
      saveStr('amv_plan', 'free');
      window.__ent = ent;
      await _verifyEntitlement();
      return loadStr('amv_plan');
    }, RESPONSE('pro'));
    ok(r === 'pro', 'the account is on the plan the server says it is on', r);
  }

  section('And it corrects a plan the browser is claiming falsely');
  /* The stated purpose of the function: "prevents faked unlocks". Somebody who
     sets amv_plan in the console must be put back. */
  {
    const r = await app.page.evaluate(async (ent) => {
      saveStr('amv_plan', 'ultra');
      window.__ent = ent;
      await _verifyEntitlement();
      return loadStr('amv_plan');
    }, RESPONSE('free'));
    ok(r === 'free', 'a browser-claimed plan is taken back down', r);
  }

  section('A failed renewal reaches the person who can fix it');
  /* The server sends `billing` for exactly one reason and it was being
     dropped along with the plan. */
  {
    const r = await app.page.evaluate(async (ent) => {
      window.__shown = null;
      const real = window._showBillingNotice;
      window._showBillingNotice = (b) => { window.__shown = b; };
      saveStr('amv_plan', 'free');
      window.__ent = ent;
      try { await _verifyEntitlement(); } finally { window._showBillingNotice = real; }
      return window.__shown;
    }, RESPONSE('pro', { state: 'past_due', graceEndsAt: Date.now() + 86400000 }));
    ok(r && r.state === 'past_due', 'the past-due state is handed to the notice', r);
  }

  section('Nothing is written for a field the server does not send');
  {
    const r = await app.page.evaluate(async (ent) => {
      saveStr('amv_plan', 'free');
      window.__ent = ent;
      await _verifyEntitlement();
      return loadStr('amv_ent_token');
    }, RESPONSE('pro'));
    ok(!r, 'amv_ent_token is not written from an undefined token', JSON.stringify(r));
  }

  section('A response the server never sends changes nothing');
  /* The old code would have accepted a bare {plan:'ultra'} - which is the
     shape an attacker controlling a proxy would find easiest to forge, and
     the shape the real server never produces. */
  {
    const r = await app.page.evaluate(async () => {
      saveStr('amv_plan', 'free');
      window.__ent = { ok: true, plan: 'ultra' };
      await _verifyEntitlement();
      return loadStr('amv_plan');
    });
    ok(r === 'free', 'a plan asserted at the top level is not honoured', r);
  }

  section('An unreachable server leaves the plan alone');
  {
    const r = await app.page.evaluate(async () => {
      saveStr('amv_plan', 'pro');
      window.__ent = { error: 'unauthorized' };
      await _verifyEntitlement();
      return loadStr('amv_plan');
    });
    ok(r === 'pro', 'no answer is not an answer of free', r);
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
