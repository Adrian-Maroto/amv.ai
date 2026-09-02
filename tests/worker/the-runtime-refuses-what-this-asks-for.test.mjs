/* NOBODY COULD CREATE AN ACCOUNT, AND EVERY TEST WAS GREEN.

   PBKDF2_ITERATIONS was 210000, citing OWASP. The Workers runtime refuses any
   count above 100000:

     NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
     supported (requested 210000).

   So _hashPassword threw on every call. Every sign-up hashes a password, so
   sign-up was impossible for everybody from the first deployment - and the
   generic 500 is what the caller saw, because that is what the top-level catch
   is for.

   A second call had it too: _mailCredKey derived at 120000, which would have
   thrown the first time anybody stored a mailbox password. Same defect, a
   different route, waiting.

   THE PART THAT MATTERS FOR THIS FILE. The gate already runs the real Worker in
   workerd via smoke-real.mjs, and that suite performs a real sign-up and
   asserts a 200. It passed, every run, for the whole life of the project. So
   `wrangler dev --local` does NOT enforce this limit and the deployed runtime
   does - which means "we ran it in workerd" is not the same claim as "it works
   deployed", and a limit that only exists in production cannot be found by
   running it locally.

   What CAN be checked from here is the number itself, against the documented
   ceiling. That is what this file does. It is a cheap, exact check for a class
   of defect that costs a deployment to discover otherwise. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const code = codeOnly(src);

/* Documented limit of the Workers runtime, and the number the error names. */
const CAP = 100000;

section('No PBKDF2 call asks for more iterations than the runtime allows');
{
  /* EXPRESSIONS, NOT ONLY NUMBERS.

     The first version of this matched `iterations: <digits>` and counted them.
     Fixing the defect replaced the last bare number with a named constant, so
     the scan found nothing and the over-cap assertion passed by having nothing
     to test - green, and blind to the very thing it was written for. Caught
     because it also asserted it had found something, which is the only reason
     the emptiness was visible.

     So take whatever is written after `iterations:` and judge it: a number must
     be inside the cap, and a name must be one this file has already checked. A
     new call written with a fresh literal, or with some other variable, fails
     here rather than in production. */
  const exprs = [...code.matchAll(/iterations\s*:\s*([A-Za-z0-9_$.]+)/g)].map(m => m[1]);
  /* SHORTHAND COUNTS TOO, AND ONCE DID NOT.

     `{ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }` passes an iteration
     count without ever writing `iterations:`, so a scan for the colon form does
     not see it at all. That is not hypothetical - refactoring _mailCredKey to
     pick its count by version produced exactly that shape, and this check went
     green while no longer looking at the call it was written for. */
  const shorthand = [...code.matchAll(/[{,]\s*iterations\s*[,}]/g)].length;
  ok(exprs.length + shorthand > 0, 'there are PBKDF2 calls to check',
     { named: exprs.length, shorthand });

  const CHECKED = ['PBKDF2_MAX_ITERATIONS', 'PBKDF2_ITERATIONS', 'rounds'];
  const bad = exprs.filter((e) => {
    if (/^\d+$/.test(e)) return Number(e) > CAP;
    return !CHECKED.includes(e);
  });
  ok(bad.length === 0,
     `every named iteration count is a number at or under ${CAP}, or a constant checked below`,
     bad);

  /* Every shorthand use has to resolve to a local built from checked values. */
  const locals = [...code.matchAll(/const iterations\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  ok(locals.length === shorthand || shorthand === 0,
     'each shorthand iteration count comes from a local this file can read',
     { locals: locals.length, shorthand });
  const unresolved = locals.filter(v => /\b\d{6,}\b/.test(v)
    ? Number((v.match(/\b\d{6,}\b/) || [])[0]) > CAP
    : !/PBKDF2_MAX_ITERATIONS/.test(v));
  ok(unresolved.length === 0,
     'and each is built from the ceiling rather than a fresh number', unresolved);
}

section('The one count above the ceiling is a read-only legacy format');
{
  /* MAIL_CRED_V1_ITERATIONS is 120000, above what the runtime will run, and
     that is correct: the number is part of the v1 ciphertext format, and
     changing it does not migrate old data, it makes it permanently unreadable.
     On a deployed Worker there can be no v1 data - a Worker that could write it
     could never have run - so the branch is unreachable there and harmless.

     What must stay true is that it is only ever used to READ v1. If it were
     ever the default, every new credential would be written with a key the
     runtime cannot derive, which is the original bug again. */
  const m = /const MAIL_CRED_V1_ITERATIONS\s*=\s*(\d+)/.exec(code);
  ok(!!m, 'the legacy count is named rather than inline', m && m[1]);
  const uses = [...code.matchAll(/MAIL_CRED_V1_ITERATIONS/g)].length;
  ok(uses === 2, 'it is declared once and used once', uses);
  ok(/version === 1\s*\?\s*MAIL_CRED_V1_ITERATIONS\s*:/.test(code.replace(/\s+/g, ' ')),
     'and only on the branch that reads v1, never as the default');
}

section('And the constant every route derives from is within it too');
{
  const m = /const PBKDF2_ITERATIONS\s*=\s*(\d+)/.exec(code);
  ok(!!m, 'PBKDF2_ITERATIONS is declared', m && m[1]);
  const n = m ? Number(m[1]) : Infinity;
  ok(n <= CAP, `PBKDF2_ITERATIONS is at or under ${CAP}`, n);
  ok(n >= 50000,
     'and is still a real work factor rather than a token gesture', n);

  const cap = /const PBKDF2_MAX_ITERATIONS\s*=\s*(\d+)/.exec(code);
  ok(!!cap && Number(cap[1]) === CAP,
     'the ceiling is named rather than repeated as a bare number', cap && cap[1]);
}

section('A stored record cannot lock somebody out by naming a bigger number');
{
  /* Verification passes the count the account was hashed at. A record naming a
     count this runtime refuses would throw inside login - a 500 on a correct
     password, for a record AMV wrote. Clamped, so the worst case is a
     verification at the highest count the platform will run. */
  const i = code.indexOf('async function _hashPassword');
  const body = i > 0 ? code.slice(i, i + 1200) : '';
  ok(body.length > 0, 'the hashing function was found');
  ok(/Math\.min\([^)]*PBKDF2_MAX_ITERATIONS\)/.test(body.replace(/\s+/g, ' ')),
     'the requested count is clamped to the ceiling before it reaches the runtime');
  ok(!/iterations:\s*iterations\b/.test(body),
     'and the raw argument is not handed to deriveBits unchecked');
}

if (report() > 0) process.exitCode = 1;
done();
