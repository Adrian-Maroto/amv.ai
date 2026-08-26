/* THE SAME QUESTION, ASKED OF EVERY NETWORK CALL IN THE CLIENT.

   `AMV_API._fetch` and `fetchDeadline` resolve with the Response for every
   status except 401. So `await theCall(...)` on its own succeeds identically on
   a 403, a 404, a 429 and a 500 - and every caller that then reported an
   outcome was reporting one it had not checked.

   Fixed already: the autonomy pause, the crew job toggle, both handoff calls,
   the platform kill switch, the Slack webhook, and the password reset. This
   file is the sweep that came after, and what it found:

   - REVOKING A PUBLIC SHARE LINK said "it no longer works" whatever the server
     answered. The link is public. Somebody taking back a conversation they had
     shared walks away believing they had.

   - STOPPING A SCHEDULED BANK CHECK-IN set stillRunning = false without
     looking, so the server carried on reading somebody's account while the
     screen said it had stopped. The comment directly above it describes that
     exact failure as the reason the code exists.

   - "SIGN OUT OF ALL OTHER SESSIONS" wrote a timestamp into localStorage and
     said it had done it. Nothing was sent anywhere. A correct implementation
     already existed one file away, in the Security screen.

   The last assertion is the one that matters most: it pins the WHOLE property.
   The only calls in the client allowed to discard an answer are the error
   telemetry ones, named explicitly - so the next write that forgets to look
   cannot hide among them. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('Revoking a share link that the server refuses says so');
{
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast, realFetch = AMV_API._fetch,
          realBase = AMV_API.base, realTok = AMV_API.token;
    window.toast = (m) => said.push(String(m));
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    const calls = [];
    AMV_API._fetch = async (p) => { calls.push(p); return { ok: false, status: 500, json: async () => ({ error: 'server error' }) }; };
    /* Render the manager with one shared link, then press Revoke. */
    const ovr = document.getElementById('ovr');
    ovr.innerHTML = '<div class="ob"><div id="shr-body"></div></div>';
    const body = document.getElementById('shr-body');
    body.innerHTML = '<ul class="shr-list"><li class="shr-item"><div class="shr-t">A chat</div>' +
      '<button class="btn bs shr-rev" data-id="s1">Revoke</button></li></ul>';
    body.querySelectorAll('.shr-rev').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Revoking…';
      try {
        const rr = await AMV_API._fetch('/v1/share/revoke', { method: 'POST', body: JSON.stringify({ id: b.dataset.id }) });
        const d = await rr.json().catch(() => ({}));
        if (!rr.ok || d.error) {
          b.disabled = false; b.textContent = 'Revoke';
          window.toast((d.error ? d.error + ' ' : '') + 'That link is STILL WORKING. Please try again.', 'error', 7000);
          return;
        }
        b.closest('.shr-item')?.remove();
        window.toast('Link revoked - it no longer works.', 'success', 3000);
      } catch (e) { b.disabled = false; b.textContent = 'Revoke'; window.toast('Could not revoke that link, so it is still working.', 'error', 6000); }
    }));
    body.querySelector('.shr-rev').click();
    await new Promise(r => setTimeout(r, 250));
    const stillThere = !!body.querySelector('.shr-item');
    window.toast = realToast; AMV_API._fetch = realFetch;
    AMV_API.base = realBase; AMV_API.token = realTok;
    return { said, calls, stillThere };
  });
  ok(r.calls.some(p => /share\/revoke/.test(p)), 'the server was asked', r.calls);
  ok(!r.said.some(m => /no longer works/i.test(m)),
     'it never claims the link stopped working', r.said);
  ok(r.said.some(m => /STILL WORKING/.test(m)), 'it says the link is still live', r.said);
  ok(r.stillThere, 'and the row stays, so it can be tried again', r.stillThere);
}

section('The real handler is written the same way');
{
  /* The case above drives a copy of the handler, because the manager needs a
     live share list to render. This is the shipped one. */
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = src.indexOf("'/v1/share/revoke'");
  const around = src.slice(Math.max(0, at - 400), at + 700);
  ok(at > 0, 'the revoke call was located', at > 0);
  ok(/STILL WORKING/.test(around), 'a refusal says the link is still live', /STILL WORKING/.test(around));
  ok(/const\s+\w+\s*=\s*await AMV_API\._fetch\('\/v1\/share\/revoke'/.test(around),
     'and the answer is bound rather than discarded', true);
}

section('Stopping a scheduled bank check-in checks that it stopped');
{
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = src.indexOf('const dropPrev=async()=>{');
  /* Wide enough to contain the whole helper. A window that stops mid-statement
     makes an assertion fail for the wrong reason - or worse, pass. */
  const body = src.slice(at, at + 1400);
  ok(at > 0, 'the stop path was located', at > 0);
  ok(/const\s+\w+\s*=\s*await AMV_API\._fetch\('\/auto\/update'/.test(body),
     'the answer is bound', true);
  ok(/throw new Error/.test(body),
     'and a refusal throws, so "it is still scheduled" can be said', true);
  ok(/stillRunning\s*=\s*false/.test(body.split('throw new Error')[1] || ''),
     'nothing is marked stopped before the server agreed', true);
}

section('Sign out everywhere goes to the one implementation that works');
{
  const r = await page.evaluate(async () => {
    S.settingsPane = 'account'; setTab('settings');
    await new Promise(r => setTimeout(r, 550));
    const btn = document.getElementById('signout-others');
    return { present: !!btn, label: btn ? btn.textContent.trim() : '',
             shared: typeof _actSignOutEverywhere === 'function' };
  });
  ok(r.present, 'the control is on the Account screen', r.present);
  ok(/everywhere/i.test(r.label),
     'and says everywhere, because the server ends this session too', r.label);
  ok(r.shared, 'the shared implementation exists', r.shared);

  /* It must reach the server. The old one wrote a localStorage timestamp. */
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = src.indexOf("on($('signout-others'),'click'");
  const handler = src.slice(at, at + 600);
  ok(at > 0, 'the handler was located', at > 0);
  ok(/_actSignOutEverywhere\(/.test(handler), 'it calls the real one', true);
  ok(!/saveStr\('amv_session_started'/.test(handler),
     'and no longer fakes it with a local timestamp', true);
}

section('A refused sign-out does not report a sign-out');
{
  const r = await page.evaluate(async () => {
    const said = [];
    const realToast = window.toast, realLogout = AMV_API.logout, realConfirm = window.confirm;
    const realSignOut = window.signOut;
    let signedOut = false;
    window.toast = (m) => said.push(String(m));
    window.confirm = () => true;
    window.signOut = () => { signedOut = true; };
    AMV_API.logout = async () => false;              // the server said no
    document.body.insertAdjacentHTML('beforeend', '<div id="act-say"></div>');
    /* SIGNING EVERY DEVICE OUT NOW ASKS FIRST, IN AMV'S OWN MODAL.

       It used to fall through to the action directly, because confirmModal was
       guarded by `typeof` and had never been written. It exists now, so this
       has to answer it - and it answers by pressing the real button rather than
       by stubbing the modal away, so the thing between the click and the server
       is exercised instead of skipped.

       Worth noting what happened without this: the first assertion below still
       passed. Nothing had been signed out - because nothing had run at all. A
       check that goes green because its subject never executed is the failure
       this file is named after. */
    _actSignOutEverywhere();
    await new Promise(r => setTimeout(r, 60));
    const yes = document.getElementById('cfm-yes');
    if (yes) yes.click();
    await new Promise(r => setTimeout(r, 400));
    const say = (document.getElementById('act-say') || {}).textContent || '';
    document.getElementById('act-say')?.remove();
    window.toast = realToast; AMV_API.logout = realLogout;
    window.confirm = realConfirm; window.signOut = realSignOut;
    return { said, say, signedOut, asked: !!yes };
  });
  ok(r.asked, 'it asks before signing every device out, rather than just doing it', r.asked);
  ok(!r.signedOut, 'it does not sign you out locally when nothing was revoked', r.signedOut);
  ok(/STILL SIGNED IN/.test(r.say) || /failed|nothing was changed/i.test(r.said.join(' ')),
     'and says the other sessions are still live', { say: r.say, said: r.said });
}

section('A secret Stripe key is named as one');
{
  /* The sk_ branch sat AFTER the "must start with pk_" branch, and an sk_ key
     is also not a pk_ key - so the one warning that matters was unreachable. */
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = src.indexOf("on($('save-pk'),'click'");
  const handler = src.slice(at, at + 900);
  const skAt = handler.indexOf('/^sk_/');
  const pkAt = handler.indexOf('/^pk_(test|live)_/');
  ok(at > 0 && skAt > 0 && pkAt > 0, 'both checks were located', { skAt, pkAt });
  ok(skAt < pkAt, 'the secret-key check runs first', { skAt, pkAt });
  ok(/SECRET key/.test(handler), 'and says plainly that it is a secret', true);
}

section('The version on the About screen is the real one');
{
  const r = await page.evaluate(() => {
    S.settingsPane = 'about'; renderSetPane();
    const t = (document.getElementById('set-pane') || {}).textContent || '';
    return { text: t, latest: _latestVersion(), year: String(new Date().getFullYear()) };
  });
  ok(r.text.includes('Version ' + r.latest),
     'it matches the newest release note', { shown: (r.text.match(/Version [\d.]+/) || [])[0], latest: r.latest });
  ok(r.text.includes(r.year), 'and the year is this year', r.year);
}

section('Nothing else in the client discards an answer');
{
  /* THE PROPERTY. Error telemetry is allowed to be fire-and-forget - it claims
     nothing to anybody, and a failed report must not become a second error in
     front of the user. Everything else has to look. Named explicitly so a new
     write cannot quietly join the list. */
  const ALLOWED = [/\/errors\b/, /\/errors\/resolve\b/];
  const dir = join(ROOT, 'src', 'app');
  const deaf = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
    readFileSync(join(dir, f), 'utf8').split('\n').forEach((l, i) => {
      if (!/await\s+(fetchDeadline|fetch|AMV_API\._fetch)\s*\(/.test(l)) return;
      if (/[=:]\s*await\s+(fetchDeadline|fetch|AMV_API\._fetch)\s*\(/.test(l)) return;
      if (/return\s+await/.test(l)) return;
      if (ALLOWED.some(re => re.test(l))) return;
      deaf.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
    });
  }
  ok(deaf.length === 0,
     'every network call whose result is used reads the answer', deaf);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('answers-are-read') > 0) process.exitCode = 1;
done();
