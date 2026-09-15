/* EVERY ADMIN ROUTE CALLED ITSELF A READ.

   `what` is passed into _adminGate and it does two jobs: it is the rate-limit
   bucket, `admin:<what>:<ip>`, and it is what a refusal is written down as.
   Fifteen routes passed 'read' - including the ones that reset somebody's
   password, lift an abuse flag, mark a payout settled, change a plan and kill
   a session.

   Two consequences, both real.

   THE RECORD COULD NOT NAME THE ACTION. A denied attempt to settle a payout
   was written as `{what:'read'}`, indistinguishable from somebody loading a
   dashboard. That is the line an operator would go looking for after money
   moved wrongly, and it said nothing.

   AND ONE COUNTER SERVED ALL FIFTEEN. Opening the founder dashboard spends the
   allowance on reads; the write needed next is refused for a reason that has
   nothing to do with it. The money routes starved by the screen showing the
   money.

   Checked by DRIVING the gate, not by reading the call sites: the assertion is
   that two different actions land in two different buckets and are audited
   under their own names. A relabel that left them sharing a counter would pass
   a source check and fail this. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'adminbucket.harness.mjs');
writeFileSync(harness, src + '\nexport { _adminGate, _adminRateLimit };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const audits = [];
const mkEnv = () => ({
  JWT_SECRET: 'x'.repeat(40),
  ADMIN_TOKEN: 'a'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  },
});
const req = (token) => new Request('https://amv.test/admin/x', {
  method: 'POST',
  headers: token ? { 'x-admin-token': token, 'cf-connecting-ip': '198.51.100.7' }
                 : { 'cf-connecting-ip': '198.51.100.7' },
});

section('The routes that write no longer call themselves reads');
{
  /* The call sites, read from the shipped Worker. This half can only say a
     line is present, which is why the behavioural half below exists too. */
  const gate = (fn) => {
    const i = src.indexOf('async function ' + fn + '(');
    if (i < 0) return null;
    const m = src.slice(i, i + 1400).match(/_adminGate\(request, env, '([^']+)'/);
    return m ? m[1] : null;
  };
  const writes = {
    errorsResolve: 'marks a bug fixed',
    abuseClear: 'lifts an abuse flag',
    authAdminReset: "resets somebody's password",
    adminPayoutMark: 'settles a payout',
    adminUser: 'changes a plan',
    adminKill: 'kills a session',
  };
  for (const [fn, does] of Object.entries(writes)) {
    const what = gate(fn);
    ok(what !== null, fn + ' goes through the admin gate', { fn, what });
    ok(what !== 'read', fn + ', which ' + does + ', is not audited as a read',
       { fn, what, does });
  }
  /* And the reads still say read - a relabel that renamed everything would
     make the distinction meaningless in the other direction. */
  for (const fn of ['errorsList', 'abuseList', 'adminPayouts', 'adminStats']) {
    ok(gate(fn) === 'read', fn + ' is still a read', { fn, what: gate(fn) });
  }
}

section('A refusal is written down under the name of what was attempted');
{
  /* audit() writes to the console, which is where a Worker's log ends up, so
     that is what is captured. The first draft of this looked in KV, found
     nothing, and passed on a branch that said "no audit sink configured" -
     a test that agreed with any implementation including none. */
  const env = mkEnv();
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try {
    await W._adminGate(req('wrong-token'), env, 'payout.mark', 60, 2000);
    await W._adminGate(req('wrong-token'), env, 'auth.reset', 60, 2000);
    await W._adminGate(req('wrong-token'), env, 'read', 60, 2000);
  } finally { console.log = realLog; }

  const denied = lines.filter(l => /admin_denied/.test(l));
  ok(denied.length >= 3, 'every refusal is written down', { count: denied.length });
  const whats = denied.map(l => (l.match(/"what":"([^"]+)"/) || [])[1]).filter(Boolean);
  ok(whats.includes('payout.mark'),
     'a denied payout settlement is recorded as payout.mark', whats);
  ok(whats.includes('auth.reset'),
     'a denied password reset is recorded as auth.reset', whats);
  ok(whats.includes('read'),
     'and a denied read is still recorded as a read', whats);
  ok(new Set(whats).size === whats.length,
     'three different actions produced three different names', whats);
}

section('Two actions do not share one counter');
{
  store.clear();
  const env = mkEnv();
  const token = 'a'.repeat(40);
  /* Spend the read allowance right down. Each call is a real trip through the
     limiter, so what is being measured is the counter, not a label. */
  let readRefusedAt = 0;
  for (let i = 1; i <= 70; i++) {
    const r = await W._adminGate(req(token), env, 'read', 60, 2000);
    if (r && r.status === 429) { readRefusedAt = i; break; }
  }
  ok(readRefusedAt > 0, 'the read bucket does run out', { readRefusedAt });

  /* Now the write. If it shared the bucket it is already refused. */
  const afterwards = await W._adminGate(req(token), env, 'payout.mark', 60, 2000);
  ok(!afterwards || afterwards.status !== 429,
     'a payout write is not refused because the dashboard was read',
     { status: afterwards ? afterwards.status : 'allowed' });

  /* And the write bucket is its own, so exhausting it does not lock reads. */
  let writeRefusedAt = 0;
  for (let i = 1; i <= 70; i++) {
    const r = await W._adminGate(req(token), env, 'abuse.clear', 60, 2000);
    if (r && r.status === 429) { writeRefusedAt = i; break; }
  }
  ok(writeRefusedAt > 0, 'the write bucket enforces its own limit', { writeRefusedAt });
  const other = await W._adminGate(req(token), env, 'auth.reset', 60, 2000);
  ok(!other || other.status !== 429,
     'and a different write still has its own allowance',
     { status: other ? other.status : 'allowed' });
}

report();
done();
