/* ══════════════════════════════════════════════════════════════════════
   A FORM IN AN ANSWER, WHOSE ANSWERS COME BACK TO AMV.

   "Plan my trip" needs dates, a budget, who is going and what they like.
   Asked as prose, that is four questions and four replies. A ```form block
   draws the fields instead - text, number, a choice, several choices, a
   slider, a switch, a date - and Send puts every answer into the person's
   next message, labelled, so AMV carries on with all of it at once.

   Together with stats, compare, steps, cards, calc, choices and charts it is
   one runtime for interactive answers, not a page per task: the model writes
   data, this file checks it against a fixed list of field types and bounds,
   and draws it with the page's own controls.

   NOTHING THE MODEL WROTE RUNS, AND NOTHING IS SENT UNSEEN. The block is data;
   a field type that is not on the list, or a block that does not check out,
   is not drawn at all and the reader sees the raw block. The answers go only
   into the person's own next message, through the same send as typing, after
   they press Send - never anywhere else, and never on their own.
   ══════════════════════════════════════════════════════════════════════ */
const FORM_TYPES = new Set(['text', 'longtext', 'number', 'select', 'multi', 'range', 'toggle', 'date']);
const FORM_ID = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
/* A form in a chat is no place for a secret. The model is told never to ask
   for one, and this holds when it does: a field that reads like a password, a
   card, a bank account or an identity number means the block is not drawn. */
const FORM_SECRET = /pass(word|code|phrase)|\bpin\b|cvv|cvc|security code|card ?(number|no\b)|credit card|debit card|iban|routing|account number|sort code|\bssn\b|social security|national (id|insurance)|passport (number|no)|tax (id|number)|one[- ]time code|\botp\b|2fa|seed phrase|recovery phrase|private key/i;

/* The spec, checked and bounded, or null. */
function _formSpec(raw){
  if(!raw || typeof raw !== 'object' || !Array.isArray(raw.fields)) return null;
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v) => { const n = +v; return v !== '' && v != null && isFinite(n) ? n : undefined; };
  const ids = new Set();
  const fields = [];
  for(const f of raw.fields.slice(0, 12)){
    if(!f || !FORM_ID.test(String(f.id || '')) || ids.has(f.id)) return null;
    const type = f.type == null ? 'text' : String(f.type);
    if(!FORM_TYPES.has(type)) return null;
    if(FORM_SECRET.test(String(f.label || '') + ' ' + f.id + ' ' + String(f.placeholder || '') + ' ' + String(f.help || ''))) return null;
    ids.add(f.id);
    const o = { id: f.id, type, label: s(f.label || f.id, 80), required: !!f.required, help: s(f.help, 140) };
    if(type === 'select' || type === 'multi'){
      o.options = (Array.isArray(f.options) ? f.options : []).slice(0, 20).map(x => s(typeof x === 'object' && x ? (x.label ?? x.value) : x, 60)).filter(Boolean);
      if(o.options.length < 2) return null;
      const d = Array.isArray(f.value) ? f.value.map(String) : f.value != null ? [String(f.value)] : [];
      o.value = d.filter(v => o.options.includes(v));
      if(type === 'select') o.value = o.value.slice(0, 1);
    } else if(type === 'number' || type === 'range'){
      o.min = num(f.min); o.max = num(f.max); o.step = num(f.step);
      if(type === 'range' && !(o.min !== undefined && o.max !== undefined && o.max > o.min)) return null;
      o.unit = s(f.unit, 10);
      const v = num(f.value);
      o.value = v !== undefined ? v : type === 'range' ? o.min : undefined;
    } else if(type === 'toggle'){
      o.value = !!f.value;
    } else if(type === 'date'){
      o.value = /^\d{4}-\d{2}-\d{2}$/.test(String(f.value || '')) ? String(f.value) : '';
    } else {
      o.placeholder = s(f.placeholder, 80);
      o.value = s(f.value, type === 'longtext' ? 2000 : 200);
    }
    fields.push(o);
  }
  if(!fields.length) return null;
  return { title: s(raw.title, 80), intro: s(raw.intro, 200), submit: s(raw.submit, 30) || T('Send'), fields };
}

/* Set by the chat renderer for each answer: true when the person has replied
   since, so this answer's forms are drawn already answered. */
let _formAnswered = false;
const _FORM_SPECS = new Map();
let _formSeq = 0;
function _guiForm(raw){
  const spec = _formSpec(raw);
  if(!spec) return '';
  const key = 'f' + (++_formSeq);
  _FORM_SPECS.set(key, spec);
  if(_FORM_SPECS.size > 200) _FORM_SPECS.delete(_FORM_SPECS.keys().next().value);
  const req = '<span class="gui-form-req" aria-hidden="true">*</span>';
  const body = spec.fields.map(f => {
    const id = 'form-' + key + '-' + f.id;
    const help = f.help ? '<span class="gui-form-help" id="' + id + '-h">' + escH(f.help) + '</span>' : '';
    const desc = f.help ? ' aria-describedby="' + id + '-h"' : '';
    const need = f.required ? ' required aria-required="true"' : '';
    const lab = '<label class="gui-calc-l" for="' + id + '">' + escH(f.label) + (f.required ? req : '') + (f.unit ? ' <span class="gui-calc-u">(' + escH(f.unit) + ')</span>' : '') + '</label>';
    if(f.type === 'select') return '<div class="gui-calc-in">' + lab + '<select id="' + id + '" name="' + f.id + '"' + need + desc + '>'
      + (f.value.length ? '' : '<option value="">' + escH(T('Choose…')) + '</option>')
      + f.options.map(o => '<option' + (f.value[0] === o ? ' selected' : '') + '>' + escH(o) + '</option>').join('') + '</select>' + help + '</div>';
    if(f.type === 'multi') return '<fieldset class="gui-calc-in gui-form-multi"' + desc + '><legend class="gui-calc-l">' + escH(f.label) + (f.required ? req : '') + '</legend>'
      + f.options.map((o, i) => '<label class="gui-form-opt"><input type="checkbox" name="' + f.id + '" value="' + escH(o) + '"' + (f.value.includes(o) ? ' checked' : '') + '>' + escH(o) + '</label>').join('') + help + '</fieldset>';
    if(f.type === 'toggle') return '<div class="gui-calc-in gui-calc-tg"><input type="checkbox" id="' + id + '" name="' + f.id + '"' + (f.value ? ' checked' : '') + desc + '>' + lab + help + '</div>';
    const attrs = (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') + (f.step !== undefined ? ' step="' + f.step + '"' : (f.type === 'number' ? ' step="any"' : ''));
    if(f.type === 'range') return '<div class="gui-calc-in">' + lab + '<div class="gui-calc-rg"><input type="range" id="' + id + '" name="' + f.id + '" value="' + f.value + '"' + attrs + desc + '><output class="gui-calc-rv" for="' + id + '">' + escH(String(f.value)) + '</output></div>' + help + '</div>';
    if(f.type === 'number') return '<div class="gui-calc-in">' + lab + '<input type="number" inputmode="decimal" id="' + id + '" name="' + f.id + '"' + (f.value !== undefined ? ' value="' + f.value + '"' : '') + attrs + need + desc + '>' + help + '</div>';
    if(f.type === 'date') return '<div class="gui-calc-in">' + lab + '<input type="date" id="' + id + '" name="' + f.id + '" value="' + escH(f.value) + '"' + need + desc + '>' + help + '</div>';
    if(f.type === 'longtext') return '<div class="gui-calc-in gui-form-wide">' + lab + '<textarea id="' + id + '" name="' + f.id + '" rows="3" maxlength="2000" placeholder="' + escH(f.placeholder) + '"' + need + desc + '>' + escH(f.value) + '</textarea>' + help + '</div>';
    return '<div class="gui-calc-in">' + lab + '<input type="text" id="' + id + '" name="' + f.id + '" maxlength="200" value="' + escH(f.value) + '" placeholder="' + escH(f.placeholder) + '"' + need + desc + '>' + help + '</div>';
  }).join('');
  const done = _formAnswered;
  return '<form class="gui-calc gui-form" data-form="' + key + '" novalidate' + (done ? ' data-sent="1" inert' : '') + '>' + (spec.title ? '<div class="gui-calc-t">' + escH(spec.title) + '</div>' : '')
    + (spec.intro ? '<p class="gui-calc-n">' + escH(spec.intro) + '</p>' : '')
    + '<div class="gui-calc-ins">' + body + '</div>'
    + '<p class="gui-form-err" role="alert" aria-live="assertive"></p>'
    + '<div class="gui-form-act"><button type="submit" class="btn bp gui-form-send"' + (done ? ' disabled' : '') + '>' + escH(done ? T('Answered') : spec.submit) + '</button></div></form>';
}

/* What was filled in, checked, as the lines of a message - or the first
   problem, named, with the field to go back to. */
function _formRead(form, spec){
  const lines = [];
  for(const f of spec.fields){
    let v = '';
    if(f.type === 'multi') v = [...form.querySelectorAll('input[name="' + f.id + '"]:checked')].map(x => x.value).join(', ');
    else {
      const el = form.querySelector('[name="' + f.id + '"]'); if(!el) continue;
      if(f.type === 'toggle') v = el.checked ? T('Yes') : T('No');
      else v = String(el.value || '').trim();
      if(f.type === 'number' && v !== ''){
        const n = +v;
        if(!isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max))
          return { error: T('{0} needs a number in range.').replace('{0}', f.label), at: el };
      }
    }
    if(!v && f.required) return { error: T('{0} is needed.').replace('{0}', f.label), at: form.querySelector('[name="' + f.id + '"]') };
    if(v) lines.push('- ' + f.label + ': ' + v + (f.unit && f.type !== 'toggle' ? ' ' + f.unit : ''));
  }
  if(!lines.length) return { error: T('Fill in at least one answer.'), at: form.querySelector('input,select,textarea') };
  return { text: (spec.title ? spec.title + '\n' : '') + lines.join('\n') };
}

function _formSubmit(form){
  const spec = _FORM_SPECS.get(form.getAttribute('data-form'));
  const err = form.querySelector('.gui-form-err');
  if(!spec){ if(err) err.textContent = T('This form is from an earlier visit. Ask again to get a fresh one.'); return false; }
  if(form.getAttribute('data-sent') === '1') return false;
  if(typeof S !== 'undefined' && S.busy){ if(err) err.textContent = T('AMV is still answering. Send this when it has finished.'); return false; }
  const r = _formRead(form, spec);
  if(r.error){ if(err) err.textContent = r.error; try{ r.at && r.at.focus(); }catch(e){} return false; }
  const ta = $('mta'); if(!ta) return false;
  ta.value = r.text;
  form.setAttribute('data-sent', '1');
  form.querySelectorAll('input,select,textarea,button').forEach(x => { x.disabled = true; });
  const b = form.querySelector('.gui-form-send'); if(b) b.textContent = T('Sent');
  if(err) err.textContent = '';
  sendMsg();
  return true;
}
try{
  document.addEventListener('submit', (e) => {
    const f = e.target && e.target.closest && e.target.closest('form.gui-form');
    if(!f) return;
    e.preventDefault();
    _formSubmit(f);
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if(t && t.type === 'range' && t.closest && t.closest('form.gui-form')){ const o = t.parentNode.querySelector('.gui-calc-rv'); if(o) o.textContent = t.value; }
  });
}catch(e){}
try{ window._guiForm = _guiForm; window._formSpec = _formSpec; }catch(e){}
