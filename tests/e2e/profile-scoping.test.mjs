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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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

section('Scheduled work does not follow you into somebody else\'s account');
{
  /* _loadSched/_saveSched used raw localStorage, which skips scoping entirely,
     so the scheduled-jobs list was shared by every account on the device.
     Signing in as somebody else showed their jobs - goal text often carries
     personal detail - and _runDueAuto then executed them under whoever was
     signed in, spending their quota on another person's work. */
  const r = await page.evaluate(async () => {
    localStorage.clear();
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    _saveSched([{ id: 's1', goal: 'Email my oncologist about the biopsy results', freq: 'daily', next: Date.now() + 1000 }]);
    const mine = _loadSched();

    loginUser({ name: 'B', email: 'b@x.com', ini: 'B' });
    const theirs = _loadSched();

    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    const backAgain = _loadSched();
    return { mine: mine.length, theirs: theirs.length, backAgain: backAgain.length,
             raw: localStorage.getItem('amv_autosched') };
  });
  ok(r.mine === 1, 'the account that scheduled it has it', r.mine);
  ok(r.theirs === 0, 'a different account on the same device does not', r.theirs);
  ok(r.backAgain === 1, 'and it is still there when the owner returns', r.backAgain);
  ok(r.raw === null, 'with nothing left at the unscoped key for the next person', r.raw);
}

section('Pausing autonomy pauses YOUR autonomy');
{
  /* Device-wide, this meant one account could stop another account's jobs -
     and, worse, resume them again. A safety control somebody else can toggle
     for you is not a safety control. */
  const r = await page.evaluate(() => {
    localStorage.clear();
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    _setAutonomyPaused(true);
    const a = _autonomyPaused();
    loginUser({ name: 'B', email: 'b@x.com', ini: 'B' });
    const b = _autonomyPaused();
    loginUser({ name: 'A', email: 'a@x.com', ini: 'A' });
    return { a, b, backAgain: _autonomyPaused() };
  });
  ok(r.a === true, 'the account that paused is paused', r.a);
  ok(r.b === false, 'another account on the device is not', r.b);
  ok(r.backAgain === true, 'and the pause survives for whoever set it', r.backAgain);
}

section('A schedule written before the change is carried over');
{
  const r = await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('amv_autosched', JSON.stringify([{ id: 'old', goal: 'legacy job', freq: 'daily' }]));
    loginUser({ name: 'C', email: 'c@x.com', ini: 'C' });
    const mine = _loadSched();
    const stillGlobal = localStorage.getItem('amv_autosched');
    loginUser({ name: 'D', email: 'd@x.com', ini: 'D' });
    return { mine: mine.length, stillGlobal, other: _loadSched().length };
  });
  ok(r.mine === 1, 'an existing schedule is not lost', r.mine);
  ok(r.stillGlobal === null, 'the shared copy is removed', r.stillGlobal);
  ok(r.other === 0, 'so the next account starts empty', r.other);
}

section('A returning session migrates too, not only a fresh sign-in');
{
  /* The session is restored straight from storage at boot and never calls
     loginUser. Migrating only there meant every existing user would have loaded
     to an empty profile, no custom instructions and no scheduled jobs - the data
     still on disk under the old key with nothing looking there. */
  const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = bundle.indexOf('const S = new Proxy(_raw');
  const before = bundle.slice(Math.max(0, at - 900), at);
  ok(/_migrateScopedKeys\(_raw\.user\.email\)/.test(before),
     'the migration runs at boot, before anything reads a scoped key', true);

  /* And it is idempotent, because it now runs in two places. */
  const r = await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('amv_instructions', 'carried over');
    loginUser({ name: 'E', email: 'e@x.com', ini: 'E' });
    const first = loadStr('amv_instructions');
    saveStr('amv_instructions', 'edited since');
    _migrateScopedKeys('e@x.com');            // a second run must not undo that
    return { first, after: loadStr('amv_instructions') };
  });
  ok(r.first === 'carried over', 'the old value is adopted once', r.first);
  ok(r.after === 'edited since',
     'and running it again does not overwrite what the account has since written', r.after);
}

ok(errors.length === 0, 'no console errors along the way', errors.slice(0, 3));

await app.close();
if (report('profile-scoping') > 0) process.exitCode = 1;
done();
