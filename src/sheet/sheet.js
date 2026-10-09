/* AMV's spreadsheet editor: fetched the first time somebody opens a table,
   not shipped in the page (LESSONS 564).

   What it replaced asked the model to rewrite the whole CSV for "Sort by first
   column", "Add totals row" and "Find duplicates" - arithmetic and ordering by
   guess, on somebody's own numbers, pasted over their table with no undo. Here
   those are computed: sorting, filtering, totals, duplicates, summaries by a
   column (a pivot) and formulas are exact and can be undone. The model is
   asked questions about the table; when it proposes a changed table, that is
   shown as a proposal and applied only when the person presses Apply.

   Formulas are a real evaluator (no eval - the page's policy refuses it, and
   it would be the wrong tool anyway): references like B2 and $B$2, ranges,
   arithmetic, comparison, text joining, and the functions people actually
   use. A formula naming a function AMV does not know shows #NAME? and is
   written to Excel as text, so a file from somewhere else cannot smuggle a
   live WEBSERVICE() call into the copy AMV hands back. */
(function(){
'use strict';

const SHOW_ROWS = 1000;        /* rows drawn at once; everything is still computed and downloaded */
const AI_CHARS = 60000;        /* how much of the table one question carries */

/* ── Reading CSV ─────────────────────────────────────────────────────────
   Quoted fields, doubled quotes, line breaks inside quotes, CRLF, a byte-order
   mark, and the separator a file actually uses - a semicolon is the default
   in most of Europe and South America, where the comma is the decimal mark. */
function sniff(text){
  const n = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for(let i = 0; i < text.length && i < 20000; i++){
    const c = text[i];
    if(c === '"') q = !q;
    else if(!q && c === '\n') break;
    else if(!q && c in n) n[c]++;
  }
  return n[';'] > n[','] && n[';'] >= n['\t'] ? ';' : n['\t'] > n[','] ? '\t' : ',';
}
function parse(text, delim){
  text = String(text == null ? '' : text).replace(/^﻿/, '');
  const d = delim || sniff(text);
  const rows = []; let row = [], cur = '', q = false, quoted = false;
  const endCell = () => { row.push(quoted ? cur : cur.trim()); cur = ''; quoted = false; };
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i + 1] === '"'){ cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if(c === '"' && cur.trim() === ''){ q = true; quoted = true; cur = ''; }
    else if(c === d) endCell();
    else if(c === '\n' || c === '\r'){ if(c === '\r' && text[i + 1] === '\n') i++; endCell(); rows.push(row); row = []; }
    else cur += c;
  }
  if(cur !== '' || row.length){ endCell(); rows.push(row); }
  const kept = rows.filter(r => r.some(c => c !== ''));
  const w = kept.reduce((m, r) => Math.max(m, r.length), 0);
  kept.forEach(r => { while(r.length < w) r.push(''); });
  kept.delim = d;
  return kept;
}

/* ── Numbers as people write them ──────────────────────────────────────── */
let EU = false;                /* the comma is the decimal mark in this sheet */
function decideEU(grid, delim){
  if(delim === ';') return true;
  let eu = 0, us = 0;
  for(const r of grid) for(const s of r){
    const t = String(s).replace(/[\s $€£¥₹%]/g, '');
    if(/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t) || /^-?\d+,\d{1,2}$/.test(t)) eu++;
    else if(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^-?\d+\.\d+$/.test(t)) us++;
  }
  return eu > us;
}
function num(s){
  if(typeof s === 'number') return s;
  if(typeof s === 'boolean') return null;
  let t = String(s == null ? '' : s).trim();
  if(!t) return null;
  let neg = false;
  if(/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1); }
  t = t.replace(/[\s $€£¥₹₩₽₺]/g, '');
  const pct = /%$/.test(t); if(pct) t = t.slice(0, -1);
  t = EU ? t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.') : t.replace(/,(?=\d{3}(\D|$))/g, '');
  if(!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  let v = parseFloat(t);
  if(pct) v /= 100;
  return neg ? -v : v;
}
const NF = (() => { try{ return new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }); }catch(e){ return null; } })();
function show(v){
  if(v instanceof Err) return v.e;
  if(typeof v === 'number'){
    if(!isFinite(v)) return '#NUM!';
    const r = Math.round(v * 1e10) / 1e10;
    return NF ? NF.format(r) : String(r);
  }
  if(typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v == null ? '' : v);
}

/* ── Formulas ──────────────────────────────────────────────────────────── */
function Err(e){ this.e = e; }
const E = k => new Err(k);
function colIdx(s){ let n = 0; for(const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function colName(i){ let s = ''; i++; while(i > 0){ const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

const TOK = /\s*(?:(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|("(?:[^"]|"")*")|([A-Za-z_][A-Za-z0-9_.]*)(?=\s*\()|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<>|<=|>=|[-+*/^&=<>(),;%]))/y;
function lex(src){
  const out = []; TOK.lastIndex = 0;
  while(TOK.lastIndex < src.length){
    if(/^\s*$/.test(src.slice(TOK.lastIndex))) break;
    const at = TOK.lastIndex, m = TOK.exec(src);
    if(!m || m.index !== at) throw E('#ERROR!');
    if(m[1]) out.push({ t: 'n', v: parseFloat(m[1]) });
    else if(m[2]) out.push({ t: 's', v: m[2].slice(1, -1).replace(/""/g, '"') });
    else if(m[3]) out.push({ t: 'f', v: m[3].toUpperCase() });
    else if(m[4]) out.push({ t: 'r', v: m[4].replace(/\$/g, '').toUpperCase() });
    else if(m[5]) out.push({ t: 'id', v: m[5].toUpperCase() });
    else out.push({ t: 'o', v: m[6] });
  }
  return out;
}
function parseFormula(src){
  const tk = lex(src); let i = 0;
  const peek = () => tk[i], isOp = (v) => tk[i] && tk[i].t === 'o' && tk[i].v === v;
  const need = v => { if(!isOp(v)) throw E('#ERROR!'); i++; };
  function cmp(){ let a = cat(); while(tk[i] && tk[i].t === 'o' && ['=', '<>', '<', '>', '<=', '>='].includes(tk[i].v)){ const o = tk[i++].v; a = { k: 'b', o, a, b: cat() }; } return a; }
  function cat(){ let a = add(); while(isOp('&')){ i++; a = { k: 'b', o: '&', a, b: add() }; } return a; }
  function add(){ let a = mul(); while(isOp('+') || isOp('-')){ const o = tk[i++].v; a = { k: 'b', o, a, b: mul() }; } return a; }
  function mul(){ let a = pow(); while(isOp('*') || isOp('/')){ const o = tk[i++].v; a = { k: 'b', o, a, b: pow() }; } return a; }
  function pow(){ let a = una(); while(isOp('^')){ i++; a = { k: 'b', o: '^', a, b: una() }; } return a; }
  function una(){ if(isOp('-')){ i++; return { k: 'neg', a: una() }; } if(isOp('+')){ i++; return una(); } return pct(); }
  function pct(){ let a = prim(); while(isOp('%')){ i++; a = { k: 'b', o: '/', a, b: { k: 'n', v: 100 } }; } return a; }
  function prim(){
    const t = peek(); if(!t) throw E('#ERROR!');
    i++;
    if(t.t === 'n') return { k: 'n', v: t.v };
    if(t.t === 's') return { k: 's', v: t.v };
    if(t.t === 'r'){
      const [p, q] = t.v.split(':'), A = /([A-Z]+)(\d+)/.exec(p);
      if(!q) return { k: 'ref', c: colIdx(A[1]), r: +A[2] - 1 };
      const B = /([A-Z]+)(\d+)/.exec(q);
      return { k: 'rng', c1: Math.min(colIdx(A[1]), colIdx(B[1])), c2: Math.max(colIdx(A[1]), colIdx(B[1])), r1: Math.min(+A[2], +B[2]) - 1, r2: Math.max(+A[2], +B[2]) - 1 };
    }
    if(t.t === 'id'){ if(t.v === 'TRUE') return { k: 'n', v: true }; if(t.v === 'FALSE') return { k: 'n', v: false }; return { k: 'bad' }; }
    if(t.t === 'f'){
      need('('); const args = [];
      if(!isOp(')')){ args.push(cmp()); while(isOp(',') || isOp(';')){ i++; args.push(cmp()); } }
      need(')');
      return { k: 'fn', n: t.v, args };
    }
    if(t.t === 'o' && t.v === '('){ const e = cmp(); need(')'); return e; }
    throw E('#ERROR!');
  }
  const ast = cmp();
  if(i !== tk.length) throw E('#ERROR!');
  return ast;
}
function names(ast, out){
  if(!ast || typeof ast !== 'object') return out;
  if(ast.k === 'fn') out.push(ast.n);
  if(ast.k === 'bad') out.push('?');
  [ast.a, ast.b].concat(ast.args || []).forEach(x => names(x, out));
  return out;
}

const toN = v => {
  if(v instanceof Err) return v;
  if(typeof v === 'number') return v;
  if(typeof v === 'boolean') return v ? 1 : 0;
  if(v === '' || v == null) return 0;
  const n = num(v); return n === null ? E('#VALUE!') : n;
};
const toS = v => typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : String(v == null ? '' : v);
const truthy = v => typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : !!num(v);
const flat = a => Array.isArray(a) ? a : [a];
const nums = args => { const o = []; for(const a of args){ if(Array.isArray(a)){ for(const x of a){ if(x instanceof Err) return x; if(typeof x === 'number') o.push(x); } } else { const n = toN(a); if(n instanceof Err) return n; o.push(n); } } return o; };
function crit(c){
  const m = /^(<>|<=|>=|=|<|>)?(.*)$/.exec(String(c));
  const op = m[1] || '=', rhs = m[2], rn = num(rhs);
  return v => {
    const vn = typeof v === 'number' ? v : num(v);
    if(rn !== null && vn !== null){ return op === '=' ? vn === rn : op === '<>' ? vn !== rn : op === '<' ? vn < rn : op === '>' ? vn > rn : op === '<=' ? vn <= rn : vn >= rn; }
    const a = toS(v).toLowerCase(), b = rhs.toLowerCase();
    return op === '=' ? a === b : op === '<>' ? a !== b : false;
  };
}
const FN = {
  SUM: a => { const n = nums(a); return n instanceof Err ? n : n.reduce((s, x) => s + x, 0); },
  AVERAGE: a => { const n = nums(a); return n instanceof Err ? n : n.length ? n.reduce((s, x) => s + x, 0) / n.length : E('#DIV/0!'); },
  MIN: a => { const n = nums(a); return n instanceof Err ? n : n.length ? Math.min(...n) : 0; },
  MAX: a => { const n = nums(a); return n instanceof Err ? n : n.length ? Math.max(...n) : 0; },
  MEDIAN: a => { const n = nums(a); if(n instanceof Err) return n; if(!n.length) return E('#NUM!'); const s = n.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; },
  COUNT: a => a.reduce((s, x) => s + flat(x).filter(v => typeof v === 'number').length, 0),
  COUNTA: a => a.reduce((s, x) => s + flat(x).filter(v => v !== '' && v != null).length, 0),
  ROUND: a => { const x = toN(a[0]), d = a.length > 1 ? toN(a[1]) : 0; if(x instanceof Err) return x; if(d instanceof Err) return d; const f = Math.pow(10, d); return Math.round(x * f) / f; },
  ABS: a => { const x = toN(a[0]); return x instanceof Err ? x : Math.abs(x); },
  IF: a => { if(a[0] instanceof Err) return a[0]; return truthy(a[0]) ? (a.length > 1 ? a[1] : true) : (a.length > 2 ? a[2] : false); },
  IFERROR: a => a[0] instanceof Err ? (a.length > 1 ? a[1] : '') : a[0],
  AND: a => a.every(x => flat(x).every(truthy)),
  OR: a => a.some(x => flat(x).some(truthy)),
  NOT: a => !truthy(a[0]),
  CONCAT: a => a.map(x => flat(x).map(toS).join('')).join(''),
  LEN: a => toS(a[0]).length,
  UPPER: a => toS(a[0]).toUpperCase(),
  LOWER: a => toS(a[0]).toLowerCase(),
  TRIM: a => toS(a[0]).trim().replace(/\s+/g, ' '),
  SUMIF: a => { const r = flat(a[0]), s = a.length > 2 ? flat(a[2]) : r, t = crit(a[1]); let n = 0; r.forEach((v, i) => { if(t(v) && typeof s[i] === 'number') n += s[i]; }); return n; },
  COUNTIF: a => { const t = crit(a[1]); return flat(a[0]).filter(t).length; },
  AVERAGEIF: a => { const r = flat(a[0]), s = a.length > 2 ? flat(a[2]) : r, t = crit(a[1]); let n = 0, k = 0; r.forEach((v, i) => { if(t(v) && typeof s[i] === 'number'){ n += s[i]; k++; } }); return k ? n / k : E('#DIV/0!'); },
};
FN.AVG = FN.AVERAGE; FN.CONCATENATE = FN.CONCAT;

/* One evaluation of the whole grid. Each formula is worked out once, in
   whatever order the references ask for, and a loop is reported as one. */
function Book(grid){
  this.grid = grid; this.memo = new Map(); this.busy = new Set(); this.asts = new Map(); this.depth = 0;
}
/* Worked out top to bottom first. A running balance - each row adding to the
   one above, thousands deep - would otherwise be followed by recursion from
   its last row up, and run out of stack; top-down, every reference it makes
   is already known. */
Book.prototype.warm = function(){
  const g = this.grid, pass = (from, to, step) => { for(let r = from; r !== to; r += step){ const row = g[r]; for(let c = 0; c < row.length; c++) if(this.isF(c, r)) this.val(c, r); } };
  const forget = () => { for(const [k, v] of this.memo) if(v instanceof Err && v.e === '#DEPTH!') this.memo.delete(k); };
  /* Down, then up for a chain that points the other way, then down again. */
  pass(0, g.length, 1); forget(); pass(g.length - 1, -1, -1); forget(); pass(0, g.length, 1);
  return this;
};
Book.prototype.raw = function(c, r){ const row = this.grid[r]; return row ? (row[c] == null ? '' : row[c]) : ''; };
Book.prototype.isF = function(c, r){ const s = this.raw(c, r); return typeof s === 'string' && s.length > 1 && s[0] === '='; };
Book.prototype.ast = function(src){
  if(!this.asts.has(src)){ let a; try{ a = parseFormula(src.slice(1)); }catch(e){ if(!(e instanceof Err)) return { k: 'err', e: E('#DEPTH!') }; a = { k: 'err', e }; } this.asts.set(src, a); }
  return this.asts.get(src);
};
Book.prototype.val = function(c, r){
  const key = c + ':' + r;
  if(this.memo.has(key)) return this.memo.get(key);
  const s = this.raw(c, r);
  let v;
  if(!this.isF(c, r)){ const n = num(s); v = n === null ? s : n; }
  else if(this.busy.has(key)) return E('#CYCLE!');
  else if(this.depth > 300) return E('#DEPTH!');
  else { this.busy.add(key); this.depth++; try{ v = this.ev(this.ast(s)); } finally { this.depth--; this.busy.delete(key); } if(Array.isArray(v)) v = E('#VALUE!'); }
  this.memo.set(key, v);
  return v;
};
Book.prototype.ev = function(n){
  switch(n.k){
    case 'n': case 's': return n.v;
    case 'err': return n.e;
    case 'bad': return E('#NAME?');
    case 'ref': return n.r < 0 ? E('#REF!') : this.val(n.c, n.r);
    case 'rng': {
      const o = [], r2 = Math.min(n.r2, this.grid.length - 1), w = this.grid.reduce((m, r) => Math.max(m, r.length), 0), c2 = Math.min(n.c2, w - 1);
      for(let r = n.r1; r <= r2; r++) for(let c = n.c1; c <= c2; c++) o.push(this.val(c, r));
      return o;
    }
    case 'neg': { const x = toN(this.ev(n.a)); return x instanceof Err ? x : -x; }
    case 'fn': {
      const f = FN[n.n]; if(!f) return E('#NAME?');
      const args = n.args.map(a => this.ev(a));
      if(n.n !== 'IFERROR' && n.n !== 'IF'){ for(const a of args) if(a instanceof Err) return a; }
      try{ return f(args); }catch(e){ return E('#VALUE!'); }
    }
    case 'b': {
      const a = this.ev(n.a), b = this.ev(n.b);
      if(a instanceof Err) return a; if(b instanceof Err) return b;
      if(Array.isArray(a) || Array.isArray(b)) return E('#VALUE!');
      if(n.o === '&') return toS(a) + toS(b);
      if(['=', '<>', '<', '>', '<=', '>='].includes(n.o)){
        const an = typeof a === 'number' ? a : null, bn = typeof b === 'number' ? b : null;
        const x = an !== null && bn !== null ? an : toS(a).toLowerCase(), y = an !== null && bn !== null ? bn : toS(b).toLowerCase();
        return n.o === '=' ? x === y : n.o === '<>' ? x !== y : n.o === '<' ? x < y : n.o === '>' ? x > y : n.o === '<=' ? x <= y : x >= y;
      }
      const x = toN(a), y = toN(b);
      if(x instanceof Err) return x; if(y instanceof Err) return y;
      if(n.o === '+') return x + y; if(n.o === '-') return x - y; if(n.o === '*') return x * y;
      if(n.o === '/') return y === 0 ? E('#DIV/0!') : x / y;
      return Math.pow(x, y);
    }
  }
  return E('#ERROR!');
};
/* Written to Excel as a formula only when every function in it is one AMV
   evaluates: anything else goes as text. */
function safeFormula(src){
  try{ return names(parseFormula(src.slice(1)), []).every(f => FN[f]); }catch(e){ return false; }
}

/* The rows a formula points at, outside quoted text. */
const REF = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g;
function outsideQuotes(src, fn){ return src.split(/("(?:[^"]|"")*")/).map((p, i) => i % 2 ? p : fn(p)).join(''); }
function rowsUsed(src){
  const rows = new Set();
  outsideQuotes(src, p => {
    p.replace(/(\$?[A-Za-z]{1,3}\$?)(\d+):(\$?[A-Za-z]{1,3}\$?)(\d+)/g, (m, a, r1, b, r2) => { for(let r = Math.min(+r1, +r2); r <= Math.max(+r1, +r2) && rows.size < 3; r++) rows.add(r); return ''; })
     .replace(REF, (m, d1, c, d2, r) => { rows.add(+r); return m; });
    return p;
  });
  return rows;
}
function moveRow(src, from, to){
  return outsideQuotes(src, p => p.replace(REF, (m, d1, c, d2, r) => (+r === from && !d2) ? d1 + c + to : m));
}

/* ── The editor ────────────────────────────────────────────────────────── */
let st = null;     /* { name, grid, undo, filter, totals, dups, pivot, focus } */
const $ = id => document.getElementById(id);
const t = s => (typeof T === 'function' ? T(s) : s);
const esc = s => (typeof escH === 'function' ? escH(s) : String(s).replace(/[&<>"']/g, ch => '&#' + ch.charCodeAt(0) + ';'));

/* A typed value is shown as it was typed; only a formula's answer is formatted. */
function disp(b, c, r){ return b.isF(c, r) ? show(b.val(c, r)) : String(b.raw(c, r)); }
/* A number written the way this sheet writes them: 12,5 where the comma is
   the decimal mark, so it reads back as the same number. */
function plain(n){ const s = String(Math.round(n * 1e10) / 1e10); return EU ? s.replace('.', ',') : s; }
function width(){ return st.grid.reduce((m, r) => Math.max(m, r.length), 0); }
function snapshot(label){ st.undo.push({ grid: st.grid.map(r => r.slice()), label }); if(st.undo.length > 50) st.undo.shift(); st.ver++; }
/* Worked out once per change, not once per keystroke in the filter box. */
let cached = null;
function book(){
  if(!cached || cached.ver !== st.ver || cached.grid !== st.grid) cached = { ver: st.ver, grid: st.grid, b: new Book(st.grid).warm() };
  return cached.b;
}
/* Rows that summarise other rows - a "Total" whose cells are =SUM(C2:C6).
   They stay put when sorting, and they are left out of anything that adds a
   column up again, or the total would be counted twice. */
function summaryRows(){
  const out = new Set();
  for(let r = 1; r < st.grid.length; r++)
    if(st.grid[r].some(s => typeof s === 'string' && s[0] === '=' && [...rowsUsed(s)].some(x => x !== r + 1))) out.add(r);
  return out;
}
function dataRows(){ const skip = summaryRows(), o = []; for(let r = 1; r < st.grid.length; r++) if(!skip.has(r)) o.push(r); return o; }
function isNumCol(b, c){
  let n = 0, s = 0;
  for(const r of dataRows()){ const v = b.val(c, r); if(typeof v === 'number') n++; else if(v !== '' && !(v instanceof Err)) s++; }
  return n > 0 && n >= s;
}

function open(vc, rows, name, opts){
  rows = (rows || []).map(r => r.map(c => c == null ? '' : String(c)));
  EU = decideEU(rows, rows.delim);
  st = { ver: 0, delim: rows.delim === ';' || rows.delim === '\t' ? rows.delim : (EU ? ';' : ','), name: name || t('Spreadsheet'), grid: rows, undo: [], filter: '', totals: false, dups: null, pivot: null, focus: null,
         sheets: (opts && opts.sheets) || null, sheetIx: (opts && opts.sheetIx) || 0 };
  const box = vc.querySelector('.sh-body');
  if(!box) return;
  box.innerHTML =
    '<div class="sh-tools" role="toolbar" aria-label="' + esc(t('Spreadsheet tools')) + '">'
    + (st.sheets && st.sheets.length > 1 ? '<label class="sh-pick">' + esc(t('Sheet')) + ' <select id="sh-sheet">' + st.sheets.map((s, i) => '<option value="' + i + '"' + (i === st.sheetIx ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>' : '')
    + '<input type="search" id="sh-filter" class="sh-filter" placeholder="' + esc(t('Filter rows')) + '" aria-label="' + esc(t('Filter rows')) + '">'
    + '<button type="button" class="btn bs" id="sh-totals" aria-pressed="false">' + esc(t('Totals row')) + '</button>'
    + '<button type="button" class="btn bs" id="sh-dups">' + esc(t('Find duplicates')) + '</button>'
    + '<button type="button" class="btn bs" id="sh-pivot">' + esc(t('Summarise by…')) + '</button>'
    + '<button type="button" class="btn bs" id="sh-addrow">' + esc(t('Add row')) + '</button>'
    + '<button type="button" class="btn bs" id="sh-addcol">' + esc(t('Add column')) + '</button>'
    + '<button type="button" class="btn bs" id="sh-undo" disabled>' + esc(t('Undo')) + '</button>'
    + '<button type="button" class="btn bs" id="sh-xlsx" title="' + esc(t('Excel keeps the formulas; CSV keeps the values.')) + '">' + esc(t('Download Excel')) + '</button>'
    + '</div>'
    + '<div class="sh-fbar" id="sh-fbar" aria-live="polite"></div>'
    + '<div class="sh-note" id="sh-note" role="status"></div>'
    + '<div class="sh-pivot" id="sh-pv" hidden></div>'
    + '<div class="sh-scroll" id="sh-scroll"></div>'
    + '<div class="sh-stat" id="sh-stat" aria-live="polite"></div>';
  const on = (id, ev, fn) => { const el = $(id); if(el) el.addEventListener(ev, fn); };
  on('sh-filter', 'input', e => { st.filter = e.target.value; paint(); });
  on('sh-totals', 'click', () => { st.totals = !st.totals; paint(); });
  on('sh-dups', 'click', findDups);
  on('sh-pivot', 'click', () => { st.pivot = st.pivot ? null : { g: 0, v: -1, f: 'sum' }; paintPivot(); });
  on('sh-addrow', 'click', () => { snapshot(); st.grid.push(new Array(width()).fill('')); paint(); focusCell(0, st.grid.length - 1); });
  on('sh-addcol', 'click', () => { snapshot(); const w = width(); st.grid.forEach((r, i) => { while(r.length < w) r.push(''); r.push(i === 0 ? t('Column') + ' ' + colName(w) : ''); }); paint(); });
  on('sh-undo', 'click', undo);
  on('sh-xlsx', 'click', downloadXlsx);
  on('sh-sheet', 'change', e => { const s = st.sheets[+e.target.value]; if(s) open(vc, s.rows, name, { sheets: st.sheets, sheetIx: +e.target.value }); });
  paint();
}

function note(msg, action){
  const n = $('sh-note'); if(!n) return;
  n.innerHTML = msg ? esc(msg) + (action ? ' <button type="button" class="btn bs" id="sh-note-act">' + esc(action.label) + '</button>' : '') : '';
  if(action){ const b = $('sh-note-act'); if(b) b.addEventListener('click', action.run); }
}

function paint(){
  const sc = $('sh-scroll'); if(!sc || !st) return;
  const b = book(), w = width(), g = st.grid;
  const q = st.filter.trim().toLowerCase();
  const rows = [];
  for(let r = 1; r < g.length; r++){
    if(q && !g[r].some((_, c) => disp(b, c, r).toLowerCase().includes(q))) continue;
    rows.push(r);
  }
  const shown = rows.slice(0, SHOW_ROWS);
  const head = '<tr><th class="sh-rn" scope="col"><span class="sr-only">' + esc(t('Row')) + '</span></th>' + Array.from({ length: w }, (_, c) =>
    '<th scope="col"' + (st.sorted && st.sorted.c === c ? ' aria-sort="' + (st.sorted.d > 0 ? 'ascending' : 'descending') + '"' : '') + '><div class="sh-th"><span class="sh-cell" contenteditable="true" data-c="' + c + '" data-r="0" spellcheck="false">' + esc(disp(b, c, 0)) + '</span>'
    + '<button type="button" class="sh-sort" data-sort="' + c + '"' + (st.sorted && st.sorted.c === c ? ' data-dir="' + (st.sorted.d > 0 ? 'asc' : 'desc') + '"' : '') + ' aria-label="' + esc(t('Sort by') + ' ' + (disp(b, c, 0) || colName(c))) + '"></button></div></th>').join('') + '</tr>';
  const body = shown.map(r => '<tr' + (st.dups && st.dups.has(r) ? ' class="sh-dup"' : '') + '><th class="sh-rn" scope="row">' + (r + 1) + '</th>' + Array.from({ length: w }, (_, c) => {
    const v = b.val(c, r), isN = typeof v === 'number';
    return '<td class="' + (isN ? 'sh-n' : '') + (v instanceof Err ? ' sh-err' : '') + (b.isF(c, r) ? ' sh-f' : '') + '"><span class="sh-cell" contenteditable="true" data-c="' + c + '" data-r="' + r + '" spellcheck="false">' + esc(disp(b, c, r)) + '</span></td>';
  }).join('') + '</tr>').join('');
  const foot = footHTML(b);
  sc.innerHTML = '<table class="sh-tbl" id="sheet-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table>';
  const meta = $('sh-meta'); if(meta) meta.textContent = (g.length - 1).toLocaleString() + ' ' + t('rows') + ' · ' + w + ' ' + t('columns');
  const fb = $('sh-totals'); if(fb) fb.setAttribute('aria-pressed', st.totals ? 'true' : 'false');
  const ub = $('sh-undo'); if(ub) ub.disabled = !st.undo.length;
  const stat = $('sh-stat');
  if(stat) stat.textContent = (rows.length > SHOW_ROWS ? t('Showing') + ' ' + SHOW_ROWS.toLocaleString() + ' ' + t('of') + ' ' + rows.length.toLocaleString() + ' ' + t('rows. Filter or sort to reach the rest; downloads include every row.')
    : q ? t('Showing') + ' ' + rows.length.toLocaleString() + ' ' + t('of') + ' ' + (g.length - 1).toLocaleString() + ' ' + t('rows') : '');
  wire(sc);
  if(st.pivot) paintPivot();
}

function wire(sc){
  sc.querySelectorAll('.sh-sort').forEach(btn => btn.addEventListener('click', () => sortBy(+btn.dataset.sort)));
  sc.querySelectorAll('.sh-cell').forEach(el => {
    el.addEventListener('focus', () => {
      const c = +el.dataset.c, r = +el.dataset.r, raw = st.grid[r] ? (st.grid[r][c] || '') : '';
      st.focus = { c, r };
      el.dataset.was = raw;
      if(raw !== el.textContent) el.textContent = raw;
      const fb = $('sh-fbar'); if(fb) fb.innerHTML = '<b>' + colName(c) + (r + 1) + '</b> ' + esc(raw);
      colStats(c);
    });
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); const c = +el.dataset.c, r = +el.dataset.r; el.blur(); focusCell(c, r + 1); }
      else if(e.key === 'Escape'){ e.preventDefault(); el.textContent = el.dataset.was || ''; el.blur(); }
    });
    el.addEventListener('blur', () => {
      const c = +el.dataset.c, r = +el.dataset.r, now = el.textContent.replace(/ /g, ' ').trim();
      if(now === (el.dataset.was || '')){ el.textContent = disp(book(), c, r); return; }
      snapshot();
      while(st.grid.length <= r) st.grid.push(new Array(width()).fill(''));
      while(st.grid[r].length <= c) st.grid[r].push('');
      st.grid[r][c] = now;
      st.dups = null;
      refresh();
    });
  });
}
/* After an edit, every value is worked out again and written into the cells
   already on screen. The table is not rebuilt: the click that ended the edit
   is on its way to another cell, and rebuilding would throw that cell away. */
function refresh(){
  const sc = $('sh-scroll'); if(!sc) return;
  const b = book(), act = document.activeElement;
  sc.querySelectorAll('.sh-cell').forEach(el => {
    if(el === act) return;
    const c = +el.dataset.c, r = +el.dataset.r, v = b.val(c, r), td = el.parentNode;
    el.textContent = disp(b, c, r);
    if(td && td.tagName === 'TD'){ td.classList.toggle('sh-n', typeof v === 'number'); td.classList.toggle('sh-err', v instanceof Err); td.classList.toggle('sh-f', b.isF(c, r)); }
  });
  const ft = sc.querySelector('tfoot'); if(ft) ft.outerHTML = footHTML(b);
  sc.querySelectorAll('tr.sh-dup').forEach(tr => tr.classList.remove('sh-dup'));
  const ub = $('sh-undo'); if(ub) ub.disabled = !st.undo.length;
  if(st.pivot) paintPivot();
}
function footHTML(b){
  const g = st.grid, w = width();
  if(!st.totals || g.length < 2) return '';
  return '<tfoot><tr><th class="sh-rn" scope="row">Σ</th>' + Array.from({ length: w }, (_, c) => {
    if(isNumCol(b, c)){ const v = FN.SUM([dataRows().map(r => b.val(c, r))]); return '<td class="sh-n">' + esc(show(v)) + '</td>'; }
    return c === 0 ? '<td><b>' + esc(t('Total')) + '</b></td>' : '<td></td>';
  }).join('') + '</tr></tfoot>';
}
function focusCell(c, r){
  const el = document.querySelector('#sh-scroll .sh-cell[data-c="' + c + '"][data-r="' + r + '"]');
  if(el){ el.focus(); try{ const s = getSelection(), rg = document.createRange(); rg.selectNodeContents(el); s.removeAllRanges(); s.addRange(rg); }catch(e){} }
}
function colStats(c){
  const stat = $('sh-stat'); if(!stat) return;
  const b = book(), v = [];
  for(const r of dataRows()){ const x = b.val(c, r); if(typeof x === 'number') v.push(x); }
  if(!v.length){ stat.textContent = ''; return; }
  const sum = v.reduce((s, x) => s + x, 0), f = x => show(Math.round(x * 100) / 100);
  stat.textContent = (disp(b, c, 0) || colName(c)) + ': ' + t('Sum') + ' ' + f(sum) + ' · ' + t('Average') + ' ' + f(sum / v.length)
    + ' · ' + t('Min') + ' ' + f(Math.min(...v)) + ' · ' + t('Max') + ' ' + f(Math.max(...v)) + ' · ' + t('Count') + ' ' + v.length;
}

/* Rows move; a row whose formulas point at other rows stays where it is - a
   totals row at the bottom stays at the bottom - and a formula that points
   at its own row is rewritten to follow it. */
function sortBy(c){
  const g = st.grid, b = book();
  const d = st.sorted && st.sorted.c === c ? -st.sorted.d : 1;
  const free = dataRows(), slots = free.slice();
  const key = r => b.val(c, r);
  const coll = (() => { try{ return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); }catch(e){ return null; } })();
  const order = free.slice().sort((x, y) => {
    const a = key(x), z = key(y), an = typeof a === 'number', zn = typeof z === 'number';
    const ae = a === '' || a instanceof Err, ze = z === '' || z instanceof Err;
    if(ae !== ze) return ae ? 1 : -1;            /* blanks last, either way */
    if(an && zn) return (a - z) * d;
    if(an !== zn) return (an ? -1 : 1) * d;
    return (coll ? coll.compare(show(a), show(z)) : show(a).localeCompare(show(z))) * d || x - y;
  });
  snapshot();
  const out = g.slice();
  order.forEach((from, k) => {
    const to = slots[k];
    out[to] = g[from].map(s => typeof s === 'string' && s[0] === '=' ? moveRow(s, from + 1, to + 1) : s);
  });
  st.grid = out; st.sorted = { c, d }; st.dups = null;
  paint();
  const pinned = g.length - 1 - free.length;
  note(pinned ? pinned + ' ' + t(pinned === 1 ? 'row with formulas that use other rows stayed in place.' : 'rows with formulas that use other rows stayed in place.') : '');
}

function findDups(){
  /* By what the row shows, not how it is written: two rows that each say
     =B3*C3 and =B5*C5 and both come to 76.000 look the same to anybody. */
  const seen = new Map(), dups = new Set(), b = book();
  for(let r = 1; r < st.grid.length; r++){
    const k = st.grid[r].map((_, c) => disp(b, c, r).trim().toLowerCase()).join('\u0001');
    if(seen.has(k)) dups.add(r); else seen.set(k, r);
  }
  st.dups = dups;
  paint();
  if(!dups.size){ note(t('No duplicate rows.')); return; }
  note(dups.size + ' ' + t(dups.size === 1 ? 'row repeats an earlier row (highlighted).' : 'rows repeat an earlier row (highlighted).'), { label: t('Remove them'), run: () => {
    snapshot();
    st.grid = st.grid.filter((_, r) => !dups.has(r));
    st.dups = null; paint(); note(dups.size + ' ' + t('duplicate rows removed. Undo brings them back.'));
  } });
}

function undo(){
  const s = st.undo.pop(); if(!s) return;
  st.grid = s.grid; st.ver++; st.dups = null; st.sorted = null; paint(); note('');
}

/* ── Summarise by a column (a pivot table) ─────────────────────────────── */
function pivotRows(){
  const p = st.pivot, b = book(), groups = new Map();
  for(const r of dataRows()){
    const k = disp(b, p.g, r) || t('(blank)');
    const v = p.v < 0 ? 1 : b.val(p.v, r);
    if(!groups.has(k)) groups.set(k, []);
    if(p.v < 0 || typeof v === 'number') groups.get(k).push(p.v < 0 ? 1 : v);
  }
  const agg = a => p.v < 0 || p.f === 'count' ? a.length : !a.length ? '' : p.f === 'sum' ? a.reduce((s, x) => s + x, 0)
    : p.f === 'avg' ? a.reduce((s, x) => s + x, 0) / a.length : p.f === 'min' ? Math.min(...a) : Math.max(...a);
  const out = [...groups].map(([k, a]) => [k, agg(a)]);
  out.sort((x, y) => (typeof y[1] === 'number' ? y[1] : -Infinity) - (typeof x[1] === 'number' ? x[1] : -Infinity));
  const label = { sum: t('Sum'), avg: t('Average'), count: t('Count'), min: t('Min'), max: t('Max') }[p.v < 0 ? 'count' : p.f];
  return [[disp(b, p.g, 0) || colName(p.g), p.v < 0 ? t('Rows') : label + ' ' + t('of') + ' ' + (disp(b, p.v, 0) || colName(p.v))]].concat(out);
}
function paintPivot(){
  const box = $('sh-pv'); if(!box) return;
  if(!st.pivot){ box.hidden = true; box.innerHTML = ''; return; }
  const b = book(), w = width(), p = st.pivot;
  const cols = Array.from({ length: w }, (_, c) => [c, disp(b, c, 0) || colName(c)]);
  const numCols = cols.filter(([c]) => isNumCol(b, c));
  const opt = (list, sel) => list.map(([v, l]) => '<option value="' + v + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  const res = pivotRows();
  box.hidden = false;
  box.innerHTML = '<div class="sh-pv-ctl"><label>' + esc(t('Group by')) + ' <select id="pv-g">' + opt(cols, p.g) + '</select></label>'
    + '<label>' + esc(t('Show')) + ' <select id="pv-f">' + opt([['sum', t('Sum')], ['avg', t('Average')], ['count', t('Count')], ['min', t('Min')], ['max', t('Max')]], p.f) + '</select></label>'
    + '<label>' + esc(t('of')) + ' <select id="pv-v">' + opt([[-1, t('rows')]].concat(numCols), p.v) + '</select></label>'
    + '<button type="button" class="btn bs" id="pv-use">' + esc(t('Open as a sheet')) + '</button></div>'
    + '<table class="sh-tbl sh-pv-tbl"><thead><tr>' + res[0].map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>'
    + res.slice(1, 201).map(r => '<tr><td>' + esc(r[0]) + '</td><td class="sh-n">' + esc(show(r[1])) + '</td></tr>').join('') + '</tbody></table>'
    + (res.length > 201 ? '<p class="sh-stat">' + (res.length - 1).toLocaleString() + ' ' + t('groups; the first 200 are shown. Open as a sheet to see all.') + '</p>' : '');
  const g = $('pv-g'), f = $('pv-f'), v = $('pv-v'), u = $('pv-use');
  if(g) g.addEventListener('change', () => { p.g = +g.value; paintPivot(); });
  if(f) f.addEventListener('change', () => { p.f = f.value; paintPivot(); });
  if(v) v.addEventListener('change', () => { p.v = +v.value; paintPivot(); });
  if(u) u.addEventListener('click', () => {
    snapshot();
    st.grid = pivotRows().map(r => r.map(x => typeof x === 'number' ? plain(x) : String(x)));
    st.pivot = null; st.sorted = null; st.dups = null; paintPivot(); paint();
    note(t('This is the summary now. Undo goes back to the full table.'));
  });
}

/* ── Downloads ─────────────────────────────────────────────────────────── */
function baseName(){ return String(st.name || 'AMV').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'AMV'; }
/* A value that begins like a formula is written as text, so a spreadsheet
   app does not run what somebody else typed (CSV injection). */
const guard = s => /^[=+\-@\t\r]/.test(s) && num(s) === null ? "'" + s : s;
/* Written with the separator the file came with - a semicolon file goes back
   as one, which is what a spreadsheet app in that country expects. */
function csv(){
  const b = book(), w = width(), rows = [], D = st.delim || ',';
  const q = s => (s.indexOf(D) >= 0 || /["\n\r]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  for(let r = 0; r < st.grid.length; r++){
    const cells = [];
    for(let c = 0; c < w; c++){
      const v = b.val(c, r);
      let s = v instanceof Err ? v.e : !b.isF(c, r) ? String(b.raw(c, r)) : typeof v === 'number' ? plain(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
      s = guard(s);
      cells.push(q(s));
    }
    rows.push(cells.join(D));
  }
  if(st.totals){ rows.push(Array.from({ length: w }, (_, c) => c === 0 && !isNumCol(b, 0) ? t('Total') : isNumCol(b, c) ? q(plain(FN.SUM([dataRows().map(r => b.val(c, r))]))) : '').join(D)); }
  return rows.join('\r\n');
}
function downloadCSV(){
  if(!st || !st.grid.length){ toast(t('There is nothing in this sheet to download yet.'), 'error'); return; }
  _saveBlob(new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' }), baseName() + '.csv');
}
function xlsxRows(){
  const b = book(), w = width();
  const rows = st.grid.map((row, r) => Array.from({ length: w }, (_, c) => {
    const raw = row[c] == null ? '' : row[c];
    if(r > 0 && typeof raw === 'string' && raw.length > 1 && raw[0] === '=') return safeFormula(raw) ? raw : "'" + raw;
    const v = b.val(c, r);
    return r > 0 && typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : String(raw);
  }));
  if(st.totals){
    /* Over the data rows only, as runs (C2:C6,C9:C12), so a total already in
       the sheet is not added in again. */
    const runs = []; dataRows().forEach(r => { const last = runs[runs.length - 1]; if(last && last[1] === r) last[1] = r + 1; else runs.push([r + 1, r + 1]); });
    rows.push(Array.from({ length: w }, (_, c) => isNumCol(b, c) ? '=SUM(' + runs.map(([a, z]) => colName(c) + a + (z > a ? ':' + colName(c) + z : '')).join(',') + ')' : c === 0 ? t('Total') : ''));
  }
  return rows;
}
async function downloadXlsx(){
  if(!st) return;
  if(!(typeof _loadOffice === 'function' && await _loadOffice()) || typeof window.amvXlsxRows !== 'function'){
    toast(t('The Excel writer could not be loaded. Check your connection and try again, or download CSV.'), 'error', 6000); return;
  }
  _saveBlob(window.amvXlsxRows([xlsxRows()], [baseName()]), baseName() + '.xlsx');
}

/* ── Questions to AMV ──────────────────────────────────────────────────── */
let pending = null;
async function ask(query){
  query = String(query || '').trim();
  const res = $('sheet-res'), btn = $('sheet-ask');
  if(!query || !st) return;
  if(!(typeof _aiBackendReady === 'function' && _aiBackendReady())){
    if(res){ res.hidden = false; res.textContent = t('AMV isn’t connected yet, so it cannot answer questions about this table. Sorting, totals, formulas and summaries above work without it.'); }
    return;
  }
  const all = csv(), sent = all.slice(0, AI_CHARS);
  const cut = sent.length < all.length ? sent.split('\n').length - 1 : 0;
  const formulas = [];
  st.grid.forEach((row, r) => row.forEach((s, c) => { if(typeof s === 'string' && s[0] === '=' && formulas.length < 300) formulas.push(colName(c) + (r + 1) + ' = ' + s.slice(1)); }));
  if(btn){ btn.disabled = true; btn.textContent = t('Thinking…'); }
  if(res){ res.hidden = false; res.textContent = t('Reading the table…'); }
  try{
    const reply = await aiComplete('You are a careful data analyst. The person\'s spreadsheet follows as CSV (row 1 is the header; the first column is A).'
      + (cut ? ' Only the first ' + cut + ' rows are included; say so if the answer depends on the rest.' : '')
      + '\n\n```csv\n' + sent + '\n```' + (formulas.length ? '\nFormulas in it:\n' + formulas.join('\n') : '')
      + '\n\nRequest: ' + query
      + '\n\nAnswer plainly, citing the cells or rows you used. Only if the request is to CHANGE the table, reply with the complete changed table as CSV inside one ```csv block, then one line saying what changed.',
      null, { model: (typeof qModel === 'function' ? qModel('explain') : 'amv-core'), max_tokens: 4000, noLang: true });
    const m = /```csv\n([\s\S]*?)```/.exec(String(reply || ''));
    if(m){
      const rows = parse(m[1]);
      const rest = String(reply).replace(m[0], '').trim();
      pending = rows;
      if(res){
        res.innerHTML = '<p>' + esc(t('AMV suggests a changed table:') + ' ' + Math.max(0, rows.length - 1) + ' ' + t('rows') + ', ' + (rows[0] || []).length + ' ' + t('columns') + '. ' + rest) + '</p>'
          + '<button type="button" class="btn bp" id="sh-apply">' + esc(t('Apply')) + '</button> <button type="button" class="btn bs" id="sh-discard">' + esc(t('Discard')) + '</button>';
        $('sh-apply').addEventListener('click', () => { if(!pending) return; snapshot(); st.grid = pending; pending = null; st.sorted = null; st.dups = null; paint(); res.textContent = t('Applied. Undo goes back.'); });
        $('sh-discard').addEventListener('click', () => { pending = null; res.textContent = t('Discarded. The table is unchanged.'); });
      }
    } else if(res){ res.textContent = String(reply || '') + (cut ? '\n\n' + t('(AMV read the first') + ' ' + cut + ' ' + t('rows of this table.)') : ''); }
    const inp = $('sheet-inp'); if(inp) inp.value = '';
  }catch(e){
    if(res){ res.hidden = false; res.textContent = t('That question could not be answered:') + ' ' + ((e && e.message) || e); }
  }
  if(btn){ btn.disabled = false; btn.textContent = t('Ask'); }
}

/* ── An Excel file read for a chat, back into sheets ───────────────────── */
function fromReaderText(text){
  const out = [];
  const re = /^## [^\n]*?“([^”]*)”[^\n]*\n```csv\n([\s\S]*?)\n```([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  let m;
  while((m = re.exec(String(text || '')))){
    const rows = parse(m[2], ',');
    String(m[3] || '').split('\n').forEach(line => {
      const f = /^([A-Z]{1,3})(\d+) = (.+)$/.exec(line.trim());
      if(!f) return;
      const c = colIdx(f[1]), r = +f[2] - 1;
      while(rows.length <= r) rows.push([]);
      while(rows[r].length <= c) rows[r].push('');
      rows[r][c] = '=' + f[3];
    });
    const w = rows.reduce((n, r) => Math.max(n, r.length), 0);
    rows.forEach(r => { while(r.length < w) r.push(''); });
    if(rows.length) out.push({ name: m[1], rows });
  }
  return out;
}

window.amvSheet = { parse, open, ask, downloadCSV, fromReaderText, _test: { num, Book, parseFormula, safeFormula, show, setEU: v => { EU = v; } } };
})();
