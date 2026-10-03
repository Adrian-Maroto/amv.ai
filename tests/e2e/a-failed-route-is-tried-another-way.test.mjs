/* A FAILED ROUTE IS TRIED ANOTHER WAY - AND THEN AMV SAYS WHAT IT CAN DO.

   Asked for: "try to actually run the background task and if it can't even
   after like 50 attempts then give suggestions on how to do it and what AMV can
   do related to what they asked. So like: instead AMV can xyz and you do this
   in one step and it's done."

   Fifty identical attempts would be fifty identical failures and fifty
   charges, and a send retried is a send delivered twice. What is built, and
   pinned here, is the version that actually helps:
   - a READ that hits a network blip is tried three times;
   - a SEND is tried exactly once;
   - a step that fails for a real reason gets a different route - up to three
     plans, each told what the last one tripped on;
   - never a new route once something has been sent;
   - and when every route failed, the alternatives closest to the ask, each
     with what is left for the person and a Do this that runs it.
   The engine is replaced at its seam (aiComplete) so what is asserted is
   exactly what AMV asks for and does with the answer. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'crew' });
const { page, errors } = app;

await page.evaluate(() => {
  window._aiBackendReady = () => true;
  window.__asked = [];
  /* Each call answers with the next reply in the queue, and records what it
     was asked so the test can see the failure was passed along. */
  window.__replies = [];
  window.aiComplete = async (msg, sys) => { window.__asked.push({ msg, sys }); return window.__replies.shift() || '[]'; };
  const C = window.AMVConnectors;
  window.__calls = { blip: 0, send: 0, broken: 0, other: 0, send2: 0 };
  C.register({ id: 'tst', name: 'Test service', auth: 'none', actions: {
    blip:   { desc: 'A read that drops twice', run: async () => { if (++window.__calls.blip < 3) throw new Error('fetch failed'); return { ok: 1 }; } },
    send:   { desc: 'Send a message', risk: 'high', run: async () => { window.__calls.send++; throw new Error('fetch failed'); } },
    broken: { desc: 'Always refuses', run: async () => { window.__calls.broken++; throw new Error('the service rejected the request'); } },
    other:  { desc: 'A different route that works', run: async () => { window.__calls.other++; return { ok: 2 }; } },
    send2:  { desc: 'Send, which works', risk: 'high', run: async () => { window.__calls.send2++; return { sent: 1 }; } },
  } });
});
const box = async () => page.evaluate(() => {
  let m = document.getElementById('uni-live');
  if (!m) { m = document.createElement('div'); m.id = 'uni-live'; document.body.appendChild(m); }
  m.innerHTML = '';
});
const plan = (steps) => JSON.stringify(steps);

section('A read that drops is tried again; a send is not');
{
  const r = await page.evaluate(async () => {
    const U = AMVUniversal;
    const a = U.resolve([{ title: 'Read', tool: 'tst.blip', args: {} }], { autonomous: true });
    const ra = await U.execute(a, { autonomous: true, approved: true, retryMs: 10 });
    const b = U.resolve([{ title: 'Send', tool: 'tst.send', args: {}, needs_approval: true }], { autonomous: true });
    const rb = await U.execute(b, { autonomous: true, approved: true, retryMs: 10 });
    return { read: ra[0].status, readCalls: window.__calls.blip, send: rb[0].status, sendCalls: window.__calls.send };
  });
  ok(r.read === 'done' && r.readCalls === 3, 'the read failed twice on the network and the third try worked', r);
  ok(r.send === 'error' && r.sendCalls === 1, 'the send was tried once - a second try could be a second message', r);
}

section('A step that fails for a real reason gets a different route');
{
  await box();
  const r = await page.evaluate(async (plans) => {
    window.__asked = []; window.__replies = plans.slice();
    const out = await uniRun('look up the opening hours of the town hall', { autonomous: true, approved: true, retryMs: 10 });
    return { approaches: out.approaches, gaveUp: out.gaveUp, broken: window.__calls.broken, other: window.__calls.other,
             second: (window.__asked[1] || {}).msg || '', html: document.getElementById('uni-live').innerHTML };
  }, [plan([{ title: 'Ask the town hall API', tool: 'tst.broken', args: {} }]),
      plan([{ title: 'Read it from the web', tool: 'tst.other', args: {} }])]);
  ok(r.approaches === 2 && !r.gaveUp && r.other === 1, 'the first route failed and the second one did it', r);
  ok(r.broken === 1, 'a failure with a real reason is not retried blindly - once', r.broken);
  ok(/EARLIER ATTEMPTS THAT FAILED/.test(r.second) && /the service rejected the request/.test(r.second),
     'and the second plan was told exactly what the first one tripped on', r.second.slice(-300));
  ok(/Approach 1 stopped at/.test(r.html), 'the person can see the first approach and why it stopped', null);
}

section('When every route fails: three tries, then what AMV can do instead');
{
  await box();
  const r = await page.evaluate(async (plans) => {
    window.__asked = []; window.__calls.broken = 0; window.__replies = plans.slice();
    const out = await uniRun('get my council tax rebate', { autonomous: true, approved: true, retryMs: 10 });
    const live = document.getElementById('uni-live');
    return { approaches: out.approaches, gaveUp: out.gaveUp, broken: window.__calls.broken, asked: window.__asked.length,
             cards: [...live.querySelectorAll('.uni-alt')].map(c => ({ t: c.querySelector('.uni-alt-t').textContent,
               you: (c.querySelector('.uni-alt-you') || {}).textContent || '', go: !!c.querySelector('[data-dact="uniDoInstead"]') })),
             text: live.textContent.replace(/\s+/g, ' ') };
  }, [plan([{ title: 'Route one', tool: 'tst.broken', args: {} }]),
      plan([{ title: 'Route two', tool: 'tst.broken', args: {} }]),
      plan([{ title: 'Route three', tool: 'tst.broken', args: {} }]),
      JSON.stringify([{ amv: 'Find the council tax rebate form for my council and fill in everything I have given you', you: 'sign it and post it' },
                      { amv: 'Write the letter asking my council for the rebate', you: 'press Send' }])]);
  ok(r.approaches === 3 && r.gaveUp && r.broken === 3, 'three different routes, each tried', r);
  ok(r.asked === 4, 'and exactly four calls to the engine - three plans and one for the alternatives, not fifty', r.asked);
  ok(/tried 3 different ways/.test(r.text), 'it says how hard it tried', r.text.slice(0, 200));
  ok(r.cards.length === 2 && r.cards.every(c => c.go), 'then the alternatives, each with Do this', r.cards);
  ok(/Then you: sign it and post it/.test(r.cards[0].you), 'each saying the one thing left for you', r.cards[0]);
}

section('Do this runs the alternative');
{
  const r = await page.evaluate(async () => {
    const real = window.mcRunCommand; let ran = null;
    window.mcRunCommand = (t, o) => { ran = { t, o }; };
    document.querySelector('#uni-live [data-dact="uniDoInstead"]').click();
    window.mcRunCommand = real;
    return ran;
  });
  ok(r && /council tax rebate form/.test(r.t) && r.o && r.o.clarified, 'pressing it runs that instruction as the request', r);
}

section('Never a second route once something was sent');
{
  await box();
  const r = await page.evaluate(async (plans) => {
    window.__asked = []; window.__calls.send2 = 0; window.__calls.broken = 0; window.__replies = plans.slice();
    const out = await uniRun('email the landlord then update the tracker', { autonomous: true, approved: true, retryMs: 10 });
    return { approaches: out.approaches, sent: out.sent, sends: window.__calls.send2, asked: window.__asked.length,
             text: document.getElementById('uni-live').textContent.replace(/\s+/g, ' '),
             cards: document.querySelectorAll('#uni-live .uni-alt').length };
  }, [plan([{ title: 'Email the landlord', tool: 'tst.send2', args: {}, needs_approval: true },
            { title: 'Update the tracker', tool: 'tst.broken', args: {} }])]);
  ok(r.sends === 1 && r.approaches === 1 && r.asked === 1, 'the email went once, and no new route was planned', r);
  ok(/Something was already sent/.test(r.text) && r.cards === 0, 'and it says why it stopped there, offering nothing that could send it again', r.text.slice(-220));
}

section('The request can be in any language');
{
  const sys = await page.evaluate(async () => { window.__asked = []; window.__replies = ['[]']; await AMVUniversal.plan('renueva mi NIE'); return (window.__asked[0] || {}).sys || ''; });
  ok(/any language/.test(sys), 'the planner is told to read it as written', sys.slice(-200));
}

ok(errors.length === 0, 'and nothing threw', errors.slice(0, 3));
await app.close();
if (report('a-failed-route-is-tried-another-way') > 0) process.exitCode = 1;
done();
