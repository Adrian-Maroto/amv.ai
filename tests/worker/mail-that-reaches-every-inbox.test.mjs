/* MAIL THAT REACHES EVERY INBOX, NOT ONLY ONE.

   Asked for: "it works for my Google email only - make sure it works for all
   mail platforms".

   A domain the provider has verified is accepted, and Gmail takes it. Outlook,
   Hotmail and Yahoo also look for SPF, DKIM and a DMARC policy on the sending
   domain and file mail without them as junk. The provider's verification adds
   the first two; DMARC is the one left out. So the owner's test email reads all
   three from public DNS and names what is missing, and can be sent to any
   address so each inbox can be tried. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'everyinbox.harness.mjs');
writeFileSync(harness, src + '\n');
const W = await import(harness + '?t=' + Date.now());

/* Public DNS as the test says it is: name -> TXT strings, or 'down'. */
let dns = {};
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url && url.url ? url.url : url);
  if (/api\.resend\.com/.test(u)) { sent.push(JSON.parse(String(opts.body || '{}'))); return new Response('{"id":"x"}', { status: 200 }); }
  if (/cloudflare-dns\.com/.test(u)) {
    if (dns === 'down') throw new TypeError('fetch failed');
    const name = new URL(u).searchParams.get('name');
    const txt = dns[name] || [];
    return new Response(JSON.stringify({ Status: 0, Answer: txt.map(t => ({ name, type: 16, data: '"' + t + '"' })) }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'admin-token-for-tests', APP_URL: 'https://amv.test', OWNER_EMAIL: 'owner@gmail.com',
    EMAIL_API_KEY: 'k', RESET_EMAIL_FROM: 'AMV <hello@amv.homes>',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const test = async (env, body) => {
  const r = await W.default.fetch(new Request('https://api.amv.test/admin/email-test', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token-for-tests', 'CF-Connecting-IP': '9.9.9.' + (ip++) },
    body: JSON.stringify(body || {}) }), env, ctx);
  return r.json();
};
const RESEND = { 'resend._domainkey.amv.homes': ['p=MIGfMA0GCSqGSIb3DQEB'], 'send.amv.homes': ['v=spf1 include:amazonses.com ~all'] };

section('The test goes to any address typed, not only the owner’s');
{
  dns = { ...RESEND };
  const d = await test(mkEnv(), { to: 'someone@outlook.com' });
  ok(d.ok && d.to === 'someone@outlook.com' && JSON.stringify(sent.at(-1).to) === '["someone@outlook.com"]', 'an Outlook address can be tried', d.to);
  const d2 = await test(mkEnv(), {});
  ok(d2.to === 'owner@gmail.com', 'and with none typed it goes to the owner', d2.to);
}

section('A domain the provider verified, without DMARC, is named as Outlook’s problem');
{
  dns = { ...RESEND };
  const d = await test(mkEnv(), { to: 'x@yahoo.com' });
  ok(d.inboxes && d.inboxes.spf === true && d.inboxes.dkim === true && d.inboxes.dmarc === false, 'SPF and DKIM found, DMARC missing', d.inboxes);
  ok(d.fixes.some(f => /_dmarc/.test(f) && /v=DMARC1; p=none;/.test(f)), 'and the exact record to add is given', d.fixes);
}

section('All three in place: nothing to fix');
{
  dns = { ...RESEND, '_dmarc.amv.homes': ['v=DMARC1; p=none;'] };
  const d = await test(mkEnv(), { to: 'x@icloud.com' });
  ok(d.inboxes.dmarc === true && d.fixes.length === 0, 'every record found, no fixes', d);
}

section('DNS that cannot be asked is never reported as missing');
{
  dns = 'down';
  const d = await test(mkEnv(), { to: 'x@hotmail.com' });
  ok(d.ok && d.inboxes && d.inboxes.dmarc === null && d.fixes.length === 0, 'unknown, not missing - and the send still went', d);
}

globalThis.fetch = realFetch;
if (report('mail-that-reaches-every-inbox') > 0) process.exitCode = 1;
done();
