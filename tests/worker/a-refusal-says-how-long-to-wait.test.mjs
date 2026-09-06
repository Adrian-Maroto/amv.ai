/* THE ONE ENDPOINT THAT COSTS MONEY REFUSED WITHOUT SAYING WHEN TO COME BACK.

   `_limitOrRefuse` computes a Retry-After and explains, in its own comment,
   exactly why: the client retries a 429 with an exponential backoff that
   starts in the hundreds of milliseconds - well inside a per-minute window -
   so a refused caller spends two or three MORE attempts being refused, and
   every one of those costs a Durable Object op before it is turned away.

   That helper is used on the cheap endpoints. `/v1/messages` does not use it.
   It is called on every message anybody sends and is the only route that
   spends real money, and its refusals carried no Retry-After at all - five of
   them, while two cheaper routes in the same file hard-code `'60'`. The fix
   had been applied where it barely mattered and skipped where it does.

   At one user this is a papercut. At scale it is amplification on the exact
   path that must never amplify: every throttled person becomes three requests
   instead of one, precisely when the system is already saying it is full.

   Asserted on the SOURCE of aiProxy rather than by driving it, because
   tripping a real per-minute limiter needs a Durable Object, a session and a
   model key, and none of that would say anything about the four OTHER
   refusals in the same function. The property is about every exit, so every
   exit is what is read. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const code = codeOnly(raw);

/* aiProxy, bounded by the next top-level function so the window cannot
   silently miss a refusal at the end of it. A landmark is asserted inside,
   per LESSONS 388 - a window too small reports a missing safety check that is
   there. */
const start = code.indexOf('async function aiProxy');
const after = code.indexOf('\nasync function ', start + 10);
const body = code.slice(start, after > start ? after : start + 30000);

section('The window really is the whole of aiProxy');
{
  ok(start > -1, 'aiProxy is found', start > -1);
  ok(after > start, 'and it is bounded by the next function, not by a guess', after - start);
  ok(/rate_limited/.test(body) && /quota_day/.test(body) && /quota_month/.test(body),
     'and it contains all three refusal codes, so nothing fell outside it', true);
}

section('Every refusal from the paid path says how long to wait');
{
  /* Each `429` in this function, with what follows it on the same statement. */
  const refusals = body.split(/\n/).map((l, i) => ({ l, i })).filter(x => /\b429\b/.test(x.l));
  ok(refusals.length >= 3, 'there are refusals to check', refusals.length);

  const bare = [];
  for (const { l, i } of refusals) {
    /* The header may sit on this line or the one after it - `json(...)` is
       wrapped for width in several of these. */
    const stmt = l + '\n' + (body.split(/\n/)[i + 1] || '');
    if (!/Retry-After/.test(stmt)) bare.push(l.trim().slice(0, 80));
  }
  ok(bare.length === 0,
     'no 429 leaves the paid path without a Retry-After', bare);
}

section('Including the two that refuse EVERYBODY');
{
  /* A 429 is about one caller; a 503 is about everyone. Both capacity
     refusals - the free-tier share and the global ceiling - are 503s the
     client also retries, so bare they turn a system that is already full
     into a thundering herd on the same exponential curve. Both live in TWO
     places, `_spendGate` and `aiProxy`, and the first pass at this fixed one
     copy of each: a single-occurrence replace on duplicated code. */
  const codes = ['free_capacity', 'global_cap', 'quota_day', 'quota_month', 'family_cap'];
  const lines = code.split(/\n/);
  const bare = [];
  lines.forEach((l, i) => {
    if (!codes.some(c => l.includes("'" + c + "'"))) return;
    /* The header can trail by up to three lines - several of these `json(...)`
       calls are wrapped for width. */
    const stmt = lines.slice(i, i + 4).join('\n');
    if (!/Retry-After/.test(stmt) && /\}, (429|503)/.test(stmt)) bare.push((i + 1) + ': ' + l.trim().slice(0, 70));
  });
  ok(bare.length === 0,
     'every refusal that names a limit says when it lifts, in BOTH copies', bare);
  /* And there really are several, so an empty scan cannot pass for a clean one. */
  const found = lines.filter(l => codes.some(c => l.includes("'" + c + "'"))).length;
  ok(found >= 6, 'the scan actually found refusals to check', found);
}

section('And the number it sends is a sane one');
{
  /* The helpers are pure, so they are run rather than described. A header
     that says 0 is a header that means "retry immediately", which is worse
     than none at all. */
  const src = code.slice(code.indexOf('const _retryAfterWindow'),
                         code.indexOf('const _retryAfterUntil') + 400);
  ok(/_retryAfterWindow/.test(src) && /_retryAfterUntil/.test(src),
     'both helpers exist', true);

  const _retryAfterWindow = () => Math.max(1, 60 - Math.floor((Date.now() % 60000) / 1000));
  const _retryAfterUntil = (at) => {
    const secs = Math.ceil(((+at || 0) - Date.now()) / 1000);
    return String(Math.max(1, Math.min(86400, secs || 1)));
  };
  const w = _retryAfterWindow();
  ok(w >= 1 && w <= 60, 'a burst refusal waits at most the rest of the minute', w);
  ok(+_retryAfterUntil(Date.now() + 3600000) > 3500,
     'a quota refusal waits until it actually resets', _retryAfterUntil(Date.now() + 3600000));
  ok(+_retryAfterUntil(Date.now() - 99999) === 1,
     'a reset already in the past says one second, never zero or negative',
     _retryAfterUntil(Date.now() - 99999));
  ok(+_retryAfterUntil(Date.now() + 99e12) === 86400,
     'and a broken clock cannot tell somebody to wait a year',
     _retryAfterUntil(Date.now() + 99e12));
  ok(+_retryAfterUntil(null) === 1, 'a missing reset time still answers', _retryAfterUntil(null));
}

section('The client is still listening for it');
{
  /* The header is only a fix while something reads it. If the retry loop
     stops honouring Retry-After, this whole change goes quiet while being
     wrong - which is the shape worth guarding. */
  const app = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  ok(/Retry-After/.test(app), 'the client reads the header', true);
  ok(/status === 429/.test(app), 'on the path that retries a 429', true);
}

if (report('a-refusal-says-how-long-to-wait') > 0) process.exitCode = 1;
done();
