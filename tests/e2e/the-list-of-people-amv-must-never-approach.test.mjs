/* A BOUND NOBODY CAN WRITE IS THE DEFECT THIS MILESTONE KEEPS FINDING.

   The engine understood destination rules before anything could set one; the
   run budget was enforced before anything could write it; quiet hours were
   held by the cron before a checkbox existed. Each time, the code was right
   and the feature did not exist.

   So the never list gets its control in the same commit as its enforcement,
   and this suite is about the half that reaches a person: that it saves, that
   it comes back, that a refused entry is REPORTED rather than swallowed, and
   that what the control claims is exactly what the server does - no more. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' }, tab: 'crew' });
const { page, errors } = app;

const open = () => page.evaluate(() => {
  saveStr('amv_plan', 'pro');
  AMV_API.base = 'https://backend.test'; AMV_API.token = 't';
  renderCrewView();
  return !!document.getElementById('mc-never-box');
});

section('The control is on the screen where autonomy is governed');
{
  ok(await open(), 'there is somewhere to write the list');
  const near = await page.evaluate(() => {
    const q = document.querySelector('.mc-quiet'), n = document.querySelector('.mc-never');
    if(!q || !n) return null;
    return q.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after quiet hours' : 'elsewhere';
  });
  ok(near === 'after quiet hours',
     'beside quiet hours - when AMV may act, and who it may never approach, are the same kind of promise', near);
}

section('What it sends is what the server understands');
{
  const sent = await page.evaluate(() => {
    const calls = [];
    window._autoApi = async (path, body) => { calls.push({ path, body }); return { ok: true, never: body.never }; };
    document.getElementById('mc-never-box').value = 'mybank.com\nboss@work.com\n\n  spaced@x.com  ';
    return mcNeverSave().then(() => calls);
  });
  ok(sent.length === 1 && sent[0].path === '/auto/update',
     'one request, to the route the worker answers', sent[0]);
  ok(sent[0].body.action === 'never', 'naming the action', sent[0].body);
  ok(JSON.stringify(sent[0].body.never) === JSON.stringify(['mybank.com', 'boss@work.com', 'spaced@x.com']),
     'one entry per line, trimmed, with the blank line dropped', sent[0].body.never);
}

section('A refusal is reported, and nothing is claimed to have been saved');
{
  /* The server refuses the WHOLE list when one entry is unreadable. A control
     that said "saved" here would leave somebody believing a rule holds that
     was never stored - which, for a list of people AMV must not approach, is
     the worst sentence available. */
  const msgs = await page.evaluate(() => {
    const out = [];
    window.toast = (m, k) => out.push({ m: String(m), kind: k });
    window._autoApi = async () => { const e = new Error('AMV could not read "my bank" as an address or a domain.'); throw e; };
    document.getElementById('mc-never-box').value = 'my bank';
    return mcNeverSave().then(() => out);
  });
  ok(msgs.some(m => m.kind === 'error' && /NOT saved/i.test(m.m)), 'it says it did not save', msgs);
  ok(msgs.some(m => /could not read "my bank"/i.test(m.m)),
     'and passes on which line the server could not read', msgs);
  ok(msgs.some(m => /still in force/i.test(m.m)),
     'and says what that means for the rules they already had', msgs);
  ok(!msgs.some(m => m.kind === 'success'), 'with no success claimed alongside', msgs);
}

section('The list belongs to the account, not the browser it was typed in');
{
  const back = await page.evaluate(() => {
    window._autoApi = async () => ({ items: [], results: [], never: ['@mybank.com', 'boss@work.com'] });
    return _autoRefresh().then(() => { renderCrewView(); return document.getElementById('mc-never-box').value; });
  });
  ok(/@mybank\.com/.test(back) && /boss@work\.com/.test(back),
     'a list set on another device arrives here', JSON.stringify(back));
  const cleared = await page.evaluate(() => {
    window._autoApi = async () => ({ items: [], results: [], never: [] });
    return _autoRefresh().then(() => { renderCrewView(); return document.getElementById('mc-never-box').value; });
  });
  ok(cleared === '', 'and clearing it elsewhere clears it here', JSON.stringify(cleared));
}

section('It says what it actually does, and does not overstate it');
{
  const text = await page.evaluate(() => {
    renderCrewView();
    const el = document.querySelector('.mc-never');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  });
  ok(/never emails anyone but you/i.test(text),
     'it states the thing that is already true, so the list is not mistaken for the only reason', text);
  ok(/offer/i.test(text), 'and that what it governs is what AMV offers', text);
  ok(!/\bblock(s|ed)? (all|every)\b|\bstops? AMV from (sending|emailing)\b/i.test(text),
     'it never claims to stop a send that cannot happen anyway', text);
}

section('It fits a phone and can be typed on one');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  const m = await page.evaluate(() => {
    const box = document.getElementById('mc-never-box');
    const btn = document.querySelector('.mc-never-foot .btn');
    const b = box.getBoundingClientRect(), t = btn.getBoundingClientRect();
    return { boxH: Math.round(b.height), btnH: Math.round(t.height),
             inside: Math.round(b.right) <= window.innerWidth,
             overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(m.boxH >= 60, 'the box is big enough to hold a few lines', m.boxH);
  ok(m.btnH >= 44, 'and Save is big enough to hit', m.btnH);
  ok(m.inside && !m.overflowX, 'with nothing pushed off the side', m);
}

ok(errors.length === 0, 'and none of it threw', errors);
report(); done(app);
