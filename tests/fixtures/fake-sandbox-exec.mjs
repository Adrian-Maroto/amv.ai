#!/usr/bin/env node
/* A STAND-IN FOR macOS's sandbox-exec, SO THE macOS PATH CAN RUN ON LINUX.

   Called the way the bridge calls the real one - `sandbox-exec -p PROFILE
   program args...` - it reads the deny rules out of the profile it is handed
   and ENFORCES them, with bubblewrap: every (subpath "...") that exists is
   covered with an empty directory, every (literal "...") file reads empty.
   So what a suite measures through it is what the bridge actually asked for,
   not what the stand-in assumed.

   It refuses a profile that is not the shape the bridge promises - version 1,
   everything allowed, one deny list for reads and writes - so a malformed
   profile fails here as it would fail on a Mac.

   One thing it cannot do: Seatbelt rules are by PATH, so the real sandbox
   also covers a store created after it started; bubblewrap can only cover
   what exists when it starts. The suite checks the profile NAMES those places
   rather than pretending this measured it.

     FAKE_SBX_MODE=ignore   run the program with nothing hidden (a sandbox that does nothing)
     FAKE_SBX_MODE=refuse   exit 1 at once (a sandbox that will not start)
     FAKE_SBX_LOG=<file>    write the profile it was handed there */
import { spawn } from 'child_process';
import { existsSync, statSync, writeFileSync } from 'fs';

const argv = process.argv.slice(2);
if (argv[0] !== '-p' || argv.length < 3) { console.error('sandbox-exec: usage: -p profile program ...'); process.exit(64); }
const profile = argv[1], rest = argv.slice(2);
if (process.env.FAKE_SBX_LOG) writeFileSync(process.env.FAKE_SBX_LOG, profile);
if (process.env.FAKE_SBX_MODE === 'refuse') { console.error('sandbox-exec: sandbox_apply: Operation not permitted'); process.exit(1); }

if (!/^\(version 1\)\n\(allow default\)\n\(deny file-read\* file-write\*\n[\s\S]*\)\n$/.test(profile)) {
  console.error('sandbox-exec: profile is not in the expected shape'); process.exit(65);
}
const unq = (q) => q.slice(1, -1).replace(/\\(.)/g, '$1');
const rules = [...profile.matchAll(/\((subpath|literal) ("(?:[^"\\]|\\.)*")\)/g)].map(m => ({ kind: m[1], path: unq(m[2]) }));

const args = ['--dev-bind', '/', '/', '--die-with-parent'];
if (process.env.FAKE_SBX_MODE !== 'ignore') {
  for (const r of rules) {
    if (!existsSync(r.path)) continue;
    if (statSync(r.path).isDirectory()) args.push('--tmpfs', r.path);
    else args.push('--ro-bind', '/dev/null', r.path);
  }
}
const child = spawn('bwrap', args.concat(['--'], rest), { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig); } catch (e) {} });
child.on('exit', (code, sig) => process.exit(code == null ? 1 : code));
