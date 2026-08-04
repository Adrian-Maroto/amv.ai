/* ERASURE CAN ONLY DELETE A KEY SOMEBODY REMEMBERED TO NAME.

   Account deletion walks two hand-written lists: `perUserKinds` for the DB rows
   and a `loose` array for the raw KV keys that are not rows. Both are correct
   about what they contain. Neither has any way of knowing what they leave out,
   and a key that is not on either list is simply never looked at - so the
   record survives the person, silently, and the only way to find out is to go
   looking for it.

   Four were surviving when this was written:

   `resetcode:<email>` is a live password-reset credential. `smsverify:<email>:
   <phone>` is a live verification code with a phone number in the key itself.
   `resume:<email>:<id>` is the person's own model output, parked server-side.
   `waitlist:<product>:<email>` is somebody on a mailing list who asked to stop
   existing here.

   And one line was worse than missing: `reset:${email}` was ON the list and is
   not a key that is ever written - reset tokens are keyed by the TOKEN. It
   deleted nothing while reading exactly like coverage.

   So this is the exhaustive form used elsewhere in this suite. Every KV key
   namespace whose key contains a person's address is either erased, or named
   below as deliberately retained WITH the reason. There is no third state where
   nobody thought about it, and adding a new per-user key means adding a line
   here, which means somebody decided. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'erasure-coverage.harness.mjs');
writeFileSync(harness, src + `
export { authDeleteAccount, setEntitlement, issueTokens, DB };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

/* ── The computed half: which namespaces name a person, and which are erased ── */

/* A KV key template built from a variable that holds somebody's address. */
const KEYED_BY_PERSON = new Set();
const keyPat = /AMV_KV\.(?:put|get|delete)\(\s*[`']([a-z_]+):(?:\$\{|'\s*\+\s*)([^`')]{0,40})/g;
for (const m of src.matchAll(keyPat)) {
  const expr = m[2];
  if (/\bemail\b|\bem\b|user\.email|\btarget\b|\bbuyer\b|\bto\b/.test(expr)) KEYED_BY_PERSON.add(m[1]);
}

/* Brace-matched, because slicing to the next occurrence of some string ran the
   "erasure body" hundreds of lines past the end of the function and swept in
   deletes belonging to entirely different handlers - which then reported a key
   as erased that erasure never touches. */
function bodyOf(fnName){
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + fnName + '\\s*\\('));
  if(!m) return '';
  const i = src.indexOf('{', m.index + m[0].length);
  let d = 0;
  for(let j = i; j < src.length; j++){
    if(src[j] === '{') d++;
    else if(src[j] === '}'){ d--; if(d === 0) return src.slice(i, j + 1); }
  }
  return '';
}
const sliceBetween = (start, end) => {
  const i = src.indexOf(start);
  return i < 0 ? '' : src.slice(i, src.indexOf(end, i));
};
/* Comments out. The erasure function EXPLAINS the phantom key it used to
   carry, in backticks, and reading that as code reported the key as erased -
   a check that quotes a comment back at you as evidence is worse than none. */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, ' ');
const erasureBody = stripComments(bodyOf('authDeleteAccount'));
const looseBlock = sliceBetween('const loose = [', 'for (const raw of loose)');
/* The kinds list moved to module scope so the data export could be built from
   the same one erasure walks. */
const kindsBlock = sliceBetween('const PER_USER_KINDS = [', '];');

/* Everything the erasure path deletes, however it spells it: the loose array,
   the kinds array, and any prefix scan or explicit delete in the function. */
const ERASED = new Set([
  ...[...kindsBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]),
  /* Every key literal inside the erasure function. Enumerating the SHAPES it
     uses - an explicit delete, a list prefix, an array of prefixes - meant a
     namespace was reported unerased because the loop that erases it was
     written slightly differently from the ones before it. The function only
     names a key in order to remove it, so naming is the signal. */
  ...[...erasureBody.matchAll(/[`'"]([a-z_]+):/g)].map(m => m[1]),
]);

section('Both sides were actually read');
{
  ok(KEYED_BY_PERSON.size >= 10, 'KV namespaces keyed by a person', [...KEYED_BY_PERSON].sort());
  ok(ERASED.size >= 20, 'and what erasure deletes', ERASED.size);
}

section('Every key naming a person is erased, or retained for a stated reason');
{
  const RETAINED_ON_PURPOSE = {
    tokepoch:  'a bare revocation integer with no personal data; keeping it is what makes any token issued before deletion stay dead',
    billing:   'invoices and payment records carry retention obligations that erasure does not override - a legal call, not an engineering one',
    reset:     'keyed by the TOKEN, so no scan finds it from an address; authResetConfirm refuses a link older than the account it names instead',
    apikey:    'keyed by the hash, and deleted by walking the account\'s own apikeys row - which erasure does explicitly',
    entitleitem: 'an idempotency marker for a marketplace grant; erased with the kinds, and carries no content',
  };
  const missing = [...KEYED_BY_PERSON]
    .filter(k => !ERASED.has(k) && !(k in RETAINED_ON_PURPOSE))
    .sort();
  ok(missing.length === 0,
     'nothing about a deleted person is left because no list mentioned it', missing);

  /* And an excuse that has since stopped being true is itself a finding. */
  const nowErased = Object.keys(RETAINED_ON_PURPOSE).filter(k => ERASED.has(k) && k !== 'apikey' && k !== 'entitleitem');
  ok(nowErased.length === 0,
     'nothing excused as retained is quietly being deleted anyway', nowErased);
}

section('Every key erasure claims to delete is a key something writes');
{
  /* The failure that reads as coverage: `reset:${email}` sat on the list for a
     key shape nothing ever writes, so it deleted nothing while looking exactly
     like the lines around it that work. */
  /* Namespace alone is not enough to catch it: `reset:` IS a real namespace,
     written with a TOKEN. What was wrong was the shape - reset:<email> - so the
     comparison has to be on the namespace AND what fills it. Names that mean
     "the person" are treated as one thing, since the codebase spells it several
     ways. */
  const PERSON = /^(email|em|user\.email|target|buyer|to|acct\.email)$/;
  const shapes = new Set();          // "namespace|person" for every key CONSTRUCTED anywhere
  const collect = (re, region) => {
    for(const m of region.matchAll(re)){
      const who = m[2].trim();
      shapes.add(m[1] + '|' + (PERSON.test(who) ? 'person' : 'id'));
    }
  };
  /* Everything except the loose list itself, or the list would vouch for
     its own phantom. */
  const elsewhere = src.replace(looseBlock, '');
  collect(/[`'"]([a-z_]+):\$\{([^}]{1,30})\}/g, elsewhere);
  collect(/'([a-z_]+):'\s*\+\s*([A-Za-z_.$][\w.$]{0,29})/g, elsewhere);

  const dbKinds = new Set([...src.matchAll(/DB\.put\(\s*env\s*,\s*'([a-z_]+)'/g)].map(m => m[1]));
  const looseEntries = [...looseBlock.matchAll(/`([a-z_]+):\$\{([^}]{1,30})\}/g)]
    .map(m => ({ ns: m[1], who: m[2].trim() }));

  ok(looseEntries.length > 5, 'the loose list was parsed', looseEntries.map(e => e.ns));
  const phantom = looseEntries
    .filter(e => !dbKinds.has(e.ns))
    /* Person or opaque id, not the variable's name - `myCode` and `cand` are
       the same thing spelled twice, while `email` and `token` are not. The
       person/id distinction is the one that carried the defect. */
    .filter(e => !shapes.has(e.ns + '|' + (PERSON.test(e.who) ? 'person' : 'id')))
    .map(e => e.ns + ':' + e.who)
    .sort();
  ok(phantom.length === 0,
     'no line deletes a key nothing ever creates in that shape', phantom);
}

/* ── The behavioural half: it really removes them ── */

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix, cursor, limit }) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name }));
      return { keys, list_complete: true };
    },
  },
};
globalThis.fetch = async () => new Response('{}', { status: 200 });
W.__setRequireUser(async () => ({ email: 'gone@x.com', plan: 'free', customCfg: null }));

section('And in practice, the four that were surviving do not');
{
  await W.DB.put(env, 'acct', 'gone@x.com', { email: 'gone@x.com', name: 'Gone' });
  store.set('resetcode:gone@x.com', JSON.stringify({ code: '123456', attempts: 0 }));
  store.set('smsverify:gone@x.com:+15551234567', '998877');
  store.set('resume:gone@x.com:r_abc', 'the answer they paid for');
  store.set('waitlist:sms:gone@x.com', JSON.stringify({ email: 'gone@x.com' }));
  /* Somebody else's, to prove the scans are not indiscriminate. */
  store.set('resetcode:stays@x.com', JSON.stringify({ code: '654321' }));
  store.set('resume:stays@x.com:r_xyz', 'not theirs to delete');
  store.set('waitlist:sms:stays@x.com', JSON.stringify({ email: 'stays@x.com' }));

  const r = await W.authDeleteAccount(new Request('https://api.amv.dev/auth/delete', {
    method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }),
  }), env);
  ok(r.status === 200, 'the account was deleted', r.status);

  ok(!store.has('resetcode:gone@x.com'), 'the reset code is gone', store.has('resetcode:gone@x.com'));
  ok(!store.has('smsverify:gone@x.com:+15551234567'), 'and the SMS code, and the number in its key', true);
  ok(!store.has('resume:gone@x.com:r_abc'), 'and the parked answer', true);
  ok(!store.has('waitlist:sms:gone@x.com'), 'and the mailing list row', true);
}

section('Without touching anybody else');
{
  ok(store.has('resetcode:stays@x.com'), 'another account keeps its reset code', true);
  ok(store.has('resume:stays@x.com:r_xyz'), 'and its parked answers', true);
  ok(store.has('waitlist:sms:stays@x.com'), 'and its place on the list', true);
}

if (report('erasure-covers-every-key') > 0) process.exitCode = 1;
done();
