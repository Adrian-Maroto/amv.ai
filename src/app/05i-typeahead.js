/* ═════════════════════════════════════════════════
   MATCHES UNDER THE BOX AS YOU TYPE (Nov 17, the owner: "as you type, things
   start showing up like a little tab below - the way ChatGPT and Claude do
   it. Don't make it so you have to type the full thing").

   One component for every search box that has a list behind it - Crew's
   jobs, Tasks, Integrations' apps. The box keeps doing what it did (filtering
   the page below); this adds the short list right under it, so the answer is
   where the eyes already are.

     · part of a word is enough: every word typed is matched against the START
       of a word in the name ("spo" finds Spotify, "fli pri" finds "flight
       prices"); the name beats the line under it, and the list's own order -
       most used first - breaks ties;
     · arrows move, Enter opens the highlighted one, Escape closes, a click
       picks; Enter with nothing highlighted is left to the box, so pressing
       Enter still searches the way it always did;
     · it is a real combobox to a screen reader (role, expanded, the active
       option), and a thumb-sized row on a touch screen.

   amvTypeahead(input, { items: () => [{ label, sub, ... }], onPick(item) })
   ═════════════════════════════════════════════════ */
const _TA_MAX = 8;
let _taSeq = 0;
function _taWords(s){ return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
function _taMatch(items, q){
  const qs = _taWords(q); if(!qs.length) return [];
  const full = String(q).trim().toLowerCase();
  const out = [];
  for(let i = 0; i < items.length && out.length < 400; i++){
    const it = items[i]; if(!it || !it.label) continue;
    const lw = it._taL || (it._taL = _taWords(it.label));
    const inLabel = qs.every(w => lw.some(x => x.startsWith(w)));
    let score = 0;
    if(inLabel) score = String(it.label).toLowerCase().startsWith(full) ? 3 : 2;
    else {
      const sw = it._taS || (it._taS = _taWords(it.sub));
      if(qs.every(w => lw.some(x => x.startsWith(w)) || sw.some(x => x.startsWith(w)))) score = 1;
    }
    if(score) out.push({ it, score, i });
  }
  out.sort((a, b) => b.score - a.score || a.i - b.i);
  const seen = new Set();
  return out.filter(x => { const k = String(x.it.label).toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, _TA_MAX).map(x => x.it);
}
function amvTypeahead(input, opts){
  if(!input || input.__ta) return;
  input.__ta = true;
  const id = 'ta-' + (++_taSeq);
  let list = null, shown = [], active = -1, timer = 0;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);
  const place = () => {
    if(!list) return;
    const r = input.getBoundingClientRect();
    list.style.left = Math.max(8, r.left) + 'px';
    list.style.top = (r.bottom + 6) + 'px';
    list.style.width = Math.min(window.innerWidth - 16, Math.max(r.width, 280)) + 'px';
  };
  const close = () => {
    if(list){ list.remove(); list = null; }
    shown = []; active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const mark = () => {
    if(!list) return;
    [...list.children].forEach((o, i) => { o.classList.toggle('on', i === active); o.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
    if(active >= 0){ input.setAttribute('aria-activedescendant', id + '-' + active); try{ list.children[active].scrollIntoView({ block: 'nearest' }); }catch(e){} }
    else input.removeAttribute('aria-activedescendant');
  };
  const pick = (i) => { const it = shown[i]; close(); if(it) try{ opts.onPick(it); }catch(e){ _logErr && _logErr('typeahead.pick', e); } };
  const open = () => {
    const q = input.value;
    let all = []; try{ all = opts.items() || []; }catch(e){ all = []; }
    shown = _taMatch(all, q);
    if(!shown.length || document.activeElement !== input){ close(); return; }
    if(!list){
      list = document.createElement('div');
      list.className = 'ta-list'; list.id = id; list.setAttribute('role', 'listbox');
      list.setAttribute('data-no-i18n', '');
      document.body.appendChild(list);
      /* A press on an option must not blur the box first, or the list is
         gone before the click lands. */
      list.addEventListener('mousedown', (e) => e.preventDefault());
      list.addEventListener('click', (e) => { const o = e.target.closest && e.target.closest('[data-ta]'); if(o) pick(+o.dataset.ta); });
    }
    active = -1;
    list.innerHTML = shown.map((it, i) => '<div class="ta-opt" role="option" id="' + id + '-' + i + '" data-ta="' + i + '" aria-selected="false">'
      + '<span class="ta-l">' + escH(it.label) + '</span>' + (it.sub ? '<span class="ta-s">' + escH(it.sub) + '</span>' : '') + '</div>').join('');
    input.setAttribute('aria-expanded', 'true');
    place();
  };
  on(input, 'input', () => { clearTimeout(timer); timer = setTimeout(open, 60); });
  on(input, 'focus', () => { if(input.value.trim()) open(); });
  on(input, 'blur', () => setTimeout(close, 120));
  on(input, 'keydown', (e) => {
    if(!list || !shown.length){ if(e.key === 'ArrowDown' && input.value.trim()){ open(); e.preventDefault(); } return; }
    if(e.key === 'ArrowDown'){ e.preventDefault(); active = (active + 1) % shown.length; mark(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); active = active <= 0 ? shown.length - 1 : active - 1; mark(); }
    else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    else if(e.key === 'Enter' && active >= 0){ e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
    else if(e.key === 'Enter'){ close(); }
  });
  window.addEventListener('resize', place, { passive: true });
  document.addEventListener('scroll', place, { passive: true, capture: true });
}
try{ window.amvTypeahead = amvTypeahead; window._taMatch = _taMatch; }catch(e){}
