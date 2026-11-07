/* @exclusive - this times the Worker's own start-up; beside other suites it
   would time the machine. */
/* THE WORKER STARTS INSIDE THE PLATFORM'S LIMITS (scale).

   Cloudflare refuses to deploy a Worker whose compressed script is over its
   size limit (10 MB on the paid plan, 3 MB on free), and a Worker whose
   top-level code takes too long to run (the start-up limit is 400ms of CPU)
   fails to start - and every request that lands on a new copy of it fails
   with it. At a million users there is a new copy somewhere every second.

   Nothing measured either. The page has a weight ceiling; the Worker, three
   megabytes of source and growing a module at a time, had none. These are
   tripwires several times today's figures (about 950KB compressed, about
   35ms to load here), so a normal week cannot fail them and the change that
   would - a dependency bundled in, a table built at load - does. */
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { gzipSync } from 'zlib';
import { spawnSync } from 'child_process';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'amv-backend.js');
const GZ_MAX = 3 * 1024 * 1024;      // the free plan's whole limit; paid is 10MB
const LOAD_MAX_MS = 200;             // half the platform's start-up allowance

section('Small enough to deploy on any plan');
{
  const gz = gzipSync(readFileSync(FILE)).length;
  ok(gz < GZ_MAX, `compressed, the Worker is under ${GZ_MAX / 1048576} MB`, (gz / 1048576).toFixed(2) + ' MB');
}

section('Its top-level code runs quickly');
{
  /* A fresh process each time, so nothing is already compiled or cached;
     the best of three, so one slow moment on a shared machine is not read
     as the Worker's own cost. */
  const times = [];
  for (let i = 0; i < 3; i++) {
    const r = spawnSync(process.execPath, ['-e',
      `const t=process.hrtime.bigint();import(${JSON.stringify(pathToFileURL(FILE).href)}).then(()=>{process.stdout.write(String(Number(process.hrtime.bigint()-t)/1e6))}).catch(e=>{process.stderr.write(String(e));process.exit(2)})`], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) times.push(+r.stdout);
  }
  const best = Math.min(...times);
  ok(times.length === 3, 'it loads every time', times);
  ok(best < LOAD_MAX_MS, `loading and running its top level takes under ${LOAD_MAX_MS}ms`, best.toFixed(1) + 'ms');
}

report();
done();
