/* CONNECT SENT YOU SOMEWHERE THAT COULD NOT HELP.

   A job needs more than a mailbox. The money jobs need a bank; others need a
   particular app. What the product did with that was name the missing thing
   and then, on Connect, call `openCrewConnect` - which handles exactly one
   kind of requirement, an OAuth grant. A bank link is not one: it is a
   separate flow that lives with the account card. So that function fell
   through to the Connectors tab, a screen with nothing on it for a bank, and
   the jobs most likely to be missing something were the ones it served worst.

   Nothing was broken in a way anything could see. `_cwMissingNeeds` correctly
   returns no OAuth requirement for a bank; `openCrewConnect` correctly handles
   the empty case by going to Connectors. Two correct functions, composed into
   a dead end.

   WHAT THIS HOLDS:

   EVERY requirement is listed, met or not. A screen that shows only what is
   missing cannot tell somebody what a job needs in total, which is the
   question they are actually asking before they turn it on.

   EACH ONE GOES WHERE IT IS ACTUALLY CONNECTED - a bank to Spending, an app
   to the directory searched for that app, a grant to the provider. This is
   the defect, so it is checked per kind rather than "a button exists".

   AND THERE IS A WAY BACK. Asked for in as many words: connect it, press
   back, and be on the job again rather than stranded on Spending wondering
   what you were doing.

   THE PRIMARY BUTTON DOES NOT PROMISE WHAT CANNOT HAPPEN. "Turn it on" filled
   and blue over an unmet requirement is a button that saves a setting and
   changes nothing. Turning it on anyway is still offered - saving now and
   connecting later is reasonable - it is just not the loud one.

   BROKEN FIVE WAYS, AND THREE OF THEM SURVIVED THE FIRST VERSION OF THIS
   FILE. Pointing the bank at Connectors and dropping the remembered job were
   caught. The other three were gaps here, not in the product:

     every section drove cwPeek and cwNeeds directly, so reverting the CARD's
     Connect button to the OAuth-only call passed cleanly - and the card is
     where somebody meets this, the panel already being one click in;

     "every requirement is listed" ran against a job whose single requirement
     was unmet, where filtering out the met ones changes nothing. It runs
     against a job with one of each now;

     and the third mutation never applied at all - the edit script failed to
     find its anchor, printed a traceback, and the suite passed because
     nothing had been changed. A green run under a mutation that did not
     happen is evidence of nothing, which is the "attribute a catch by the
     failing assertion" rule in reverse: attribute a MISS the same way. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;
await page.waitForTimeout(300);
await page.evaluate(() => { saveStr('amv_plan', 'pro'); setTab('crew'); });
await page.waitForTimeout(700);

/* A job of each shape, found in the real catalogue rather than invented, so
   this cannot pass against jobs the product does not ship. */
const shapes = await page.evaluate(() => {
  const all = _cwAllJobs() || [];
  const pick = (re) => { const j = all.find(x => re.test(String(x.needs || ''))); return j ? j.id : ''; };
  /* A job with a requirement that is ALREADY met alongside one that is not -
     Web research is built in, so anything needing it plus a grant has both.
     Without one of these, "every requirement is listed" cannot fail: a job
     whose only need is unmet reads the same whether or not the met ones are
     filtered out. Dropping them passed until this line existed. */
  const mixed = all.find(x => /Web research/.test(String(x.needs || ''))
                           && /Email|Calendar|Drive/.test(String(x.needs || '')));
  return { bank: pick(/Bank/), mail: pick(/Email/), mixed: mixed ? mixed.id : '',
           total: all.length };
});

section('The catalogue really does have jobs needing more than a mailbox');
{
  ok(shapes.total > 20, 'there are jobs to check', shapes.total);
  ok(!!shapes.bank, 'at least one needs a bank or card', shapes.bank);
  ok(!!shapes.mail, 'and at least one needs a mailbox', shapes.mail);
  ok(!!shapes.mixed, 'and at least one has a requirement already met beside one that is not',
     shapes.mixed);
}

const openPanel = (id) => page.evaluate(async (jid) => {
  closeOvr(); await new Promise(r => setTimeout(r, 120));
  cwPeek(jid); await new Promise(r => setTimeout(r, 450));
  return {
    title: (document.querySelector('.cwp-t') || {}).textContent || '',
    block: !!document.querySelector('.cwp-need'),
    connectPrimary: !!document.getElementById('cwp-need-go2'),
    anyway: (document.getElementById('cwp-go') || {}).textContent || '',
  };
}, id);

section('A job that is not ready says so, with the way out attached');
{
  const p = await openPanel(shapes.bank);
  ok(p.block, 'the requirement is a block with a button, not a line in a list', p);
  ok(p.connectPrimary, 'and connecting is the filled action', p);
  ok(/anyway/i.test(p.anyway), 'while turning it on regardless is still offered', p.anyway);
}

const readNeeds = (jid) => page.evaluate(async (id) => {
  closeOvr(); await new Promise(res => setTimeout(res, 120));
  cwNeeds(id); await new Promise(res => setTimeout(res, 450));
  const rows = [...document.querySelectorAll('.cwn-row')];
  const plan = _cwNeedsPlan((_cwAllJobs() || []).find(x => x.id === id));
  return {
    rows: rows.length, needs: plan.length,
    met: rows.filter(x => x.classList.contains('met')).length,
    titles: rows.map(x => (x.querySelector('.cwn-n') || {}).textContent),
    kinds: rows.map(x => { const b = x.querySelector('.cwn-go'); return b ? b.dataset.cwnKind : 'met'; }),
    back: !!document.getElementById('cwn-back'),
  };
}, jid);

section('The requirements screen lists all of them, met and unmet');
{
  const r = await readNeeds(shapes.mixed);
  ok(r.rows === r.needs && r.rows > 0,
     'every requirement is on it, not only the missing ones', r);
  ok(r.met > 0 && r.met < r.rows,
     'with the ones already met shown as met rather than dropped', r);
  ok(r.titles.every(t => t && t[0] === t[0].toUpperCase()),
     'each is named rather than described mid-sentence', r.titles);
  ok(r.back, 'and there is a way back to the job');
}

section('And each kind is routed as the kind it is');
{
  const r = await readNeeds(shapes.bank);
  ok(r.kinds.indexOf('bank') >= 0, 'the bank is recognised as a bank', r.kinds);
  ok(r.rows === r.needs && r.rows > 0, 'with every requirement listed here too', r);
}

section('The bank goes to Spending, which is where a bank is actually linked');
{
  /* THE DEFECT. It went to Connectors, which has nothing to offer for this. */
  const r = await page.evaluate(async () => {
    document.querySelector('.cwn-go[data-cwn-kind="bank"]').click();
    await new Promise(res => setTimeout(res, 700));
    return { tab: S.tab, onSpend: !!document.querySelector('.spv-t'),
             hasAccountCard: !!document.getElementById('spv-bank') };
  });
  ok(r.tab === 'spend' && r.onSpend, 'it lands on Spending', r);
  ok(r.hasAccountCard, 'where the card that links an account actually is', r);
}

section('And the job is remembered, so finishing comes back to it');
{
  const r = await page.evaluate(async (jid) => {
    /* Read as the object it is. It carries a timestamp beside the job,
       because a note left an hour ago by somebody who changed their mind is
       not permission to reopen anything - the same rule `_cwConnWant`
       already follows. */
    const before = load('amv_cw_resume');
    const came = cwResumeIfAny();
    await new Promise(res => setTimeout(res, 450));
    const after = load('amv_cw_resume');
    return { remembered: before && before.job, stamped: !!(before && before.at),
             came, onNeeds: !!document.getElementById('cwn-back'),
             again: after && after.job, want: jid };
  }, shapes.bank);
  ok(r.remembered === r.want, 'the job was written down before leaving', r);
  ok(r.stamped, 'with a time on it, so a note left an hour ago is not still standing', r);
  ok(r.came && r.onNeeds, 'and coming back reopens what it needs', r);
  ok(!r.again, 'once - a stale note is not a standing instruction', r);
}

section('Back from the requirements screen is the job, not the void');
{
  const r = await page.evaluate(async (jid) => {
    cwNeeds(jid); await new Promise(res => setTimeout(res, 400));
    document.getElementById('cwn-back').click();
    await new Promise(res => setTimeout(res, 450));
    return { title: (document.querySelector('.cwp-t') || {}).textContent || '' };
  }, shapes.bank);
  ok(r.title.length > 3, 'back lands on the job panel it came from', r);
}

section('A job needing only a mailbox still gets the grant flow');
{
  const r = await page.evaluate(async (jid) => {
    closeOvr(); await new Promise(res => setTimeout(res, 120));
    cwNeeds(jid); await new Promise(res => setTimeout(res, 400));
    return { kinds: [...document.querySelectorAll('.cwn-go')].map(b => b.dataset.cwnKind),
             rows: document.querySelectorAll('.cwn-row').length };
  }, shapes.mail);
  ok(r.rows > 0, 'it has requirements', r);
  ok(r.kinds.indexOf('oauth') >= 0, 'and the mailbox is routed as a grant, not as a bank', r.kinds);
}

section('The Connect button ON THE CARD goes there too');
{
  /* THE ONE THE DEFECT WAS ACTUALLY ON, and the first version of this file
     never pressed it - every other section drives cwPeek and cwNeeds
     directly, so putting the old OAuth-only call back passed cleanly. The
     card is where somebody meets this: the panel is already one click in. */
  const r = await page.evaluate(async (jid) => {
    closeOvr(); await new Promise(res => setTimeout(res, 150));
    setTab('crew'); await new Promise(res => setTimeout(res, 700));
    const btn = document.querySelector('.cw-job-fix[data-darg="' + jid + '"]');
    if (!btn) return { noButton: true };
    btn.click();
    await new Promise(res => setTimeout(res, 600));
    return {
      onNeeds: !!document.getElementById('cwn-back'),
      rows: document.querySelectorAll('.cwn-row').length,
      kinds: [...document.querySelectorAll('.cwn-go')].map(b => b.dataset.cwnKind),
    };
  }, shapes.bank);
  ok(!r.noButton, 'the card offers a way to fix what is missing', r);
  ok(r.onNeeds && r.rows > 0, 'and it opens what the job needs', r);
  ok(r.kinds.indexOf('bank') >= 0,
     'routed as a bank, rather than at a grant flow that has nothing for one', r.kinds);
}

ok(errors.length === 0, 'and none of it raised an error', errors);
await app.close();
process.exit(report() === 0 ? (done(), 0) : 1);
