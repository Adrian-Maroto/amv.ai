/* THE TIMEOUT COULD NOT STOP THE ONE THING IT WAS FOR.

   The Lab runs code somebody wrote, which is to say code that is often wrong.
   JavaScript ran in a hidden iframe, and an iframe runs on the SAME THREAD as
   the page - so `while(true){}` did not time out after fifteen seconds, it
   froze the whole tab, permanently. The setTimeout meant to stop it was queued
   on the thread the loop was holding and could not fire until the loop ended,
   which was never. The message it would eventually have shown said "the sandbox
   was terminated", which described something the code had no way to do.

   An infinite loop is the most ordinary mistake there is in a program a person
   is asking a computer to run. The single case the timeout existed for was the
   single case it could not survive, and the cost was not a failed run - it was
   the app, gone, with whatever was unsaved in it.

   One correction to that story, learned by running it. Chromium gives a
   sandboxed iframe an opaque origin and its own renderer process, so on THIS
   browser the old code did not take the tab: the page kept painting. That is
   the browser being kind rather than the code being right, and it is not true
   everywhere - but it means the tab-freezing half cannot be demonstrated here,
   and a check that claims to demonstrate it would be a check that passes on the
   defect.

   What was never true on any browser is that anything STOPPED the program.
   Detaching an iframe whose script never yields does not interrupt it, so the
   runaway kept its renderer for as long as the tab lived - and because every
   run shares the same opaque origin, the next program had nowhere to run. One
   infinite loop and the Lab was over for that session: a fresh `return 1+1`
   simply never came back. That is measured below, and it is the thing a
   terminable sandbox actually buys.

   All of it needs a real browser, because the finding is about threads: in a
   mock, `while(true)` either blocks the test runner or is not there at all. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await bootApp();
const { page } = app;

section('An ordinary program still runs, which is the point of all of this');
{
  const r = await page.evaluate(() => runCode('console.log("hi", {a:1}); return 6*7;', 'js'));
  ok(r.ok === true, 'it succeeds', r);
  ok(r.stdout === 'hi {"a":1}', 'console output is captured, objects and all', r.stdout);
  ok(r.result === '42', 'and the value it returned comes back', r.result);
}

section('An error is reported as an error, not as a timeout');
{
  const r = await page.evaluate(() => runCode('null.x;', 'js'));
  ok(r.ok === false, 'a throwing program fails', r);
  ok(/TypeError|null/.test(r.stderr), 'with the real error', r.stderr);
  ok(r.ms < 5000, 'and immediately, rather than after the timeout', r.ms);
}

section('A program that does not parse says so, straight away');
{
  /* This never runs at all, so there is no message to wait for - which under a
     naive implementation is fifteen seconds of nothing followed by the wrong
     explanation. */
  const r = await page.evaluate(() => runCode('function ( { { {', 'js'));
  ok(r.ok === false, 'it fails', r);
  ok(r.ms < 5000, 'without waiting for the timeout', r.ms);
  ok(r.stderr && r.stderr.length > 0, 'and says something', r.stderr);
}

section('An unawaited rejection ends the run instead of hanging it');
{
  const r = await page.evaluate(() => runCode('Promise.reject(new Error("nope")); await new Promise(()=>{});', 'js'));
  ok(r.ok === false, 'it fails', r);
  ok(/nope/.test(r.stderr), 'with the reason', r.stderr);
  ok(r.ms < 8000, 'and does not sit there until the cap', r.ms);
}

section('THE FINDING: a runaway program does not end the sandbox');
{
  /* What "cannot stop it" actually costs, measured on the thing that breaks.

     A note on what this browser does, because it changes what is worth
     asserting. Chromium gives a sandboxed iframe an opaque origin and its own
     renderer process, so on THIS browser the old code did not freeze the tab -
     the page kept painting while the program spun. That is the browser being
     kind, not the code being right, and it is not true everywhere.

     What was never true anywhere is that anything stopped the program. Removing
     an iframe whose script never yields does not interrupt it, so the runaway
     kept its renderer for the life of the tab - and since every run shares the
     same opaque origin, the NEXT program had nowhere to run. One infinite loop
     and the Lab was finished for that session: a fresh `return 1+1` simply
     never came back.

     That is the property here. A sandbox you can terminate survives its own
     worst input. */
  const survives = await page.evaluate(async () => {
    const before = await runCode('return 1+1;', 'js');
    for (let i = 0; i < 3; i++) runCode('while(true){}', 'js');
    await new Promise(r => setTimeout(r, 1200));
    const t = performance.now();
    const after = await Promise.race([
      runCode('return 1+1;', 'js'),
      new Promise(r => setTimeout(() => r({ stuck: true }), 5000)),
    ]);
    return { before, after, afterMs: Math.round(performance.now() - t) };
  });
  ok(survives.before.result === '2', 'a program runs before any of this', survives.before);
  ok(!survives.after.stuck,
     'and after three runaway programs the sandbox still answers at all', survives.after);
  ok(survives.after.ok === true && survives.after.result === '2',
     'with the right answer', survives.after);
  ok(survives.afterMs < 3000, 'and promptly', survives.afterMs);
}

section('And the page itself keeps running while a program spins');
{
  /* The part a person feels. A heartbeat is started on the main thread before
     the program and the program never yields; if the sandbox shares the page's
     thread the beats stop dead. This holds on browsers that do not isolate a
     sandboxed frame into its own process, where the old code took the tab with
     it. */
  const alive = await page.evaluate(async () => {
    let beats = 0;
    const h = setInterval(() => { beats++; }, 50);
    const started = performance.now();
    runCode('while(true){}', 'js');           // deliberately not awaited
    await new Promise(r => setTimeout(r, 1500));
    const out = { beats, elapsed: performance.now() - started };
    clearInterval(h);
    return out;
  });
  ok(alive.beats >= 10, 'the page keeps running while the program spins', alive);
  ok(alive.elapsed >= 1400 && alive.elapsed < 4000, 'over real wall clock', alive.elapsed);

  const responsive = await page.evaluate(async () => {
    const t = performance.now();
    document.title = 'still here';
    await new Promise(r => requestAnimationFrame(r));
    return { title: document.title, frameMs: performance.now() - t };
  });
  ok(responsive.title === 'still here', 'the page still paints', responsive);
  ok(responsive.frameMs < 1000, 'and a frame lands promptly', responsive.frameMs);
}

section('The worker is stopped on every exit, not only on the timeout');
{
  /* Said plainly: this one is a source check, and here is why.

     Whether terminate() was CALLED has no clean observable from the page. A
     leaked worker shows up only as CPU that somebody else's program is still
     burning, and measuring that means comparing main-thread throughput with and
     without background spinners. Tried, and on this machine twelve runaway
     workers across four cores moved it by about ten percent - well inside the
     noise of the same measurement repeated. An assertion on that number would
     be a flaky test, which is worse than an honest structural one, because a
     test people re-run until it goes green is a test that has stopped meaning
     anything.

     So the behavioural evidence above carries the finding - the sandbox
     survives its own worst input, which is what the old code could not do - and
     this checks the one thing behaviour cannot reach: that the stop happens on
     EVERY way out, not just when the clock runs down. A program that has
     already returned its answer can still be spinning in a callback, and a
     worker nobody stopped keeps its thread for the life of the tab. */
  const built = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const at = built.indexOf('function _runJS(');
  ok(at > -1, 'the sandbox is in the shipped bundle', at);
  const body = built.slice(at, built.indexOf('\nfunction ', at + 10));
  ok(/new Worker\(/.test(body), 'it runs the program in a worker', true);
  ok(!/createElement\('iframe'\)/.test(body) && !/srcdoc/.test(body),
     'and not in a frame on the page thread', true);

  const iFinish = body.indexOf('const finish=');
  const iTerm = body.indexOf('worker.terminate()');
  const iTimeout = body.lastIndexOf('setTimeout(');
  ok(iTerm > iFinish && iTerm < iTimeout,
     'the stop is inside the single exit, so no branch can skip it',
     { finish: iFinish, terminate: iTerm, timeout: iTimeout });
  ok((body.match(/terminate\(\)/g) || []).length === 1,
     'and there is exactly one of them, rather than one per branch to forget',
     (body.match(/terminate\(\)/g) || []).length);
}

section('It ends by itself, with a sentence that is true');
{
  /* The full wait, once. What it says matters as much as that it happens: the
     old text claimed the sandbox was terminated, by code that could not
     terminate anything. */
  const r = await page.evaluate(() => runCode('while(true){}', 'js'));
  ok(r.ok === false, 'the runaway program ends in a failure', { ok: r.ok, ms: r.ms });
  ok(/timed out/i.test(r.stderr), 'reported as a timeout', r.stderr);
  ok(/infinite loop/i.test(r.stderr), 'that names the likely cause', r.stderr);
  ok(r.ms >= 14000 && r.ms <= 25000, 'after about the stated time', r.ms);
}

section('Untrusted code cannot reach the page it is running on');
{
  /* A worker has no document, no localStorage and no cookies. The iframe had a
     unique origin, which was the only thing between somebody else's program and
     this account's tokens; now there is nothing there to reach. */
  const probe = await page.evaluate(() => runCode(
    'return [typeof document, typeof localStorage, typeof window.parent, typeof importScripts].join(",");', 'js'));
  ok(probe.ok === true, 'the probe runs', probe);
  ok(/^undefined,undefined,/.test(probe.result),
     'there is no document and no localStorage in there', probe.result);
  ok(probe.result.endsWith('function'),
     'and importScripts is there, so it really is a worker rather than a stripped-down page', probe.result);

  const steal = await page.evaluate(async () => {
    localStorage.setItem('amv_api_token', 'a-real-looking-token');
    const r = await runCode('try{ return String(localStorage.getItem("amv_api_token")); }catch(e){ return "blocked:"+e.name; }', 'js');
    localStorage.removeItem('amv_api_token');
    return r;
  });
  ok(!/a-real-looking-token/.test(String(steal.result) + String(steal.stderr)),
     'a program that goes looking for the session token does not find one', steal);
}

if (report('a-runaway-program-does-not-take-the-tab') > 0) process.exitCode = 1;
await app.close();
done();
