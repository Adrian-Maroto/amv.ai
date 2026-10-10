/* ══════════════════════════════════════════════════════════════════════
   AN ANSWER YOU CAN TRY NUMBERS IN.

   "What would my monthly payment be" was answered with one number for the
   one case asked about, and the next question was always "and if it were 30
   years?". A ```calc block draws the inputs and the results instead, and the
   results follow the inputs as somebody types.

   NOTHING THE MODEL WROTE RUNS. The block is data: inputs with ids, and
   outputs with formulas in a small arithmetic language this file parses and
   evaluates itself - numbers, the input ids, + - * / % ^, comparisons, and a
   short list of functions. No eval, no Function, no property access, no
   strings: a formula can only ever produce a number. A block whose formula
   does not parse is not drawn at all; the reader sees the raw block rather
   than a calculator that silently computes nothing.
   ══════════════════════════════════════════════════════════════════════ */
const CALC_FUNCS = {
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), abs: Math.abs, sqrt: Math.sqrt,
  pow: Math.pow, exp: Math.exp, ln: Math.log, log: (x, b) => b == null ? Math.log10(x) : Math.log(x) / Math.log(b),
  floor: Math.floor, ceil: Math.ceil,
  round: (x, d) => { const k = Math.pow(10, Math.max(0, Math.min(10, d | 0))); return Math.round(x * k) / k; },
  if: (c, a, b) => (c ? a : b),
};
const CALC_ID = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;

/* Compile a formula into a closure over an environment of numbers, or null if
   it is not one. A recursive-descent parser over a token list. */
function _calcCompile(src, names){
  const s = String(src || '');
  if(!s || s.length > 400) return null;
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*/%^(),<>!]))/gy;
  let m, at = 0;
  while(at < s.length){
    re.lastIndex = at;
    m = re.exec(s);
    if(!m){ if(/^\s*$/.test(s.slice(at))) break; return null; }
    at = re.lastIndex;
    if(m[1] != null) toks.push({ t: 'n', v: parseFloat(m[1]) });
    else if(m[2] != null) toks.push({ t: 'i', v: m[2] });
    else toks.push({ t: 'o', v: m[3] });
    if(toks.length > 300) return null;
  }
  let i = 0;
  const peek = () => toks[i], eat = (v) => { const k = toks[i]; if(k && k.t === 'o' && k.v === v){ i++; return true; } return false; };
  let depth = 0;
  function expr(){ return or(); }
  function or(){ let a = and(); while(eat('||')){ const l = a, r = and(); a = e => (l(e) || r(e)) ? 1 : 0; } return a; }
  function and(){ let a = cmp(); while(eat('&&')){ const l = a, r = cmp(); a = e => (l(e) && r(e)) ? 1 : 0; } return a; }
  function cmp(){
    let a = add();
    for(;;){
      const k = peek(); if(!(k && k.t === 'o' && ['<','<=','>','>=','==','!='].includes(k.v))) return a;
      i++; const l = a, r = add(), op = k.v;
      a = op === '<' ? e => +(l(e) < r(e)) : op === '<=' ? e => +(l(e) <= r(e)) : op === '>' ? e => +(l(e) > r(e))
        : op === '>=' ? e => +(l(e) >= r(e)) : op === '==' ? e => +(l(e) === r(e)) : e => +(l(e) !== r(e));
    }
  }
  function add(){ let a = mul(); for(;;){ if(eat('+')){ const l = a, r = mul(); a = e => l(e) + r(e); } else if(eat('-')){ const l = a, r = mul(); a = e => l(e) - r(e); } else return a; } }
  function mul(){ let a = un(); for(;;){ if(eat('*')){ const l = a, r = un(); a = e => l(e) * r(e); } else if(eat('/')){ const l = a, r = un(); a = e => l(e) / r(e); } else if(eat('%')){ const l = a, r = un(); a = e => l(e) % r(e); } else return a; } }
  function un(){ if(eat('-')){ const a = un(); return e => -a(e); } if(eat('+')) return un(); if(eat('!')){ const a = un(); return e => +!a(e); } return pw(); }
  function pw(){ const b = prim(); if(eat('^')){ const x = un(); return e => Math.pow(b(e), x(e)); } return b; }
  function prim(){
    if(++depth > 60) throw 0;
    const k = toks[i++]; if(!k) throw 0;
    try{
      if(k.t === 'n'){ const v = k.v; return () => v; }
      if(k.t === 'o' && k.v === '('){ const a = expr(); if(!eat(')')) throw 0; return a; }
      if(k.t === 'i'){
        const name = k.v;
        if(eat('(')){
          const fn = Object.prototype.hasOwnProperty.call(CALC_FUNCS, name.toLowerCase()) ? CALC_FUNCS[name.toLowerCase()] : null;
          if(!fn) throw 0;
          const args = [];
          if(!eat(')')){ do{ args.push(expr()); }while(eat(',')); if(!eat(')')) throw 0; }
          if(args.length > 20) throw 0;
          return e => fn(...args.map(f => f(e)));
        }
        if(!names.has(name)) throw 0;
        return e => e[name];
      }
      throw 0;
    } finally { depth--; }
  }
  try{
    const f = expr();
    if(i !== toks.length) return null;
    return f;
  }catch(e){ return null; }
}

/* The spec, checked and bounded, or null. */
function _calcSpec(raw){
  if(!raw || typeof raw !== 'object') return null;
  const inputs = (Array.isArray(raw.inputs) ? raw.inputs : []).slice(0, 12).filter(x => x && CALC_ID.test(String(x.id || '')));
  const outputs = (Array.isArray(raw.outputs) ? raw.outputs : []).slice(0, 8).filter(x => x && x.formula);
  if(!inputs.length || !outputs.length) return null;
  const num = (v, d) => { const n = +v; return isFinite(n) ? n : d; };
  const names = new Set();
  const ins = [];
  for(const x of inputs){
    if(names.has(x.id)) return null;
    names.add(x.id);
    const type = ['number', 'range', 'select', 'toggle'].includes(x.type) ? x.type : 'number';
    const o = { id: x.id, type, label: String(x.label || x.id).slice(0, 60), unit: String(x.unit || '').slice(0, 8) };
    if(type === 'select'){
      o.options = (Array.isArray(x.options) ? x.options : []).slice(0, 20).map(p => ({ label: String((p && p.label) ?? p ?? '').slice(0, 40), value: num(p && p.value != null ? p.value : p, NaN) })).filter(p => isFinite(p.value));
      if(!o.options.length) return null;
      o.value = o.options.some(p => p.value === num(x.value, NaN)) ? num(x.value) : o.options[0].value;
    } else if(type === 'toggle'){
      o.value = x.value ? 1 : 0;
    } else {
      o.min = x.min != null ? num(x.min, undefined) : undefined;
      o.max = x.max != null ? num(x.max, undefined) : undefined;
      o.step = x.step != null ? num(x.step, undefined) : undefined;
      if(type === 'range' && (o.min === undefined || o.max === undefined || !(o.max > o.min))) o.type = 'number';
      o.value = num(x.value, o.min !== undefined ? o.min : 0);
    }
    ins.push(o);
  }
  const outs = [];
  for(const y of outputs){
    const id = CALC_ID.test(String(y.id || '')) && !names.has(y.id) ? y.id : '';
    const f = _calcCompile(y.formula, names);
    if(!f) return null;
    outs.push({ id, f, label: String(y.label || 'Result').slice(0, 60), format: ['money', 'percent', 'integer', 'number'].includes(y.format) ? y.format : 'number',
                unit: String(y.unit || '').slice(0, 8), formula: String(y.formula).slice(0, 400) });
    if(id) names.add(id);   // later outputs may use earlier ones
  }
  const cur = /^[A-Z]{3}$/.test(String(raw.currency || '')) ? raw.currency : '';
  return { title: String(raw.title || '').slice(0, 80), currency: cur, ins, outs, note: String(raw.note || '').slice(0, 200) };
}

function _calcFormat(v, o, cur){
  if(typeof v !== 'number' || !isFinite(v)) return '—';
  try{
    if(o.format === 'money'){
      if(cur) return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v);
      return (o.unit && o.unit.length <= 3 && !/^[a-z]/i.test(o.unit) ? o.unit : '') + new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + (o.unit && /^[a-z]/i.test(o.unit) ? ' ' + o.unit : '');
    }
    if(o.format === 'percent') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) + '%';
    if(o.format === 'integer') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(v)) + (o.unit ? ' ' + o.unit : '');
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(v) + (o.unit ? ' ' + o.unit : '');
  }catch(e){ return String(Math.round(v * 100) / 100); }
}
/* Every output, from an environment of input values. A result that is not a
   finite number is shown as a dash with the reason in its title, never as
   Infinity or NaN. */
function _calcCompute(spec, env){
  const e = Object.assign({}, env);
  return spec.outs.map(o => {
    let v; try{ v = o.f(e); }catch(x){ v = NaN; }
    if(o.id) e[o.id] = (typeof v === 'number' && isFinite(v)) ? v : NaN;
    return v;
  });
}

const _CALC_SPECS = new Map();
let _calcSeq = 0;
function _guiCalc(raw){
  const spec = _calcSpec(raw);
  if(!spec) return '';
  const key = 'c' + (++_calcSeq);
  _CALC_SPECS.set(key, spec);
  if(_CALC_SPECS.size > 200) _CALC_SPECS.delete(_CALC_SPECS.keys().next().value);
  const env = {}; spec.ins.forEach(x => { env[x.id] = x.value; });
  const vals = _calcCompute(spec, env);
  const inHTML = spec.ins.map(x => {
    const id = 'calc-' + key + '-' + x.id;
    const lab = '<label class="gui-calc-l" for="' + id + '">' + escH(x.label) + (x.unit ? ' <span class="gui-calc-u">(' + escH(x.unit) + ')</span>' : '') + '</label>';
    if(x.type === 'select') return '<div class="gui-calc-in">' + lab + '<select id="' + id + '" data-calc-in="' + escH(x.id) + '">' +
      x.options.map(p => '<option value="' + p.value + '"' + (p.value === x.value ? ' selected' : '') + '>' + escH(p.label) + '</option>').join('') + '</select></div>';
    if(x.type === 'toggle') return '<div class="gui-calc-in gui-calc-tg"><input type="checkbox" id="' + id + '" data-calc-in="' + escH(x.id) + '"' + (x.value ? ' checked' : '') + '>' + lab + '</div>';
    const attrs = (x.min !== undefined ? ' min="' + x.min + '"' : '') + (x.max !== undefined ? ' max="' + x.max + '"' : '') + (x.step !== undefined ? ' step="' + x.step + '"' : ' step="any"');
    if(x.type === 'range') return '<div class="gui-calc-in">' + lab + '<div class="gui-calc-rg"><input type="range" id="' + id + '" data-calc-in="' + escH(x.id) + '" value="' + x.value + '"' + attrs + '><output class="gui-calc-rv" for="' + id + '">' + escH(String(x.value)) + '</output></div></div>';
    return '<div class="gui-calc-in">' + lab + '<input type="number" inputmode="decimal" id="' + id + '" data-calc-in="' + escH(x.id) + '" value="' + x.value + '"' + attrs + '></div>';
  }).join('');
  const outHTML = spec.outs.map((o, i) =>
    '<div class="gui-calc-o"><span class="gui-calc-ol">' + escH(o.label) + '</span><output class="gui-calc-ov" data-calc-out="' + i + '" title="' + escH(o.formula) + '">' + escH(_calcFormat(vals[i], o, spec.currency)) + '</output></div>').join('');
  return '<div class="gui-calc" data-calc="' + key + '">' + (spec.title ? '<div class="gui-calc-t">' + escH(spec.title) + '</div>' : '') +
    '<div class="gui-calc-ins">' + inHTML + '</div><div class="gui-calc-outs" aria-live="polite">' + outHTML + '</div>' +
    (spec.note ? '<p class="gui-calc-n">' + escH(spec.note) + '</p>' : '') + '</div>';
}
function _calcRun(box){
  const spec = _CALC_SPECS.get(box.getAttribute('data-calc')); if(!spec) return;
  const env = {};
  spec.ins.forEach(x => {
    const el = box.querySelector('[data-calc-in="' + x.id + '"]');
    if(!el){ env[x.id] = x.value; return; }
    env[x.id] = x.type === 'toggle' ? (el.checked ? 1 : 0) : (el.value === '' ? NaN : +el.value);
    if(x.type === 'range'){ const rv = el.parentNode.querySelector('.gui-calc-rv'); if(rv) rv.textContent = el.value; }
  });
  const vals = _calcCompute(spec, env);
  box.querySelectorAll('[data-calc-out]').forEach(el => { const i = +el.getAttribute('data-calc-out'); el.textContent = _calcFormat(vals[i], spec.outs[i], spec.currency); });
}
try{
  const onCalc = (e) => { const t = e.target; const box = t && t.closest && t.closest('.gui-calc'); if(box && t.hasAttribute('data-calc-in')) _calcRun(box); };
  document.addEventListener('input', onCalc);
  document.addEventListener('change', onCalc);
}catch(e){}
try{ window._guiCalc = _guiCalc; window._calcCompile = _calcCompile; window._calcSpec = _calcSpec; }catch(e){}
