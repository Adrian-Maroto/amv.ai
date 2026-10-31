/* A SIGNED REQUEST PROVES WHO SENT IT.

   An address can leak - into a proxy log, a screenshot, a ticket - so a job
   can require every request to be signed by the service that sends it, with
   a secret that never appears in a URL. Each scheme is driven with signatures
   computed the way that service computes them (Node's own HMAC, not AMV's
   code), through the real routes:

     - GitHub, Stripe, Slack and AMV's standard (Standard Webhooks) each
       accept their own signature and refuse a wrong one, a missing one, and
       a body changed after signing;
     - a request older or newer than five minutes is refused, where the
       scheme carries a time;
     - a replay is a duplicate even with a new unsigned id on it, and even
       after the job's short list of recent ids has moved on;
     - a new secret leaves the old one working for a day, then not;
     - Slack's set-up question is answered only with the app's secret;
     - the secret is shown once when AMV makes it, and never in the job list;
     - an edit to the job from an older copy cannot take signing off;
     - a new address keeps signing; turning it off accepts the address alone. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHmac } from 'crypto';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'signedhooks.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + `
export { runDueAutomations, issueTokens };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'signed@test.com';
const store = new Map();
const vals = new Map();
let rateCap = 1000;
let afterRead = null;
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  CONNECT_KEY: 'a-connect-key-for-sealing-at-least-32-chars',
  AMV_MODEL_KEY: 'k', AMV_KV: {
    async get(k){
      const v = store.has(k) ? store.get(k) : null;
      /* A request that lands just after the tick has read the job, before
         its run has begun: in the record, not in the tick's copy. */
      if (k === 'auto:' + ME && afterRead) { const f = afterRead; afterRead = null; f(); }
      return v;
    },
    async put(k, v){ store.set(k, v); },
    async delete(k){ store.delete(k); },
    async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (n) => ({ async fetch(_u, init) {
      const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
      if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: n.startsWith('act:hook:') ? cur + 1 <= rateCap : true })); }
      if (b.op === 'reserve') { vals.set(n, cur + b.amount); return new Response(JSON.stringify({ allowed: true, value: vals.get(n) })); }
      if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
      return new Response(JSON.stringify({ allowed: true, ok: true, value: cur }));
    } }),
  } };
const ctx = { waitUntil(){}, passThroughOnException(){} };
store.set('ent:' + ME, JSON.stringify({ plan: 'ultra', renewedAt: Date.now() }));
const pair = await W.issueTokens(env, ME, 'Signed');

let prompts = [];
let duringRun = null;
globalThis.fetch = async (url, init) => {
  let b = {}; try { b = JSON.parse(String((init && init.body) || '{}')); } catch (e) {}
  const m = (b.messages || [])[(b.messages || []).length - 1];
  prompts.push(typeof (m && m.content) === 'string' ? m.content : JSON.stringify(m && m.content));
  if (duringRun) { const f = duringRun; duringRun = null; await f(); }
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Order 1042 is for two lamps.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
};
let ip = 1;
const post = async (path, body, e = env) => {
  const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pair.token, Origin: 'https://amv.test', 'CF-Connecting-IP': '9.9.6.' + (ip++ % 250) },
    body: JSON.stringify(body) }), e, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
/* A request from the other service: no sign-in, no Origin, just the address. */
const send = async (url, body, headers = {}, method = 'POST') => {
  const r = await W.default.fetch(new Request(url, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), env, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const rec = () => JSON.parse(store.get('auto:' + ME) || '{"items":[],"results":[]}');
const job = (id) => rec().items.find(x => x.id === id);
const tickAt = async (t) => { await W.runDueAutomations(env, t); return rec(); };


const hmacHex = (key, text) => createHmac('sha256', key).update(text).digest('hex');
const nowS = () => Math.floor(Date.now() / 1000);
let n = 0;
const make = async (words) => {
  const r = await post('/auto/create', { detail: 'Summarise what arrived.', repeat: '10min', approval: 'auto', when: { source: 'hook', ...(words ? { words } : {}) } });
  return { url: r.d.hookUrl, id: r.d.item && r.d.item.id };
};
const sign = (id, kind, secret) => post('/auto/hook', { id, action: 'sign', kind, ...(secret ? { secret } : {}) });
const payload = (tag) => JSON.stringify({ event: 'order.created', order: { id: tag, n: ++n } });

section('GitHub: X-Hub-Signature-256 over the body');
{
  const j = await make();
  const s = await sign(j.id, 'github');
  ok(s.status === 200 && s.d.signed === 'github' && /^[0-9a-f]{64}$/.test(s.d.secret || ''), 'AMV makes a secret and shows it once', s.d);
  const secret = s.d.secret;
  const b = payload('gh1');
  const good = await send(j.url, b, { 'X-Hub-Signature-256': 'sha256=' + hmacHex(secret, b), 'X-GitHub-Delivery': 'd1' });
  ok(good.status === 202, 'a request GitHub signed is accepted', good);
  const unsigned = await send(j.url, payload('gh2'));
  ok(unsigned.status === 401 && unsigned.d.code === 'signature_required' && /X-Hub-Signature-256/.test(unsigned.d.error), 'the address alone is refused, naming the header', unsigned.d);
  const wrong = await send(j.url, payload('gh3'), { 'X-Hub-Signature-256': 'sha256=' + hmacHex('not-the-secret-at-all', payload('gh3')) });
  ok(wrong.status === 401 && wrong.d.code === 'bad_signature', 'a signature with another secret is refused', wrong.d);
  const b2 = payload('gh4');
  const changed = await send(j.url, b2.replace('order.created', 'order.refunded'), { 'X-Hub-Signature-256': 'sha256=' + hmacHex(secret, b2) });
  ok(changed.status === 401 && changed.d.code === 'bad_signature', 'and so is a body changed after it was signed', changed.d);
  const replay = await send(j.url, b, { 'X-Hub-Signature-256': 'sha256=' + hmacHex(secret, b), 'X-GitHub-Delivery': 'a-new-id-the-replayer-made-up' });
  ok(replay.status === 200 && replay.d.duplicate, 'a replay with a made-up delivery id is still a duplicate - the id comes from what was signed', replay.d);
  /* Past the job's list of recent ids: GitHub's scheme carries no time, so
     only the longer memory stands between a captured request and a re-run. */
  const it = job(j.id); it.hook.seen = []; const r = rec(); r.items = r.items.map(x => x.id === j.id ? it : x); store.set('auto:' + ME, JSON.stringify(r));
  const later = await send(j.url, b, { 'X-Hub-Signature-256': 'sha256=' + hmacHex(secret, b) });
  ok(later.status === 200 && later.d.duplicate, 'and still one after the job’s short list has moved on', later.d);
  const mine = await sign(j.id, 'github', 'my-own-github-secret-123');
  ok(mine.status === 200 && mine.d.secret === undefined, 'a secret pasted from GitHub is kept, and not shown back', mine.d);
  const bp = payload('gh5');
  const withPasted = await send(j.url, bp, { 'X-Hub-Signature-256': 'sha256=' + hmacHex('my-own-github-secret-123', bp) });
  ok(withPasted.status === 202, 'and requests signed with it are accepted', withPasted);
}

section('Stripe: Stripe-Signature t=..,v1=.. over "t.body", five minutes either way');
let stripeJob;
{
  const j = stripeJob = await make();
  const bad = await sign(j.id, 'stripe', 'not-a-stripe-secret');
  ok(bad.status === 400 && bad.d.code === 'bad_secret' && /whsec_/.test(bad.d.error), 'a pasted secret of the wrong shape is caught when it is saved', bad.d);
  const secret = 'whsec_' + 'Ab3'.repeat(10);
  const s = await sign(j.id, 'stripe', secret);
  ok(s.status === 200 && s.d.signed === 'stripe' && s.d.secret === undefined, 'Stripe’s own secret is kept, not shown back', s.d);
  const head = (b, t, k = secret) => ({ 'Stripe-Signature': 't=' + t + ',v1=' + hmacHex(k, t + '.' + b) + ',v0=ignored' });
  const b = payload('st1');
  ok((await send(j.url, b, head(b, nowS()))).status === 202, 'a request Stripe signed now is accepted', true);
  const old = payload('st2');
  const o = await send(j.url, old, head(old, nowS() - 301));
  ok(o.status === 401 && o.d.code === 'stale_signature', 'one signed five minutes and a second ago is refused', o.d);
  const fut = payload('st3');
  /* Half a minute past the window, not one second: the clock can tick over
     between dating the request here and the Worker reading it, which moves a
     future date one second NEARER - a CI run once landed on exactly 300. */
  ok((await send(j.url, fut, head(fut, nowS() + 330))).d.code === 'stale_signature', 'and so is one dated in the future', true);
  const moved = payload('st4'); const t = nowS();
  const m = await send(j.url, moved, { 'Stripe-Signature': 't=' + (t + 1) + ',v1=' + hmacHex(secret, t + '.' + moved) });
  ok(m.status === 401 && m.d.code === 'bad_signature', 'changing the time to dodge the window breaks the signature', m.d);
  const retry = await send(j.url, b, head(b, nowS() + 1));
  ok(retry.status === 200 && retry.d.duplicate, 'Stripe’s retry of the same event (new time, new signature) is one request', retry.d);
}

section('A new secret: the old one works for a day, then not');
{
  const j = stripeJob;
  const oldKey = 'whsec_' + 'Ab3'.repeat(10), newKey = 'whsec_' + 'Zz9'.repeat(10);
  const s = await sign(j.id, 'stripe', newKey);
  ok(s.status === 200 && s.d.oldSecretUntil > Date.now() + 23 * 3600e3, 'it says how long the old secret keeps working', s.d);
  const head = (b, k) => { const t = nowS(); return { 'Stripe-Signature': 't=' + t + ',v1=' + hmacHex(k, t + '.' + b) }; };
  const a = payload('rot1'), b = payload('rot2');
  ok((await send(j.url, a, head(a, newKey))).status === 202, 'the new secret signs', true);
  ok((await send(j.url, b, head(b, oldKey))).status === 202, 'and the old one still does, while the sender is updated', true);
  const list = await post('/auto/list', {});
  const row = (list.d.items || []).find(x => x.id === j.id);
  ok(row && row.hook && row.hook.signed === 'stripe' && row.hook.oldSecretUntil > Date.now(), 'the job list says signing is on and the old secret is ending', row && row.hook);
  const r = rec(); const it = r.items.find(x => x.id === j.id); it.hook.sig.pUntil = Date.now() - 1; store.set('auto:' + ME, JSON.stringify(r));
  const c = payload('rot3');
  const late = await send(j.url, c, head(c, oldKey));
  ok(late.status === 401 && late.d.code === 'bad_signature', 'a day later the old secret is refused', late.d);
}

section('Slack: X-Slack-Signature v0 over "v0:ts:body", and its set-up question');
{
  const j = await make();
  const secret = '0123456789abcdef0123456789abcdef';
  ok((await sign(j.id, 'slack', 'short')).d.code === 'bad_secret', 'a Slack secret must be its 32 characters', true);
  await sign(j.id, 'slack', secret);
  const head = (b, k = secret, t = nowS()) => ({ 'X-Slack-Request-Timestamp': String(t), 'X-Slack-Signature': 'v0=' + hmacHex(k, 'v0:' + t + ':' + b) });
  const ch = JSON.stringify({ token: 'x', challenge: 'prove-it-3f9', type: 'url_verification' });
  const v = await send(j.url, ch, head(ch));
  ok(v.status === 200 && v.d.challenge === 'prove-it-3f9', 'Slack’s question when the app is set up is answered', v.d);
  const forged = await send(j.url, ch, head(ch, 'ffffffffffffffffffffffffffffffff'));
  ok(forged.status === 401 && forged.d.challenge === undefined, 'but not to a request without the app’s secret', forged.d);
  const ev = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'new order 77 from the shop' } });
  ok((await send(j.url, ev, head(ev))).status === 202, 'a signed event is accepted', true);
  const stale = JSON.stringify({ type: 'event_callback', event: { type: 'message', text: 'order 78' } });
  ok((await send(j.url, stale, head(stale, secret, nowS() - 400))).d.code === 'stale_signature', 'an old one is refused', true);
}

section('AMV’s standard (Standard Webhooks): webhook-id, webhook-timestamp, webhook-signature');
{
  const j = await make();
  const s = await sign(j.id, 'amv');
  ok(s.status === 200 && /^whsec_[A-Za-z0-9+/]+=*$/.test(s.d.secret || ''), 'AMV makes a whsec_ secret and shows it once', s.d.secret && s.d.secret.slice(0, 8));
  const key = Buffer.from(s.d.secret.slice(6), 'base64');
  const head = (b, id, t = nowS(), k = key) => ({ 'webhook-id': id, 'webhook-timestamp': String(t),
    'webhook-signature': 'v1,' + createHmac('sha256', k).update(id + '.' + t + '.' + b).digest('base64') });
  const b = payload('sw1');
  ok((await send(j.url, b, head(b, 'msg_1'))).status === 202, 'a request signed to the standard is accepted', true);
  const again = await send(j.url, b, head(b, 'msg_1'));
  ok(again.status === 200 && again.d.duplicate, 'its retry, same id, is one request', again.d);
  const swapped = head(b, 'msg_1'); swapped['webhook-id'] = 'msg_2';
  ok((await send(j.url, b, swapped)).d.code === 'bad_signature', 'the id is signed: a replay under a new id is refused', true);
  const multi = head(b, 'msg_3'); multi['webhook-signature'] = 'v1,' + Buffer.alloc(32).toString('base64') + ' ' + multi['webhook-signature'];
  ok((await send(j.url, b, multi)).status === 202, 'several signatures, one of them right, is accepted (how a sender rotates)', true);
  ok((await send(j.url, payload('sw2'), {})).d.code === 'signature_required', 'unsigned is refused', true);
  const list = await post('/auto/list', {});
  const raw = JSON.stringify(list.d);
  ok(!raw.includes(s.d.secret) && !raw.includes(s.d.secret.slice(6, 30)) && !/"sig"|"seen"|"hookIn"/.test(raw), 'the job list carries no secret, sealed or not, and no delivered material', raw.slice(0, 200));
  const it = (list.d.items || []).find(x => x.id === j.id);
  ok(it.hook && it.hook.signed === 'amv' && it.hook.n === undefined, 'only which scheme is on', it.hook);

  /* An edit from an older copy of the job list must not undo signing. */
  const stale = JSON.parse(store.get('auto:' + ME));
  const staleIt = stale.items.find(x => x.id === j.id); delete staleIt.hook.sig;
  const realGet = env.AMV_KV.get;
  let once = true;
  env.AMV_KV.get = async (k) => { if (k === 'auto:' + ME && once) { once = false; return JSON.stringify(stale); } return realGet.call(env.AMV_KV, k); };
  const e = await post('/auto/update', { id: j.id, action: 'pause' });
  env.AMV_KV.get = realGet;
  ok(e.status === 200 && job(j.id).hook.sig && job(j.id).hook.sig.kind === 'amv', 'pausing from an older copy leaves signing on', job(j.id).hook);
  ok(!JSON.stringify(e.d).includes('"sig"'), 'and its answer carries no secret either', true);
  await post('/auto/update', { id: j.id, action: 'resume' });

  /* Signing comes on between the request being checked and being kept: the
     check saw it off, so the lock must refuse rather than keep it unsigned. */
  const before = JSON.parse(store.get('auto:' + ME));
  delete before.items.find(x => x.id === j.id).hook.sig;
  let first = true;
  env.AMV_KV.get = async (k) => { if (k === 'auto:' + ME && first) { first = false; return JSON.stringify(before); } return realGet.call(env.AMV_KV, k); };
  const race = await send(j.url, payload('race'), {});
  env.AMV_KV.get = realGet;
  ok(race.status === 409 && race.d.code === 'signing_changed', 'a request checked while signing was off is not kept once it is on', race.d);

  const renew = await post('/auto/hook', { id: j.id, action: 'renew' });
  ok(renew.status === 200 && renew.d.signed === 'amv' && renew.d.url !== j.url, 'a new address keeps signing on', renew.d.signed);
  const b3 = payload('sw3');
  ok((await send(renew.d.url, b3, {})).d.code === 'signature_required', 'so the new address alone is still refused', true);
  const off = await post('/auto/hook', { id: j.id, action: 'unsign' });
  ok(off.status === 200 && off.d.signed === null, 'signing can be turned off', off.d);
  ok((await send(renew.d.url, b3, {})).status === 202, 'and then the address alone is accepted again', true);
}

section('Only the owner, and only a known scheme');
{
  const j = await make();
  ok((await sign(j.id, 'paypal')).d.code === 'bad_kind', 'an unknown scheme is refused', true);
  const r = await W.default.fetch(new Request('https://api.amv.test/auto/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: j.id, action: 'unsign' }) }), env, ctx);
  ok(r.status === 401, 'and nobody signed out can change it', r.status);
}

if (report('a-signed-request-proves-its-sender') > 0) process.exitCode = 1;
done();
