/* "I LOGGED IN ON A NEW COMPUTER AND MY DEV, LAB AND STUDIO WORK WERE CHATS."

   Reported from a real second machine. The sessions were all there - the names
   were right, nothing had been lost - but every one of them was drawn as an
   ordinary conversation. `_syncSessionList` built each upload as
   `{ id, tool: s.tool, ... }` and a session record has no `tool`; the field is
   `kind`. So every record left the device with `kind: undefined`, the server
   stored exactly what it was sent, and the second computer had nothing to draw
   a Dev project WITH.

   Nothing looked wrong on the machine that made them, because `_SESSIONS` in
   memory was always right. Only the second device ever saw it, which is why it
   survived every check here for as long as it did.

   THE SUITE THAT CAUGHT IT SIMULATES THE SERVER. It calls `_mergeById` and the
   repair loop in the same browser, which is a fair test of the merge and no
   test at all of the trip. Between those two devices sits a whitelist of the
   only keys sync will persist, a merge that decides whether a push overwrites
   or unions, and a trim that throws away the heavy half of a record when the
   upload is too big - three chances to drop a field, none of them exercised by
   a test that never leaves the page.

   So this one goes over the wire to the real Worker, and the second device is a
   browser context that shares nothing with the first except that server: no
   storage, no token, no memory. It is the actual thing that was reported. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const env = makeEnv();
const outbound = makeOutbound();
const L = await bootLive({ env, outbound });

const EMAIL = 'twomachines@example.com';
const PASSWORD = 'A-real-Passw0rd!';

try {
  section('On the first computer, three pieces of real work');
  const made = await L.page.evaluate(async ([em, pw]) => {
    await AMV_API.signup(em, 'Two Machines', pw);

    _STUDIO.artifacts = [{ id: 'a1', name: 'Poster', brief: 'gig poster', html: '<p>x</p>' }];
    _STUDIO.activeId = 'a1';
    _sessFlush('studio');

    _DEV.log = [{ role: 'user', content: 'a todo app' }];
    _DEV.project = { 'app.js': 'console.log(1)' };
    _sessFlush('dev');

    _LAB.code = 'print(1)';
    _sessFlush('lab');

    /* The debounce is 1200ms and a test that waits 1200ms is a test that fails
       on a slow machine. Pushing the collected record directly is the same call
       the debounce makes, one tick earlier. */
    await AMV_API.syncPush(AMVSync.collect());
    return _SESSIONS.map(s => ({ kind: s.kind, title: s.title })).sort((a, b) => a.kind < b.kind ? -1 : 1);
  }, [EMAIL, PASSWORD]);
  await L.settle();

  ok(made.length === 3, 'three sessions exist on the first device', made);
  ok(made.map(s => s.kind).join(',') === 'dev,lab,studio',
     'one of each kind, which is what the second device has to reproduce', made);

  section('The second computer has never seen this person');
  const d2 = await L.otherDevice();
  const fresh = await d2.page.evaluate(() => ({
    sessions: (typeof _SESSIONS !== 'undefined' ? _SESSIONS.length : -1),
    plan: localStorage.getItem('amv_plan') || 'none',
  }));
  ok(fresh.sessions === 0, 'it starts with no Recents at all', fresh);

  section('They sign in, and their work is there as what it is');
  const back = await d2.page.evaluate(async ([em, pw]) => {
    await AMV_API.login(em, { password: pw, provider: 'email' });
    const pulled = await AMVSync.pull();
    await new Promise(r => setTimeout(r, 300));
    return {
      pulled,
      kinds: _SESSIONS.map(s => s.kind).sort(),
      titles: _SESSIONS.map(s => s.title),
      /* The bug as somebody SEES it. Asserting on the rendered list is the only
         way to know the kind reached the SCREEN and not just the array - and
         `.hi-kind` is the highest-fidelity witness there is, because when a
         record has no kind `SESSION_KINDS[undefined]` falls back to a label
         reading the literal word "Session". That is what was reported, word for
         word: the work came back as "just a session with those names". */
      drawnAsSessions: document.querySelectorAll('#hist .hi-sess').length,
      labels: [...document.querySelectorAll('#hist .hi-sess .hi-kind')]
                .map(e => e.textContent.trim()).sort(),
      /* And the work itself, not a label with nothing behind it. */
      studioState: (_SESSIONS.find(s => s.kind === 'studio') || {}).state || null,
    };
  }, [EMAIL, PASSWORD]);

  ok(back.pulled === true, 'the pull really happened', back.pulled);
  ok(back.kinds.join(',') === 'dev,lab,studio',
     'Dev is a Dev, Lab is a Lab and Studio is a Studio - not three chats', back.kinds);
  ok(back.drawnAsSessions === 3,
     'and Recents draws all three as work sessions, not as chats', back.drawnAsSessions);
  ok(back.labels.join(',') === 'Dev,Lab,Studio',
     'each labelled with the room it belongs to', back.labels);
  ok(back.labels.indexOf('Session') < 0,
     'and not one of them says the fallback word the report quoted', back.labels);
  ok(back.studioState && Array.isArray(back.studioState.artifacts)
     && back.studioState.artifacts.length === 1,
     'with the work inside it, so opening it gives the artifact back', back.studioState);

  section('And it survived the server, not just the browser');
  {
    /* Read what the Worker actually stored. If `sessions` were ever dropped
       from the allowed-keys whitelist, or a session's fields reshaped on the
       way through, everything above could still pass off a lucky local merge -
       so this asks the record itself. */
    const raw = await d2.page.evaluate(async () => {
      const d = await AMV_API.syncPull();
      return (d && d.sessions) ? d.sessions.map(s => ({ kind: s.kind, hasState: !!s.state })) : null;
    });
    ok(Array.isArray(raw) && raw.length === 3, 'the server is holding three sessions', raw);
    ok(raw.every(s => s.kind), 'each with its kind, stored server-side', raw);
    ok(raw.every(s => s.hasState), 'and each with its contents', raw);
  }

  await d2.context.close();

  section('Nothing threw and nothing 500ed');
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
  ok(L.served.filter(s => s.status >= 500).length === 0,
     'and no request made the Worker fall over', L.served.filter(s => s.status >= 500));
} finally {
  await L.close();
}

report();
done();
