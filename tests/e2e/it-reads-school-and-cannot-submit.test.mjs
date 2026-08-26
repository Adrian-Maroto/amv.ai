/* AMV CAN SEE WHAT IS DUE. IT CANNOT HAND ANYTHING IN.

   Reading a student's coursework is the difference between a planner they have
   to maintain and one that maintains itself. It is also a minor's school
   record, which makes the interesting question not "does it work" but "what
   exactly did AMV ask permission to do".

   The answer has to be visible in the SCOPES, not in a prompt. A rule saying
   "never submit" is a sentence a model can be argued out of by a page it read
   or a person insisting. A token that was never granted the submit permission
   cannot submit, whatever anybody types - Google refuses the call. That is the
   only version of this guarantee worth having, and it is the one thing here
   that a reviewer, a parent or a school district can check for themselves.

   So these cases are mostly about what AMV asked for, what it does with what
   comes back, and what it refuses to invent when the answer is empty. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));
outbound.on(/model\.example/, () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 5 } }));

/* CONNECT_KEY, because the grant this test needs is a real sealed one. Without
   it the Worker refuses to hold a connection at all - which is the correct
   behaviour and would make every assertion below a statement about that
   refusal rather than about reading school work. */
const env = makeEnv({ APP_URL: 'http://localhost:9191', AMV_MODEL_KEY: 'k',
                      MODEL_API_URL: 'https://model.example',
                      CONNECT_KEY: 'a-connect-key-for-this-test-only',
                      GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
const L = await bootLive({ env, outbound, port: 9191 });
const { page } = L;

/* A real account, made over the wire, and a real sealed grant planted in KV -
   the same shape connFinish writes. Sealing it by hand rather than driving the
   whole OAuth round trip keeps this suite about reading school work; the
   handshake itself is covered where it belongs. */
const SCHOOL_USER = 'student@example.com';
{
  /* The Worker exports only its fetch handler and the counter class, so the
     sealing helpers are reached the way every worker suite reaches them: a
     copy with an export line appended. Sealing with the REAL function matters -
     a hand-rolled ciphertext would be testing my reimplementation of AES-GCM
     rather than the Worker's. */
  const bpath = join(ROOT, 'amv-backend.js');
  const hdir = join(ROOT, 'tests', 'e2e', '.build');
  mkdirSync(hdir, { recursive: true });
  const hp = join(hdir, 'school-live.harness.mjs');
  writeFileSync(hp, readFileSync(bpath, 'utf8') + '\nexport { DB, CONN_KV, connSeal };\n');
  const W = await import(hp + '?school=' + Date.now());
  await page.evaluate(async (em) => {
    await AMV_API.signup(em, 'Student', 'A-real-Passw0rd!');
  }, SCHOOL_USER);
  const sealed = await W.connSeal(env, { access: 'ya29.a-granted-token', refresh: 'r1',
                                         exp: Date.now() + 3600000 });
  await W.DB.put(env, W.CONN_KV, SCHOOL_USER, {
    c1: { provider: 'google', scopes: ['school.read'], unattended: true, sealed },
  });
}

section('AMV asks to READ school work, and never to submit it');
{
  /* Checked against the shipped bundle, because this is the promise. The
     read-only scopes end in .readonly; the ones that can turn work in do not,
     and their absence is what makes "it cannot submit" true. */
  const app = readFileSync('app.js', 'utf8');
  /* Only what is REQUESTED - the scope URLs. Matching every occurrence of
     "classroom." also picks up the API hostname and the comment naming the
     permission that is deliberately not asked for, and then reports a correct
     implementation as unsafe. A check that cannot tell a scope from a sentence
     about a scope will block the right answer. */
  const scopes = [...new Set(app.match(/auth\/classroom\.[a-z.]+/g) || [])];
  ok(scopes.length > 0, 'Classroom access is requested at all', scopes);
  ok(scopes.every(s => s.endsWith('.readonly')),
     'and every Classroom scope requested is read-only', scopes);

  /* The specific permissions that would let it hand work in. Their absence is
     not a detail - it is the entire safety argument. */
  const submitScopes = scopes.filter(s => !s.endsWith('.readonly'));
  ok(submitScopes.length === 0,
     'and no scope that could turn work in is requested anywhere', submitScopes);
  ok(!scopes.some(s => /coursework\.students/.test(s)),
     'nor any scope that reads OTHER students’ work', scopes);
}

section('It reads real coursework, through the server, and reports what is there');
{
  /* THE WHOLE PATH, NOT A PIECE OF IT.

     This used to stub Google inside the browser and call the reader from there,
     which was right while the reader WAS in the browser. It is on the server
     now - the credential never comes here - so a browser stub would never fire
     and the test would be asserting against a fake nothing reaches.

     So Google is stubbed where the WORKER calls it, the account has a real
     sealed grant in KV, and the request goes through the actual route: session
     check, capability check, connUse, the reader, and back. The only pretend
     thing in it is Google.

     Including the shapes the API really returns, and a piece with no due date,
     which is common and is exactly where an invented deadline would come from. */
  outbound.on(/classroom\.googleapis\.com\/v1\/courses\?/, () => ({
    courses: [{ id: 'c1', name: 'History' }, { id: 'c2', name: 'Chemistry' }] }));
  outbound.on(/courses\/c1\/courseWork/, () => ({ courseWork: [
    { title: 'Essay: the revolution', maxPoints: 40,
      dueDate: { year: 2099, month: 3, day: 14 }, dueTime: { hours: 23, minutes: 59 } },
    { title: 'Reading, no deadline', maxPoints: 5 },
  ] }));
  /* Chemistry refuses. Everything below turns on this. */
  outbound.on(/courses\/c2\/courseWork/, () => new Response('{}', { status: 403 }));

  const r = await page.evaluate(async () => {
    const out = { err: '' };
    try { out.result = await INTEGRATION_ACTIONS.classroom_due.run(); }
    catch (e) { out.err = String((e && e.message) || e); }
    return out;
  });

  ok(!r.err, 'the action completed through the real route', r.err || 'no error');
  const items = (r.result && r.result.items) || [];
  ok(items.length === 2, 'the work that could be read came back', items.map(i => i.title));
  ok(items[0].title === 'Essay: the revolution', 'soonest deadline first', items[0] && items[0].title);
  ok(/^2099-03-14T23:59/.test(items[0].due || ''),
     'with the date and time Google sent, combined correctly', items[0] && items[0].due);
  ok(items[1] && items[1].due === '',
     'and a piece with no deadline is reported as having none, not given one', items[1] && items[1].due);

  /* AND THE CREDENTIAL DID NOT COME HERE. The point of the whole migration:
     the browser asked for the work and got the work, never a key. */
  const leaked = JSON.stringify(r.result || {});
  ok(!/ya29\.|Bearer|access_token/.test(leaked),
     'and no provider token came back to the browser with it', leaked.slice(0, 120));
}

section('And the job is told to pass that on');
{
  const p = await page.evaluate(() => (_cwJobs().find(x => x.id === 'school_auto') || {}).prompt || '');
  ok(/could not be read, say so at the top/i.test(p),
     'the instruction requires naming an unreadable class', /could not be read/i.test(p));
  ok(/miss(es)? a deadline/i.test(p), 'and says why it matters', true);
}

section('The job that uses it is honest about where it runs');
{
  /* The Google token lives in this browser and the server never sees it, so a
     job built on Classroom runs while AMV is open. Saying otherwise would
     promise an overnight run that cannot happen. */
  const r = await page.evaluate(() => {
    const j = _cwJobs().find(x => x.id === 'school_auto');
    return j ? { needs: j.needs, unattended: _cwRunsUnattended(j), where: _cwWhereLabel(j),
                 prompt: j.prompt, sample: (j.sample || []).join(' ') } : null;
  });
  ok(!!r, 'the job exists', !!r);
  ok(r.needs === 'Classroom', 'it declares what it needs', r.needs);
  ok(r.unattended === false, 'and does NOT claim to run with AMV closed', r.unattended);
  ok(/open/i.test(r.where), 'saying so on the card', r.where);
}

section('And says plainly that it cannot hand anything in');
{
  const r = await page.evaluate(() => {
    const j = _cwJobs().find(x => x.id === 'school_auto');
    return { prompt: j.prompt, sample: (j.sample || []).join(' ') };
  });
  ok(/cannot submit/i.test(r.prompt), 'the instruction says it outright', true);
  ok(/never invent a piece of work or a due date/i.test(r.prompt),
     'and forbids inventing work, which is the other way this goes wrong', true);
  ok(/cannot submit|not able to/i.test(r.sample),
     'and the example the person reads before switching it on says it too', r.sample.slice(-90));
}

section('With nothing granted it refuses rather than pretending');
{
  /* THE REFUSAL COMES FROM THE SERVER NOW, AND SAYS WHICH KIND IT IS.

     This used to null the browser's token and watch the action fail. There is
     no browser token to null. So the GRANT is removed and the real route is
     asked, which is a stronger test of the same property: the capability is
     checked where the credential is, not where the caller is, and a caller who
     lies about being connected still gets nothing.

     Refusing matters more than it sounds. An empty answer here becomes "you
     have nothing due" on a screen somebody plans their week from. */
  const W = await import(join(ROOT, 'tests', 'e2e', '.build', 'school-live.harness.mjs') + '?x=' + Date.now());
  const saved = await W.DB.get(env, W.CONN_KV, SCHOOL_USER);
  await W.DB.put(env, W.CONN_KV, SCHOOL_USER, {});

  const r = await page.evaluate(async () => {
    try { await INTEGRATION_ACTIONS.classroom_due.run(); return { threw: false }; }
    catch (e) { return { threw: true, msg: String(e.message || e) }; }
  });
  ok(r.threw, 'it fails rather than returning an empty plan', r);
  ok(/connect/i.test(r.msg), 'and names the reason, which is a thing they can act on', r.msg);

  await W.DB.put(env, W.CONN_KV, SCHOOL_USER, saved);
}

section('A student with no Classroom at all gets nothing invented');
{
  /* Stubbed where the WORKER calls Google. A student who has joined no classes
     is a real state, and the honest answer to it is nothing - not a plausible
     week assembled from an empty page. */
  outbound.onFirst(/classroom\.googleapis\.com\/v1\/courses\?/, () => ({ courses: [] }));
  const r = await page.evaluate(async () => {
    try { return { ok: true, out: await INTEGRATION_ACTIONS.classroom_due.run() }; }
    catch (e) { return { ok: false, msg: String(e.message || e) }; }
  });
  ok(r.ok, 'it answers rather than failing', r.msg || 'ok');
  const items = (r.out && r.out.items) || [];
  ok(items.length === 0, 'no classes means no work, rather than a plausible-looking week', r.out);
  ok(((r.out && r.out.unread) || []).length === 0,
     'and nothing is reported as unreadable either, because nothing was there to read', r.out);
}

section('And a Classroom that refuses is reported, not guessed around');
{
  /* The permission being missing is the case this most needs to survive: the
     student sees "AMV could not read your classes", not a confident empty
     week. And the provider's own words stay on the server - a scope name or a
     quota id is written for an engineer, not for a fifteen-year-old. */
  outbound.onFirst(/classroom\.googleapis\.com\/v1\/courses\?/, () => new Response(JSON.stringify({ error: { message: 'Request had insufficient authentication scopes.' } }),
                       { status: 403 }));
  const r = await page.evaluate(async () => {
    try { await INTEGRATION_ACTIONS.classroom_due.run(); return { threw: false }; }
    catch (e) { return { threw: true, msg: String(e.message || e) }; }
  });
  ok(r.threw, 'the failure surfaces rather than becoming an empty week', r);
  ok(!/insufficient authentication scopes/i.test(r.msg),
     'without handing the provider\u2019s internal wording to the browser', r.msg);
  ok(r.msg.length > 10 && /work|did not|could not|changed/i.test(r.msg),
     'but saying something they can act on, and that nothing was changed', r.msg);
}

section('A student can actually get in, which is the part that was missing');
{
  /* The whole area shipped once with no door on either side.

     Connectors -> Canvas LMS -> Connect fell through to the generic branch and
     said "it needs its API key added by the operator in Settings first - once
     that's done, Connect opens Canvas LMS's secure approval popup". Three
     claims, none of them true: no operator key is involved, there is no OAuth
     popup, and the token is the student's own to paste. schoolConnectOpen -
     the screen that really does it - was called from nowhere in the bundle.
     And the row's "run" control only renders when connected is true, computed
     from a localStorage key the server-side flow never wrote, so it could not
     become true either.

     Every piece was finished. Nobody could reach any of it. So this checks the
     path a person walks, not the functions that exist. */
  /* Pressed, not read. An earlier version of this check looked for the word
     "canvas" in the source of connectIntegration, and a sabotage that renamed
     the branch to 'canvasXX' sailed straight past it - the word was still
     there. What matters is where the button goes, so the button is used. */
  const wired = await L.page.evaluate(async () => {
    const out = { opened: false, toasts: [] };
    const realOpen = window.schoolConnectOpen;
    const realToast = window.toast;
    window.schoolConnectOpen = () => { out.opened = true; };
    window.toast = (msg) => { out.toasts.push(String(msg)); };
    try { await connectIntegration('canvas'); } catch (e) { out.threw = String(e && e.message); }
    window.schoolConnectOpen = realOpen;
    window.toast = realToast;
    out.connectOpenExists = typeof realOpen === 'function';
    out.openExists = typeof window.schoolOpen === 'function';
    out.catalog = _integrationsCatalogHTML();
    return out;
  });
  ok(wired.connectOpenExists && wired.openExists,
     'both school screens exist', { connect: wired.connectOpenExists, work: wired.openExists });
  ok(wired.opened === true,
     'pressing Connect on the Canvas row opens the school connect screen', wired.opened);
  ok(!wired.toasts.some(t => /operator|API key/i.test(t)),
     'and says nothing about waiting for an operator, who has nothing to do here', wired.toasts);

  /* Disconnect, the same way: the token is on the SERVER, so a disconnect that
     only clears a local key reports something that did not happen and leaves
     the school readable. */
  const off = await L.page.evaluate(async () => {
    const out = { calls: [] };
    const realWrote = AMV_API._wrote;
    AMV_API._wrote = async (path) => { out.calls.push(path); return { ok: true }; };
    try { disconnectIntegration('canvas'); } catch (e) { out.threw = String(e && e.message); }
    await new Promise(r => setTimeout(r, 60));
    AMV_API._wrote = realWrote;
    return out;
  });
  ok(off.calls.some(p => /school\/disconnect/.test(p)),
     'disconnecting asks the server to delete the token rather than clearing a local key', off.calls);

  /* Not connected, so the row offers the way to connect. */
  ok(/data-int-conn="canvas"/.test(wired.catalog),
     'before connecting, the row offers Connect', /data-int-conn="canvas"/.test(wired.catalog));

  /* And once connected it offers the way IN. This is the half that could never
     happen: the marker the row reads was written by nothing, so the run
     control was unreachable no matter what a student did. */
  const after = await L.page.evaluate(() => {
    saveStr('amv_canvas', 'school.instructure.com');
    const html = _integrationsCatalogHTML();
    const names = (html.match(/data-int-run="([^"]+)"/g) || []).map(s => s.replace(/.*="|"$/g, ''));
    localStorage.removeItem(_scopeKey('amv_canvas'));
    return { names, dead: names.filter(n => typeof window[n] !== 'function'), connectedShown: /Connected/.test(html) };
  });
  ok(after.names.length > 0, 'once connected, the row offers something to run', after);
  ok(after.dead.length === 0, 'and every name it dispatches is a function this page has', after.dead);
  ok(after.connectedShown, 'and it says Connected, from a marker the connect flow really writes', after.connectedShown);
}

section('What the catalog promises is what the feature does');
{
  /* The row's description outlived the automation it described: "drafts
     answers from your notes. Works overnight." That automation was removed
     for being impossible, and the sentence stayed - which is the same lie the
     old Canvas modal told, moved one screen back. */
  const html = await L.page.evaluate(() => _integrationsCatalogHTML());
  const row = (html.match(/<div class="int-card">(?:(?!<div class="int-card">)[\s\S])*?Canvas LMS[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/) || [''])[0];
  ok(row.length > 0, 'the Canvas row was found', row.length);
  ok(!/overnight/i.test(row), 'it no longer promises overnight work', row.slice(0, 200));
  ok(!/drafts answers/i.test(row), 'nor drafting answers, which it does not do', row.slice(0, 200));
  ok(/copy/i.test(row) && /share/i.test(row),
     'and it says the two things it really does: make your copy, share it with your teacher', row.slice(0, 240));
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
}

await L.close();
outbound.restore();
if (report('it-reads-school-and-cannot-submit') > 0) process.exitCode = 1;
done();
