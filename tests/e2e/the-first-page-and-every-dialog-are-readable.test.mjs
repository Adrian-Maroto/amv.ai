/* THE SCREEN EVERY VISITOR SEES FIRST HAD NEVER HAD A COLOUR MEASURED.

   `text-you-can-actually-read-in-both-themes` walks `#app *`. The marketing
   landing page is `#land` - 188 pieces of text, the hero, the pricing, the
   FAQ, "Sign up free" - and every dialog is `#ovr`: the delete-account
   confirmation, the checkout sheet, the approval gate, the policy documents.
   Neither is inside `#app`, so neither was ever looked at.

   Measured, the dialogs had one: `.fp-warn` at 1.82:1 in the light theme -
   the warning line on the confirmation for deleting an account. `--amber` is
   defined once, for the dark theme, and `body.light` never redefines it, so
   it was painting #e0b341 on a white card. LAYER A165.

   TWO THINGS THIS FILE HAS TO DO THAT ARE NOT OBVIOUS:

   1. `#land` is hidden by `html.booted-in #land{display:none!important}` once
      the app takes over, and by a `.hidden` class. Removing one is not enough;
      an inline `display:block` loses to the `!important`. Both come off, and
      the display is set with priority.

   2. A dialog is opened by calling its own function, not by clicking a path
      to it - the point is to measure the dialog, and half of these are
      reached from places a signed-out or unpaid visitor cannot go. A function
      that does not render (a network read the harness has no backend for)
      reports that it rendered nothing rather than passing quietly.

   The floor is AA: 4.5, or 3 for large text. No allowance. */
import { bootApp } from '../lib/harness.mjs';
import { parseColor, contrast, flatten } from '../lib/color.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const AA = 4.5;

/* Dialogs that render from state the harness already has. `openFeedback`
   takes its kind; the rest take nothing. */
const DIALOGS = [['openFeedback', ['bug']], ['openWhatsNew', []], ['openMySites', []],
                 ['openErrors', []], ['openSharedChatsManager', []],
                 ['openResearchWatch', []], ['_openShareModal', []],
                 ['_confirmDeleteAccount', []], ['_renderForgot', []],
                 ['_apiShowOnce', ['amv_live_EXAMPLEKEYNOTREAL']]];

const collect = (page, sel, label) => page.evaluate(([s, t]) => {
  const EMOJI = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}←-⇿☀-➿️]+$/u;
  const out = [];
  const host = document.querySelector(s);
  if (!host || getComputedStyle(host).display === 'none') return out;
  for (const el of host.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (own.length < 3 || EMOJI.test(own)) continue;
    const cs = getComputedStyle(el);
    /* Gradient text sets a transparent fill; emoji ignore `color` entirely. */
    if (cs.webkitTextFillColor && /rgba\(0, 0, 0, 0\)/.test(cs.webkitTextFillColor)) continue;
    if (/rgba\([^)]*,\s*0\)$/.test(cs.color)) continue;
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    const stack = []; let x = el;
    while (x) { const c = getComputedStyle(x).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)$/.test(c)) stack.push(c); x = x.parentElement; }
    stack.push(getComputedStyle(document.body).backgroundColor);
    out.push({ where: t, fg: cs.color, stack, size: parseFloat(cs.fontSize),
               weight: +cs.fontWeight,
               cls: String(el.className || '').split(' ').slice(0, 2).join('.'),
               text: own.slice(0, 26) });
  }
  return out;
}, [sel, label]);

const judge = rows => {
  const bad = [];
  for (const x of rows) {
    const bg = flatten(x.stack); if (!bg) continue;
    const fg = parseColor(x.fg); if (!fg) continue;
    const eff = fg[3] < 1
      ? [fg[0]*fg[3]+bg[0]*(1-fg[3]), fg[1]*fg[3]+bg[1]*(1-fg[3]), fg[2]*fg[3]+bg[2]*(1-fg[3]), 1]
      : fg;
    const c = contrast(eff, bg);
    const large = x.size >= 24 || (x.size >= 18.66 && x.weight >= 700);
    if (c < (large ? 3 : AA) - 0.01)
      bad.push(`${x.where}/${x.cls || '(none)'} ${c.toFixed(2)}:1 ${x.size}px "${x.text}"`);
  }
  return [...new Set(bad)];
};

const app = await bootApp({ tab: 'chat', viewport: { width: 1280, height: 900 },
                            user: { name: 'T', email: 't@x.com', ini: 'T' } });
const { page, errors } = app;

const landing = {}, dialogs = {}, empty = [];
for (const theme of ['dark', 'light']) {
  await page.evaluate(t => document.body.classList.toggle('light', t === 'light'), theme);
  /* `body` transitions its background over .2s; read too early and every
     measurement below is taken against a colour part-way between themes. */
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    document.documentElement.classList.remove('booted-in');
    const l = document.getElementById('land');
    if (l) { l.classList.remove('hidden'); l.style.setProperty('display', 'flex', 'important'); }
  });
  await page.waitForTimeout(400);
  const rows = await collect(page, '#land', 'land');
  landing[theme] = { count: rows.length, bad: judge(rows) };
  await page.evaluate(() => {
    const l = document.getElementById('land');
    if (l) { l.style.display = ''; l.classList.add('hidden'); }
    document.documentElement.classList.add('booted-in');
  });

  const bad = [];
  for (const [name, args] of DIALOGS) {
    await page.evaluate(([n, a]) => {
      const r = document.getElementById('ovr'); if (r) r.innerHTML = '';
      const f = window[n]; if (typeof f === 'function') { try { f(...a); } catch (e) {} }
    }, [name, args]);
    await page.waitForTimeout(500);
    const r2 = await collect(page, '#ovr', name);
    if (!r2.length) empty.push(theme + '/' + name);
    bad.push(...judge(r2));
    await page.evaluate(() => { const r = document.getElementById('ovr'); if (r) r.innerHTML = ''; });
  }
  dialogs[theme] = [...new Set(bad)];
}

section('The landing page was actually rendered and read');
{
  /* The negative control. `#land` is hidden two different ways once the app
     boots; if either unhide stops working this file passes on nothing. */
  ok(landing.dark.count > 100, 'the landing page shows its text in dark', landing.dark.count);
  ok(landing.light.count > 100, 'and in light', landing.light.count);
}

section('The first page a visitor sees is readable in both themes');
{
  ok(landing.dark.bad.length === 0, 'nothing on the landing page is under AA in dark',
     landing.dark.bad.slice(0, 8));
  ok(landing.light.bad.length === 0, 'nor in light', landing.light.bad.slice(0, 8));
}

section('Every dialog opened, and every dialog is readable');
{
  ok(empty.length === 0,
     'each dialog rendered text to measure - one that renders nothing is not a pass',
     empty);
  ok(dialogs.dark.length === 0, 'no dialog text is under AA in dark', dialogs.dark.slice(0, 8));
  ok(dialogs.light.length === 0,
     'nor in light - which is where the delete-account warning was 1.82:1',
     dialogs.light.slice(0, 8));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
if (report('the-first-page-and-every-dialog-are-readable') > 0) process.exitCode = 1;
done();
await app.close();
