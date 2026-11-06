/* EVERY MESSAGE LISTENER CHECKS WHO SENT IT (Nov 3 audit SEC-004).

   Three messages are posted with target '*', and must be: two go to frames
   with an opaque origin (the code sandbox and the app preview, which have no
   origin to name), and one tells whatever page embeds the widget to close
   it, carrying nothing. What makes that safe is the other side - every
   listener in AMV accepts a message only from the one window it expects,
   and only in the shape it expects. This holds that in place: a new listener
   that does not compare the sender fails here, and so does a new '*' post. */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = [].concat(
  readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).map(f => 'src/app/' + f),
  ['src/sandbox/sandbox.js']);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

section('Each listener compares the sender before reading the message');
{
  const found = [];
  for (const f of files) {
    const s = strip(readFileSync(join(ROOT, f), 'utf8'));
    /* A window's listeners: anything can post to a window. (A dedicated
       Worker's listener hears only that Worker.) */
    for (const m of s.matchAll(/window\.addEventListener\(\s*'message'\s*,\s*([A-Za-z_$][\w$]*|\([^)]*\)\s*=>\s*\{|function\s*\([^)]*\)\s*\{)/g)) {
      let body;
      if (/^[A-Za-z_$]/.test(m[1])) {
        const name = m[1];
        const def = new RegExp('(?:const|let|var)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=\\s*(?:\\([^)]*\\)|\\w+)\\s*=>\\s*\\{|function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\([^)]*\\)\\s*\\{').exec(s);
        body = def ? s.slice(def.index, def.index + 600) : '';
      } else body = s.slice(m.index, m.index + 600);
      found.push({ f, checks: /\.source\s*!==|\.source\s*===|!==\s*\w+\.source|e\.origin\s*!==/.test(body) });
    }
  }
  ok(found.length >= 5, 'the listeners are all found', found.length);
  ok(found.every(x => x.checks), 'every one compares who sent the message', found.filter(x => !x.checks));
}

section('A post to any origin is one of the three that must be');
{
  const wild = [];
  for (const f of files) {
    const s = strip(readFileSync(join(ROOT, f), 'utf8'));
    for (const m of s.matchAll(/postMessage\(([^;]{0,200}?),\s*'\*'\s*\)/g)) wild.push(f + ': ' + m[1].replace(/\s+/g, ' ').slice(0, 60));
  }
  const allowed = [/__amvWidget:'close'/, /__amv:'preview'/, /t:'run'/, /^src\/sandbox\/sandbox\.js: m$/];
  ok(wild.every(w => allowed.some(a => a.test(w.replace(/^[^:]+:\s*/, '')) || a.test(w))), 'only the sandbox, the preview and the widget close post to any origin', wild);
}

if (report('every-message-listener-checks-its-sender') > 0) process.exitCode = 1;
done();
