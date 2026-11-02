/* Approve the translations of AMV's critical copy (Nov 1 audit OPS-009).

   Sign-in, money and privacy sentences are the ones where a wrong word costs
   somebody an account, a payment or their data. Each one's translation in
   every language is recorded here by a short fingerprint, so a translation
   that changes - by hand or by a regenerated pack - fails
   `tests/worker/critical-copy-is-approved-in-every-language` until somebody
   has read the new wording and run this again:

     node scripts/i18n-approve.mjs            approve the packs as they are now
     node scripts/i18n-approve.mjs --check    say what changed, write nothing */
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LANGS = ['es', 'zh', 'hi', 'ar', 'pt', 'fr', 'de', 'ja', 'ru', 'id', 'bn', 'ur', 'tr', 'vi', 'it', 'ko', 'ta'];
export const CRITICAL = /\b(password|passkey|passkeys|recovery codes?|authenticator|sign out everywhere|refund(ed|s)?|charged?|billing|payment|subscription|cancel (your|the) (plan|subscription)|delete (your|the|this) account|erase|privacy|personal data|withdraw(al)?|payout|card)\b/i;
export const FILE = join(ROOT, 'docs', 'i18n-critical.json');
export const fp = (t) => createHash('sha256').update(String(t)).digest('hex').slice(0, 12);

export function current(){
  const packs = Object.fromEntries(LANGS.map(l => [l, JSON.parse(readFileSync(join(ROOT, 'i18n', l + '.json'), 'utf8'))]));
  const keys = new Set();
  for (const l of LANGS) for (const k of Object.keys(packs[l])) if (CRITICAL.test(k)) keys.add(k);
  const out = {};
  for (const k of [...keys].sort()) out[k] = Object.fromEntries(LANGS.map(l => [l, packs[l][k] == null ? null : fp(packs[l][k])]));
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('i18n-approve.mjs')) {
  const now = current();
  if (process.argv.includes('--check')) {
    let was = {}; try { was = JSON.parse(readFileSync(FILE, 'utf8')).approved || {}; } catch (e) {}
    const changed = Object.keys(now).filter(k => JSON.stringify(now[k]) !== JSON.stringify(was[k]));
    console.log(changed.length ? 'Changed or new:\n' + changed.join('\n') : 'Nothing changed.');
  } else {
    writeFileSync(FILE, JSON.stringify({ _about: 'Fingerprints of the approved translation of every sign-in, money and privacy sentence, in every language. Regenerate with node scripts/i18n-approve.mjs after reading the new wording.', approved: now }, null, 1) + '\n');
    console.log('Approved ' + Object.keys(now).length + ' sentences in ' + LANGS.length + ' languages.');
  }
}
