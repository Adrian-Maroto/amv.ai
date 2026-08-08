/* GIVING SOMEBODY ACCESS TO YOUR ACCOUNT, AND TAKING IT BACK.

   A link is one person reading another person's account - a parent and a
   teenager, somebody managing a relative's affairs. It is the only feature that
   deliberately crosses the boundary everything else in the product exists to
   defend, which makes both halves load-bearing: accepting has to be impossible
   for anybody but the owner, and revoking has to actually end it.

   The design is careful. The invitation is stored under the OWNER's key, so
   somebody who was never invited cannot even look it up. There is a code, it
   expires, and five wrong guesses block it. Revoking writes to both sides,
   because a link that is only inactive on one of them is still a link.

   None of it was tested, and this is the feature where "we think it works" is
   worth least: the failure is somebody reading a family member's account, and
   nobody discovers it by noticing an error.

   Also here: taking a published page down, and acting on a handoff. Both are
   destructive, both were untested, and one of them had already been found
   serving a page publicly after its owner deleted it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'links.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());

const OWNER = 'parent@example.com';
const GRANTEE = 'teen@example.com';
const STRANGER = 'nosy@example.com';
const PW = 'A-real-Passw0rd!';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

function mkEnv() {
  const m = new Map();
  return {
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit } = {}) {
        const keys = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        return { keys: limit ? keys.slice(0, limit) : keys, list_complete: true };
      },
    },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test',
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const req = (env, path, body, tok, method) => W.default.fetch(new Request('https://api.amv.test' + path, {
  method: method || 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '44.44.44.44',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body || {}),
}), env, ctx);
const jsonOf = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
const signup = async (env, email) =>
  (await jsonOf(await req(env, '/auth/signup', { email, name: 'X', password: PW }))).token;

/* An invitation waiting for the OWNER to approve, exactly as the invite route
   leaves one. */
async function invitation(env, { code = '123456', expiresAt = Date.now() + 15 * 60000, scopes = ['read'] } = {}) {
  const inv = { id: 'inv1', owner: OWNER, grantee: GRANTEE, scopes, code,
                createdAt: Date.now(), expiresAt, attempts: 0, status: 'pending' };
  await W.DB.put(env, 'link', OWNER + '|inv1', inv);
  return inv;
}
const linksOf = async (env, who) => ((await W.DB.get(env, 'links', who)) || { items: [] }).items;
const activeLink = async (env, who) => (await linksOf(env, who)).filter(l => l.active);

section('The owner accepts, and both sides can see the link');
{
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  await signup(env, GRANTEE);
  await invitation(env);

  const d = await jsonOf(await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner));
  ok(!d.error, 'the owner can accept it', d.error || 'ok');
  ok((await activeLink(env, OWNER)).length === 1, 'the owner holds an active link', (await activeLink(env, OWNER)).length);
  ok((await activeLink(env, GRANTEE)).length === 1, 'and so does the person they let in', (await activeLink(env, GRANTEE)).length);
}

section('Nobody else can accept it, including the person it is for');
{
  /* The invitation is stored under the owner's key precisely so that a lookup
     by anybody else finds nothing. The person being granted access must not be
     able to grant it to themselves. */
  const env = mkEnv();
  await signup(env, OWNER);
  const grantee = await signup(env, GRANTEE);
  const stranger = await signup(env, STRANGER);
  await invitation(env);

  /* Tried both ways: without naming the account, and NAMING IT. Only the
     second attempts the actual attack - a server that looked up the invitation
     by an owner from the request body would pass the first, because with no
     owner supplied it falls back to the caller and finds nothing. The same
     blind spot as sending an empty body to a route that reads "the caller's"
     record. */
  for (const [who, tok] of [['the grantee', grantee], ['a stranger', stranger]]) {
    for (const body of [{ id: 'inv1', code: '123456' },
                        { id: 'inv1', code: '123456', owner: OWNER },
                        { id: 'inv1', code: '123456', email: OWNER }]) {
      const d = await jsonOf(await req(env, '/v1/link/accept', body, tok));
      ok(!!d.error, who + ' cannot accept an invitation to somebody else’s account'
                        + (body.owner || body.email ? ' by naming it' : ''), d.error);
    }
  }
  ok((await linksOf(env, OWNER)).length === 0, 'and no link exists', (await linksOf(env, OWNER)).length);
}

section('A wrong code grants nothing, and guessing runs out');
{
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  await signup(env, GRANTEE);
  await invitation(env);

  for (let i = 0; i < 4; i++) await req(env, '/v1/link/accept', { id: 'inv1', code: '000000' }, owner);
  ok((await linksOf(env, OWNER)).length === 0, 'four wrong codes grant nothing', 0);

  const fifth = await jsonOf(await req(env, '/v1/link/accept', { id: 'inv1', code: '000000' }, owner));
  ok(/blocked/i.test(fifth.error || ''), 'and the fifth blocks the invitation', fifth.error);

  /* And the right code no longer works, because guessing has consumed it. */
  const right = await jsonOf(await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner));
  ok(!!right.error, 'the correct code is refused once it has been blocked', right.error);
  ok((await linksOf(env, OWNER)).length === 0, 'nothing was ever granted', 0);
}

section('An expired invitation is not an invitation');
{
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  await signup(env, GRANTEE);
  await invitation(env, { expiresAt: Date.now() - 1000 });

  const d = await jsonOf(await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner));
  ok(/expired/i.test(d.error || ''), 'it says so', d.error);
  ok((await linksOf(env, OWNER)).length === 0, 'and grants nothing', 0);
}

section('And it can only be used once');
{
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  await signup(env, GRANTEE);
  await invitation(env);

  await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner);
  const again = await jsonOf(await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner));
  ok(/already been used/i.test(again.error || ''), 'a second acceptance is refused', again.error);
  ok((await linksOf(env, OWNER)).length === 1, 'and there is still exactly one link', (await linksOf(env, OWNER)).length);
}

section('Revoking ends it on BOTH sides');
{
  /* A link marked inactive for the owner and still active for the grantee is
     still a link. Whichever record the access check happens to read is the one
     that decides, so both have to say the same thing. */
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  const grantee = await signup(env, GRANTEE);
  await invitation(env);
  await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner);

  const id = (await linksOf(env, OWNER))[0].id;
  const d = await jsonOf(await req(env, '/v1/link/revoke', { id }, owner));
  ok(!d.error, 'the owner revokes it', d.error || 'ok');
  ok((await activeLink(env, OWNER)).length === 0, 'it is inactive for the owner', 0);
  ok((await activeLink(env, GRANTEE)).length === 0, 'AND inactive for the person who had access', 0);
}

section('Either side can end it, and nobody else can');
{
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  const grantee = await signup(env, GRANTEE);
  const stranger = await signup(env, STRANGER);
  await invitation(env);
  await req(env, '/v1/link/accept', { id: 'inv1', code: '123456' }, owner);
  const id = (await linksOf(env, OWNER))[0].id;

  const nosy = await jsonOf(await req(env, '/v1/link/revoke', { id }, stranger));
  ok(!!nosy.error, 'a stranger cannot revoke somebody else’s link', nosy.error);
  ok((await activeLink(env, OWNER)).length === 1, 'and it is still live', 1);

  const byGrantee = await jsonOf(await req(env, '/v1/link/revoke', { id }, grantee));
  ok(!byGrantee.error, 'the person who was given access can hand it back', byGrantee.error || 'ok');
  ok((await activeLink(env, OWNER)).length === 0, 'and that ends it', 0);
}

section('Taking a page down really stops serving it');
{
  /* This one had already been found publishing after deletion: the delete went
     straight at KV while the page was served through DB, so on a D1 deployment
     the row survived and the page stayed up. Deleting a thing has to delete the
     thing that is read. */
  const env = mkEnv();
  const owner = await signup(env, OWNER);
  await W.DB.put(env, 'site', 'mypage', { slug: 'mypage', owner: OWNER, html: '<h1>hello</h1>', createdAt: Date.now() });
  await W.DB.put(env, 'sites', OWNER, { slugs: ['mypage'] });

  const stranger = await signup(env, STRANGER);
  const theirs = await jsonOf(await req(env, '/deploy/delete', { slug: 'mypage' }, stranger));
  ok(!!theirs.error, 'somebody else cannot take my page down', theirs.error);
  ok(!!(await W.DB.get(env, 'site', 'mypage')), 'and it is still there', true);

  const mine = await jsonOf(await req(env, '/deploy/delete', { slug: 'mypage' }, owner));
  ok(!mine.error, 'the owner can', mine.error || 'ok');
  ok(!(await W.DB.get(env, 'site', 'mypage')),
     'and the record the server reads when serving it is gone', await W.DB.get(env, 'site', 'mypage'));
}

section('And it stops serving on a D1 deployment too, which is where it did not');
{
  /* The original defect was invisible on KV: the delete went straight at KV
     while the page was SERVED through DB, so only a D1-backed deployment kept
     publishing. Every case above runs on KV, where a KV-only delete looks
     identical to a correct one - so this one gives the worker a D1 to prefer. */
  const rows = new Map();
  const d1 = {
    prepare(sql) {
      const q = sql;
      return {
        bind(...args) {
          return {
            async first() {
              if (/SELECT json FROM kv/.test(q)) {
                const v = rows.get(args[0] + ':' + args[1]);
                return v ? { json: v } : null;
              }
              return null;
            },
            async run() {
              if (/INSERT INTO kv/.test(q)) rows.set(args[0] + ':' + args[1], args[2]);
              if (/DELETE FROM kv/.test(q)) rows.delete(args[0] + ':' + args[1]);
              return {};
            },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const env = Object.assign(mkEnv(), { DB: d1 });
  const owner = await signup(env, OWNER);
  await W.DB.put(env, 'site', 'd1page', { slug: 'd1page', owner: OWNER, html: '<h1>hi</h1>', createdAt: Date.now() });
  await W.DB.put(env, 'sites', OWNER, { slugs: ['d1page'] });
  ok(!!(await W.DB.get(env, 'site', 'd1page')), 'the page is published on a D1 deployment', true);

  await req(env, '/deploy/delete', { slug: 'd1page' }, owner);
  ok(!(await W.DB.get(env, 'site', 'd1page')),
     'and taking it down removes the row the server actually reads',
     await W.DB.get(env, 'site', 'd1page'));
}

section('A handoff can only be acted on by the person it was sent to');
{
  const env = mkEnv();
  const me = await signup(env, OWNER);
  const them = await signup(env, GRANTEE);
  await W.DB.put(env, 'handoff', OWNER, { incoming: [{ id: 'h1', from: GRANTEE, title: 'Do this', status: 'new' }], sent: [] });

  const theirs = await jsonOf(await req(env, '/api/handoff/act', { id: 'h1', action: 'done' }, them));
  ok(!!theirs.error, 'somebody else cannot mark my handoff done', theirs.error);
  const still = await W.DB.get(env, 'handoff', OWNER);
  ok(still.incoming[0].status === 'new', 'and it is untouched', still.incoming[0].status);

  const mine = await jsonOf(await req(env, '/api/handoff/act', { id: 'h1', action: 'done' }, me));
  ok(!mine.error, 'the person it was sent to can', mine.error || 'ok');
  const after = await W.DB.get(env, 'handoff', OWNER);
  ok(after.incoming[0].status === 'done', 'and it is marked done', after.incoming[0].status);
}

section('None of it works signed out');
{
  const env = mkEnv();
  await signup(env, OWNER);
  await invitation(env);
  for (const path of ['/v1/link/accept', '/v1/link/revoke', '/deploy/delete', '/api/handoff/act']) {
    const r = await req(env, path, { id: 'inv1', code: '123456', slug: 'mypage' });
    ok(r.status === 401, path + ' needs an account', r.status);
  }
  ok((await linksOf(env, OWNER)).length === 0, 'and nothing was granted', 0);
}

globalThis.fetch = realFetch;
if (report('letting-somebody-into-your-account') > 0) process.exitCode = 1;
done();
