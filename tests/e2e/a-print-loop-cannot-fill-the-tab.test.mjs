/* A PRINT LOOP CANNOT FILL THE TAB, AND "BUSY" IS SAID IN WORDS.  (AMV-AUD-022)

   The JavaScript sandbox collected every console line in an array and posted
   the lot when the program ended, so a loop printing a million lines held
   them all in memory and sent them all at once. It is capped as it is
   written now, and says it was cut.

   And the bridge now refuses a command when four are already running. The
   page has to turn that into a sentence somebody can act on, rather than the
   bare word "busy". */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('A million lines of output are capped inside the sandbox');
{
  const r = await page.evaluate(async () => {
    const res = await runCode('for (let i = 0; i < 1000000; i++) console.log("line number " + i); return "finished";', 'js');
    return { ok: res.ok, len: (res.stdout || '').length, tail: (res.stdout || '').slice(-60), result: res.result };
  });
  ok(r.ok === true && r.result === 'finished', 'the program still runs to the end', r);
  ok(r.len <= 200100, 'but what comes back is capped - this was the finding', r.len);
  ok(/cut off/.test(r.tail), 'and it says it was cut', r.tail);
}

section('Ordinary output is untouched');
{
  const r = await page.evaluate(async () => (await runCode('console.log("a"); console.log({b:1}); return 2;', 'js')));
  ok(r.stdout === 'a\n{"b":1}' && r.result === '2', 'small programs print exactly what they printed', r);
}

section('A bridge that is at its limit is explained, not just refused');
{
  const r = await page.evaluate(async () => {
    const was = { c: BRIDGE.connected, p: BRIDGE.port, t: BRIDGE.token };
    const realFetch = window.fetch;
    BRIDGE.connected = true; BRIDGE.port = 45678; BRIDGE.token = 'x';
    window.fetch = async () => new Response(JSON.stringify({ error: 'busy', running: 4, max: 4 }), { status: 429 });
    let msg = '', code = '';
    try { await _bridgeCall('exec', { command: 'npm test' }, 5000); } catch (e) { msg = e.message; code = e.code; }
    window.fetch = realFetch;
    BRIDGE.connected = was.c; BRIDGE.port = was.p; BRIDGE.token = was.t;
    return { msg, code };
  });
  ok(r.code === 'busy' && /already running 4 commands/.test(r.msg) && /Wait for one to finish/.test(r.msg),
     'it says how many are running and what to do', r);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
