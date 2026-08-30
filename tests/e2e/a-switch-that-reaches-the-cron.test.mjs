/* THE SWITCH THAT SAYS "RUNS WHILE AMV IS CLOSED" HAS TO REACH THE CRON.

   Crew's whole promise is work that happens while nobody is watching, and the
   only thing standing behind that promise is a chain of five links:

     the toggle -> _cwToggleReal -> _scheduleTask -> /auto/create -> the `auto`
     record -> runDueAutomations, which the cron calls every five minutes

   Every link was tested. The chain was not. And it has been broken before:
   the note beside _mcScheduleServer records that this used to post to
   /api/schedule/create, "a route the worker has never had", so every job
   created from Crew was registered nowhere and ran only while AMV was open -
   and nothing said so, because the call was fired and forgotten.

   That is the failure this file exists to catch on the third occurrence
   rather than the third report. It drives the real switch in a real browser
   against the real Worker, and then asks the cron's own scan whether it can
   see the work - not whether some function was called.

   The one thing stubbed is the setup question, because every unattended job
   in the catalogue asks one and a modal is not what is being tested. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* A second view of the same Worker source, exporting the cron's own scan. The
   two module instances share no variables - they share the ENV, which is the
   only thing runDueAutomations reads, and is exactly the store the browser
   just wrote through. */
const dir = join(ROOT, 'tests/e2e/.build');
mkdirSync(dir, { recursive: true });
const harness = join(dir, 'cronreach.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { runDueAutomations, DB, scan, SCAN_ALL };\n');
const W = await import(harness + '?t=' + Date.now());

const env = makeEnv();
const outbound = makeOutbound();
const L = await bootLive({ env, outbound, port: 9237 });
const { page } = L;

const EMAIL = 'cron@example.com';
const PW = 'A-real-Passw0rd!';
await page.evaluate(async ([em, pw]) => {
  openAuth('signup');
  await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Cron'); type('#a-email', em); type('#a-pass', pw);
  document.getElementById('auth-submit').click();
  await __amvSignedIn();
}, [EMAIL, PW]);

/* A PAID ACCOUNT, BECAUSE THAT IS WHO THIS FEATURE IS FOR.

   Running work on a schedule is a Pro capability, and a free account is told
   so and refused - correctly. A first run of this file was refused exactly
   that way, which is the product working. So the plan is set on BOTH sides:
   the server decides from the entitlement record, and the client reads its own
   copy to know how many jobs the plan allows. Setting only one leaves the two
   disagreeing, which is its own bug and not the one being tested here. */
await W.DB.put(L.env, 'ent', EMAIL, { plan: 'pro' });
await page.evaluate(() => { saveStr('amv_plan', 'pro'); });

section('There is a job that claims it runs with AMV closed');
let jobId = '';
{
  const pick = await page.evaluate(() => {
    const ready = (_cwAllJobs() || []).filter(j => _cwUnattendedReady(j));
    return { count: ready.length, id: ready.length ? ready[0].id : '', title: ready.length ? ready[0].title : '' };
  });
  ok(pick.count > 0, 'the catalogue has jobs that claim to run unattended', pick.count);
  ok(!!pick.id, 'and one is picked to switch on', pick.title);
  jobId = pick.id;
}

section('Switching it on creates work the server knows about');
{
  const on = await page.evaluate(async (id) => {
    /* The setup question, answered. Every unattended job asks one, and what is
       typed becomes the job's detail - so a plain answer here is the real
       shape of what a person would produce. */
    window.showTextPromptAsync = async () => 'the things I care about';
    /* Recorded so a refusal explains itself instead of arriving as a bare
       false - which is how the Pro gate above was found. */
    window.__t = []; const rt = window.toast; window.toast = (m,k)=>{ window.__t.push((k||'')+': '+m); return rt&&rt(m,k); };
    cwToggle(id);
    const stop = Date.now() + 12000;
    while (Date.now() < stop) {
      const j = (_cwJobs() || []).find(x => x.id === id);
      if (j && j.on) return { on: true, toasts: window.__t };
      await new Promise(r => setTimeout(r, 100));
    }
    const j = (_cwJobs() || []).find(x => x.id === id);
    return { on: !!(j && j.on), toasts: window.__t };
  }, jobId);
  ok(on.on, 'the switch really goes on', on);

  /* And now the half that was missing. Not "was a function called" - what is
     in the store the cron reads. */
  const rec = await W.DB.get(L.env, 'auto', EMAIL);
  ok(!!rec, 'an automation record exists for this account', !!rec);
  const items = (rec && rec.items) || [];
  ok(items.length > 0, 'with a scheduled item in it, not an empty shell', items.length);
  const it = items[0] || {};
  ok(it.active !== false, 'the item is active', it.active);
  ok(!!it.next, 'and has a next run time, which is what the scan looks for', it.next);
  ok(String(it.detail || '').length > 0, 'and carries an instruction to run', String(it.detail || '').slice(0, 60));
}

section('The cron can actually see it');
{
  /* The joint. runDueAutomations is what the scheduled handler calls every
     five minutes, and this asks it directly, at a moment when the item is due.
     Whether the run then SUCCEEDS depends on a model key this harness does not
     have - so the assertion is that the work was found, which is the link that
     has broken before. */
  const rec = await W.DB.get(L.env, 'auto', EMAIL);
  const due = ((rec && rec.items) || []).reduce((n, i) => Math.max(n, +i.next || 0), 0);
  ok(due > 0, 'there is a due time to advance to', due);

  const r = await W.runDueAutomations(L.env, due + 1000);
  ok(r && r.scanned > 0,
     'the cron scan finds the account whose switch was just turned on', r && r.scanned);

  /* And the same scan, run before anything was switched on, must NOT have
     found it - or "scanned > 0" would pass for a reason that has nothing to
     do with the switch. */
  const empty = makeEnv();
  const base = await W.runDueAutomations(empty, due + 1000);
  ok(base && base.scanned === 0,
     'and finds nothing in an account where nothing was switched on', base && base.scanned);
}

section('Turning it off takes the work back out');
{
  const off = await page.evaluate(async (id) => {
    cwToggle(id);
    const stop = Date.now() + 12000;
    while (Date.now() < stop) {
      const j = (_cwJobs() || []).find(x => x.id === id);
      if (j && !j.on) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }, jobId);
  ok(off, 'the switch goes off', off);

  const rec = await W.DB.get(L.env, 'auto', EMAIL);
  const live = ((rec && rec.items) || []).filter(i => i && i.active !== false);
  ok(live.length === 0,
     'and no active scheduled work is left behind, so it stops costing money too', live.length);
}

section('No JavaScript errors');
ok(L.errors.length === 0, 'zero uncaught page errors', L.errors.slice(0, 3));

await L.close();
if (report('a-switch-that-reaches-the-cron') > 0) process.exitCode = 1;
done();
