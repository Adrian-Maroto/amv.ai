/* ONE PERSON'S PROFILE STAYS ONE PERSON'S.

   The nickname AMV calls you, what you do, and your custom instructions were
   stored device-wide. On any shared machine - a family laptop, a library, a
   work desktop - the second account to sign in was greeted by the first
   person's name, assumed to do their job, and answered according to their
   instructions, because those three strings are fed straight into the system
   prompt.

   Custom instructions are exactly where somebody writes the thing they would
   not say twice. This suite is about that text never following an account it
   does not belong to. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('What one account writes, another cannot read');
{
  const r = await page.evaluate(async () => {
    localStorage.clear();
    // Account A, signed in, writes a profile.
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    saveStr('amv_nickname', 'Alex');
    saveStr('amv_work', 'Oncology nurse');
    saveStr('amv_instructions', 'I am being treated for a heart condition. Keep answers gentle.');
    const aRead = { nick: loadStr('amv_nickname'), instr: loadStr('amv_instructions') };

    // Account B signs in on the same device.
    loginUser({ name: 'B', email: 'b@x.com', ini: 'B' });
    const bRead = { nick: loadStr('amv_nickname'), work: loadStr('amv_work'),
                    instr: loadStr('amv_instructions') };
    return { aRead, bRead };
  });
  ok(r.aRead.nick === 'Alex', 'the first account has its own profile', r.aRead.nick);
  ok(!r.bRead.nick, 'the second account does not inherit the nickname', r.bRead.nick);
  ok(!r.bRead.work, 'nor the job', r.bRead.work);
  ok(!r.bRead.instr, 'nor the custom instructions', r.bRead.instr);
}

section('And the first account still has it when they come back');
{
  /* A fix that protects the second person by losing the first person's data
     is not a fix. */
  const r = await page.evaluate(() => {
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    return { nick: loadStr('amv_nickname'), work: loadStr('amv_work'),
             instr: loadStr('amv_instructions') };
  });
  ok(r.nick === 'Alex', 'the nickname is still there', r.nick);
  ok(r.work === 'Oncology nurse', 'and the job', r.work);
  ok(/heart condition/.test(r.instr || ''), 'and the instructions', !!r.instr);
}

section('A profile written before the change is carried over, once');
{
  /* Existing installs have these keys unscoped. Re-scoping alone would make
     somebody's profile appear to vanish, so the first sign-in moves it. */
  const r = await page.evaluate(() => {
    localStorage.clear();
    // Simulate the old, device-wide layout.
    localStorage.setItem('amv_nickname', 'Legacy');
    localStorage.setItem('amv_instructions', 'Old instructions');

    loginUser({ name: 'C', email: 'c@x.com', ini: 'C' });
    const mine = { nick: loadStr('amv_nickname'), instr: loadStr('amv_instructions') };
    const stillGlobal = localStorage.getItem('amv_nickname');

    loginUser({ name: 'D', email: 'd@x.com', ini: 'D' });
    const other = loadStr('amv_nickname');
    return { mine, stillGlobal, other };
  });
  ok(r.mine.nick === 'Legacy', 'the existing profile is not lost', r.mine);
  ok(r.mine.instr === 'Old instructions', 'including the instructions', r.mine.instr);
  ok(r.stillGlobal === null,
     'and the device-wide copy is removed, because leaving it IS the leak', r.stillGlobal);
  ok(!r.other, 'so the next account still sees nothing', r.other);
}

section('Device preferences are still shared, because they should be');
{
  /* The theme and language belong to the machine, not the account. Scoping
     everything would make signing in reset the screen. */
  const r = await page.evaluate(() => {
    localStorage.clear();
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    saveStr('amv_theme', 'light'); saveStr('amv_lang', 'es');
    loginUser({ name: 'B', email: 'b@x.com', ini: 'B' });
    return { theme: loadStr('amv_theme'), lang: loadStr('amv_lang') };
  });
  ok(r.theme === 'light', 'the theme carries across accounts', r.theme);
  ok(r.lang === 'es', 'and the language', r.lang);
}

section('The shared marketplace records still resolve per person');
{
  /* These are deliberately global because they are maps keyed BY EMAIL and every
     read filters by identity - the opposite pattern, and correct. Asserted so a
     future tidy-up does not "fix" them into per-user buckets and lose the
     cross-account reads they exist for. */
  const r = await page.evaluate(() => {
    localStorage.clear();
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    store('amv_market_wallet', { 'a@x.com': { balance: 12 }, 'b@x.com': { balance: 99 } });
    const a = (load('amv_market_wallet') || {})['a@x.com'];
    loginUser({ name: 'B', email: 'b@x.com', ini: 'B' });
    const seen = load('amv_market_wallet') || {};
    return { a, keys: Object.keys(seen), bBalance: (seen['b@x.com'] || {}).balance };
  });
  ok(r.a && r.a.balance === 12, 'one wallet is readable', r.a);
  ok(r.bBalance === 99, 'and the other account finds its own, from the same record', r.bBalance);
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('profile-scoping') > 0) process.exitCode = 1;
done();
