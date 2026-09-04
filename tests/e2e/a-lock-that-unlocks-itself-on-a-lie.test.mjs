/* THE COMPOSER LET ITSELF BACK IN AFTER AN HOUR THAT MEANT NOTHING.

   The chat read `err.resetAt || (Date.now() + 3600000)`. Two of the four
   monthly refusals send no reset time - the account spend ceiling and the
   family ceiling - so somebody who had used a whole BILLING CYCLE was shown a
   live countdown saying it came back in 59 minutes, with the server's own
   sentence discarded to make room for the number. Sixty minutes later the
   timer fired `quotaUnlock`, which toasts "Your usage has reset - you're good
   to go", re-enables the composer, and hands them straight back into the same
   refusal.

   Underneath it, one variable was doing two jobs: `_quotaLockUntil` was both
   "are we locked" and "until when", so "locked, reset unknown" could not be
   represented - and an unrepresentable state is how a fabricated value gets
   in. They are separate now.

   And `family_cap` was not even in the list of quota codes, so a child who hit
   the limit their PARENT set got the generic error card with a Retry button:
   the one action that cannot work, offered instead of the true one. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'chat', user: { name: 'Ada', email: 'ada@x.com', ini: 'A' } });
try {
  await app.connect();

  /* Drive the real functions rather than a whole turn: the defect is entirely
     in what the lock does with a reset time, and a stubbed 429 through the
     stream path would test the stub. */
  const lockState = () => app.page.evaluate(() => ({
    locked: quotaLocked(),
    notice: (document.getElementById('quota-notice') || {}).innerText || '',
    boxDisabled: !!(document.getElementById('mta') || {}).disabled,
    placeholder: (document.getElementById('mta') || {}).placeholder || '',
  }));

  section('A refusal that names a reset time still counts down to it');
  {
    const st = await app.page.evaluate(async () => {
      quotaUnlock();
      quotaLock(Date.now() + 3 * 3600000, 'Daily usage limit reached.');
      return { notice: document.getElementById('quota-notice').innerText, locked: quotaLocked() };
    });
    ok(st.locked === true, 'it locks', st.locked);
    ok(/resets in/.test(st.notice), 'and counts down, because there is something to count to', st.notice);
    ok(/hour/.test(st.notice), 'in real units', st.notice);
  }

  section('A refusal with no reset time locks without inventing one');
  {
    const st = await app.page.evaluate(async () => {
      quotaUnlock();
      quotaLock(0, 'You’ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.');
      return { notice: document.getElementById('quota-notice').innerText,
               locked: quotaLocked(),
               disabled: document.getElementById('mta').disabled,
               ph: document.getElementById('mta').placeholder };
    });
    ok(st.locked === true, 'it still locks - unknown is not unlocked', st.locked);
    ok(!/resets in/.test(st.notice), 'and shows no countdown', st.notice);
    ok(!/minute|hour/.test(st.notice), 'so no fabricated duration reaches the screen', st.notice);
    ok(/billing cycle|next month/i.test(st.notice),
       'it repeats what the server actually said instead', st.notice);
    ok(st.disabled === true, 'the composer is closed');
    ok(/billing period/i.test(st.ph), 'and says why, rather than counting', st.ph);
  }

  section('And it does not let itself back in');
  /* The heart of it. The timer used to unlock on any `Date.now() >= until`,
     and an unknown reset stored as 0 is permanently in the past - so the lock
     would release on the very next tick even without the invented hour. */
  {
    const st = await app.page.evaluate(async () => {
      quotaUnlock();
      quotaLock(0, 'It resets next month.');
      /* Run the tick the interval runs, rather than waiting 30 seconds for it:
         the behaviour under test is the condition, not the delay. */
      const before = quotaLocked();
      for (let i = 0; i < 3; i++) { _renderQuotaNotice(); }
      return { before, after: quotaLocked(),
               noticeStillThere: !!document.getElementById('quota-notice'),
               disabled: document.getElementById('mta').disabled };
    });
    ok(st.before === true && st.after === true, 'still locked after the ticks', st);
    ok(st.noticeStillThere === true, 'the notice stays up', st.noticeStillThere);
    ok(st.disabled === true, 'and the composer stays closed', st.disabled);
  }

  section('A known reset really does expire, or the lock would be permanent');
  {
    const st = await app.page.evaluate(async () => {
      quotaUnlock();
      quotaLock(Date.now() + 40, 'Daily usage limit reached.');
      const before = quotaLocked();
      await new Promise(r => setTimeout(r, 90));
      return { before, after: quotaLocked() };
    });
    ok(st.before === true, 'locked while the time is in the future', st.before);
    ok(st.after === false, 'and open once it passes', st.after);
  }

  section('The card offers a child the action that can actually work');
  {
    const r = await app.page.evaluate(async () => {
      quotaUnlock();
      const msgs = [{ r: 'u', c: 'hello' },
                    { r: 'a', c: '', _quota: true, _resetAt: 0, _quotaCode: 'family_cap',
                      _quotaMsg: 'You have used the monthly limit set for your account. It resets next month, or whoever manages your family can raise it.' }];
      setMsgs(msgs); renderChatMsgs();
      const el = document.querySelector('.quota-card');
      return { text: el ? el.innerText : '', html: el ? el.innerHTML : '' };
    });
    ok(/quota|out of usage/i.test(r.text), 'it is the quota card, not the red error card', r.text.slice(0, 120));
    ok(/manages your family/i.test(r.text), 'and it names who can lift it', r.text.slice(0, 250));
    ok(!/Upgrade to/.test(r.text), 'without offering a plan that would not lift it', r.text.slice(0, 250));
    ok(!/data-action="quota-upgrade"/.test(r.html), 'so there is no upgrade button to press', r.html.slice(0, 200));
  }

  section('An ordinary quota card still sells the upgrade');
  /* The family case must not have quietly removed the upgrade path for
     everybody else - that is the whole revenue moment. */
  {
    const r = await app.page.evaluate(async () => {
      const msgs = [{ r: 'u', c: 'hello' },
                    { r: 'a', c: '', _quota: true, _resetAt: Date.now() + 7200000, _quotaCode: 'quota_day' }];
      setMsgs(msgs); renderChatMsgs();
      const el = document.querySelector('.quota-card');
      return { text: el ? el.innerText : '', html: el ? el.innerHTML : '' };
    });
    ok(/Upgrade to/.test(r.text), 'the upgrade is offered', r.text.slice(0, 200));
    ok(/resets in/.test(r.text), 'with the real countdown', r.text.slice(0, 200));
    ok(/I’ll wait|I'll wait/.test(r.text), 'and waiting is a sensible offer here', r.text.slice(0, 200));
  }

  section('A card with no known reset does not say "under a minute"');
  /* What the old fallback rendered: `m._resetAt || _quotaLockUntil || Date.now()`
     minus now is zero, and zero formats as "under a minute" - the shortest
     possible lie about a monthly allowance. */
  {
    const r = await app.page.evaluate(async () => {
      quotaUnlock();
      const msgs = [{ r: 'u', c: 'hello' },
                    { r: 'a', c: '', _quota: true, _resetAt: 0, _quotaCode: 'quota_month',
                      _quotaMsg: 'You’ve used your full plan allowance for this billing cycle. It resets next month, or upgrade for more.' }];
      setMsgs(msgs); renderChatMsgs();
      const el = document.querySelector('.quota-card');
      return el ? el.innerText : '';
    });
    ok(!/under a minute/i.test(r), 'it does not', r.slice(0, 250));
    ok(!/resets in/.test(r), 'and offers no countdown at all', r.slice(0, 250));
    ok(/billing cycle/i.test(r), 'it says what the server said', r.slice(0, 250));
    ok(/Upgrade to/.test(r), 'and still offers the upgrade, which does lift this one', r.slice(0, 250));
  }

  section('And no fallback anywhere invents a duration');
  /* Read where it is WRITTEN, per LESSONS 353. The sections above drive
     `quotaLock` directly, so a fabricated value reintroduced at the CALL site
     - which is exactly where this one lived - would slip past every one of
     them. Comments stripped, so the comment explaining the removal is not
     mistaken for the removal not having happened. */
  {
    const srcApp = readFileSync(join(ROOT, 'src', 'app', '05-ui-blocks.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!/resetAt\s*\|\|\s*\(?\s*Date\.now\(\)\s*\+/.test(srcApp),
       'no "or an hour from now" behind a missing reset time',
       (srcApp.match(/.{0,50}resetAt\s*\|\|.{0,40}/) || [''])[0].trim());
    ok(/const resetAt = \+err\.resetAt \|\| 0;/.test(srcApp),
       'a reset the server did not send is zero, which the lock understands');
    ok(/srvCode==='family_cap'/.test(srcApp),
       'and the family ceiling is handled as a quota rather than an error');
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
