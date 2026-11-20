/* A FAILED MONEY OR PERMISSION WRITE IS REPORTED, NOT SWALLOWED.

   Oct 26 audit #37. Seventeen writes that move money or permission sat in
   empty catches: a refund that did not land left somebody charged for
   nothing, a spend record that did not land let them pass a limit they set,
   a revocation that did not happen left old sessions open - and nothing said
   so. Now each one reports through _writeFailed, and the gate's "no money or
   permission write is swallowed silently" stage keeps it that way. Run
   against the Worker with storage that fails:
   - a refund that cannot be written is put in the audit record and the
     operator is told, once per hour;
   - the request around it is not broken by the bookkeeping.
   (A purchase's own booking is no longer one of these: since the Build 16
   audit it fails closed and stays pending - a-purchase-is-held-against-your-
   limits-first.) */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'writefailed.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _writeFailed };\n');
const W = await import(harness + '?t=' + Date.now());

const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: String((init && init.body) || '') }); return new Response('{}', { status: 200 }); };
const kv = new Map();
const env = { ALERT_WEBHOOK: 'https://hooks.example.com/alert', APP_URL: 'https://amv.test',
  AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { if (!/^alerted:/.test(k)) throw new Error('storage unavailable'); kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } },
  AMV_COUNTER: { idFromName: n => n, get: () => ({ async fetch() { throw new Error('counter unavailable'); } }) } };

section('A refund that cannot be written is reported, once, and does not throw');
{
  let threw = false;
  try { await W._writeFailed(env, 'widget_refund', new Error('storage unavailable')); } catch (e) { threw = true; }
  ok(!threw, 'the purchase around it is not broken by the bookkeeping', threw);
  ok(logs.some(l => /write_failed/.test(l) && /widget_refund/.test(l)), 'it is in the audit record, by where it happened', logs.filter(l => /write_failed/.test(l)));
  const ours = () => sent.filter(s => /hooks\.example\.com/.test(s.url) && /widget_refund/.test(s.body));
  ok(ours().length === 1, 'and the operator is told', sent.map(a => a.body.slice(0, 120)));
  await W._writeFailed(env, 'widget_refund', new Error('storage unavailable'));
  ok(ours().length === 1, 'once an hour, not once per failure', ours().length);
}

console.log = orig;
if (report('a-failed-money-write-is-reported') > 0) process.exitCode = 1;
done();
