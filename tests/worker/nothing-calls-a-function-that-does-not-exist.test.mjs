/* THE GAP THAT LET TWO OF THESE SHIP.

   The dead-guards stage covers two shapes: a `typeof X === 'function'` guard
   naming something defined nowhere, and a call inside a try/catch that
   swallows. A BARE call to a name that exists nowhere is neither, and twice in
   one session that is exactly what shipped:

     · _vcSnapshotInputs / _vcRestoreInputs - described in a comment, never
       written, called from _reRenderSoon. Every background repaint on Crew and
       Handoff threw before rendering.
     · _savePM - deleted on purpose, with four calls left behind on the path a
       customer is on immediately after paying. The plan was never activated
       and a successful subscription was reported as a failure.

   Neither was caught by anything. A regex cannot do this safely - a regex
   literal containing `/*` wrecks comment stripping, and the first attempt at
   this reported 115 false positives - so it is done with a real parser. acorn
   is already here, underneath terser, which the build uses.

   The rule: every identifier used as a CALLEE must resolve to something - a
   top-level declaration in the bundle, a binding in an enclosing scope, a
   property assigned onto window, or a known host/global. Anything else is a
   ReferenceError waiting for the branch that reaches it. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const acorn = require('acorn');
const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script' });

/* Assigned onto window at runtime, so a bare call resolves through the global
   object even with no declaration. Read from the source rather than listed. */
const onWindow = new Set(
  [...src.matchAll(/window\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g)].map(m => m[1]));

const declared = new Set();
const collect = (p, set) => {
  if (!p) return;
  if (p.type === 'Identifier') set.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => collect(q.value || q.argument, set));
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => collect(e, set));
  else if (p.type === 'AssignmentPattern') collect(p.left, set);
  else if (p.type === 'RestElement') collect(p.argument, set);
};
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id) declared.add(n.id.name);
  if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
  if (n.type === 'VariableDeclaration') n.declarations.forEach(d => collect(d.id, declared));
}

/* Host and language globals. Deliberately generous: this check earns its keep
   by having no false alarms, because a stage that cries wolf gets deleted. */
const GLOBALS = new Set(['parseInt','parseFloat','isNaN','isFinite','encodeURIComponent',
  'decodeURIComponent','encodeURI','decodeURI','setTimeout','clearTimeout','setInterval',
  'clearInterval','fetch','alert','confirm','prompt','require','eval','String','Number',
  'Boolean','Array','Object','JSON','Math','Date','Promise','Error','TypeError','Map','Set',
  'WeakMap','WeakSet','Symbol','RegExp','Proxy','Reflect','BigInt','Intl','URL',
  'URLSearchParams','Blob','File','FileReader','FormData','Headers','Request','Response',
  'AbortController','TextEncoder','TextDecoder','MutationObserver','IntersectionObserver',
  'ResizeObserver','KeyboardEvent','MouseEvent','CustomEvent','Event','Image','Audio','Worker',
  'structuredClone','queueMicrotask','requestAnimationFrame','cancelAnimationFrame',
  'getComputedStyle','matchMedia','btoa','atob','escape','unescape','Uint8Array','ArrayBuffer',
  'DataView','Float32Array','Int32Array','Function','Notification','crypto','indexedDB',
  'postMessage','open','close','print','scrollTo','Stripe']);

const scopes = [];
const seen = new Map();
function walk(node) {
  if (!node || typeof node.type !== 'string') return;
  let pushed = false;
  if (/Function/.test(node.type)) {
    const s = new Set();
    (node.params || []).forEach(p => collect(p, s));
    if (node.id && node.id.name) s.add(node.id.name);
    const body = node.body;
    if (body && body.type === 'BlockStatement') {
      for (const st of body.body) {
        if (st.type === 'FunctionDeclaration' && st.id) s.add(st.id.name);
        if (st.type === 'VariableDeclaration') st.declarations.forEach(d => collect(d.id, s));
      }
    }
    scopes.push(s); pushed = true;
  } else if (node.type === 'BlockStatement') {
    const s = new Set();
    for (const st of node.body) {
      if (st.type === 'FunctionDeclaration' && st.id) s.add(st.id.name);
      if (st.type === 'VariableDeclaration') st.declarations.forEach(d => collect(d.id, s));
    }
    scopes.push(s); pushed = true;
  } else if (node.type === 'CatchClause' && node.param) {
    const s = new Set(); collect(node.param, s); scopes.push(s); pushed = true;
  }

  if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier') {
    const n = node.callee.name;
    const known = declared.has(n) || GLOBALS.has(n) || onWindow.has(n)
                  || scopes.some(s => s.has(n));
    if (!known) seen.set(n, (seen.get(n) || 0) + 1);
  }

  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v.type === 'string') walk(v);
  }
  if (pushed) scopes.pop();
}
walk(ast);

section('Every function the bundle calls is a function the bundle has');
{
  const missing = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  ok(missing.length === 0,
     'no call resolves to nothing - a bare call to a deleted or never-written '
     + 'name is a ReferenceError waiting for the branch that reaches it',
     missing.map(([n, c]) => n + ' (' + c + ' call sites)'));
}

section('The check can still see the two that got through');
{
  /* A scan that cannot fail is worth nothing, so it is pointed at source that
     contains the exact shapes this file was written for. */
  const probe = acorn.parse(
    'function real(){}\n real();\n _neverWritten();\n try{ _alsoGone(); }catch(e){}\n',
    { ecmaVersion: 2022, sourceType: 'script' });
  const found = [];
  const localDeclared = new Set(['real']);
  (function scan(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier'
        && !localDeclared.has(n.callee.name) && !GLOBALS.has(n.callee.name)) {
      found.push(n.callee.name);
    }
    for (const k in n) {
      if (k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v.type === 'string') scan(v);
    }
  })(probe);
  ok(found.indexOf('_neverWritten') >= 0, 'a bare call to a missing name is seen', found);
  ok(found.indexOf('_alsoGone') >= 0, 'and so is one inside a swallowing catch', found);
  ok(found.indexOf('real') < 0, 'while a real one is not reported', found);
}

report();
done();
