/* A CHILD CAPPED AT $10 A MONTH COULD MAKE AN API KEY AND SPEND WITHOUT IT.

   Everything that decides whether money may be spent reads fields off the
   object the authentication path returns: the billing subject the quotas are
   keyed by, whether the account is blocked, and the family limits a parent set.

   Three places built that object. The browser session built it completely. The
   API key returned five fields of its own - email, plan, custom config, billing
   state, bonus tokens - and none of the three that stop spending. The SMS
   handler built six by hand and also left out the family.

   So the parent's monthly limit, which is the whole point of a family account,
   applied to the browser and to nothing else. A child could create an API key
   in settings and spend past it, or text AMV all month. A team member's key
   drew on their own email rather than the team's pooled allowance, so the
   ceiling the team pays for did not apply to it. An account blocked for
   charging back kept working through a key it made earlier.

   None of it was a missing idea. It was one resolution copied twice and then
   left behind as the original grew - and the SMS copy carries a comment saying
   a parent's limit reaches it, above code that could not do that.

   These cases go through the real routes with a real key and a real signed
   text, because the defect was never in the helper. It was in what the callers
   handed it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'principal.harness.mjs');
writeFileSync(harness, src + '\nexport { DB, _principalOf, requireUser, ENGINES };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const CHILD = 'child@example.com';
const PW = 'A-real-Passw0rd!';
const TWILIO = 'twilio-auth-token';
const PHONE = '+15550002222';
const CAP = 10;

const realFetch = globalThis.fetch;
let modelCalls = 0;
const sse = () => 'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
  + 'data: {"type":"message_delta","usage":{"output_tokens":100}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/model\.example/.test(u)) {
    modelCalls++;
    return new Response(sse(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return { ok: true, status: 200, json: async () => ({ content: [{ text: 'hi' }], usage: {} }) };
};

function mkEnv() {
  const m = new Map(); const vals = new Map(); modelCalls = 0;
  return {
    AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example',
    JWT_SECRET: 'j', APP_URL: 'https://amv.test', TWILIO_AUTH_TOKEN: TWILIO,
    GLOBAL_DAILY_USD_CAP: '100000',
    _vals: vals,
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'reserve') {
          const amt = Number(b.amount);
          if (!Number.isFinite(amt) || amt < 0) return new Response(JSON.stringify({ allowed: false, value: cur }));
          if (b.cap != null && b.cap !== Infinity && cur + amt > b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          vals.set(n, cur + amt); return new Response(JSON.stringify({ allowed: true, value: cur + amt }));
        }
        if (b.op === 'incr') { vals.set(n, Math.max(0, cur + (b.amount || 0))); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: b.cap == null || cur < b.cap, value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        if (b.op === 'claim') return new Response(JSON.stringify({ claimed: true }));
        if (b.op === 'release') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  };
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { const p = this._p || []; this._p = []; await Promise.all(p); } };
const call = (env, path, body, headers, method) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.8.8' }, headers || {}),
  ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
}), env, ctx);

/* A child on a paid plan whose parent set a monthly limit - built through the
   two records _familyOf actually reads, since membership is the source of
   truth and a family record without it resolves to no cap at all. */
async function child(env) {
  const r = await call(env, '/auth/signup', { email: CHILD, name: 'C', password: PW });
  const tok = (await r.json()).token;
  await W.DB.put(env, 'ent', CHILD, { plan: 'ultra', updatedAt: Date.now(), renewedAt: Date.now(),
                                      source: 'stripe', familyOf: 'fam1' });
  await W.DB.put(env, 'fam', 'fam1', { id: 'fam1', parentEmail: 'parent@example.com',
    members: [{ email: CHILD, role: 'child', limits: { monthlyUSD: CAP } }] });
  return tok;
}
async function apiKey(env, tok) {
  const r = await call(env, '/v1/keys/create', { name: 'mine' }, { Authorization: 'Bearer ' + tok });
  const d = await r.json();
  return d.key || d.apiKey || d.value || '';
}
async function sms(env, body) {
  const url = 'https://api.amv.test/sms/incoming';
  const params = { From: PHONE, Body: body };
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TWILIO),
                                            { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return worker.fetch(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
               'X-Twilio-Signature': Buffer.from(new Uint8Array(mac)).toString('base64'),
               'CF-Connecting-IP': '8.8.8.8' },
    body: new URLSearchParams(params).toString(),
  }), env, ctx);
}
const costKey = (env) => [...env._vals.keys()].find(k => k.startsWith('cost:')) || '';

section('The parent’s limit reaches a browser session, which always worked');
{
  const env = mkEnv();
  const tok = await child(env);
  const u = await W.requireUser(new Request('https://x/', { headers: { Authorization: 'Bearer ' + tok } }), env);
  ok(u && u.email === CHILD, 'the session resolves', u && u.email);
  ok(u.family && u.family.limits && u.family.limits.monthlyUSD === CAP,
     'and carries the limit their parent set', u.family && u.family.limits);
}

section('And an API key is the same account, so it carries the same limit');
{
  /* The finding. A key is a credential for this account; it cannot be a way to
     become a different account with fewer rules. */
  const env = mkEnv();
  const tok = await child(env);
  const key = await apiKey(env, tok);
  ok(key && key.length > 10, 'a key was issued', key ? key.slice(0, 8) + '...' : key);

  const u = await W.requireUser(new Request('https://x/', { headers: { Authorization: 'Bearer ' + key } }), env);
  ok(u && u.email === CHILD, 'the key resolves to the same person', u && u.email);
  ok(u.family && u.family.limits && u.family.limits.monthlyUSD === CAP,
     'and carries the family limit, which it used to omit entirely', u && u.family);
  ok(u.billingSubject, 'and a billing subject, so quotas are keyed the same way', u && u.billingSubject);
  ok(u.blocked === false, 'and a block state that can actually be read', u && u.blocked);
}

section('So spending through a key stops at the cap a parent set');
{
  /* Read through the door, not off the principal. A field present on an object
     is not the same claim as a refusal reaching the person using it. */
  const env = mkEnv();
  const tok = await child(env);
  const key = await apiKey(env, tok);

  const first = await call(env, '/v1/messages',
    { model: 'amv-core', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] },
    { Authorization: 'Bearer ' + key });
  await first.text().catch(() => {});
  await ctx.settle();
  ok(first.status === 200, 'an ordinary API turn is served', first.status);

  /* Now they are at the limit their parent set. */
  const ck = costKey(env);
  ok(ck, 'the account cost counter was found', ck);
  env._vals.set(ck, CAP);

  const after = await call(env, '/v1/messages',
    { model: 'amv-core', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] },
    { Authorization: 'Bearer ' + key });
  const body = await after.json().catch(() => ({}));
  ok(after.status === 429, 'past the limit the key is refused', after.status);
  ok(body.code === 'family_cap',
     'and told it is the family limit, not the plan - which is the only one they can do anything about',
     body.code);
}

section('A blocked account cannot spend through a key it made earlier');
{
  /* The block rides on the entitlement and the key path never read it, so
     suspending an account for charging back left every key it had still live. */
  const env = mkEnv();
  const tok = await child(env);
  const key = await apiKey(env, tok);

  const e = await W.DB.get(env, 'ent', CHILD);
  e.blocked = true; e.blockedReason = 'chargeback';
  await W.DB.put(env, 'ent', CHILD, e);

  const u = await W.requireUser(new Request('https://x/', { headers: { Authorization: 'Bearer ' + key } }), env);
  ok(u && u.blocked === true, 'the key sees the block', u && u.blocked);

  const before = modelCalls;
  const r = await call(env, '/v1/messages',
    { model: 'amv-core', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] },
    { Authorization: 'Bearer ' + key });
  await r.text().catch(() => {});
  ok(r.status === 403, 'and the turn is refused', r.status);
  ok(modelCalls === before, 'with no model call made', modelCalls - before);
}

section('And a text message is bounded by the same limit');
{
  /* AMV-023. The ceiling check on this path calls the shared helper under a
     comment saying a parent's limit reaches it - and the object it was handed
     had no family on it, so it could only ever answer with the plan backstop. */
  const env = mkEnv();
  await child(env);
  env.AMV_KV._map.set(`sms:phone:${PHONE}`, CHILD);

  const first = await sms(env, 'hello');
  await ctx.settle();
  ok(first.status === 200, 'an ordinary text is answered', first.status);

  const ck = costKey(env);
  ok(ck, 'the same cost counter the browser uses', ck);
  env._vals.set(ck, CAP);

  const before = modelCalls;
  const after = await sms(env, 'again');
  const text = await after.text();
  ok(modelCalls === before, 'past the family limit no model call is made', modelCalls - before);
  ok(/limit|allowance|resets/i.test(text),
     'and the sender is told, in a text they can read', text.slice(0, 140));
}

section('There is one resolution, not three');
{
  /* The structural half, and the property is not "one call site exists".

     Counting call sites was the first version and it was wrong: the cron and
     the widget legitimately resolve a principal for somebody who is NOT the
     requester - a scheduled job has no request, and a widget spends its
     owner's money while a stranger types into it. Both already resolve the
     family themselves. A check that demanded a single call site would have
     been failing on correct code, which is the kind of check people delete.

     What matters is that every door a REQUEST comes through resolves the same
     way, and that the shared resolution really covers the three things that
     were missing. */
  for (const fn of ['requireUser', '_userFromApiKey', 'smsIncoming']) {
    const body = codeOnly(functionBody(src, fn));
    ok(/_principalOf\(/.test(body), fn + ' goes through the shared principal', true);
  }

  const p = codeOnly(functionBody(src, '_principalOf'));
  ok(p.length > 300, 'the shared principal was read', p.length);
  for (const field of ['billingSubject', 'blocked', 'family']) {
    ok(new RegExp('data\\.' + field + '\\s*=').test(p), 'it sets ' + field, true);
  }

  /* And the two non-request resolvers carry the family too, because a parent's
     limit has to reach a scheduled job and a widget as much as a browser. */
  const cron = codeOnly(functionBody(src, 'runDueAutomations'));
  ok(cron.length > 500, 'the scheduled runner was read', cron.length);
  ok(/_familyOf\(env/.test(cron),
     'the scheduled runner resolves the family limits', true);
  ok(/_billingSubjectOf\(env/.test(cron),
     'and the billing subject, so a seat does not come with a second budget', true);
  const wc = codeOnly(functionBody(src, 'widgetChat'));
  ok(/_familyOf\(env/.test(wc), 'and so does the widget, for its owner', true);
}

globalThis.fetch = realFetch;
if (report('every-door-into-the-account-is-the-same-door') > 0) process.exitCode = 1;
done();
