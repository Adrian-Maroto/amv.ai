/* FOUR MORE CONTROLS THAT REPORTED AN OUTCOME THEY NEVER CHECKED.

   The autonomy kill switch was fixed once already. Sweeping the same question
   across the rest of the client - "does anything await a request and then claim
   a result without reading the answer" - found four more, and the worst two are
   the ones nobody would think to test.

   1. PASSWORD RESET said "check your inbox" every single time. Two bugs on top
      of each other: sendPasswordReset read `sent` off the Response object
      rather than the parsed body, so it was `undefined` on every call including
      the ones that really sent; and the caller then wrote `if (ok)` against a
      RESULT OBJECT that is truthy in all four of its branches - including the
      catch and the no-backend one. The failure message was unreachable code.
      Somebody locked out of their account waits for an email that was never
      sent.

   2. THE PLATFORM KILL SWITCH threw its answer away. A rejected admin token
      resolved like a success: no message, and the button repainted in its old
      state, so the operator who had just confirmed "Pause the ENTIRE service
      for all users?" sees a screen saying the service is live and no reason to
      think that is because their instruction did not land.

   3. A SLACK WEBHOOK POST returned {posted:true} without looking. A revoked
      webhook answers 404 no_service; the agent reported the message as posted,
      to somebody who then believed their team had been told. The token branch
      beside it had always checked - only the webhook branch did not.

   4. The widget's two cost ceilings treat 0 as NO LIMIT, under labels reading
      "Max messages per day" and "Max spend per day". Typing 0 - which reads as
      "none" - removes the only per-widget limit on the owner's bill. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

/* Answer /auth/reset however the case needs, and collect what the screen says.
   `calls` proves the stub was reached - without that a request escaping to a
   hostname that does not resolve fails too, and a failure is one of the
   outcomes under test. */
async function resetWith({ status = 200, body = {}, throwIt = false }) {
  return page.evaluate(async ({ status, body, throwIt }) => {
    const calls = [];
    const realFetch = AMV_API._fetch, realBase = AMV_API.base, realTok = AMV_API.token;
    AMV_API.base = 'https://api.test'; AMV_API.token = 't';
    AMV_API._fetch = async (path) => {
      calls.push(path);
      if (throwIt) throw new Error('network down');
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    };
    const res = await sendPasswordReset('a@x.com');
    AMV_API._fetch = realFetch; AMV_API.base = realBase; AMV_API.token = realTok;
    return { calls, res };
  }, { status, body, throwIt });
}

section('A reset email that really was sent says so');
{
  const r = await resetWith({ body: { ok: true, sent: true } });
  ok(r.calls.some(p => /auth\/reset/.test(p)), 'the server was asked', r.calls);
  ok(r.res.ok === true && r.res.sent === true,
     'the body is read, so `sent` survives the trip', r.res);
}

section('One that was NOT sent does not say it was');
{
  /* The server answers ok:true whatever happens, so it cannot be used to
     discover which addresses exist. `sent` is the only thing that distinguishes
     "we emailed you" from "there is no email provider on this deployment", and
     it was being read off the Response object where it does not exist. */
  const r = await resetWith({ body: { ok: true, sent: false } });
  ok(r.res.ok === true, 'the request itself succeeded', r.res);
  ok(r.res.sent === false, 'and nothing was emailed', r.res);
}

section('A refused request is a failure, not a success');
{
  const r = await resetWith({ status: 429, body: { error: 'too many requests' } });
  ok(r.res.ok === false, 'a 429 is not ok', r.res);
  ok(/too many/i.test(r.res.error || ''), 'and it carries the reason', r.res.error);
}

section('So is a dropped connection');
{
  const r = await resetWith({ throwIt: true });
  ok(r.res.ok === false && r.res.sent === false, 'nothing is claimed', r.res);
}

section('With no backend at all, nothing can have been sent');
{
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realLive = AMV_API.live;
    AMV_API.base = ''; try { AMV_API.live = false; } catch (e) {}
    const res = await sendPasswordReset('a@x.com');
    AMV_API.base = realBase; try { AMV_API.live = realLive; } catch (e) {}
    return res;
  });
  ok(r && r.ok === false && r.sent === false, 'said plainly', r);
}

section('The three outcomes are told apart on screen');
{
  /* `if (ok)` on the result object was true for every one of them, so the
     failure branch below it could never run. */
  const r = await page.evaluate(async () => {
    S.settingsPane = 'security'; setTab('settings');
    await new Promise(r => setTimeout(r, 500));
    const said = [];
    const realSend = window.sendPasswordReset;
    const run = async (res) => {
      window.sendPasswordReset = async () => res;
      const btn = document.getElementById('reset-pw-btn');
      if (!btn) return '(no button)';
      btn.click();
      await new Promise(r => setTimeout(r, 250));
      const m = document.getElementById('pw-msg');
      return (m && m.textContent) || '';
    };
    said.push(await run({ ok: true, sent: true }));
    said.push(await run({ ok: true, sent: false }));
    said.push(await run({ ok: false, sent: false, error: 'boom' }));
    window.sendPasswordReset = realSend;
    return said;
  });
  ok(/check your inbox/i.test(r[0]), 'sent says check your inbox', r[0].slice(0, 90));
  ok(!/check your inbox/i.test(r[1]),
     'not-sent does NOT say check your inbox', r[1].slice(0, 110));
  ok(/no email/i.test(r[1]), 'it says no email went out', r[1].slice(0, 110));
  ok(/couldn|could not|try again/i.test(r[2]), 'and a failure says it failed', r[2].slice(0, 110));
  ok(r[0] !== r[1] && r[1] !== r[2], 'three outcomes, three messages', r.map(s => s.slice(0, 40)));
}

section('A Slack webhook that refuses the message is not "posted"');
{
  const r = await page.evaluate(async () => {
    const realFetch = window.fetchDeadline;
    saveStr('amv_slack', 'https://hooks.slack.test/services/AAA/BBB');
    const out = {};
    window.fetchDeadline = async () => ({ ok: false, status: 404, text: async () => 'no_service', json: async () => ({}) });
    try { out.refused = await INTEGRATION_ACTIONS.slack_post.run({ text: 'hello' }); }
    catch (e) { out.refusedErr = e.message; }
    window.fetchDeadline = async () => ({ ok: true, status: 200, text: async () => 'ok', json: async () => ({}) });
    try { out.sent = await INTEGRATION_ACTIONS.slack_post.run({ text: 'hello' }); }
    catch (e) { out.sentErr = e.message; }
    window.fetchDeadline = realFetch;
    return out;
  });
  ok(!r.refused, 'a revoked webhook does not come back as posted', r.refused);
  ok(/refused|nothing was posted/i.test(r.refusedErr || ''),
     'it throws with what happened', r.refusedErr);
  ok(r.sent && r.sent.posted === true, 'while a real post still reports posted', r.sent);
}

section('The widget says that 0 means no limit');
{
  const r = await page.evaluate(() => {
    const src = String(_paintWidgetForm);
    return { hint: /0 = no limit/.test(src), warn: /wg-capwarn/.test(src) };
  });
  ok(r.hint, 'the label says it, next to the field', r.hint);
  ok(r.warn, 'and there is a live warning when it is set that way', r.warn);
}

section('An unfinished sign-in does not send you to approve it');
{
  /* Every provider here redirects to /oauth/<id>. Only Google has anything
     waiting there, so approving on GitHub or Notion would grant real scopes
     that AMV has nowhere to receive - and the person has no reason to think
     they need to go and revoke them. */
  const r = await page.evaluate(() => ({
    completable: [..._OAUTH_COMPLETABLE],
    offered: Object.keys(INTEGRATION_META).filter(k => INTEGRATION_META[k].oauth),
  }));
  ok(r.completable.includes('google'), 'Google is completable', r.completable);
  const dead = r.offered.filter(k => !r.completable.includes(k));
  ok(dead.length > 0, 'and the others are known not to be', dead);

  const said = await page.evaluate(async (dead) => {
    const out = [];
    const realToast = window.toast, realOpen = window.open;
    let opened = 0;
    window.open = () => { opened++; return null; };
    window.toast = (m) => out.push(String(m));
    for (const id of dead) {
      saveStr(INTEGRATION_META[id].oauth, 'a-real-client-id');
      await connectIntegration(id);
    }
    window.toast = realToast; window.open = realOpen;
    return { out, opened };
  }, dead);
  ok(said.opened === 0, 'no approval window is opened for any of them', said.opened);
  ok(said.out.every(m => /not finished|permissions for nothing|isn’t connected/i.test(m)),
     'and each one says why', said.out.slice(0, 2));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('nothing-claims-what-it-did-not-do') > 0) process.exitCode = 1;
done();
