/* THE SERVER SAID NO AND THE SCREEN SAID YES.

   AMV_API._fetch resolves with the Response for every status except 401. That
   is deliberate - callers need the status. The cost is that

       await this._fetch('/auto/pause', {...});

   succeeds exactly as happily on a 429, a 403, a 400 or a 500 that outlived its
   retries as it does on a 200. Four writes were written that way, and each one
   then told somebody it had happened.

   The worst was the autonomy kill switch. Its caller was already careful: it
   waits for the answer, it has a failure branch, and that branch says "anything
   scheduled to run in the background is STILL RUNNING." It could only ever fire
   on a dropped connection. A server that answered "no" - rate limited, over a
   cap, erroring - resolved like a success, and the emergency stop reported
   "nothing runs until you resume" over jobs that were still running.

   Reading the answer now happens in one place, so a write cannot be added later
   that forgets to look. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = await bootApp({ tab: 'crew', user: { name: 'S', email: 's@x.com', ini: 'S' } });
const { page, errors } = app;

/* Run one action with the server answering as described. The stub stands in for
   _fetch, which is what every write goes through, so the refusal arrives the
   same way a real one would. */
async function withServer({ status, body }, run) {
  return page.evaluate(async ({ status, body, run }) => {
    const said = [];
    const realToast = window.toast, realBase = AMV_API.base,
          realTok = AMV_API.token, realFetch = AMV_API._fetch;
    window.toast = (m) => said.push(String(m));
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    const calls = [];
    AMV_API._fetch = async (path, opts) => {
      calls.push(path);
      return { ok: status >= 200 && status < 300, status,
               json: async () => body };
    };
    let threw = null, out = null;
    try { out = await (new Function('return (' + run + ')'))()(); }
    catch (e) { threw = { message: e.message, code: e.code, status: e.status }; }
    window.toast = realToast; AMV_API.base = realBase;
    AMV_API.token = realTok; AMV_API._fetch = realFetch;
    return { said, calls, threw, out };
  }, { status, body, run: run.toString() });
}

const RATE_LIMITED = { status: 429,
  body: { error: "You're doing that too fast. Give it a moment.", code: 'rate_limited' } };

section('The emergency stop does not report a stop the server refused');
{
  const r = await withServer(RATE_LIMITED, async () => { await pauseAllAutonomous(); });
  ok(r.calls.some(p => /auto\/pause/.test(p)), 'the server was asked', r.calls);
  ok(!r.said.some(m => /nothing runs until you resume/i.test(m)),
     'it does not claim everything stopped', r.said);
  ok(r.said.some(m => /STILL RUNNING/.test(m)),
     'it says the background work is still running', r.said);
  ok(r.said.some(m => /too fast/i.test(m)),
     "and passes on the server's own reason", r.said);
}

section('Resume is held to the same standard');
{
  const r = await withServer({ status: 500, body: { error: 'server error' } },
    async () => { await resumeAllAutonomous(); });
  ok(r.calls.length > 0, 'the stub server was the one that answered', r.calls);
  ok(!r.said.some(m => /^Autonomous work resumed\.$/.test(m)),
     'a refused resume is not announced as resumed', r.said);
  ok(r.said.some(m => /was NOT told/i.test(m)), 'the server not being told is said out loud', r.said);
}

section('And a real stop still reads as a stop');
{
  /* The fix must not have turned every outcome into a failure. */
  const r = await withServer({ status: 200, body: { ok: true } },
    async () => { await pauseAllAutonomous(); });
  ok(r.calls.length > 0, 'the stub server was the one that answered', r.calls);
  ok(r.said.some(m => /nothing runs until you resume/i.test(m)),
     'a 200 is still a success', r.said);
  ok(!r.said.some(m => /STILL RUNNING/.test(m)), 'with no false alarm', r.said);
}

section('A refused handoff is not a sent handoff');
{
  await page.evaluate(() => {
    store('amv_handoffs_out', []);
    setTab('handoff');
  });
  await page.waitForTimeout(300);
  const r = await withServer(RATE_LIMITED, async () => {
    document.getElementById('ho-title').value = 'Finish the Q3 intro';
    document.getElementById('ho-ctx').value = 'The draft, pasted in full.';
    document.getElementById('ho-to').value = 'mate@x.com';
    await hoSend();
    return { status: (load('amv_handoffs_out')[0] || {}).status,
             ctx: (load('amv_handoffs_out')[0] || {}).context };
  });
  /* Without this the case proves nothing: a request that escaped to a hostname
     that does not resolve fails too, and produces the very message under test. */
  ok(r.calls.some(p => /handoff/.test(p)), 'the refusal came from the stub, not from the network', r.calls);
  ok(!r.said.some(m => /^Handoff sent to/i.test(m)), 'it never says it was sent', r.said);
  ok(r.said.some(m => /NOT delivered/i.test(m)), 'it says it was not', r.said);
  ok(r.out && r.out.status === 'failed', 'the record agrees', r.out && r.out.status);
  ok(/pasted in full/.test((r.out && r.out.ctx) || ''),
     'and the work is still there to retry', !!(r.out && r.out.ctx));
}

section('A refused "mark done" leaves it in the inbox');
{
  const r = await withServer({ status: 429, body: { error: 'too fast', code: 'rate_limited' } },
    async () => {
      store('amv_handoffs_in', [{ id: 'in1', from: 'them@x.com', title: 'Have a look', context: 'work' }]);
      await hoDone('in1');
      return { left: (load('amv_handoffs_in') || []).map(h => h.id) };
    });
  ok(r.calls.some(p => /handoff\/act/.test(p)), 'the server was asked and said no', r.calls);
  ok(r.said.some(m => /NOT marked done/i.test(m)), 'the failure is stated', r.said);
  ok(r.out && r.out.left.includes('in1'),
     'and it is still in the inbox rather than vanished', r.out && r.out.left);
}

section('A refused job switch is recorded rather than swallowed');
{
  /* This one is deliberately quiet - the schedule the switch really drives is
     local and already written, so the server copy only matters to your other
     devices. Quiet is not the same as invisible. */
  const r = await withServer({ status: 403, body: { error: 'nope' } }, async () => {
    const seen = [];
    const realLog = AEGIS.log; AEGIS.log = (k, d) => { seen.push(k); return realLog.call(AEGIS, k, d); };
    try { await AMV_API.toggleJob('job_hunt', false); } catch (e) { _jobSyncFailed({ id: 'job_hunt', on: false }, e); }
    AEGIS.log = realLog;
    return { seen };
  });
  ok(r.calls.some(p => /jobs/.test(p)), 'the toggle reached the stub', r.calls);
  ok(r.out && r.out.seen.includes('job_toggle_unsynced'),
     'the drift is written down', r.out && r.out.seen);
}

section('Every refusal carries a code the caller can act on');
{
  const r = await withServer(RATE_LIMITED, async () => { await AMV_API.actApproval('a1', 'approve'); });
  ok(r.calls.some(p => /approvals/.test(p)), 'the stub answered this one too', r.calls);
  ok(r.threw, 'a 429 rejects rather than resolving', r.threw);
  ok(r.threw && r.threw.code === 'rate_limited', 'with the code the server sent', r.threw && r.threw.code);
  ok(r.threw && r.threw.status === 429, 'and the status it sent it with', r.threw && r.threw.status);
}

section('No write anywhere in the client ignores its answer');
{
  /* The property, not the four instances. app.js is the generated, unminified
     concatenation, so this holds whether or not the bundle was minified. */
  /* Asked of the BEHAVIOUR, not of the source text.

     This read the `const noRetry =` line and looked for `api/handoff` in it.
     That was already fragile - the shipped file is minified, so the comment
     above says so - and it broke outright when the policy stopped being a
     roster of excluded paths. Worse, it would have kept passing if the path
     had been listed somewhere that no longer did anything.

     What matters is that sending a handoff twice cannot happen by accident. */
  const tries = await page.evaluate(async () => {
    AMV_API.base = 'https://good.example';
    AMV_API._setTokens({ token: 't', refreshToken: 'r' });
    AMV_API._backoff = () => Promise.resolve();
    const realFetch = window.fetch;
    const calls = {};
    window.fetch = async (url) => {
      const u = String(url); calls[u] = (calls[u] || 0) + 1;
      return { status: 503, ok: false, json: async () => ({}), headers: { get: () => null } };
    };
    try { await AMV_API._fetch('/api/handoff', { method: 'POST', body: '{}' }); } catch (e) {}
    try { await AMV_API._fetch('/auto/update', { method: 'POST', body: '{}' }); } catch (e) {}
    window.fetch = realFetch;
    return { handoff: calls['https://good.example/api/handoff'] || 0,
             pause: calls['https://good.example/auto/update'] || 0 };
  });
  ok(tries.handoff === 1, 'creating one is excluded from automatic retry', tries);
  /* The other half of the rule, and the reason it is not simply "never retry a
     POST": pausing sets a flag, and setting a flag twice is setting it once.
     Work that is safe to repeat still survives a blip. */
  ok(tries.pause > 1, 'while setting a flag, which is the same done twice, still retries', tries);
}

section('And a stub that cannot fail cannot test a refusal');
{
  /* This whole file is about code that treats a refusal as a success. The same
     mistake is available to the TESTS, one layer down, and is harder to see.

     A real Response carries `ok`. A stub written as `{ json: async () => ... }`
     reports `ok` as undefined - which is falsy - so `if (!r.ok) throw` in the
     code under test takes the FAILURE branch on what the stub means as a
     success. The test then passes while exercising the opposite path from the
     one its name describes, and a regression on the success path cannot make
     it fail. Five of them were doing this across account-access and
     family-panel.

     So: every stubbed Response in the suite states its transport status, the
     way a real one does. */
  const { readdirSync: rd, readFileSync: rf } = await import('fs');
  const bad = [];
  for (const dir of ['tests/e2e', 'tests/worker']) {
    for (const f of rd(join(ROOT, dir)).filter(x => x.endsWith('.test.mjs'))) {
      rf(join(ROOT, dir, f), 'utf8').split('\n').forEach((line, i) => {
        const m = line.match(/return\s*\{([^]*?)json\s*:/);
        if (!m) return;
        /* Only the Response's OWN properties, up to `json`. Testing the whole
           line matched the `ok: true` inside the response BODY, so a stub with
           a plausible-looking payload excused itself - which is how eleven of
           these hid behind the five the first version found. */
        if (/\bok\s*:/.test(m[1]) || /\bstatus\s*:/.test(m[1])) return;
        bad.push(dir + '/' + f + ':' + (i + 1));
      });
    }
  }
  ok(bad.length === 0,
     'no stubbed response hides whether it succeeded or failed', bad);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('a-refusal-is-not-a-success') > 0) process.exitCode = 1;
done();
