/* AN EMPTY TEAM SCREEN IS A STATEMENT ABOUT THE TEAM.

   Three reads answered a request that FAILED with an empty list, and each one
   renders as a confident sentence:

     - the task board said "No tasks yet - assign the first one above", which is
       how two people end up doing the same piece of work;
     - the shared library said the team had shared nothing;
     - the activity log said "No activity yet", to an owner who had opened it
       precisely because something unexpected had happened to their team.

   The shared library was the sharpest version: a careful error handler had been
   written for it, and could never run, because the read swallowed its own
   failure and returned []. The handler looked like coverage and was dead code.

   These assertions are about the distinction between "there is nothing" and "I
   could not find out", on screens where those two are not the same sentence. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'O', email: 'o@x.com', ini: 'O' } });
const { page, errors } = app;

/* Point the client at a backend whose reads all fail, then ask each one. */
const withBrokenBackend = (fn) => page.evaluate(async (body) => {
  const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
  AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
  AMV_API._fetch = async () => ({ ok: false, json: async () => ({ error: 'server unavailable' }) });
  let out;
  try { out = await eval('(' + body + ')')(); }
  finally { AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch; }
  return out;
}, fn.toString());

section('A failed read is not an empty board');
{
  const r = await withBrokenBackend(async () => {
    let threw = null;
    try { await AMVTeam.tasks(); } catch (e) { threw = e.message; }
    return { threw };
  });
  ok(!!r.threw, 'the task board read fails rather than answering "no tasks"', r.threw);
  /* The SERVER's reason is preferred when it gives one, because "server
     unavailable" tells somebody more than a generic sentence would. */
  ok(/server unavailable/.test(r.threw || ''), 'passing on the reason the server gave', r.threw);

  const silent = await page.evaluate(async () => {
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    AMV_API._fetch = async () => ({ ok: true, json: async () => ({}) });   // no reason, no tasks
    let threw = null;
    try { await AMVTeam.tasks(); } catch (e) { threw = e.message; }
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    return threw;
  });
  ok(/could not load/i.test(silent || ''),
     'and a reply with no reason and no board still fails, in plain words', silent);
}

section('A failed read is not an empty shared library');
{
  const r = await withBrokenBackend(async () => {
    let threw = null;
    try { await AMVTeam.shared(); } catch (e) { threw = e.message; }
    return { threw };
  });
  /* This one had a handler written for it that could never run. */
  ok(!!r.threw, 'the shared-library read reaches its error handler at all', r.threw);
}

section('A failed read is not an empty security record');
{
  const r = await withBrokenBackend(async () => {
    let threw = null;
    try { await AMVTeam.audit(); } catch (e) { threw = e.message; }
    return { threw };
  });
  ok(!!r.threw, 'the activity log fails rather than reporting no activity', r.threw);
}

section('And a real empty answer is still an empty answer');
{
  /* The fix must not turn "genuinely nothing yet" into an error - a brand new
     team has an empty board, an empty library and a short log, and all three
     have to render as the calm empty state they are. */
  const r = await page.evaluate(async () => {
    const realBase = AMV_API.base, realTok = AMV_API.token, realFetch = AMV_API._fetch;
    AMV_API.base = 'https://amv-stub.workers.dev'; AMV_API.token = 't';
    AMV_API._fetch = async (path) => ({ ok: true, json: async () =>
      /tasks/.test(path) ? { tasks: [], members: [] }
      : /shared/.test(path) ? { shared: [] }
      : { log: [] } });
    const out = {};
    try {
      out.tasks = (await AMVTeam.tasks()).tasks.length;
      out.shared = (await AMVTeam.shared()).length;
      out.audit = (await AMVTeam.audit()).length;
    } catch (e) { out.err = e.message; }
    AMV_API.base = realBase; AMV_API.token = realTok; AMV_API._fetch = realFetch;
    return out;
  });
  ok(!r.err, 'a genuinely empty team does not throw', r.err);
  ok(r.tasks === 0 && r.shared === 0 && r.audit === 0,
     'all three read as empty, which is the truth for a new team', r);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('team-reads-honest') > 0) process.exitCode = 1;
done();
