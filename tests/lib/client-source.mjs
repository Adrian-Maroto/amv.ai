/* THE WHOLE CLIENT, FOR SUITES THAT ASK "DOES ANYTHING DO X".

   app.js is the page's script, but not the whole client: office.js, sheet.js
   and admin.js are fetched on first use. A scan that reads only app.js passes
   on whatever was moved into those files without looking at it - an absence
   check made true by moving code, not by fixing it. */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIENT_FILES = ['app.js', 'src/office/office.js', 'src/sheet/sheet.js', 'src/admin/admin.js'];
export function clientSource(){
  return CLIENT_FILES.filter(f => existsSync(join(ROOT, f))).map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n;\n');
}
