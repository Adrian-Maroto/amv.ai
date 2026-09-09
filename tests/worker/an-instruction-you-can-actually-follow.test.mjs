/* THE ONE THING BLOCKING THE PRODUCT, EXPLAINED IN A WAY THE OWNER CANNOT ACT ON.

   With no model key, chat is refused for every visitor - the readiness screen
   knows this, names AMV_MODEL_KEY, and marks it blocking. It then said
   `wrangler secret put AMV_MODEL_KEY`, which needs Node and a terminal. This
   deployment's owner is on a managed laptop that can install neither, which is
   precisely why the deploy runs in CI rather than from a machine.

   So the screen correctly identified the thing stopping everything, and handed
   over a way out that required software the reader does not have. LESSONS 349
   is the same shape - a launch checklist telling somebody to buy things AMV
   cannot use - and the rule from it holds here: a document that tells you to
   DO something is code with a slower compiler, and an instruction nobody can
   follow is a bug rather than a wording preference.

   What is asserted: every row offers a route that needs nothing but a browser,
   and the route points at the Worker this code actually runs as. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'readiness.harness.mjs');
writeFileSync(harness, src + `
export { _readinessReport, WORKER_NAME };
`);
const W = await import(harness + '?t=' + Date.now());

/* Nothing configured - the state this deployment is actually in. */
const report0 = W._readinessReport({});
const rows = (report0 && (report0.items || report0.rows || report0)) || [];
const list = Array.isArray(rows) ? rows : [];

section('The screen knows what is stopping everything');
{
  const ai = list.find(r => r.id === 'ai');
  ok(!!ai, 'the AI engine has a row', list.map(r => r.id));
  ok(ai.blocking === true, 'and it is marked as blocking, not as a nice-to-have', ai);
  ok(ai.on === false, 'and it reports itself off when no key is set', ai);
}

section('Every way out can be done with only a browser');
{
  /* The test that would have caught the original: not "is there an
     instruction" but "can the person reading it do it". */
  const withHow = list.filter(r => r.how);
  ok(withHow.length >= 5, 'there are instructions to check', withHow.length);
  const terminalOnly = withHow.filter(r => !/Cloudflare dashboard/i.test(String(r.how)));
  ok(terminalOnly.length === 0,
     'no row offers only a command line - a terminal is software this reader does not have',
     terminalOnly.map(r => r.id + ': ' + r.how));
}

section('And the dashboard route is a real path, not a vague gesture');
{
  const ai = list.find(r => r.id === 'ai');
  const how = String(ai.how);
  for (const step of ['Workers & Pages', 'Settings', 'Variables and Secrets', 'Secret', 'AMV_MODEL_KEY']) {
    ok(how.indexOf(step) >= 0, 'it names the step: ' + step, how);
  }
}

section('It points at the Worker this code actually runs as');
{
  /* A hardcoded name that drifted from wrangler.toml would send somebody
     confidently to a page that is not theirs, which is worse than saying
     nothing - they would look at the wrong Worker and conclude the key is set. */
  const declared = (toml.match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
  ok(!!declared, 'wrangler.toml declares a name', declared);
  ok(W.WORKER_NAME === declared,
     'and the readiness path uses that exact name', { used: W.WORKER_NAME, declared });
  ok(String(list.find(r => r.id === 'ai').how).indexOf(declared) >= 0,
     'so the instruction names the right Worker', declared);
}

section('The command is kept, second, for whoever does have a terminal');
{
  /* Removing it would trade one unusable instruction for another - somebody
     scripting a deployment needs the command, and the dashboard is the slow
     path for them. */
  const ai = list.find(r => r.id === 'ai');
  ok(/wrangler secret put AMV_MODEL_KEY/.test(String(ai.how)),
     'both routes are offered, not one swapped for the other', ai.how);
  ok(String(ai.how).indexOf('Cloudflare dashboard') < String(ai.how).indexOf('wrangler'),
     'and the one needing no software comes first', ai.how);
}

section('A configured deployment stops nagging about it');
{
  const done0 = W._readinessReport({ AMV_MODEL_KEY: 'sk-live-xxx' });
  const items = (done0.items || done0.rows || done0);
  const ai = (Array.isArray(items) ? items : []).find(r => r.id === 'ai');
  ok(ai && ai.on === true, 'the row goes green the moment the key exists', ai);
}

if (report('an-instruction-you-can-actually-follow') > 0) process.exitCode = 1;
done();
