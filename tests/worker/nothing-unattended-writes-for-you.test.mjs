/* NOTHING UNATTENDED WRITES ON YOUR BEHALF.

   A scheduled or event-started run reads - mail, calendar, school, bank, a
   repository - and reports back. Every change to a connected account is made
   from chat, with the person present to consent and the action protocol to
   read it back and offer an undo. The October 24 audit's worry is the step
   after that: an incoming email, a web page or a webhook telling an
   unattended run to act. That cannot happen while nothing unattended can
   write, so this holds that line where an account is actually opened, not
   only in the scheduler's list:

     an unattended request for anything but a read is refused, and recorded;
     the same request made with the person present is not refused for it;
     and the scheduler's own list still holds reads only. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'unattended.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { connUse, AUTO_USES_ALLOWED };\n');
const W = await import(harness + '?t=' + Date.now());

const audits = [];
const realLog = console.log;
console.log = (...a) => { const s = a.join(' '); if (/unattended_write_refused/.test(s)) audits.push(s); };
const kv = new Map();
const env = {
  AMV_KV: { async get(k) { return kv.get(k) ?? null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } },
  CONNECT_KEY: 'k'.repeat(64), JWT_SECRET: 'j'.repeat(40),
};

section('Unattended, anything but a read is refused at the door');
{
  for (const need of ['mail.send', 'calendar.write', ['mail.read', 'mail.send'], 'drive.write', 'post']) {
    const r = await W.connUse(env, 'a@example.com', need, 'job-1', { attended: false });
    ok(r.ok === false && r.code === 'unattended_write', JSON.stringify(need) + ' is refused as an unattended write', r);
  }
  const noOpts = await W.connUse(env, 'a@example.com', 'mail.send', 'job-1');
  ok(noOpts.code === 'unattended_write', 'and a caller that says nothing is treated as unattended', noOpts);
  ok(audits.length >= 6, 'each refusal is recorded', audits.length);
}

section('Reads unattended, and anything attended, are not refused for it');
{
  const read = await W.connUse(env, 'a@example.com', 'mail.read', 'job-1', { attended: false });
  ok(read.code !== 'unattended_write', 'an unattended read goes on to the ordinary checks', read.code);
  const present = await W.connUse(env, 'a@example.com', 'mail.send', 'action:send', { attended: true });
  ok(present.code !== 'unattended_write', 'and a write with the person present is not refused for being a write', present.code);
}

section('The scheduler asks for reads only');
{
  ok(W.AUTO_USES_ALLOWED.length > 0 && W.AUTO_USES_ALLOWED.every(n => /\.read$/.test(n)), 'every grant a scheduled job may use is a read', W.AUTO_USES_ALLOWED);
}

console.log = realLog;
if (report('nothing-unattended-writes-for-you') > 0) process.exitCode = 1;
done();
