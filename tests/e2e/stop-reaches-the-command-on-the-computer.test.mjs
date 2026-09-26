/* STOP REACHES THE COMMAND ON THE COMPUTER.

   The page side of the bridge's `exec/cancel` (the Worker suite
   `stop-ends-the-command-and-an-idle-pairing-ends` covers the bridge): every
   command the page starts carries an id, Stop in Build and Stop in chat send
   a cancel for the ones still running, and the command's answer reads as
   stopped by the person - not as a failure, and not as finished. And a
   pairing the bridge ended for being unused is explained as that, not as the
   bridge having restarted.

   The bridge is stood in for at `fetch`, on its real address. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;

await page.evaluate(() => {
  Object.assign(BRIDGE, { connected: true, port: 45671, token: 'tok', folder: 'proj' });
  window.__bridge = { execs: [], cancels: [], release: null, expired: false };
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('http://127.0.0.1:45671/')) return real(url, init);
    const body = JSON.parse((init && init.body) || '{}');
    const b = window.__bridge;
    const reply = (status, d) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
    if (b.expired) return reply(401, { error: 'expired' });
    if (u.endsWith('/amv-bridge/exec/cancel')) {
      b.cancels.push(body.job);
      if (b.release) b.release(body.job);
      return reply(200, { job: body.job, cancelled: true });
    }
    if (u.endsWith('/amv-bridge/exec')) {
      b.execs.push(body.job);
      /* A long command: it answers only when a cancel arrives for it. */
      const job = await new Promise(res => { b.release = res; });
      return reply(200, { command: body.command, exitCode: null, timedOut: false, cancelled: job === body.job,
                          ms: 1234, stdout: 'partial', stderr: '' });
    }
    return reply(404, { error: 'unknown_route' });
  };
});

section('Stop in Build ends the running command, and the step says so');
{
  const r = await page.evaluate(async () => {
    const step = {};
    const running = _agentRunTool('run_command', { command: 'npm install' }, step);
    await new Promise(res => setTimeout(res, 200));
    _AGENT.ctrl = null;
    _agentStop();
    const out = await Promise.race([running, new Promise(res => setTimeout(() => res('HUNG'), 5000))]);
    return { out, step, execs: window.__bridge.execs.slice(), cancels: window.__bridge.cancels.slice() };
  });
  ok(r.execs.length === 1 && /^j[a-z0-9]+$/.test(r.execs[0]), 'the command was sent with an id', r.execs);
  ok(r.cancels.length === 1 && r.cancels[0] === r.execs[0], 'Stop cancelled exactly that command', r);
  ok(r.out !== 'HUNG' && r.out.ok === false && /^stopped by the person/.test(r.out.text), 'the step reads as stopped by the person', r.out);
  ok(r.step.cancelled === true, 'and is marked stopped, not failed', r.step);
}

section('Stop in chat does the same');
{
  const r = await page.evaluate(async () => {
    window.__bridge.execs = []; window.__bridge.cancels = [];
    const running = runBridgeTool('run_command', { command: 'npm test' });
    await new Promise(res => setTimeout(res, 200));
    stopGenerating();
    const out = await Promise.race([running, new Promise(res => setTimeout(() => res('HUNG'), 5000))]);
    return { out, execs: window.__bridge.execs.slice(), cancels: window.__bridge.cancels.slice() };
  });
  ok(r.cancels.length === 1 && r.cancels[0] === r.execs[0], 'the running command is cancelled by its id', r);
  ok(r.out !== 'HUNG' && r.out.cancelled === true && r.out.ok === false, 'and its result says it was stopped', r.out);
}

section('Nothing running, nothing sent');
{
  const n = await page.evaluate(async () => { window.__bridge.cancels = []; const k = await bridgeCancelRunning(); return { k, sent: window.__bridge.cancels.length }; });
  ok(n.k === 0 && n.sent === 0, 'Stop with no command running asks the bridge nothing', n);
}

section('A pairing the bridge ended for being unused says so');
{
  const r = await page.evaluate(async () => {
    window.__bridge.expired = true;
    try { await bridgeList('.'); return { threw: false }; }
    catch (e) { return { threw: true, msg: String(e.message), why: BRIDGE.why, connected: BRIDGE.connected }; }
  });
  ok(r.threw && /not used by AMV for 12 hours/.test(r.msg) && !/restarted/.test(r.msg), 'the message is about the unused pairing, not a restart', r);
  ok(r.why === 'expired' && r.connected === false, 'and the tab lets it go', r);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', JSON.stringify(errors.slice(0, 3)));

await app.close();
report();
done();
