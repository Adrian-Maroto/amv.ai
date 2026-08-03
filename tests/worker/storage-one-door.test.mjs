/* WHATEVER WRITES A RECORD MUST BE WHAT DELETES IT.

   The worker stores through a small abstraction: DB.get/put/del use D1 when the
   deployment has it and fall back to KV when it does not. Some code reached
   past that and deleted the KV key directly.

   On a KV-only deployment those look identical, which is why it survived. On a
   deployment with D1 - the configuration the product is meant to grow into -
   the direct delete removed a KV key that was never written and left the D1 row
   in place. The record did not go away.

   Two did this, and the worse one was deployDelete: serveSite READS through DB,
   so "take this site down" deleted nothing and the page carried on serving,
   publicly, after its owner removed it. Publishing is one of the actions AMV
   asks explicit permission for, and undoing it has to actually undo it.

   The rule is mechanical, so it is checked mechanically: if a kind is ever
   written or read through DB, it may not be deleted straight from KV. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* Every record kind that goes through the abstraction. */
const managed = new Set([
  ...[...src.matchAll(/DB\.put\(env,\s*'([a-z_]+)'/g)].map(m => m[1]),
  ...[...src.matchAll(/DB\.(?:get|del)\(env,\s*'([a-z_]+)'/g)].map(m => m[1]),
]);
/* Every prefix deleted straight from KV. */
const directDeletes = [...src.matchAll(/env\.AMV_KV\.delete\(`?'?([a-z_]+):/g)].map(m => m[1]);

section('Both sides were found');
{
  ok(managed.size > 20, 'the DB-managed record kinds were parsed', managed.size);
  /* Direct KV deletes are legitimate for KV-only kinds, so this should never be
     empty - if it is, the pattern has drifted and the rule below tests nothing. */
  ok(directDeletes.length > 5, 'and the direct KV deletes', directDeletes.length);
}

section('Nothing is written through DB and deleted around it');
{
  const mismatched = [...new Set(directDeletes.filter(k => managed.has(k)))].sort();
  ok(mismatched.length === 0,
     'every DB-managed record is deleted through DB, so it goes away on D1 too', mismatched);
}

section('Taking a site down uses the same door that serves it');
{
  const fn = (name) => {
    const at = src.indexOf('async function ' + name);
    if(at < 0) return '';
    const rest = src.slice(at + 1);
    const ends = [rest.indexOf('\nasync function '), rest.indexOf('\nfunction ')].filter(x => x >= 0);
    return ends.length ? src.slice(at, at + 1 + Math.min(...ends)) : src.slice(at);
  };
  const del = fn('deployDelete'), serve = fn('serveSite');
  ok(/DB\.del\(env, 'site'/.test(del), 'deployDelete removes it through DB', true);
  ok(!/AMV_KV\.delete\('site:/.test(del), 'and not around it', true);
  ok(/DB\.get\(env, 'site'/.test(serve),
     'while serveSite reads through DB - the two must agree or a deleted page keeps serving', true);
  /* Ownership is still what decides, so nobody can unpublish somebody else. */
  ok(/rec\.owner !== owner/.test(del), 'and only its owner can take it down', true);
}

if (report('storage-one-door') > 0) process.exitCode = 1;
done();
