/* EVERY ROUTE ANSWERED EVERY VERB, AND FORTY OF THEM CHANGED SOMETHING.

   Nothing checked the method. `/v1/family/leave`, `/v1/mail/disconnect`,
   `/team/leave`, `/v1/finance/unlink`, `/v1/telegram/disconnect` and a good
   many more read no request body at all, so every one of them did its work on
   a GET.

   A GET is what a browser performs by itself: an <img src> in an email, a link
   somebody taps, a preview crawler following a URL out of a chat message. With
   the signed-in customer's own session attached, because that is how a browser
   works. So "leave the family", "unlink the bank", "disconnect the mailbox"
   were all one loaded page away, needing no attacker skill at all - somebody
   only had to open something.

   HTTP has had the right distinction the whole time. A SAFE route reads and
   changes nothing and may be fetched with GET; everything else is POST, which
   is not what a page loads by accident.

   AND HOW MUCH ANYBODY MAY HAND OVER (AMV-029). No ceiling on a request body
   anywhere. Every handler went straight to `request.json()`, which reads the
   whole thing into memory and parses it before the handler has decided whether
   the caller is even allowed to be there - so an unauthenticated POST of a
   hundred megabytes of JSON, to any endpoint, was a hundred megabytes buffered
   and parsed inside a Worker with a 128MB limit, for the price of sending it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'verbs.harness.mjs');
writeFileSync(harness, src + '\nexport { BODY_MAX_BYTES, BODY_MAX_BY_PATH, _bodyMaxFor, DB, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40), APP_URL: 'https://amv.test',
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const tok = await W.issueTokens(env, 'me@example.com', 'Me');

const hit = (path, method, opts = {}) => worker.fetch(new Request('https://api.amv.test' + path, {
  method,
  headers: Object.assign({ 'CF-Connecting-IP': '3.3.3.3' },
    opts.auth === false ? {} : { Authorization: 'Bearer ' + tok.token },
    opts.headers || {},
    (method === 'GET' || method === 'HEAD') ? {} : { 'Content-Type': 'application/json' }),
  body: (method === 'GET' || method === 'HEAD') ? undefined : (opts.body != null ? opts.body : '{}'),
}), env, ctx);
const read = async (r) => ({ status: r.status, allow: r.headers.get('Allow'), body: await r.json().catch(() => ({})) });

/* Routes that CHANGE something and read no body, which is what made them
   reachable by a loaded page. */
const CHANGING = [
  '/v1/family/leave', '/v1/family/remove', '/v1/mail/disconnect', '/v1/school/disconnect',
  '/v1/telegram/disconnect', '/v1/finance/unlink', '/team/leave', '/auto/read',
  '/v1/keys/revoke', '/v1/share/revoke', '/auth/logout', '/auth/delete',
];

section('THE FINDING: a page cannot make somebody leave their family by loading');
{
  for (const path of CHANGING) {
    const r = await read(await hit(path, 'GET'));
    ok(r.status === 405, 'a GET to ' + path + ' is refused', { path, status: r.status });
  }
}

section('And it says which verb it does take, rather than leaving people guessing');
{
  const r = await read(await hit('/v1/family/leave', 'GET'));
  ok(r.status === 405, 'refused', r.status);
  ok(r.body.code === 'method_not_allowed', 'with a code', r.body.code);
  ok(/POST/.test(r.allow || ''), 'and an Allow header naming POST', r.allow);
  ok(/does not accept GET/.test(r.body.error || ''), 'and a sentence saying what happened', r.body.error);
}

section('Nor by any of the other verbs a browser or a proxy can be talked into');
{
  for (const m of ['PUT', 'DELETE', 'PATCH', 'HEAD']) {
    const r = await read(await hit('/v1/family/leave', m));
    ok(r.status === 405, 'a ' + m + ' is refused too', { method: m, status: r.status });
  }
}

section('The ordinary POST still works, which all of this is in service of');
{
  const r = await hit('/v1/health', 'POST');
  ok(r.status === 200, 'a POST to a normal route is answered', r.status);
  const d = await r.json();
  ok(d.ok === true, 'with its normal answer', d);
}

section('And the handful that are genuinely safe are still fetchable');
{
  /* A ceiling that breaks the product is a removal. These are read-only, and
     two of them are loaded by a <script src> on somebody else's site, where
     POST is not an option at all. */
  for (const path of ['/v1/health', '/v1/public-config', '/v1/market/list']) {
    const r = await hit(path, 'GET');
    ok(r.status !== 405, 'a GET to ' + path + ' is allowed', { path, status: r.status });
  }
  const w = await hit('/widget.js?k=pk_test', 'GET', { auth: false });
  ok(w.status !== 405, 'and the widget script, which a <script src> can only GET', w.status);

  const head = await hit('/v1/health', 'HEAD');
  ok(head.status !== 405, 'HEAD works where GET does, because a proxy will send it', head.status);
}

section('Safe means read-only, not "reads no request body"');
{
  /* The wrong rule, written down so nobody re-derives it. Whether a handler
     calls request.json() looks like the test for safety and is not: every route
     in CHANGING reads no body and changes plenty. Safety is about what the
     handler DOES, so it has to be decided by somebody who looked - which means
     a list, and a new route being POST-only until it is on it. */
  const at = src.indexOf('const GET_SAFE = new Set([');
  ok(at > -1, 'the safe routes are an explicit list', at);
  const list = src.slice(at, src.indexOf(']);', at));
  ok(!/leave|disconnect|revoke|delete|unlink|remove/i.test(list),
     'and nothing that changes something is on it', list.match(/'[^']+'/g));

  /* And checked rather than trusted. "Safe" is a claim about what the handler
     DOES, so every route on the list has its handler read and asserted to write
     nothing - which is the check that would have caught the list growing a
     route somebody assumed was read-only. */
  const roster = (list.match(/'\/[^']+'/g) || []).map(s => s.slice(1, -1));
  /* A minority of the whole surface, and that is the property - not a number
     picked for its own sake. Twenty-odd read-only screens out of a hundred and
     sixty routes is what a product with an operator dashboard looks like; the
     thing that would be wrong is the list approaching the route count. */
  const allRoutes = new Set((src.match(/case '\/[^']+'/g) || []).map(x => x.slice(6, -1)));
  ok(roster.length < allRoutes.size / 4,
     'the safe list is a small minority of the routes', { safe: roster.length, all: allRoutes.size });
  const handlerOf = (path) => {
    const m = new RegExp("case '" + path.replace(/[/.]/g, '\\$&') + "'\\s*:\\s*return\\s+([A-Za-z_$][\\w$]*)\\(").exec(src);
    return m ? m[1] : null;
  };
  /* Two routes are answered inline in the switch rather than by a named
     handler, so there is no body to read - they are `json({ok:true})` and a
     static script, and neither can write anything. */
  const INLINE = new Set(['/v1/health', '/widget.js']);
  /* A GET and a POST of the same thing. The GET lists and the POST changes, so
     the handler itself decides - which means the write-check below cannot read
     the whole body, and instead has to prove the branch exists. */
  const BRANCHING = new Set(['/api/handoff', '/api/jobs']);
  for (const p of roster) {
    if (INLINE.has(p)) continue;
    if (BRANCHING.has(p)) {
      /* Two shapes exist for this: the route line picks the handler, or one
         handler picks the branch. Either is fine; what has to be true is that
         the GET side is the one that reads. */
      const line = (new RegExp("case '" + p.replace(/[/.]/g, '\\$&') + "'[^\\n]*").exec(src) || [''])[0];
      const inline = /request\.method === 'POST'\s*\?\s*([A-Za-z_$][\w$]*)\([^)]*\)\s*:\s*([A-Za-z_$][\w$]*)\(/.exec(line);
      if (inline) {
        const readSide = codeOnly(functionBody(src, inline[2]) || '');
        ok(readSide.length > 20, p + ' has a read handler that could be read', inline[2]);
        ok(!/DB\.put\(|AMV_KV\.put\(|AMV_KV\.delete\(|_with[A-Z]/.test(readSide),
           p + ' answers a GET with the handler that only reads', { get: inline[2], post: inline[1] });
      } else {
        const fn = handlerOf(p);
        const b = codeOnly(functionBody(src, fn) || '');
        ok(!!fn && /request\.method === 'POST'/.test(b),
           p + ' branches on the method inside its handler, so a GET cannot reach the write', fn);
      }
      continue;
    }
    const fn = handlerOf(p);
    ok(!!fn, p + ' is a route that really exists', fn);
    if (!fn) continue;
    const b = codeOnly(functionBody(src, fn) || '');
    ok(b.length > 20, p + ' has a handler that could be read', b.length);
    /* A write to a NAMED CACHE KEY is allowed and nothing else is. Caching a
       public listing is idempotent, carries no caller input and changes nobody's
       state - the property that matters is that a GET cannot alter anything a
       person would notice. Spelled as the exception rather than by loosening the
       rule, so a write to a real record still fails here. */
    const writes = (b.match(/(?:DB\.put|AMV_KV\.put|AMV_KV\.delete)\(([^,)]*)/g) || [])
      .filter(w => !/_CACHE_KEY/.test(w));
    ok(writes.length === 0 && !/_with[A-Z]/.test(b),
       p + ' writes nothing a person would notice, which is what makes it safe to GET',
       { fn, writes });
  }
}

section('A route added tomorrow is POST-only without anybody remembering');
{
  /* The rule is stated as "POST unless listed", so the default for anything new
     is the safe direction. The opposite spelling - a list of routes that need
     POST - leaves every new route wide open until somebody adds it. */
  const r = await read(await hit('/v1/some/route/that/does/not/exist', 'GET'));
  ok(r.status === 405, 'an unknown path is refused on the verb before it is looked up', r.status);
  const post = await hit('/v1/some/route/that/does/not/exist', 'POST');
  ok(post.status === 404, 'while a POST to it gets the ordinary not-found', post.status);
}

section('THE OTHER HALF: a body bigger than AMV reads is refused unread');
{
  const big = 'a'.repeat(W.BODY_MAX_BYTES + 1);
  const r = await read(await hit('/auth/login', 'POST', {
    auth: false,
    body: '{"x":"' + 'a'.repeat(64) + '"}',
    headers: { 'Content-Length': String(big.length) },
  }));
  ok(r.status === 413, 'an oversized request is refused', r.status);
  ok(r.body.code === 'body_too_large', 'with a code', r.body.code);
  ok(r.body.limit === W.BODY_MAX_BYTES, 'and the ceiling it broke', r.body.limit);
  ok(/nothing was read/i.test(r.body.error || ''), 'saying nothing was read', r.body.error);
}

section('It applies before anything asks who is calling');
{
  /* The parse is the expensive part and it used to happen before the handler
     had decided the caller was allowed to be there at all. So the ceiling has
     to be earlier than the authentication, not after it. */
  const r = await read(await hit('/v1/keys/create', 'POST', {
    auth: false,
    headers: { 'Content-Length': String(W.BODY_MAX_BYTES + 1) },
  }));
  ok(r.status === 413, 'an unauthenticated oversized request is refused for its size',
     { status: r.status, note: 'not 401 - the size is decided first' });
}

section('And an ordinary body goes through untouched');
{
  const r = await hit('/v1/health', 'POST', { headers: { 'Content-Length': '2' } });
  ok(r.status === 200, 'a small body is fine', r.status);

  const atCap = await hit('/v1/health', 'POST', { headers: { 'Content-Length': String(W.BODY_MAX_BYTES) } });
  ok(atCap.status === 200, 'exactly at the ceiling is allowed, so it is not off by one', atCap.status);

  const noLength = await hit('/v1/health', 'POST');
  ok(noLength.status === 200, 'and a request that declares no length is not refused for it', noLength.status);
}

section('The two routes that really are bigger say so, and are still bounded');
{
  ok(W._bodyMaxFor('/admin/backup/import') > W.BODY_MAX_BYTES,
     'restoring a whole namespace is allowed to be large', W._bodyMaxFor('/admin/backup/import'));
  ok(W._bodyMaxFor('/sync/push') > W.BODY_MAX_BYTES,
     'and so is one device handing over everything it has', W._bodyMaxFor('/sync/push'));
  ok(Object.keys(W.BODY_MAX_BY_PATH).length <= 4,
     'and there are only a handful of them', Object.keys(W.BODY_MAX_BY_PATH));
  for (const [p, n] of Object.entries(W.BODY_MAX_BY_PATH)) {
    ok(n > 0 && n <= 128 * 1024 * 1024, p + ' is still a real ceiling rather than none', n);
  }
  ok(W._bodyMaxFor('/v1/anything/else') === W.BODY_MAX_BYTES,
     'everything not named gets the small default', W._bodyMaxFor('/v1/anything/else'));

  const r = await read(await hit('/sync/push', 'POST', {
    headers: { 'Content-Length': String(W._bodyMaxFor('/sync/push') + 1) },
  }));
  ok(r.status === 413, 'and past even the larger one it is still refused', r.status);
}

section('A GET carries no body, so it is not measured for one');
{
  const r = await hit('/v1/health', 'GET', { headers: { 'Content-Length': String(W.BODY_MAX_BYTES + 1) } });
  ok(r.status !== 413, 'a stray Content-Length on a GET does not break it', r.status);
}

if (report('a-link-is-not-a-command') > 0) process.exitCode = 1;
done();
