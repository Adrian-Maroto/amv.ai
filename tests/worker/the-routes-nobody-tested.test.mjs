/* THE ROUTES NOTHING HAD EVER CALLED.

   A route with no test is not a route that works. It is a route whose behaviour
   nobody has stated, which means the next refactor is free to change it and the
   gate will say SHIPPABLE. These were the remainder after every other suite in
   this directory: sign-in exchange, finishing a bank link, leaving a family,
   joining a team, presence, the task board, the billing portal and invoices,
   publishing / installing / unlisting / rating / messaging on the marketplace,
   and saving a chat widget. There were sixteen; the video allowance was one of
   them and went with video generation.

   They are covered here for what actually matters about each one, which in
   almost every case is the same two questions: can somebody who is not you
   reach your thing, and when the answer is no or empty, is that the truth or
   just what the code happened to return. A 200 with an empty list is the most
   dangerous response in this file - it is indistinguishable from working. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'routes.harness.mjs');
writeFileSync(harness, src + '\nexport { DB };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

const PW = 'A-real-Passw0rd!';
let outbound = [];
let stripeInvoiceList = { data: [] };
let stripePortalUrl = 'https://billing.stripe.test/session';
let googleTokenReply = { ok: true, body: { access_token: 'ga', refresh_token: 'gr', expires_in: 3600 } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  outbound.push(u);
  if (/billing_portal\/sessions/.test(u)) return { ok: true, status: 200, json: async () => ({ url: stripePortalUrl }) };
  if (/v1\/invoices/.test(u)) return { ok: true, status: 200, json: async () => stripeInvoiceList };
  if (/oauth2\.googleapis\.com/.test(u))
    return { ok: googleTokenReply.ok, status: googleTokenReply.ok ? 200 : 400, json: async () => googleTokenReply.body };
  if (/mail|resend|sendgrid|postmark/i.test(u)) return { ok: true, status: 200, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({}) };
};

function mkEnv(extra) {
  const m = new Map(); const vals = new Map(); outbound = [];
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test', APP_ORIGIN: 'https://amv.test',
    AMV_KV: {
      _map: m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit, cursor } = {}) {
        const all = [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name }));
        const from = cursor ? +cursor : 0;
        const page = all.slice(from, from + (limit || 1000));
        const next = from + page.length;
        return { keys: page, list_complete: next >= all.length, cursor: String(next) };
      },
    },
    AMV_COUNTER: {
      idFromName: (n) => n,
      get: (n) => ({ async fetch(_u, init) {
        const b = JSON.parse(init.body); const cur = vals.get(n) || 0;
        if (b.op === 'claim') { if (vals.has(n)) return new Response(JSON.stringify({ claimed: false })); vals.set(n, 1); return new Response(JSON.stringify({ claimed: true })); }
        /* A stub that can take a lock and never give it back is not a lock: the
           first write through it succeeds and every write after it is refused
           for ever. That is not how the code behaves, so it must not be how the
           fixture behaves either. */
        if (b.op === 'release') { vals.delete(n); return new Response(JSON.stringify({ ok: true })); }
        if (b.op === 'incr') { vals.set(n, cur + (b.amount || 0)); return new Response(JSON.stringify({ value: vals.get(n) })); }
        if (b.op === 'get') return new Response(JSON.stringify({ value: cur }));
        if (b.op === 'rateCheck') { vals.set(n, cur + 1); return new Response(JSON.stringify({ allowed: true })); }
        return new Response(JSON.stringify({ allowed: true, value: cur }));
      } }),
    },
  }, extra || {});
}
const ctx = { waitUntil(p) { this._p = this._p || []; if (p) this._p.push(Promise.resolve(p).catch(() => {})); },
              passThroughOnException() {}, async settle() { await Promise.all(this._p || []); } };
const call = (env, path, body, tok) => worker.fetch(new Request('https://api.amv.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '60.60.60.60',
             ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {}),
}), env, ctx);
const post = async (env, path, body, tok) => {
  const r = await call(env, path, body, tok);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const signup = async (env, email, name) =>
  (await (await call(env, '/auth/signup', { email, name: name || email.split('@')[0], password: PW })).json()).token;

/* Every one of these routes takes an account. Asserted once, for all of them,
   rather than sixteen near-identical sections - but asserted, because an
   authenticated route that forgot requireUser is the whole ball game. */
section('None of them answer a stranger');
{
  const env = mkEnv();
  const paths = ['/v1/oauth/google/exchange', '/v1/finance/link/finish', '/v1/family/leave',
                 '/team/join', '/team/presence', '/team/tasks', '/team/task/update',
                 '/v1/stripe/portal', '/v1/stripe/invoices',
                 '/v1/market/publish', '/v1/market/install', '/v1/market/unlist',
                 '/v1/market/rate', '/v1/market/message', '/v1/widget/save'];
  const answered = [];
  for (const p of paths) {
    const r = await post(env, p, {});
    if (r.status !== 401) answered.push(p + ' -> ' + r.status);
  }
  ok(answered.length === 0, 'every one of them requires a signed-in account', answered);
  /* The roster has to still find them. A path that is renamed or removed and
     left in this list would be posted to, get a 404, count as "not 200", and
     pass - a check that goes green because its subject vanished. */
  ok(paths.every(p => src.includes("'" + p + "'")), 'and every path checked is a real route', paths.length);
}

section('Billing history and the portal belong to the caller and nobody else');
{
  const env = mkEnv({ STRIPE_SECRET_KEY: 'sk_test' });
  const mine = await signup(env, 'payer@example.com');
  const theirs = await signup(env, 'other@example.com');
  await env.AMV_KV.put('stripecust:payer@example.com', 'cus_mine');

  stripeInvoiceList = { data: [{ id: 'in_1', number: 'AMV-1', created: 1700000000, amount_paid: 1500, currency: 'usd', status: 'paid', invoice_pdf: 'https://pdf' }] };
  const r = await post(env, '/v1/stripe/invoices', {}, mine);
  ok(r.body.invoices.length === 1 && r.body.invoices[0].amount === 15,
     'the caller sees their own invoices, in money rather than cents', r.body.invoices[0]);
  ok(outbound.some(u => /customer=cus_mine/.test(u)),
     'asked for by THEIR customer id, which is what makes it theirs', outbound.filter(u => /invoices/.test(u)));

  /* Somebody with no Stripe customer gets an honest empty list, and no call is
     made on their behalf - not somebody else's invoices. */
  outbound = [];
  const none = await post(env, '/v1/stripe/invoices', {}, theirs);
  ok(none.body.ok === true && none.body.invoices.length === 0,
     'an account with no subscription gets an honest empty history', none.body);
  ok(!outbound.some(u => /v1\/invoices/.test(u)),
     'and nothing is asked of Stripe on their behalf', outbound);

  const portalNo = await post(env, '/v1/stripe/portal', {}, theirs);
  ok(portalNo.status === 404, 'the portal refuses an account with no subscription', portalNo.status);

  const portal = await post(env, '/v1/stripe/portal', {}, mine);
  ok(portal.body.url === stripePortalUrl, 'and opens for one that has', portal.body);
  const portalCall = outbound.find(u => /billing_portal/.test(u));
  ok(!!portalCall, 'through Stripe', portalCall);
}

section('The portal comes back to AMV, wherever the request claims to be from');
{
  /* The return_url decides where somebody lands after handling their card
     details. Reflecting a caller-supplied Origin would put that landing page on
     a site of the caller's choosing. */
  const env = mkEnv({ STRIPE_SECRET_KEY: 'sk_test' });
  const tok = await signup(env, 'ret@example.com');
  await env.AMV_KV.put('stripecust:ret@example.com', 'cus_x');
  let sentBody = '';
  const keep = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (/billing_portal/.test(String(url))) { sentBody = String((opts && opts.body) || ''); return { ok: true, status: 200, json: async () => ({ url: 'u' }) }; }
    return keep(url, opts);
  };
  await worker.fetch(new Request('https://api.amv.test/v1/stripe/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok,
               'Origin': 'https://evil.example', 'CF-Connecting-IP': '60.60.60.60' },
    body: '{}',
  }), env, ctx);
  globalThis.fetch = keep;
  ok(/return_url=https%3A%2F%2Famv\.test/.test(sentBody),
     'the configured origin wins over the header', sentBody.slice(0, 120));
  ok(!/evil\.example/.test(sentBody), 'and the caller cannot choose where they land', sentBody.slice(0, 120));
}

section('Finishing a bank link needs a link this account actually started');
{
  const env = mkEnv({ FINANCE_CLIENT_ID: 'c', FINANCE_SECRET: 's' });
  const tok = await signup(env, 'bank@example.com');
  const nobody = await post(env, '/v1/finance/link/finish', {}, tok);
  ok(nobody.status === 400 && nobody.body.code === 'no_session',
     'with nothing started it says so rather than calling the provider', nobody.body);

  /* Somebody else's half-finished link is not a link you can finish. The token
     is stored per account and read from the CALLER, never from the body. */
  await W.DB.put(env, 'finlink', 'someone@example.com', { token: 'link-tok-of-theirs' });
  const theirs = await post(env, '/v1/finance/link/finish', { email: 'someone@example.com', link_token: 'link-tok-of-theirs' }, tok);
  ok(theirs.status === 400 && theirs.body.code === 'no_session',
     'naming somebody else in the body changes nothing', theirs.body);
  const still = await W.DB.get(env, 'finlink', 'someone@example.com');
  ok(!!still && still.token === 'link-tok-of-theirs', 'and their session is untouched', !!still);
}

section('Leaving a family is something only you can do to yourself');
{
  const env = mkEnv();
  const parentTok = await signup(env, 'parent@example.com', 'Parent');
  const kidTok = await signup(env, 'kid@example.com', 'Kid');
  /* The record shape the product itself writes when an invitation is accepted:
     `parentEmail`, and a member row with role 'child'. A fixture that invents
     its own shape tests the fixture. */
  await W.DB.put(env, 'fam', 'parent@example.com', {
    id: 'fam_test', parentEmail: 'parent@example.com', createdAt: Date.now(),
    members: [{ email: 'parent@example.com', role: 'parent', joinedAt: Date.now() },
              { email: 'kid@example.com', role: 'child', joinedAt: Date.now(), limits: { payouts: false } }],
  });
  await W.DB.put(env, 'ent', 'kid@example.com', { plan: 'free', familyOf: 'parent@example.com' });

  const notIn = await post(env, '/v1/family/leave', {}, parentTok);
  ok(notIn.status === 404, 'somebody in no family is told so', notIn.body);

  /* And naming a family they are not in does not put them in one they can then
     leave. Membership is read from the CALLER's own entitlement; a body field
     is not a way to reach into somebody else's household - which would delete
     the marker every parental limit on that child is read from.

     The version of this test that only asked the child to leave passed against
     exactly that defect, because the child had a family already and the body
     was never consulted. */
  const strangerTok = await signup(env, 'stranger@example.com', 'Stranger');
  const reach = await post(env, '/v1/family/leave', { email: 'parent@example.com', parent: 'parent@example.com' }, strangerTok);
  ok(reach.status === 404, 'and naming somebody else’s family gets them nowhere', reach.body);
  const untouched = await W.DB.get(env, 'fam', 'parent@example.com');
  ok((untouched.members || []).some(m => m.email === 'kid@example.com'),
     'with that family exactly as it was', (untouched.members || []).map(m => m.email));

  const left = await post(env, '/v1/family/leave', { email: 'someone.else@example.com' }, kidTok);
  ok(left.body.ok === true && left.body.left === 'parent@example.com',
     'the child leaves their OWN family, whatever the body says', left.body);

  const ent = await W.DB.get(env, 'ent', 'kid@example.com');
  ok(!ent.familyOf, 'the marker every parental limit reads is gone', ent.familyOf);
  const fam = await W.DB.get(env, 'fam', 'parent@example.com');
  ok(!(fam.members || []).some(m => m.email === 'kid@example.com'),
     'and the roll is updated on the parent side too', (fam.members || []).map(m => m.email));
}

/* ---- Teams: two separate teams, so "your team" has to mean something ---- */
async function twoTeams(env) {
  const aTok = await signup(env, 'lead@a.example', 'Lead A');
  const bTok = await signup(env, 'lead@b.example', 'Lead B');
  const memTok = await signup(env, 'member@a.example', 'Member A');
  /* Creating a team takes the plan that includes it. The member deliberately
     does NOT have it - a seat is paid for by the team, and a free account being
     able to JOIN is part of what is being asserted here. */
  await W.DB.put(env, 'ent', 'lead@a.example', { plan: 'elite', source: 'stripe' });
  await W.DB.put(env, 'ent', 'lead@b.example', { plan: 'elite', source: 'stripe' });
  const a = (await post(env, '/team/create', { name: 'Team A' }, aTok)).body;
  const b = (await post(env, '/team/create', { name: 'Team B' }, bTok)).body;
  return { aTok, bTok, memTok, a: a.team || a, b: b.team || b };
}

section('An invite is for the person it was sent to, and works once');
{
  const env = mkEnv();
  const { aTok, memTok } = await twoTeams(env);
  const outsiderTok = await signup(env, 'outsider@x.example', 'Outsider');

  const inv = await post(env, '/team/invite', { email: 'member@a.example', role: 'member' }, aTok);
  const token = inv.body.inviteToken;
  ok(!!token, 'an invite was created', inv.body);

  const stolen = await post(env, '/team/join', { token }, outsiderTok);
  ok(stolen.status === 403, 'a forwarded link does not admit somebody else', stolen.body);

  const joined = await post(env, '/team/join', { token }, memTok);
  ok(joined.body.ok === true, 'the person it was sent to joins', joined.body.error || 'ok');

  const again = await post(env, '/team/join', { token }, memTok);
  ok(again.status === 409 || again.status === 404,
     'and the same invite cannot be redeemed twice', again.status);
}

section('Presence and the task board stop at the edge of your own team');
{
  const env = mkEnv();
  const { aTok, bTok, memTok } = await twoTeams(env);
  const inv = await post(env, '/team/invite', { email: 'member@a.example', role: 'member' }, aTok);
  await post(env, '/team/join', { token: inv.body.inviteToken }, memTok);

  const p = await post(env, '/team/presence', {}, aTok);
  const emails = (p.body.present || []).map(x => x.email);
  ok(emails.includes('lead@a.example') && emails.includes('member@a.example'),
     'a lead sees their own team', emails);
  ok(!emails.includes('lead@b.example'), 'and nobody from another team', emails);

  const pB = await post(env, '/team/presence', {}, bTok);
  ok(!(pB.body.present || []).some(x => /@a\.example/.test(x.email)),
     'the other team sees only itself', (pB.body.present || []).map(x => x.email));

  const t = await post(env, '/team/task/create', { title: 'Ship it', assignee: 'member@a.example' }, aTok);
  ok(t.body.ok === true, 'a task is created', t.body.error || 'ok');
  const taskId = t.body.task.id;

  const mine = await post(env, '/team/tasks', {}, memTok);
  ok((mine.body.tasks || []).some(x => x.id === taskId), 'the assignee sees it on their board', mine.body.tasks && mine.body.tasks.length);

  const theirs = await post(env, '/team/tasks', {}, bTok);
  ok(!(theirs.body.tasks || []).some(x => x.id === taskId),
     'the other team does not, which is the whole point of a team board', theirs.body.tasks);

  /* Reaching into another team by id. The handler looks the team up from the
     CALLER, so an id in the body is not a way in. */
  const reach = await post(env, '/team/task/update', { id: taskId, status: 'done' }, bTok);
  ok(reach.status === 404, 'and cannot be moved from outside', reach.status);
  const after = await post(env, '/team/tasks', {}, aTok);
  ok((after.body.tasks.find(x => x.id === taskId) || {}).status === 'todo',
     'the task is exactly where it was', (after.body.tasks[0] || {}).status);
}

section('Who may move a task, and who may hand it to somebody else');
{
  const env = mkEnv();
  const { aTok, memTok } = await twoTeams(env);
  const inv = await post(env, '/team/invite', { email: 'member@a.example', role: 'member' }, aTok);
  await post(env, '/team/join', { token: inv.body.inviteToken }, memTok);
  const t = await post(env, '/team/task/create', { title: 'Do the thing', assignee: 'member@a.example' }, aTok);
  const id = t.body.task.id;

  const moved = await post(env, '/team/task/update', { id, status: 'in_progress' }, memTok);
  ok(moved.body.ok === true, 'the assignee can move their own work along', moved.body.error || 'ok');

  const bad = await post(env, '/team/task/update', { id, status: 'finished-ish' }, memTok);
  ok(bad.status === 400, 'an invented status is refused rather than stored', bad.body);

  const reassign = await post(env, '/team/task/update', { id, assignee: 'lead@a.example' }, memTok);
  ok(reassign.status === 403, 'a member cannot hand their work to somebody else', reassign.body);

  const stranger = await post(env, '/team/task/update', { id, assignee: 'outsider@x.example' }, aTok);
  ok(stranger.status === 400, 'and a lead cannot assign work to a non-member', stranger.body);
}

/* ---- The marketplace ---- */
section('Publishing is checked at the door, not on the way out');
{
  const env = mkEnv();
  const tok = await signup(env, 'seller@example.com', 'Seller');

  const noTitle = await post(env, '/v1/market/publish', { text: 'stuff' }, tok);
  ok(noTitle.status === 400, 'a listing with no title is refused', noTitle.body);

  const empty = await post(env, '/v1/market/publish', { title: 'Nothing inside' }, tok);
  ok(empty.status === 400 && /deliverable/i.test(empty.body.error || ''),
     'and one with nothing to deliver is refused with the reason', empty.body.error);

  const branded = await post(env, '/v1/market/publish', { title: 'ChatGPT prompt pack', text: 'x' }, tok);
  ok(branded.status === 400 && /AMV-only/i.test(branded.body.error || ''),
     'another company’s name cannot be sold on AMV', branded.body.error);

  const good = await post(env, '/v1/market/publish', { title: 'A real pack', text: 'the deliverable', price: 9 }, tok);
  ok(good.body.ok === true, 'a real listing publishes', good.body.error || 'ok');
  ok(good.body.item.locked === true && good.body.item.text === undefined,
     'and a PAID listing does not hand back its deliverable in the catalogue', Object.keys(good.body.item));

  /* Markup in the icon renders unescaped on the client. It never reaches the record. */
  const xss = await post(env, '/v1/market/publish', { title: 'Icon test', text: 'x', icon: '<img src=x onerror=alert(1)>' }, tok);
  ok(xss.body.ok === true && !String(xss.body.item.icon).includes('<'),
     'and an icon carrying markup is replaced, not trimmed into a fragment', xss.body.item.icon);
}

section('An install is a signal only if it cannot be manufactured');
{
  const env = mkEnv();
  const sellerTok = await signup(env, 'sell2@example.com');
  const fanTok = await signup(env, 'fan@example.com');
  const item = (await post(env, '/v1/market/publish', { title: 'Free thing', text: 'here', price: 0 }, sellerTok)).body.item;

  const first = await post(env, '/v1/market/install', { id: item.id }, fanTok);
  ok(first.body.counted === true, 'the first install by an account counts', first.body);

  const second = await post(env, '/v1/market/install', { id: item.id }, fanTok);
  ok(second.body.ok === true && second.body.counted === false,
     'the second is honoured and NOT counted, so a number cannot be farmed', second.body);

  const rec = JSON.parse(await env.AMV_KV.get('market:' + item.id));
  ok(rec.installs === 1, 'the stored ranking signal saw it once', rec.installs);
}

section('Rating is for people who bought the thing');
{
  const env = mkEnv();
  const sellerTok = await signup(env, 'sell3@example.com');
  const randoTok = await signup(env, 'rando@example.com');
  const item = (await post(env, '/v1/market/publish', { title: 'Rated thing', text: 'here', price: 5 }, sellerTok)).body.item;

  const cheeky = await post(env, '/v1/market/rate', { id: item.id, stars: 1 }, randoTok);
  ok(cheeky.status === 403, 'somebody who never bought it cannot rate it', cheeky.body);

  await env.AMV_KV.put(`entitleitem:rando@example.com:${item.id}`, '1');
  const real = await post(env, '/v1/market/rate', { id: item.id, stars: 9 }, randoTok);
  ok(real.body.ok === true && real.body.rating === 5,
     'a buyer can, and a rating outside the scale is clamped rather than stored', real.body);
  ok(real.body.ratings === 1, 'counted once', real.body.ratings);
}

section('Unlisting is the author’s to do, and does not take back what was paid for');
{
  const env = mkEnv();
  const sellerTok = await signup(env, 'sell4@example.com');
  const buyerTok = await signup(env, 'buyer4@example.com');
  const item = (await post(env, '/v1/market/publish', { title: 'Sold thing', text: 'the goods', price: 20 }, sellerTok)).body.item;

  /* A completed purchase: the entitlement and the snapshot taken at the time. */
  await env.AMV_KV.put(`entitleitem:buyer4@example.com:${item.id}`, '1');
  await env.AMV_KV.put('purchases:buyer4@example.com', JSON.stringify([{ id: item.id, ts: Date.now() }]));
  await W.DB.put(env, 'mktsnap', `buyer4@example.com:${item.id}`, { id: item.id, title: 'Sold thing', text: 'the goods', _boughtAt: Date.now() });

  const notYours = await post(env, '/v1/market/unlist', { id: item.id }, buyerTok);
  ok(notYours.status === 403, 'a buyer cannot delete somebody else’s listing', notYours.body);

  const gone = await post(env, '/v1/market/unlist', { id: item.id }, sellerTok);
  ok(gone.body.ok === true, 'the author can', gone.body);
  ok(!(await env.AMV_KV.get('market:' + item.id)), 'and it leaves the catalogue', true);

  const lib = await post(env, '/v1/market/purchases', {}, buyerTok);
  const kept = (lib.body.items || []).find(x => x.id === item.id);
  ok(!!kept && kept.text === 'the goods',
     'while the person who PAID keeps what they paid for', kept && Object.keys(kept));
}

section('Messages go to a person, say something, and are screened');
{
  const env = mkEnv();
  const aTok = await signup(env, 'msga@example.com', 'A');
  const bTokUp = await signup(env, 'msgb@example.com', 'B');
  /* A listing is what makes a first message legal now - the seller is derived
     from it rather than taken from an address the sender typed. This section
     used to send to a bare address, which was the hole. */
  const item = (await post(env, '/v1/market/publish',
    { title: 'A thing for sale', text: 'goods', price: 10 }, bTokUp)).body.item;
  ok(!!item, 'B has something listed', !!item);

  const empty = await post(env, '/v1/market/message', { item: item.id, text: '   ' }, aTok);
  ok(empty.status === 400, 'an empty message is refused', empty.body);

  const self = await post(env, '/v1/market/message', { to: 'msga@example.com', text: 'hi' }, aTok);
  ok(self.status === 400, 'and so is messaging yourself', self.body);

  /* The security property, asserted head-on: an address alone reaches nobody. */
  const stranger = await post(env, '/v1/market/message', { to: 'msgb@example.com', text: 'hi' }, aTok);
  ok(stranger.status === 403,
     'and a bare address with no listing behind it reaches nobody', stranger.body.error);

  const sentOk = await post(env, '/v1/market/message', { item: item.id, text: 'is this still for sale?' }, aTok);
  ok(sentOk.body.ok === true, 'a question about the listing is delivered', sentOk.body.error || 'ok');
  const first = ((sentOk.body.thread || {}).msgs || [])[0];
  ok(!!first && first.from === 'msga@example.com',
     'attributed to whoever actually sent it, not to whoever the body names', first);

  /* Both sides share ONE thread, in either order - otherwise a reply starts a
     second conversation and each person sees half of it. */
  const bTok = (await (await call(env, '/auth/login', { email: 'msgb@example.com', password: PW })).json()).token;
  const tid = (sentOk.body.thread || {}).id;
  const reply = await post(env, '/v1/market/message', { thread: tid, text: 'yes' }, bTok);
  ok((reply.body.thread || {}).id === tid, 'a reply lands in the same thread', (reply.body.thread || {}).id);
  ok(((reply.body.thread || {}).msgs || []).length === 2, 'which now holds both messages', ((reply.body.thread || {}).msgs || []).length);

  const threads = await post(env, '/v1/market/threads', {}, aTok);
  ok((threads.body.threads || []).length === 1, 'and each person sees the one conversation', (threads.body.threads || []).length);
}

section('A widget belongs to whoever made it');
{
  const env = mkEnv();
  const ownerTok = await signup(env, 'wowner@example.com');
  const strangerTok = await signup(env, 'wstranger@example.com');

  const made = await post(env, '/v1/widget/save', {
    title: 'Support', greeting: 'Hi', accent: '#112233',
    origins: ['https://shop.example'], dailySpendCapUSD: 5, enabled: true,
  }, ownerTok);
  ok(made.body.ok === true, 'the owner saves a widget', made.body.error || 'ok');
  const key = made.body.config.key;
  ok(!!key, 'and it has a site key', !!key);

  /* The stranger saving gets their OWN widget, not a way into this one - the
     record is keyed by the caller and the key is never read from the body. */
  const theirs = await post(env, '/v1/widget/save', { key, title: 'Mine now', enabled: true }, strangerTok);
  ok(theirs.body.ok === true, 'a stranger saving gets a widget', theirs.body.error || 'ok');
  ok(theirs.body.config.key !== key, 'with a different key of their own', { a: key, b: theirs.body.config.key });

  const still = await W.DB.get(env, 'widget', key);
  ok(still.title === 'Support' && still.owner === 'wowner@example.com',
     'and the original is untouched', { title: still.title, owner: still.owner });

  /* Values outside the allowed range are clamped, not stored - the spend cap is
     the one that costs money if a client sends anything it likes. */
  const wild = await post(env, '/v1/widget/save', { dailySpendCapUSD: 999999, maxOut: 999999, accent: 'javascript:alert(1)' }, ownerTok);
  ok(wild.body.config.dailySpendCapUSD <= 1000, 'a spend cap is clamped to a real ceiling', wild.body.config.dailySpendCapUSD);
  ok(wild.body.config.maxOut <= 4000, 'and so is the response size', wild.body.config.maxOut);
  ok(wild.body.config.accent === '#112233', 'a colour that is not a colour is ignored', wild.body.config.accent);
}

section('Signing in with Google needs a code, and cannot be pointed elsewhere');
{
  const env = mkEnv({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' });
  const tok = await signup(env, 'goog@example.com');

  const bare = await post(env, '/v1/oauth/google/exchange', {}, tok);
  ok(bare.status === 400, 'nothing to exchange is refused', bare.body);

  const elsewhere = await post(env, '/v1/oauth/google/exchange',
    { code: 'c', verifier: 'v', redirect_uri: 'https://evil.example/cb' }, tok);
  ok(elsewhere.status === 400 && /not permitted/i.test(elsewhere.body.error || ''),
     'and a redirect back to somewhere AMV does not serve is refused', elsewhere.body.error);
  ok(!outbound.some(u => /oauth2\.googleapis/.test(u)),
     'without asking Google anything, so a refused call costs nothing', outbound);

  const good = await post(env, '/v1/oauth/google/exchange',
    { code: 'c', verifier: 'v', redirect_uri: 'https://amv.test/cb' }, tok);
  ok(good.status === 200, 'the real one goes through', good.body);
  const blob = JSON.stringify(good.body);
  ok(!blob.includes('gr'), 'and the refresh token stays on the server', blob.slice(0, 160));
}

section('Without Google configured it says so instead of failing oddly');
{
  const env = mkEnv();
  const tok = await signup(env, 'nogoog@example.com');
  const r = await post(env, '/v1/oauth/google/exchange', { code: 'c', verifier: 'v', redirect_uri: 'https://amv.test/cb' }, tok);
  ok(r.status === 503 && r.body.code === 'needs_service',
     'an unconfigured deployment degrades honestly', r.body);
}

globalThis.fetch = realFetch;
if (report('the-routes-nobody-tested') > 0) process.exitCode = 1;
done();
