// Local, deterministic fault-injection gate. No live provider calls.
// Expected to exit nonzero until B15-09, B15-18 and B15-19 are repaired.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2] || path.join(root,'audit-output/build15'));
fs.mkdirSync(output,{recursive:true});
let failed=false;
for(const name of ['build15-regressions','build15-backup-regressions']){
  const r=spawnSync(process.execPath,[path.join(root,'tests/audit',name+'.mjs'),root,path.join(output,name+'.json')],{cwd:root,stdio:'inherit'});
  if(r.error)console.error(r.error.message);
  failed ||= r.status!==0;
}
console.log('Evidence:',output);
process.exitCode=failed?1:0;
