/* YOUR FILES CAN BE SEARCHED BY WHAT THEY SAY (Nov 8 audit RETR-020).

   A permanent index of every passage of every text file kept in an account,
   in that account's own namespace. Driven through the real library routes
   with a vector store that behaves the way Vectorize does for the calls AMV
   makes (namespaces, upsert, query, deleteByIds), and an embedding model that
   puts sentences about the same thing close together. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { withAuthOps } from '../lib/auth-object.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'fidx.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { DB, _fidxChunks };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const r2m = new Map();
const R2 = { async put(k, v) { r2m.set(k, String(v)); }, async get(k) { return r2m.has(k) ? { text: async () => r2m.get(k) } : null; },
  async head(k) { return r2m.has(k) ? { size: new TextEncoder().encode(r2m.get(k)).length } : null; }, async delete(k) { for (const x of [].concat(k)) r2m.delete(x); },
  async list({ prefix } = {}) { return { objects: [...r2m.keys()].filter(k => k.startsWith(prefix || '')).map(key => ({ key })), truncated: false }; } };
/* Words about the same subject land on the same axis. */
const TOPICS = [/rent|landlord|lease|tenancy/i, /tax|invoice|receipt|vat/i, /dog|vet|puppy/i, /flight|airport|trip/i];
const vec = (t) => TOPICS.map(re => (re.test(t) ? 1 : 0.01));
const AI = { async run(_m, { text }) { return { data: text.map(vec) }; } };
const spaces = new Map(); let deleted = [];
const VECTORS = {
  async upsert(rows) { for (const r of rows) { if (!spaces.has(r.namespace)) spaces.set(r.namespace, new Map()); spaces.get(r.namespace).set(r.id, r); } return { count: rows.length }; },
  async query(v, { topK, namespace }) { const sp = spaces.get(namespace) || new Map(); const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
    return { matches: [...sp.values()].map(r => ({ id: r.id, score: cos(v, r.values), metadata: r.metadata })).sort((a, b) => b.score - a.score).slice(0, topK) }; },
  async deleteByIds(ids) { deleted = deleted.concat(ids); for (const sp of spaces.values()) for (const id of ids) sp.delete(id); return { count: ids.length }; },
};
const m = new Map();
const mkEnv = (extra) => Object.assign({ JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test', AMV_FILES: R2,
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true }; } },
  AMV_COUNTER: withAuthOps({ idFromName: n => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0, ok: true })); } }) }) }, extra || {});
const env = mkEnv({ AI, VECTORS });
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ip = 1;
const req = async (e, path, body, tok) => { const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.6.0.' + (ip++), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), e, ctx);
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const PW = 'A-real-Passw0rd!';
const signup = async (email) => (await req(env, '/auth/signup', { email, name: 'X', password: PW })).d.token;
const file = (n, body) => ({ sig: 'text|' + n + '|' + body.length, kind: 'text', name: n, size: body.length, body });

const ana = await signup('ana@example.com'), bo = await signup('bo@example.com');
const lease = await req(env, '/v1/library/put', file('flat.txt', 'The landlord says the lease ends in March.\n\nRent goes up by 4%.'), ana);
await req(env, '/v1/library/put', file('trip.txt', 'Flight to Lisbon leaves the airport at 07:10.'), ana);
await req(env, '/v1/library/put', file('bo-taxes.txt', 'My tax receipts for the year, and one VAT invoice.'), bo);

section('A kept file is indexed, in its own account’s space');
{
  ok(lease.status === 200 && spaces.size === 2, 'two accounts, two separate spaces', [lease.status, spaces.size]);
  const list = await req(env, '/v1/library', undefined, ana);
  ok(list.d.searchInside === true, 'and the library says it can search inside files', list.d.searchInside);
}

section('A search finds the file by what it says, not its name');
{
  const r = await req(env, '/v1/library/search', { query: 'when does my tenancy finish' }, ana);
  ok(r.status === 200 && r.d.results[0] && r.d.results[0].name === 'flat.txt' && /landlord/.test(r.d.results[0].passage), 'a question with none of the file’s words finds it, with the passage', r.d);
  const other = await req(env, '/v1/library/search', { query: 'vat invoice' }, ana);
  ok(!(other.d.results || []).some(x => x.name === 'bo-taxes.txt'), 'and never reaches somebody else’s file, even when it is the best match', other.d.results);
  ok((await req(env, '/v1/library/search', { query: 'x' }, ana)).status === 400, 'an empty question is refused');
  ok((await req(env, '/v1/library/search', { query: 'tenancy' })).status === 401, 'nobody signed out can search');
}

section('Deleting a file takes its passages out of the index');
{
  const id = lease.d.file.id;
  const del = await req(env, '/v1/library/delete', { ids: [id] }, ana);
  ok(del.status === 200 && deleted.some(x => x.includes(':' + id + ':')), 'its passages are deleted by id', deleted);
  const r = await req(env, '/v1/library/search', { query: 'tenancy' }, ana);
  ok(!(r.d.results || []).some(x => x.id === id), 'and a search no longer finds it', r.d.results);
}

section('Off until it is bound, and it says so');
{
  const env2 = mkEnv({ AI });
  const t = (await (await W.default.fetch(new Request('https://api.amv.test/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.6.9.9' }, body: JSON.stringify({ email: 'cy@example.com', name: 'C', password: PW }) }), env2, ctx)).json()).token;
  const r = await req(env2, '/v1/library/search', { query: 'tenancy' }, t);
  ok(r.status === 503 && r.d.error === 'not_configured', 'search inside says it is not switched on', r.d);
  const l = await req(env2, '/v1/library', undefined, t);
  ok(l.d.searchInside === false, 'and the library knows to search by name only', l.d.searchInside);
}

section('A long file is cut into passages on its paragraphs, bounded');
{
  const long = Array.from({ length: 200 }, (_, i) => 'Paragraph ' + i + ' ' + 'word '.repeat(60)).join('\n\n');
  const c = W._fidxChunks(long);
  ok(c.length <= 64 && c.every(x => x.length <= 1400) && c.length > 10, 'at most 64 passages of at most 1,400 characters', { n: c.length, max: Math.max(...c.map(x => x.length)) });
}

console.log = quiet;
report();
done();
