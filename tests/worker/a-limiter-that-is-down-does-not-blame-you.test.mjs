/* A LIMITER THAT IS DOWN DOES NOT TELL SOMEBODY THEY WENT TOO FAST.

   limitAction reports three things: allowed, over the limit, and "the counter
   could not be reached". guardAction has always turned the third into a 503
   that says the fault is AMV's. Three routes that call limitAction directly did
   not: the Notify me waitlist, the website widget and the SMS code both said
   "too many" to somebody who had sent one request, because storage was down.
   That sends a person off to wait out a limit they never hit, and makes an
   outage look like their doing.

   Checked two ways: the waitlist is driven with the counter failing, and every
   direct limitAction caller that answers a person with a 429 must say what it
   does when the counter is unavailable first. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'limiterdown.harness.mjs');
writeFileSync(harness, src + '\nexport { waitlistAdd };\n');
const W = await import(harness + '?t=' + Date.now());

section('Notify me, with the counter down, says it is AMV’s fault');
{
  const store = new Map();
  const env = {
    JWT_SECRET: 'x'.repeat(40),
    AMV_KV: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, String(v)); },
              async delete(k) { store.delete(k); }, async list() { return { keys: [], list_complete: true }; } },
    /* Bound and failing: the production shape of an outage. */
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { throw new Error('counter down'); } }) },
  };
  const r = await W.waitlistAdd(new Request('https://api.amv.test/waitlist', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
    body: JSON.stringify({ product: 'app-canva', email: 'a@example.com' }) }), env);
  const d = await r.json().catch(() => ({}));
  ok(r.status === 503 && d.code === 'limit_unavailable', 'a 503 that names the outage, not a 429', { status: r.status, d });
  ok(!/too many|too fast|slow down/i.test(d.error || ''), 'and nothing tells them to slow down', d.error);
  ok(![...store.keys()].some(k => k.startsWith('waitlist:')), 'and nothing was recorded past a limit that could not be checked', [...store.keys()]);
}

section('Every direct caller that answers a person handles the outage first');
{
  const lines = src.split('\n');
  const offenders = [];
  lines.forEach((l, i) => {
    const m = l.match(/const (\w+) = await limitAction\(/);
    if (!m) return;
    const v = m[1];
    const win = lines.slice(i, i + 14).join('\n');
    /* Only callers that turn a refusal into a message for a person - a 429 or a
       "too many". A silent telemetry throttle answers nobody. */
    const speaks = new RegExp('if \\(!' + v + '\\.ok[^)]*\\)[\\s\\S]{0,400}?(429|[Tt]oo many|slow down)').test(win);
    if (!speaks) return;
    const firstRefusal = win.search(new RegExp('if \\(!' + v + '\\.ok'));
    const handled = win.slice(0, firstRefusal + 200).match(new RegExp(v + '\\.unavailable'));
    /* Two let a request through when the counter is down, on purpose: Google
       sign-in (refusing would lock everybody out) and the operator's own
       console. Named by their limiter keys - code, not the comments that
       explain them. */
    const deliberate = /limitAction\(env, 'googlesig:'|limitAction\(env, `admin:/.test(l);
    if (!handled && !deliberate) offenders.push((i + 1) + ': ' + l.trim().slice(0, 90));
  });
  ok(offenders.length === 0, 'each says what it does when the counter is down', offenders);
}

if (report('a-limiter-that-is-down-does-not-blame-you') > 0) process.exitCode = 1;
done();
