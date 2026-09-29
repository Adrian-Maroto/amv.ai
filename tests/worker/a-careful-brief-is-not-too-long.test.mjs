/* A CAREFUL BRIEF IS NOT "DETAIL TOO LONG".

   A running job's instructions were capped at 2,000 characters - about 350
   words - on create and on edit, and the refusal said "detail too long" and
   nothing else. A careful brief ("check these six sites, ignore these, lay it
   out like this") did not fit, and the person was not told why or where long
   material could go instead.

   The bound stays, because a job re-reads its instructions on every run. It
   is 8,000 now, both doors enforce the same number, and the refusal says why
   and what to do. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'crewbrief.harness.mjs');
writeFileSync(harness, src + `
export { autoCreate, autoUpdate, CREW_DETAIL_MAX };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const ME = 'owner@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
W.__setRequireUser(async () => ({ email: ME, plan: 'ultra' }));

/* A real brief, not filler: sentences a person writes, repeated to length. */
const brief = (n) => {
  const s = 'Check the council planning portal and the two local papers for anything on the Elm Street site. Ignore the sports pages. ';
  return s.repeat(Math.ceil(n / s.length)).slice(0, n);
};
const create = async (detail) => {
  const res = await W.autoCreate(new Request('https://x/v1/auto/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detail, repeat: 'daily', kind: 'task', approval: 'require', notify: 'app' }),
  }), env);
  return { status: res.status, d: await res.json().catch(() => ({})) };
};

section('A brief of a page and more is accepted');
{
  ok(W.CREW_DETAIL_MAX >= 8000, 'the bound is at least 8,000 characters', W.CREW_DETAIL_MAX);
  const r = await create(brief(5000));
  ok(r.status === 200 && r.d.item && r.d.item.detail.length === 5000,
     'a 5,000-character brief is stored whole', { status: r.status, len: r.d.item && r.d.item.detail.length, err: r.d.error });
}

section('Past the bound, the refusal says why and what to do');
{
  const r = await create(brief(W.CREW_DETAIL_MAX + 1));
  ok(r.status === 400 && r.d.code === 'detail_too_long', 'it is refused with a code a page can act on', r);
  ok(/re-reads them every time it runs/.test(r.d.error || '') && /chat/.test(r.d.error || ''),
     'and the message gives the reason and where long material goes', r.d.error);
  ok(r.d.limit === W.CREW_DETAIL_MAX, 'and states the limit', r.d.limit);
}

section('Editing enforces the same number as creating');
{
  store.clear();
  const made = await create('Summarise the planning notices');
  const id = made.d.item && made.d.item.id;
  const edit = async (detail) => {
    const res = await W.autoUpdate(new Request('https://x/v1/auto/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'edit', detail }),
    }), env);
    return { status: res.status, d: await res.json().catch(() => ({})) };
  };
  const fine = await edit(brief(6000));
  ok(fine.status === 200, 'a 6,000-character edit is accepted', { status: fine.status, err: fine.d.error });
  const over = await edit(brief(W.CREW_DETAIL_MAX + 1));
  ok(over.status === 400 && over.d.code === 'detail_too_long', 'and one past the bound is refused the same way', over);
}

if (report('a-careful-brief-is-not-too-long') > 0) process.exitCode = 1;
done();
