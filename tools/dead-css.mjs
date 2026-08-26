/* Remove ONLY rules whose every selector is dead. A rule like `.live,.dead{}`
   keeps `.live` and loses nothing. Reports rather than writes unless --write. */
import { readFileSync, writeFileSync } from 'fs';
const WRITE = process.argv.includes('--write');
const css = readFileSync('styles.css', 'utf8');
const bundle = readFileSync('app.js', 'utf8');
const sw = readFileSync('sw.js', 'utf8');
let shell = readFileSync('index.html', 'utf8');
{ const a = shell.indexOf('<!-- BUILD:JS:START -->'), b = shell.indexOf('<!-- BUILD:JS:END -->'); shell = shell.slice(0, a) + shell.slice(b); }
{ const c = shell.indexOf('<!-- BUILD:CSS:START -->'), d = shell.indexOf('<!-- BUILD:CSS:END -->'); shell = shell.slice(0, c) + shell.slice(d); }
if (shell.length > 200000) throw new Error('shell trim failed: ' + shell.length);
const hay = bundle + '\n' + shell + '\n' + sw;

const all = new Set();
for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) all.add(m[1]);
const dead = new Set();
for (const c of all) {
  if (hay.includes(c)) continue;
  // could it be assembled from a live stem? `'chome-card-' + kind`
  const parts = c.split('-');
  let built = false;
  for (let i = parts.length - 1; i >= 1; i--) {
    if (hay.includes(parts.slice(0, i).join('-') + '-')) { built = true; break; }
  }
  if (!built) dead.add(c);
}

/* Walk top level only. A rule inside @media keeps its braces balanced, so
   splitting on `}` would cut a media block in half - the exact mistake that
   made a removal tool report 96,873 characters for a forty-line function. */
const out = [];
let i = 0, removed = 0, removedBytes = 0;
const kept = [];
while (i < css.length) {
  const brace = css.indexOf('{', i);
  if (brace < 0) { out.push(css.slice(i)); break; }
  const selector = css.slice(i, brace);
  // an at-rule with a block: copy it whole, do not descend
  if (/@(media|supports|keyframes|font-face|layer|container)/.test(selector.split('}').pop())) {
    let depth = 0, j = brace;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (!depth) break; } }
    out.push(css.slice(i, j + 1)); i = j + 1; continue;
  }
  let depth = 0, j = brace;
  for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (!depth) break; } }
  const whole = css.slice(i, j + 1);
  const sels = selector.split(',').map(s => s.trim()).filter(Boolean);
  const isDeadSel = (s) => {
    const names = [...s.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m => m[1]);
    return names.length > 0 && names.every(n => dead.has(n));
  };
  if (sels.length && sels.every(isDeadSel)) {
    removed++; removedBytes += whole.length;
    kept.push(sels.join(', '));
    i = j + 1; continue;
  }
  out.push(whole); i = j + 1;
}
const result = out.join('');
console.log('dead class names:', dead.size);
console.log('rules removed:', removed, 'bytes:', removedBytes);
console.log('before:', css.length, 'after:', result.length);
if (removed && result.length >= css.length) throw new Error('removal did not shrink the file - aborting');
if (WRITE) { writeFileSync('styles.css', result); console.log('WRITTEN'); }
else console.log('(dry run; pass --write)\n' + kept.slice(0, 40).join('\n'));
