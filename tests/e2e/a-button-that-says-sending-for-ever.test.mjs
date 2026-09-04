/* THE RESET FLOW HAD NO DEADLINE, AND IT IS THE ONE YOU REACH WHEN LOCKED OUT.

   _resetApi carries all three steps of a password reset - ask for a code, check
   the code, set the new password - and it was a plain fetch(). A plain fetch
   only rejects when the connection FAILS. One that is accepted and then says
   nothing does not fail; it waits. Every caller disables its button and sets it
   to "Sending…", "Verifying…" or "Saving…" first, so the stall arrived as a
   disabled button that never came back, with nothing on the screen admitting
   it. The obvious response - press it again - is not available, because it is
   disabled.

   That is the same shape as three other faults found the same night: the gate's
   dependency audit hanging on a registry that accepted the connection and never
   answered, and both dialogs hanging on Escape. A promise nobody can settle is
   worse than an error, because an error at least names something.

   The fix is not new machinery. fetchDeadline has been in this codebase since
   AMV-061 and its own comment describes this exact case; this flow was simply
   not using it. So the test is about the behaviour a person sees, not about
   which function is called: with a server that accepts and never answers, the
   button has to come back and the screen has to say why. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp({ tab: 'chat', user: null });
const { page, errors } = app;

section('A server that accepts and never answers still gives the button back');
{
  /* The real _resetApi, against a fetch that resolves never. Nothing here stubs
     the timeout: the deadline inside fetchDeadline is what has to fire. */
  const r = await page.evaluate(async () => {
    const realFetch = window.fetch;
    const realBase = AMV_API.base, realLive = AMV_API.live;
    let aborted = false;
    /* Accepts the connection, then says nothing - and honours the abort, which
       is how a real stalled request behaves once something gives up on it. */
    window.fetch = (url, init) => new Promise((_, reject) => {
      const sig = init && init.signal;
      if (sig) sig.addEventListener('abort', () => {
        aborted = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
    AMV_API.base = 'https://amv-stub.workers.dev';
    try { AMV_API.live = true; } catch (e) {}

    /* RACED, SO THE FAILING CASE FAILS RATHER THAN HANGS.

       Without a deadline this await never returns, and the suite would sit
       there until Playwright's own timeout killed it - a red run that says
       "timed out" instead of "the reset flow can wait for ever". A test for a
       hang must not hang to prove it. */
    const started = Date.now();
    let message = '', threw = false, hung = false;
    const call = _resetApi('/auth/reset/code', { email: 'a@x.com' })
      .then(() => ({ ok: true }), e => ({ err: String((e && e.message) || e) }));
    const res = await Promise.race([
      call,
      new Promise(r => setTimeout(() => r({ hung: true }), 30000)),
    ]);
    if (res.hung) hung = true;
    else if (res.err) { threw = true; message = res.err; }
    const secs = (Date.now() - started) / 1000;

    window.fetch = realFetch;
    AMV_API.base = realBase;
    try { AMV_API.live = realLive; } catch (e) {}
    return { threw, message, secs, aborted, hung };
  });

  ok(!r.hung, 'it comes back rather than waiting for ever',
     r.hung ? 'still pending after 30s' : 'answered in ' + r.secs.toFixed(1) + 's');
  ok(r.threw, 'and comes back as a failure, not as a silent success', r.threw);
  ok(r.aborted, 'and it actually gave up on the request, not just stopped listening', r.aborted);
  ok(/did not respond in time|offline/i.test(r.message),
     'saying the server did not answer, in words somebody can act on', r.message);
  ok(r.secs < 40, 'within a bounded time', r.secs.toFixed(1) + 's');
}

section('The bound is long enough to be a stall, not a slow connection');
{
  const src = readFileSync(join(ROOT, 'src', 'app', '03-sessions.js'), 'utf8');
  const m = /fetchDeadline\(AMV_API\.base[\s\S]{0,300}?\},\s*(\d+)\)/.exec(src);
  ok(!!m, 'the reset call carries an explicit deadline', m && m[1]);
  const ms = m ? +m[1] : 0;
  ok(ms >= 10000, 'long enough that a slow phone is not called a failure', ms);
  ok(ms <= 60000, 'and short enough that somebody is not left staring at it', ms);
}

section('And no awaited call in the client is left with no deadline at all');
{
  /* The property rather than this one instance. A plain fetch is fine when
     nothing waits on it - the visit ping, the fraud record, the avatar - and is
     a hang waiting to happen the moment a person's screen depends on it. So:
     every `await fetch(` in the client must carry its own signal.

     Deliberately narrow. Fire-and-forget calls are not flagged, because they
     block nobody and flagging them would bury the ones that matter. */
  const bad = [];
  for (const f of readdirSync(join(ROOT, 'src', 'app')).filter(n => n.endsWith('.js'))) {
    const lines = readFileSync(join(ROOT, 'src', 'app', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .split('\n');
    lines.forEach((line, i) => {
      if (!/await\s+fetch\s*\(/.test(line)) return;
      /* The signal may be a few lines down inside the init object. */
      const win = lines.slice(i, i + 12).join('\n');
      if (/signal\s*:/.test(win)) return;
      bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 70));
    });
  }
  ok(bad.length === 0,
     'every awaited fetch carries a signal, so none of them can wait for ever', bad.join(' | '));
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
if (report('a-button-that-says-sending-for-ever') > 0) process.exitCode = 1;
done();
await app.close();
