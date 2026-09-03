/* THE PAGE GAVE ITSELF ONE CHANCE AND SPENT IT BEFORE LOOKING.

   _loadPublicConfig is how a visitor's browser learns the things only the
   Worker knows: the Google client id behind "Continue with Google", and the
   Turnstile SITE key without which the captcha cannot draw itself. It is called
   exactly once, at boot.

   Its second statement was `_publicConfigDone = true` - set before reading the
   backend address, before the fetch, before knowing there was anything to do.
   So any early return burned the only attempt that would ever be made, and both
   early returns are ordinary transient conditions:

     - an empty base, on a first paint where the address had not resolved yet;
     - a fetch that simply failed, which on a school or office network behind a
       filter is a normal Tuesday.

   Neither is permanent, and both were treated as permanent. The result is
   invisible: no error, no message, the values are just absent - the Google
   button inert and the captcha's site key never arriving, on a deployment whose
   Worker was serving both correctly the whole time. Reloading looks like it
   ought to help, and sets the flag again in the same place.

   Found while chasing a missing captcha box. The owner's console reported the
   site key as absent with the Worker's /v1/public-config plainly serving it,
   which leaves only the journey between them.

   `done` now means the config arrived. A separate in-flight flag does the job
   the first one was accidentally doing - stopping two concurrent calls from
   both fetching - and neither flag survives a failure. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ apiBase: '' });
const { page, errors } = app;

/* The Worker's real answer shape, served from the test's own stub so this is
   about the page's behaviour and not about a network. */
const CONFIG = {
  ok: true,
  googleClientId: '1234-test.apps.googleusercontent.com',
  supportEmail: 'help@amv.test',
  turnstileSiteKey: '0x4AAAAAAtestsitekey',
};

async function stubConfig(mode) {
  await page.unroute('**/v1/public-config').catch(() => {});
  await page.route('**/v1/public-config', route => {
    if (mode === 'fail') return route.abort('failed');
    if (mode === 'error') return route.fulfill({ status: 500, body: '{}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) });
  });
}

const state = () => page.evaluate(() => ({
  key: localStorage.getItem('amv_turnstile_site') || '',
  gauth: localStorage.getItem('amv_gauth') || '',
}));

section('A boot with no backend address does not use up the only attempt');
{
  /* bootApp serves the page with the meta tag emptied, which is exactly the
     "address has not resolved" case. */
  await page.evaluate(() => { try { window._loadPublicConfig(); } catch (e) {} });
  await page.waitForTimeout(200);
  ok((await state()).key === '', 'nothing arrives with no address, which is correct');

  await stubConfig('ok');
  const got = await page.evaluate(async () => {
    AMV_API.base = 'https://amv-e2e.workers.dev';
    await window._loadPublicConfig();
    return localStorage.getItem('amv_turnstile_site') || '';
  });
  ok(got === CONFIG.turnstileSiteKey,
     'and once there IS an address, the config really arrives', got);
}

section('A request that failed is retried rather than remembered as the answer');
{
  await page.evaluate(() => { localStorage.removeItem('amv_turnstile_site');
                              localStorage.removeItem('amv_gauth');
                              _publicConfigDone = false; });

  await stubConfig('fail');
  await page.evaluate(async () => { await window._loadPublicConfig(); });
  ok((await state()).key === '', 'a dropped connection leaves nothing, as it must');

  /* The school filter case: the network comes back, and the page must be able
     to ask again. Before this, it could not - for the life of the tab. */
  await stubConfig('ok');
  await page.evaluate(async () => { await window._loadPublicConfig(); });
  ok((await state()).key === CONFIG.turnstileSiteKey,
     'when the network recovers, the next attempt succeeds');
}

section('A server error is also not a permanent answer');
{
  await page.evaluate(() => { localStorage.removeItem('amv_turnstile_site');
                              _publicConfigDone = false; });
  await stubConfig('error');
  await page.evaluate(async () => { await window._loadPublicConfig(); });
  ok((await state()).key === '', 'a 500 stores nothing');
  await stubConfig('ok');
  await page.evaluate(async () => { await window._loadPublicConfig(); });
  ok((await state()).key === CONFIG.turnstileSiteKey, 'and the retry after it works');
}

section('A success is remembered, so the page does not re-ask for ever');
{
  await stubConfig('ok');
  let hits = 0;
  await page.unroute('**/v1/public-config').catch(() => {});
  await page.route('**/v1/public-config', route => {
    hits++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) });
  });
  await page.evaluate(async () => {
    _publicConfigDone = false;
    localStorage.removeItem('amv_turnstile_site');
    await window._loadPublicConfig();
    await window._loadPublicConfig();
    await window._loadPublicConfig();
  });
  ok(hits === 1, 'three calls after a success cost one request', hits);
}

section('Two calls at once do not both fetch');
{
  /* The property the old flag was providing by accident, kept deliberately. */
  let hits = 0;
  await page.unroute('**/v1/public-config').catch(() => {});
  await page.route('**/v1/public-config', async route => {
    hits++;
    await new Promise(r => setTimeout(r, 150));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) });
  });
  await page.evaluate(async () => {
    _publicConfigDone = false;
    localStorage.removeItem('amv_turnstile_site');
    await Promise.all([window._loadPublicConfig(), window._loadPublicConfig(), window._loadPublicConfig()]);
  });
  ok(hits === 1, 'three simultaneous callers make one request between them', hits);
  ok((await state()).key === CONFIG.turnstileSiteKey, 'and the config still lands');
}

section('What the owner types in Settings still wins');
{
  await page.evaluate(() => {
    localStorage.setItem('amv_gauth', 'my-own-staging-id');
    localStorage.removeItem('amv_turnstile_site');
    _publicConfigDone = false;
  });
  await stubConfig('ok');
  await page.evaluate(async () => { await window._loadPublicConfig(); });
  const s = await state();
  ok(s.gauth === 'my-own-staging-id',
     'a value set locally is not overwritten by the deployment default', s.gauth);
  ok(s.key === CONFIG.turnstileSiteKey, 'while the ones not set locally still arrive');
}

ok(errors.length === 0, 'no console errors', errors);

await app.close();
if (report('one-failed-attempt-is-not-a-permanent-answer') > 0) process.exitCode = 1;
done();
