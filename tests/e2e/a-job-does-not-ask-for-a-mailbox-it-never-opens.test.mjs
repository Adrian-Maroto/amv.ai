/* "GMAIL SHOULD PRIMARILY ONLY BE FOR GMAIL TASKS - SUMMARISING, REPLYING,
   SENDING. SO MANY OF THESE SAY GMAIL WHEN IT SHOULDN'T."

   Forty-four of a hundred and seven catalogue jobs declared they needed Email.
   Some of them genuinely do: package tracking really does read shipping
   confirmations, and an inbox digest is nothing else. But a large group asked
   for a mailbox purely because that is where the ANSWER was going to be sent -
   and where the answer goes is the notify setting, not a permission somebody
   has to grant.

   The difference matters twice over. Asking for a mailbox somebody does not
   need is the most alarming thing AMV can ask for, on a card they were only
   browsing; and it buries the jobs that genuinely need one in a crowd, so the
   request stops meaning anything.

   THE RULE THIS HOLDS: a job may declare Email only if its own instruction
   says it reads or writes mail. The instruction is the honest witness - it is
   what the runner actually executes - so the declaration is checked against
   it rather than against a hand-kept list.

   AND THE REGEX IS TESTED BEFORE IT IS TRUSTED. Getting here took three
   attempts. The first missed "emails" because \bemail\b does not match a
   plural. The second was so tight it flagged package tracking and VIP alerts,
   which do read mail. Both would have driven a wrong edit across a hundred
   entries with great confidence. So the pattern is exercised on its own known
   cases first, in this file, and a change to it has to keep passing those
   before it is allowed to judge the catalogue. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

/* Reads or writes mail. Plurals included, which is where this went wrong. */
const MAIL = /(e-?mails?|inbox(?:es)?|mailbox(?:es)?|\bmail\b|correspondence|receipts?|invoices?|messages?|repl(?:y|ies|ied))/i;

section('The pattern is right about the cases that fooled two earlier versions');
{
  const must = [
    'From order and shipping confirmation emails, list every package',
    'Watch incoming mail for genuinely urgent items',
    'Summarize the user recent mail into the messages that need them',
    'Review receipts and invoices since the last run',
    'Find people awaiting a reply from the user',
    'Compile the week from what they and their correspondence record',
  ];
  const mustNot = [
    'Search the live web now and report what happened overnight',
    'For each user goal: assess progress since the last check',
    'Maintain a spaced repetition schedule over the stated study material',
    'Check the public accounts the user named for new posts',
  ];
  must.forEach(t => ok(MAIL.test(t), 'reads mail: ' + t.slice(0, 44)));
  mustNot.forEach(t => ok(!MAIL.test(t), 'does not: ' + t.slice(0, 44)));
}

const app = await bootApp({ tab: 'crew', user: { name: 'A', email: 'a@amv.dev', ini: 'A' } });
const { page, errors } = app;
await page.evaluate(() => document.getElementById('ck')?.remove());

section('No catalogue job asks for a mailbox its instruction never opens');
{
  const jobs = await page.evaluate(() => (_cwAllJobs() || []).map(j => ({
    id: j.id, needs: String(j.needs || ''), prompt: String(j.prompt || ''), desc: String(j.desc || ''),
  })));
  ok(jobs.length > 80, 'the catalogue was read', jobs.length);

  const claiming = jobs.filter(j => j.needs.split(',').map(x => x.trim()).includes('Email'));
  ok(claiming.length > 0, 'and some jobs do declare Email, as they should', claiming.length);

  const src = new RegExp(MAIL.source, 'i');
  const unjustified = claiming.filter(j => !src.test(j.prompt) && !src.test(j.desc));
  ok(unjustified.length === 0,
     'every job declaring Email says somewhere that it reads or writes mail',
     unjustified.map(j => j.id).join(', ') || 'none');
}

section('And the ones that were corrected no longer ask');
{
  const r = await page.evaluate(() => {
    const want = ['job_hunt','morning_brief','competitor_watch','opportunity_radar',
                  'account_watch','goal_tracker','study_drill','habit_pulse'];
    const all = _cwAllJobs() || [];
    return want.map(id => { const j = all.find(x => x.id === id);
      return { id, needs: j ? String(j.needs || '') : 'MISSING' }; });
  });
  r.forEach(j => {
    ok(j.needs !== 'MISSING', j.id + ' is still in the catalogue', j.needs);
    ok(!j.needs.split(',').map(x => x.trim()).includes('Email'),
       j.id + ' no longer asks for a mailbox', j.needs);
  });
}

section('A job that really does read mail still asks for it');
{
  /* The other half of the rule. An edit that stripped Email everywhere would
     pass the check above and break the jobs the mailbox exists for. */
  const r = await page.evaluate(() => {
    const all = _cwAllJobs() || [];
    return ['inbox_digest','deliveries','vip_alerts','tax_catch','inbox_cleanup']
      .map(id => { const j = all.find(x => x.id === id);
        return { id, has: !!j && String(j.needs || '').split(',').map(x => x.trim()).includes('Email') }; });
  });
  r.forEach(j => ok(j.has, j.id + ' still declares the mailbox it opens'));
}

ok(errors.length === 0, 'no page errors', errors.join(' | '));
await app.close();
report();
done();
