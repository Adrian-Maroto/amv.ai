/* A DROPPED CONNECTION SHOULD NOT COST THE ANSWER — the meter runs on a tee of
   the stream inside waitUntil, so when a client disconnects mid-answer the
   model keeps generating and AMV keeps paying for every output token, while
   the user gets nothing and retries, paying for the whole thing twice. On
   mobile that is routine. The meter already reads every byte, so it assembles
   the answer and parks it briefly for the client to collect. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'resume.harness.mjs');
writeFileSync(harness, src +
  '\nexport { _parkAnswer, resumeAnswer, RESUME_TTL_S, RESUME_MIN_CHARS, RESUME_MAX_CHARS, signToken };\n');
const W = await import(harness + '?t=' + Date.now());

function makeEnv() {
  const kv = new Map(), ttls = new Map();
  return { _kv: kv, _ttls: ttls, JWT_SECRET: 'test-secret-abcdefghijklmnop',
    AMV_KV: {
      get: async k => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v, o) => { kv.set(k, String(v)); if (o && o.expirationTtl) ttls.set(k, o.expirationTtl); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })) }) } };
}
const get = (env, token, id) => W.resumeAnswer(
  new Request('https://w/v1/resume?id=' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token } }), env);
const LONG = 'The finished answer. '.repeat(30);

section('An answer produced after the client vanished is recoverable');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  await W._parkAnswer(env, 'alice@x.com', 'turn123', LONG);
  const d = await (await get(env, token, 'turn123')).json();
  ok(d.ok === true, 'the client can collect it', d.ok);
  ok(d.text === LONG, 'complete and unchanged', d.text.length + ' chars');
}

section('It expires - this is a recovery buffer, not storage');
{
  const env = makeEnv();
  await W._parkAnswer(env, 'alice@x.com', 'turn123', LONG);
  const ttl = env._ttls.get('resume:alice@x.com:turn123');
  ok(ttl === W.RESUME_TTL_S, 'a TTL is set on the write', ttl);
  ok(ttl > 0 && ttl <= 3600, 'and it is short - minutes, not days', ttl);
}

section('One account can never read another account’s answer');
{
  const env = makeEnv();
  const bob = await W.signToken({ email: 'bob@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  await W._parkAnswer(env, 'alice@x.com', 'turn123', LONG);
  const d = await (await get(env, bob, 'turn123')).json();
  ok(d.ok === false, 'Bob asking for Alice’s id gets nothing', d);
  ok(!JSON.stringify(d).includes('finished answer'), 'and none of her text leaks', d);
}

section('It requires a signed-in user');
{
  const env = makeEnv();
  const r = await W.resumeAnswer(new Request('https://w/v1/resume?id=turn123'), env);
  ok(r.status === 401, 'no token, no answer', r.status);
}

section('The id is validated, not pasted into a key');
{
  const env = makeEnv();
  const token = await W.signToken({ email: 'alice@x.com' }, env.JWT_SECRET, 3600, env, 'access');
  for (const bad of ['a', '../../secret', 'x'.repeat(200), 'has space', 'a:b']) {
    const r = await get(env, token, bad);
    ok(r.status === 400, `"${bad.slice(0, 18)}" is rejected`, r.status);
  }
}

section('Trivial output is not written at all');
{
  const env = makeEnv();
  await W._parkAnswer(env, 'alice@x.com', 'tiny01', 'ok');
  ok(env._kv.size === 0, 'a two-character reply is not worth a KV write', env._kv.size);
  ok(W.RESUME_MIN_CHARS > 100, 'the floor is meaningful', W.RESUME_MIN_CHARS);
}

section('A huge answer is capped rather than refused');
{
  const env = makeEnv();
  await W._parkAnswer(env, 'alice@x.com', 'huge01', 'x'.repeat(W.RESUME_MAX_CHARS * 3));
  const stored = JSON.parse(env._kv.get('resume:alice@x.com:huge01'));
  ok(stored.text.length === W.RESUME_MAX_CHARS, 'stored up to the cap', stored.text.length);
}

section('Parking never breaks the response');
{
  const broken = { AMV_KV: { put: async () => { throw new Error('KV down'); } } };
  let threw = false;
  try { await W._parkAnswer(broken, 'alice@x.com', 'turn123', LONG); } catch (e) { threw = true; }
  ok(threw === false, 'a storage failure is swallowed - recovery is a bonus, not a dependency');
}

section('It is wired into the real request path');
{
  ok(/if \(reqId\) await _parkAnswer\(env, user && user\.email, reqId, answer\)/.test(src),
     'the meter parks the answer when the stream ends, however it ended');
  ok(/reqId: _reqId/.test(src), 'the proxy passes the id through');
  ok(/X-AMV-Request-Id/.test(src), 'which it reads from a header');
  ok(/\/\^\[A-Za-z0-9_-\]\{6,64\}\$\/\.test\(_rawId\)/.test(src), 'and validates before use');
  ok(/case '\/v1\/resume':/.test(src), 'the route exists');
  const cors = src.slice(0, src.indexOf('const SECURITY_HEADERS'));
  ok((cors.match(/X-AMV-Request-Id/g) || []).length >= 2,
     'the header is allowed on both CORS shapes, or the browser would block it');
}

section('The client asks for it before giving up');
{
  const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(/const _turnId = 'r'/.test(client), 'every turn carries an id');
  ok(/'X-AMV-Request-Id': _turnId/.test(client), 'sent on the request');
  ok(/_recoverAnswer\(_turnId\)/.test(client), 'and a stall tries to recover before erroring');
  ok(/_recovered=true/.test(client), 'a recovered answer is marked complete, not cut off');
  ok(/ai-recovered/.test(client), 'and the user is told why it arrived that way');
}

report();
done();
