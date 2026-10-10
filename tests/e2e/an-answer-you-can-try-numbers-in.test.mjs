/* AN ANSWER YOU CAN TRY NUMBERS IN.

   A ```calc block draws inputs and results, and the results follow the
   inputs as somebody types. Driven through the real chat renderer on a phone:

   - the loan formula gives the textbook figure, and changing an input
     changes the result;
   - a slider, a select and a toggle all feed the formulas;
   - an output can use an earlier output;
   - a division by zero shows a dash, never Infinity or NaN;
   - a formula that is not arithmetic - a property lookup, a call to
     something that is not on the list, a string - is refused, and the block
     is shown as written rather than as a calculator that computes nothing;
   - nothing in a label is markup. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', viewport: { width: 390, height: 844 }, hasTouch: true });
const { page, errors } = app;

const block = (o) => '```calc\n' + JSON.stringify(o) + '\n```';
const LOAN = { title: 'Loan', currency: 'EUR', inputs: [
  { id: 'p', label: 'Amount', value: 20000 },
  { id: 'r', label: 'Rate %', value: 5 },
  { id: 'n', label: 'Months', type: 'range', min: 6, max: 84, value: 36 }],
  outputs: [
  { id: 'pay', label: 'Monthly payment', formula: 'p*(r/1200)/(1-(1+r/1200)^(-n))', format: 'money' },
  { label: 'Total paid', formula: 'pay*n', format: 'money' }] };
const MIXED = { title: 'Trip', inputs: [
  { id: 'nights', label: 'Nights', value: 3 },
  { id: 'room', label: 'Room', type: 'select', options: [{ label: 'Single', value: 80 }, { label: 'Double', value: 120 }], value: 120 },
  { id: 'bf', label: 'Breakfast', type: 'toggle', value: 0 },
  { id: 'people', label: '<b>People</b>', value: 0 }],
  outputs: [
  { label: 'Total', formula: 'nights*(room + if(bf, 15, 0))', format: 'integer', unit: 'EUR' },
  { label: 'Each', formula: 'nights*room/people', format: 'number' }] };
const BAD = [
  { inputs: [{ id: 'a', value: 1 }], outputs: [{ formula: 'a.constructor' }] },
  { inputs: [{ id: 'a', value: 1 }], outputs: [{ formula: 'alert(a)' }] },
  { inputs: [{ id: 'a', value: 1 }], outputs: [{ formula: '"x" + a' }] },
  { inputs: [{ id: 'a', value: 1 }], outputs: [{ formula: 'b + 1' }] },
];

await page.evaluate(([loan, mixed, bad]) => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  newChat();
  setMsgs([{ r: 'u', c: 'Loan and trip' }, { r: 'a', c: 'Here you go.\n\n' + loan + '\n\nAnd the trip:\n\n' + mixed + '\n\n' + bad.join('\n\n') }]);
  renderChatMsgs();
}, [block(LOAN), block(MIXED), BAD.map(block)]);
const outs = (i) => page.evaluate((i) => [...document.querySelectorAll('#cm .gui-calc')[i].querySelectorAll('.gui-calc-ov')].map(o => o.textContent), i);

section('The loan block gives the textbook figure, and follows the inputs');
{
  ok(await page.evaluate(() => document.querySelectorAll('#cm .gui-calc').length === 2), 'two calculators drawn, the four bad blocks not');
  const o = await outs(0);
  ok(/599[.,]42/.test(o[0]), 'EUR 20,000 at 5% over 36 months is 599.42 a month', o);
  ok(/21[.,]?579[.,]05/.test(o[1]), 'and an output can use an earlier one: 36 payments total 21,579.05', o);
  await page.fill('#cm .gui-calc >> nth=0 >> [data-calc-in="p"]', '10000');
  const o2 = await outs(0);
  ok(/299[.,]71/.test(o2[0]), 'halving the amount halves the payment, as it is typed', o2);
  await page.locator('#cm .gui-calc >> nth=0 >> [data-calc-in="n"]').evaluate(el => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const o3 = await outs(0);
  ok(/856[.,]07/.test(o3[0]), 'and the slider changes it too (12 months: 856.07)', o3);
}

section('A select, a toggle, and a division by zero');
{
  let o = await outs(1);
  ok(o[0].replace(/\D/g, '') === '360', 'three nights in a double is 360', o);
  ok(o[1] === '—', 'dividing by zero people shows a dash, not Infinity', o);
  await page.check('#cm .gui-calc >> nth=1 >> [data-calc-in="bf"]');
  await page.selectOption('#cm .gui-calc >> nth=1 >> [data-calc-in="room"]', '80');
  o = await outs(1);
  ok(o[0].replace(/\D/g, '') === '285', 'single room with breakfast: 3 × (80 + 15) = 285', o);
}

section('Nothing that is not arithmetic runs, and labels are text');
{
  const r = await page.evaluate(() => ({
    rawBlocks: [...document.querySelectorAll('#cm pre, #cm code')].filter(e => /constructor|alert\(|"x"|b \+ 1/.test(e.textContent)).length,
    bold: document.querySelectorAll('#cm .gui-calc b').length,
    label: [...document.querySelectorAll('#cm .gui-calc-l')].map(l => l.textContent).find(t => /People/.test(t)),
    compile: ['a.constructor', 'alert(1)', 'constructor', '__proto__', 'a[0]', '1;2', 'a=1', 'x=>1', '`1`'].map(f => _calcCompile(f, new Set(['a']))),
  }));
  ok(r.rawBlocks >= 1, 'the refused blocks are shown as written, not drawn as calculators', r.rawBlocks);
  ok(r.compile.every(f => f === null), 'property access, unknown calls, assignment and templates are all refused', r.compile);
  ok(r.bold === 0 && /<b>People<\/b>/.test(r.label), 'markup in a label is shown as text', r.label);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('an-answer-you-can-try-numbers-in') > 0) process.exitCode = 1;
done();
