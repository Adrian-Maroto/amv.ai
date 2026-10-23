/* THE GOOGLE FILE PICKER GETS ITS PUBLIC VALUES - AND NOTHING ELSE.

   Picking a file from Google Drive runs Google's own picker in the page, and
   it needs three values the deployment holds: the OAuth client id, a picker
   API key and the project number. Those are public by design (Google issues
   the picker key for browsers), but they are still handed out by a route,
   and the coverage report found no suite had ever called it.

   So: only to a signed-in person; "not set up" when any of the three is
   missing or the project number is not a number; and never the client
   SECRET, which sits in the same environment one name away. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'picker.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const base = { JWT_SECRET: 'j'.repeat(40), APP_URL: 'https://amv.test',
  AMV_KV: { async get(k){ return store.has(k) ? store.get(k) : null; }, async put(k, v){ store.set(k, v); }, async delete(k){ store.delete(k); },
    async list({ prefix } = {}){ return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } } };
const pair = await W.issueTokens(base, 'pick@example.com', 'Pick');
const get = async (env, tok) => { const r = await W.default.fetch(new Request('https://api.amv.test/v1/google/picker', { method: 'GET',
  headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'CF-Connecting-IP': '4.4.4.4' } }), env, { waitUntil(){}, passThroughOnException(){} });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const full = { ...base, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-never-leaves', GOOGLE_PICKER_API_KEY: 'AIzaPickerKey', GOOGLE_PROJECT_NUMBER: '123456789012' };

section('Only to somebody signed in');
ok((await get(full)).status === 401, 'signed out, nothing', true);

section('Set up: the three public values, and never the secret');
{
  const r = await get(full, pair.token);
  ok(r.status === 200 && r.d.configured === true && r.d.clientId === full.GOOGLE_CLIENT_ID && r.d.apiKey === full.GOOGLE_PICKER_API_KEY && r.d.appId === '123456789012', 'client id, picker key and project number', r.d);
  ok(!JSON.stringify(r.d).includes('GOCSPX'), 'and not the client secret beside them in the environment', true);
}

section('Not set up says so rather than handing out half of it');
for (const [why, env] of [['no picker key', { ...full, GOOGLE_PICKER_API_KEY: '' }], ['no client id', { ...full, GOOGLE_CLIENT_ID: '' }],
                          ['a project number that is not a number', { ...full, GOOGLE_PROJECT_NUMBER: 'my-project' }]]) {
  const r = await get(env, pair.token);
  ok(r.status === 200 && r.d.configured === false && !r.d.apiKey && !r.d.clientId, why + ': not set up, and nothing given', r.d);
}

if (report('the-file-picker-gets-only-public-values') > 0) process.exitCode = 1;
done();
