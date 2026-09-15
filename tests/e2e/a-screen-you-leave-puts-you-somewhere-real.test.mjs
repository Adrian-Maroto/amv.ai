/* THREE WAYS TO LAND NOWHERE.

   All three are the same shape: a destination named by hand, in a second
   place, that nothing checked was a destination at all.

   1. CLOSING A SPREADSHEET SENT YOU TO CREW. The sheet editor writes straight
      into #vc without touching S.tab, so nothing recorded where it was opened
      from, and its Close button carried a fixed `data-stab="extensions"`.
      `extensions` is a tab id the sidebar never shows and the renderer maps to
      the Crew view - so closing a CSV you opened from chat put you on a page
      about autonomous jobs, titled Extensions. Nothing threw; it just was not
      where anybody had been.

   2. AN OWNER-ONLY PANE RENDERED FOR EVERYBODY. The Settings gate listed the
      admin panes by hand beside ADMIN_SET_SECTIONS, which lists them too. They
      had drifted by one: `widget` - the pane that configures the chat bubble
      somebody embeds on their own website - was in the sections and not in the
      gate, so it rendered in full for any account that reached it. The gate now
      reads the section list, so the two cannot disagree again.

   3. AN ID NOTHING RENDERS SHOWED AN EMPTY COLUMN. A retired or mistyped pane
      fell off the end of the chain and left the content area blank, while the
      picker beside it - which does fall back - read "Account". Two halves of
      one screen disagreeing about what was open.

   Each case is checked by where it LANDS, not by which branch ran: a fix that
   changes the routing and still leaves you on the wrong screen fails here. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('Closing the spreadsheet editor returns to the screen it was opened from');
{
  for (const from of ['chat', 'dashboard', 'usage']) {
    const r = await page.evaluate(async (from) => {
      setTab(from);
      await new Promise(r => setTimeout(r, 250));
      const opened = S.tab;
      openSheetEditor([['name', 'qty'], ['pens', '3']], 'order.csv');
      const inEditor = /order\.csv/.test(document.getElementById('vc').innerText || '');
      const btn = [...document.querySelectorAll('#vc button')]
        .find(b => /Close/.test(b.textContent || ''));
      if (!btn) return { opened, inEditor, noButton: true };
      btn.click();
      await new Promise(r => setTimeout(r, 350));
      return { opened, inEditor, landed: S.tab,
               text: (document.getElementById('vc').innerText || '').trim().slice(0, 40) };
    }, from);
    ok(r.inEditor === true, 'the editor opened over ' + from, r);
    ok(r.landed === r.opened,
       'closing it from ' + from + ' goes back to ' + from, r);
    ok(!/CREW|AUTONOMOUS WORK/.test(r.text || ''),
       'and never lands on the Crew page', r);
  }
}

section('The owner-only Settings panes are refused to everybody else');
{
  const asUser = await page.evaluate(async () => {
    S.user = { name: 'Test', email: 'test@amv.dev', ini: 'T' };
    const out = {};
    for (const p of ADMIN_SET_SECTIONS.map(s => s.id).filter(Boolean)) {
      S.settingsPane = p; setTab('settings');
      await new Promise(r => setTimeout(r, 260));
      out[p] = { landed: S.settingsPane,
                 head: (document.getElementById('set-pane') || { innerText: '' })
                         .innerText.trim().split('\n')[0] || '' };
    }
    return { admin: isAdmin(), out };
  });
  ok(asUser.admin === false, 'the test account is not the owner', asUser.admin);
  for (const [p, r] of Object.entries(asUser.out)) {
    ok(r.landed === 'account',
       'a normal account asking for the ' + p + ' pane gets Account', { p, ...r });
    ok(/Account/.test(r.head),
       'and the pane it reads is Account, not ' + p, { p, ...r });
  }
  /* The gate is only worth having if it is the ONE list. A pane the sections
     offer and the gate has never heard of is the exact defect this was. */
  const sameList = await page.evaluate(() =>
    ADMIN_SET_SECTIONS.map(s => s.id).filter(Boolean).indexOf('widget') >= 0);
  ok(sameList === true, 'widget is one of the owner-only sections', sameList);
}

section('The owner still reaches every one of them');
{
  const asOwner = await page.evaluate(async () => {
    S.user = { name: 'Owner', email: OWNER_EMAIL, ini: 'O' };
    const out = {};
    for (const p of ADMIN_SET_SECTIONS.map(s => s.id).filter(Boolean)) {
      S.settingsPane = p; setTab('settings');
      await new Promise(r => setTimeout(r, 260));
      out[p] = { landed: S.settingsPane,
                 len: (document.getElementById('set-pane') || { innerHTML: '' }).innerHTML.length };
    }
    return { admin: isAdmin(), out };
  });
  ok(asOwner.admin === true, 'the owner email is the owner', asOwner.admin);
  for (const [p, r] of Object.entries(asOwner.out)) {
    ok(r.landed === p, 'the owner opening ' + p + ' gets ' + p, { p, ...r });
    ok(r.len > 200, 'and it has content', { p, ...r });
  }
}

section('A pane id nothing renders falls back instead of showing nothing');
{
  const r = await page.evaluate(async () => {
    S.user = { name: 'Test', email: 'test@amv.dev', ini: 'T' };
    const out = {};
    for (const p of ['notifications', 'data', 'zzz-retired', '']) {
      S.settingsPane = p; setTab('settings');
      await new Promise(r => setTimeout(r, 260));
      const pane = document.getElementById('set-pane') || { innerHTML: '', innerText: '' };
      const picker = document.getElementById('set-picker');
      out[p || '(empty)'] = {
        landed: S.settingsPane,
        len: pane.innerHTML.length,
        head: (pane.innerText || '').trim().split('\n')[0] || '',
        picker: picker ? (picker.innerText || '').trim() : '',
      };
    }
    return out;
  });
  for (const [p, v] of Object.entries(r)) {
    ok(v.len > 200, 'asking for ' + p + ' renders a pane, not an empty column', { p, ...v });
    ok(v.landed === 'account', 'and settles on account', { p, ...v });
    /* The picker and the pane are the two halves that disagreed. */
    ok(v.picker === '' || /Account/i.test(v.picker),
       'the picker agrees with what is on screen for ' + p, { p, ...v });
  }
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
