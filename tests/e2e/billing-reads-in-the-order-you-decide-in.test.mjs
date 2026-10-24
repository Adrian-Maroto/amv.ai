/* BILLING, IN THE ORDER SOMEBODY DECIDES IN.

   Asked for by name, three times, and the last time with a reference screen:
   what I am on, what I have been charged, what I could move to, how I pay.
   What was there put the record of somebody's money below the door marked
   Cancel, and never said what the plan they were paying for actually does.

   The two capability columns are the part that sells: a price with no
   capabilities beside it asks somebody to go and look up what they are buying.
   Both halves come out of `_planPitch`, the same source the pricing cards and
   the upgrade page render from - a hand-written list here would be a second
   description of the product and the two would drift the first time a plan
   changed.

   AND NOTHING IS INVENTED. This page once generated one row per month between
   the start date and today, each stamped Paid, with no invoice number and no
   amount from a processor - a-billing-screen-that-invented-its-own-invoices is
   that fault written down. Renaming the section to "Recent transactions" must
   not bring it back, so this asserts the empty state is still an honest
   sentence rather than a table. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({});
const { page, errors } = app;

const show = (plan) => page.evaluate(async (plan) => {
  _setPlan(plan);
  setTab('billing');
  await new Promise(r => setTimeout(r, 420));
  const vc = document.getElementById('vc');
  return {
    headings: [...vc.querySelectorAll('h2,h3')].map(e => e.textContent.trim()),
    text: (vc.innerText || ''),
    change: ((vc.querySelector('.bill-change') || {}).textContent || '').trim(),
    hash: location.hash,
  };
}, plan);

section('The sections, in the order every billing screen people know uses');
{
  /* Plan (with the way to change it beside it), then how you pay, then what
     you have been charged, then leaving. */
  const r = await show('pro');
  const want = ['Payment', 'Invoices', 'Cancellation'];
  const idx = want.map(h => r.headings.indexOf(h));
  ok(idx.every(i => i >= 0), 'all three sections are on the page', r.headings);
  ok(idx[0] < idx[1] && idx[1] < idx[2], 'payment, then invoices, then cancellation', r.headings);
  ok(r.headings[0] === 'Billing', 'under one heading', r.headings[0]);
  ok(r.change === 'Change plan', 'and the plan carries its own Change plan control', r.change);

  const free = await show('free');
  ok(free.change === 'Upgrade plan', 'on Free it is the way up instead', free.change);
  ok(!free.headings.includes('Cancellation'), 'and there is nothing to cancel', free.headings);
  ok(/25 messages every 5 hours/.test(free.text) && !/messages a month/.test(free.text), 'Free still says what it allows - the window that binds, not an unreachable month', free.text.slice(0, 200));
}

section('Change plan opens the plans, where each plan says what it includes');
{
  const r = await page.evaluate(async () => {
    _setPlan('free'); setTab('billing');
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('.bill-change').click();
    await new Promise(r => setTimeout(r, 400));
    const card = k => document.querySelector('#vc .pl2-card[data-plan="' + k + '"]');
    return { tab: S.tab,
             pro: (card('pro') || {}).innerText || '',
             lead: (document.querySelector('#vc .pl2-card.lead') || {}).dataset,
             text: document.getElementById('vc').innerText,
             misses: document.querySelectorAll('#vc .pl2-card .fxx').length };
  });
  ok(r.tab === 'plans', 'it opens the plans', r.tab);
  ok(/AMV Forge/.test(r.pro), 'and Pro says what it includes, from the same list everywhere else sells from', r.pro.slice(0, 160));
  ok(r.misses === 0, 'a card lists what a plan has - what it lacks is in the comparison', r.misses);
  ok(r.lead && r.lead.plan === 'pro', 'the one that leads is the NEXT step up, not the dearest', r.lead);
  ok(!/Most popular|Best value/i.test(r.text), 'with no invented social proof', r.text.slice(0, 200));
}

section('Nothing on it is invented');
{
  const r = await show('pro');
  ok(!/\$15\.00\s*·\s*Paid/i.test(r.text), 'no fabricated paid row', r.text.slice(0, 200));
  ok(/payment processor/i.test(r.text),
     'the empty state says where invoices come from instead', r.text.slice(0, 400));
}

section('Billing has an address of its own');
{
  const r = await show('pro');
  ok(r.hash === '#/billing', 'the address bar says where you are', r.hash);
  const back = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(r => setTimeout(r, 200));
    const cleared = location.hash;
    history.replaceState(null, '', location.pathname + '#/billing');
    return { cleared, readsBack: _tabFromURL() };
  });
  ok(back.cleared === '', 'and stops saying it when you leave', back);
  ok(back.readsBack === 'billing', 'a link to it resolves back to billing', back);
}

/* READING THE ADDRESS IS HALF THE FEATURE. LANDING ON IT IS THE HALF THAT
   SOMEBODY EXPERIENCES.

   The section above proves `_tabFromURL` parses and that `setTab` writes - two
   claims about functions, neither of which needs a browser to have booted. The
   thing a person does is paste the link and press enter, and that path runs
   through boot, which is where it broke: the first goApp() is called at the top
   level of 12-handoff while modules 13 and up are still evaluating, so honouring
   the address there rendered a screen whose renderer read a binding that did not
   exist yet. It threw ReferenceError and the app did not come up at all.

   `#/crew` is in here beside `#/billing` deliberately: crew is the renderer that
   reaches forward into a later module, so it is the one that fails if the
   address is ever honoured too early again. A suite that only tried billing
   would have stayed green through the outage. */
section('An address pasted into the bar boots onto that screen');
{
  const base = page.url().split('#')[0];
  /* about:blank first, and it is not decoration. Navigating from `/` to
     `/#/billing` differs only in the fragment, so the browser treats it as a
     SAME-DOCUMENT navigation: the script never re-runs and what gets measured
     is the page that was already open. That is how the first version of this
     read S.tab as 'chat' and looked like a broken feature - the only thing
     broken was the test. Leaving the origin forces a real load, which is the
     thing being claimed: somebody pasting a link gets a fresh document. */
  const land = async (hash) => {
    await page.goto('about:blank');
    await page.goto(base + hash, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    return page.evaluate(() => ({ tab: S.tab, whole: window._BUNDLE_READY === true }));
  };

  const b = await land('#/billing');
  ok(b.tab === 'billing', 'a link to #/billing opens Billing, not the last tab used', b);

  /* ON A PAID PLAN, and that is the whole of why this reproduces. Crew returns
     the catalogue early for anybody who cannot run it, which stops short of the
     line that reads the later module - so a free account walks the URL through
     Crew and lands safely, and the version of this test that did not set a plan
     went green against the exact fault it was written for. */
  await page.evaluate(() => { _setPlan('pro'); });
  const c = await land('#/crew');
  ok(c.tab === 'crew', 'and #/crew opens Crew', c);
  ok(c.whole === true, 'with the whole bundle evaluated, which is what makes it safe', c);

  const n = await land('');
  ok(n.tab === 'chat', 'and no address still lands where it always did', n);
}

section('A bare /billing works where the host serves it, and is not faked where it does not');
{
  /* THE HALF THAT IS NOT THIS REPOSITORY'S TO CONFIGURE.

     `/billing` needs the host to serve index.html for every path. Nothing here
     can read that setting - but the page can observe its CONSEQUENCE: if this
     script is running and the address is `/billing`, the host just served
     index.html for `/billing`, which is the whole question. A rewrite that
     exists proves itself by the app being here to ask.

     So the path form is never WRITTEN until it has been seen working. Writing
     it first is the trap setTab's own comment describes - an address that works
     until somebody refreshes is worse than no address - and on a host with no
     rewrite every shared link would 404. This asserts both halves: paths when
     the host serves them, hashes when it has not shown that it does. */
  const base = page.url().split('#')[0].replace(/\/$/, '');

  const land = async (where) => {
    await page.goto('about:blank');
    await page.goto(base + where, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    return page.evaluate(async () => {
      const first = { tab: S.tab, path: location.pathname, hash: location.hash,
                      pathRouting: typeof window._pathRoutingOn === 'function' && window._pathRoutingOn() };
      /* And where it puts the address when you move somewhere else. */
      setTab('plans');
      await new Promise(r => setTimeout(r, 250));
      return { ...first, thenPath: location.pathname, thenHash: location.hash };
    });
  };

  const byPath = await land('/billing');
  ok(byPath.tab === 'billing', 'arriving at /billing opens Billing', byPath);
  ok(byPath.pathRouting === true,
     'and the host serving it is taken as proof that it can serve the others', byPath);
  ok(byPath.thenPath === '/plans' && byPath.thenHash === '',
     'so moving on writes a real path, not a hash bolted onto one', byPath);

  const byRoot = await land('/');
  ok(byRoot.tab === 'chat', 'arriving at the root lands where it always did', byRoot);
  ok(byRoot.pathRouting === false,
     'and nothing has been proved about paths, so nothing is assumed', byRoot);
  ok(byRoot.thenHash === '#/plans' && byRoot.thenPath === '/',
     'moving on writes the hash, which needs nothing from the host', byRoot);

  /* The hash keeps working even on a host that does rewrite - old links people
     have already sent must not stop resolving because the host improved. */
  await page.goto('about:blank');
  await page.goto(base + '/#/billing', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const hashStill = await page.evaluate(() => ({ tab: S.tab }));
  ok(hashStill.tab === 'billing', 'a link in the old hash form still opens Billing', hashStill);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
