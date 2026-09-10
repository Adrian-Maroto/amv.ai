/* A PERMISSION GATE POINTED AT A STORE NOTHING WRITES IS A GATE THAT IS SHUT.

   `_autoConnected` answered "is Google connected?" from `goauth:` - the record
   `googleOAuthExchange` used to write. That route was DELETED when Connected
   accounts replaced it, on purpose: an endpoint that hands a provider token to
   a page is one somebody finds a use for. Nothing has written `goauth:` since.

   So `connected.google` was false for every account in existence, and
   `_autoNeedsFor` refuses any job whose text mentions Gmail, Drive, Docs,
   Calendar or a meeting unless it is true. Every calendar job and every mailbox
   job in the catalogue told people to connect an account they had already
   connected - while the READER, which goes through `connUse` and the `conn:`
   record, could have read it perfectly. The two halves disagreed about whether
   the person had permission, and the half that says no always wins.

   This is the same shape as the quiet-hours defect and the two approval
   builders: one fact, two places, and nobody comparing them. What makes it
   worse is the direction. A wrong "no" from a permission check does not look
   like a bug - it looks like the product working, and the person goes off to
   reconnect an account that was already connected. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'gaterec.harness.mjs');
writeFileSync(harness, src + `
export { _autoConnected, _autoNeedsFor, CONN_KV, CONN_PROVIDERS };
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const store = new Map();
const env = { AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
const connect = (scopes, provider) => {
  store.clear();
  store.set('conn:' + ME, JSON.stringify({ c1: {
    provider: provider || 'google', unattended: true, scopes, sealed: 'x' } }));
};
const needs = (detail, conn) => W._autoNeedsFor({ id: 'j', detail }, conn, []);

section('The record the gate reads is the record the reader uses');
{
  /* Stated as a property rather than a value, because the failure was that
     these were two different stores and nobody had said they must not be. */
  connect(['mail.read', 'calendar.read', 'school.read']);
  const c = await W._autoConnected(env, ME);
  ok(c.google === true, 'a Google connection is seen as one', c);
  ok(c.mail === true, 'and its Gmail grant satisfies a mailbox job', c);
  ok(c.school === true, 'and its Classroom grant satisfies a school job', c);
}

section('The jobs that were refused now run');
{
  connect(['mail.read', 'calendar.read', 'school.read']);
  const c = await W._autoConnected(env, ME);
  for(const detail of [
    'Summarise my inbox each morning',
    'Plan my week from my calendar',
    'Check my Gmail for bills',
    'Tell me what is due in my classes',
  ]){
    const n = needs(detail, c);
    ok(n.ready === true, JSON.stringify(detail) + ' is not refused', n.missing);
  }
}

section('A connection that does NOT cover something is still refused');
{
  /* The fix must not become "connected at all means allowed everything" -
     that would trade a wrong no for a wrong yes, and a wrong yes fails in the
     middle of a run instead of before it. */
  connect(['calendar.read']);
  const c = await W._autoConnected(env, ME);
  ok(c.mail === false, 'a calendar-only grant is not a mailbox', c);
  ok(c.school === false, 'nor a school one', c);
  ok(needs('Summarise my inbox each morning', c).ready === false,
     'so an inbox job still says what it needs', needs('Summarise my inbox each morning', c).missing);
  ok(needs('Plan my week from my calendar', c).ready === true,
     'while the calendar job it DOES cover runs', true);
}

section('No connection at all is still no');
{
  store.clear();
  const c = await W._autoConnected(env, ME);
  ok(c.google === false && c.mail === false && c.school === false,
     'an account that has connected nothing is told so', c);
  ok(needs('Summarise my inbox each morning', c).ready === false, 'and its jobs wait', true);
}

section('A mailbox connected the older way still counts');
{
  /* Somebody using an app password has a real connection, and it is not this
     function's business to decide theirs has stopped counting. */
  store.clear();
  store.set('mailcfg:' + ME, JSON.stringify({ secret: 'sealed' }));
  const c = await W._autoConnected(env, ME);
  ok(c.mail === true, 'the app-password mailbox is a mailbox', c);
  ok(needs('Summarise my inbox each morning', c).ready === true, 'and its inbox job runs', true);
}

section('The provider a scope comes from is not assumed');
{
  /* mail.read from some other provider is still a mailbox. Reading the scope
     rather than the provider name is what keeps that true when the next
     provider is added. */
  connect(['mail.read'], 'microsoft');
  const c = await W._autoConnected(env, ME);
  ok(c.mail === true, 'a non-Google mailbox is a mailbox', c);
  ok(c.google === false, 'and is not mistaken for a Google account', c);
}

section('Nothing in the code still asks the abandoned record on its own');
{
  /* The guard against this coming back. `goauth:` may be read - erasure still
     revokes anything left there - but it may not be the ONLY thing a
     capability answer depends on. */
  const fn = String(W._autoConnected);
  ok(/CONN_KV|'conn'/.test(fn),
     'the capability answer consults the connections record', fn.slice(0, 200));
  ok(/scopes/.test(fn), 'and the grants inside it', true);
}

if (report('a-gate-that-asks-a-record-nobody-writes') > 0) process.exitCode = 1;
done();
