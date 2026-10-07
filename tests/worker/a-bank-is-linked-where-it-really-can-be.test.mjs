/* A BANK IS LINKED WHERE IT REALLY CAN BE - AND NOWHERE ELSE.

   Asked for: the bank has to be the bank, linked directly, not read out of
   emails - "a lot of people don't get their money notifications by email,
   they get them in the bank's app". AMV links banks through an aggregator
   whose coverage is the US, Canada, the UK and most of the EU; which of those
   THIS deployment may use is a contract with that provider. So the countries
   are a setting (FINANCE_COUNTRIES), and this pins what the setting can and
   cannot do:

     - a country outside the provider's coverage (China) is ignored, however
       it got into the setting - a Connect button that cannot work is the
       most expensive kind of wrong on a money screen;
     - each link is opened for the person's own country's banks, and asks
       only for what the provider offers there (investments are US-only);
     - with nothing set, it is the United States, exactly as before;
     - the page is told truthfully where a bank can be linked. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'bank-where.harness.mjs');
writeFileSync(harness, src + '\nexport { _finCountries };\n');
const W = await import(harness + '?t=' + Date.now());
const worker = W.default;

let linkCalls = [];
globalThis.fetch = async (url, opts) => {
  if (/link\/token\/create/.test(String(url))) {
    linkCalls.push(JSON.parse(String((opts && opts.body) || '{}')));
    return { ok: true, status: 200, json: async () => ({ link_token: 'lt', hosted_link_url: 'https://bank.example/link' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};
function mkEnv(extra) {
  const m = new Map();
  return Object.assign({
    JWT_SECRET: 'j', ADMIN_TOKEN: 'a', APP_URL: 'https://amv.test', FINANCE_CLIENT_ID: 'cid', FINANCE_SECRET: 'sec', CONNECT_KEY: 'test-connect-key',
    AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } },
    AMV_COUNTER: { idFromName: (n) => n, get: () => ({ async fetch() { return new Response(JSON.stringify({ allowed: true, value: 0 })); } }) },
  }, extra || {});
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (env, path, body, tok, from) => {
  const r = new Request('https://api.amv.test' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '63.63.63.' + (1 + Math.floor(Math.random() * 200)), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (from) Object.defineProperty(r, 'cf', { value: { country: from } });
  return worker.fetch(r, env, ctx);
};
async function signIn(env) {
  const d = await (await call(env, '/auth/signup', { email: 'bank' + Math.random().toString(36).slice(2, 7) + '@example.com', name: 'B', password: 'A-real-Passw0rd!' })).json();
  return d.token;
}

section('The setting, read strictly');
{
  ok(JSON.stringify(W._finCountries({})) === '["US"]', 'nothing set: the United States, as before', W._finCountries({}));
  const s = W._finCountries({ FINANCE_COUNTRIES: 'es, GB,CN,xx,ES' });
  ok(s.includes('ES') && s.includes('GB') && s.includes('US'), 'Spain and the UK once set - and the US stays', s);
  ok(!s.includes('CN') && !s.includes('XX'), 'China and nonsense are ignored: the provider does not cover them', s);
}

section('A link in Spain is a link to Spanish banks, for what the provider offers there');
{
  const env = mkEnv({ FINANCE_COUNTRIES: 'US,ES' }); const tok = await signIn(env); linkCalls = [];
  const r = await call(env, '/v1/finance/link/start', { country: 'ES' }, tok, 'ES');
  const d = await r.json();
  ok(r.status === 200 && d.url, 'the link opens', { status: r.status, d });
  const c = linkCalls[0] || {};
  ok(JSON.stringify(c.country_codes) === '["ES"]', 'for Spain’s banks', c.country_codes);
  ok(JSON.stringify(c.products) === '["transactions"]', 'asking only for transactions - investments are a US product there', c.products);
}

section('In the US it is the US link it always was');
{
  const env = mkEnv({ FINANCE_COUNTRIES: 'US,ES' }); const tok = await signIn(env); linkCalls = [];
  await call(env, '/v1/finance/link/start', {}, tok, 'US');
  const c = linkCalls[0] || {};
  ok(JSON.stringify(c.country_codes) === '["US"]' && c.products.includes('investments'), 'US banks, with investments', c);
}

section('A country that is not switched on cannot sneak in from the page');
{
  const env = mkEnv(); const tok = await signIn(env); linkCalls = [];
  await call(env, '/v1/finance/link/start', { country: 'ES' }, tok, 'ES');
  const c = linkCalls[0] || {};
  ok(JSON.stringify(c.country_codes) === '["US"]', 'Spain not approved: the page asking for it gets the US, never an unapproved market', c.country_codes);
}

section('The page is told the truth about where a bank can be linked');
{
  const on = mkEnv({ FINANCE_COUNTRIES: 'US,ES' }), off = mkEnv();
  const es = await (await call(on, '/v1/everyday?country=ES')).json();
  const esOff = await (await call(off, '/v1/everyday?country=ES')).json();
  const cn = await (await call(on, '/v1/everyday?country=CN')).json();
  const br = await (await call(on, '/v1/everyday?country=BR')).json();
  ok(es.bank === true && esOff.bank === false, 'Spain says yes only when Spain is switched on', { on: es.bank, off: esOff.bank });
  ok(cn.bank === false && !cn.bankElsewhere, 'China: no, and no provider pretended', { bank: cn.bank, elsewhere: cn.bankElsewhere });
  ok(br.bank === false && /Open Finance Brasil/.test(br.bankElsewhere), 'Brazil: not yet, and what it would take', br.bankElsewhere);
  ok(es.classroom === false && (await (await call(on, '/v1/everyday?country=US')).json()).classroom === true, 'and school runs on Google Classroom in the US, not in Spain', true);
}

report();
done();
