/* THE SCREEN THAT DECIDES HOW MUCH MONEY AMV MAY SPEND FOR YOU.

   Everything behind it was already built and correct: the limits are held on
   the account, the monthly ceiling is counted through the atomic counter, the
   record kind is on the erasure roster and in the backup prefixes, and every
   number is re-checked on the server before a purchase.

   What was wrong was where it lived. It was appended to the bottom of Plan &
   usage - measured, the heading began 1798px down a 3698px pane. Two different
   questions were sharing one screen: Plan & usage is what YOU pay AMV,
   Spending is what AMV may spend FOR you. The second is the one people go
   looking for when they are worried, and something you go looking for needs a
   name in the list.

   This suite is about reachability and about not leaving a duplicate behind. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings' });
const { page, errors } = app;
await page.evaluate(() => {
  S.user = { name: 'Owner', email: 'owner@amv.test', ini: 'O', provider: 'email' };
  store('amv_user', S.user);
});

section('It is in the list, by name');
{
  const v = await page.evaluate(async () => {
    renderSetPane();
    await new Promise(r => setTimeout(r, 400));
    const items = [...document.querySelectorAll('[data-sp]')].map(b => ({
      sp: b.dataset.sp, text: b.textContent.trim(),
      h: b.getBoundingClientRect().height,
      /* Measured with the harness comparator, in the page where it lives. */
      bigEnough: !__under(b.getBoundingClientRect().height, 40),
    }));
    const sp = items.find(i => i.sp === 'spending');
    return { items: items.map(i => i.sp), sp, count: items.length };
  });
  ok(!!v.sp, 'Spending has an entry in the settings list', v.items);
  /* Guarded, so a missing entry fails these by name rather than throwing an
     exception on the line above and taking the rest of the section with it. */
  ok(!!v.sp && v.sp.text === 'Spending',
     'called Spending, which is what somebody would look for', v.sp && v.sp.text);
  ok(!!v.sp && v.sp.bigEnough,
     'and it is big enough to hit on a phone', v.sp && v.sp.h);
  /* Next to Plan & usage, not at the far end. The two are the same subject
     from opposite directions and reading them together is the point. */
  ok(v.items.indexOf('spending') === v.items.indexOf('billing') + 1,
     'sitting directly after Plan & usage', v.items.join(','));
}

section('Pressing it opens the real screen, not a placeholder');
{
  const v = await page.evaluate(async () => {
    document.querySelector('[data-sp="spending"]').click();
    await new Promise(r => setTimeout(r, 600));
    const pane = document.getElementById('set-pane');
    const t = pane.innerText;
    return {
      pane: S.settingsPane,
      title: (pane.querySelector('.set-title') || {}).textContent,
      /* The owner's own copy, which is what this screen has to say. Matched
         case-insensitively: the section headings are uppercased by CSS, and a
         case-sensitive probe reported this text missing when it was there. */
      whatThisIs: /what this is/i.test(t),
      offUntilOn: /it is off until you turn it on/i.test(t),
      neverRecurring: /never a subscription, never anything recurring/i.test(t),
      neverMoves: /does not move money between your accounts/i.test(t),
      hardStops: /hard stops, checked before every purchase/i.test(t),
      writtenDown: /every purchase appears below/i.test(t),
      purchases: /AMV has not bought anything for you/i.test(t),
      responsibility: /Your responsibility/i.test(t),
      /* And it starts at the top of the pane now, rather than halfway down
         somebody else's. */
      topOfPane: (() => {
        const h = pane.querySelector('.set-title');
        return h ? Math.round(h.getBoundingClientRect().top - pane.getBoundingClientRect().top) : null;
      })(),
    };
  });
  ok(v.pane === 'spending', 'the pane actually changes', v.pane);
  ok(v.title === 'Spending', 'and is titled Spending', v.title);
  ok(v.whatThisIs, 'it explains what this is before what it is set to');
  ok(v.offUntilOn, 'and says plainly that it is off until you turn it on');
  ok(v.neverRecurring, 'what it buys - and never a subscription');
  ok(v.neverMoves, 'what it never does - it does not move money between accounts');
  ok(v.hardStops, 'why the limits matter - hard stops checked before every purchase');
  ok(v.writtenDown, 'and that everything is written down');
  ok(v.purchases, 'the purchases list is there, with an honest empty state');
  ok(v.responsibility, 'and the responsibility text');
  ok(v.topOfPane !== null && v.topOfPane < 200,
     'it begins at the top of its own pane, not 1798px down another one', v.topOfPane);
}

section('Money it cannot spend yet says so, rather than pretending');
{
  /* The gate is real and it is FIRST: with the terms unaccepted the three
     limit fields are not rendered at all, so there is nothing to set and
     nothing implying a ceiling is being held. That is the honest shape - the
     alternative is editable numbers that do not apply yet. */
  const v = await page.evaluate(() => {
    const t = document.getElementById('set-pane').innerText;
    const gate = document.querySelector('.mf-gate');
    return {
      gate: !!gate,
      gateText: gate ? gate.innerText : '',
      fields: ['mf-auto', 'mf-per', 'mf-cap'].filter(id => !!document.getElementById(id)).length,
      accepted: typeof AMVCompliance !== 'undefined' ? AMVCompliance.accepted() : null,
    };
  });
  ok(v.accepted === false, 'a fresh account has not accepted the money terms', v.accepted);
  ok(v.gate, 'so the screen leads with what has to happen first');
  ok(/Before AMV can spend anything/i.test(v.gateText),
     'in the owner’s words', v.gateText.slice(0, 60));
  ok(v.fields === 0,
     'and no limit field is offered, because none of them would apply yet', v.fields);
}

section('Accepting reveals the controls, and they are the real ones');
{
  const v = await page.evaluate(async () => {
    document.getElementById('mf-accept-terms').click();
    await new Promise(r => setTimeout(r, 500));
    const g = (id) => document.getElementById(id);
    return {
      accepted: AMVCompliance.accepted(),
      /* Age is asked next, or the fields appear - either is correct, and
         which one depends on whether the account already knows an age. What
         must NOT happen is limit fields with the gate still standing. */
      gate: !!document.querySelector('.mf-gate'),
      fields: ['mf-auto', 'mf-per', 'mf-cap'].filter(id => !!g(id)).length,
      toggle: !!g('mf-enabled'),
    };
  });
  ok(v.accepted === true, 'accepting is recorded', v.accepted);
  ok((v.gate && v.fields === 0) || (!v.gate && v.fields === 3),
     'either the next gate stands with no fields, or every field is there with no gate',
     { gate: v.gate, fields: v.fields });
}

section('And it is not left behind on Plan & usage as a second copy');
{
  /* The same three limit fields on two screens is how somebody edits the
     wrong one and cannot find it again. */
  const v = await page.evaluate(async () => {
    S.settingsPane = 'billing';
    renderSetPane();
    await new Promise(r => setTimeout(r, 700));
    return {
      merged: !!document.getElementById('set-sec-spending'),
      caps: document.querySelectorAll('#mf-cap').length,
      /* Usage IS still merged into billing, deliberately - it is the same
         question as the plan. This checks the removal was surgical. */
      usageStillThere: !!document.getElementById('set-sec-usage'),
    };
  });
  ok(v.merged === false, 'the merged copy is gone from Plan & usage', v.merged);
  ok(v.caps === 0, 'so the monthly ceiling field exists in exactly one place', v.caps);
  ok(v.usageStillThere, 'while usage is still part of the plan screen, which it should be');
}

section('It works on a phone');
{
  /* Actually at phone width. The first version of this section asserted at the
     default desktop viewport and was named for a phone, which is the kind of
     probe that reports a pass about a screen nobody looked at. */
  await page.setViewportSize({ width: 390, height: 844 });
  const v = await page.evaluate(async () => {
    S.settingsPane = 'spending';
    renderSetPane();
    await new Promise(r => setTimeout(r, 500));
    const pane = document.getElementById('set-pane');
    return {
      /* Nothing pushes the page sideways, which is the phone failure this
         product keeps finding. */
      overflows: pane.scrollWidth > pane.clientWidth + 2,
      readable: pane.innerText.length > 400,
      /* The settings list itself: on a phone it may collapse, but it must not
         vanish with no way back to it. */
      navHidden: (() => {
        const n = document.querySelector('[data-sp]');
        if (!n) return true;
        const cs = getComputedStyle(n);
        return cs.display === 'none' || cs.visibility === 'hidden';
      })(),
    };
  });
  ok(!v.overflows, 'nothing overflows sideways at phone width', v.overflows);
  ok(v.readable, 'and the copy is all there', v.readable);
  ok(!v.navHidden, 'and the way back to the other settings is still on screen', v.navHidden);
  await page.setViewportSize({ width: 1280, height: 900 });
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

report('spending section');
done();
