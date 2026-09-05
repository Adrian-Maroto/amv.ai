/* SIGNED OUT, IN FRONT OF TWELVE CONNECT BUTTONS.

   The Integrations TAB is gated: a signed-out visitor pressing it in the
   sidebar gets the sign-up sheet and "Create a free account to use
   Integrations". The SAME catalogue reached through Settings had no gate,
   because the gate lives in the tab router and Settings does not go through
   it.

   Measured before the fix, signed out: twelve Connect buttons, every one of
   them enabled, nothing on the screen saying an account was needed, and
   pressing one produced a message written for the operator - "Slack isn't
   connected yet. It needs its API key added by the operator in Settings
   first." True, unactionable, and silent about the one thing the person
   reading it could actually do.

   Two things are checked here, because either alone leaves the fault: that
   the press now leads to sign-up, and that the screen says so BEFORE the
   press. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'settings' });
const { page, errors } = app;

/* Genuinely signed out, and re-rendered afterwards - the catalogue reads
   S.user while it builds, so clearing it without re-rendering would leave the
   signed-in markup on screen and every assertion below would be about the
   wrong page. */
const openCatalogue = () => page.evaluate(async () => {
  S.user = null;
  try { localStorage.removeItem('amv_user'); } catch (e) {}
  try { updateSbUser(); } catch (e) {}
  S.settingsPane = 'integrations';
  renderSetPane();
  await new Promise(r => setTimeout(r, 400));
});

section('It says an account is needed before anything is pressed');
{
  await openCatalogue();
  const v = await page.evaluate(() => {
    const g = document.querySelector('.int-guest');
    const cs = g && getComputedStyle(g);
    const btn = g && g.querySelector('[data-auth="signup"]');
    return {
      present: !!g,
      text: g ? g.textContent : '',
      /* The class shipped with a rule, which is the failure mode a whole gate
         stage and two CSS layers in this repo exist for. */
      styled: !!(cs && cs.padding !== '0px' && cs.borderStyle !== 'none'),
      btnText: btn ? btn.textContent.trim() : null,
      btnTall: btn ? !__under(btn.getBoundingClientRect().height, 40) : false,
      /* And it is above the rows, not after twelve of them. */
      beforeRows: !!(g && document.querySelector('.int-card')
        && (g.compareDocumentPosition(document.querySelector('.int-card')) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  });
  ok(v.present, 'a signed-out visitor is told, on the screen', v.present);
  ok(/free account/i.test(v.text), 'in the same words the rest of the product uses', v.text.slice(0, 60));
  ok(v.styled, 'and the panel has a rule, rather than rendering as loose text');
  ok(v.btnText === 'Create a free account', 'with the action in it', v.btnText);
  ok(v.btnTall, 'big enough to hit on a phone');
  ok(v.beforeRows, 'above the rows, not after twelve of them');
}

section('And the rows are still readable, because that is a fair question');
{
  /* Deliberately NOT disabled. What an integration does is worth knowing
     before signing up - the same reasoning that keeps Crew browsable to a
     signed-out visitor. The gate is on the press, not on the reading. */
  const v = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-int-conn]')];
    return {
      rows: document.querySelectorAll('.int-card').length,
      names: [...document.querySelectorAll('.int-name')].slice(0, 3).map(n => n.textContent),
      descs: [...document.querySelectorAll('.int-desc')].filter(d => d.textContent.trim().length > 10).length,
      enabled: btns.filter(b => !b.disabled).length,
    };
  });
  ok(v.rows >= 10, 'the catalogue still renders every row', v.rows);
  ok(v.descs >= 10, 'each still says what it does', v.descs);
  ok(v.names.length === 3, 'and is named', v.names);
}

section('Pressing Connect leads to sign-up, not to an operator instruction');
{
  const r = await page.evaluate(async () => {
    window.__opened = null;
    const realOpen = window.openAuth;
    window.openAuth = (m) => { window.__opened = m; };
    const b = document.querySelector('[data-int-conn="slack"]');
    b.click();
    await new Promise(r => setTimeout(r, 400));
    const toast = [...document.querySelectorAll('.toast, #toast, [class*="toast"]')]
      .map(t => t.textContent).join(' ');
    window.openAuth = realOpen;
    return { opened: window.__opened, toast };
  });
  ok(r.opened === 'signup', 'the sign-up sheet is what opens', r.opened);
  ok(/Create a free account to connect/i.test(r.toast),
     'and the message names the thing they were trying to connect', r.toast.slice(0, 90));
  ok(/Slack/.test(r.toast), 'by the name on the row', r.toast.slice(0, 90));
  ok(!/operator/i.test(r.toast),
     'rather than telling them about an API key they cannot set', r.toast.slice(0, 120));
}

section('Every connect path, not just the OAuth ones');
{
  /* Mail and Telegram open their own connect sheets and are branched on BEFORE
     connectIntegration, so a gate placed after those branches would have let
     both through - somebody with no account attaching a mailbox password. */
  for (const [id, label] of [['mail', 'mailbox'], ['telegram', 'Telegram'], ['google', 'Google']]) {
    const r = await page.evaluate(async (which) => {
      window.__opened = null;
      const realOpen = window.openAuth;
      window.openAuth = (m) => { window.__opened = m; };
      const before = document.querySelectorAll('.ov, .ovr-card, #ovr > *').length;
      const b = document.querySelector('[data-int-conn="' + which + '"]');
      if (b) b.click();
      await new Promise(r => setTimeout(r, 350));
      const after = document.querySelectorAll('.ov, .ovr-card, #ovr > *').length;
      window.openAuth = realOpen;
      return { found: !!b, opened: window.__opened, sheetGrew: after > before };
    }, id);
    ok(r.found, `the ${label} row is there to press`, r.found);
    ok(r.opened === 'signup', `pressing ${label} asks for an account`, r.opened);
    ok(!r.sheetGrew, `and its own connect sheet did NOT open`, r.sheetGrew);
  }
}

section('Signed in, none of this is in the way');
{
  const v = await page.evaluate(async () => {
    S.user = { name: 'Owner', email: 'owner@amv.test', ini: 'O', provider: 'email' };
    try { updateSbUser(); } catch (e) {}
    renderSetPane();
    await new Promise(r => setTimeout(r, 400));
    window.__opened = null;
    const realOpen = window.openAuth;
    window.openAuth = (m) => { window.__opened = m; };
    const b = document.querySelector('[data-int-conn="slack"]');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 300));
    window.openAuth = realOpen;
    return { banner: !!document.querySelector('.int-guest'), opened: window.__opened };
  });
  ok(v.banner === false, 'the panel is gone', v.banner);
  ok(v.opened === null, 'and Connect does not ask an account holder to make an account', v.opened);
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

report('guest settings');
done();
