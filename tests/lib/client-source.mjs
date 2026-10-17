/* THE WHOLE CLIENT, FOR SUITES THAT ASK "DOES ANYTHING DO X".

   app.js is the page's script, but not the whole client: office.js, sheet.js
   and admin.js are fetched on first use. A scan that reads only app.js passes
   on whatever was moved into those files without looking at it - an absence
   check made true by moving code, not by fixing it. */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* Read from what the host actually publishes, not from a list somebody keeps.
   The list was five names long while the page fetched fourteen files, so every
   scan using it passed on the other nine without reading them - the exact
   failure this helper was written to prevent, back again through its own list.
   Each published .js is a byte-identical copy of its source (the build and
   `the-host-publishes-only-what-a-visitor-needs` make sure of that). Left out:
   the scripts that never run in the page - the service worker, the code
   sandbox's frame, the Google picker's own window, and the VS Code extension. */
const NOT_THE_PAGE = new Set(['sw.js', 'sandbox.js', 'picker.js', 'amv-vscode.js']);
export const CLIENT_FILES = ['app.js'].concat(
  (existsSync(join(ROOT, 'public')) ? readdirSync(join(ROOT, 'public')) : [])
    .filter(f => f.endsWith('.js') && !NOT_THE_PAGE.has(f)).sort().map(f => 'public/' + f));
export function clientSource(){
  return CLIENT_FILES.filter(f => existsSync(join(ROOT, f))).map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n;\n');
}
