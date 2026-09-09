/* THE SAME CARD, BUILT IN TWO PLACES, DRIFTED.

   "Your running job prepared something, approve it" is built twice: by
   `_enqueueApproval` on the server, when the cron ran while nobody was
   looking, and by `_recurMakeApproval` on the client, when AMV happened to be
   open at the moment the job came due.

   They had diverged in opposite directions. The client one carried who it goes
   to, how many, and which job it came from. The server one carried the
   deadline and whether it can be taken back. So the card was poorer on
   whichever path you happened to get - and the server path is the one that
   matters, because a run you were not present for is the entire point of
   autonomy.

   A card is only as honest as the poorer of the two builders that can create
   it. This suite compares them field by field, because two builders of one
   thing drift the moment somebody adds a field to whichever file they had
   open - which is exactly how they got here. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'src', 'app', '16-palette-sched.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'twobuilders.harness.mjs');
writeFileSync(harness, src + `
export { _enqueueApproval, _autoScheduleLabel };
`);
const W = await import(harness + '?t=' + Date.now());

const EMAIL = 'owner@test.com';
const store = new Map();
const env = { AMV_KV: {
  async get(k){ return store.has(k) ? store.get(k) : null; },
  async put(k, v){ store.set(k, v); },
  async delete(k){ store.delete(k); },
  async list({ prefix }){ return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
} };
const build = async (item) => {
  store.clear();
  await W._enqueueApproval(env, EMAIL, item, 'the finished text');
  return JSON.parse(store.get('approvals:' + EMAIL)).items[0];
};

section('The server-made card says who it goes to');
{
  const it = await build({ id: 'j7', kind: 'task', detail: 'weekly note', notify: 'email', repeat: 'weekly' });
  /* Not a guess and it cannot be one: `_autoEmailResult` takes the address
     from the ACCOUNT, so an autonomous send reaches the owner and nobody
     else. Saying so is the answer to the question somebody actually has when
     a machine offers to send something for them. */
  ok(it.destination === EMAIL, 'and the answer is: you', it);
  ok(it.recipients === 1, 'exactly one person, stated rather than left blank', it);
}

section('A result nobody sends has nobody to send it to');
{
  const it = await build({ id: 'j8', kind: 'task', detail: 'a draft', notify: 'app' });
  ok(!it.destination, 'no destination is invented for something that stays in the app', it);
  ok(it.recipients === null,
     'and the count is null rather than 0 - "nobody" and "not applicable" are different answers', it);
}

section('It says which job made it, and how often that job runs');
{
  const it = await build({ id: 'j9', kind: 'task', detail: 'd', notify: 'app', repeat: 'daily' });
  ok(it.fromJob === 'j9', 'the job is named, so the card can offer to stop it', it);
  ok(it.jobSchedule === 'daily', 'in the words the card shows', it);
}

section('The cadence is read from the record, not stored stale');
{
  ok(W._autoScheduleLabel({ repeat: 'weekly' }) === 'weekly', 'by name', true);
  ok(W._autoScheduleLabel({ interval: 3600e3 }) === 'hourly', 'or by interval when there is no name', true);
  ok(W._autoScheduleLabel({ repeat: '10min' }) === 'every 10 minutes',
     'and in words rather than a key nobody outside the code would recognise', true);
  ok(W._autoScheduleLabel({}) === '', 'and nothing when it genuinely is not known', true);
  ok(W._autoScheduleLabel({ interval: 12345 }) === '',
     'rather than an interval invented from an unrecognised number', true);
}

section('Both builders write the same fields');
{
  /* The guard that would have caught the original drift. Read from the SOURCE
     of each builder rather than from a list written here - a list here would
     be a third place to keep in step, and would go stale in exactly the way
     this suite exists to prevent. */
  const serverEntry = src.slice(src.indexOf('const entry = {'), src.indexOf('await _withKind(env, \'approvals\''));
  const clientStart = client.indexOf('const ap=_cwApprovals();');
  const clientEntry = client.slice(clientStart, client.indexOf('_cwSaveApprovals(ap);', clientStart));
  ok(serverEntry.length > 200 && clientEntry.length > 200, 'both builders were found to read',
     { server: serverEntry.length, client: clientEntry.length });

  /* Only the fields the CARD reads matter. Each builder may carry extras for
     its own path; what must not differ is anything the screen renders. */
  const shown = ['destination', 'recipients', 'fromJob', 'jobSchedule',
                 'expiresAt', 'reversible', 'readyAt', 'autoApprove', 'actionType', 'title'];
  const missingServer = shown.filter(f => serverEntry.indexOf(f) < 0);
  const missingClient = shown.filter(f => clientEntry.indexOf(f) < 0);
  ok(missingServer.length === 0,
     'the server builder sets every field the card shows', missingServer);
  ok(missingClient.length === 0,
     'and so does the client one - a card is only as honest as the poorer path', missingClient);
}

section('The one that can be undone is marked differently from the one that cannot');
{
  const sent = await build({ id: 'j1', kind: 'task', detail: 'd', notify: 'email' });
  const kept = await build({ id: 'j2', kind: 'task', detail: 'd', notify: 'app' });
  ok(sent.reversible === false && kept.reversible === true,
     'so the card stops describing a send and a draft in the same words',
     { sent: sent.reversible, kept: kept.reversible });
}

if (report('one-approval-two-builders') > 0) process.exitCode = 1;
done();
