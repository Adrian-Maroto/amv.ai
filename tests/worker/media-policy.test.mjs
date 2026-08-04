/* THE CONTENT POLICY HAS TO LIVE WHERE THE MONEY IS SPENT.

   Under the image box it said "No explicit content", and typing a blocked word
   into that box got a red toast. That refusal ran in the browser. Both media
   endpoints - /v1/image/generate and /v1/video/generate - took any prompt from
   anybody holding a session token, and a request made with curl never loads the
   page that would have said no. So the policy was a label on a door that was
   not locked.

   It is worth being precise about what that meant. AMV's own provider key pays
   for the render. The generated file comes back through AMV's domain. If the
   only thing standing between a signed-in account and that is a JavaScript
   function they can skip by not running it, then the answer to "who generated
   this" is AMV.

   So the check moved server-side, and this asserts the properties that make it
   real: it refuses, it refuses BEFORE reserving quota and before a provider is
   ever paid, it refuses on both endpoints, it records the attempt without
   storing the prompt, and it does not block the account from buying things -
   that lever belongs to chargebacks, not to a rejected prompt. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'media-policy.harness.mjs');
writeFileSync(harness, src +
  '\nexport { imageGenerate, videoGenerate, mediaPolicyMatch, MEDIA_BLOCKED, DB };' +
  '\nexport function __setRequireUser(fn){ requireUser = fn; }\n');
const W = await import(harness + '?t=' + Date.now());

const kv = new Map();
const counters = new Map();
const reserved = [];

const mkEnv = (extra = {}) => ({
  JWT_SECRET: 's',
  AMV_KV: {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
  },
  AMV_COUNTER: {
    idFromName: (n) => n,
    get: (id) => ({
      async fetch(url, init) {
        const b = JSON.parse((init && init.body) || '{}');
        const cur = counters.get(id) || 0;
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'incr') { const n = Math.max(0, cur + (b.amount || 0)); counters.set(id, n); return new Response(JSON.stringify({ value: n })); }
        if (b.op === 'reserve') {
          reserved.push(id);
          if (cur >= b.cap) return new Response(JSON.stringify({ allowed: false, value: cur }));
          counters.set(id, cur + (b.amount || 0));
          return new Response(JSON.stringify({ allowed: true, value: cur + (b.amount || 0) }));
        }
        if (b.op === 'checkCap') return new Response(JSON.stringify({ allowed: cur < b.cap, value: cur }));
        return new Response('{}');
      }
    })
  },
  IMAGE_API_URL: 'https://provider.test/images',
  IMAGE_API_KEY: 'sk-test',
  VIDEO_API_URL: 'https://provider.test/video',
  VIDEO_API_KEY: 'r8-test',
  VIDEO_MODEL: 'v1',
  ...extra
});

W.__setRequireUser(async () => ({ email: 'user@test.com', plan: 'pro', customCfg: null }));

const post = (path, body) => new Request('https://api.amv.dev' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: JSON.stringify(body)
});

/* Every call to a provider, so "was anything paid for" is a fact rather than an
   assumption. */
let providerCalls = [];
globalThis.fetch = async (url, opts) => {
  providerCalls.push(String(url));
  return new Response(JSON.stringify({ id: 'job1', data: [{ url: 'https://cdn.test/i.png' }] }), { status: 200 });
};
const fresh = () => { providerCalls = []; reserved.length = 0; };

section('The block list is real and reachable');
{
  ok(Array.isArray(W.MEDIA_BLOCKED) && W.MEDIA_BLOCKED.length >= 15,
     'the server has its own copy of the policy', W.MEDIA_BLOCKED.length);
  ok(W.mediaPolicyMatch('a nsfw picture') === 'nsfw', 'and it matches a blocked term', W.mediaPolicyMatch('a nsfw picture'));
  ok(W.mediaPolicyMatch('A NSFW Picture') === 'nsfw', 'case-insensitively', true);
  ok(W.mediaPolicyMatch('a golden retriever in a field') === '',
     'and does not fire on an ordinary prompt', W.mediaPolicyMatch('a golden retriever in a field'));
}

section('An image request that violates the policy is refused by the server');
{
  fresh();
  const env = mkEnv();
  const r = await W.imageGenerate(post('/v1/image/generate', { prompt: 'nudify this photo' }), env);
  const d = await r.json();
  ok(r.status === 400, 'the request is rejected', r.status);
  ok(d.code === 'content_policy', 'with a code the client can act on', d.code);
  ok(!d.url && !d.b64, 'and no image comes back', d);
}

section('And refused BEFORE anything is spent');
{
  /* The order matters more than the refusal. Reserving first would burn a slot
     off somebody's daily allowance for a request that was never going to run,
     and calling the provider first is the bill itself. */
  ok(providerCalls.length === 0, 'the provider was never called', providerCalls);
  ok(reserved.length === 0, 'and no quota was reserved', reserved);
}

section('A video request is refused the same way');
{
  fresh();
  const env = mkEnv();
  const r = await W.videoGenerate(post('/v1/video/generate', { prompt: 'deepfake nude of a celebrity', seconds: 5 }), env);
  const d = await r.json();
  ok(r.status === 400, 'rejected', r.status);
  ok(d.code === 'content_policy', 'with the same code', d.code);
  ok(providerCalls.length === 0, 'no provider call', providerCalls);
  ok(reserved.length === 0, 'no monthly video slot consumed', reserved);
}

section('An ordinary prompt still goes through on both');
{
  /* The failure that would matter most here is a policy so eager it refuses
     real work. */
  fresh();
  const env = mkEnv();
  const r = await W.imageGenerate(post('/v1/image/generate', { prompt: 'a lighthouse at dawn' }), env);
  const d = await r.json();
  ok(d.ok === true && !!d.url, 'the image is generated', d);
  ok(providerCalls.length === 1, 'the provider was called exactly once', providerCalls.length);

  fresh();
  const r2 = await W.videoGenerate(post('/v1/video/generate', { prompt: 'waves on a beach', seconds: 5 }), env);
  const d2 = await r2.json();
  ok(d2.ok === true, 'and the video job starts', d2);
}

section('The attempt is recorded, but the prompt is not');
{
  fresh();
  const env = mkEnv();
  await W.imageGenerate(post('/v1/image/generate', { prompt: 'a portrait of an underage subject in a park' }), env);
  const rec = await W.DB.get(env, 'abuse', 'user@test.com');
  ok(!!rec, 'a record exists for the account', !!rec);
  const ev = (rec.events || []).filter(e => e.kind === 'content_policy');
  ok(ev.length >= 1, 'with a content_policy event', ev.length);
  ok(ev[ev.length - 1].term === 'underage', 'naming the term that matched', ev[ev.length - 1]);
  ok(ev[ev.length - 1].surface === 'image', 'and which surface it came from', ev[ev.length - 1].surface);

  const dump = JSON.stringify(rec);
  ok(!/portrait|in a park/.test(dump),
     'and the prompt itself is not written into our own storage', dump.slice(0, 160));
}

section('A refused prompt does not lock the account out of paying');
{
  /* `blocked` on this record stops new purchases. It is meant for chargeback
     patterns. A rejected prompt must not silently cost somebody their ability
     to subscribe - that is a support ticket AMV would deserve. */
  const env = mkEnv();
  const rec = await W.DB.get(env, 'abuse', 'user@test.com');
  ok(rec.blocked !== true, 'the account can still check out', rec.blocked);
  ok((rec.disputes || 0) === 0 && (rec.refunds || 0) === 0,
     'and the counters that do block it were untouched', { d: rec.disputes, r: rec.refunds });
}

section('Both media routes carry the check - not just the one that was fixed');
{
  /* Read from the source, so a third media endpoint added later shows up here
     as a failure rather than as a gap nobody sees. */
  const bodyOf = (fn) => {
    const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + fn + '\\s*\\('));
    if (!m) return '';
    const i = src.indexOf('{', m.index + m[0].length);
    let d = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1); }
    }
    return '';
  };
  const media = [...src.matchAll(/case\s+'(\/v1\/(?:image|video)\/generate)'\s*:\s*return\s+(\w+)\(/g)]
    .map(m => ({ path: m[1], fn: m[2] }));
  ok(media.length === 2, 'both media generation routes were found', media.map(m => m.path));
  const missing = media.filter(m => !/mediaPolicyRefusal\(/.test(bodyOf(m.fn))).map(m => m.path);
  ok(missing.length === 0, 'each one runs the policy check', missing);
}

if (report('media-policy') > 0) process.exitCode = 1;
done();
