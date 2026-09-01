/* @exclusive - this suite rewrites wrangler.toml and restores it. Anything
   else reading that file while it does would see a deliberately broken one, so
   the runner gives this suite the tree to itself. */
/* PREFLIGHT self-test.
   A preflight that only passes on a good config is worthless - it has to FAIL
   on a broken one. This runs preflight.mjs against deliberately-broken copies of
   wrangler.toml and asserts it catches each class of problem. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const TOML = join(ROOT, 'wrangler.toml');
const BAK = join(__dir, '.build');
mkdirSync(BAK, { recursive: true });
const SAVE = join(BAK, 'wrangler.saved.toml');

// preserve the real config and always restore it
copyFileSync(TOML, SAVE);
const restore = () => copyFileSync(SAVE, TOML);

const runPreflight = () => {
  try {
    const out = execSync('node preflight.mjs', { cwd: ROOT, stdio: 'pipe' }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
};

/* THE FIXTURE IS BUILT, NOT BORROWED.

   This suite used to read the repository's own wrangler.toml and hand it
   straight to preflight as the BROKEN case, on the assumption that it holds
   `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`. That assumption held for the whole life
   of the project, and stopped holding the hour somebody pasted in a real
   namespace id - so the suite fed preflight a perfectly valid config and
   demanded it be rejected. It went red on the deploy blocker being FIXED, which
   is the one event it should have been happiest about.

   Every fixture below now sets the id explicitly. What is under test is stated
   here, not inherited from however the deployment happens to be configured. */
const PLACEHOLDER = 'REPLACE_WITH_YOUR_KV_NAMESPACE_ID';
const setKvId = (src, id) => {
  const out = src.replace(/^id = "[^"]*"$/m, 'id = "' + id + '"');
  if (!out.includes('id = "' + id + '"')) {
    throw new Error('no KV id line in wrangler.toml - the fixture cannot be built');
  }
  return out;
};

try {
  const good = readFileSync(SAVE, 'utf8');

  /* The fixtures really are what they claim. Without this, a broken builder
     shows up as preflight failing to notice a problem - blaming the code under
     test for the test's own bug. */
  section('The fixtures are what they say they are');
  ok(setKvId(good, PLACEHOLDER).includes(PLACEHOLDER),
     'the broken fixture really does carry the placeholder');
  ok(!setKvId(good, 'abc123def456realid0000').includes(PLACEHOLDER),
     'and the valid fixture really does not');

  /* ── With a REAL kv id, the true config should pass ─────────────────────── */
  section('Preflight passes a valid config');
  writeFileSync(TOML, setKvId(good, 'abc123def456realid0000'));
  let r = runPreflight();
  ok(r.code === 0, 'a fully-valid config is Ready to deploy (exit 0)', r.code);
  ok(/Ready to deploy/.test(r.out), 'it says so');

  /* ── The placeholder KV id must be caught ───────────────────────────────── */
  section('Preflight catches the placeholder KV id');
  writeFileSync(TOML, setKvId(good, PLACEHOLDER));
  r = runPreflight();
  ok(r.code === 1, 'a placeholder KV id blocks deploy (exit 1)', r.code);
  ok(/PLACEHOLDER/.test(r.out), 'and names the problem');

  /* ── A missing Durable Object binding (silent quota failure) ────────────── */
  section('Preflight catches a missing Durable Object binding');
  const noDO = setKvId(good, 'realid123')
    .replace(/\[\[durable_objects\.bindings\]\][\s\S]*?class_name\s*=\s*"AMVCounter"/, '');
  writeFileSync(TOML, noDO);
  r = runPreflight();
  ok(r.code === 1, 'a missing DO binding blocks deploy', r.code);
  ok(/Durable Object is NOT bound|non-atomic/i.test(r.out), 'and warns about the non-atomic fallback');

  /* ── A missing migration (DO deploy would be rejected) ──────────────────── */
  section('Preflight catches a missing DO migration');
  const noMig = setKvId(good, 'realid123')
    .replace(/\[\[migrations\]\][\s\S]*?new_(sqlite_)?classes\s*=\s*\[[^\]]*\]/, '');
  writeFileSync(TOML, noMig);
  r = runPreflight();
  ok(r.code === 1, 'a missing migration blocks deploy', r.code);
  ok(/migration/i.test(r.out), 'and names it');

  /* ── A missing cron is a WARNING, not a hard block ──────────────────────── */
  section('Preflight warns (not blocks) on a missing cron');
  const noCron = setKvId(good, 'realid123')
    .replace(/\[triggers\][\s\S]*?crons\s*=\s*\[[^\]]*\]/, '');
  writeFileSync(TOML, noCron);
  r = runPreflight();
  ok(r.code === 0, 'no cron does NOT block deploy (it is a warning)', r.code);
  ok(/scheduled automations.*never fire|no cron/i.test(r.out), 'but it is flagged as a warning');

} finally {
  restore();
}

// sanity: the real config is back and untouched
ok(existsSync(TOML) && readFileSync(TOML, 'utf8').includes('AMVCounter'),
   'the real wrangler.toml is restored after the test');

report();
done();
