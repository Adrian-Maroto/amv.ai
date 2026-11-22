/* A ROTATED CREDENTIAL KEY KEEPS EVERYBODY'S CONNECTIONS (Build 18 audit
   B18-029, Nov 22).

   MAIL_CRED_KEY seals every mailbox password, school token, Telegram token
   and calendar link AMV keeps. Replacing it - the remedy for a suspected
   leak - used to make all of them unreadable at once. With the old value in
   MAIL_CRED_KEY_PREVIOUS they are still read, and each is sealed again with
   the new key where it is used, so the old value can then be deleted. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'credrotate.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')
  + '\nexport { _mailEncrypt, _mailDecryptEx, _mailCfgFor, _loadSchool, DB };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; const audits = [];
console.log = (...a) => { const s = String(a[0]); if (s.startsWith('AUDIT')) { audits.push(s); return; } quiet(...a); };

const A = 'kq3V9xLm2Pz8Rt5Wn7Yb4Hc6Jd1Fg0Se2Ua9Io3', B = 'Zx8Cv2Bn6Mm4Lk1Jh9Gf3Ds7Ap5Qw0Er2Ty8Ui4';
const m = new Map();
const kv = { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
  async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
const env = (extra) => Object.assign({ AMV_KV: kv, JWT_SECRET: 'j'.repeat(48) }, extra);
const EM = 'ana@example.com';

section('Sealed with the old key, still read after the change, and sealed again with the new one');
{
  const old = env({ MAIL_CRED_KEY: A });
  await W.DB.put(old, 'mailcfg', EM, { address: EM, secret: await W._mailEncrypt(old, 'mailbox-password-1'), imap: { host: 'imap.example.com', port: 993 }, smtp: { host: 'smtp.example.com', port: 465 } });
  await W.DB.put(old, 'school', EM, { provider: 'x', secret: await W._mailEncrypt(old, 'school-token-1') });

  const lost = await W._mailCfgFor(env({ MAIL_CRED_KEY: B }), EM);
  ok(lost === null, 'with only the new key, the old seal does not open - that is what a rotation used to cost');

  const rotating = env({ MAIL_CRED_KEY: B, MAIL_CRED_KEY_PREVIOUS: A });
  const cfg = await W._mailCfgFor(rotating, EM);
  ok(cfg && cfg.password === 'mailbox-password-1', 'with the old value kept as PREVIOUS, the mailbox still opens', cfg && cfg.address);
  const school = await W._loadSchool(rotating, EM);
  ok(school && school.token === 'school-token-1', 'and so does the school token');

  const after = env({ MAIL_CRED_KEY: B });
  const cfg2 = await W._mailCfgFor(after, EM);
  const school2 = await W._loadSchool(after, EM);
  ok(cfg2 && cfg2.password === 'mailbox-password-1' && school2 && school2.token === 'school-token-1',
     'each was sealed again with the new key where it was used: the old value can now be deleted', [!!cfg2, !!school2]);
  const r = await W._mailDecryptEx(after, (await W.DB.get(after, 'mailcfg', EM)).secret);
  ok(r && r.stale === false, 'and what is stored now is current, not stale');
  ok(audits.some(a => /cred_resealed/.test(a)), 'the re-seal is in the audit log');
}

section('A weak or missing PREVIOUS opens nothing');
{
  const old = env({ MAIL_CRED_KEY: A });
  const sealed = await W._mailEncrypt(old, 'p');
  ok((await W._mailDecryptEx(env({ MAIL_CRED_KEY: B, MAIL_CRED_KEY_PREVIOUS: 'short' }), sealed)) === null, 'a previous value too weak to be a key is not tried');
  ok((await W._mailDecryptEx(env({ MAIL_CRED_KEY: B, MAIL_CRED_KEY_PREVIOUS: B }), sealed)) === null, 'and a wrong one opens nothing');
}

console.log = quiet;
if (report('a-rotated-credential-key-keeps-connections') > 0) process.exitCode = 1;
done();
