/* THE STRONGER VERSION OF A PROMISE AMV USED TO MAKE.

   This file was called the-google-token-is-not-on-disk, and it guarded a real
   improvement: the Google access token moved out of localStorage into a module
   variable, so a script that got a foothold could no longer read a live key to
   somebody's mail off the disk.

   It was the right fix to the wrong altitude. The token was still IN THE PAGE.
   Anything running there could still take it, it still died when the tab
   closed - so nothing built on it could run overnight, however it was
   described - and it could still go stale in the middle of a job.

   Every path that called a provider from this browser now asks the server to
   act instead. The credential stays in the Worker. So the promise this file
   guards is no longer "the token is not on disk" but the one that makes that
   question moot:

     NO PROVIDER TOKEN REACHES THE BROWSER AT ALL.

   Which cannot be undone quietly. A future change that hands one back would
   have to reintroduce a way for it to get here, and each of the assertions
   below is a different door it would have to come through. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The JavaScript a visitor actually receives: the generated block of
   index.html, which the build minifies, so comments are not in it. Every
   assertion below is about what can RUN, and a comment cannot. */
function shipped(){
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('<!-- BUILD:JS:START -->');
  const b = html.indexOf('<!-- BUILD:JS:END -->');
  if (a < 0 || b < 0) throw new Error('the generated block markers moved - this check cannot run');
  const block = html.slice(a, b);
  /* A negative control: if the slice were empty or the markers had moved, every
     assertion below would pass by finding nothing. */
  if (block.length < 100000) throw new Error('the generated block is too small to be the bundle: ' + block.length);
  return block;
}
const app = await bootApp({ tab: 'chat' });
const { page, errors } = app;
await app.connect();

section('Nothing in the shipped client asks a provider for a token');
{
  /* READ FROM index.html, NOT app.js, and the difference is the whole check.

     app.js keeps its comments, and the comments here explain what was removed -
     so they name every one of these doors. A substring check against it cannot
     tell a mention from a use and reported a correct removal as a leak, which
     is the failure this codebase keeps producing in checks rather than in code.

     index.html is what a visitor downloads and it is minified, so comments are
     gone and only real code is left. Finding one of these strings there means
     something can actually run it. */
  const src = shipped();
  const doors = [
    ['oauth2.googleapis.com/token', 'Google’s token endpoint'],
    ['/v1/oauth/google/exchange',   'the old exchange route'],
    ['/v1/oauth/google/refresh',    'the old refresh route'],
    ['response_type=token',         'the implicit flow, which returns one in the URL'],
  ];
  const found = doors.filter(([d]) => src.includes(d)).map(([, why]) => why);
  ok(found.length === 0, 'not one of the ways a token could arrive is present', found);
}

section('And nothing calls a provider directly either');
{
  /* A token arriving is one half. Using one is the other, and a call to a
     provider API from this page is what a token would be FOR - so its absence
     is the same guarantee approached from the other side. */
  const src = shipped();
  const hosts = ['gmail.googleapis.com', 'classroom.googleapis.com',
                 'www.googleapis.com/calendar', 'www.googleapis.com/drive'];
  const called = hosts.filter(h => src.includes(h));
  ok(called.length === 0, 'no provider API is called from the browser', called);
}

section('The account actions ask the server, and get results back');
{
  const shape = await page.evaluate(() => {
    const keys = Object.keys(INTEGRATION_ACTIONS).filter(k => INTEGRATION_ACTIONS[k].needs === 'connect');
    return { keys, srcs: keys.map(k => String(INTEGRATION_ACTIONS[k].run)) };
  });
  ok(shape.keys.length >= 6, 'the server-held actions are there', shape.keys);
  const bad = shape.srcs.filter(s => /Bearer|googleapis/.test(s));
  ok(bad.length === 0, 'and not one of them carries a credential', bad.length);
}

section('A result is a result, never a key');
{
  /* Drive the real client path with the server answering. What comes back has
     to be the work, and nothing that could be spent elsewhere. */
  const r = await page.evaluate(async () => {
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).includes('/v1/connect/act')) {
        return new Response(JSON.stringify({ ok: true, action: 'gmail.unread',
          result: [{ id: 'm1', from: 'school@example.com', subject: 'Trip form' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
    const out = await INTEGRATION_ACTIONS.gmail_list_unread.run();
    window.fetch = realFetch;
    /* Everything the page can see afterwards, swept for anything that looks
       like a credential. */
    const store = Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\n');
    return { out, store };
  });
  ok(Array.isArray(r.out) && r.out.length === 1, 'the work came back', r.out);
  ok(r.out[0].subject === 'Trip form', 'as the thing that was asked for', r.out[0]);
  ok(!/ya29\.|access_token|refresh_token/.test(JSON.stringify(r.out)),
     'and no token came with it', JSON.stringify(r.out).slice(0, 120));
  ok(!/ya29\.|amv_gtoken/.test(r.store),
     'nor was one written to storage on the way past', r.store.slice(0, 200));
}

section('What a connection can do is the server’s answer, per capability');
{
  /* The question that used to be answered by "is somebody signed in with
     Google" - which granted nothing and was reported as access. Per capability,
     from the server's list, so a granted mailbox reads as connected and an
     ungranted calendar does not. */
  const r = await page.evaluate(() => {
    _connState.data = { configured: true, providers: [{ id: 'google', name: 'Google', ready: true }],
      items: [{ id: 'c1', provider: 'google', unattended: true, scopes: ['mail.read'] }] };
    return {
      mail: _cwConnHas('mail.read'),
      cal: _cwConnHas('calendar.read'),
      any: _connHasAny(),
      caps: TASK_CAPABILITIES.filter(c => c.connectId === 'google').map(c => c.isConnected()),
    };
  });
  ok(r.mail === true, 'a granted capability reads as connected', r.mail);
  ok(r.cal === false, 'and an ungranted one does not, on the same connection', r.cal);
  ok(r.any === true, 'while "is anything connected" is a separate, looser question', r.any);
  ok(r.caps[0] === true && r.caps[1] === false && r.caps[2] === false,
     'so the screen shows Gmail on, calendar and Drive off - which is the truth', JSON.stringify(r.caps));
}

section('A revoked grant is not a working one');
{
  /* Worse than absent: the card would promise background work that silently
     produces nothing, every morning, until somebody looked. */
  const r = await page.evaluate(() => {
    _connState.data.items[0].broken = 'refresh_failed';
    return { cap: _cwConnHas('mail.read'), any: _connHasAny() };
  });
  ok(r.cap === false, 'a grant the provider revoked reads as not connected', r.cap);
  ok(r.any === false, 'and does not count as "something is connected" either', r.any);
}

section('The account session is untouched by any of this');
{
  /* The one credential the browser legitimately holds is AMV's own session.
     Moving provider tokens out must not have moved that, or somebody is signed
     out every time they open a tab. SESSION-TOKEN.md is where its own story is
     recorded; this only checks the migration did not disturb it. */
  const r = await page.evaluate(() => ({
    api: !!loadStr('amv_api_token'),
    base: !!loadStr('amv_api_base'),
  }));
  ok(r.api === true, 'the AMV session is still there', r.api);
  ok(r.base === true, 'and so is the backend it belongs to', r.base);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
