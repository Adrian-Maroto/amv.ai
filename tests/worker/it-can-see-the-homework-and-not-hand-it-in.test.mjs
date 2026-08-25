/* A MINOR'S SCHOOL RECORD, AND THE NARROWEST ACCESS THAT DOES THE JOB.

   The school job reads what a student has been set and when it is due, and
   plans their week around it. That is the difference between a planner somebody
   maintains and one that maintains itself, and it is also the most sensitive
   thing AMV reads.

   The safety argument is not a rule in a prompt. It is a permission that was
   never granted: classroom.coursework.me WITHOUT .readonly is what would let
   AMV turn work in, it is never requested, and Google refuses the call. A rule
   can be argued with by anything that gets text in front of a model. A scope
   that does not exist cannot.

   Three things were wrong before this, and each was invisible on its own:

     - the only place those scopes were EVER requested was connectGoogle, which
       nothing calls, so the reader got a 403 from Google every time
     - the Crew job says needs:'Classroom' and the table mapping a need to a
       capability had no row for it, so the job asked the server for nothing and
       planned a week from an empty page
     - whether Classroom was available was answered by "is somebody signed in
       with Google", which is a different question. A student who had only ever
       pressed Sign in with Google was told it was ready.

   Correct in three places, joined in none. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const client = readFileSync(join(ROOT, 'app.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'school.harness.mjs');
writeFileSync(harness, src +
  '\nexport { CONN_PROVIDERS, AUTO_USES_ALLOWED, _fetchClassroom, _autoAccountContext, DB, CONN_KV, connSeal };\n');
const W = await import(harness + '?t=' + Date.now());

section('AMV asks to read school work, and never to hand it in');
{
  const g = W.CONN_PROVIDERS.google.scopes;
  ok(!!g['school.read'], 'the school capability is offered by the provider AMV actually uses', Object.keys(g));

  const asked = g['school.read'].split(/\s+/).filter(Boolean);
  ok(asked.length === 2, 'it is two scopes, not a bundle', asked);
  ok(asked.every(s => s.endsWith('.readonly')),
     'and every one of them is read-only', asked);

  /* THE SPECIFIC PERMISSION THAT WOULD LET IT SUBMIT. Its absence is the whole
     argument, so it is named rather than covered by "they all end in
     .readonly" - a future scope called something else could pass that and still
     be able to turn work in. */
  const all = Object.values(g).join(' ');
  ok(!/classroom\.coursework\.me(?!\.readonly)/.test(all),
     'the scope that could turn work in is requested nowhere', true);
  ok(!/coursework\.students/.test(all),
     'nor any scope that reads OTHER students’ work', true);
  ok(!/classroom\.[a-z.]*(?<!readonly)\b(?:rosters|profile|announcements)\b/.test(all),
     'nor the class roster or anybody’s profile', true);
}

section('A job can actually ask for it');
{
  /* The capability existing and a job being able to request it are two
     different things, and the gap between them is where this feature lived. */
  ok(W.AUTO_USES_ALLOWED.indexOf('school.read') >= 0,
     'school.read is a capability a scheduled job may declare', W.AUTO_USES_ALLOWED);

  /* Anchored on the DECLARATION. indexOf finds the first mention, which is the
     function that reads the table forty lines earlier - so the first version of
     this sliced the reader and reported a correct table as missing. */
  const at = client.indexOf('_CW_NEEDS_TO_USES=') >= 0
    ? client.indexOf('_CW_NEEDS_TO_USES=')
    : client.indexOf('_CW_NEEDS_TO_USES =');
  ok(at > 0, 'the needs table was found', at);
  /* To the table's own closing brace, not a fixed number of characters. A width
     is a guess about how long the table is, and it drifted past the row the
     moment a comment was written above it - reporting a correct table as
     missing, which is a check people learn to edit rather than believe. */
  const map = client.slice(at, client.indexOf('};', at) + 2);
  ok(/Classroom/.test(map), 'and it was read in full', map.length);
  ok(/Classroom'?\s*:\s*'school\.read'/.test(map) || /Classroom"?\s*:\s*"school\.read"/.test(map),
     'and the job that says needs:Classroom maps to it', map.slice(0, 120));
}

section('It reads real coursework, on the server, with the tab closed');
{
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    asked.push({ u, auth: (init && init.headers && init.headers.Authorization) || '' });
    if (/\/v1\/courses\?/.test(u)) {
      return { ok: true, status: 200, json: async () => ({ courses: [
        { id: 'c1', name: 'History' }, { id: 'c2', name: 'Chemistry' }] }) };
    }
    if (/courses\/c1\/courseWork/.test(u)) {
      return { ok: true, status: 200, json: async () => ({ courseWork: [
        { title: 'Essay: the revolution', maxPoints: 40,
          dueDate: { year: 2099, month: 3, day: 14 }, dueTime: { hours: 23, minutes: 59 } },
        /* Real and common: a piece with no deadline. An invented one is worse
           than none, because somebody plans around it. */
        { title: 'Reading, no deadline', maxPoints: 5 },
      ] }) };
    }
    /* Chemistry refuses. This is the case the whole function is shaped around. */
    if (/courses\/c2\/courseWork/.test(u)) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const sc = await W._fetchClassroom('a-token');
  globalThis.fetch = realFetch;

  ok(sc.items.length === 2, 'the work that could be read is returned', sc.items.map(i => i.title));
  ok(sc.items[0].title === 'Essay: the revolution', 'soonest deadline first', sc.items[0].title);
  ok(/^2099-03-14T23:59/.test(sc.items[0].due), 'with the date and time Google sent, combined correctly', sc.items[0].due);
  ok(sc.items[1].due === '', 'and a piece with no deadline is reported as having none, not given one', sc.items[1].due);

  /* THE ASSERTION THIS EXISTS FOR. A class that failed to load is not a class
     with nothing due. Swallowing it turns "Chemistry did not load" into
     "Chemistry has nothing due" on the screen somebody plans their week from -
     they miss the deadline, and AMV told them confidently there was not one. */
  ok(sc.unread.length === 1 && sc.unread[0] === 'Chemistry',
     'and a class that could not be read is NAMED, not silently dropped', sc.unread);

  ok(asked.every(a => /^Bearer /.test(a.auth)), 'every call carried the grant', asked.length);
  ok(asked.every(a => /^https:\/\/classroom\.googleapis\.com\//.test(a.u)),
     'and went to Google and nowhere else', asked.map(a => a.u.slice(0, 40)));
}

section('What the model is handed says what it could not see');
{
  /* A model given a partial list with no sign that it is partial will summarise
     it as the whole week. So the unreadable classes go INTO the context, not
     into a log the model cannot read. */
  const ctx = codeOnly(functionBody(src, '_autoAccountContext'));
  ok(/need === 'school\.read'/.test(ctx), 'the school capability is handled', true);
  ok(/_fetchClassroom\(got\.token\)/.test(ctx), 'by reading it with the grant', true);
  ok(/COULD NOT READ/.test(ctx), 'and the classes that failed are named in the context', true);
  ok(/read-only - you cannot turn anything in/.test(ctx),
     'with the model told plainly what it cannot do, so it does not offer to', true);
  ok(/NO DUE DATE GIVEN/.test(ctx),
     'and a missing deadline is stated rather than left blank for the model to fill in', true);
}

section('Being signed in with Google is not having granted this');
{
  /* The question "is Classroom available" was answered by "is somebody signed
     in with Google". Those are different questions and one was standing in for
     the other, which is the same defect the Integrations row had. */
  /* The CW_NEEDS_CHECK row, not the job that names Classroom in its `needs`
     string hundreds of lines earlier. Anchored on the label that only the row
     carries. */
  const cAt = client.indexOf('Google Classroom\', has:');
  const cAt2 = cAt > 0 ? cAt : client.indexOf('Google Classroom');
  ok(cAt2 > 0, 'the availability row was found', cAt2);
  const check = client.slice(Math.max(0, cAt2 - 60), cAt2 + 200);
  ok(/_cwConnHas\(['"]school\.read['"]\)/.test(check),
     'availability is asked of the connection', check.slice(0, 140));
  ok(!/_cwHasGoogle\(\)/.test(check.slice(0, 200)),
     'and not of the sign-in', check.slice(0, 140));
}

if (report('it-can-see-the-homework-and-not-hand-it-in') > 0) process.exitCode = 1;
done();
