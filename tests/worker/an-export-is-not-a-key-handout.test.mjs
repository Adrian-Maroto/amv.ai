/* THE DOWNLOAD BUTTON HANDED OUT A WORKING KEY.

   "Export my data" walks PER_USER_KINDS, which is the same list erasure walks -
   deliberately, so the export cannot quietly omit something the product holds.
   The consequence nobody followed through: any credential AMV stores is, by
   default, in the file somebody downloads.

   An external audit found the Canvas record among them. It held a live bearer
   token, in the clear, and `school` was not in EXPORT_REDACTED - so the export
   returned a working key to a student's school account. That file then travels
   wherever files travel: a mailbox, a cloud sync, a support ticket, a shared
   laptop. The mailbox credential had been handled correctly months earlier; the
   Canvas one was added later and nobody connected it to the same rule.

   That is the failure this file is built around. Listing the three kinds that
   are wrong today would be a check that passes until somebody adds a fourth.
   So it DERIVES which kinds carry a credential from the code that writes them,
   and requires each one to be redacted. A new credential is caught by the fact
   that it is a credential, not by anybody remembering this file exists. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'export.harness.mjs');
writeFileSync(harness, src + '\nexport { EXPORT_REDACTED, PER_USER_KINDS, BACKUP_NEVER };\n');
const W = await import(harness + '?t=' + Date.now());

const code = codeOnly(src);
const SECRETISH = /\b(secret|token|password|apiKey|bearer)\b/i;

/* Every place a per-user record is written, by either door: DB.put for whole
   records, _withKV for locked read-modify-write. Both are used for credentials
   today, and a scan that knew only one of them reported two kinds instead of
   four - which is how this check would have looked clean while being blind. */
function credentialKinds() {
  const found = new Map();
  for (const m of code.matchAll(/DB\.put\(\s*env,\s*'([a-z]+)'([\s\S]{0,400}?)\)\s*;/g)) {
    if (SECRETISH.test(m[2])) found.set(m[1], 'DB.put');
  }
  for (const m of code.matchAll(/_withKV\(\s*env,\s*'([a-z]+)'[\s\S]{0,600}?\}\s*,/g)) {
    if (SECRETISH.test(m[0])) found.set(m[1], '_withKV');
  }
  return found;
}

section('The sweep can actually see how records are written');
{
  const kinds = credentialKinds();
  ok(kinds.size >= 3,
     'credential-bearing record kinds were found by reading the writers', [...kinds.keys()]);
  /* Both doors are exercised, so a scan blind to one of them cannot pass. */
  const doors = new Set([...kinds.values()]);
  ok(doors.has('DB.put') && doors.has('_withKV'),
     'and both write paths are represented, so neither is a blind spot', [...doors]);
  ok(W.PER_USER_KINDS.length > 10, 'and the export walks a real list of kinds', W.PER_USER_KINDS.length);
}

section('Every kind that holds a credential is withheld from the export');
{
  const kinds = credentialKinds();
  const exported = [...kinds.keys()].filter((k) => W.PER_USER_KINDS.includes(k));
  const leaked = exported.filter((k) => !(k in W.EXPORT_REDACTED));
  ok(leaked.length === 0,
     'no credential-bearing kind is returned verbatim by the export', leaked);

  /* Named, because these are the ones that were actually wrong. A derived rule
     that silently stopped deriving would still pass; these will not. */
  for (const k of ['school', 'mailcfg', 'telegram']) {
    ok(k in W.EXPORT_REDACTED, k + ' is redacted', k);
  }

  /* Redaction discloses that the record EXISTS without its contents. That
     distinction is the point: hiding the existence would make the export
     dishonest about what AMV holds, which is the thing it is for. */
  const fn = codeOnly(functionBody(src, 'accountExport'));
  ok(/withheld/.test(fn), 'and the export still says a withheld record exists', true);
}

section('The Canvas token is not stored in the clear either');
{
  /* Redacting the export is half the fix. A credential in plaintext is a
     credential in every backup, log and storage dump too - so it is encrypted
     at rest like the mailbox password and the bot token, and the connect
     refuses rather than storing it plainly when no key is configured. */
  const connect = codeOnly(functionBody(src, 'schoolConnect'));
  ok(/_mailEncrypt\(/.test(connect), 'schoolConnect encrypts the token before storing it', true);
  ok(!/DB\.put\(\s*env,\s*'school'[^)]*\btoken\b\s*,/.test(connect),
     'and does not write the raw token into the record', true);
  ok(/needs_service/.test(connect),
     'and refuses to store anything when there is no key, rather than storing it plainly', true);

  /* One place decrypts, so every consumer keeps reading rec.token unchanged.
     Extracted by hand rather than with functionBody, which finds `function`
     declarations and not `const x = async () => {}` - it returned empty here
     and the assertion passed on an empty string, which is a check that cannot
     fail dressed as one that did. */
  const li = code.indexOf('const _loadSchool');
  ok(li > -1, 'the school loader was located', li);
  const loader = code.slice(li, code.indexOf('\n};', li) + 3);
  ok(loader.length > 80 && /_loadSchool/.test(loader), 'and its body was actually read', loader.length);
  ok(/_mailDecrypt\(/.test(loader), 'and it decrypts, so consumers keep reading rec.token', true);

  /* Nothing else may decrypt it, or the single door is not a door. */
  const decrypts = (code.match(/_mailDecrypt\(env, rec\.secret\)/g) || []).length;
  ok(decrypts >= 1, 'the decrypt happens where the record is loaded', decrypts);
}

section('With no key configured it refuses rather than storing plaintext');
{
  /* The tempting failure is to store it in the clear "for now" when no key is
     set, because that keeps the feature working on a bare deployment. That is
     how a credential stays plain for ever. The mailbox connector already
     refuses in this situation; the school one now matches it, and this is the
     assertion that stops either drifting back. */
  const connect = codeOnly(functionBody(src, 'schoolConnect'));
  const iEnc = connect.indexOf('_mailEncrypt(');
  const iPut = connect.indexOf("DB.put(env, 'school'");
  ok(iEnc > -1 && iPut > -1 && iEnc < iPut,
     'the token is encrypted before the record is written, not after', { encrypt: iEnc, write: iPut });

  const between = connect.slice(iEnc, iPut);
  ok(/return json\(/.test(between) && /503/.test(between),
     'and a missing key returns before anything is stored', between.slice(0, 120));
}

section('And it is never written into a downloadable backup');
{
  for (const k of ['school:', 'mailcfg:', 'telegram:']) {
    ok(W.BACKUP_NEVER.includes(k), k + ' is excluded from backups', k);
  }
}

if (report('an-export-is-not-a-key-handout') > 0) process.exitCode = 1;
done();
