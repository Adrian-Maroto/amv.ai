/* THE OTHER SECTIONS, REACHED THE SAME WAY.

   Memory, the approvals queue, and what the account has actually used. Same
   discipline as the Crew tools - each goes through what the section itself
   uses, ambiguity is refused rather than guessed, and a failure comes back as
   an instruction to say so.

   Two of these are more dangerous than they look, and most of this file is
   about those two.

   A MEMORY IS REPLAYED INTO EVERY FUTURE REQUEST. That makes writing one the
   same shape of act as editing a system prompt, and it makes it the worst place
   in the product to put a password - which is exactly where somebody will try
   to put one, because "remember my wifi password" is a completely natural
   sentence. It has to be refused, not stored.

   APPROVING IS WHAT SENDS. The queue exists because something stopped short of
   acting. So approving must ask first, and - the part that was a real shipped
   bug once - it must never report "sent" when there was no way to send. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));
outbound.on(/model\.example/, () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 5 } }));
const emailed = [];
outbound.on(/resend|sendgrid|postmark|mailgun|api\.mail/i, (u) => { emailed.push(u); return { ok: true, id: 'e1' }; });

const vals = new Map();
const env = makeEnv({
  APP_URL: 'http://localhost:9187',
  AMV_MODEL_KEY: 'k',
  MODEL_API_URL: 'https://model.example',
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body);
      const cur = vals.get(n) || 0;
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
      return new Response(JSON.stringify({ allowed: true, value: cur }));
    } }),
  },
});

const L = await bootLive({ env, outbound, port: 9187 });
const { page } = L;
const EMAIL = 'sections@example.com';
const PW = 'A-real-Passw0rd!';
const KV = env.AMV_KV;
const run = (name, input) => page.evaluate(([n, i]) => window._sectionTool(n, i), [name, input || {}]);

section('A signed-in account');
{
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await new Promise(x => setTimeout(x, 350));
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Sections'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await new Promise(x => setTimeout(x, 1100));
  }, [EMAIL, PW]);
  await KV.put('ent:' + EMAIL, JSON.stringify({ plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  await page.evaluate(async () => { try { await syncEntitlement(); } catch (e) {} await new Promise(x => setTimeout(x, 400)); });
  ok(await page.evaluate(() => !!(S.user && S.user.email)), 'signed in', true);
}

section('Remembering something in chat puts it in the Memory tab');
{
  const before = await page.evaluate(() => (S.memory || []).length);
  const out = await run('memory_add', { text: 'I am studying for A-level chemistry and want worked examples, not just answers.' });
  ok(/remembered/i.test(out.text), 'the tool says it stored it', out.text.slice(0, 90));

  const mem = await page.evaluate(() => (S.memory || []).map(m => m.text));
  ok(mem.length === before + 1, 'it is really in memory', mem.length);
  ok(/A-level chemistry/.test(mem[0]), 'with the words they said', mem[0]);

  /* And on the screen, not only in a variable - a fact chat keeps to itself is
     a second memory store that will disagree with the first. */
  const shown = await page.evaluate(async () => {
    setTab('memory');
    await new Promise(x => setTimeout(x, 700));
    return (document.getElementById('vc').textContent || '').replace(/\s+/g, ' ').trim();
  });
  ok(/A-level chemistry/.test(shown), 'and visible in the Memory tab', shown.slice(0, 160));
}

section('It will not remember a secret');
{
  /* The sentence somebody will absolutely say. Every memory is replayed into
     every future request, which makes this store the single worst place in the
     product for a credential - and the person asking has not thought about
     that, so refusing and explaining is the whole job. */
  const n0 = await page.evaluate(() => (S.memory || []).length);
  const cases = [
    'Remember my banking password is hunter2plus',
    'my api key is sk-live-abcdefghijklmnop',
    'my card number is 4242 4242 4242 4242',
    'my social security number is 123-45-6789',
  ];
  const outs = [];
  for (const c of cases) outs.push(await run('memory_add', { text: c }));
  ok(outs.every(o => /refused/i.test(o.text)), 'each one is refused', outs.map(o => o.text.slice(0, 40)));
  ok(outs.every(o => /every future conversation|will not store/i.test(o.text)),
     'with the reason, so the model can explain rather than just decline', outs[0].text.slice(0, 160));
  const n1 = await page.evaluate(() => (S.memory || []).length);
  ok(n1 === n0, 'and nothing was stored', { before: n0, after: n1 });
}

section('And it will not remember the same thing twice');
{
  const before = await page.evaluate(() => (S.memory || []).length);
  const out = await run('memory_add', { text: 'I am studying for A-level chemistry and want worked examples, not just answers.' });
  ok(/already remembers/i.test(out.text), 'a duplicate is recognised', out.text.slice(0, 80));
  ok((await page.evaluate(() => (S.memory || []).length)) === before, 'and not stored again', before);
}

section('Forgetting the wrong thing is refused rather than guessed');
{
  await run('memory_add', { text: 'My chemistry teacher is Mr Ahmed.' });
  await run('memory_add', { text: 'My chemistry exam is in June.' });
  const before = await page.evaluate(() => (S.memory || []).length);

  const out = await run('memory_forget', { match: 'chemistry' });
  ok(/not clear which|matches \d/i.test(out.text), 'an ambiguous match names the candidates', out.text.slice(0, 150));
  ok(/ask the user/i.test(out.text), 'and asks', true);
  ok((await page.evaluate(() => (S.memory || []).length)) === before, 'nothing was removed', before);

  const bad = await run('memory_forget', { id: 'm_not_real' });
  ok(/no memory with that id/i.test(bad.text), 'and an invented id is refused', bad.text.slice(0, 90));
  ok((await page.evaluate(() => (S.memory || []).length)) === before, 'still nothing removed', before);
}

section('Forgetting the right thing really forgets it');
{
  const id = await page.evaluate(() => (S.memory.find(m => /Mr Ahmed/.test(m.text)) || {}).id);
  const out = await run('memory_forget', { id });
  ok(/forgotten/i.test(out.text), 'it says so', out.text.slice(0, 80));
  const left = await page.evaluate(() => (S.memory || []).map(m => m.text));
  ok(!left.some(t => /Mr Ahmed/.test(t)), 'and it is gone', left.length);
}

section('What is waiting for approval can be read in chat');
{
  /* Put a real item in the real queue, through the cron, so this is the same
     record the Crew screen reads rather than a fixture shaped like one. */
  await KV.put('auto:' + EMAIL, JSON.stringify({ items: [{
    id: 'j1', detail: 'Draft my weekly client update', active: true, next: Date.now() - 60000,
    interval: 86400000, kind: 'task', approval: 'require', notify: 'email' }], results: [] }));
  const pend = [];
  await L.worker.scheduled({ cron: '*/5 * * * *' }, env,
    { waitUntil: p => pend.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} });
  await Promise.all(pend);

  const out = await run('approvals_list');
  ok(/weekly client update/i.test(out.text), 'the waiting item is listed', out.text.slice(0, 160));
  ok(/APPROVING THIS SENDS IT/i.test(out.text),
     'and the model is told, in the listing, that approving sends it', true);
  ok(/nothing here has been sent/i.test(out.text), 'and that nothing has gone out yet', true);
}

section('Approving without a way to send says so instead of claiming it sent');
{
  /* The failure this whole path was rebuilt around once: the screen said
     "Sent" and nothing was ever sent. Saying "approved but undelivered" is the
     only honest answer when the deployment has no email provider. */
  const id = await page.evaluate(async () => {
    const list = await window._sectionTool('approvals_list', {});
    return (String(list.text).match(/\[([a-z0-9]+)\]/) || [])[1];
  });
  ok(!!id, 'there is a real item to act on', id);

  const out = await run('approval_act', { id, action: 'approve' });
  ok(/could NOT be delivered/i.test(out.text), 'it says it was not delivered', out.text.slice(0, 140));
  ok(/do not say it was sent/i.test(out.text), 'and tells the model not to claim otherwise', true);
  ok(emailed.length === 0, 'because nothing was emailed', emailed.length);
}

section('Rejecting discards it');
{
  await KV.put('approvals:' + EMAIL, JSON.stringify({ items: [{
    id: 'ap_reject', title: 'Something they do not want', actionType: 'send', preview: 'x' }] }));
  const out = await run('approval_act', { id: 'ap_reject', action: 'reject' });
  ok(/rejected/i.test(out.text) && /will not be sent/i.test(out.text), 'it says so plainly', out.text.slice(0, 90));
  const left = JSON.parse(await KV.get('approvals:' + EMAIL) || '{}').items || [];
  ok(!left.some(a => a.id === 'ap_reject'), 'and it is gone from the queue', left.length);
}

section('Account status is read, never estimated');
{
  const out = await run('account_status');
  ok(/Plan: ultra/i.test(out.text), 'the real plan', out.text.slice(0, 80));
  ok(/Background jobs: \d/.test(out.text), 'the real number of background jobs', out.text.slice(0, 200));
  ok(/Spent on background work/i.test(out.text), 'and what they have actually cost', true);
  ok(/never estimate/i.test(out.text), 'with an instruction not to invent any of it', true);
  ok(!/undefined|NaN|\[object/.test(out.text), 'and nothing leaking through', out.text.slice(0, 200));
}

section('Every one of these asks first where it should');
{
  /* Reading is free. Writing something replayed into every future request,
     destroying something of theirs, or sending, all ask. */
  const gate = await page.evaluate(() => ({
    memory_list: _toolNeedsConsent('memory_list'),
    approvals_list: _toolNeedsConsent('approvals_list'),
    account_status: _toolNeedsConsent('account_status'),
    memory_add: _toolNeedsConsent('memory_add'),
    memory_forget: _toolNeedsConsent('memory_forget'),
    approval_act: _toolNeedsConsent('approval_act'),
  }));
  ok(!gate.memory_list && !gate.approvals_list && !gate.account_status,
     'reading their own data does not interrupt them', gate);
  ok(gate.memory_add && gate.memory_forget && gate.approval_act,
     'writing, forgetting and sending all ask first', gate);
}

section('And the dialog says what will actually happen');
{
  const r = await page.evaluate(async () => {
    const seen = [];
    const watch = setInterval(() => {
      const m = document.getElementById('modal-box');
      if (!m) return;
      seen.push((m.textContent || '').replace(/\s+/g, ' ').trim());
      const btns = [...m.querySelectorAll('button')];
      const deny = btns.find(b => /deny|cancel/i.test(b.textContent || ''));
      if (deny) deny.click();
    }, 100);
    await _confirmModelTool('approval_act', { id: 'x', action: 'approve' });
    await _confirmModelTool('memory_add', { text: 'I live in Manchester.' });
    clearInterval(watch);
    return seen;
  });
  ok(r.some(t => /APPROVING IS WHAT SENDS/i.test(t) || /goes out now/i.test(t)),
     'approving says it sends', (r[0] || '').slice(0, 160));
  ok(r.some(t => /every future conversation/i.test(t) && /Manchester/.test(t)),
     'and remembering shows the exact words and says they will be reused', (r[1] || '').slice(0, 180));
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
  const bad = L.served.filter(s => s.status >= 500);
  ok(bad.length === 0, 'and the worker never fell over', bad.map(s => s.path));
}

await L.close();
outbound.restore();
if (report('the-rest-of-it-from-chat') > 0) process.exitCode = 1;
done();
