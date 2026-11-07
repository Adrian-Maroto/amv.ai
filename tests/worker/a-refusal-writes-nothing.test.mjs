/* A REFUSAL WRITES NOTHING (Nov 3 audit SEC-015).

   The record helpers (_withRecord and everything built on it: _withKind,
   _withKV, _withTeam, _withAcct, and _withWallet) promised that a mutate
   returning { error, status, code } refuses without writing - and then saved
   the record anyway. A check that had already touched the record committed
   the touch. Every helper, both refusal shapes, and the ordinary path. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'refusal.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _withKind, _withKV, _withTeam, _withAcct, _withWallet };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const kv = new Map(); const claims = new Set();
const env = { AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); },
  async list({ prefix } = {}) { return { keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: n => ({ async fetch(_u, init) { const b = JSON.parse(init.body); const r = o => new Response(JSON.stringify(o));
    if (b.op === 'claim') { if (claims.has(n)) return r({ claimed: false }); claims.add(n); return r({ claimed: true }); }
    if (b.op === 'release' || b.op === 'clear') { claims.delete(n); return r({ ok: true }); }
    return r({ allowed: true, value: 0 }); } }) }) };

const cases = [
  ['_withKind', (m) => W._withKind(env, 'thing', 'x1', m, { n: 0 }), () => JSON.parse(kv.get('thing:x1') || '{"n":0}').n],
  ['_withKV', (m) => W._withKV(env, 'raw', 'x2', m, { n: 0 }), () => JSON.parse(kv.get('raw:x2') || '{"n":0}').n],
  ['_withTeam', (m) => W._withTeam(env, 'team_x', m), () => JSON.parse(kv.get('team:team_x')).n],
  ['_withAcct', (m) => W._withAcct(env, 'a@example.com', m), () => JSON.parse(kv.get('acct:a@example.com')).n],
  ['_withWallet', (m) => W._withWallet(env, 'a@example.com', m), () => +(JSON.parse(kv.get('wallet:a@example.com') || '{"balance":0}').balance)],
];
kv.set('team:team_x', JSON.stringify({ id: 'team_x', n: 0 }));
kv.set('acct:a@example.com', JSON.stringify({ email: 'a@example.com', n: 0 }));

for (const [name, run, read] of cases) {
  section(name);
  const bump = (r) => { if ('balance' in r) r.balance = (+r.balance || 0) + 5; else r.n = (r.n || 0) + 1; };
  const before = read();
  await run((r) => { bump(r); return { error: 'not allowed', status: 403 }; });
  ok(read() === before, 'a mutate that touched the record and then refused with { error, status } writes nothing', [before, read()]);
  await run((r) => { bump(r); return { error: 'gone', code: 'gone' }; });
  ok(read() === before, 'nor with { error, code }');
  await run((r) => { bump(r); return { commit: false }; });
  ok(read() === before, 'nor with { commit: false }');
  await run((r) => { bump(r); return { ok: true }; });
  ok(read() !== before, 'an ordinary result commits');
}

section('A writer whose lease ran out commits nothing (Nov 7 audit LOCK-001)');
{
  /* The mutate is slow enough for the 15-second lease to be gone - the clock
     is moved, not waited for. Another writer could already be inside. */
  const realNow = Date.now;
  for (const [name, run, read] of cases) {
    const before = read();
    let threw = null;
    try {
      await run((r) => { Date.now = () => realNow() + 13000; if (name === '_withWallet') r.balance = (+r.balance || 0) + 500; else r.n = (r.n || 0) + 500; });
    } catch (e) { threw = e; }
    Date.now = realNow;
    ok(threw && threw.code === 'record_busy' && read() === before, name + ': past its lease, it saves nothing and says busy - it does not overwrite whoever holds the lock now', { code: threw && threw.code, before, after: read() });
    claims.clear();
  }
}

console.log = quiet;
if (report('a-refusal-writes-nothing') > 0) process.exitCode = 1;
done();
