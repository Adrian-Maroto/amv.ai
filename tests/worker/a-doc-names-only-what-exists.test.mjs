/* A DOC NAMES ONLY WHAT EXISTS (Nov 3 audit REL-015).

   CONTEXT.md said `app.js` was "the single source of truth; the build reads
   ONLY this" - two years after app.js became a generated file that the build
   overwrites from src/app/. It named four module files that no longer existed,
   a KV placeholder that was no longer in wrangler.toml, and a list of suites
   that still included `video`, a feature removed end to end. Every one of those
   sentences was somebody's accurate description once. Nothing told anybody when
   it stopped being.

   This makes the cheap half of that mechanical. Every file a doc names in
   backticks must exist in the repository, and every suite a doc names by its
   file name must exist. A rename or a deletion that leaves a doc behind fails
   here, in the same change, with the doc and the name. What a doc names that
   is not meant to exist in the repository - a placeholder pattern, a file the
   product writes at run time, another host's config in instructions for that
   host - is listed below with the reason, one by one, so the exception is a
   decision and not a blind spot. */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename, relative } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const NOT_IN_REPO = {
  'src/app/NN-name.js': 'the naming pattern, not a file',
  'src/worker/NN-name.js': 'the naming pattern, not a file',
  '.amv-checkout.json': 'written into a checked-out repository on the cloud computer at run time',
  '.discarded-amv-backend.js': 'written by the build only when it finds a hand edit to replace',
  '/.well-known/assetlinks.json': 'a URL path the owner publishes for the Android app, not a source file',
  'vercel.json': 'another host’s config, named in the instructions for that host',
  'my-design.html': 'an example file name somebody would export',
};

const skip = new Set(['node_modules', '.git', '.build', 'public']);
const files = new Set(), names = new Set(), suites = new Set();
(function walk(d) {
  for (const f of readdirSync(d)) {
    if (skip.has(f)) continue;
    const p = join(d, f), st = statSync(p);
    if (st.isDirectory()) walk(p);
    else { const r = relative(ROOT, p); files.add(r); names.add(f); if (f.endsWith('.test.mjs')) suites.add(f.slice(0, -9)); }
  }
})(ROOT);

const docs = ['CLAUDE.md', 'CONTEXT.md', 'GO-LIVE.md', 'DEPLOY.md', 'SECURITY-SCAMS.md', 'README.md',
  ...readdirSync(join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)]
  .filter(d => existsSync(join(ROOT, d)));

const FILE = /`([A-Za-z0-9_./-]+\.(?:js|mjs|json|md|toml|sql|html|css|sh|yml|yaml))`/g;
const SUITE = /`((?:tests\/(?:worker|e2e)\/)?[a-z0-9]+(?:-[a-z0-9]+){3,})(?:\.test\.mjs)?`/g;
let cited = 0;

section('Every file a doc names is in the repository');
const missing = [];
for (const d of docs) {
  const s = readFileSync(join(ROOT, d), 'utf8');
  for (const [, m] of s.matchAll(FILE)) {
    if (NOT_IN_REPO[m]) continue;
    const norm = m.replace(/^\.\//, '');
    if (files.has(norm) || names.has(basename(norm))) continue;
    missing.push(d + ': ' + m);
  }
}
ok(missing.length === 0, `${docs.length} docs checked; every named file exists`, missing.slice(0, 20));

section('Every suite a doc names by its file name exists');
const gone = [];
for (const d of docs) {
  const s = readFileSync(join(ROOT, d), 'utf8');
  for (const [whole, m] of s.matchAll(SUITE)) {
    const name = basename(m);
    /* A bare name of four or more words in backticks is how these docs cite a
       suite (CLAUDE.md does it throughout), so it is held to the same rule. */
    cited++;
    if (!suites.has(name)) gone.push(d + ': ' + m);
  }
}
ok(cited >= 50, 'the docs cite suites by name, so this compares something', cited);
ok(gone.length === 0, 'every suite a doc cites, with its path or bare, exists', gone.slice(0, 20));

section('Every exception is still needed');
{
  const all = docs.map(d => readFileSync(join(ROOT, d), 'utf8')).join('\n');
  const unused = Object.keys(NOT_IN_REPO).filter(k => !all.includes('`' + k + '`'));
  ok(unused.length === 0, 'no exception is left over from a sentence that is gone', unused);
}

section('The check notices');
{
  const fake = '`src/app/99-nothing.js`';
  const hit = [...fake.matchAll(FILE)].map(m => m[1]).filter(m => !files.has(m) && !names.has(basename(m)));
  ok(hit.length === 1, 'a doc naming a module that does not exist is caught');
}

section('The capability page says what each one needs, read from its code');
{
  const { settingsOf, renderCapabilities } = await import(join(ROOT, 'tools', 'capabilities-doc.mjs'));
  const reg = JSON.parse(readFileSync(join(ROOT, 'docs', 'capabilities.json'), 'utf8'));
  const read = (f) => readFileSync(join(ROOT, f), 'utf8');
  const speech = reg.capabilities.find(c => (c.code || []).some(([f]) => /69-speech/.test(f)));
  ok(speech && settingsOf(speech, read).includes('AMV_SPEECH_KEY'), 'server speech is listed as reading its key', speech && settingsOf(speech, read));
  const fake = { code: [['src/worker/69-speech.js', 'noSuchFunctionAnywhere']] };
  ok(settingsOf(fake, read).length === 0, 'a function that is not there reads nothing - nothing is guessed');
  const readiness = read('src/worker/60-readiness.js');
  const all = new Set(reg.capabilities.filter(c => c.status === 'built').flatMap(c => settingsOf(c, read)));
  const unseen = [...all].filter(n => !readiness.includes(n));
  ok(all.size >= 5 && unseen.length === 0, `every setting a capability reads (${all.size}) is on the go-live screen, so the operator can see it on or off`, unseen);
  ok(readFileSync(join(ROOT, 'docs', 'CAPABILITIES.md'), 'utf8') === renderCapabilities(reg, read), 'and the committed page is what the code says today');
}

section('The architecture description says what the build does');
{
  const ctx = readFileSync(join(ROOT, 'CONTEXT.md'), 'utf8');
  ok(!/SINGLE SOURCE OF TRUTH; the build\s+reads ONLY this/.test(ctx), 'CONTEXT.md no longer calls the generated app.js the source');
  ok(!/REPLACE_WITH_YOUR_KV_NAMESPACE_ID/.test(ctx) || /REPLACE_WITH_YOUR_KV_NAMESPACE_ID/.test(readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')), 'and names no wrangler placeholder that wrangler.toml does not have');
}

report();
done();
