/* THE SLOWEST SCHOOL IN THE COUNTRY DECIDED HOW LONG AMV WAITED.

   Opening the homework list is one press and it fans out: a course list, then
   one request per course, to a server the STUDENT named on the connect screen.
   Those per-course requests were a `for` loop with an `await` in it, so eight
   courses meant eight round trips end to end, each waiting for the one before.

   Which is fine on a good day and is not what a school on a Monday morning is.
   Eight timeouts stacked into one request, held open inside a Worker with a
   wall-clock limit - so the feature failed hardest at exactly the moment a
   student was reaching for it, and it spent the operator's request duration
   doing nothing but waiting. The number of requests was bounded and the TIME
   they took was not.

   Underneath it, the same trust in a different form: `await r.json()` reads a
   whole body into memory and only then discovers how big it was. The other end
   is a host somebody typed. Half a gigabyte of JSON is not a mistake anybody
   has to make on purpose for that to matter - a Canvas instance with a
   misconfigured pagination parameter will do it - and the answer either way is
   a dead isolate.

   And one quieter thing found while fixing them. A course whose assignments
   could not be read was skipped in silence, so a student saw a homework list
   with an entire class missing from it and nothing to suggest anything was
   wrong. That is the worst way for this to be wrong: it does not look wrong. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'schoolfan.harness.mjs');
writeFileSync(harness, src +
  '\nexport { DB, schoolWork, _readCapped, SCHOOL_COURSE_MAX, SCHOOL_MAX_BYTES, issueTokens };\n');
const W = await import(harness + '?t=' + Date.now());

const store = new Map();
const env = {
  JWT_SECRET: 'x'.repeat(40),
  AMV_KV: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name })), list_complete: true };
    },
  },
};
const EMAIL = 'student@example.com';
const tok = (await W.issueTokens(env, EMAIL, 'Student')).token;
const req = () => new Request('https://api.amv.dev/v1/school/work', {
  method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}',
});

/* A school's Canvas, scripted. Every per-course answer takes `perCall`
   milliseconds, which is the number the whole finding is about. */
const realFetch = globalThis.fetch;
function school({ courses = 8, perCall = 120, failCourses = [], body = null, headers = {} } = {}) {
  const state = { calls: 0, inFlight: 0, maxInFlight: 0, order: [] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    state.calls++;
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    const mk = (obj, extra = {}) => new Response(body != null ? body : JSON.stringify(obj),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, headers, extra) });
    try {
      if (/\/courses\?/.test(u)) {
        await new Promise(r => setTimeout(r, perCall));
        return mk(Array.from({ length: courses }, (_, i) => ({ id: i + 1, name: 'Course ' + (i + 1) })));
      }
      const m = /\/courses\/(\d+)\/assignments/.exec(u);
      if (m) {
        state.order.push(+m[1]);
        await new Promise(r => setTimeout(r, perCall));
        if (failCourses.includes(+m[1])) return new Response('nope', { status: 500 });
        return mk([{ id: +m[1] * 100, name: 'Essay ' + m[1], due_at: '2026-09-01T00:00:00Z',
                     html_url: 'https://school.example.com/a', description: '<p>Write it.</p>' }]);
      }
      return mk([]);
    } finally { state.inFlight--; }
  };
  return state;
}
const connect = async () => {
  store.clear();
  await W.DB.put(env, 'school', EMAIL, { base: 'https://school.example.com', token: 'canvas-token' });
};

section('THE FINDING: the courses are read at the same time, not in a queue');
{
  await connect();
  const s = school({ courses: 8, perCall: 150 });
  const t0 = Date.now();
  const r = await W.schoolWork(req(), env);
  const took = Date.now() - t0;
  const d = await r.json();

  ok(d.connected === true && d.count === 8, 'all eight courses are read', { count: d.count, err: d.error });
  ok(s.calls === 9, 'in nine requests - the list plus one per course', s.calls);
  ok(s.maxInFlight >= 6,
     'with the per-course requests genuinely in flight together', s.maxInFlight);

  /* Sequentially this is nine waits: about 1350ms. Together it is two: the
     course list, then all eight at once. The margin is wide enough that a slow
     machine cannot turn a pass into a failure or the other way round. */
  ok(took < 700, 'so it costs about two round trips rather than nine', { took, sequential: 9 * 150 });
}

section('And a slow school costs one wait, not eight');
{
  /* The case that actually breaks: a school that answers, slowly. Sequentially
     eight courses at 400ms is over three seconds of a Worker's wall clock spent
     entirely waiting. */
  await connect();
  school({ courses: 8, perCall: 400 });
  const t0 = Date.now();
  const d = await (await W.schoolWork(req(), env)).json();
  const took = Date.now() - t0;
  ok(d.count === 8, 'the homework still arrives', d.count);
  ok(took < 1600, 'in about two waits rather than nine', { took, sequential: 9 * 400 });
}

section('A course that could not be read is named, not quietly dropped');
{
  /* A homework list with a whole class missing and nothing to say so is the
     worst kind of wrong, because it does not look wrong. */
  await connect();
  school({ courses: 4, perCall: 20, failCourses: [2, 3] });
  const d = await (await W.schoolWork(req(), env)).json();

  ok(d.count === 2, 'the courses that could be read are there', d.count);
  ok(d.partial === true, 'and the answer says it is incomplete', d.partial);
  ok(Array.isArray(d.missedCourses) && d.missedCourses.length === 2,
     'naming how many are missing', d.missedCourses);
  ok(d.missedCourses.includes('Course 2') && d.missedCourses.includes('Course 3'),
     'and which ones', d.missedCourses);
  ok(/could not read/i.test(d.notice || ''), 'in a sentence a student can read', d.notice);
  ok(/not in this list/i.test(d.notice || ''), 'that says what it means for them', d.notice);
}

section('A complete answer does not claim to be missing anything');
{
  await connect();
  school({ courses: 3, perCall: 10 });
  const d = await (await W.schoolWork(req(), env)).json();
  ok(d.count === 3, 'everything is read', d.count);
  ok(!d.partial, 'and nothing is flagged as missing', d.partial);
  ok(!d.notice, 'with no notice to explain away', d.notice);
}

section('An enormous answer is refused rather than read');
{
  /* `await r.json()` buffers first and measures second. The other end is a host
     a student typed. */
  await connect();
  const huge = JSON.stringify(Array.from({ length: 60000 }, (_, i) => ({ id: i, name: 'x'.repeat(60) })));
  ok(huge.length > W.SCHOOL_MAX_BYTES, 'the test body really is over the ceiling',
     { body: huge.length, cap: W.SCHOOL_MAX_BYTES });
  school({ courses: 2, perCall: 5, body: huge });
  const r = await W.schoolWork(req(), env);
  const d = await r.json();
  ok(r.status === 502, 'the read fails', r.status);
  ok(d.code === 'canvas_too_big', 'saying which ceiling', d.code);
  ok(/more in one answer than AMV will read/i.test(d.error || ''),
     'in words rather than a stack trace', d.error);
}

section('A body that only CLAIMS to be small is measured anyway');
{
  /* A Content-Length is a claim by the same server whose size is in question,
     so it is a fast path and never the answer. */
  await connect();
  const huge = 'x'.repeat(W.SCHOOL_MAX_BYTES + 5000);
  const r = await W._readCapped(new Response(huge, { headers: { 'Content-Length': '12' } }), W.SCHOOL_MAX_BYTES);
  ok(r.tooBig === true, 'a lying length does not get the body past the ceiling', r);

  const honest = await W._readCapped(
    new Response('x'.repeat(2000), { headers: { 'Content-Length': String(W.SCHOOL_MAX_BYTES + 1) } }),
    W.SCHOOL_MAX_BYTES);
  ok(honest.tooBig === true, 'and a declared size over it is refused without reading', honest);
}

section('And the ordinary sizes still go through');
{
  const small = await W._readCapped(new Response('{"a":1}'), W.SCHOOL_MAX_BYTES);
  ok(small.text === '{"a":1}', 'a small body is returned whole', small);

  const exact = 'y'.repeat(W.SCHOOL_MAX_BYTES);
  const atCap = await W._readCapped(new Response(exact), W.SCHOOL_MAX_BYTES);
  ok(!atCap.tooBig && atCap.text.length === W.SCHOOL_MAX_BYTES,
     'exactly at the ceiling is allowed, so the limit is not off by one', atCap.tooBig);

  const empty = await W._readCapped(new Response(''), W.SCHOOL_MAX_BYTES);
  ok(empty.text === '', 'and an empty one is empty rather than an error', empty);
}

section('The shape, so neither can come back by accident');
{
  const fn = codeOnly(functionBody(src, 'schoolWork') || '');
  ok(fn.length > 500, 'the handler was read', fn.length);
  ok(!/for\s*\(\s*const\s+c\s+of[\s\S]{0,200}await _canvasGet/.test(fn),
     'there is no await inside a loop over courses', true);
  ok(/Promise\.all\(picked\.map/.test(fn), 'they go out together', true);
  ok(/SCHOOL_COURSE_MAX/.test(fn), 'and how many of them is still bounded', true);

  const get = codeOnly(functionBody(src, '_canvasGet') || '');
  ok(!/await r\.json\(\)/.test(get), 'the body is never read without a ceiling', true);
  ok(/_readCapped\(r, SCHOOL_MAX_BYTES\)/.test(get), 'it is read with one', true);
}

globalThis.fetch = realFetch;
if (report('a-school-server-does-not-set-the-budget') > 0) process.exitCode = 1;
done();
