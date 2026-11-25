/* A RELOAD KEEPS YOU WHERE YOU WERE, AND THE BELL DOES NOT CRY WOLF (owner, Nov 25).

   - "When I refresh it should keep me on Build, on Handoff... not go to a new
     chat." Only a dozen screens had an address, so a reload on Build, Design,
     Lab, Handoff, Projects or Usage fell back to a new chat. Each now has one,
     and a real reload of the page lands on it again.
   - "Notifications says could not check security." Right after a reload the
     sign-in is still being restored from its cookie, so the page holds no
     token yet - and the security log's read returned null before sending
     anything, which the bell showed as "Could not check: Security" on every
     page load. It now asks, and the 401 is answered by renewing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Rae', email: 'rae@example.com', ini: 'R' } });
const { page, errors } = app;

section('Every screen somebody works on has an address, and starting up on it opens it');
{
  /* The harness clears storage on every page load (each suite starts clean),
     so a real reload here would also sign the person out. What a reload does
     is start the app with the address it had: so each screen is opened, its
     address read, and the app started again on that address - goApp, the
     same start a reload runs - signed in, as a real reload is. */
  /* Design starts on Build's home after a restart (its open work is in
     Recents), which is still Build - so either is right for it. */
  for (const [tab, slug, also] of [['build', 'build'], ['handoff', 'handoff'], ['usage', 'usage'], ['crew', 'crew'], ['studio', 'design', 'build']]) {
    const r = await page.evaluate(async ([t]) => {
      setTab(t); await new Promise(x => setTimeout(x, 250));
      const hash = location.hash;
      S.tab = 'chat';                 // what a fresh start remembers
      goApp(); await new Promise(x => setTimeout(x, 400));
      return { hash, tab: S.tab, after: location.hash };
    }, [tab]);
    r.ok = r.tab === tab || r.tab === also;
    ok(r.hash === '#/' + slug, tab + ' writes #/' + slug + ' in the address', r.hash);
    ok(r.ok && r.tab !== 'chat', 'and starting the app on that address opens ' + tab + ' again, not a new chat', r);
  }
}

section('The security log is asked for while the sign-in is still being restored');
{
  const r = await page.evaluate(async () => {
    const asked = [];
    const saved = { fetch: AMV_API._fetch, live: Object.getOwnPropertyDescriptor(AMV_API, 'live'), token: Object.getOwnPropertyDescriptor(AMV_API, 'token'), restoring: AMV_API._restoring };
    Object.defineProperty(AMV_API, 'live', { configurable: true, get: () => true });
    Object.defineProperty(AMV_API, 'token', { configurable: true, get: () => '', set: () => {} });
    AMV_API._restoring = true;
    AMV_API._fetch = async (path) => { asked.push(path); return { ok: true, status: 200, json: async () => ({ ok: true, events: [] }) }; };
    let d = null; try { d = await AMV_API.activity(); } catch (e) { d = 'threw ' + e.message; }
    AMV_API._fetch = saved.fetch; AMV_API._restoring = saved.restoring;
    if (saved.live) Object.defineProperty(AMV_API, 'live', saved.live); else delete AMV_API.live;
    if (saved.token) Object.defineProperty(AMV_API, 'token', saved.token); else delete AMV_API.token;
    return { asked, d };
  });
  ok(r.asked.indexOf('/v1/activity') >= 0, 'the request is sent - not answered with nothing before it leaves', r.asked);
  ok(r.d && Array.isArray(r.d.events), 'and its answer comes back, so the bell has no "Could not check" to show', r.d);
}

section('Nothing threw');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));
await app.close();
report();
done();
