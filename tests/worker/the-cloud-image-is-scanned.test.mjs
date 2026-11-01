/* THE CLOUD COMPUTER'S IMAGE IS SCANNED (Oct 31 audit, item 88;
   .github/workflows/image-scan.yml).

   The workflow itself runs on GitHub; this holds the rules that make it
   worth running, so an edit cannot quietly turn it into a check that
   always passes:
     - it builds the image from cloud/, the folder deploy builds from;
     - the scanner is a pinned version of its own image, never "latest" and
       never a third-party action;
     - it FAILS on a fixable HIGH or CRITICAL finding (exit code, unfixed
       ignored only in the failing pass);
     - it runs when cloud/ changes, weekly, and by hand;
     - the image upgrades its OS packages when it is built. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const y = readFileSync(join(ROOT, '.github', 'workflows', 'image-scan.yml'), 'utf8');
const d = readFileSync(join(ROOT, 'cloud', 'Dockerfile'), 'utf8');
const code = y.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

section('It scans the image deploy builds, with a scanner that cannot change under it');
ok(/docker build -t amv-cloud:scan cloud\//.test(code), 'the image is built from cloud/');
ok(/aquasec\/trivy:\d+\.\d+\.\d+\b/.test(code) && !/trivy:latest/.test(code), 'the scanner is a pinned version');
ok(!/uses:\s*aquasecurity\//.test(code), 'and not a third-party action');
ok(/uses: actions\/checkout@[0-9a-f]{40}/.test(code), 'checkout is pinned to a commit');

section('It fails on what a rebuild can fix');
ok(/--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1/.test(code), 'fixable HIGH and CRITICAL findings fail the run');
ok(/exit 1/.test(code.slice(code.indexOf('--ignore-unfixed'))), 'and the failure is not swallowed');

section('It runs when it matters');
ok(/paths:[^\n]*cloud\/\*\*/.test(code) && /schedule:/.test(code) && /workflow_dispatch:/.test(code), 'on cloud/ changes, weekly, and by hand');
ok(/permissions:\s*\n\s*contents: read/.test(code), 'with read-only permissions');

section('The image takes its OS fixes when it is built');
ok(/apt-get upgrade -y/.test(d), 'apt-get upgrade runs in the build');
ok(/npm install -g npm@\d+/.test(d) && d.indexOf('npm install -g npm') < d.indexOf('USER amv'), 'and npm is replaced by a current release, as root, before the image drops to the person\u2019s user');

report();
done();
