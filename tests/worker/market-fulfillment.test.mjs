/* MARKETPLACE FULFILLMENT (AMV-037).

   A buyer paid for a deliverable; a later seller edit or DELETE must never revoke
   their access. Purchases are snapshotted immutably at buy time and served from
   the snapshot. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'market-fulfillment.harness.mjs');
writeFileSync(harness, src + '\nexport { _creditSale, marketPurchases, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  },
};
const tok = async (email) => (await W.issueTokens(env, email, 'U')).token;
const purchasesReq = (t) => new Request('https://api/v1/market/purchases', { headers: { Authorization: 'Bearer ' + t } });

section('AMV-037: purchased deliverable survives seller deletion');
// seed a paid listing with a real deliverable
store.set('market:usr_deliver', JSON.stringify({ id: 'usr_deliver', authorEmail: 's@x.com', title: 'Prompt Pack', kind: 'prompt', price: 5, status: 'active', text: 'THE SECRET PROMPT', files: [{ name: 'pack.txt', data: 'aGVsbG8=' }] }));

// buyer purchases it
await W._creditSale(env, { itemId: 'usr_deliver', buyer: 'b@x.com', seller: 's@x.com', amountCents: 500 });
const buyerTok = await tok('b@x.com');

let d = await (await W.marketPurchases(purchasesReq(buyerTok), env)).json();
let item = d.items.find(i => i.id === 'usr_deliver');
ok(item && item.text === 'THE SECRET PROMPT', 'buyer sees the deliverable right after purchase', item && item.text);
ok(!item._removed, 'the purchase is not marked removed');

// the seller now DELETES the listing
store.delete('market:usr_deliver');

d = await (await W.marketPurchases(purchasesReq(buyerTok), env)).json();
item = d.items.find(i => i.id === 'usr_deliver');
ok(item && item.text === 'THE SECRET PROMPT', 'buyer STILL has the deliverable after seller deletes the listing', item && item.text);
ok(item && Array.isArray(item.files) && item.files.length === 1, 'the purchased files are retained from the snapshot');
ok(!(item && item._removed), 'the buyer is not left with a stranded, empty record');

if (report() > 0) process.exitCode = 1;
done();
