/* THE API SAYS WHICH VERSION IT IS (Nov 1 audit PROD-015).

   docs/API-VERSIONS.md is the policy. Through the real router:
     - every /v1/ answer names the version that served it, and a browser may
       read it (exposed by CORS) and send it (allowed by CORS);
     - a version AMV does not know is refused before anything runs;
     - a deprecated version works, says Deprecation and Sunset, and is
       counted; after its sunset it is refused with 410, naming the current;
     - the SDK and the command-line tool send the version they were written for;
     - the table in the doc is the table in the code. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'apiver.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { API_VERSIONS, _apiVersionOf, _withApiVersion };\n');
const W = await import(harness + '?t=' + Date.now());

const m = new Map();
const env = { JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test', ALLOWED_ORIGIN: 'https://amv.test',
  AMV_KV: { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix } = {}) { return { keys: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = (path, headers) => W.default.fetch(new Request('https://api.amv.test' + path, { headers: Object.assign({ Origin: 'https://amv.test', 'CF-Connecting-IP': '7.7.7.7' }, headers || {}) }), env, ctx);
const current = Object.keys(W.API_VERSIONS).find(k => W.API_VERSIONS[k].status === 'current');

section('Every /v1/ answer names its version');
{
  ok(/^\d{4}-\d{2}-\d{2}$/.test(current || ''), 'there is one current version, dated', current);
  const r = await get('/v1/health');
  ok(r.headers.get('AMV-API-Version') === current, 'an answer carries it', r.headers.get('AMV-API-Version'));
  const named = await get('/v1/health', { 'AMV-API-Version': current });
  ok(named.status === r.status && named.headers.get('AMV-API-Version') === current, 'naming the current one changes nothing', named.status);
  const pre = await W.default.fetch(new Request('https://api.amv.test/v1/messages', { method: 'OPTIONS', headers: { Origin: 'https://amv.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'amv-api-version' } }), env, ctx);
  ok(/AMV-API-Version/i.test(pre.headers.get('Access-Control-Allow-Headers') || ''), 'a browser may send the header', pre.headers.get('Access-Control-Allow-Headers'));
  ok(!(await get('/health')).headers.get('AMV-API-Version'), 'and a route outside /v1/ is not versioned');
}

section('An unknown version is refused before anything runs');
{
  const r = await get('/v1/engines', { 'AMV-API-Version': '2019-01-01' });
  const d = await r.json();
  ok(r.status === 400 && d.code === 'api_version_unknown' && d.current === current, 'refused with 400, naming the current version', [r.status, d]);
}

section('Deprecated: it works and says when it ends; retired: 410');
{
  const table = { '2026-01-01': { status: 'deprecated', sunset: '2027-06-01' }, [current]: { status: 'current' } };
  const req = new Request('https://api.amv.test/v1/engines', { headers: { 'AMV-API-Version': '2026-01-01' } });
  const v = W._apiVersionOf(req, table, Date.parse('2026-12-01'));
  ok(!v.refuse && v.deprecated && v.version === '2026-01-01', 'before the sunset it is served', v);
  const res = W._withApiVersion(new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*' } }), v);
  ok(res.headers.get('Deprecation') === 'true' && /2027/.test(res.headers.get('Sunset') || '') && /Sunset/.test(res.headers.get('Access-Control-Expose-Headers') || ''),
    'and says so on the answer, readable by a browser', [res.headers.get('Deprecation'), res.headers.get('Sunset')]);
  const after = W._apiVersionOf(req, table, Date.parse('2027-06-02'));
  ok(after.refuse && after.refuse.status === 410 && after.refuse.body.code === 'api_version_retired' && after.refuse.body.current === current, 'after it, 410 and the version to use', after.refuse);
  ok(/apiver:' \+ ver\.version/.test(readFileSync(join(ROOT, 'amv-backend.js'), 'utf8')), 'each deprecated use is counted per month for the owner');
}

section('The SDK and the command-line tool send the version they were written for');
{
  const sdk = readFileSync(join(ROOT, 'sdk', 'amv-sdk.mjs'), 'utf8'), cli = readFileSync(join(ROOT, 'cli', 'amv-cli.mjs'), 'utf8');
  ok(new RegExp("API_VERSION = '" + current + "'").test(sdk) && /'AMV-API-Version': API_VERSION/.test(sdk), 'the SDK', true);
  const cliCalls = (cli.match(/'Authorization': 'Bearer ' \+ key/g) || []).length;
  ok(new RegExp("API_VERSION = '" + current + "'").test(cli) && (cli.match(/'AMV-API-Version': API_VERSION/g) || []).length === cliCalls, 'and every request the command-line tool makes', cliCalls);
}

section('The policy page and the code list the same versions');
{
  const doc = readFileSync(join(ROOT, 'docs', 'API-VERSIONS.md'), 'utf8');
  for (const [k, v] of Object.entries(W.API_VERSIONS)) ok(new RegExp('`' + k + '` \\| ' + v.status).test(doc), k + ' is ' + v.status + ' in both', k);
}

if (report('the-api-says-which-version-it-is') > 0) process.exitCode = 1;
done();
