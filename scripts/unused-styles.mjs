/* Classes the stylesheet styles that nothing applies (Nov 22).

   styles.css grows by appended layers, and a screen that is replaced leaves
   its rules behind: 153 classes - the old Crew page, the old upgrade rows,
   Studio panels - were still shipped to every visitor with nothing on the
   page that could ever use them. A class counts as unused only when its name
   appears in none of the code a browser runs (app.js, the page shell, every
   published script and country file) and no code builds it from a prefix
   (`'tk-'+name`, `"x s-'+status`, `${'cw-'}`), so a false alarm needs a class
   that is genuinely never written. check.mjs fails on any; remove the rules,
   or name the class in ALLOW with the reason.

     node scripts/unused-styles.mjs      print them */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Styled for markup something other than this repository writes. */
const ALLOW = new Set([]);

export function unusedStyles(root = ROOT) {
  const css = readFileSync(join(root, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const pub = join(root, 'public');
  const files = ['app.js', 'index.html']
    .concat(existsSync(pub) ? readdirSync(pub).filter(f => f.endsWith('.js') && f !== 'sw.js').map(f => join('public', f)) : [])
    .concat(existsSync(join(pub, 'countries')) ? readdirSync(join(pub, 'countries')).map(f => join('public', 'countries', f)) : []);
  const code = files.map(f => {
    const t = readFileSync(join(root, f), 'utf8');
    return f === 'index.html' ? t.replace(/<!-- BUILD:CSS:START -->[\s\S]*?<!-- BUILD:CSS:END -->/, '') : t;
  }).join('\n');
  /* Read once: every word in the code, and every prefix the code joins a
     name onto - a quote or a template slot straight after `something-`. */
  const words = new Set(code.match(/[\w-]+/g) || []);
  const prefixes = new Set([...code.matchAll(/([\w-]*-)(?:['"]\s*\+|\$\{)/g)].map(m => m[1]));
  const built = (c) => {
    const parts = c.split('-');
    for (let i = 1; i < parts.length; i++) {
      const pre = parts.slice(0, i).join('-') + '-';
      for (const p of prefixes) if (p === pre || p.endsWith(' ' + pre) || p.endsWith(pre) && /[^\w]/.test(p.slice(-pre.length - 1, -pre.length) || ' ')) return true;
    }
    return false;
  };
  const classes = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]));
  return [...classes].filter(c => !ALLOW.has(c) && !words.has(c) && !built(c)).sort();
}

/* A selector whose brackets do not close (Nov 22). The first pruning of the
   rules above split ':is(#vc,#set-modal) .x' at its inner comma and left
   ':is(#vc' behind: an unclosed bracket makes the browser read on past the
   rule, and 1,672 rules in use vanished from 50 screens. Every selector's
   ( ) and [ ] must balance. */
export function unbalancedSelectors(root = ROOT) {
  const css = readFileSync(join(root, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim(); let p = 0, b = 0, q = '';
    for (const ch of sel) { if (q) { if (ch === q) q = ''; continue; } if (ch === '"' || ch === "'") q = ch; else if (ch === '(') p++; else if (ch === ')') p--; else if (ch === '[') b++; else if (ch === ']') b--; if (p < 0 || b < 0) break; }
    if (p !== 0 || b !== 0 || q) bad.push(sel.slice(0, 80));
  }
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const u = unusedStyles();
  console.log(u.length + (u.length ? ': ' + u.join(' ') : ''));
  const bad = unbalancedSelectors();
  if (bad.length) console.log('unbalanced: ' + bad.join(' | '));
}
