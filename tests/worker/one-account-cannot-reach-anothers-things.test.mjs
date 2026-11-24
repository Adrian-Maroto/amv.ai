/* ONE ACCOUNT CANNOT REACH ANOTHER'S THINGS (Build 18 plan FND-18).

   `every-route-decides` proves every route asks who is calling, and
   `cross-account-writes` lists every handler that writes outside the caller's
   own key. Neither SENDS a request as one person aimed at what another person
   owns - and that is the defect class (an id taken from the request and used
   without asking whose it is) that reading source cannot rule out.

   So this drives the real Worker with two real accounts. Alice makes things;
   Bob, holding a valid session of his own, aims every by-id route at Alice's
   ids - read, change, end, delete. Each must refuse or do nothing, and Alice's
   thing must still be hers, unchanged, afterwards. A domain this deployment
   has not configured (503) is reported as not measured rather than passed. */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const worker = (await import(join(ROOT, 'amv-backend.js') + '?authz-matrix=' + Date.now())).default;
const outbound = makeOutbound();
outbound.on(/resend|mail|sendgrid|postmark/i, () => ({ id: 'e1' }));
outbound.on(/\.ics(\?|$)|calendar/i, () => new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', { status: 200, headers: { 'Content-Type': 'text/calendar' } }));
const r2 = new Map();
const env = makeEnv({
  MAIL_CRED_KEY: 'Qx7-vast-entropy-here-9931-kkzp-4417',
  AMV_FILES: { async put(k, v) { r2.set(k, String(v)); return {}; }, async get(k) { return r2.has(k) ? { text: async () => r2.get(k) } : null; },
               async head(k) { return r2.has(k) ? { size: new TextEncoder().encode(r2.get(k)).length } : null; },
               async delete(k) { r2.delete(Array.isArray(k) ? k[0] : k); if (Array.isArray(k)) k.forEach(x => r2.delete(x)); }, async list() { return { objects: [] }; } },
});
const ctx = { waitUntil() {}, passThroughOnException() {} };

const call = async (method, path, body, token) => {
  const init = { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } };
  if (method !== 'GET' && body !== undefined) init.body = JSON.stringify(body);
  const r = await worker.fetch(new Request('https://api.test' + path, init), env, ctx);
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, body: json, text };
};
const signup = async (email, name) => {
  const s = await call('POST', '/auth/signup', { email, password: 'A-real-Passw0rd!' + name, name });
  return s.body.token;
};
/* A refusal is any 4xx, or a 200 that changed nothing (checked separately). */
const refused = (r) => r.status >= 400 && r.status < 500;

const alice = await signup('alice@example.com', 'Alice');
const bob = await signup('bob@example.com', 'Bob');
/* Both on a paid plan, so the routes that are part of one answer instead of
   refusing for the plan - a refusal for the plan would pass this check for
   the wrong reason. */
for (const e of ['alice@example.com', 'bob@example.com']) await env.AMV_KV.put('ent:' + e, JSON.stringify({ plan: 'ultra', status: 'active' }));
ok(!!alice && !!bob, 'two real accounts with sessions of their own');
const notMeasured = [];

section('A shared conversation');
{
  const c = await call('POST', '/v1/share/create', { title: 'Alice private plan', msgs: [{ r: 'u', c: 'my bank is X' }] }, alice);
  const id = c.body.id || (c.body.url && String(c.body.url).split('/').pop());
  if (c.status === 503 || !id) notMeasured.push('share (' + c.status + ')');
  else {
    const bl = await call('POST', '/v1/share/list', {}, bob);
    ok(!JSON.stringify(bl.body).includes(id), 'Bob\'s list does not contain Alice\'s link', bl.body);
    const logged = [];
    const realLog = console.log;
    console.log = (...a) => { logged.push(a.join(' ')); realLog(...a); };
    const br = await call('POST', '/v1/share/revoke', { id }, bob);
    console.log = realLog;
    ok(!logged.some(l => /"event":"share_revoked"/.test(l)) && logged.some(l => /share_revoke_refused/.test(l)),
       'and the audit log records a refused attempt, not a revocation', logged.filter(l => /share_/.test(l)));
    const al = await call('POST', '/v1/share/list', {}, alice);
    /* Live, not just listed: the list is Alice's own index, and it went on
       naming the link when a mutation let Bob delete the link itself. */
    const page = await call('GET', '/c/' + id);
    ok(JSON.stringify(al.body).includes(id) && page.status === 200 && page.text.includes('Alice private plan'),
       'Bob revoking Alice\'s link leaves it Alice\'s and live', { bob: br.status, page: page.status });
  }
}

section('An API key');
{
  const c = await call('POST', '/v1/keys/create', { name: 'alice-key' }, alice);
  const id = (c.body.item && c.body.item.id) || c.body.id;
  if (!id) notMeasured.push('keys (' + c.status + ' ' + (c.body.error || '') + ')');
  else {
    const bl = await call('POST', '/v1/keys/list', {}, bob);
    ok(!JSON.stringify(bl.body).includes(id), 'Bob cannot list Alice\'s key', bl.body);
    const br = await call('POST', '/v1/keys/revoke', { id }, bob);
    const al = await call('POST', '/v1/keys/list', {}, alice);
    const still = (al.body.keys || al.body.items || []).find(k => k.id === id);
    ok(!!still && !still.revoked, 'Bob revoking it leaves Alice\'s key working', { bob: br.status, key: still });
  }
}

section('An assistant');
{
  const c = await call('POST', '/v1/agents/save', { name: 'Alice helper', instructions: 'Private instructions', starters: [] }, alice);
  const id = c.body.id || (c.body.agent && c.body.agent.id);
  if (!id) notMeasured.push('agents (' + c.status + ' ' + (c.body.error || '') + ')');
  else {
    const bs = await call('POST', '/v1/agents/save', { id, name: 'Bob took it', instructions: 'Bob now', starters: [] }, bob);
    const bd = await call('POST', '/v1/agents/delete', { id }, bob);
    const al = await call('GET', '/v1/agents', undefined, alice);
    const mine = (al.body.agents || al.body.items || []).find(a => a.id === id);
    ok(!!mine && mine.name === 'Alice helper', 'Bob saving over or deleting Alice\'s assistant changes nothing of hers', { save: bs.status, del: bd.status, mine });
    const bl = await call('GET', '/v1/agents', undefined, bob);
    ok(!JSON.stringify(bl.body).includes('Private instructions'), 'and her instructions never reach Bob', bl.body);
  }
}

section('A signed-in session');
{
  const al = await call('GET', '/v1/sessions', undefined, alice);
  const list = al.body.sessions || al.body.items || [];
  const id = list.length ? list[0].id : '';
  if (!id) notMeasured.push('sessions (' + al.status + ')');
  else {
    const be = await call('POST', '/v1/sessions/end', { id }, bob);
    const still = await call('GET', '/v1/account/access', undefined, alice);
    const after = await call('GET', '/v1/sessions', undefined, alice);
    ok(((after.body.sessions || after.body.items || []).some(s => s.id === id)) && still.status !== 401,
       'Bob ending Alice\'s session leaves her signed in', { bob: be.status, alice: still.status });
  }
}

section('A calendar feed');
{
  const c = await call('POST', '/v1/cal/feeds/add', { url: 'https://example.org/alice.ics', label: 'Alice' }, alice);
  const list = async (t) => { const g = await call('GET', '/v1/cal/feeds', undefined, t); return g.status === 405 ? (await call('POST', '/v1/cal/feeds', {}, t)).body : g.body; };
  const f = c.body.feed;
  if (!f) notMeasured.push('calendar feeds (' + c.status + ' ' + JSON.stringify(c.body).slice(0, 160) + ')');
  else {
    const br = await call('POST', '/v1/cal/feeds/remove', { id: f.id }, bob);
    const after = await list(alice);
    ok((after.feeds || after.items || []).some(x => x.id === f.id), 'Bob removing Alice\'s calendar leaves it hers', { bob: br.status });
    const bl = await list(bob);
    ok(!JSON.stringify(bl).includes(f.id) && !JSON.stringify(bl).includes('alice.ics'), 'and her calendar never reaches Bob', bl);
  }
}

section('A purchase hold');
{
  await call('POST', '/v1/spend/set', { enabled: true, perPurchase: 200, monthlyCap: 1000, autoUnder: 100, currency: 'USD' }, alice);
  const c = await call('POST', '/v1/spend/hold', { amount: 12, currency: 'USD', store: 'shop.example.com', item: 'Alice item', key: 'alice-purchase-key-0001' }, alice);
  const hold = (c.body.hold && typeof c.body.hold === 'object') ? c.body.hold.id : (c.body.hold || c.body.id);
  if (!hold) notMeasured.push('purchase holds (' + c.status + ' ' + (c.body.error || '') + ')');
  else {
    const br = await call('POST', '/v1/spend/release', { hold }, bob);
    const bs = await call('POST', '/v1/spend/settle', { hold, total: 12, order: 'BOB-1', verified: true }, bob);
    ok(refused(br) && refused(bs), 'Bob can neither release nor settle Alice\'s hold', { release: br.status, settle: bs.status });
  }
}

section('A library file');
{
  const c = await call('POST', '/v1/library/put', { kind: 'text', name: 'alice-notes.txt', sig: 'sig1', body: 'Alice secret notes' }, alice);
  const id = c.body.id || (c.body.file && c.body.file.id);
  if (c.status === 503 || !id) notMeasured.push('library (' + c.status + ' ' + (c.body.error || '') + ')');
  else {
    const bg = await call('GET', '/v1/library/get?id=' + encodeURIComponent(id), undefined, bob);
    ok(!bg.text.includes('Alice secret notes'), 'Bob cannot read Alice\'s file by its id', bg.status);
    await call('POST', '/v1/library/delete', { ids: [id] }, bob);
    const ag = await call('GET', '/v1/library/get?id=' + encodeURIComponent(id), undefined, alice);
    ok(ag.text.includes('Alice secret notes'), 'and Bob deleting it leaves Alice\'s file', ag.status);
  }
}

section('What this run could not measure');
ok(true, notMeasured.length ? 'not configured or not reachable here: ' + notMeasured.join('; ') : 'every domain was measured');
console.log('  not measured:', notMeasured.join('; ') || 'none');

report();
done();
