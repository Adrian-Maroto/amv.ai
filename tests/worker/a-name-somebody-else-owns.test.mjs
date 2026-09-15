/* TWO GUARDS THAT WERE REAL AND THAT NOTHING WOULD HAVE MISSED.

   Found by breaking them: each was deleted from the Worker and all 87 Worker
   suites still passed, so the code was right and the OUTCOME was unheld.

   The site one needs stating precisely, because the first reading of it was too
   strong. It is defended TWICE - once where the slug is claimed and once inside
   the write - so removing either alone changes nothing a caller can see, which
   is defence in depth working. Removing BOTH also changed nothing any suite
   said, and that is the real gap: the control could be refactored away
   completely and every signal would stay green. This holds the outcome rather
   than either line, so it fails when the guarantee goes, not when somebody
   moves an `if`.

   THE FIRST is the one that decides whether you can publish onto a name
   somebody else already owns. AMV hosts real pages at real URLs, so that check
   is the whole difference between "publish my app" and "replace theirs". This
   codebase has already paid once for the neighbouring version of it - a deploy
   slug that survived a sign-out and let the next account publish over somebody
   else's site - and that is the lesson the reset check exists for. The same
   outcome is reachable straight through the API by naming the slug.

   THE SECOND is the address a handoff is sent to. It is checked against a
   pattern before anything is sent, and the comment beside it says why in one
   line: recipients nobody chose. An address is interpolated into a mail
   envelope, so a newline or a colon in it is not a malformed address, it is a
   second header - and the bound on what may appear there is the thing standing
   between a handoff and mail addressed somewhere its author never wrote.

   Neither test asserts a line of source exists. Both call the real handler and
   read the real answer, because a test that greps for an `if` passes on an `if`
   that has stopped doing anything. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'ownname.harness.mjs');
writeFileSync(harness, src + `
export { DB, deploySite, SLUG_RE, HANDOFF_TO_RE };
export function __setRequireUser(fn){ requireUser = fn; }
`);
const W = await import(harness + '?t=' + Date.now());

const MINE   = 'me@test.com';
const THEIRS = 'them@test.com';
const store = new Map();
const env = { JWT_SECRET: 'a-long-random-secret-at-least-32-chars-xx', AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };

const asUser = (email, plan = 'ultra') => W.__setRequireUser(async () => ({ email, plan }));
const deploy = async (slug) => {
  const res = await W.deploySite(new Request('https://x/v1/deploy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: '<h1>hello</h1>', title: 'App', slug }),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

section('A site name belongs to the account that took it');
{
  asUser(THEIRS);
  const first = await deploy('shared-name');
  ok(first.status === 200, 'the first account publishes to the name it chose', first);

  const held = await W.DB.get(env, 'site', 'shared-name');
  ok(held && String(held.owner).toLowerCase() === THEIRS,
     'and the record says who owns it', held && held.owner);

  /* THE ATTACK, and it is one request. A second paying account names the slug
     the first one is live on. If this is allowed, their URL now serves my
     page - the visitors are theirs and the content is mine. */
  asUser(MINE);
  const takeover = await deploy('shared-name');
  ok(takeover.status === 409,
     'a second account naming it is refused, not served', takeover);

  const after = await W.DB.get(env, 'site', 'shared-name');
  ok(after && String(after.owner).toLowerCase() === THEIRS,
     'and the site still belongs to the account that had it', after && after.owner);
  ok(!(after && String(after.html || '').includes('hello') && String(after.owner).toLowerCase() === MINE),
     'their page was not replaced by mine', after && after.owner);
}

section('And the owner can still publish over their own');
{
  /* The refusal has to be about WHOSE it is, not about the name existing -
     otherwise nobody could ever update their own site, which is the obvious
     way to get this wrong in the other direction. */
  asUser(THEIRS);
  const again = await deploy('shared-name');
  ok(again.status === 200, 'updating your own site is not a collision', again);
}

section('A handoff goes to an address, not to whatever was typed');
{
  /* THE WORKER'S OWN PATTERN, not a copy of it. The first version of this test
     wrote the regex out again, which would have gone on passing after the real
     one was deleted - a test of a constant I had typed. It was two copies in
     the Worker as well; it is named once there now and imported here, so this
     holds the thing that actually runs. */
  const RE = W.HANDOFF_TO_RE;
  const good = ['a@b.co', 'first.last@sub.domain.org'];
  const bad = [
    'not-an-address',
    'a@b',                                    // no public suffix
    'a@b.c',                                  // too short to be one
    'a b@c.com',                              // a space
    'a@b.com\nBcc: everyone@elsewhere.com',   // the header injection
    'a@b.com\r\nBcc: everyone@elsewhere.com',
    'a:b@c.com',                              // a colon, which a header uses
    '',
  ];
  for (const g of good) ok(RE.test(g), 'a real address is accepted: ' + g);
  for (const b of bad)
    ok(!RE.test(b), 'refused: ' + JSON.stringify(b).slice(0, 46));
}

report();
done();
