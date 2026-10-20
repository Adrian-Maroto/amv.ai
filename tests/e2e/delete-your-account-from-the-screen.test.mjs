/* DELETE YOUR ACCOUNT FROM THE SCREEN - FOR REAL.

   The server refuses to erase an account on a session alone: it wants the
   password (or, with no password, the address typed) and, where one is on, the
   second step. The dialog sent an empty request and had nowhere to type any of
   it, so every connected account was told "Enter your password" in a toast and
   could not be deleted at all. The only check on the dialog read its source
   for the string '/auth/delete'.

   This deletes accounts through the real dialog against the real Worker, and
   then asks the server whether the account still exists:

     - a password account: the password is asked for, a wrong one is refused
       and nothing is deleted, the right one deletes it;
     - an account with an authenticator app: the password alone is not
       enough, a wrong code is refused, the app's code deletes it. */
import { createHmac } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootLive, makeEnv } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
mkdirSync(join(ROOT, 'tests/e2e/.build'), { recursive: true });
const harness = join(ROOT, 'tests/e2e/.build', 'delacct.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const env = makeEnv({ CONNECT_KEY: 'k'.repeat(44) });
const L = await bootLive({ env });
const PW = 'a quiet lake at dawn';
const exists = async (em) => !!(await W.DB.get(env, 'acct', em));

async function signUp(page, em){
  await page.evaluate(async ([em, pw]) => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Del'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await __amvSignedIn();
  }, [em, PW]);
}
const until = async (page, fn, ms = 8000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
async function openDelete(page){
  await page.evaluate(() => _confirmDeleteAccount());
  await page.fill('#del-confirm', 'DELETE');
}
const totp = (secret, ahead = 0) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const key = [];
  for (const ch of secret.replace(/\s/g, '')) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { key.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const step = Math.floor(Date.now() / 30000) + ahead;
  const msg = Buffer.alloc(8); msg.writeUInt32BE(Math.floor(step / 2 ** 32), 0); msg.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
};

section('A password account: asked for the password, and deleted with it');
{
  const { page } = L;
  const EM = 'leaving@example.com';
  await signUp(page, EM);
  ok(await exists(EM), 'the account exists', true);
  await openDelete(page);
  await page.click('#del-go');
  ok(await until(page, () => !!document.getElementById('del-pw')), 'the dialog asks for the password, where it can be typed', true);
  ok(await page.$eval('#del-msg', e => /password/i.test(e.textContent)), 'and says why', true);
  ok(await exists(EM), 'nothing is deleted yet', true);
  await page.fill('#del-pw', 'not my password at all');
  await page.click('#del-go');
  ok(await until(page, () => /not right/.test(document.getElementById('del-msg').textContent)), 'a wrong password is refused, and says so', true);
  ok(await exists(EM), 'and the account is still there', true);
  await page.fill('#del-pw', PW);
  const nav = page.waitForNavigation({ timeout: 10000 }).catch(() => null);
  await page.click('#del-go');
  await nav;
  ok(!(await exists(EM)), 'the right password deletes the account on the server', true);
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !(window.AMV_API && AMV_API.token)), 'and this browser is signed out', true);
}

section('With an authenticator app: the password alone is not enough');
{
  const { page } = await L.otherDevice();
  const EM = 'careful@example.com';
  await signUp(page, EM);
  const tok = await page.evaluate(() => AMV_API.token);
  const call = async (path, body) => (await L.worker.fetch(new Request('https://amv-e2e.workers.dev' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'CF-Connecting-IP': '5.5.5.5' }, body: JSON.stringify(body) }),
    env, { waitUntil() {}, passThroughOnException() {} })).json();
  const st = await call('/auth/totp/start', { proof: { password: PW } });
  const on = await call('/auth/totp/confirm', { code: totp(st.secret, 0) });
  ok(on.ok && on.recovery && on.recovery.length === 10, 'an authenticator app is turned on', on.error);
  await openDelete(page);
  await page.click('#del-go');
  await until(page, () => !!document.getElementById('del-pw'));
  await page.fill('#del-pw', PW);
  await page.click('#del-go');
  ok(await until(page, () => !!document.getElementById('del-code')), 'with the right password, it asks for the app’s code too', true);
  ok(await exists(EM), 'and nothing is deleted on the password alone', true);
  await page.fill('#del-code', '000000');
  await page.click('#del-go');
  ok(await until(page, () => /did not confirm/.test(document.getElementById('del-msg').textContent)), 'a wrong code is refused', true);
  ok(await exists(EM), 'and the account is still there', true);
  await page.fill('#del-code', totp(st.secret, 1));
  const nav = page.waitForNavigation({ timeout: 10000 }).catch(() => null);
  await page.click('#del-go');
  await nav;
  ok(!(await exists(EM)), 'the code from the app deletes it', true);
}

ok(L.errors.length === 0, 'no page errors', L.errors);
await L.close();
if (report('delete-your-account-from-the-screen') > 0) process.exitCode = 1;
done();
