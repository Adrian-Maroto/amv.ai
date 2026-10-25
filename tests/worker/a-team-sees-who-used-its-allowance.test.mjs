/* A TEAM SEES WHO USED ITS ALLOWANCE - AND NOTHING ELSE.

   One subscription is one allowance, however many people share it. When it
   ran out, the owner could see the pool was empty and not who had emptied
   it. Now /team/usage gives an owner or admin each member's tokens and
   messages this calendar month and last, and which surfaces they went to.

   What must hold, checked against the real counter object:
     only an owner or admin can see it - a member asking is refused;
     it counts only what the TEAM paid for: a member on a better plan of their
       own uses their own allowance, and an admin must not see that;
     it is totals and surfaces - never a project, never what was asked;
     and erasing an account erases what the team counted for that person,
       even after they left the team. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'teamusage.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const PW = 'A-real-Passw0rd!';

const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":90,"output_tokens":0}}}\n\n'
  + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'
  + 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n'
  + 'data: {"type":"message_stop"}\n\n';
globalThis.fetch = async (url) => {
  if (!/model\.example/.test(String(url))) return new Response('{}', { status: 200 });
  return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const m = new Map(), objs = new Map();
const env = {
  AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example', JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  GLOBAL_DAILY_USD_CAP: '100000',
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
};
env.AMV_COUNTER = { idFromName: n => n, get: n => {
  if (!objs.has(n)) {
    const st = new Map();
    objs.set(n, { st, o: new W.AMVCounter({ storage: { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, structuredClone(v)); },
      async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, env) });
  }
  const { o } = objs.get(n);
  return { fetch: (u, init) => o.fetch(new Request('https://do/', init)) };
} };
const waits = [];
const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
const settle = async () => { await Promise.all(waits.splice(0)); };
let ip = 1;
const call = (path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.1.0.' + (ip++ % 200 + 1), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body) }), env, ctx);
async function account(email, plan) {
  const tok = (await (await call('/auth/signup', { email, name: email.split('@')[0], password: PW })).json()).token;
  if (plan !== 'free') await W.DB.put(env, 'ent', email, { plan, updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' });
  return tok;
}
const ask = async (tok, amv) => {
  const r = await call('/v1/messages', Object.assign({ model: 'amv-core', max_tokens: 200, messages: [{ role: 'user', content: 'hi' }] }, amv ? { amv } : {}), tok);
  await r.text(); await settle(); return r.status;
};
const usage = async (tok) => { const r = await call('/team/usage', {}, tok); return { status: r.status, d: await r.json() }; };

const owner = await account('owner-tu@example.com', 'elite');
const admin = await account('admin-tu@example.com', 'free');
const member = await account('member-tu@example.com', 'free');
const rich = await account('rich-tu@example.com', 'ultra');
await call('/team/create', { name: 'Acme' }, owner);
for (const [who, tok, role] of [['admin-tu@example.com', admin, 'admin'], ['member-tu@example.com', member, 'member'], ['rich-tu@example.com', rich, 'member']]) {
  const inv = await (await call('/team/invite', { email: who, role }, owner)).json();
  const j = await (await call('/team/join', { token: inv.inviteToken }, tok)).json();
  ok(j.ok, who + ' joins as ' + role, j);
}

section('Each member’s use of the team’s allowance');
{
  ok(await ask(member, { surface: 'chat', project: 'wsSecretPlan' }) === 200, 'the member is served');
  await ask(member, { surface: 'crew' });
  await ask(admin);
  await ask(rich);
  const { status, d } = await usage(owner);
  ok(status === 200 && Array.isArray(d.members) && d.members.length === 4, 'the owner sees every member', { status, n: d.members && d.members.length });
  const by = Object.fromEntries((d.members || []).map(x => [x.email, x]));
  const mem = by['member-tu@example.com'] || {};
  ok(mem.tokens === 200 && mem.messages === 2 && mem.read === true, 'the member: two answers of 100 tokens', mem);
  ok(mem.surfaces && mem.surfaces.chat === 100 && mem.surfaces.crew === 100, 'split by where they went', mem.surfaces);
  ok(by['admin-tu@example.com'].tokens === 100, 'the admin: one', by['admin-tu@example.com']);
  ok(d.members[0].email === 'member-tu@example.com', 'heaviest first', d.members.map(x => x.email));
  ok(d.total === 300, 'and the team total is what the team paid for', d.total);
  ok(!JSON.stringify(d).includes('wsSecretPlan') && !JSON.stringify(d).includes('"hi"'), 'no project and nothing anybody asked', JSON.stringify(d).slice(0, 200));
}

section('A member on a better plan of their own uses their own allowance - and the team does not see it');
{
  const { d } = await usage(owner);
  const r = d.members.find(x => x.email === 'rich-tu@example.com');
  ok(r && r.tokens === 0 && r.messages === 0, 'their answer is not on the team’s page', r);
  const own = await (await call('/v1/usage', null, rich, 'GET')).json();
  ok(own.breakdown.current.tokens === 100, 'while their own Usage screen counts it', own.breakdown.current.tokens);
}

section('Only the people who pay can see it');
{
  ok((await usage(admin)).status === 200, 'an admin can');
  const r = await usage(member);
  ok(r.status === 403 && /owner and admins/.test(r.d.error), 'a member is refused, in a sentence', r);
  const out = await account('outsider-tu@example.com', 'pro');
  ok((await usage(out)).status === 404, 'and somebody on no team has nothing to see');
}

section('Erasing an account erases what the team counted - even after leaving');
{
  const left = await call('/team/leave', {}, member);
  ok(left.status === 200, 'the member leaves the team', left.status);
  const teamId = (await W.DB.get(env, 'ent', 'owner-tu@example.com') || {}).teamId || [...m.keys()].find(k => k.startsWith('team:'))?.slice(5);
  const name = [...objs.keys()].find(k => k.startsWith('tmuse:') && k.endsWith(':member-tu@example.com'));
  ok(name && objs.get(name).st.get('life'), 'their team record is there before', name);
  const del = await call('/auth/delete', { password: PW }, member);
  ok(del.status === 200, 'the account is deleted', del.status);
  ok(!objs.get(name).st.get('life'), 'and the team’s record of them is gone', name);
  void teamId;
}

report('a-team-sees-who-used-its-allowance');
done();
