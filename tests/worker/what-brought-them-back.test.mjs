/* WHAT BROUGHT THEM BACK (habit loop, measured).

   Active was counted at sign-in and nowhere else, so a person who stays signed
   in and opens AMV every day never counted as back - the funnel's "returned"
   and every cohort week undercounted the people who use it most. And nothing
   said whether a notification or a result email brought anybody back: sent is
   not opened, and opened by somebody on their first day is not a return.

   Driven through the real route, the real counter class and the real
   _markActive, with the clock moved by hand:
     - an arrival marks the person active, as sign-in does;
     - a channel is counted once per person per day, and as a return only when
       the person's first day was an earlier one;
     - an unknown channel counts nothing; no session is refused;
     - the links carry their channel, the page reports it and takes it out of
       the address, and the owner's Growth tab shows it. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'arrival.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { authSignup, issueTokens, arrivalRecord, _arrivalsByChannel, _retentionReport, _econMonth, _markActive };\n');
const W = await import(harness + '?t=' + Date.now());
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
const quiet = console.log; console.log = () => {};

function realNamespace() {
  const objs = new Map();
  const get = (n) => {
    if (!objs.has(n)) {
      const store = new Map();
      const state = { storage: { async get(k) { return store.get(k); }, async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }, async deleteAll() { store.clear(); }, async setAlarm() {}, async deleteAlarm() {} } };
      objs.set(n, new W.AMVCounter(state, {}));
    }
    return objs.get(n);
  };
  return { idFromName: n => n, get: (n) => ({ async fetch(u, init) { return get(n).fetch(new Request('https://do/c', init)); } }) };
}
const kv = new Map();
const env = { JWT_SECRET: 'test-secret-abcdefghijklmnopqrstuv', AMV_COUNTER: realNamespace(),
  AMV_KV: { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); },
    async list({ prefix } = {}) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; } } };

const RealDate = Date;
let fake = null;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(fake == null ? RealDate.now() : fake); }
  static now() { return fake == null ? RealDate.now() : fake; }
}
globalThis.Date = FakeDate;
const START = RealDate.UTC(2026, 10, 2, 10);   // Monday 2 Nov 2026
const at = (days) => { fake = START + days * 86400000; };

const post = (path, body, token, method) => new Request('https://w' + path, { method: method || 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
/* A fresh access token for the same session at the moved clock: the person
   stays signed in, which is the case this is about - a sign-in would mark them
   active by itself. */
const fresh = async (tok) => { if (!tok) return null; const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); const t = await W.issueTokens(env, p.email, p.name, p.sid); return t.access || t.token || t.accessToken; };
const arrive = async (token, via) => (await W.arrivalRecord(post('/v1/arrival', via === undefined ? {} : { via }, await fresh(token)), env));

at(0);
const ana = (await (await W.authSignup(post('/auth/signup', { email: 'ana@x.com', name: 'A', password: 'correct-horse-9' }), env)).json()).token;
const bo = (await (await W.authSignup(post('/auth/signup', { email: 'bo@x.com', name: 'B', password: 'correct-horse-9' }), env)).json()).token;
ok(ana && bo, 'two accounts to arrive with');

section('No session, no count; only a POST');
{
  ok((await arrive(null, 'push')).status === 401, 'an arrival without a session is refused');
  ok((await W.arrivalRecord(post('/v1/arrival', null, ana, 'GET'), env)).status === 405, 'and a GET is not an arrival');
}

section('Opening AMV while signed in counts as being here, as signing in does');
{
  at(0); await arrive(ana); await arrive(bo, 'push');
  ok(kv.has('factive:ana@x.com') && kv.has('factive:bo@x.com'), 'each has a first day, signed in or not');
  at(8);
  const r = await arrive(ana);
  ok(r.status === 200 && (await r.json()).ok === true, 'a later arrival is answered');
  const rep = await W._retentionReport(env, START + 15 * 86400000);
  const c = rep.cohorts.find(x => x.week === '2026-11-02');
  const w1 = c && (c.weeks.find(x => x.n === 1) || {});
  ok(c && c.size === 2 && w1.count === 1, 'and the cohort sees the one who came back in week 1 without signing in again', c);
}

section('A channel counts once per person per day, and as a return only when it is one');
{
  /* bo arrived from a notification on the first day: opened, not a return. */
  let m = await W._arrivalsByChannel(env);
  ok(m.push.arrivals === 1 && m.push.returns === 0, 'a notification opened on somebody’s first day is not a return', m.push);
  at(9);
  await arrive(bo, 'push'); await arrive(bo, 'push'); await arrive(bo, 'push');
  await arrive(ana, 'email');
  await arrive(ana, 'carrier-pigeon');
  m = await W._arrivalsByChannel(env);
  ok(m.push.arrivals === 2 && m.push.returns === 1, 'three opens in a day are one, and that one brought somebody back', m.push);
  ok(m.email.arrivals === 1 && m.email.returns === 1, 'a result email that brought somebody back is counted for email', m.email);
  ok(Object.keys(m).join() === 'push,email', 'a channel AMV did not send counts nothing', Object.keys(m));
}

section('Each person is counted once a month, so cost is shared over people, not visits');
{
  /* November had two people across many visits; December starts clean. The
     month is read once, after every visit, because the owner's read is cached. */
  at(29); await arrive(ana); await arrive(bo);   // 1 Dec
  at(30); await arrive(ana);                     // 2 Dec: the same person again
  kv.set('factive:old@x.com', '2026-10-01');     // a record from before the change
  await W._markActive(env, 'old@x.com');
  const dec = +(((await W._econMonth(env, '2026-12')) || {}).mau || 0);
  ok(dec === 3, 'three people active in December are three, however often they came', dec);
  const rec = JSON.parse(kv.get('factive:old@x.com'));
  ok(rec.legacy === true && rec.m === '2026-12' && !(rec.w || []).length, 'an older record is counted for the month and still kept out of the cohorts', rec);
  const back = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(/costPerActiveUser: mau > 0 \? \+\(totalCost \/ mau\)/.test(back), 'the owner\u2019s figures divide the month\u2019s cost by people, not by visits');
  const admin = readFileSync(join(ROOT, 'src', 'admin', 'admin.js'), 'utf8');
  ok(/AI cost per active person/.test(admin) && /Revenue per active person/.test(admin), 'and the Growth tab sets cost and revenue per active person side by side');
  ok(/live\.actionOutcomes\.verified[\s\S]{0,80}mg\.activeThisMonth/.test(admin) && /Confirmed actions per active person/.test(admin), 'and beside them the work done: confirmed actions per active person (Nov 8 audit GROWTH-011)');
}

section('The links carry their channel, the page reports it, the owner sees it');
{
  const back = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(/url: '\/\?via=push#\/crew'/.test(back), 'a notification opens AMV with ?via=push');
  ok((back.match(/url: appUrl \+ '\/\?via=email'/g) || []).length === 2, 'both result emails’ buttons carry ?via=email');
  ok(/case '\/v1\/arrival':\s*return arrivalRecord\(request, env\)/.test(back), 'the route is served');
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  ok(/q\.delete\('via'\)/.test(app) && /history\.replaceState/.test(app), 'the page takes the channel out of the address once read');
  ok((app.match(/_syncBootstrap\(\);\s*(\}catch\(e\)\{\}\s*)?try\{ _arrivalReport\(\); \}catch\(e\)\{\}/g) || []).length === 2,
    'it reports the arrival on a sign-in and on a returning visit alike');
  const admin = readFileSync(join(ROOT, 'src', 'admin', 'admin.js'), 'utf8');
  ok(/live && live\.arrivals/.test(admin) && /What brought people back/.test(admin), 'the Growth tab shows what brought people back');
}

console.log = quiet;
report();
done();
