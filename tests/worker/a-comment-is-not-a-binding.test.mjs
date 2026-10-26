/* A COMMENT IS NOT A BINDING.

   Scale audit, Oct 26: wrangler.toml documents each optional binding as a
   commented-out block, and preflight searched the raw file - so a `# binding =
   "BROWSER"` satisfied it, it said the binding was declared, and it said
   "Ready to deploy". This drives preflight.mjs against copies of the config
   (AMV_WRANGLER_TOML; the real file is never edited) and checks:
     - commented blocks are reported OFF, never as declared;
     - an ordinary deploy still passes with them OFF;
     - a launch profile that requires them FAILS until they are uncommented,
       and passes once they are;
     - a profile that does not exist is refused, not ignored. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const DIR = join(__dir, '.build', 'comment-binding');
mkdirSync(DIR, { recursive: true });

const real = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')
  .replace(/^id = "[^"]*"$/m, 'id = "0123456789abcdef0123456789abcdef"');
const run = (text, env = {}, args = '') => {
  const f = join(DIR, 'w' + Math.random().toString(36).slice(2) + '.toml');
  writeFileSync(f, text);
  try {
    return { code: 0, out: execSync('node preflight.mjs ' + args, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, AMV_WRANGLER_TOML: f, AMV_PROFILE: '', ...env } }).toString() };
  } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};
/* Every optional block switched on, the way the owner would: the # removed. */
const allOn = real
  .replace(/^# \[browser\]\n# binding = "BROWSER"/m, '[browser]\nbinding = "BROWSER"')
  .replace(/^# \[\[r2_buckets\]\]\n# binding = "AMV_FILES"\n# bucket_name = "amv-files"/m, '[[r2_buckets]]\nbinding = "AMV_FILES"\nbucket_name = "amv-files"')
  .replace(/^# \[ai\]\n# binding = "AI"/m, '[ai]\nbinding = "AI"')
  .replace(/^# \[\[durable_objects\.bindings\]\]\n# name = "AMV_COMPUTER"\n# class_name = "AMVComputer"\n# script_name = "amv-computer"/m,
           '[[durable_objects.bindings]]\nname = "AMV_COMPUTER"\nclass_name = "AMVComputer"\nscript_name = "amv-computer"');

section('The fixtures are what they claim');
{
  ok(/^# binding = "BROWSER"/m.test(real), 'the repository config has the browser commented out');
  ok(/^binding = "BROWSER"/m.test(allOn) && /^binding = "AMV_FILES"/m.test(allOn) && /^binding = "AI"/m.test(allOn) && /^name = "AMV_COMPUTER"/m.test(allOn),
     'and the switched-on copy has all four uncommented');
}

section('Commented out is OFF - never "declared"');
{
  const r = run(real);
  ok(r.code === 0, 'an ordinary deploy still passes with them off', r.out.slice(-400));
  ok(!/BROWSER is used and declared/.test(r.out), 'it no longer says the browser is declared');
  ok(/OFF on this deployment:.*hosted browser/.test(r.out) && /cloud Library/.test(r.out) && /searching by meaning/.test(r.out) && /cloud computer/.test(r.out),
     'and it names each one as OFF', r.out.match(/OFF on this deployment:[^\n]*/)?.[0]);
}

section('A launch profile that needs them fails until they are on');
{
  const off = run(real, { AMV_PROFILE: 'consumer_full' });
  ok(off.code === 1, 'consumer_full with them commented out is NOT ready');
  ok((off.out.match(/the consumer_full launch needs/g) || []).length === 4, 'and says which four, one by one', off.out.match(/the consumer_full launch needs[^\n]*/g));
  const on = run(allOn, { AMV_PROFILE: 'consumer_full' });
  ok(on.code === 0, 'uncommented, the same profile passes', on.out.slice(-600));
  ok(/every binding the consumer_full launch needs is declared/.test(on.out), 'and says so');
  const flag = run(real, {}, '--profile=consumer_full');
  ok(flag.code === 1, 'the profile can be given as --profile too');
}

section('A comment after a real line, or a # inside a string, is read the TOML way');
{
  const trailing = real.replace(/^binding = "AMV_KV"$/m, 'binding = "AMV_KV" # the store');
  ok(run(trailing).code === 0, 'a trailing comment does not hide a real binding');
  const quoted = real.replace(/^# \[ai\]\n# binding = "AI"/m, '[ai]\nbinding = "AI"\n# nothing = "x#y"');
  ok(/ON: searching by meaning/.test(run(quoted).out), 'a real block beside a comment holding a # is still ON');
}

section('A profile that does not exist is refused');
{
  const r = run(real, { AMV_PROFILE: 'consumer_ful' });
  ok(r.code === 1 && /not a launch profile/.test(r.out), 'a misspelt profile fails rather than requiring nothing');
}

if (report('a-comment-is-not-a-binding') > 0) process.exitCode = 1;
done();
