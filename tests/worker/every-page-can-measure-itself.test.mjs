/* THE COMPARATOR HAS TO BE ON THE PAGE THAT USES IT.

   Six suites compared a rect dimension against a whole number with a strict
   `<`, which fails on a control that is exactly the size it is supposed to be:
   getBoundingClientRect reports the box's laid-out position, so `min-height:32px`
   at a fractional y offset comes back 31.998046875. That was a one-in-five flake
   in `mobile-sweep` and it failed a full gate.

   The fix is `armGeom`, which puts __under/__over on the page. The interesting
   part is how many places make a page:

     - bootApp                       most suites
     - browser.newPage(...)          every-dialog-can-be-reached, its own
     - bootLive -> context.newPage   the live-backend suites, twice

   I armed the first, ran the suites, and the second threw ReferenceError. Then
   the third turned up, and its only use of the comparator sits behind an early
   return - so it PASSED while being one rendered element away from throwing.

   This file is what stops the fourth. It is a source check rather than a browser
   one because the failure is a ReferenceError on a path that does not always
   run, which is exactly the shape a browser test can miss. It checks both ends:
   that every consumer reaches an arming entry point, AND that each entry point
   really installs the comparator - so deleting the addInitScript fails here too,
   rather than quietly turning six checks into no-ops. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const testFiles = [];
for (const dir of ['tests/e2e', 'tests/worker', 'tests/lib']) {
  for (const f of readdirSync(join(ROOT, dir))) {
    if (f.endsWith('.mjs')) testFiles.push(dir + '/' + f);
  }
}

section('Whatever installs the comparator, actually installs it');
{
  const harness = read('tests/lib/harness.mjs');
  ok(/export async function armGeom\(/.test(harness), 'armGeom is exported from the harness');
  ok(/addInitScript/.test(harness), 'and it reaches for addInitScript');
  ok(/__under\s*=/.test(harness) && /__over\s*=/.test(harness),
     'and defines both comparators, not just the one that was failing');
  /* The slack is the whole point: too little and the flake returns, too much and
     a genuinely small control passes. */
  const eps = harness.match(/EPS\s*=\s*([0-9.]+)/);
  ok(eps, 'the tolerance is a named constant rather than a number buried in a line');
  ok(eps && Number(eps[1]) > 0 && Number(eps[1]) <= 1,
     'and it is under a pixel, so a control that is genuinely too small still fails',
     eps && eps[1]);

  ok(/armGeom\(page\)/.test(harness), 'bootApp arms the page it creates');
  const live = read('tests/lib/live-backend.mjs');
  ok(/armGeom\(context\)/.test(live), 'bootLive arms its context');
  ok(/armGeom\(c2\)/.test(live), 'and the second context it makes for two-viewer checks');
}

section('Every suite that uses the comparator has it armed');
{
  const ARMED_BY = /bootApp\s*\(|bootLive\s*\(|armGeom\s*\(/;
  const consumers = testFiles.filter(f => {
    const src = read(f);
    if (f.endsWith('harness.mjs') || f.endsWith('live-backend.mjs')) return false;
    return /__under\s*\(|__over\s*\(/.test(src);
  });

  ok(consumers.length >= 5, 'the comparator is actually in use across the suites',
     consumers.length + ' file(s)');

  const unarmed = consumers.filter(f => !ARMED_BY.test(read(f)));
  ok(unarmed.length === 0,
     'no suite calls __under or __over on a page nothing armed', unarmed);

  /* A suite that builds its own page cannot inherit bootApp's arming, so it has
     to call armGeom by name. This is the case that threw. */
  const ownPage = consumers.filter(f => /browser\.newPage|\.newContext\(/.test(read(f)));
  const missing = ownPage.filter(f => !/armGeom\s*\(/.test(read(f)));
  ok(missing.length === 0,
     'a suite that builds its own page arms it itself', missing);
}

section('And nothing went back to comparing a rect against a bare integer');
{
  /* The original mistake, in the shape it had. Guarded by pattern rather than by
     memory of which six files it was in, because the next one will be a seventh. */
  const offenders = [];
  for (const f of testFiles) {
    if (f.endsWith('harness.mjs')) continue;
    const src = read(f);
    src.split('\n').forEach((line, i) => {
      /* A tap-target or fit threshold: a rect dimension against a whole number
         of 20 or more. Small numbers (> 0, > 1, < 2) are visibility guards and
         are not what this is about. */
      const m = line.match(/\b(?:height|width)\s*[<>]=?\s*(\d+)\b/);
      if (m && Number(m[1]) >= 20 && !/__under|__over|innerWidth|innerHeight/.test(line)) {
        offenders.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 72));
      }
    });
  }
  ok(offenders.length === 0,
     'no suite compares a measured box against a whole number without slack', offenders);
}

report();
done();
