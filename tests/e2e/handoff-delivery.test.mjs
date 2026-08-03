/* A HANDOFF THAT NEVER LEFT THE DEVICE.

   Handoff's premise is that you pass the work itself rather than describe it.
   The one thing it must never do, then, is tell you the baton was passed when
   nobody has it.

   It did exactly that. hoSend fired the server call and forgot it
   (`.catch(()=>{})`), then said "Handoff sent to <person>" unconditionally -
   and with no backend connected it never even tried, because cross-user
   delivery needs the server. The record sat in Sent marked "waiting", which
   reads as "waiting on them" for something that was still sitting here.

   Worse, the next sync replaced the Sent list wholesale with the server's copy.
   An undelivered handoff is not in that copy, so it was deleted - taking the
   pasted work with it, leaving nothing to retry and no sign anything was lost. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'handoff', user: { name: 'S', email: 's@x.com', ini: 'S' } });
const { page, errors } = app;

const fill = (to) => page.evaluate((t) => {
  store('amv_handoffs_out', []);
  renderHandoffView();
  document.getElementById('ho-title').value = 'Finish the Q3 intro';
  document.getElementById('ho-ctx').value = 'The draft, pasted in full.';
  document.getElementById('ho-to').value = t;
}, to);

section('With no backend, it does not claim anything was sent');
{
  await fill('mate@x.com');
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast; window.toast = (m) => said.push(String(m));
    AMV_API.base = '';                     // nothing to deliver through
    await hoSend();
    window.toast = realToast;
    const out = load('amv_handoffs_out') || [];
    return { said, status: (out[0] || {}).status, ctx: (out[0] || {}).context,
             screen: document.getElementById('vc').textContent || '' };
  });
  /* Matched on the AFFIRMATIVE claim only - "Nothing was sent to mate@x.com"
     contains "sent to" and is exactly the sentence we want. */
  ok(!r.said.some(m => /^Handoff sent to/i.test(m)),
     'it never says the handoff was sent', r.said);
  ok(r.said.some(m => /not delivered|nothing was sent/i.test(m)),
     'it says plainly that nothing was delivered', r.said);
  ok(r.status === 'not_sent', 'and the record is marked as undelivered', r.status);
  ok(/pasted in full/.test(r.ctx || ''), 'while the work itself is kept, not lost', !!r.ctx);
  ok(!/Waiting on them/.test(r.screen),
     '"Waiting on them" is not shown for something still sitting here', r.screen.slice(0, 200));
  ok(/Send again/.test(r.screen), 'with a way to send it once connected', true);
}

section('With a backend that refuses, the failure is the answer');
{
  await fill('mate@x.com');
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast; window.toast = (m) => said.push(String(m));
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API._fetch = async () => { throw new Error('network down'); };
    await hoSend();
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    window.toast = realToast;
    const out = load('amv_handoffs_out') || [];
    return { said, status: (out[0] || {}).status };
  });
  ok(r.status === 'failed', 'the record says it failed', r.status);
  ok(r.said.some(m => /NOT delivered/i.test(m)), 'and so does the message', r.said);
  ok(!r.said.some(m => /^Handoff sent/i.test(m)), 'nothing claims success', r.said);
}

section('When it really is delivered, it says so');
{
  await fill('mate@x.com');
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast; window.toast = (m) => said.push(String(m));
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    let hit = null;
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API._fetch = async (path, opts) => { hit = { path, body: JSON.parse((opts && opts.body) || '{}') };
      return { ok: true, json: async () => ({ ok: true, id: 'h1' }) }; };
    await hoSend();
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    window.toast = realToast;
    const out = load('amv_handoffs_out') || [];
    return { said, status: (out[0] || {}).status, hit };
  });
  ok(r.hit && /handoff/i.test(r.hit.path || ''), 'the server is actually called', r.hit && r.hit.path);
  ok(/pasted in full/.test(((r.hit || {}).body || {}).context || ''),
     'carrying the work, not just the title', !!r.hit);
  ok(r.status === 'waiting', 'the record now genuinely waits on them', r.status);
  ok(r.said.some(m => /sent to mate@x\.com/i.test(m)), 'and the sender is told', r.said);
}

section('A sync does not quietly delete what was never delivered');
{
  const r = await page.evaluate(async () => {
    store('amv_handoffs_out', [
      { id: 'local1', to: 'mate@x.com', title: 'Never left', context: 'the work', status: 'failed' },
      { id: 'srv1', to: 'other@x.com', title: 'Delivered', status: 'waiting' },
    ]);
    const realBase = AMV_API.base, realTok = AMV_API.token;
    const realList = AMV_API.listHandoff;
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    // The server only knows about the one that arrived.
    AMV_API.listHandoff = async () => ({ incoming: [],
      sent: [{ id: 'srv1', to_email: 'other@x.com', title: 'Delivered', status: 'waiting' }] });
    await _handoffSyncLive();
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API.listHandoff = realList;
    const out = load('amv_handoffs_out') || [];
    return { ids: out.map(h => h.id), kept: (out.find(h => h.id === 'local1') || {}).context };
  });
  ok(r.ids.includes('local1'), 'the undelivered one survives the sync', r.ids);
  ok(r.kept === 'the work', 'with the work still attached, so it can be retried', r.kept);
  ok(r.ids.includes('srv1'), 'and the delivered one is still there too', r.ids);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('handoff-delivery') > 0) process.exitCode = 1;
done();
