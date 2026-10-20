/* REQUIRE A SIGNED REQUEST TO START A JOB - ON THE SCREEN.

   The Worker suite proves the signatures. This proves the door to them, in a
   real browser against the real Worker: on a job another service starts,
   "Require signing" asks who sends the requests, a secret AMV makes is shown
   once, and the row then says the job is signed. And the secret shown is the
   real one - a request signed with what the screen showed is accepted, the
   address alone is refused - so the dialog cannot be showing a secret that
   is not the one in force.

   Then Stripe's own secret is pasted (a wrong shape is refused where it is
   typed), signing is turned off again, and the dialog fits a phone. */
import { createHmac } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootLive, makeEnv, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* The Worker's own data layer, to set the plan where the server reads it. */
mkdirSync(join(ROOT, 'tests/e2e/.build'), { recursive: true });
const harness = join(ROOT, 'tests/e2e/.build', 'signedhook.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const env = makeEnv({ CONNECT_KEY: 'k'.repeat(44) });
const L = await bootLive({ env });
const { page } = L;

const EMAIL = 'signer@example.com';
await page.evaluate(async ([em, pw]) => {
  openAuth('signup');
  await __amvAuthOpen();
  const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  type('#a-name', 'Signer'); type('#a-email', em); type('#a-pass', pw);
  document.getElementById('auth-submit').click();
  await __amvSignedIn();
}, [EMAIL, 'a quiet lake at dawn']);
await W.DB.put(env, 'ent', EMAIL, { plan: 'pro', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
/* Asked of the server, so a check that sign-up started cannot land after
   this and put the page back on the free plan. */
await page.evaluate(async () => { await syncEntitlement(); });
ok(await page.evaluate(() => loadStr('amv_plan')) === 'pro', 'the account is on a plan that runs jobs', true);

const made = await page.evaluate(async () => {
  const d = await _autoApi('/auto/create', { detail: 'Summarise the new order.', repeat: '10min', approval: 'auto', when: { source: 'hook' } });
  await _loadCrewData(); await _autoRefresh(); setTab('crew'); renderCrewView();
  return { url: d.hookUrl, id: d.item && d.item.id };
});
const until = async (fn, arg, ms = 8000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
const send = async (body, headers = {}) => {
  const r = await L.worker.fetch(new Request(made.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.' + Math.floor(Math.random() * 200), ...headers }, body }),
    env, { waitUntil() {}, passThroughOnException() {} });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};
const btn = (id) => `[data-dact="mcHookSigning"][data-darg^="${id}|"]`;

section('A job another service starts offers signing');
{
  ok(made.url && made.url.startsWith(BACKEND + '/v1/hook/'), 'the job has an address', made.url);
  ok(await until((s) => !!document.querySelector(s), btn(made.id)), 'its row has the button', true);
  const label = await page.$eval(btn(made.id), b => b.textContent);
  ok(/Require signing/.test(label), 'which says signing is not on yet', label);
}

let secret = '';
section('AMV makes a GitHub secret, shows it once, and it is the one in force');
{
  await page.click(btn(made.id));
  ok(await until(() => /address alone/.test((document.querySelector('#hs-bg') || {}).textContent || '')), 'the dialog says only the address guards it now', true);
  await page.click('[data-hs="github"]');
  ok(await page.$('#hs-secret') !== null, 'GitHub offers a box for a secret of one’s own', true);
  await page.click('#hs-save');
  ok(await until(() => !!document.querySelector('#hs-form .sec-secret code')), 'the secret is shown', true);
  secret = await page.$eval('#hs-form .sec-secret code', e => e.textContent);
  ok(/^[0-9a-f]{64}$/.test(secret), 'a long random secret', secret.length);
  ok(/shown once/.test(await page.$eval('#hs-form', e => e.textContent)), 'with where to put it, and that it is shown once', true);
  const b = JSON.stringify({ action: 'opened', number: 7 });
  const good = await send(b, { 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(b).digest('hex') });
  ok(good.status === 202, 'a request signed with what the screen showed is accepted', good);
  const bare = await send(JSON.stringify({ action: 'opened', number: 8 }));
  ok(bare.status === 401 && bare.d.code === 'signature_required', 'and the address alone is now refused', bare.d);
  await page.evaluate(() => closeOvr());
  ok(await until((s) => /Signed · GitHub/.test((document.querySelector(s) || {}).textContent || ''), btn(made.id)), 'the row now says it is signed, and by whom', true);
  const html = await page.evaluate(() => JSON.stringify(_AUTOS));
  ok(!html.includes(secret), 'and the page keeps no copy of the secret', true);
}

section('Stripe’s secret is pasted; a wrong one is refused where it was typed');
{
  await page.click(btn(made.id));
  await until(() => !!document.querySelector('[data-hs="stripe"]'));
  ok(/signed by GitHub/.test(await page.$eval('#hs-bg', e => e.textContent)), 'the dialog says what is on now', true);
  await page.click('[data-hs="stripe"]');
  await page.fill('#hs-secret', 'sk_live_not_a_signing_secret');
  await page.click('#hs-save');
  ok(await until(() => /whsec_/.test((document.getElementById('hs-msg') || {}).textContent || '')), 'the wrong shape is caught, and says what the right one looks like', true);
  const key = 'whsec_' + 'Qp7'.repeat(10);
  await page.fill('#hs-secret', key);
  await page.click('#hs-save');
  ok(await until(() => !document.getElementById('hs-bg')), 'the right one closes the dialog: there is nothing to show back', true);
  const b = JSON.stringify({ type: 'invoice.paid', id: 'evt_1' }); const t = Math.floor(Date.now() / 1000);
  const r = await send(b, { 'Stripe-Signature': 't=' + t + ',v1=' + createHmac('sha256', key).update(t + '.' + b).digest('hex') });
  ok(r.status === 202, 'and a request Stripe signed is accepted', r);
}

section('Turned off, the address alone works again');
{
  await until((s) => /Stripe/.test((document.querySelector(s) || {}).textContent || ''), btn(made.id));
  await page.click(btn(made.id));
  await until(() => !!document.querySelector('[data-hs=""]'));
  await page.click('[data-hs=""]');
  ok(await until(() => !document.getElementById('hs-bg')), 'signing goes off', true);
  ok((await send(JSON.stringify({ n: 9 }))).status === 202, 'and an unsigned request is accepted', true);
}

section('At phone width, the dialog fits');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await until((s) => /Require signing/.test((document.querySelector(s) || {}).textContent || ''), btn(made.id));
  await page.evaluate((s) => document.querySelector(s).click(), btn(made.id));
  await until(() => !!document.querySelector('[data-hs="amv"]'));
  await page.click('[data-hs="amv"]');
  await until(() => !!document.getElementById('hs-save'));
  const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1,
    small: [...document.querySelectorAll('#hs-bg button')].filter(b => b.id !== 'hs-x' && __under(b.getBoundingClientRect().height, 44)).length }));
  ok(!m.over && m.small === 0, 'nothing runs off the side, and every choice is a full-size target', m);
}

ok(L.errors.length === 0, 'no page errors', L.errors);
await L.close();
if (report('require-a-signed-request-to-start-a-job') > 0) process.exitCode = 1;
done();
