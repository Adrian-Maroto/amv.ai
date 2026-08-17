/* "YOUR ACCOUNT HAS BEEN DELETED" IS A STATEMENT TO A REGULATOR.

   Not a status message. Under GDPR and CCPA a person asks for erasure, AMV
   answers, and that answer is the record of whether the obligation was met.

   The loop that does it looked like this:

       for (const kind of perUserKinds) {
         try { await DB.del(env, kind, email); deleted++; } catch {}
       }

   Every delete that threw was swallowed whole. A storage hiccup on one kind, a
   D1 timeout on another, and the route returned ok with a smaller number nobody
   compares to anything. The person is told their data is gone. Their bank
   connection, their saved conversations, their family record are still there.
   Nobody finds out - not them, not the operator - because the only trace was a
   counter that quietly counted lower.

   What has to be true instead: a failure is a failure. It is named, it is
   reported to the person asking, somebody is paged, and the request does not
   come back a success. Erasure that half-worked and said so can be finished by
   hand; erasure that half-worked and said nothing cannot, because nobody knows
   to look. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'erasehonest.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, PER_USER_KINDS };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

let alerts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (/hooks\.|slack|discord/i.test(String(url))) { alerts.push(String((opts && opts.body) || '')); }
  return { ok: true, status: 200, json: async () => ({}) };
};

/* A store that can be told to fail a specific kind, the way real storage fails:
   one operation, not the whole thing. */
function mkEnv(failKinds = []) {
  const m = new Map(); const n = new Map(); alerts = [];
  const fail = new Set(failKinds);
  return {
    JWT_SECRET: 'a-real-looking-secret-value-for-tests', ADMIN_TOKEN: 'a',
    APP_URL: 'https://amv.test', ALERT_WEBHOOK: 'https://hooks.example/a',
    _failed: fail,
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) {
        const kind = String(k).split(':')[0];
        if (fail.has(kind)) throw new Error('storage refused to delete ' + kind);
        m.delete(k);
      },
      async list({ prefix, limit } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: all.slice(0, limit || 1000), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (x) => x,
      get: (x) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = n.get(x) || 0;
        if (b.op === 'rateCheck') { n.set(x, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') { if (n.has('c:' + x)) return new Response(JSON.stringify({ claimed: false })); n.set('c:' + x, 1); return new Response(JSON.stringify({ claimed: true })); }
        if (b.op === 'release') { n.delete('c:' + x); return new Response(JSON.stringify({ ok: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, p, b, t) => { const r = await call(env, p, b, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const PW = 'A-real-Passw0rd!';
const USER = 'leaving@example.com';
async function anAccountWithThings(env) {
  const tok = (await (await call(env, '/auth/signup', { email: USER, name: 'L', password: PW })).json()).token;
  await W.DB.put(env, 'ent', USER, { plan: 'pro', source: 'stripe' });
  await W.DB.put(env, 'fin', USER, { accessToken: 'bank-token', linkedAt: Date.now() });
  await W.DB.put(env, 'data', USER, { convs: [{ id: 'c1', msgs: [{ r: 'u', c: 'private' }] }] });
  await W.DB.put(env, 'auto', USER, { items: [{ id: 'j1', active: true }] });
  return tok;
}

section('When everything can be deleted, it is - and that is what is said');
{
  const env = mkEnv();
  const tok = await anAccountWithThings(env);
  const r = await post(env, '/auth/delete', { confirm: 'DELETE', password: PW }, tok);
  ok(r.body.ok === true, 'the request succeeds', r.body.error || 'ok');
  ok(!(r.body.failed || []).length, 'nothing is reported as left behind', r.body.failed);

  const left = [];
  for (const k of ['ent', 'fin', 'data', 'auto', 'acct']) {
    if (await W.DB.get(env, k, USER)) left.push(k);
  }
  ok(left.length === 0, 'and nothing actually is', left);
}

section('When a delete fails, the request does NOT come back a success');
{
  /* The bank credential is the one that matters most, so it is the one made to
     fail. Told "deleted", the person believes AMV can no longer reach their
     accounts. */
  const env = mkEnv(['fin']);
  const tok = await anAccountWithThings(env);
  const r = await post(env, '/auth/delete', { confirm: 'DELETE', password: PW }, tok);

  ok(r.body.ok !== true, 'it is not reported as done', r.body);
  ok(r.status >= 500 || r.body.incomplete === true,
     'the response says the erasure was incomplete', { status: r.status, incomplete: r.body.incomplete });
  ok((r.body.failed || []).includes('fin'),
     'naming exactly what could not be removed', r.body.failed);
  ok(/could not|not.*(delete|remove)|incomplete/i.test(r.body.error || r.body.message || ''),
     'in words the person can act on', r.body.error || r.body.message);
}

section('Everything that COULD go, still went');
{
  /* A partial failure must not become a reason to keep the rest. The person
     asked to be erased; as much of that as can happen, happens.

     The kind made to fail is the FIRST one the loop reaches, and the kind
     checked afterwards is the LAST. Failing something near the end passes even
     if the loop gives up on the first error - there is nothing after it to
     leave behind - so the case has to be built from the real order. */
  const kinds = W.PER_USER_KINDS;
  /* The EARLIEST kind that is not `acct`. Confirming a deletion reads the
     account record to check the password (AMV-015), so a store that cannot
     serve `acct` refuses before anything is erased rather than erasing half -
     which is the right answer and makes `acct` useless as the injected
     failure here. Everything after it still has to be reached, which is what
     this case is about. */
  const firstKind = kinds.find(k => k !== 'acct');
  const lastKind = kinds[kinds.length - 1];
  ok(firstKind && firstKind !== lastKind && kinds.length > 3,
     'there is a real list to walk', { first: firstKind, last: lastKind, n: kinds.length });
  ok(kinds.indexOf(firstKind) <= 1,
     'and the failure is injected near the front, so there is plenty after it',
     kinds.indexOf(firstKind));

  const env = mkEnv([firstKind]);
  const tok = await anAccountWithThings(env);
  await W.DB.put(env, firstKind, USER, { something: true });
  await W.DB.put(env, lastKind, USER, { something: true });
  await post(env, '/auth/delete', { confirm: 'DELETE', password: PW }, tok);

  ok(!(await W.DB.get(env, lastKind, USER)),
     'a kind AFTER the failing one is still deleted - the loop does not give up', lastKind);
  ok(!!(await W.DB.get(env, firstKind, USER)), 'and only the one that failed remains', firstKind);

  const stillThere = [];
  for (const k of ['ent', 'data', 'auto']) {
    if (k !== firstKind && await W.DB.get(env, k, USER)) stillThere.push(k);
  }
  ok(stillThere.length === 0, 'along with everything else that could go', stillThere);
}

section('Somebody is told, because the person cannot fix it themselves');
{
  const env = mkEnv(['fin', 'data']);
  const tok = await anAccountWithThings(env);
  await post(env, '/auth/delete', { confirm: 'DELETE', password: PW }, tok);
  await ctx.settle();

  ok(alerts.length > 0, 'an operator is paged', alerts.length);
  const blob = alerts.join(' ');
  ok(/eras|delet/i.test(blob), 'about an erasure', blob.slice(0, 120));
  ok(/fin|data/.test(blob), 'naming what is still there to be removed by hand', blob.slice(0, 200));
}

section('And it is in the audit record, not only in a reply nobody kept');
{
  /* The reply goes to somebody who is leaving and will not keep it. The record
     that matters later - to an auditor, or to the person's lawyer - is AMV's. */
  const env = mkEnv(['fin']);
  const tok = await anAccountWithThings(env);
  const seen = [];
  const realLog = console.log;
  console.log = (...a) => { seen.push(a.join(' ')); };
  await post(env, '/auth/delete', { confirm: 'DELETE', password: PW }, tok);
  console.log = realLog;

  const audits = seen.filter(l => /^AUDIT/.test(l)).join(' ');
  ok(/erase|delete/i.test(audits), 'the deletion is audited', audits.slice(0, 140));
  ok(/fin/.test(audits), 'including what survived it', audits.slice(0, 240));
}

section('The claim in the code is the claim in the response');
{
  /* A source check, because the swallow is one character wide and comes back
     the moment somebody tidies up. */
  const at = src.indexOf('for (const kind of perUserKinds)');
  ok(at > 0, 'the erasure loop was found', at > 0);
  const loop = src.slice(at, at + 400);
  ok(!/catch\s*\{\s*\}/.test(loop) && !/catch\s*\([^)]*\)\s*\{\s*\}/.test(loop),
     'no delete failure is swallowed silently', loop.split('\n').slice(0, 6).join(' ').slice(0, 160));
}

globalThis.fetch = realFetch;
if (report('deleted-has-to-mean-deleted') > 0) process.exitCode = 1;
done();
