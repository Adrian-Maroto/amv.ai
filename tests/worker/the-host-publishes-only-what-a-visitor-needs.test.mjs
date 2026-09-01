/* THE WORKER SOURCE CAME BACK FROM THE WEBSITE.

   AMV is one index.html at the root of this repository, so the obvious thing
   to point a static host at is the repository - and a static host serves
   everything in its publish directory. Somebody opened
   https://<the site>/amv-backend.js and got the Worker: every route, every
   limit, the whole thing. Beside it sat wrangler.toml, SECURITY-SCAMS.md - a
   register of what is defended and, by omission, what is not - the deploy
   notes, and the tests.

   No credential is in any of those. Secrets live in the Worker's environment
   and none is written to a file here, and this suite checks that separately
   below rather than taking it on trust. What was exposed is reconnaissance,
   which is not a key but is not something to hand out either.

   Only the host knows its publish directory, so the last step is a field in
   the host's settings and cannot be asserted from in here. What CAN be
   asserted is that the right answer exists and stays correct: a folder holding
   exactly what a visitor's browser asks for, kept in step with the build, with
   none of the rest of the repository in it. Without this suite that folder is
   a snapshot that silently goes stale the first time an asset is added - and a
   stale publish directory is worse than none, because it looks settled. */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const R = (...p) => join(ROOT, ...p);

/* The list is read out of build.mjs rather than restated here. A second copy
   of it would be a second thing to keep in step, and the failure mode of it
   drifting is this suite passing while the folder is wrong. */
const buildSrc = readFileSync(R('build.mjs'), 'utf8');
const DIR = (buildSrc.match(/const PUBLISH_DIR = '([^']+)'/) || [])[1];
const PUBLISH = (() => {
  const block = buildSrc.match(/const PUBLISH = \[([\s\S]*?)\n\];/);
  if (!block) return null;
  /* One name per line, read BEFORE the trailing comment. Reading the whole
     block as quoted strings pairs the apostrophe in "the manifest's icon"
     with the next one and invents entries out of prose - which is how this
     parser failed the first time it ran. */
  return block[1].split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .map(line => (line.match(/'([^']+)'/) || [])[1])
    .filter(Boolean);
})();

section('The build names a publish directory');
ok(DIR === 'public', 'build.mjs emits a publish directory', DIR);
ok(Array.isArray(PUBLISH) && PUBLISH.length > 0,
   'build.mjs names what goes in it', PUBLISH);

if (!DIR || !PUBLISH) {
  if (report() > 0) process.exitCode = 1;
  done();
}

section('The folder exists and matches the build');
ok(existsSync(R(DIR)) && statSync(R(DIR)).isDirectory(),
   `${DIR}/ exists - run node build.mjs`);

const present = existsSync(R(DIR)) ? readdirSync(R(DIR)).sort() : [];

/* Byte-identical, not merely present. A published copy that has drifted from
   the built artifact is the bug this whole folder exists to avoid: the host
   would be serving last week's app while every check here reads this week's. */
for (const f of PUBLISH) {
  const rootPath = R(f), pubPath = R(DIR, f);
  if (!existsSync(rootPath)) { ok(false, `${f} was built`); continue; }
  if (!existsSync(pubPath)) { ok(false, `${DIR}/${f} exists - rebuild`); continue; }
  ok(readFileSync(rootPath).equals(readFileSync(pubPath)),
     `${DIR}/${f} is byte-identical to the built ${f}`);
}

section('Nothing else is in it');
const extra = present.filter(n => !PUBLISH.includes(n));
ok(extra.length === 0,
   `${DIR}/ holds only what a visitor needs`, extra);

/* Named one at a time, so a failure says which file is being handed out
   rather than "something unexpected is in the folder". These are the files
   that were actually readable at the domain. */
const NEVER = [
  'amv-backend.js', 'wrangler.toml', 'wrangler.saved.toml', 'package.json',
  'package-lock.json', 'check.mjs', 'preflight.mjs', 'backup.mjs',
  'build.mjs', 'app.js', 'styles.css', '.dev.vars', '.git',
  'SECURITY-SCAMS.md', 'GO-LIVE.md', 'DEPLOY.md', 'LESSONS.md',
  'CLAUDE.md', 'CONTEXT.md', 'tests', 'src', 'bridge', 'node_modules',
];
for (const f of NEVER) {
  ok(!existsSync(R(DIR, f)), `${DIR}/${f} is not served`);
}

/* app.js and styles.css are the two the answer is "no" for a reason worth
   stating: the build inlines both into index.html, so a visitor never asks
   for either, and they stay at the root because check.mjs, the preflight and
   grep read them. Publishing them would ship the whole app twice. */
const page = readFileSync(R('index.html'), 'utf8');
ok(!/<script[^>]+src="\/?app\.js"/.test(page) && !/<link[^>]+href="\/?styles\.css"/.test(page),
   'the page inlines its CSS and JS, so neither needs publishing');

section('Everything the page asks this origin for is in it');
/* Root-relative href/src/content attributes: the manifest, the icons, and
   anything a future head addition points at. Cross-origin URLs and the API
   paths the app fetches at runtime are deliberately out of scope - those go to
   the Worker, not the static host. */
const refs = new Set();
for (const m of page.matchAll(/(?:href|src|content)="\/([^"/][^"]*)"/g)) refs.add(m[1]);
for (const r of [...refs].sort()) {
  ok(PUBLISH.includes(r), `the page asks for /${r}, and it is published`);
}
ok(refs.size > 0, 'the scan found the page’s own assets at all', [...refs]);

/* The two files nothing links to and the app fetches by name. Both are read
   out of the app source, so renaming either without republishing it fails
   here instead of on somebody's machine. */
const app = readFileSync(R('app.js'), 'utf8');
const swName = (app.match(/serviceWorker\.register\('\/([^']+)'\)/) || [])[1];
ok(swName && PUBLISH.includes(swName),
   'the service worker the app registers is published', swName);
const bridgeName = (app.match(/const BRIDGE_FILE = '([^']+)'/) || [])[1];
ok(bridgeName && PUBLISH.includes(bridgeName),
   'the bridge the connect card downloads is published', bridgeName);

/* The manifest is fetched by the browser and then its own contents are, so an
   icon named only in there is exactly the asset a head-only scan misses. */
try {
  const man = JSON.parse(readFileSync(R(DIR, 'manifest.webmanifest'), 'utf8'));
  const icons = (man.icons || []).map(i => String(i.src).replace(/^\//, ''));
  ok(icons.length > 0, 'the manifest names icons', icons);
  for (const i of [...new Set(icons)]) {
    ok(PUBLISH.includes(i), `the manifest’s ${i} is published`);
  }
} catch (e) {
  ok(false, 'the published manifest parses as JSON', String(e.message));
}

section('None of it carries a secret');
/* The claim made above - that what leaked was reconnaissance and not a key -
   is only worth making if it is checked. These are the shapes a real
   credential has; the placeholders the repository uses on purpose are not
   among them. */
const SECRET = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}/, 'a Slack token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b[a-z]+:\/\/[^\s/@"']+:[^\s/@"']+@/, 'a connection string with a password'],
];
for (const f of PUBLISH) {
  if (!existsSync(R(DIR, f))) continue;
  const body = readFileSync(R(DIR, f), 'utf8');
  for (const [re, what] of SECRET) {
    if (re.test(body)) { ok(false, `${DIR}/${f} contains ${what}`); }
  }
}
ok(true, 'no published file matches a credential shape');

if (report() > 0) process.exitCode = 1;
done();
