/* THE LAST STEP OF OPTION (a), AND THE ONE THAT MAKES IT WORTH ANYTHING.

   A run can find the subscription, work out that its receipts come from a
   mailbox somebody reads, and write the cancellation - and if that letter only
   exists inside a paragraph of model prose, the person has to retype it out of
   a summary. That is the difference between a feature and a mention of one.

   The owner's decision on how it reaches the merchant: the person's own mail
   client now, their own mailbox later, never AMV's own domain. So what is
   tested here is a HANDOVER, not a send:

     - the letter survives as data all the way to a control that opens it,
       address and subject intact
     - the screen never claims AMV sent it
     - and a copy that failed says so, because "Copied" on an empty clipboard
       is the small version of "Sent" on a send that never happened. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '', user: { name: 'Owner', email: 'owner@amv.dev', ini: 'O' }, tab: 'crew' });
const { page, errors } = app;

const DRAFT = {
  merchant: 'Acme', to: 'billing@acme.com',
  subject: 'Cancel my subscription - Acme',
  body: 'Hello,\n\nPlease cancel my subscription and stop the monthly charge of GBP 9.00 on this account.\n\nThank you,\nowner@amv.dev',
};

/* Results arrive from the server through _autoRefresh, so they are put there
   the way the product puts them there rather than poked into a variable. */
const render = (drafts) => page.evaluate(([ds]) => {
  saveStr('amv_plan', 'pro');
  AMV_API.base = 'https://backend.test'; AMV_API.token = 't';
  window._autoApi = async () => ({ items: [], results: [{
    id: 'r1', autoId: 'j1', detail: 'Inbox digest', at: Date.now(), read: false,
    kind: 'task', approval: 'auto', outcome: 'in-app', costUSD: 0.01,
    out: 'You are paying for two things.',
    ...(ds ? { drafts: ds } : {}),
  }] });
  return _autoRefresh().then(() => {
    renderCrewView();
    const sec = document.getElementById('mc-activity');
    const a = sec && sec.querySelector('.mc-draft-go[href]');
    return {
      text: sec ? (sec.textContent || '').replace(/\s+/g, ' ').trim() : null,
      href: a ? a.getAttribute('href') : null,
      controls: sec ? sec.querySelectorAll('.mc-draft-go').length : 0,
      rows: sec ? sec.querySelectorAll('.mc-draft-row').length : 0,
    };
  });
}, [drafts]);

section('The letter reaches a control that opens it');
{
  const r = await render([DRAFT]);
  ok(r.text && /A cancellation is ready to send/i.test(r.text),
     'the run says it produced one', r.text && r.text.slice(0, 200));
  ok(/Acme/.test(r.text) && /billing@acme\.com/.test(r.text),
     'naming the merchant and the address it goes to', r.text && r.text.slice(0, 200));
  ok(r.controls === 2, 'with both ways to take it: open, and copy', r.controls);
}

section('And the address, subject and body survive the trip intact');
{
  const r = await render([DRAFT]);
  ok(r.href && r.href.startsWith('mailto:billing@acme.com?'),
     'the recipient is the one the receipt came from, unescaped enough for a mail client to read',
     r.href && r.href.slice(0, 60));
  const u = new URL(r.href);
  const qs = new URLSearchParams(u.search);
  ok(qs.get('subject') === DRAFT.subject,
     'the subject arrives exactly as written', qs.get('subject'));
  /* The body is the whole point. A handover that drops the letter is a
     handover of nothing. */
  ok(qs.get('body') === DRAFT.body,
     'and so does every line of the letter, newlines included', JSON.stringify(qs.get('body')));
}

section('Nothing on the screen says AMV sent it');
{
  const r = await render([DRAFT]);
  ok(!/\bsent it\b|\bwe sent\b|\bAMV sent\b/i.test(r.text),
     'no claim that it went out', r.text && r.text.slice(0, 300));
  ok(/cannot send these itself/i.test(r.text),
     'it says plainly that AMV cannot send it', r.text && r.text.slice(0, 300));
  ok(/your own address/i.test(r.text),
     'and why coming from the person is the version that works', r.text && r.text.slice(0, 300));
}

section('A run with nothing to send shows nothing');
{
  const r = await render(null);
  ok(r.rows === 0 && r.controls === 0,
     'no empty block on a run that produced no letters', r);
  ok(r.text && !/ready to send/i.test(r.text),
     'and nothing offered', r.text && r.text.slice(0, 160));
}

section('Two letters are two rows, not one merged one');
{
  const r = await render([DRAFT, { merchant: 'Beta', to: 'help@beta.com', subject: 'Cancel my subscription - Beta', body: 'Hello,\n\nPlease cancel.' }]);
  ok(r.rows === 2, 'one row each', r.rows);
  ok(/2 cancellations are ready/i.test(r.text), 'counted in the heading', r.text && r.text.slice(0, 120));
}

section('Copy puts the address and the subject in, not just the prose');
{
  const got = await page.evaluate(() => {
    let copied = null;
    const msgs = [];
    window.toast = (m, k) => msgs.push({ m: String(m), kind: k });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async (t) => { copied = t; } },
    });
    return mcCopyDraft('r1|0').then(() => ({ copied, msgs }));
  });
  ok(got.copied && /^To: billing@acme\.com/m.test(got.copied),
     'the recipient is in the copied text - retyping an address from memory is how it reaches the wrong person',
     got.copied && got.copied.slice(0, 80));
  ok(/^Subject: Cancel my subscription - Acme/m.test(got.copied || ''), 'and the subject', got.copied && got.copied.slice(0, 120));
  ok(/Please cancel my subscription/.test(got.copied || ''), 'and the letter itself', got.copied && got.copied.length);
  ok(got.msgs.some(m => m.kind === 'success' && /Copied/i.test(m.m)), 'and it says so', got.msgs);
}

section('A copy that failed does NOT say copied');
{
  const got = await page.evaluate(() => {
    const msgs = [];
    window.toast = (m, k) => msgs.push({ m: String(m), kind: k });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
    });
    return mcCopyDraft('r1|0').then(() => msgs);
  });
  ok(!got.some(m => /^Copied/i.test(m.m)), 'no false success', got);
  ok(got.some(m => m.kind === 'error' && /nothing was copied/i.test(m.m)),
     'it says the clipboard is empty', got);
  ok(got.some(m => /mail app instead/i.test(m.m)), 'and offers the way that still works', got);
}

section('A draft that is no longer there says so rather than doing nothing');
{
  const got = await page.evaluate(() => {
    const msgs = [];
    window.toast = (m, k) => msgs.push({ m: String(m), kind: k });
    return mcCopyDraft('nope|0').then(() => msgs);
  });
  ok(got.some(m => m.kind === 'error' && /no longer here/i.test(m.m)),
     'a missing draft is reported, not silently ignored', got);
}

section('It fits a phone, and the controls are big enough to hit');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await render([DRAFT]);
  const m = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#mc-activity .mc-draft-go')];
    return { heights: els.map(e => Math.round(e.getBoundingClientRect().height)),
             overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(m.heights.length === 2 && m.heights.every(h => h >= 44),
     'both controls clear 44px on a phone', m.heights);
  ok(m.overflowX === false, 'and nothing is pushed off the side', m);
}

ok(errors.length === 0, 'and none of it threw', errors);
report(); done(app);
