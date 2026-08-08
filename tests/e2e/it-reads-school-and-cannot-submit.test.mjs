/* AMV CAN SEE WHAT IS DUE. IT CANNOT HAND ANYTHING IN.

   Reading a student's coursework is the difference between a planner they have
   to maintain and one that maintains itself. It is also a minor's school
   record, which makes the interesting question not "does it work" but "what
   exactly did AMV ask permission to do".

   The answer has to be visible in the SCOPES, not in a prompt. A rule saying
   "never submit" is a sentence a model can be argued out of by a page it read
   or a person insisting. A token that was never granted the submit permission
   cannot submit, whatever anybody types - Google refuses the call. That is the
   only version of this guarantee worth having, and it is the one thing here
   that a reviewer, a parent or a school district can check for themselves.

   So these cases are mostly about what AMV asked for, what it does with what
   comes back, and what it refuses to invent when the answer is empty. */
import { bootLive, makeEnv, makeOutbound } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));
outbound.on(/model\.example/, () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 5 } }));

const env = makeEnv({ APP_URL: 'http://localhost:9191', AMV_MODEL_KEY: 'k', MODEL_API_URL: 'https://model.example' });
const L = await bootLive({ env, outbound, port: 9191 });
const { page } = L;

section('AMV asks to READ school work, and never to submit it');
{
  /* Checked against the shipped bundle, because this is the promise. The
     read-only scopes end in .readonly; the ones that can turn work in do not,
     and their absence is what makes "it cannot submit" true. */
  const app = readFileSync('app.js', 'utf8');
  /* Only what is REQUESTED - the scope URLs. Matching every occurrence of
     "classroom." also picks up the API hostname and the comment naming the
     permission that is deliberately not asked for, and then reports a correct
     implementation as unsafe. A check that cannot tell a scope from a sentence
     about a scope will block the right answer. */
  const scopes = [...new Set(app.match(/auth\/classroom\.[a-z.]+/g) || [])];
  ok(scopes.length > 0, 'Classroom access is requested at all', scopes);
  ok(scopes.every(s => s.endsWith('.readonly')),
     'and every Classroom scope requested is read-only', scopes);

  /* The specific permissions that would let it hand work in. Their absence is
     not a detail - it is the entire safety argument. */
  const submitScopes = scopes.filter(s => !s.endsWith('.readonly'));
  ok(submitScopes.length === 0,
     'and no scope that could turn work in is requested anywhere', submitScopes);
  ok(!scopes.some(s => /coursework\.students/.test(s)),
     'nor any scope that reads OTHER students’ work', scopes);
}

section('It reads real coursework and reports what is actually there');
{
  const r = await page.evaluate(async () => {
    /* Stand in for Google, so the reader is exercised against the shapes the
       API really returns - including a piece with no due date, which is common
       and is where an invented deadline would come from. */
    window.getGToken = () => 'g-token';
    window.ensureGToken = async () => 'g-token';
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/classroom\.googleapis\.com\/v1\/courses\?/.test(u))
        return { ok: true, json: async () => ({ courses: [{ id: 'c1', name: 'History' }, { id: 'c2', name: 'Chemistry' }] }) };
      if (/courses\/c1\/courseWork/.test(u))
        return { ok: true, json: async () => ({ courseWork: [
          { title: 'Essay: the revolution', maxPoints: 40, dueDate: { year: 2099, month: 3, day: 14 }, dueTime: { hours: 23, minutes: 59 }, alternateLink: 'https://classroom/x' },
          { title: 'Reading, no deadline', maxPoints: 5 },
        ] }) };
      if (/courses\/c2\/courseWork/.test(u))
        return { ok: true, json: async () => ({ courseWork: [
          { title: 'Problem set 4', maxPoints: 20, dueDate: { year: 2099, month: 3, day: 12 } },
          { title: 'Last term, long gone', maxPoints: 10, dueDate: { year: 2001, month: 1, day: 5 } },
        ] }) };
      return real(url, opts);
    };
    const out = await INTEGRATION_ACTIONS.classroom_due.run();
    window.fetch = real;
    return out;
  });

  ok(r.courses === 2, 'it read both classes', r.courses);
  const titles = r.items.map(i => i.title);
  ok(titles.includes('Essay: the revolution') && titles.includes('Problem set 4'),
     'and the work that is still ahead of them', titles);
  ok(!titles.some(t => /Last term/.test(t)),
     'while last term’s work is left out, because a planner full of it goes unread', titles);
  ok(r.items[0].title === 'Problem set 4', 'soonest first', r.items.map(i => i.dueText));

  /* The piece with no deadline is real and must not be given an invented one. */
  const none = r.items.find(i => /no deadline/.test(i.title));
  ok(!!none && none.due === null && /no due date/i.test(none.dueText),
     'a piece with no due date says so rather than being given one', none && none.dueText);
  ok(r.items.every(i => i.due === null || typeof i.due === 'number'),
     'and every date that exists is a real date', true);
}

section('The job that uses it is honest about where it runs');
{
  /* The Google token lives in this browser and the server never sees it, so a
     job built on Classroom runs while AMV is open. Saying otherwise would
     promise an overnight run that cannot happen. */
  const r = await page.evaluate(() => {
    const j = _cwJobs().find(x => x.id === 'school_auto');
    return j ? { needs: j.needs, unattended: _cwRunsUnattended(j), where: _cwWhereLabel(j),
                 prompt: j.prompt, sample: (j.sample || []).join(' ') } : null;
  });
  ok(!!r, 'the job exists', !!r);
  ok(r.needs === 'Classroom', 'it declares what it needs', r.needs);
  ok(r.unattended === false, 'and does NOT claim to run with AMV closed', r.unattended);
  ok(/open/i.test(r.where), 'saying so on the card', r.where);
}

section('And says plainly that it cannot hand anything in');
{
  const r = await page.evaluate(() => {
    const j = _cwJobs().find(x => x.id === 'school_auto');
    return { prompt: j.prompt, sample: (j.sample || []).join(' ') };
  });
  ok(/cannot submit/i.test(r.prompt), 'the instruction says it outright', true);
  ok(/never invent a piece of work or a due date/i.test(r.prompt),
     'and forbids inventing work, which is the other way this goes wrong', true);
  ok(/cannot submit|not able to/i.test(r.sample),
     'and the example the person reads before switching it on says it too', r.sample.slice(-90));
}

section('With nothing connected it refuses rather than pretending');
{
  const r = await page.evaluate(async () => {
    window.getGToken = () => null;
    window.ensureGToken = async () => null;
    try { await INTEGRATION_ACTIONS.classroom_due.run(); return { threw: false }; }
    catch (e) { return { threw: true, msg: String(e.message || e) }; }
  });
  ok(r.threw, 'it fails rather than returning an empty plan', r);
  ok(/not connected/i.test(r.msg), 'and names the reason', r.msg);
}

section('A student with no Classroom at all gets nothing invented');
{
  const r = await page.evaluate(async () => {
    window.getGToken = () => 'g-token';
    window.ensureGToken = async () => 'g-token';
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      if (/classroom\.googleapis\.com/.test(String(url))) return { ok: true, json: async () => ({ courses: [] }) };
      return real(url, opts);
    };
    const out = await INTEGRATION_ACTIONS.classroom_due.run();
    window.fetch = real;
    return out;
  });
  ok(r.courses === 0 && r.items.length === 0,
     'no classes means no work, rather than a plausible-looking week', r);
}

section('And a Classroom that errors is reported, not guessed around');
{
  const r = await page.evaluate(async () => {
    window.getGToken = () => 'g-token';
    window.ensureGToken = async () => 'g-token';
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      if (/classroom\.googleapis\.com/.test(String(url)))
        return { ok: false, json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }) };
      return real(url, opts);
    };
    let out;
    try { await INTEGRATION_ACTIONS.classroom_due.run(); out = { threw: false }; }
    catch (e) { out = { threw: true, msg: String(e.message || e) }; }
    window.fetch = real;
    return out;
  });
  ok(r.threw, 'the failure surfaces', r);
  ok(/scope/i.test(r.msg), 'carrying what Google actually said', r.msg);
}

section('Nothing broke');
{
  ok(L.errors.length === 0, 'no JavaScript errors', L.errors.slice(0, 4));
}

await L.close();
outbound.restore();
if (report('it-reads-school-and-cannot-submit') > 0) process.exitCode = 1;
done();
