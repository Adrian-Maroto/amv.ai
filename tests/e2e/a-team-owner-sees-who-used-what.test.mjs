/* A TEAM OWNER SEES WHO USED WHAT.

   Driven through the real page, the real Worker and the real counter object:
   an owner makes a team on the page and invites a member; the member uses
   the team's allowance from their own sign-in; the owner opens Team and
   reads, under "Usage this month", that member with their tokens,
   their messages and where they went - and no project, nothing asked. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { AMVCounter } = await import(join(ROOT, 'amv-backend.js') + '?ctr=' + Date.now());

const ev = (t, d) => 'event: ' + t + '\ndata: ' + JSON.stringify(d) + '\n\n';
const reply = () => ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 95, output_tokens: 0 } } })
  + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
  + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
  + ev('message_stop', { type: 'message_stop' });
const outbound = makeOutbound();
outbound.on(/model\.example/, () => new Response(reply(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const objs = new Map();
const env = makeEnv({ APP_URL: 'http://localhost:9247', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example' });
env.AMV_COUNTER = { idFromName: n => n, get: n => {
  if (!objs.has(n)) {
    const st = new Map();
    objs.set(n, new AMVCounter({ storage: { async get(k) { return st.get(k); }, async put(k, v) { st.set(k, structuredClone(v)); },
      async delete(k) { st.delete(k); }, async deleteAll() { st.clear(); }, async setAlarm() {}, async deleteAlarm() {} } }, env));
  }
  const o = objs.get(n);
  return { fetch: (u, init) => o.fetch(new Request('https://do/', init)) };
} };
const L = await bootLive({ env, outbound, port: 9247 });
const { page } = L;
const OWNER = 'boss@example.com', MEMBER = 'dana@example.com';

/* The member, from their own sign-in - not the page's. */
const direct = async (path, body, tok) => {
  const waits = [];
  const r = await L.worker.fetch(new Request('https://api.amv.test' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.4.4.' + Math.ceil(Math.random() * 200), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: JSON.stringify(body) }), env, { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} });
  const t = await r.text(); await Promise.all(waits);
  try { return JSON.parse(t); } catch (e) { return { status: r.status }; }
};

section('An owner makes a team and a member uses it');
{
  await page.evaluate(async (em) => {
    openAuth('signup'); await __amvAuthOpen();
    const type = (s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Boss'); type('#a-email', em); type('#a-pass', 'A-real-Passw0rd!');
    document.getElementById('auth-submit').click(); await __amvSignedIn();
  }, OWNER);
  await env.AMV_KV.put('ent:' + OWNER, JSON.stringify({ plan: 'elite', updatedAt: Date.now(), renewedAt: Date.now(), source: 'stripe' }));
  const inv = await page.evaluate(async (m) => { await syncEntitlement().catch(() => {}); await AMVTeam.create('Acme'); return AMVTeam.invite(m, 'member'); }, MEMBER);
  const mtok = (await direct('/auth/signup', { email: MEMBER, name: 'Dana Reyes', password: 'A-real-Passw0rd!' })).token;
  const j = await direct('/team/join', { token: inv.inviteToken }, mtok);
  ok(j.ok, 'the member joins', j);
  await direct('/v1/messages', { model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'draft the board memo' }], amv: { surface: 'chat', project: 'wsBoardMemo' } }, mtok);
  await direct('/v1/messages', { model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'plan' }], amv: { surface: 'crew' } }, mtok);
  await direct('/v1/messages', { model: 'amv-core', max_tokens: 64, messages: [{ role: 'user', content: 'plan' }], amv: { surface: 'crew' } }, mtok);
}

section('The owner opens Team and reads who used what');
{
  await page.evaluate(() => setTab('team'));
  await page.waitForFunction(() => /dana@example\.com/.test((document.getElementById('team-usage') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const t = await page.evaluate(() => (document.getElementById('team-usage') || {}).innerText || '');
  const head = await page.evaluate(() => { const h = document.getElementById('team-usage'); return h ? h.parentElement.querySelector('h3').textContent : ''; });
  ok(head === 'Usage this month', 'there is a Usage this month section', head);
  ok(/dana@example\.com/.test(t) && /boss@example\.com/.test(t), 'every member, by address as on the Members list', t.slice(0, 200));
  ok(t.indexOf('dana@') < t.indexOf('boss@'), 'heaviest first', t.slice(0, 200));
  ok(/300 tokens · 3 messages/.test(t), 'with their tokens and messages', t.slice(0, 300));
  ok(/Crew 67%/.test(t) && /Chat 33%/.test(t), 'and where they went', t.slice(0, 300));
  ok(/Team total\s*\n?\s*300 tokens/.test(t), 'under a team total', t.slice(0, 120));
  ok(!/wsBoardMemo|board memo/.test(t), 'no project and nothing that was asked');
}

section('A member’s own Team page has no such section');
{
  const html = await page.evaluate(() => {
    const vc = document.createElement('div');
    const team = Object.assign({}, AMVTeam._cache, { members: (AMVTeam._cache.members || []).map(m => Object.assign({}, m, { role: m.email === 'boss@example.com' ? 'member' : 'owner' })) });
    try { _renderTeamManageNow(vc, team); } catch (e) { return 'ERR ' + e.message; }
    return vc.innerHTML;
  });
  ok(!/team-usage/.test(html) && !/Usage this month/.test(html), 'as a member, the page does not ask for it', /team-usage/.test(html));
}

ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 3));
await L.close();
if (report('a-team-owner-sees-who-used-what') > 0) process.exitCode = 1;
done();
