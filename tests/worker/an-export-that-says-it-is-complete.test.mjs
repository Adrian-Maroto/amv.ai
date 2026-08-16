/* FOUR PLACES WHERE A FAILURE LOOKED EXACTLY LIKE A SUCCESS.

   AMV-039. The account export - the file somebody is handed when they ask what
   AMV holds on them - wrapped every read and every listing in `catch(e){}`, and
   then said, on the way out, "Everything AMV holds on the server for this
   account". So a storage error, a timeout, one page of a listing that did not
   come back, and the export was quietly short and claimed to be complete.

   That is not an ordinary swallowed error. It is the answer to "what do you
   have on me", and an answer missing a record nobody knows is missing is worse
   than a refusal, because the person cannot tell and stops asking.

   AMV-037. The error sink is public - it has to be, because the faults worth
   knowing about happen to people who are not signed in - and its index was
   pruned by raw COUNT. So the way to hide a real fault from the operator was to
   send more of something else. And the text it stores comes out of somebody's
   browser: a message and a stack quote whatever was in scope, which on an auth
   path is a token and on a reset page is the code in the URL. Nobody chose to
   send those; a stack trace quotes its surroundings and the report is
   automatic.

   AMV-046. `audit()` posted high-signal events to an external collector without
   waitUntil, under a comment saying "never block the request on logging". A
   Worker's isolate is free to be torn down the moment it answers, so that is
   not fire-and-forget, it is fire-and-maybe - and the faster the request, the
   less likely the event ever left. Auth failures, forged webhooks, spend
   blocks: the ones whose absence looks exactly like nothing having happened.

   AMV-044. And the widget loader, which runs on the customer's own site, obeyed
   a postMessage without asking where it came from. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'honest.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, accountExport, errorsReport, issueTokens, audit, _errScrub,' +
  ' _widgetLoaderJS, PER_USER_KINDS, ERR_MAX_GROUPS };\n');
const W = await import(harness + '?t=' + Date.now());

const realFetch = globalThis.fetch;
/* Armed only once the export is under way, AND aimed at a record
   authentication does not touch.

   Both are needed. requireUser runs inside the handler and reads `ent:`, so a
   stub that fails on that record breaks the sign-in before the export starts -
   the test then measures a 500 from authentication and calls it an export
   failure. The kinds used below (`wallet:`, `consent:`) are in the export's own
   roster and on nobody's authentication path. */
let ARMED = false;
function mkEnv(opts = {}) {
  const m = new Map(); const vals = new Map();
  return Object.assign({
    JWT_SECRET: 'x'.repeat(40), APP_URL: 'https://amv.test',
    _map: m, _vals: vals,
    AMV_KV: {
      async get(k) {
        if (ARMED && opts.failGet && opts.failGet.test(k)) throw new Error('storage unreachable');
        return m.has(k) ? m.get(k) : null;
      },
      async put(k, v) { m.set(k, String(v)); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        if (ARMED && opts.failList && opts.failList.test(String(prefix || ''))) throw new Error('listing unreachable');
        const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'rateCheck') { const nx = cur + 1; vals.set(n, nx); return new Response(JSON.stringify({ allowed: nx <= (b.limit || 9999) })); }
        if (b.op === 'reserve') { const nx = cur + (b.amount || 0); if (nx > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur })); vals.set(n, nx); return new Response(JSON.stringify({ allowed: true, value: nx })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, opts.env || {});
}
const EMAIL = 'me@example.com';
const seedAccount = async (env) => {
  await W.DB.put(env, 'acct', EMAIL, { email: EMAIL, name: 'Me', provider: 'email', createdAt: Date.now() });
  await W.DB.put(env, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now() });
  env._map.set('alog:' + EMAIL, JSON.stringify([{ e: 'signed_in', t: Date.now() }]));
};
const exportFor = async (env) => {
  const tok = (await W.issueTokens(env, EMAIL, 'Me')).token;
  const req = new Request('https://api.amv.test/v1/account/export', {
    headers: { Authorization: 'Bearer ' + tok, 'CF-Connecting-IP': '2.2.2.2' },
  });
  ARMED = true;
  try {
    const r = await W.accountExport(req, env);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } finally { ARMED = false; }
};

section('A complete export says so, and is the ordinary case');
{
  const env = mkEnv();
  await seedAccount(env);
  const r = await exportFor(env);
  ok(r.status === 200, 'the export is produced', r.status);
  ok(r.body.complete === true, 'and says it is complete', r.body.complete);
  ok(!r.body.unreadable, 'with nothing listed as missing', r.body.unreadable);
  ok(/Everything AMV holds/.test(r.body.note), 'so the note may claim everything', r.body.note);
  ok(!!r.body.records.acct, 'and the account is in it', Object.keys(r.body.records));
}

section('THE FINDING: an export that is short does not claim to be everything');
{
  const env = mkEnv({ failGet: /^wallet:/ });
  await seedAccount(env);
  const r = await exportFor(env);

  ok(r.status === 200, 'the person still gets what could be read', r.status);
  ok(r.body.complete === false, 'and it says plainly that it is not complete', r.body.complete);
  ok(!/Everything AMV holds/.test(r.body.note), 'the note no longer claims everything', r.body.note);
  ok(/INCOMPLETE/.test(r.body.note), 'it says the opposite, in a word nobody misreads', r.body.note);
  ok(/Nothing has been deleted/i.test(r.body.note),
     'and says the missing records exist, which is the question they will ask', r.body.note);
  ok(Array.isArray(r.body.unreadable) && r.body.unreadable.length > 0,
     'what could not be read is named', r.body.unreadable);
  ok(r.body.unreadable.some(u => u.what === 'wallet'), 'by kind', r.body.unreadable);
  ok(!!r.body.records.acct, 'while everything that COULD be read is still there', Object.keys(r.body.records));
}

section('A listing that fails halfway is a gap too, not a shorter export');
{
  const env = mkEnv({ failList: /^resume:/ });
  await seedAccount(env);
  const r = await exportFor(env);
  ok(r.body.complete === false, 'the export knows it is short', r.body.complete);
  ok(r.body.unreadable.some(u => /resume/.test(u.what)), 'and names the listing', r.body.unreadable);
}

section('And when the SUBJECT cannot be read, there is nothing to hand over');
{
  /* An export missing the account record is not a partial export, it is a file
     about nobody. That one is refused rather than delivered with a note. */
  const env = mkEnv({ failGet: /^acct:/ });
  await seedAccount(env);
  const r = await exportFor(env);
  ok(r.status === 503, 'it refuses rather than handing over an empty file', r.status);
  ok(r.body.code === 'export_unavailable', 'with a code', r.body.code);
  ok(/try again/i.test(r.body.error || ''), 'and something to do about it', r.body.error);
  ok(/Nothing has been lost/i.test(r.body.error || ''), 'and reassurance that is true', r.body.error);
}

section('A credential is still never handed back, complete or not');
{
  const env = mkEnv();
  await seedAccount(env);
  env._map.set('smsverify:' + EMAIL + ':+15551110000', JSON.stringify({ code: '123456', attempts: 0 }));
  const r = await exportFor(env);
  const dump = JSON.stringify(r.body);
  ok(!dump.includes('123456'), 'a pending verification code is not in the file', true);
  ok(Object.keys(r.body.withheld).some(k => /smsverify/.test(k)),
     'it is named as withheld instead', Object.keys(r.body.withheld));
}

section('A stack trace does not carry somebody’s token into the dashboard');
{
  const cases = [
    ['Authorization: Bearer abcdefghijklmnop123456', /Bearer abcdef/, 'a bearer header'],
    ['at https://amv.homes/reset?token=SECRETVALUE123&x=1', /SECRETVALUE123/, 'a code in a URL'],
    ['at /auth?code=abc123XYZ&state=1', /abc123XYZ/, 'an OAuth code'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jIn0.sIgNaTuRexxx', /eyJhbGciOi/, 'a JWT'],
    ['key sk_live_abcdef1234567890 rejected', /sk_live_abcdef/, 'a provider key'],
    ['failed for alice@example.com', /alice@example\.com/, 'an address'],
  ];
  for (const [text, leak, what] of cases) {
    const out = W._errScrub(text, 300);
    ok(!leak.test(out), what + ' is removed', { in: text.slice(0, 40), out });
    ok(out.length > 0, 'and something is left to read', out);
  }
  ok(W._errScrub('TypeError: cannot read property x of undefined', 300)
     === 'TypeError: cannot read property x of undefined',
     'an ordinary error is untouched, which is the whole point of the dashboard');
  ok(/\[jwt\]|\[redacted\]|\[authorization\]/.test(W._errScrub('Bearer abcdefghijklmnop123456', 300)),
     'and what was removed leaves a marker, so an engineer can see a token WAS there');
  ok(W._errScrub(null, 300) === '' && W._errScrub(undefined, 10) === '', 'nothing is nothing, not a crash');
}

section('And a flood cannot push a real fault off the operator’s screen');
{
  /* The index is bounded, so something has to be dropped when it fills. This
     was ranked by raw count, so a sender with a loud invented error outranked a
     genuine fault that reached twenty customers. Ranked by how many DIFFERENT
     people hit it now. */
  const errs = codeOnly(functionBody(src, 'errorsReport') || '');
  ok(errs.length > 800, 'the sink was read', errs.length);
  ok(/const reach = \(k\)/.test(errs), 'eviction knows how far a fault reached', true);
  ok(/reach\(a\) - reach\(b\)/.test(errs), 'and sorts by it first', true);
  ok(/\|\| \(\(idx\.groups\[a\]\.count\|\|0\)-\(idx\.groups\[b\]\.count\|\|0\)\)/.test(errs),
     'with volume only as the tie-break', true);
  ok(/_errScrub\(raw\.msg/.test(errs) && /_errScrub\(raw\.stack/.test(errs),
     'and the text is scrubbed on the way IN, before it is stored or forwarded', true);
}

section('A logged event is registered, not left to be cancelled');
{
  const a = codeOnly(functionBody(src, 'audit') || '');
  ok(a.length > 200, 'audit was read', a.length);
  ok(!/\}\)\.catch\(\(\) => \{\}\);/.test(a),
     'no delivery is started and abandoned', true);
  ok((a.match(/_bg\(/g) || []).length >= 2,
     'both external deliveries are registered', (a.match(/_bg\(/g) || []).length);

  const bg = codeOnly(functionBody(src, '_bg') || '');
  ok(/waitUntil/.test(bg), 'and the thing they are registered with is waitUntil', true);
  ok(/catch/.test(bg), 'wrapped, because a finished context throws and logging must not break a request', true);

  const whole = codeOnly(src);
  ok(/_liveCtx = ctx;/.test(whole), 'a live context is adopted at the entry point', true);
  ok((whole.match(/_liveCtx = ctx/g) || []).length >= 2,
     'including the cron, whose events matter most', (whole.match(/_liveCtx = ctx/g) || []).length);

  /* It must not throw with no context at all, which is what every unit test and
     the first request after a cold start look like. */
  const env = mkEnv({ env: { AUDIT_WEBHOOK: 'https://collector.example/hook' } });
  let threw = null;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  try { W.audit(env, 'auth_fail', { email: 'x@example.com' }); } catch (e) { threw = e; }
  ok(threw === null, 'and logging with no context in scope does not throw', threw && threw.message);
}

section('The widget obeys the panel it opened, and nothing else on the page');
{
  /* This listener runs on the CUSTOMER'S site. It acted on a message without
     asking where it came from, so every frame on that page could send one. */
  const js = W._widgetLoaderJS('pk_test', 'https://app.amv.test');
  ok(/addEventListener\('message'/.test(js), 'the listener is there', true);
  ok(/e\.origin!==APP_ORIGIN/.test(js), 'and it checks the origin', true);
  ok(/e\.source!==frame\.contentWindow/.test(js), 'and that it came from the frame it created', true);

  const at = js.indexOf("addEventListener('message'");
  const handler = js.slice(at, js.indexOf('});', at));
  const iOrigin = handler.indexOf('e.origin');
  const iAct = handler.indexOf('__amvWidget');
  ok(iOrigin > -1 && iOrigin < iAct,
     'both checks happen before anything is acted on', { origin: iOrigin, act: iAct });
  ok(/APP_ORIGIN=\(function\(\)\{ try\{ return new URL\(SRC\)\.origin/.test(js),
     'and the origin it trusts is derived from the frame it built, not from the message', true);
}

globalThis.fetch = realFetch;
if (report('an-export-that-says-it-is-complete') > 0) process.exitCode = 1;
done();
