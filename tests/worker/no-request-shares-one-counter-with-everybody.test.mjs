/* NO REQUEST SHARES ONE COUNTER WITH EVERYBODY (scale: hot keys).

   A Durable Object is one object in one place. A counter named per account,
   per key or per shard spreads across as many objects as there are accounts;
   a counter with a constant name - or one that changes only with the date -
   is ONE object that every caller in the world reaches. At a million users,
   whatever path touches it touches it a million times, and a single object
   overloaded slows or refuses everything else that object answers.

   So every counter whose name has no per-account, per-key or per-shard part
   is listed here with the reason it is rare enough to be one object. A new
   one fails until somebody has written that reason - or sharded it, the way
   the day's spend became sixteen shares and the month's figures one call per
   shard. Read from amv-backend.js with comments stripped. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const RARE = {
  'noness:${day}': 'the non-essential write budget; a refusal is remembered by each server for a minute, so a spent budget is not asked again (telemetry-must-not-starve-the-product)',
  'seatcount:team': 'changes only when a team seat is bought or given up',
  'funnelttpsum': 'written once per account, at its first payment',
  'funnelttpn': 'written once per account, at its first payment',
};

function globalNames(text) {
  const re = /counter\(\s*env\s*,\s*('([^']*)'|`([^`]*)`)\s*[,)]/g;
  const out = new Set(); let m;
  while ((m = re.exec(text))) {
    const name = m[2] != null ? m[2] : m[3];
    const vars = name.match(/\$\{([^}]*)\}/g) || [];
    const perEntity = vars.some(v => !/todayKey\(\)|monthKey\(\)|\bday\b|Math\.floor\(Date\.now/.test(v));
    if (!perEntity) out.add(name);
  }
  return out;
}

section('Every counter one object for the whole deployment is listed, with why it is rare');
{
  const found = globalNames(src);
  const unlisted = [...found].filter(n => !RARE[n]);
  ok(found.size >= 3, 'the scan finds them', [...found]);
  ok(unlisted.length === 0, 'none is new and unexplained - shard it, or say here why it is rare', unlisted);
  const stale = Object.keys(RARE).filter(n => !found.has(n));
  ok(stale.length === 0, 'and no reason is left for one that is gone', stale);
}

section('The scan notices');
{
  const add = src + "\nasync function x(env){ await counter(env, 'chatsToday:' + todayKey(), { op: 'incr' }); await counter(env, `perUser:${email}`, {}); await counter(env, `everyone:${monthKey()}`, {}); }";
  const f = globalNames(add);
  ok(f.has('everyone:${monthKey()}'), 'a counter that changes only with the month is one object');
  ok(!f.has('perUser:${email}'), 'one named per account is not');
}

report();
done();
