/* AMV TOOK THE BLAME FOR THE VISITOR'S NETWORK.

   "Continue with Google" is the first button on the sign-up sheet. It works
   through `accounts.google.com/gsi/client`, a script in the head, `async
   defer` - so the page loads perfectly whether or not that host is
   reachable, and `window.google.accounts.id` simply never appears when it is
   not.

   Two very different things end at the same missing object: nobody has
   configured Google sign-in, or the browser could not reach Google. The
   second is neither rare nor exotic - school networks, corporate filtering
   and entire countries block it - and measured here, with a client id
   configured and the host unreachable, the script fails with
   ERR_CONNECTION_RESET after twelve seconds.

   Both cases said "Google Sign-In isn't enabled yet". For the second that is
   false: it IS enabled, the network stopped it. AMV blamed its own setup for
   something it had done correctly, and pointed the person at a fix that does
   not exist for them.

   The client id tells them apart, and AMV has it. There is no way to know
   before the tap - a script that has not arrived looks exactly like one still
   on its way - so the tap is where the distinction belongs.

   THIS SUITE RUNS WITH GOOGLE GENUINELY UNREACHABLE, which is the normal
   state of the test environment and the reason the fault was found at all. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await page.setViewportSize({ width: 390, height: 844 });

const tapGoogle = async (clientId) => {
  await page.evaluate((c) => {
    try { c ? localStorage.setItem('amv_gauth', c) : localStorage.removeItem('amv_gauth'); } catch (e) {}
    const o = document.getElementById('ovr'); if (o) { o.innerHTML = ''; o.className = ''; }
    const t = document.getElementById('toast-wrap'); if (t) t.innerHTML = '';
  }, clientId);
  await page.evaluate(() => { try { openAuth('signup'); } catch (e) {} });
  await page.waitForTimeout(450);
  const found = await page.evaluate(() => {
    const g = document.getElementById('g-btn');
    if (!g) return false; g.click(); return true;
  });
  await page.waitForTimeout(800);
  return { found, toast: await page.evaluate(() =>
    [...document.querySelectorAll('#toast-wrap *')].map(t => (t.textContent || '').trim())
      .filter(x => x.length > 3)[0] || '') };
};

section('Google really is unreachable here, which is what makes this a test');
{
  const loaded = await page.evaluate(() => !!(window.google && window.google.accounts && window.google.accounts.id));
  ok(loaded === false,
     'the GSI script did not load, so both branches below are the blocked ones', loaded);
}

section('Nobody configured it: say that');
{
  const r = await tapGoogle('');
  ok(r.found, 'the button is on the sign-up sheet', r.found);
  ok(/isn.t enabled yet/i.test(r.toast),
     'an unconfigured deployment says it is not set up', r.toast.slice(0, 90));
}

section('It IS configured and the network blocked it: say THAT instead');
{
  const r = await tapGoogle('example.apps.googleusercontent.com');
  ok(r.found, 'the button is still there', r.found);
  ok(/blocking accounts\.google\.com/i.test(r.toast),
     'the message names the network, not AMV\'s configuration', r.toast.slice(0, 120));
  ok(!/isn.t enabled yet/i.test(r.toast),
     'and does NOT claim the owner forgot to switch it on - the fault this fixes',
     r.toast.slice(0, 120));
  ok(/email/i.test(r.toast),
     'while still pointing at the door that works', r.toast.slice(0, 120));
}

section('The two messages are actually different');
{
  /* The whole defect was that they were identical. If a later edit collapses
     them again this is what notices. */
  const a = (await tapGoogle('')).toast;
  const b = (await tapGoogle('example.apps.googleusercontent.com')).toast;
  ok(a && b && a !== b, 'a configured deployment and an unconfigured one do not read alike',
     { unconfigured: a.slice(0, 46), blocked: b.slice(0, 46) });
}

section('Nothing broke');
ok(errors.length === 0, 'no JavaScript errors', errors.slice(0, 3));

await app.close();
if (report('a-blocked-google-is-not-an-unconfigured-one') > 0) process.exitCode = 1;
done();
