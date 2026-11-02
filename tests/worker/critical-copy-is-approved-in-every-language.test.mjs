/* CRITICAL COPY IS APPROVED IN EVERY LANGUAGE (Nov 1 audit OPS-009).

   Sign-in, money and privacy sentences are where a wrong word costs somebody
   an account, a payment or their data. docs/i18n-critical.json holds a
   fingerprint of the approved translation of each one in every language
   (scripts/i18n-approve.mjs). This fails when:
     - a sentence of that kind is in the packs and was never approved;
     - one is missing, or empty, in any language;
     - a translation changed since it was approved - a regenerated pack or a
       hand edit has to be read before it ships. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { LANGS, CRITICAL, FILE, current } from '../../scripts/i18n-approve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const approved = JSON.parse(readFileSync(FILE, 'utf8')).approved;
const now = current();

section('The sentences that matter most were found');
{
  ok(Object.keys(now).length >= 80, 'sign-in, money and privacy sentences in the packs', Object.keys(now).length);
  for (const k of ['Manage your password and account security.']) ok(k in now, 'including "' + k + '"', k);
  ok(CRITICAL.test('Delete your account') && CRITICAL.test('Refunded') && !CRITICAL.test('Open a new chat'), 'and the rule that finds them reads as it should');
}

section('Each one is approved, present and unchanged in every language');
{
  const unapproved = Object.keys(now).filter(k => !approved[k]);
  ok(unapproved.length === 0, 'none is new and unapproved - run node scripts/i18n-approve.mjs after reading them', unapproved.slice(0, 10));
  const missing = Object.entries(now).filter(([, v]) => LANGS.some(l => !v[l])).map(([k, v]) => k + ' (' + LANGS.filter(l => !v[l]).join(',') + ')');
  ok(missing.length === 0, 'every one is translated into all ' + LANGS.length + ' languages', missing.slice(0, 10));
  const changed = [];
  for (const [k, v] of Object.entries(now)) if (approved[k]) for (const l of LANGS) if (approved[k][l] !== v[l]) changed.push(k + ' [' + l + ']');
  ok(changed.length === 0, 'and none has changed since it was approved', changed.slice(0, 10));
  const gone = Object.keys(approved).filter(k => !(k in now));
  ok(gone.length === 0, 'nothing approved has disappeared from the packs unnoticed', gone.slice(0, 10));
}

section('No pack ships a critical sentence in English');
{
  const english = [];
  for (const l of LANGS) {
    const pack = JSON.parse(readFileSync(join(ROOT, 'i18n', l + '.json'), 'utf8'));
    for (const k of Object.keys(now)) if (pack[k] === k && /[a-z]{4}/i.test(k) && k.split(' ').length > 2) english.push(l + ': ' + k);
  }
  ok(english.length === 0, 'a sentence of three words or more is never left as the English', english.slice(0, 10));
}

if (report('critical-copy-is-approved-in-every-language') > 0) process.exitCode = 1;
done();
