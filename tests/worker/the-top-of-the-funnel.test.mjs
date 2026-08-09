/* EVERYTHING AMV MEASURED STARTED AT SIGNUP.

   _funnelMark answers the whole journey from an account onwards: signed up,
   got value, came back, paid. It cannot see the largest group there is - the
   people who opened the page and left - so the one number that says whether
   any of the marketing works, visitors who become accounts, was not computable
   from anything AMV held. You could see that conversion from signup to paid
   was 4%, and nothing at all about the 96% who never signed up.

   The obvious fix was to serve an analytics endpoint to the browser and let
   `track()` beacon a record of every visitor to a third party, with the CSP
   widened to let it and somebody else's cookie policy becoming AMV's problem.
   For one number.

   So this is first-party and deliberately impoverished, and these cases are
   mostly about what it must NOT do. It increments a daily counter. If anything
   identifying ever appears in it - an id, an address, a referrer, a user agent
   - it stops being a count and becomes a record of a person, which needs a
   consent banner, a processor agreement, and a place in erasure. The whole
   design is that it cannot answer "who". */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'visit.harness.mjs');
writeFileSync(harness, src + '\nexport { recordVisit, _growthSeries, todayKey };\n');
const W = await import(harness + '?t=' + Date.now());

const counters = new Map();
function mkEnv() {
  const m = new Map();
  counters.clear();
  return {
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) {
        return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body);
        const c = (counters.get(n) || 0) + 1;
        counters.set(n, c);
        if (b.op === 'rateCheck') return new Response(JSON.stringify({ allowed: c <= (b.limit || 10) }));
        return new Response(JSON.stringify({ allowed: true, value: c }));
      } }),
    },
  };
}
const visit = (ip, headers) => W.recordVisit(new Request('https://api.amv.dev/v1/visit', {
  method: 'POST',
  headers: Object.assign({ 'CF-Connecting-IP': ip || '1.2.3.4' }, headers || {}),
}), mkEnvRef);

let mkEnvRef;

section('An arrival is counted');
{
  mkEnvRef = mkEnv();
  const r = await visit('1.1.1.1');
  const d = await r.json();
  ok(r.status === 200 && d.ok === true, 'the visit is accepted', d);
  ok(d.counted === true, 'and says it counted', d.counted);
  const key = [...mkEnvRef.AMV_KV._map.keys()].find(k => /^grow:visit:/.test(k));
  ok(!!key, 'a daily visit counter exists', key);
  ok(mkEnvRef.AMV_KV._map.get(key) === '1', 'holding one', mkEnvRef.AMV_KV._map.get(key));
}

section('It counts, and that is ALL it stores');
{
  /* The assertion the whole design exists for. A counter needs no consent
     banner, no processor agreement and no place in erasure. The moment
     anything identifying is stored beside it, all three become true and this
     stops being a number and starts being a record of a person. */
  mkEnvRef = mkEnv();
  await visit('203.0.113.9', {
    'User-Agent': 'Mozilla/5.0 SOMEBODYS-BROWSER',
    'Referer': 'https://somewhere-private.example/page',
    'Accept-Language': 'en-GB',
  });
  const stored = JSON.stringify([...mkEnvRef.AMV_KV._map.entries()]);
  ok(!/203\.0\.113\.9/.test(stored), 'the address is not stored', stored.slice(0, 200));
  ok(!/SOMEBODYS-BROWSER/.test(stored), 'nor the user agent', true);
  ok(!/somewhere-private/.test(stored), 'nor where they came from', true);
  ok(!/en-GB/.test(stored), 'nor anything else about them', true);

  /* Every value in it is a number. Nothing else can hide in a counter. */
  const values = [...mkEnvRef.AMV_KV._map.values()];
  ok(values.every(v => /^\d+$/.test(String(v))),
     'every value written is a plain count', values);
}

section('It needs no sign-in, because a visitor does not have one');
{
  /* The people this measures are, by definition, the ones with no account.
     Requiring auth would measure only the group already counted elsewhere. */
  const routeLine = src.slice(src.indexOf("case '/v1/visit'"), src.indexOf("case '/v1/visit'") + 120);
  ok(/recordVisit/.test(routeLine), 'the route is wired', routeLine.trim().slice(0, 60));
  const body = functionBody(src, 'recordVisit');
  ok(!/requireUser/.test(body), 'and does not ask who they are', true);
}

section('But it is bounded, because anyone can call it');
{
  mkEnvRef = mkEnv();
  let refused = 0;
  for (let i = 0; i < 30; i++) {
    const r = await visit('9.9.9.9');
    const d = await r.json();
    if (d.counted === false) refused++;
  }
  ok(refused > 0, 'a flood from one address stops being counted', refused);
}

section('A refused visit is not an error the visitor ever sees');
{
  /* This runs on somebody's first page load. A metric that can return a
     failure - or worse, throw - is a metric that can break the first
     impression of the product it is measuring. */
  mkEnvRef = mkEnv();
  for (let i = 0; i < 30; i++) {
    const r = await visit('8.8.8.8');
    if (r.status !== 200) { ok(false, 'every response is a 200', r.status); break; }
  }
  ok(true, 'even when it declines to count, it answers 200', true);
}

section('The owner can see visitors and the rate that matters');
{
  const stats = src.slice(src.indexOf('growth: { signupsToday'), src.indexOf('growth: { signupsToday') + 900);
  ok(/visits7/.test(stats) && /visits30/.test(stats),
     'the visit series reaches the owner dashboard', true);
  ok(/visitToSignupPct/.test(stats),
     'along with visitors-to-accounts, which is the point of collecting it', true);
  /* Null rather than 0 before anything has been counted: "no visitors
     recorded" and "nobody converted" are different facts, and showing 0% for
     the first is a lie about the product. */
  ok(/visits7 > 0 \? .* : null/.test(stats.replace(/\n/g, ' ')),
     'and it is null, not 0%, before there is anything to divide', true);
}

section('The browser counts one arrival per visit, not per render');
{
  const client = readFileSync(join(ROOT, 'src', 'app', '12-handoff.js'), 'utf8');
  const fn = functionBody(client, '_countVisit');
  ok(/sessionStorage/.test(fn),
     'one per session, so a funnel means arrivals and not redraws', true);
  ok(!/localStorage/.test(fn),
     'and not localStorage, or a returning visitor tomorrow is never counted again', true);
  ok(/catch\(\)?\s*=?>?\s*\{?\s*\}?\)?;?/.test(fn) || /\.catch\(/.test(fn),
     'a failure is silence, because a metric must not break the page', true);
  ok(/keepalive/.test(fn),
     'and it survives somebody leaving at once, which is the visit most worth counting', true);
}

if (report('the-top-of-the-funnel') > 0) process.exitCode = 1;
done();
