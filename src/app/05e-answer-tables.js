/* ── A TABLE IN AN ANSWER IS SOMETHING TO WORK WITH ─────────────────────────
   md() wraps every markdown table in .mtbl with two buttons. One listener on
   the document handles them for every answer, past and future:

   - a header sorts by its column - numbers as numbers ($1,200 above 800),
     text in the reader's own alphabet - and a second press reverses it;
   - Copy puts it on the clipboard as tab-separated rows, which is what Excel,
     Numbers and Sheets read as cells when pasted;
   - Open as table hands the rows to the spreadsheet editor. */
function _mtblRows(t){
  return [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
}
function _mtblNum(s){
  const v = String(s).replace(/[\s$€£¥₹%,]/g, '').replace(/^\((.*)\)$/, '-$1');
  return /^[-+]?\d*\.?\d+$/.test(v) ? parseFloat(v) : null;
}
function _mtblSort(th){
  const tr = th.parentNode, table = th.closest('table'); if(!tr || !table) return;
  const col = [...tr.children].indexOf(th);
  const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
  tr.querySelectorAll('th').forEach(h => h.setAttribute('aria-sort', 'none'));
  th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
  const body = [...table.querySelectorAll('tr')].slice(1);
  const coll = (() => { try{ return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); }catch(e){ return null; } })();
  const key = r => (r.children[col] ? r.children[col].textContent.trim() : '');
  body.sort((a, b) => {
    const x = key(a), y = key(b), nx = _mtblNum(x), ny = _mtblNum(y);
    if(!x !== !y) return x ? -1 : 1;                 /* empty cells last either way */
    if(nx !== null && ny !== null) return (nx - ny) * dir;
    return (coll ? coll.compare(x, y) : x.localeCompare(y)) * dir;
  });
  const parent = body.length ? body[0].parentNode : null;
  if(parent) body.forEach(r => parent.appendChild(r));
}
function _mtblCopy(t, btn){
  const tsv = _mtblRows(t).map(r => r.map(c => c.replace(/\t/g, ' ')).join('\t')).join('\n');
  const done = () => { const was = btn.textContent; btn.textContent = T('Copied'); setTimeout(() => { btn.textContent = was; }, 1400); };
  try{ navigator.clipboard.writeText(tsv).then(done, () => toast(T('The table could not be copied. Select it and copy instead.'), 'error', 5000)); }
  catch(e){ toast(T('The table could not be copied. Select it and copy instead.'), 'error', 5000); }
}
function _mtblOpen(t){
  const rows = _mtblRows(t);
  _loadSheet().then(ok => {
    if(!ok){ toast(T('The spreadsheet editor could not be loaded. Check your connection and try again.'), 'error', 6000); return; }
    openSheetEditor(rows, T('Table from AMV'));
  });
}
document.addEventListener('click', e => {
  const box = e.target.closest && e.target.closest('.mtbl'); if(!box) return;
  const t = box.querySelector('table'); if(!t) return;
  const b = e.target.closest('[data-tbl]');
  if(b){ if(b.dataset.tbl === 'copy') _mtblCopy(t, b); else if(b.dataset.tbl === 'sheet') _mtblOpen(t); return; }
  const th = e.target.closest('th'); if(th && t.contains(th)) _mtblSort(th);
});
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const th = e.target.closest && e.target.closest('.mtbl th'); if(!th) return;
  e.preventDefault(); _mtblSort(th);
});
