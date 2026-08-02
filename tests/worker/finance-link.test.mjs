/* LINKING AN ACCOUNT - the half that did not exist.

   Every read path in the finance layer needs a `fin` record holding an access
   token. Nothing in the worker ever created one: no link route, and no
   `DB.put(env,'fin',...)` anywhere. So the balance reads, the transaction reads
   and the scheduled investing check-in were complete, correct and permanently
   unreachable, and the client decided "is an account linked?" from a
   localStorage flag nothing ever wrote - so the answer was always no.

   What matters here is not that it links. It is what it refuses to do while
   linking: the access token never leaves the server, never reaches a log or an
   audit line, the provider is never told who the user is, an abandoned session
   is told apart from a failed one, and disconnecting really disconnects. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'finlink.harness.mjs');
writeFileSync(harness, src + `
export { financeStatus, financeLinkStart, financeLinkFinish, financeUnlink,
         _finUserId, _finReady, signToken, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const store = new Map();

const mkEnv = (extra = {}) => ({
  JWT_SECRET: 'x'.repeat(40), FINANCE_CLIENT_ID: 'cid', FINANCE_SECRET: 'sec',
  APP_URL: 'https://amv.homes',
  AMV_KV: {
    async get(k){ return store.has(k) ? store.get(k) : null; },
    async put(k, v){ store.set(k, String(v)); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys:[...store.keys()].filter(k=>k.startsWith(prefix||'')).map(name=>({name})), list_complete:true }; },
  },
  ...extra,
});
W.__setRequireUser(async () => ({ email: 'a@x.com', plan: 'pro' }));
const req = (body) => new Request('https://x/v1/finance/x', { method:'POST', body: JSON.stringify(body || {}) });

const realFetch = globalThis.fetch;
let calls = [];
const serve = (map) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push({ path, body: JSON.parse(init.body) });
    const r = map[path];
    if (!r) return { ok:false, json: async () => ({ error_message:'no route' }) };
    return { ok: r.ok !== false, json: async () => r.data || {} };
  };
};

section('With no provider keys it says so instead of pretending');
{
  store.clear();
  const env = mkEnv({ FINANCE_CLIENT_ID:'', FINANCE_SECRET:'' });
  const r = await W.financeLinkStart(req(), env);
  const d = await r.json();
  ok(r.status === 503 && d.code === 'needs_service', 'starting a link is refused honestly', d.code);
  ok(/FINANCE_CLIENT_ID/.test(d.error), 'naming exactly what unlocks it', d.error);

  const s = await (await W.financeStatus(req(), env)).json();
  ok(s.ready === false && s.linked === false,
     'and status reports not-ready rather than not-linked, which are different things', s);
}

section('Starting a link hands back the provider\'s own page');
{
  store.clear();
  const env = mkEnv();
  serve({ '/link/token/create': { data: { link_token:'lt-1', hosted_link_url:'https://provider/hl/abc', expiration:'2026-01-01' } } });
  const d = await (await W.financeLinkStart(req(), env)).json();
  ok(d.ok === true && d.url === 'https://provider/hl/abc',
     'the user is sent to the provider to sign in, not to a form in our page', d.url);

  const sent = calls[0].body;
  ok(sent.hosted_link && /amv\.homes/.test(sent.hosted_link.completion_redirect_uri || ''),
     'with somewhere to come back to', sent.hosted_link);
  ok(Array.isArray(sent.products) && sent.products.indexOf('investments') >= 0,
     'asking for the products the check-in actually reads', sent.products);
}

section('The provider is never told who the user is');
{
  const sent = calls[0].body;
  const asJson = JSON.stringify(sent);
  ok(!/a@x\.com/.test(asJson),
     'the email address is not in the request at all', asJson.slice(0, 160));
  ok(sent.user && /^[0-9a-f]{32}$/.test(sent.user.client_user_id),
     'only an opaque id', sent.user);

  const env = mkEnv();
  const a = await W._finUserId(env, 'a@x.com');
  const b = await W._finUserId(env, 'a@x.com');
  const c = await W._finUserId(env, 'b@x.com');
  ok(a === b, 'stable for the same person, so relinking is the same customer', a === b);
  ok(a !== c, 'and different people are different', a !== c);
  const other = await W._finUserId(mkEnv({ JWT_SECRET:'y'.repeat(40) }), 'a@x.com');
  ok(a !== other, 'and it is not a bare hash of the email anybody could recompute', a !== other);
}

section('An abandoned link is not reported as a broken one');
{
  /* Closing the window is the single most common outcome and it is not a
     failure. Calling it "the provider is down" would send people to support
     over something they did themselves. */
  const env = mkEnv();
  serve({ '/link/token/get': { data: { link_sessions: [ { results: { item_add_results: [] } } ] } } });
  const r = await W.financeLinkFinish(req(), env);
  const d = await r.json();
  ok(r.status === 409 && d.code === 'not_finished', 'it says the link was not completed', d.code);
  ok(!/error|down|fail/i.test(d.error), 'in words that do not blame the provider', d.error);

  const fin = await W.DB.get(env, 'fin', 'a@x.com');
  ok(!fin, 'and nothing is stored, so a half-finished link cannot look linked', fin);
}

section('A completed link stores the token, and only on the server');
{
  const env = mkEnv();
  serve({
    '/link/token/get': { data: { link_sessions: [ { results: { item_add_results: [ { public_token:'pub-1', item_id:'it-1' } ] } } ] } },
    '/item/public_token/exchange': { data: { access_token:'access-SECRET', item_id:'it-1' } },
  });
  const r = await W.financeLinkFinish(req(), env);
  const d = await r.json();
  ok(d.ok === true && d.linked === true, 'the link completes', d);

  const body = JSON.stringify(d);
  ok(!/access-SECRET/.test(body), 'the access token is NOT in the response', body);

  const fin = await W.DB.get(env, 'fin', 'a@x.com');
  ok(fin && fin.accessToken === 'access-SECRET', 'it is stored server-side where the reads need it', !!fin);
  ok(fin.linkedAt > 0, 'with when it happened', fin.linkedAt);

  const held = await W.DB.get(env, 'finlink', 'a@x.com');
  ok(!held, 'and the one-time link handle is spent, not left lying about', held);

  const s = await (await W.financeStatus(req(), env)).json();
  ok(s.linked === true, 'status now says linked, from the server rather than a browser flag', s);
}

section('Finishing without starting is refused');
{
  store.clear();
  const env = mkEnv();
  const r = await W.financeLinkFinish(req(), env);
  const d = await r.json();
  ok(r.status === 400 && d.code === 'no_session',
     'there is no way to complete a link nobody started', d.code);
}

section('Disconnecting really disconnects');
{
  const env = mkEnv();
  await W.DB.put(env, 'fin', 'a@x.com', { accessToken:'access-SECRET', linkedAt: Date.now() });
  await W.DB.put(env, 'invsnap', 'a@x.com', { at: Date.now(), total: 1000, accounts: [] });
  serve({ '/item/remove': { data: { removed: true } } });

  const d = await (await W.financeUnlink(req(), env)).json();
  ok(d.ok === true, 'it unlinks', d);
  ok(calls.some(c => c.path === '/item/remove'),
     'and tells the provider too, so consent ends where the user ended it', calls.map(c => c.path));
  ok(!(await W.DB.get(env, 'fin', 'a@x.com')), 'our record is gone', true);
  /* Relinking later must not compare today against a balance from an account
     that is no longer connected. */
  ok(!(await W.DB.get(env, 'invsnap', 'a@x.com')),
     'and so is the snapshot derived from it', true);
}

section('An unreachable provider does not trap the user as connected');
{
  const env = mkEnv();
  await W.DB.put(env, 'fin', 'a@x.com', { accessToken:'tok' });
  globalThis.fetch = async () => { throw new Error('network'); };
  const d = await (await W.financeUnlink(req(), env)).json();
  ok(d.ok === true, 'unlinking still succeeds', d);
  ok(!(await W.DB.get(env, 'fin', 'a@x.com')),
     'a third party being down cannot keep somebody connected against their wishes', true);
}

section('Every route needs a signed-in user and is rate limited');
{
  const bodyOf = (name) => {
    const at = src.indexOf('async function ' + name);
    const next = src.slice(at + 1).search(/\n(?:async )?function [A-Za-z_$]/);
    return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
  };
  [['financeLinkStart','finlink:'], ['financeLinkFinish','finfin:'], ['financeUnlink','finunlink:']].forEach(([fn, key]) => {
    const b = bodyOf(fn);
    ok(/requireUser\(request, env\)/.test(b), `${fn} requires a signed-in user`, fn);
    ok(b.includes("guardAction(env, '" + key), `${fn} is rate limited`, key);
  });
  ok(/requireUser\(request, env\)/.test(bodyOf('financeStatus')), 'financeStatus requires one too');

  /* Every route is keyed off user.email from requireUser, so there is no
     caller-supplied identity to swap for somebody else's. */
  const all = ['financeStatus','financeLinkStart','financeLinkFinish','financeUnlink']
    .map(bodyOf).join('\n');
  ok(!/body\.email|body\.user|params\.get\('email'\)/.test(all),
     'and none of them take an email from the caller', true);
}

section('The token is never written anywhere it could leak');
{
  /* Checked by running the endpoints with a known token in the record and
     reading what comes back, rather than by pattern-matching the source. The
     textual version flagged `linked: !!(rec && rec.accessToken)` - a boolean
     coercion, the opposite of a leak - which is how a source-shaped assertion
     ends up arguing with correct code. */
  const env = mkEnv();
  const TOKEN = 'access-DO-NOT-LEAK';
  await W.DB.put(env, 'fin', 'a@x.com', { accessToken: TOKEN, itemId:'it-9', linkedAt: Date.now() });
  serve({ '/link/token/create': { data: { link_token:'lt-2', hosted_link_url:'https://provider/hl/x' } },
          '/item/remove': { data: { removed:true } } });

  /* Audit lines go to the log, so the log is where they are read from. */
  const logged = [];
  const realLog = console.log;
  console.log = (...a) => { logged.push(a.join(' ')); };

  const bodies = [];
  bodies.push(await (await W.financeStatus(req(), env)).text());
  bodies.push(await (await W.financeLinkStart(req(), env)).text());
  bodies.push(await (await W.financeUnlink(req(), env)).text());
  console.log = realLog;

  const leaked = bodies.filter(b => b.indexOf(TOKEN) >= 0);
  ok(leaked.length === 0, 'no endpoint returns the access token', leaked);
  ok(logged.length > 0, 'the audit trail did record these actions', logged.length);
  ok(!logged.join('\n').includes(TOKEN), 'and no audit line carries the token', logged.length);

  const linkBody = (() => {
    const at = src.indexOf('async function financeLinkFinish');
    const next = src.slice(at + 1).search(/\n(?:async )?function [A-Za-z_$]/);
    return src.slice(at, at + 1 + next);
  })();
  ok(!/console\.(log|warn|error)/.test(linkBody), 'and the exchange logs nothing at all');
}

globalThis.fetch = realFetch;
if (report('finance-link') > 0) process.exitCode = 1;
done();
