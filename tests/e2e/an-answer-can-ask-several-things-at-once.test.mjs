/* AN ANSWER CAN ASK SEVERAL THINGS AT ONCE, AND THE ANSWERS COME BACK.

   A ```form block in an answer draws real fields; Send puts what was filled
   in into the person's next message, labelled, through the same send as
   typing. Driven through the real controls - typing, ticking, the slider, the
   Send button - and what is asserted is what AMV would receive (its seam,
   `_callAI`, is recorded).

   And what it must not do: draw a field type it does not know, run anything
   the model wrote, put a label in as HTML, send with a required answer
   missing, or send twice. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page, errors } = app;
await app.connect();
await page.evaluate(() => {
  window.__sent = [];
  window._callAI = async (msgs) => { window.__sent.push(msgs[msgs.length - 1]); S.busy = false; };
  try { AMVUsage.status = () => ({ remaining: 9999, resetsAt: Date.now() + 3600e3 }); } catch (e) {}
  try { AEGIS.check = () => ({ ok: true }); } catch (e) {}
});

const FORM = {
  title: 'Your trip', intro: 'A few details and I will plan it.',
  fields: [
    { id: 'where', label: 'Where to', type: 'text', required: true, placeholder: 'A city' },
    { id: 'nights', label: 'Nights', type: 'number', min: 1, max: 30, value: 3 },
    { id: 'style', label: 'Style', type: 'select', options: ['Relaxed', 'Packed'] },
    { id: 'likes', label: 'Likes', type: 'multi', options: ['Food', 'Museums', 'Hiking'] },
    { id: 'budget', label: 'Budget', type: 'range', min: 500, max: 5000, step: 500, value: 1500, unit: 'USD' },
    { id: 'kids', label: 'Travelling with children', type: 'toggle' },
    { id: 'start', label: 'Leaving on', type: 'date' },
  ],
};
/* The form goes where the model puts it: inside an answer in a real
   conversation, drawn by the chat renderer - so a send, which redraws the
   chat, is exercised exactly as it happens. */
const show = (spec) => page.evaluate((src) => {
  const c = newConvObj('Form test');
  c.msgs.push({ r: 'u', c: 'Plan a trip' }, { r: 'a', c: 'Happy to.\n\n' + src });
  S.convs.unshift(c); S.cur = c.id;
  renderChatMsgs();
  const last = [...document.querySelectorAll('#cm .mb, #cm .mr')].pop();
  document.querySelectorAll('[id=formtest]').forEach(x => x.removeAttribute('id'));
  const form = document.querySelector('#cm form.gui-form');
  const host = form ? form.closest('.mr, .mb') || form.parentNode : last;
  if (host) host.id = 'formtest';
  return host ? host.innerHTML : '';
}, typeof spec === 'string' ? spec : '```form\n' + JSON.stringify(spec) + '\n```');
const sent = () => page.evaluate(() => window.__sent.map(m => typeof m.c === 'string' ? m.c : JSON.stringify(m.c)));

section('A form block draws real fields');
{
  await show(FORM);
  const r = await page.evaluate(() => {
    const f = document.querySelector('#formtest form.gui-form');
    return f && { inputs: f.querySelectorAll('input,select,textarea').length, labelled: [...f.querySelectorAll('input:not([type=checkbox]),select,textarea')].every(el => el.id && document.querySelector('label[for="' + el.id + '"]')),
                  send: f.querySelector('button[type=submit]').textContent };
  });
  ok(r && r.inputs >= 9, 'every field is a real control', r);
  ok(r && r.labelled, 'and each one has a label a screen reader reads', r);
  ok(r && r.send === 'Send', 'with a Send button', r);
}

section('A required answer missing is named, and nothing is sent');
{
  await page.click('#formtest .gui-form-send');
  const err = await page.textContent('#formtest .gui-form-err');
  ok(/Where to is needed/.test(err), 'it says which', err);
  ok((await sent()).length === 0, 'and sends nothing', await sent());
}

section('Filled in and sent, every answer arrives labelled in the next message');
{
  await page.fill('#formtest [name=where]', 'Lisbon');
  await page.fill('#formtest [name=nights]', '4');
  await page.selectOption('#formtest [name=style]', 'Relaxed');
  await page.check('#formtest input[name=likes][value=Food]');
  await page.check('#formtest input[name=likes][value=Museums]');
  await page.fill('#formtest [name=budget]', '2500');
  await page.check('#formtest [name=kids]');
  await page.fill('#formtest [name=start]', '2026-11-03');
  await page.click('#formtest .gui-form-send');
  await page.waitForFunction(() => window.__sent.length > 0, null, { timeout: 5000 });
  const m = (await sent())[0];
  for (const line of ['Your trip', '- Where to: Lisbon', '- Nights: 4', '- Style: Relaxed', '- Likes: Food, Museums', '- Budget: 2500 USD', '- Travelling with children: Yes', '- Leaving on: 2026-11-03'])
    ok(m.includes(line), 'carries "' + line + '"', m);
  await page.waitForTimeout(300);
  /* Sending redraws the chat. The form comes back as history, not as a
     fresh form that could be sent a second time. */
  const after = await page.evaluate(() => { const f = document.querySelector('#cm form.gui-form'); return f && { sentFlag: f.getAttribute('data-sent'), inert: f.hasAttribute('inert'), btn: f.querySelector('.gui-form-send').disabled, label: f.querySelector('.gui-form-send').textContent }; });
  ok(after && after.sentFlag === '1' && after.inert && after.btn && after.label === 'Answered', 'after the redraw the form is answered and locked, so it cannot be sent twice', after);
}

section('A number out of range is refused');
{
  await show(FORM);
  await page.evaluate(() => { window.__sent = []; });
  await page.fill('#formtest [name=where]', 'Rome');
  await page.fill('#formtest [name=nights]', '99');
  await page.click('#formtest .gui-form-send');
  ok(/Nights needs a number in range/.test(await page.textContent('#formtest .gui-form-err')) && (await sent()).length === 0, 'named, and nothing sent', await sent());
}

section('Nothing the model wrote runs, and a bad block is not drawn');
{
  const evil = await show({ title: '<img src=x onerror="window.__pwned=1">', fields: [{ id: 'a', label: '<script>window.__pwned=1</script>', type: 'text' }] });
  ok(!(await page.evaluate(() => window.__pwned)) && !/<script>|<img src=x/i.test(evil), 'labels and titles are text, never HTML', evil.slice(0, 200));
  const unknown = await show({ fields: [{ id: 'a', type: 'file' }] });
  ok(!/gui-form/.test(unknown) && /<pre>[\s\S]*FORM/.test(unknown), 'an unknown field type is shown as the raw block, not drawn', unknown.slice(0, 120));
  for (const label of ['Password', 'Card number', 'CVV', 'Social security number', 'Your PIN', 'Bank account number']) {
    const h = await show({ title: 'Checkout', fields: [{ id: 'a', label: 'Name' }, { id: 'b', label }] });
    ok(!/gui-form/.test(h), 'a form asking for "' + label + '" is not drawn', h.slice(0, 80));
  }
  const noFields = await show({ title: 'x' });
  ok(!/gui-form/.test(noFields), 'and so is a form with no fields', noFields.slice(0, 120));
}

section('On a phone, nothing spills off the screen');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await show(FORM);
  const over = await page.evaluate(() => [...document.querySelectorAll('#formtest *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 0.5; }).map(e => e.className || e.tagName));
  ok(over.length === 0, 'the form fits at 390px', over.slice(0, 5));
  await page.setViewportSize({ width: 1280, height: 860 });
}

ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));
await app.close();
if (report('an-answer-can-ask-several-things-at-once') > 0) process.exitCode = 1;
done();
