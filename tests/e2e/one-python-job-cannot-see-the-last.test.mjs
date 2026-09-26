/* ONE PYTHON JOB CANNOT SEE THE LAST.  (AMV-AUD-016)

   The sandbox kept one interpreter for the life of the tab. A job's variables,
   its imports and anything it patched were still there for the next job - and
   for the next ACCOUNT, since signing out left it alone. Two jobs at once
   shared its stdout, and a timeout for one killed the other.

   The real runtime cannot be downloaded here, so a stand-in is served at the
   runtime's own address: a tiny interpreter with the one property that
   matters - it holds state for as long as its worker lives. Everything around
   it is the real code: the worker source, the queue, the timeout, sign-out.

   The last section serves a stand-in that does what the real runtime does
   first - compile WebAssembly - under the REAL policies. That is AMV-AUD-015:
   the app's page refuses WebAssembly, so Python could never start; programs
   now run in the sandbox frame, whose own policy allows it, and the stand-in
   has to compile there and run. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

/* A little interpreter: `set k=v`, `get k`, `patch x`, `patched`, `print s`,
   `sleep ms`, `spam n`. STATE and the patch live in the worker's globals, so
   they last exactly as long as the worker does - which is the thing on trial. */
const FAKE = `
const STATE = {};
self.loadPyodide = async () => {
  let out = () => {};
  return {
    setStdout(o) { out = o.batched; }, setStderr(o) {},
    async runPythonAsync(code) {
      let last;
      for (const raw of String(code).split('\\n')) {
        const l = raw.trim(); if (!l) continue;
        const sp = l.indexOf(' '); const op = sp < 0 ? l : l.slice(0, sp); const arg = sp < 0 ? '' : l.slice(sp + 1);
        if (op === 'set') { const [k, v] = arg.split('='); STATE[k] = v; }
        else if (op === 'get') last = (arg in STATE) ? STATE[arg] : 'UNSET';
        else if (op === 'patch') self.__patched = arg;
        else if (op === 'patched') last = self.__patched || 'CLEAN';
        else if (op === 'print') out(arg);
        else if (op === 'sleep') await new Promise(r => setTimeout(r, Number(arg)));
        else if (op === 'spam') for (let i = 0; i < Number(arg); i++) out('line ' + i);
      }
      return last;
    },
  };
};`;
/* What the real runtime does before anything else: compile WebAssembly. */
const WASM = `
self.loadPyodide = async () => {
  await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  let out = () => {};
  return { setStdout(o) { out = o.batched; }, setStderr() {},
           async runPythonAsync(code) { out('compiled and ran: ' + code); return 'ok'; } };
};`;

let serve = FAKE, loads = 0;
await page.context().route('https://cdn.jsdelivr.net/pyodide/**', (route) => {
  loads++;
  route.fulfill({ status: 200, contentType: 'application/javascript', body: serve,
                  headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
});


section('The runtime stand-in is really what the sandbox loads');
{
  const r = await page.evaluate(() => _runPythonInWorker('print hello\nget nothing'));
  ok(r.ok === true && r.stdout === 'hello' && r.result === 'UNSET', 'a job runs and prints', r);
}

section('A job’s variables and patches are gone for the next job');
{
  const a = await page.evaluate(() => _runPythonInWorker('set marker=the-first-jobs-secret\npatch json.dumps\nget marker'));
  ok(a.result === 'the-first-jobs-secret', 'the first job sets a marker and patches a module', a);
  const b = await page.evaluate(() => _runPythonInWorker('get marker'));
  ok(b.result === 'UNSET', 'the next job does not see the marker - this was the finding', b);
  const c = await page.evaluate(() => _runPythonInWorker('patched'));
  ok(c.result === 'CLEAN', 'nor the patched module', c);
}

section('The next interpreter is warmed before it is asked for');
{
  const before = loads;
  await page.evaluate(() => _runPythonInWorker('print x'));
  await page.waitForTimeout(600);
  ok(loads >= before + 2, 'when a job ends, a fresh runtime is already loading for the next one', { before, after: loads });
}

section('Two jobs at once: one at a time, each with its own output');
{
  const r = await page.evaluate(async () => {
    const order = [];
    const a = _runPythonInWorker('print A1\nsleep 400\nprint A2').then(x => { order.push('A'); return x; });
    const b = _runPythonInWorker('print B1').then(x => { order.push('B'); return x; });
    return { a: await a, b: await b, order };
  });
  ok(r.a.stdout === 'A1\nA2' && r.b.stdout === 'B1', 'neither job’s output contains the other’s', r);
  ok(r.order.join('') === 'AB', 'the second waits for the first - one runtime in memory at a time', r.order);
}

section('A timeout ends its own job and nobody else’s');
{
  const r = await page.evaluate(async () => {
    const a = _runPythonInWorker('print A\nsleep 20000', null, { timeoutMs: 500 });
    const b = _runPythonInWorker('print B-survived');
    return { a: await a, b: await b };
  });
  ok(r.a.ok === false && /timed out/i.test(r.a.stderr), 'the slow job is stopped at its limit', r.a);
  ok(r.b.ok === true && r.b.stdout === 'B-survived', 'and the job behind it runs normally', r.b);
}

section('Signing out stops the job running, and the ones queued behind it');
{
  const r = await page.evaluate(async () => {
    const t0 = Date.now();
    const a = _runPythonInWorker('set who=alice\nsleep 5000\nprint alice-finished');
    const b = _runPythonInWorker('print queued-by-alice');
    await new Promise(res => setTimeout(res, 300));
    _wipeAccountState();
    const ra = await a, rb = await b;
    const ms = Date.now() - t0;
    const next = await _runPythonInWorker('get who');
    return { ra, rb, ms, next };
  });
  ok(r.ra.ok === false && /signed out/i.test(r.ra.stderr) && r.ms < 3000,
     'the running job is stopped at sign-out, not left to finish', r);
  ok(r.rb.ok === false && !/queued-by-alice/.test(r.rb.stdout || ''), 'the queued one never runs', r.rb);
  ok(r.next.ok === true && r.next.result === 'UNSET', 'and the next account starts clean', r.next);
}

section('A print loop cannot fill the tab');
{
  const r = await page.evaluate(() => _runPythonInWorker('spam 40000'));
  ok(r.stdout.length <= 200100 && /cut off/.test(r.stdout), 'output is capped inside the sandbox and says so',
     { len: r.stdout.length, tail: r.stdout.slice(-60) });
}

section('One source URL, however many interpreters');
{
  /* Counted INSIDE the sandbox frame, where the interpreters are made now. The
     page-side count this used to read is always zero since the move, which
     would pass for the wrong reason. */
  const sbx = page.frames().find(f => /\/sandbox\.html$/.test(f.url()));
  ok(!!sbx, 'the sandbox frame is there to count in', page.frames().map(f => f.url()));
  if (sbx) {
    await sbx.evaluate(() => {
      self.__jsBlobs = 0;
      const real = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b) => { if (b && b.type === 'application/javascript') self.__jsBlobs++; return real(b); };
    });
    for (let i = 0; i < 3; i++) await page.evaluate(() => _runPythonInWorker('print again'));
    const made = await sbx.evaluate(() => self.__jsBlobs);
    ok(made === 0, 'three more interpreters, and no new source URL - it was made once', made);
  }
}

section('WebAssembly is allowed where programs run, and only there');
{
  serve = WASM;
  const r = await page.evaluate(async () => {
    _pyReset();                      // drop the frame, so the next job loads the new stand-in
    return await _runPythonInWorker('print hi');
  });
  ok(r.ok === true && /compiled and ran: print hi/.test(r.stdout),
     'the runtime compiles WebAssembly in the sandbox and runs the program - this was AMV-AUD-015', r);
  const page_ = await page.evaluate(async () => {
    try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return 'compiled'; }
    catch (e) { return 'refused'; }
  });
  ok(page_ === 'refused', 'while the app’s own page still refuses it', page_);
  serve = FAKE;
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
