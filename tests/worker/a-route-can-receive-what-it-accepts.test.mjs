/* A ROUTE CAN RECEIVE WHAT ITS OWN HANDLER ACCEPTS.

   The router refuses a body over its bound before any handler runs, on the
   declared Content-Length. Its default is a megabyte, and three handlers
   that take a file had limits of their own far above it - so their limits
   could never be reached and their careful refusals were never read:

     /v1/library/put       kept files up to 30MB; anything over ~750KB failed
     /v1/audio/transcribe  listened to recordings up to 25MB; a minute of
                           audio was the most that ever arrived
     /deploy               published sites up to 2MB; a site over 1MB failed

   The same shape as /v1/messages, which refused every phone photo (LESSONS
   617, 618). Checked by sending requests that DECLARE each handler's own
   limit, as a browser does, and by comparing the two numbers directly. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'routereceives.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { _bodyMaxFor, BODY_MAX_BYTES, LIB_FILE_MAX, SPEECH_LISTEN_MAX_BYTES, SITE_MAX_BYTES, MAX_TOTAL_CHARS, MAX_BINARY_CHARS, MAX_SYSTEM_CHARS };\n');
const W = await import(harness + '?t=' + Date.now());

const env = {
  AMV_KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [], list_complete: true }; } },
  AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
  JWT_SECRET: 'j'.repeat(40), ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const declare = (path, n) => W.default.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': String(n), 'CF-Connecting-IP': '55.55.55.55' }, body: '{}' }), env, ctx);

const ROUTES = [
  ['/v1/library/put',      W.LIB_FILE_MAX + 4096,               'a file for the library at its own limit, in its JSON'],
  ['/v1/audio/transcribe', W.SPEECH_LISTEN_MAX_BYTES,           'a recording at its own limit'],
  ['/deploy',              W.SITE_MAX_BYTES + 4096,             'a site at its own limit, in its JSON'],
  ['/v1/messages',         W.MAX_TOTAL_CHARS + W.MAX_BINARY_CHARS + W.MAX_SYSTEM_CHARS, 'a conversation with its files at the message bounds'],
];

section('The router lets through what each handler accepts');
for (const [path, need, what] of ROUTES) {
  ok(W._bodyMaxFor(path) >= need, path + ': ' + what + ' fits under the router’s bound', { bound: W._bodyMaxFor(path), need });
}

section('And a request declaring that much reaches the handler');
for (const [path, need] of ROUTES) {
  const r = await declare(path, need);
  const d = await r.json().catch(() => ({}));
  ok(!(r.status === 413 && d.code === 'body_too_large'), path + ' is not refused by the router - the handler answers (here: not signed in)', { status: r.status, code: d.code });
}

section('Each is still a ceiling');
for (const [path] of ROUTES) {
  const r = await declare(path, W._bodyMaxFor(path) + 1);
  const d = await r.json().catch(() => ({}));
  ok(r.status === 413 && d.code === 'body_too_large', path + ' one byte past its bound is refused before reading', { status: r.status, code: d.code });
}

if (report('a-route-can-receive-what-it-accepts') > 0) process.exitCode = 1;
done();
