/* THE ONE THING AMV PROPOSES ABOUT HOW IT SHOULD BE GOVERNED.

   Everything else on the autonomy screen waits to be told. This asks - so it
   has to be an OFFER rather than a funnel, and the difference is not a matter
   of tone. Three things make it one:

     - Both answers are real, equal controls. A "yes" styled as the obvious
       choice and a "no" styled as a link is a funnel with good manners.
     - It points BOTH ways. A run of approvals is offered more autonomy; a run
       of refusals is offered a pause. If only the first existed this would be
       a growth nudge wearing the costume of helpfulness, and it would be worth
       more to AMV than to the person.
     - "No" means stop asking, for good.

   The server half is covered by amv-offers-the-rule-you-have-already-written.
   This is about the half a person touches. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' }, tab: 'crew' });
const { page, errors } = app;

const show = (offer) => page.evaluate(([o]) => {
  saveStr('amv_plan', 'pro');
  AMV_API.base = 'https://backend.test'; AMV_API.token = 't';
  window._autoApi = async () => ({ items: [], results: [], offer: o });
  return _autoRefresh().then(() => {
    renderCrewView();
    const el = document.querySelector('.mc-offer');
    if(!el) return { shown: false };
    const btns = [...el.querySelectorAll('.mc-offer-go')];
    return {
      shown: true,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      labels: btns.map(b => (b.textContent || '').trim()),
      sizes: btns.map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
      tags: btns.map(b => b.tagName),
    };
  });
}, [offer]);

const YES = { job: 'j1', kind: 'auto', count: 6, accept: 'Stop asking me', decline: 'Keep asking',
              say: 'You have approved this job 6 times in a row without changing anything.' };
const NO = { job: 'j2', kind: 'pause', count: 4, accept: 'Pause it', decline: 'Keep it running',
             say: 'You have turned down what this job produced 4 times in a row.' };

section('Both answers are real controls of equal weight');
{
  const r = await show(YES);
  ok(r.shown, 'the offer is on the screen');
  ok(r.labels.length === 2, 'with exactly two answers', r.labels);
  ok(r.tags.every(t => t === 'BUTTON'),
     'both are buttons - a "no" rendered as a link is a funnel with good manners', r.tags);
  const [a, b] = r.sizes;
  ok(a.h === b.h && a.h >= 44,
     'the same height, and big enough to hit on a phone', r.sizes);
  ok(Math.abs(a.w - b.w) < Math.max(a.w, b.w),
     'and neither is styled into insignificance beside the other', r.sizes);
}

section('It points the other way too, in the words a person reads');
{
  const r = await show(NO);
  ok(r.shown, 'a run of refusals produces an offer as well');
  ok(/Pause it/.test(r.labels.join(' ')) && /Keep it running/.test(r.labels.join(' ')),
     'to pause the job, not to give it more freedom', r.labels);
  ok(/do not use/i.test(r.text),
     'headed by what is actually happening, not by what AMV would prefer', r.text);
}

section('Nothing is shown when there is nothing to offer');
{
  const r = await show(null);
  ok(r.shown === false, 'no empty card, no placeholder', r);
}

section('Answering sends exactly that answer, once');
{
  for(const [arg, expect] of [['yes', true], ['no', false]]){
    const calls = await page.evaluate(([o, a]) => {
      window._autoApi = async () => ({ items: [], results: [], offer: o });
      return _autoRefresh().then(() => {
        renderCrewView();
        const sent = [];
        window.toast = () => {};
        window._autoApi = async (path, body) => { sent.push({ path, body }); return { ok: true, applied: null }; };
        return mcOfferAnswer(a).then(() => sent);
      });
    }, [YES, arg]);
    const offerCalls = calls.filter(c => c.body && c.body.action === 'offer');
    ok(offerCalls.length === 1, 'one answer sent for "' + arg + '"', offerCalls.length);
    ok(offerCalls[0].path === '/auto/update', 'to the route the worker answers', offerCalls[0].path);
    ok(offerCalls[0].body.job === 'j1' && offerCalls[0].body.accept === expect,
       'naming the job and what they said', offerCalls[0].body);
  }
}

section('A second press cannot answer twice');
{
  const n = await page.evaluate(([o]) => {
    window._autoApi = async () => ({ items: [], results: [], offer: o });
    return _autoRefresh().then(() => {
      renderCrewView();
      let sent = 0;
      window.toast = () => {};
      window._autoApi = async (p, b) => { if(b && b.action === 'offer') sent++; return { ok: true, applied: 'auto' }; };
      return Promise.all([mcOfferAnswer('yes'), mcOfferAnswer('yes')]).then(() => sent);
    });
  }, [YES]);
  ok(n === 1, 'a double press answers once - the card is cleared before the request goes', n);
}

section('A failed answer says so, and does not pretend it was recorded');
{
  const msgs = await page.evaluate(([o]) => {
    window._autoApi = async () => ({ items: [], results: [], offer: o });
    return _autoRefresh().then(() => {
      renderCrewView();
      const out = [];
      window.toast = (m, k) => out.push({ m: String(m), kind: k });
      window._autoApi = async (p, b) => {
        if(b && b.action === 'offer') throw new Error('network down');
        return { items: [], results: [], offer: o };
      };
      return mcOfferAnswer('yes').then(() => out);
    });
  }, [YES]);
  ok(msgs.some(m => m.kind === 'error' && /did NOT go through/i.test(m.m)),
     'it says the answer did not land', msgs);
  ok(msgs.some(m => /nothing has changed/i.test(m.m)), 'and that the job is untouched', msgs);
  ok(msgs.some(m => /offered again/i.test(m.m)),
     'and that they will be asked again - an offer that vanished unrecorded is one they never get back',
     msgs);
}

section('It fits a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await show(YES);
  const m = await page.evaluate(() => {
    const el = document.querySelector('.mc-offer');
    const btns = [...el.querySelectorAll('.mc-offer-go')];
    return { heights: btns.map(b => Math.round(b.getBoundingClientRect().height)),
             inside: Math.round(el.getBoundingClientRect().right) <= window.innerWidth,
             overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(m.heights.every(h => h >= 44), 'both answers clear 44px', m.heights);
  ok(m.inside && !m.overflowX, 'and nothing is pushed off the side', m);
}

ok(errors.length === 0, 'and none of it threw', errors);
report(); done(app);
