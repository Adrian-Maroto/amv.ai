/* OTHER COMPANIES' MODELS IN THE PICKER (Nov 18, the owner: "we are gonna be
   like Perplexity where we include models like GPT, Gemini, Claude...";
   docs/PLAN-MODEL-PICKER.md).

   The server lists an engine only once its supplier's own model list confirms
   it (tests/worker/partner-engines-are-sold-as-amv). This drives the page:
   - AMV's own engines first, then each maker's models under the maker's name,
     by the model's own name - and nothing the server sends is drawn as markup;
   - each one's cost bars come from the server's step on AMV's ladder;
   - Think longer is a switch on a model that can, and only on one that can;
   - switched on, the chat asks that model to think harder (effort: high);
     switched off, or on a model that cannot, it asks nothing of the sort. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();
await app.stubFetch(async (u, o) => {
  if (/\/v1\/engines/.test(u)) return new Response(JSON.stringify({ ok: true, engines: [
    { key: 'amv-core', minPlan: 'free', context: 1000000, maxOut: 16000 },
    { key: 'amv-sol', label: 'Sol 6.1', maker: 'Maker One', partner: true, minPlan: 'pro', cost: 3, thinks: true, context: 400000, maxOut: 16000, caps: { vision: true, tools: true } },
    { key: 'amv-astra', label: 'Astra 6', maker: 'Maker One', partner: true, minPlan: 'ultra', cost: 4, thinks: true, context: 400000, maxOut: 16000, caps: { vision: true, tools: true } },
    { key: 'amv-argon', label: 'Argon <b>4</b>', maker: 'Maker <i>Two</i>', partner: true, minPlan: 'pro', cost: 2, thinks: false, context: 1000000, maxOut: 16000, caps: { tools: true } },
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (/\/v1\/messages/.test(u)) {
    window.__bodies = (window.__bodies || []).concat([JSON.parse(o.body)]);
    const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(Object.assign({ type: t }, d)) + '\n\n';
    return new Response(ev('message_start', { message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } })
      + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hi.' } })
      + ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
      + ev('message_stop', {}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
await page.evaluate(async () => {
  try { saveStr('amv_think', '0'); } catch (e) {}
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  await _loadPartnerEngines();
});
const picker = () => page.evaluate(() => {
  showModelPicker();
  const m = document.querySelector('.model-picker');
  const rows = [...m.children].map(el => el.classList.contains('mp-maker') ? { maker: el.textContent }
    : el.classList.contains('mp-item') ? { item: el.dataset.mk, name: el.querySelector('.mp-name').textContent, desc: el.querySelector('.mp-desc').textContent,
        bars: el.querySelectorAll('.mp-bar.on').length } : el.classList.contains('mp-think') ? { think: el.getAttribute('aria-checked') } : null).filter(Boolean);
  return { rows, markup: !!m.querySelector('.mp-name b, .mp-maker i, .mp-name i') };
});

section('AMV first, then each maker under its own name');
{
  const r = await picker();
  const firstMaker = r.rows.findIndex(x => x.maker);
  ok(firstMaker > 0 && r.rows.slice(0, firstMaker).every(x => x.item && !/^amv-(sol|astra|argon)$/.test(x.item)), 'AMV’s own engines come first', r.rows.slice(0, firstMaker));
  const makers = r.rows.filter(x => x.maker).map(x => x.maker);
  ok(makers.length === 2 && makers[0] === 'Maker One', 'one heading per maker, in the order the owner listed them', makers);
  const sol = r.rows.find(x => x.item === 'amv-sol');
  ok(sol && sol.name === 'Sol 6.1', 'a model is shown by its own name', sol);
  ok(/Reads pictures/.test(sol.desc) && /think longer/i.test(sol.desc), 'and what it can do', sol.desc);
  ok(sol.bars === 3 && r.rows.find(x => x.item === 'amv-astra').bars === 4, 'its cost bars are the server’s step on AMV’s ladder', r.rows.filter(x => x.item && /sol|astra/.test(x.item)));
  ok(!r.markup && r.rows.some(x => x.maker === 'Maker <i>Two</i>') && r.rows.some(x => x.name === 'Argon <b>4</b>'), 'a name the server sends is text, never markup', r.rows.filter(x => /Two|Argon/.test(x.maker || x.name || '')));
  ok(!r.rows.some(x => x.think), 'with AMV’s own engine chosen there is no Think longer switch', r.rows.filter(x => x.think));
}

section('Think longer is a switch on a model that can');
{
  await page.evaluate(() => { document.querySelectorAll('.model-picker').forEach(m => m.remove()); S.model = 'amv-sol'; });
  let r = await picker();
  ok(r.rows.some(x => x.think === 'false'), 'choosing Sol shows the switch, off', r.rows.filter(x => x.think));
  await page.click('.model-picker .mp-think');
  r = await page.evaluate(() => ({ on: document.querySelector('.model-picker .mp-think').getAttribute('aria-checked'), saved: loadStr('amv_think'), open: !!document.querySelector('.model-picker') }));
  ok(r.on === 'true' && r.saved === '1' && r.open, 'a tap turns it on, keeps it, and leaves the menu open', r);
  await page.evaluate(() => { document.querySelectorAll('.model-picker').forEach(m => m.remove()); S.model = 'amv-argon'; });
  r = await picker();
  ok(!r.rows.some(x => x.think), 'a model that cannot think longer has no switch', r.rows.filter(x => x.think));
}

section('What the chat asks for');
{
  const send = (model, text) => page.evaluate(async ({ model, text }) => {
    document.querySelectorAll('.model-picker').forEach(m => m.remove());
    S.model = model; window.__bodies = [];
    /* The send-pacing guard is not what is under test. */
    try { AEGIS._lastSend = 0; AEGIS._times = []; } catch (e) {}
    { const t1 = Date.now(); while (S.busy && Date.now() - t1 < 8000) await new Promise(r => setTimeout(r, 50)); }
    await new Promise(r => setTimeout(r, 400));
    const inp = document.getElementById('mta'); inp.value = text;
    await sendMsg();
    const t0 = Date.now(); while (!window.__bodies.length && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
    while (S.busy && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
    const b = window.__bodies[0] || {};
    return { model: b.model, effort: b.effort === undefined ? null : b.effort, toast: [...document.querySelectorAll('.toast, #toasts *')].map(x => x.textContent).join(' | ').slice(0, 200), busy: S.busy };
  }, { model, text });
  let r = await send('amv-sol', 'Plan my week');
  ok(r.model === 'amv-sol' && r.effort === 'high', 'Sol with Think longer on asks it to think harder', r);
  await page.evaluate(() => saveStr('amv_think', '0'));
  r = await send('amv-sol', 'And next week?');
  ok(r.model === 'amv-sol' && r.effort === null, 'switched off, it asks nothing extra', r);
  await page.evaluate(() => saveStr('amv_think', '1'));
  r = await send('amv-argon', 'One more');
  ok(r.model === 'amv-argon' && r.effort === null, 'and a model that cannot is never asked, whatever the switch says', r);
}

ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
await app.close();
report();
done();
