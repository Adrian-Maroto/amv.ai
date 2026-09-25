/* "CLEARED - LOCAL MODE", SAID WHILE REQUESTS KEPT GOING OUT.  (AMV-AUD-013)

   The backend field in Settings is a per-device OVERRIDE. Clearing it stores
   an empty string, and the address getter then falls back to the one the
   deployment was built with - which is the intended meaning, written in the
   code: "Clearing it falls back to what shipped."

   The toast said something else: "Cleared - local mode". On every configured
   deployment that was false. The backend was still live and still being
   talked to, and somebody who cleared the field to STOP talking to a server was
   told that they had.

   The fix is the sentence, not the behaviour, because the behaviour was the
   designed one. What the person is told is now decided by where requests
   actually go after clearing, and the Settings pane says whether the address it
   shows is this device's override or the deployment's own - since after
   clearing, the built-in address reappears in the box, which is true and
   baffling without a word saying which it is.

   Both cases are driven: a deployment WITH a built-in backend, where "local
   mode" was the lie, and one WITHOUT, where it is the truth and must still be
   said. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* Clear the field the way the Settings button does, and capture what was said.
   `_defaultApiBase` is a function declaration, so replacing it on window
   changes what the address getter resolves to - which is how both kinds of
   deployment are produced in one browser. */
const clearWith = (builtIn) => page.evaluate((b) => {
  window._defaultApiBase = () => b;
  saveStr('amv_api_base', 'https://my-override.workers.dev');
  const box = document.getElementById('be-url') || (() => {
    const i = document.createElement('input'); i.id = 'be-url'; document.body.appendChild(i); return i;
  })();
  box.value = '';
  const said = [];
  window.toast = (m) => said.push(String(m));
  amvSaveBackend();
  return { said, base: AMV_API.base, live: AMV_API.live };
}, builtIn);

section('On a deployment with its own backend, clearing does not claim local mode');
{
  const r = await clearWith('https://api.example.workers.dev');
  ok(r.live === true && /api\.example/.test(r.base),
     'requests really do still go to the built-in backend - which is the designed behaviour', r.base);
  ok(!r.said.some(m => /local mode/i.test(m)),
     'so the person is NOT told they are in local mode - this was the finding', JSON.stringify(r.said));
  ok(r.said.some(m => /api\.example\.workers\.dev/.test(m)),
     'they are told where requests go instead, by name', JSON.stringify(r.said));
}

section('On a deployment with no backend, local mode is true and is said');
{
  const r = await clearWith('');
  ok(r.live === false && !r.base, 'there really is no backend left', JSON.stringify(r));
  ok(r.said.some(m => /local mode/i.test(m)),
     'and then, and only then, it says local mode', JSON.stringify(r.said));
}

section('The Settings pane says which address it is showing');
{
  const r = await page.evaluate(async () => {
    window._defaultApiBase = () => 'https://api.example.workers.dev';
    /* The Live / Backend pane is owner-only - it sits in ADMIN_SET_SECTIONS -
       so a normal test user never reaches it through the tab, and the first
       version of this section read a page that had no pane on it and found no
       "Status:" line at all. It is rendered directly into a host instead: what
       is under test is what the owner is TOLD, not who may open the pane. */
    const text = async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      /* And the renderer's own gate sends a non-admin to Account, which is
         right - so the second attempt rendered the Account pane and still found
         no Status line. Admin is granted for the render and taken back straight
         after; the gate is somebody else's suite, the WORDING is this one's. */
      const realIsAdmin = window.isAdmin;
      window.isAdmin = () => true;
      try { _renderSetPaneInner('backend', host); } catch (e) { host.textContent = 'RENDER FAILED ' + e.message; }
      finally { window.isAdmin = realIsAdmin; }
      await new Promise(res => setTimeout(res, 100));
      const t = host.innerText || host.textContent || '';
      host.remove();
      return t;
    };
    saveStr('amv_api_base', '');
    const builtIn = await text();
    saveStr('amv_api_base', 'https://my-override.workers.dev');
    const override = await text();
    return { builtIn, override };
  });
  ok(/built-in backend/i.test(r.builtIn),
     'with no override, it says the address is the deployment’s built-in one',
     (r.builtIn.match(/Status:[^\n]*/) || [''])[0]);
  ok(/set on this device/i.test(r.override),
     'with an override, it says the address was set on this device',
     (r.override.match(/Status:[^\n]*/) || [''])[0]);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
