/* THE GATE GUARDED THE FIRST HOP AND NOTHING AFTER IT.

   _webHostAllowed refuses localhost, the RFC1918 ranges, 169.254, the cloud
   metadata host - everything AMV must never be pointed at from the inside. It
   is the function this whole class of attack is supposed to die on.

   It was checked once, against the address somebody typed.

   fetch follows redirects by default. So a server that answers

       302 Location: http://169.254.169.254/latest/meta-data/

   was followed with no second look, and the gate was walked around by one
   response header - by the server on the other side of it, which is the one
   party the gate exists to distrust. Workers also forward Authorization across
   an origin change, where a browser strips it, so the redirect took the
   credential along for the ride.

   Reachable three ways: the web agent's starting URL, the web agent's own
   navigations, and a school's Canvas address, which is typed by a student and
   can be any host on the internet.

   The second thing missing here was a deadline. Forty-one outbound fetches and
   not one AbortSignal between them, while the browser half of AMV has had one
   since it had a network call. A provider that accepts the connection and then
   says nothing held the request until the platform killed it, and on the model
   path the caller's allowance stayed reserved the whole time - a third party
   being slow cost the customer their quota.

   Both are checked here, and the redirect behaviour is EXERCISED rather than
   read: the response is faked, the hops are counted, and the headers that
   arrive at each hop are recorded. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'redirectgate.harness.mjs');
writeFileSync(harness, src + '\nexport { fetchGuarded, fetchDeadline, _webHostAllowed, OUTBOUND_MAX_HOPS };\n');
const W = await import(harness + '?t=' + Date.now());

const realFetch = globalThis.fetch;

/* A server that answers with whatever the script says, and records exactly
   what arrived - which hop, to which URL, carrying which headers. */
function server(script) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    seen.push({ url: u, headers: Object.assign({}, (init && init.headers) || {}), redirect: init && init.redirect });
    const step = script[seen.length - 1] || script[script.length - 1];
    if (step && step.to) {
      return { status: 302, ok: false, headers: { get: (h) => (h.toLowerCase() === 'location' ? step.to : null) } };
    }
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ fine: true }) };
  };
  return { seen, restore: () => { globalThis.fetch = realFetch; } };
}

const AUTH = { Authorization: 'Bearer school-token-abc', 'Content-Type': 'application/json' };

section('A request that needs no redirect just works');
{
  const s = server([{}]);
  const out = await W.fetchGuarded('https://school.instructure.com/api/v1/users/self', { headers: AUTH });
  s.restore();
  ok(out.blocked !== true, 'it is not blocked', out.why);
  ok(out.response && out.response.status === 200, 'and the answer comes back', out.response && out.response.status);
  ok(s.seen.length === 1, 'in one hop', s.seen.length);
  ok(s.seen[0].headers.Authorization === AUTH.Authorization,
     'carrying the credential it was given', !!s.seen[0].headers.Authorization);
}

section('Redirects are followed by hand, so each hop can be looked at');
{
  const s = server([{ to: 'https://school.instructure.com/api/v1/users/self?x=1' }, {}]);
  const out = await W.fetchGuarded('https://school.instructure.com/api/v1/users/self', { headers: AUTH });
  s.restore();
  ok(out.blocked !== true, 'a normal same-origin redirect is still followed', out.why);
  ok(s.seen.length === 2, 'two hops were made', s.seen.length);
  ok(s.seen.every(h => h.redirect === 'manual'),
     'and neither was handed to the platform to follow, which is what skipped the gate', s.seen.map(h => h.redirect));
  ok(s.seen[1].headers.Authorization === AUTH.Authorization,
     'the credential survives a hop that stays on the same server', !!s.seen[1].headers.Authorization);
}

section('THE ONE THAT MATTERED: a redirect into the private network is refused');
{
  /* Each of these is a real address somebody would aim at: the cloud metadata
     endpoint, the loopback, a private range, and a hostname that is not a
     number at all. The gate already knew all of them. It was simply never
     asked a second time. */
  const targets = [
    ['the cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback',                    'http://127.0.0.1:8787/admin'],
    ['a private range',             'http://10.0.0.5/internal'],
    ['another private range',       'http://192.168.1.1/'],
    ['an internal hostname',        'http://redis.internal/keys'],
  ];
  for (const [name, to] of targets) {
    const s = server([{ to }, {}]);
    const out = await W.fetchGuarded('https://evil.example.com/start', { headers: AUTH });
    s.restore();
    ok(out.blocked === true, 'a redirect to ' + name + ' is refused', { to, why: out.why });
    ok(s.seen.length === 1, 'and the second request is never made at all', s.seen.length);
  }
}

section('And the credential does not travel to a different server');
{
  /* Workers forward Authorization across an origin change where a browser
     strips it. A 302 is not a reason to hand somebody else's server the token
     that was meant for this one. */
  const s = server([{ to: 'https://collector.example.net/steal' }, {}]);
  const out = await W.fetchGuarded('https://school.instructure.com/api/v1/users/self',
                                   { headers: Object.assign({ Cookie: 'sess=1' }, AUTH) });
  s.restore();
  ok(out.blocked !== true, 'the hop itself is allowed - it is a public host', out.why);
  ok(s.seen.length === 2, 'and it was followed', s.seen.length);
  const arrived = s.seen[1].headers;
  ok(!arrived.Authorization, 'but the token did not go with it', arrived);
  ok(!arrived.Cookie, 'nor the cookie', arrived);
  ok(arrived['Content-Type'] === 'application/json',
     'while the harmless headers still do, so this is a strip and not a wipe', arrived['Content-Type']);
}

section('A redirect that never lands is given up on');
{
  const s = server([{ to: 'https://a.example.com/2' }]);   // always redirects
  const out = await W.fetchGuarded('https://a.example.com/1', { headers: AUTH });
  s.restore();
  ok(out.blocked === true, 'a loop is refused rather than followed for ever', out.why);
  ok(s.seen.length <= W.OUTBOUND_MAX_HOPS + 1,
     'after a bounded number of hops', { hops: s.seen.length, max: W.OUTBOUND_MAX_HOPS });
}

section('The refusal says what happened, because a blocked address is not an outage');
{
  const s = server([{ to: 'http://169.254.169.254/' }, {}]);
  const out = await W.fetchGuarded('https://school.instructure.com/x', { headers: AUTH });
  s.restore();
  ok(typeof out.why === 'string' && out.why.length > 10,
     'it carries a reason a person can read', out.why);
  ok(/blocked|internal|not allowed/i.test(out.why),
     'and the reason names the actual cause', out.why);
}

section('Every outbound request has a deadline, or is named with why not');
{
  /* The sweep. A bare fetch to a third party is the shape that had no
     deadline, so the rule is about the shape rather than about a list of the
     hosts somebody remembered. */
  const EXEMPT = [
    ['_modelFetch', 'streamed: aborting a signal aborts the body too, so a deadline here cuts the sentence somebody is reading rather than bounding a hang - and it would do that to every long answer, not to the rare stuck one'],
    ['fetchDeadline', 'it IS the wrapper; wrapping itself is the one call that has to be bare'],
  ];

  /* Worker-side outbound calls only. The Worker also serves an HTML page with
     browser JavaScript inside it, and a fetch in that string runs in somebody
     else's browser, where this has no meaning. Those are inside a template
     literal, so they are found by their indentation-free `var r = await
     fetch('/` shape and excluded by path: a served page only calls AMV's own
     relative routes. */
    const bare = [...src.matchAll(/(?:await\s+|=\s*|return\s+)fetch\(\s*([^\n]{0,60})/g)]
    .map(m => ({ arg: m[1].trim(), at: m.index }))
    .filter(f => !/^['"`]\//.test(f.arg))          // a relative path: browser JS in a served page
    .filter(f => !/^\s*['"`]https:\/\/do\//.test(f.arg));  // the Durable Object stub, not the network

  const owner = (at) => {
    const before = src.slice(0, at);
    const m = [...before.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
    return m.length ? m[m.length - 1][1] : '(top level)';
  };
  const unbounded = bare
    .map(f => ({ ...f, fn: owner(f.at) }))
    .filter(f => !EXEMPT.some(([name]) => name === f.fn))
    .map(f => f.fn + ' -> fetch(' + f.arg.slice(0, 40));

  ok(bare.length > 0, 'the sweep found the bare calls at all', bare.length);
  ok(unbounded.length === 0,
     'nothing calls out to a third party without a deadline', [...new Set(unbounded)].slice(0, 6));

  const stale = EXEMPT.filter(([name]) => !functionBody(src, name)).map(([n]) => n);
  ok(stale.length === 0, 'and every exemption still names a function that exists', stale);
}

section('The wrapper really sets one, rather than being a rename');
{
  const body = functionBody(src, 'fetchDeadline');
  ok(/AbortSignal\.timeout/.test(body), 'fetchDeadline attaches an abort signal', /AbortSignal\.timeout/.test(body));
  ok(/signal:/.test(body), 'as the request signal', /signal:/.test(body));
  const guard = functionBody(src, 'fetchGuarded');
  ok(/redirect:\s*'manual'/.test(guard), 'and fetchGuarded refuses to let the platform follow redirects', true);
  ok(/_webHostAllowed\(/.test(guard), 'while re-checking the gate on each hop', true);
}

section('The three places that fetch an address somebody else chose use it');
{
  /* Named, because these are the ones where the address is not AMV's own. */
  ok(/fetchGuarded\(/.test(functionBody(src, '_canvasGet')),
     'reading a school goes through the guarded fetch', true);
  ok(/fetchGuarded\(/.test(functionBody(src, 'schoolConnect')),
     'and so does proving the token when a school is first connected', true);
  const agent = functionBody(src, 'browserRun');
  ok(agent.length > 500, 'the browser agent was found to read', agent.length);
  ok(/page\.url\(\)/.test(agent) && /_webHostAllowed\(/.test(agent),
     'and it gates where it ACTUALLY landed, not only where it was sent', true);
  ok((agent.match(/_landedSomewhereBlocked\(\)/g) || []).length >= 2,
     'checked after the first navigation AND on every step, because a page can send itself somewhere',
     (agent.match(/_landedSomewhereBlocked\(\)/g) || []).length);
}

if (report('a-redirect-is-not-a-way-around-the-gate') > 0) process.exitCode = 1;
done();
