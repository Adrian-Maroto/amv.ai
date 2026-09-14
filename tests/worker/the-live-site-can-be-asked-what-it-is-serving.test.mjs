/* THE PAGE SAYS WHICH BUILD IT IS, SO THE LIVE SITE CAN BE ASKED.

   The Worker proves itself after deploying by reading /v1/health back. The
   website could not be asked anything: a static host publishes it on its own
   schedule, so "the gate passed and main moved" and "visitors have the new
   page" were separate facts with nothing joining them. A fix could be green,
   merged and deployed while every visitor still downloaded the old page.

   This checks the stamp the CI readback depends on. Without it that job cannot
   tell a stale site from a fresh one, and a check that cannot tell is the kind
   that passes for months. */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = (...p) => join(ROOT, ...p);
const STAMP = /<meta name="amv-build" content="([a-f0-9]{16})">/;

section('Every page a visitor can download carries a build id');
const pages = ['index.html', 'public/index.html'];
const ids = {};
for (const p of pages) {
  const m = readFileSync(R(p), 'utf8').match(STAMP);
  ok(!!m, p + ' carries a build id');
  ids[p] = m && m[1];
}
ok(ids['index.html'] === ids['public/index.html'],
   'and the published copy is stamped the same as the built one',
   ids['index.html'] + ' vs ' + ids['public/index.html']);

section('The id is derived from what a visitor actually downloads');
/* Not the commit SHA, deliberately: two commits that build identical bytes are
   the same page to a visitor, and a docs-only commit must not report the live
   site as out of date. It is the hash of the bundle and the stylesheet - the
   two things inlined into the page - so it moves when, and only when, the
   thing people download moves. */
{
  const id = ids['index.html'];
  ok(/^[a-f0-9]{16}$/.test(id), 'the id is a 16-character hash', id);

  /* THE STAMP IS THE HASH OF THE PAGE'S OWN PAYLOAD, RECOMPUTED HERE.

     Checking the SHAPE of the id would pass on a hard-coded constant, which is
     the failure this repository keeps finding in its own tests. So the two
     things the build hashed are pulled back out of the page a visitor
     downloads - the stylesheet between the BUILD:CSS markers and the bundle in
     the app-code block - and hashed again. If the stamp were typed, copied from
     another build, or left behind by an edit that skipped the build, this does
     not match. */
  const page = readFileSync(R('public/index.html'), 'utf8');
  const cssIn = (page.match(/<!-- BUILD:CSS:START -->\s*<style>([\s\S]*?)<\/style>\s*<!-- BUILD:CSS:END -->/) || [, null])[1];
  const jsIn = (page.match(/<script id="amv-app-code" type="text\/plain">\n([\s\S]*?)\n<\/script>/) || [, null])[1];
  ok(cssIn !== null && jsIn !== null, 'the page still carries its payload inline');
  if (cssIn !== null && jsIn !== null) {
    const recomputed = createHash('sha256')
      .update(Buffer.from(jsIn, 'utf8')).update(Buffer.from(cssIn, 'utf8'))
      .digest('hex').slice(0, 16);
    ok(recomputed === id,
       'and the stamp is that payload hashed, not a value somebody wrote down',
       recomputed + ' vs ' + id);
  }
}

section('The CSP hashes are not a substitute for it');
/* Recorded because it was the first thing reached for and it would have been
   useless. The CSP pins the small inline boot scripts, which do not change when
   the app does - byte-identical across builds while the whole bundle moves
   underneath. A freshness check built on those passes on a site months stale. */
{
  const page = readFileSync(R('public/index.html'), 'utf8');
  const hashes = (page.match(/sha256-[A-Za-z0-9+/=]{20,}/g) || []);
  ok(hashes.length > 0, 'the page still pins its inline scripts', String(hashes.length));
  ok(!hashes.includes(ids['public/index.html']),
     'and the build id is a separate thing from them');
}

section('The workflow reads the same stamp this test checks');
{
  /* COMMENTS STRIPPED FIRST, BECAUSE THE FIRST VERSION PASSED ON ONE.

     Deleting amv-backend.js from the list the job actually probes did not fail
     this section: the name still appeared in the paragraph above explaining why
     the probe exists. The check was reading the explanation, not the code, and
     an explanation cannot serve a file to anybody. */
  const wf = readFileSync(R('.github/workflows/deploy.yml'), 'utf8')
    .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  ok(/name="amv-build" content=/.test(wf),
     'the deploy readback greps for the build id');
  ok(/public\/index\.html/.test(wf),
     'and takes the expected value from the published page');
  ok(/amv-backend\.js/.test(wf),
     'and still checks the host is not handing out the source');
}

report();
done();
