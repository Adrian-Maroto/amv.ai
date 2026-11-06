/* BACKGROUND WORK IS HELD BY ITS OWN REQUEST (Nov 3 audit SEC-008).

   _bg keeps a background promise alive with waitUntil. It used the most
   recent request's context from a shared variable, so with requests
   overlapping in one isolate a mirror write could be held by a request that
   had already finished, and dropped with it. Now each request, cron tick and
   queue batch runs in its own async-local context, and _bg uses that one. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ownctx.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { _bg, _withCtx };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };
await new Promise(r => setTimeout(r, 20));   // the runtime's async-local storage is loaded on first use

const mkCtx = (name) => ({ name, held: [], waitUntil(p) { this.held.push(p); }, passThroughOnException() {} });
const env = { AMV_KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } } };

section('Overlapping requests: each one’s background work is held by itself');
{
  const A = mkCtx('A'), B = mkCtx('B');
  let release;
  const gate = new Promise(r => { release = r; });
  /* A starts, and is part way through when B arrives. */
  const a = W._withCtx(A, async () => { await gate; W._bg(Promise.resolve('A’s mirror write')); });
  await W.default.fetch(new Request('https://api.amv.test/v1/health'), env, B);   // B becomes "the most recent"
  release(); await a;
  ok(A.held.length === 1 && !B.held.some(p => p && p.__fromA), 'A’s background work is held by A, not by whichever request came last', { A: A.held.length });
  const B2 = mkCtx('B2');
  await W._withCtx(B2, async () => { W._bg(Promise.resolve(1)); });
  ok(B2.held.length === 1, 'and B’s by B');
}

console.log = quiet;
if (report('background-work-is-held-by-its-own-request') > 0) process.exitCode = 1;
done();
