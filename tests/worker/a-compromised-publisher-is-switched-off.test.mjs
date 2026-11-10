import { legacyMarketplaceFixture } from '../lib/legacy-marketplace-fixture.mjs';
/* A COMPROMISED PUBLISHER IS SWITCHED OFF, AND NOTHING ELSE IS (Nov 1 audit OPS-008).

   The operator takes a listing down and/or suspends its seller, with a
   reason. Through the real router: the listing leaves the catalogue and
   cannot be bought, the seller cannot publish anything new (no new version),
   devices that installed it are told it was taken down and why - and an
   unrelated listing is untouched. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'takedown.harness.mjs');
writeFileSync(harness, legacyMarketplaceFixture(readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')) + '\nexport { issueTokens, DB };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', ADMIN_TOKEN: 'operator-token-0123456789', APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_KV: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const BAD = 'mallory@test.com';
store.set('market:bad_plugin', JSON.stringify({ id: 'bad_plugin', title: 'Handy writer', author: BAD, kind: 'plugin', status: 'active', price: 0, installs: 9 }));
store.set('market:good_plugin', JSON.stringify({ id: 'good_plugin', title: 'Tidy notes', author: 'ann@test.com', kind: 'plugin', status: 'active', price: 0, installs: 3 }));
const seller = await W.issueTokens(env, BAD, 'Mal');
let ip = 1;
const req = async (path, body, headers) => { const r = await W.default.fetch(new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://amv.test', 'CF-Connecting-IP': '6.6.6.' + (ip++) }, headers || {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, ctx); return { status: r.status, d: await r.json().catch(() => ({})) }; };
const op = { 'X-Admin-Token': env.ADMIN_TOKEN, Authorization: 'Bearer ' + env.ADMIN_TOKEN };

section('Only the operator, with a reason');
{
  ok((await req('/admin/market/disable', { id: 'bad_plugin', reason: 'publisher account compromised, update ships a phishing prompt' }, { 'X-Admin-Token': 'nope-nope-nope-nope' })).status === 403, 'a wrong token is refused');
  const noWhy = await req('/admin/market/disable', { id: 'bad_plugin', reason: 'x' }, op);
  ok(noWhy.status === 400 && noWhy.d.code === 'reason_required', 'no reason, nothing done', noWhy.d);
}

section('Taken down: out of the catalogue, told to devices, the seller frozen - and nothing else touched');
{
  const r = await req('/admin/market/disable', { id: 'bad_plugin', seller: BAD, reason: 'publisher account compromised, update ships a phishing prompt' }, op);
  ok(r.status === 200 && r.d.listing === 'bad_plugin' && r.d.seller === BAD, 'listing and seller both switched off', r.d);
  const list = await req('/v1/market/list');
  const ids = (list.d.items || list.d.listings || []).map(x => x.id);
  ok(!ids.includes('bad_plugin') && ids.includes('good_plugin'), 'the listing is gone from the catalogue; an unrelated one stays', ids);
  const check = await req('/v1/market/check', { ids: ['bad_plugin', 'good_plugin', 'nope'] });
  ok(check.d.disabled.length === 1 && check.d.disabled[0].id === 'bad_plugin' && /compromised/.test(check.d.disabled[0].reason), 'a device holding it learns it was taken down, and why', check.d);
  const pub = await req('/v1/market/publish', { title: 'Handy writer v2', kind: 'plugin', plugin: { name: 'x' } }, { Authorization: 'Bearer ' + seller.token });
  ok(pub.status === 403 && pub.d.code === 'seller_suspended', 'and the seller cannot publish a new version', pub.status);
}

if (report('a-compromised-publisher-is-switched-off') > 0) process.exitCode = 1;
done();
