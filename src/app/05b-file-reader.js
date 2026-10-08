/* ── READING WHAT SOMEBODY ATTACHES ─────────────────────────────────────────

   Every attachment used to go one of three ways: a picture, a PDF, or
   `readAsText`. A Word document, a spreadsheet and a slide deck are ZIP files
   of XML, so the third way handed the model the ZIP's raw bytes decoded as
   text - noise - while Help and the app catalog said AMV reads Word and Excel.
   The model then answered questions about a file it had never seen. That is
   worse than refusing: a confident answer with nothing under it.

   This reads the three Office formats for real and needs no library. A ZIP is
   a directory at the end of the file plus entries compressed with plain
   DEFLATE, which the browser already undoes (`DecompressionStream`). What it
   cannot read it refuses BY NAME, saying what to do instead, rather than
   decoding bytes as text. The format is decided by the file's first bytes and
   not by its name: a renamed file is read as what it is, and a file whose name
   promises something its bytes are not is refused rather than guessed at.

   Every entry is inflated against a running byte budget, counted from what
   actually comes out of the decompressor and never from the sizes the file
   declares - a ZIP bomb declares whatever it likes. */

const _FR_FILE_MAX   = 50 * 1024 * 1024;    /* what will be opened at all */
const _FR_ENTRY_MAX  = 64 * 1024 * 1024;    /* one part, inflated */
const _FR_TOTAL_MAX  = 160 * 1024 * 1024;   /* every part of one file, inflated */
const _FR_ENTRIES    = 20000;
const _FR_FORMULAS   = 2000;                /* listed per sheet; the rest are counted */
/* The most chat reads in one message, in parts - past it the send is refused
   anyway, so a file that extracts to more is refused here, where the reason
   can name the file. */
const _FR_TEXT_MAX   = (typeof LONG_MSG_PART !== 'undefined' && typeof LONG_MSG_MAX_PARTS !== 'undefined')
  ? LONG_MSG_PART * LONG_MSG_MAX_PARTS : 7200000;

const _FR_LABEL = { docx: 'Word document', xlsx: 'Excel workbook', pptx: 'PowerPoint deck' };

class _FrRefusal extends Error { constructor(code, extra){ super(code); this.code = code; this.extra = extra || ''; } }

/* What a person is told, per reason. Each says what the file is and what to do,
   because "could not read" on its own leaves them nowhere to go. */
function _frReason(code, name, extra){
  const n = '“' + name + '”';
  switch(code){
    case 'too_big':   return T('AMV can’t open') + ' ' + n + ': ' + T('it is too large to read in a chat. Split it into smaller files and attach those.');
    case 'too_long':  return n + ' ' + T('holds more text than AMV reads in one message. Split it into smaller files and attach those.');
    case 'locked':    return n + ' ' + T('is password-protected. Remove the password, save it, and attach it again.');
    case 'legacy':    return n + ' ' + T('is in the older Office format (.doc, .xls or .ppt), which AMV doesn’t read. Open it and save it as') + ' ' + (extra || '.docx, .xlsx or .pptx') + ', ' + T('then attach that.');
    case 'odf':       return n + ' ' + T('is an OpenDocument file, which AMV doesn’t read. Save it as .docx, .xlsx or .pptx and attach that.');
    case 'archive':   return n + ' ' + T('is an archive. AMV doesn’t open archives - unzip it and attach the files inside.');
    case 'audio':     return T('AMV can’t listen to audio files, so') + ' ' + n + ' ' + T('was not attached. Paste a transcript instead.');
    case 'video':     return T('AMV can’t watch video files, so') + ' ' + n + ' ' + T('was not attached.');
    case 'program':   return n + ' ' + T('is a program, not a document. AMV doesn’t open programs.');
    case 'image':     return n + ' ' + T('is a picture AMV can’t read. Save it as JPEG or PNG and attach that.');
    case 'not_image': return n + ' ' + T('is named like a picture, but it isn’t one. Nothing was attached.');
    case 'not_pdf':   return n + ' ' + T('is named like a PDF, but it isn’t one. Nothing was attached.');
    case 'old_browser': return T('This browser can’t unpack') + ' ' + n + '. ' + T('Update it, or use a current Chrome, Safari, Edge or Firefox.');
    case 'damaged':   return n + ' ' + T('looks damaged, so AMV couldn’t read it. Open it, save a fresh copy, and attach that.');
    default:          return T('AMV can’t read') + ' ' + n + (extra ? ' (' + extra + ')' : '') + '. ' + T('Attach a document, spreadsheet, slide deck, PDF, picture or text file.');
  }
}

/* ── Signatures ─────────────────────────────────────────────────────────── */
function _frStarts(b, sig, at){ at = at || 0; if(b.length < at + sig.length) return false; for(let i = 0; i < sig.length; i++){ if(b[at + i] !== sig[i]) return false; } return true; }
function _frAscii(b, s, at){ return _frStarts(b, Array.from(s, c => c.charCodeAt(0)), at); }
function _frSniff(b){
  if(_frStarts(b, [0xFF,0xFE]) || _frStarts(b, [0xFE,0xFF])) return '';   /* UTF-16 text, not an MP3 frame */
  if(_frAscii(b, '%PDF-')) return 'pdf';
  if(_frStarts(b, [0x50,0x4B,0x03,0x04]) || _frStarts(b, [0x50,0x4B,0x05,0x06])) return 'zip';
  if(_frStarts(b, [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1])) return 'ole';
  if(_frStarts(b, [0x89,0x50,0x4E,0x47])) return 'png';
  if(_frStarts(b, [0xFF,0xD8,0xFF])) return 'jpeg';
  if(_frAscii(b, 'GIF87a') || _frAscii(b, 'GIF89a')) return 'gif';
  if(_frAscii(b, 'RIFF') && _frAscii(b, 'WEBP', 8)) return 'webp';
  if(_frAscii(b, 'RIFF') && (_frAscii(b, 'WAVE', 8) || _frAscii(b, 'AVI ', 8))) return _frAscii(b, 'WAVE', 8) ? 'audio' : 'video';
  if(_frAscii(b, 'ID3') || _frAscii(b, 'fLaC') || _frAscii(b, 'OggS') || _frAscii(b, '#!AMR')
     || (b.length > 1 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio';
  if(_frAscii(b, 'ftyp', 4)){
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if(/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)/.test(brand)) return 'otherimage';
    return /^M4A |^M4B |^F4A /.test(brand) ? 'audio' : 'video';
  }
  if(_frStarts(b, [0x1A,0x45,0xDF,0xA3])) return 'video';            /* Matroska / WebM */
  if(_frStarts(b, [0x1F,0x8B]) || _frAscii(b, '7z\xBC\xAF') || _frAscii(b, 'Rar!')) return 'archive';
  if(_frAscii(b, 'MZ') || _frStarts(b, [0x7F,0x45,0x4C,0x46]) || _frStarts(b, [0xCF,0xFA,0xED,0xFE]) || _frStarts(b, [0xCA,0xFE,0xBA,0xBE])) return 'program';
  if(_frAscii(b, 'BM') || _frStarts(b, [0x49,0x49,0x2A,0x00]) || _frStarts(b, [0x4D,0x4D,0x00,0x2A])) return 'otherimage';
  return '';
}

/* ── ZIP ────────────────────────────────────────────────────────────────── */
function _zipOpen(buf){
  const dv = new DataView(buf), n = buf.byteLength;
  let eocd = -1;
  for(let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new _FrRefusal('damaged');
  const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  if(count === 0xFFFF || cdOff === 0xFFFFFFFF || count > _FR_ENTRIES) throw new _FrRefusal('too_big');
  const entries = new Map(), dec = new TextDecoder();
  let p = cdOff;
  for(let k = 0; k < count; k++){
    if(p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) throw new _FrRefusal('damaged');
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    if(p + 46 + nl > n) throw new _FrRefusal('damaged');
    const name = dec.decode(new Uint8Array(buf, p + 46, nl)).replace(/^\/+/, '');
    /* Part names in an Office file are case-insensitive, so they are looked up that way. */
    entries.set(name.toLowerCase(), { name, flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true),
                                      csize: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) });
    p += 46 + nl + el + cl;
  }
  return { buf, entries, spent: 0 };
}
async function _zipBytes(z, path){
  const e = z.entries.get(String(path || '').replace(/^\/+/, '').toLowerCase());
  if(!e) return null;
  if(e.flags & 1) throw new _FrRefusal('locked');
  const dv = new DataView(z.buf), n = z.buf.byteLength;
  if(e.off + 30 > n || dv.getUint32(e.off, true) !== 0x04034b50) throw new _FrRefusal('damaged');
  const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
  if(start + e.csize > n) throw new _FrRefusal('damaged');
  const raw = new Uint8Array(z.buf, start, e.csize);
  const spend = (k) => { z.spent += k; if(z.spent > _FR_TOTAL_MAX) throw new _FrRefusal('too_big'); };
  if(e.method === 0){ spend(raw.length); return raw; }
  if(e.method !== 8) throw new _FrRefusal('damaged');
  if(typeof DecompressionStream === 'undefined') throw new _FrRefusal('old_browser');
  let reader;
  try{ reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(); }
  catch(err){ throw new _FrRefusal('old_browser'); }
  const chunks = []; let total = 0;
  try{
    for(;;){
      const { done, value } = await reader.read();
      if(done) break;
      total += value.length;
      if(total > _FR_ENTRY_MAX){ throw new _FrRefusal('too_big'); }
      spend(value.length);
      chunks.push(value);
    }
  }catch(err){
    try{ reader.cancel(); }catch(_){}
    throw (err instanceof _FrRefusal) ? err : new _FrRefusal('damaged');
  }
  const out = new Uint8Array(total); let o = 0;
  for(const c of chunks){ out.set(c, o); o += c.length; }
  return out;
}
async function _zipXml(z, path){
  const bytes = await _zipBytes(z, path);
  if(!bytes) return null;
  const le = bytes[0] === 0xFF && bytes[1] === 0xFE, be = bytes[0] === 0xFE && bytes[1] === 0xFF;
  const text = new TextDecoder(le ? 'utf-16le' : be ? 'utf-16be' : 'utf-8').decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new _FrRefusal('damaged');
  return doc;
}

/* ── XML helpers. Office files are read by LOCAL name: the same document can
   be written in the transitional or the strict namespaces, and both mean the
   same thing. ── */
const _xKids = (el, ln) => el ? Array.from(el.children).filter(c => c.localName === ln) : [];
const _xKid  = (el, ln) => _xKids(el, ln)[0] || null;
const _xAll  = (el, ln) => el ? Array.from(el.getElementsByTagNameNS('*', ln)) : [];
/* By local name: Word writes w:val, Excel writes plain names. A plain name is
   preferred, and a relationship id never answers for anything but _xRid. */
function _xAttr(el, ln){
  if(!el) return null;
  let hit = null;
  for(const a of Array.from(el.attributes)){
    if(a.localName !== ln) continue;
    if(!a.prefix) return a.value;
    if(hit == null && !(a.namespaceURI && /relationships$/.test(a.namespaceURI))) hit = a.value;
  }
  return hit;
}
/* r:id. Matched on the relationships namespace (either flavour) because a slide
   id element carries BOTH a plain id and an r:id, and they are different things. */
function _xRid(el){
  if(!el) return null;
  for(const a of Array.from(el.attributes)){
    if(a.localName === 'id' && a.namespaceURI && /relationships$/.test(a.namespaceURI)) return a.value;
  }
  return null;
}
function _zipJoin(base, target){
  if(!target) return '';
  if(target.charAt(0) === '/') return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for(const seg of target.split('/')){
    if(seg === '..') parts.pop(); else if(seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
/* A part's relationships: id -> { path, type } for every internal target. */
async function _zipRels(z, part){
  const slash = part.lastIndexOf('/');
  const relPath = (slash >= 0 ? part.slice(0, slash + 1) : '') + '_rels/' + part.slice(slash + 1) + '.rels';
  const doc = await _zipXml(z, relPath);
  const out = new Map();
  if(!doc) return out;
  for(const r of _xAll(doc, 'Relationship')){
    if(/^external$/i.test(r.getAttribute('TargetMode') || '')) continue;
    out.set(r.getAttribute('Id'), { path: _zipJoin(part, r.getAttribute('Target') || ''), type: r.getAttribute('Type') || '' });
  }
  return out;
}
const _relOf = (rels, kind) => { for(const v of rels.values()){ if(v.type.endsWith('/' + kind)) return v.path; } return null; };

/* ── Word ───────────────────────────────────────────────────────────────── */
function _docxRunText(node){
  let s = '';
  for(const c of Array.from(node.children)){
    const ln = c.localName;
    if(ln === 't') s += c.textContent;
    else if(ln === 'tab') s += '\t';
    else if(ln === 'br' || ln === 'cr') s += '\n';
    else if(ln === 'noBreakHyphen') s += '-';
    else if(ln === 'del' || ln === 'moveFrom' || ln === 'delText' || ln === 'instrText' || ln === 'rPr' || ln === 'pPr') continue;
    else if(ln === 'p'){ const t = _docxRunText(c); if(t.trim()) s += (s ? '\n' : '') + t; }   /* a text box inside a run */
    else s += _docxRunText(c);
  }
  return s;
}
function _docxPara(p){
  const text = _docxRunText(p).replace(/[ \t]+$/g, '');
  if(!text.trim()) return '';
  const pPr = _xKid(p, 'pPr');
  const style = (_xAttr(_xKid(pPr, 'pStyle'), 'val') || '').toLowerCase();
  const h = /^heading\s?([1-6])$/.exec(style);
  if(h) return '#'.repeat(+h[1]) + ' ' + text.trim();
  if(style === 'title') return '# ' + text.trim();
  const num = _xKid(pPr, 'numPr');
  if(num){ const lvl = +(_xAttr(_xKid(num, 'ilvl'), 'val') || 0); return '  '.repeat(Math.min(lvl, 8)) + '- ' + text.trim(); }
  return text;
}
function _docxCell(tc){
  const bits = [];
  for(const c of Array.from(tc.children)){
    if(c.localName === 'p'){ const t = _docxRunText(c).trim(); if(t) bits.push(t); }
    else if(c.localName === 'tbl'){ bits.push(_docxTable(c).replace(/\n/g, ' ')); }
    else if(c.localName === 'sdt'){ bits.push(_docxCell(_xKid(c, 'sdtContent') || c)); }
  }
  return bits.join(' ').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}
function _docxTable(tbl){
  const rows = _xKids(tbl, 'tr').map(tr => _xKids(tr, 'tc').map(_docxCell));
  if(!rows.length) return '';
  const w = Math.max(...rows.map(r => r.length));
  const line = r => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
  return [line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line)].join('\n');
}
function _docxBlocks(container, out){
  for(const c of Array.from(container.children)){
    if(c.localName === 'p'){ const t = _docxPara(c); if(t) out.push(t); }
    else if(c.localName === 'tbl'){ const t = _docxTable(c); if(t) out.push(t); }
    else if(c.localName === 'sdt'){ _docxBlocks(_xKid(c, 'sdtContent') || c, out); }
    else if(c.localName === 'customXml' || c.localName === 'ins' || c.localName === 'smartTag'){ _docxBlocks(c, out); }
  }
}
async function _readDocx(z, main){
  const doc = await _zipXml(z, main);
  const body = doc && _xAll(doc, 'body')[0];
  if(!body) throw new _FrRefusal('damaged');
  const out = [];
  _docxBlocks(body, out);
  const rels = await _zipRels(z, main);
  /* Footnotes and comments carry content people ask about ("what did the
     reviewer say"), so they come along, labelled, after the body. */
  const extra = async (kind, label, item, who) => {
    const path = _relOf(rels, kind); if(!path) return;
    const d = await _zipXml(z, path); if(!d) return;
    const lines = [];
    for(const it of _xAll(d, item)){
      if(/separator/i.test(_xAttr(it, 'type') || '')) continue;     /* the rule above the notes, not content */
      const t = _xAll(it, 'p').map(p => _docxRunText(p).trim()).filter(Boolean).join(' ');
      if(t) lines.push('- ' + (who ? (_xAttr(it, 'author') || 'Someone') + ': ' : '') + t);
    }
    if(lines.length) out.push('## ' + label + '\n' + lines.join('\n'));
  };
  await extra('footnotes', 'Footnotes', 'footnote', false);
  await extra('endnotes', 'Endnotes', 'endnote', false);
  await extra('comments', 'Comments in the margin', 'comment', true);
  const text = out.join('\n\n');
  const words = (text.match(/\S+/g) || []).length;
  return { text, summary: words.toLocaleString() + ' ' + (words === 1 ? T('word') : T('words')) };
}

/* ── Excel ──────────────────────────────────────────────────────────────── */
function _xlsxColIndex(ref){
  const m = /^([A-Z]+)/i.exec(ref || ''); if(!m) return -1;
  let n = 0; for(const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function _xlsxColName(i){ let s = ''; i++; while(i > 0){ const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function _xlsxIsDateFormat(id, code){
  if((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
  if(!code) return false;
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '');
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}
function _xlsxDate(serial, date1904){
  if(!isFinite(serial)) return String(serial);
  /* 1900 system: serial 1 is 1900-01-01, and the format counts a 29 February
     1900 that never happened, so everything from 1 March 1900 is one day off. */
  const days = date1904 ? serial + 1462 : (serial < 60 ? serial + 1 : serial);
  const ms = Math.round((days - 25569) * 86400000);
  const d = new Date(ms);
  if(isNaN(d)) return String(serial);
  const iso = d.toISOString();
  if(serial < 1 && serial >= 0) return iso.slice(11, 19);
  return Math.abs(serial % 1) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}
const _csvCell = v => /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
async function _readXlsx(z, main){
  const wb = await _zipXml(z, main);
  if(!wb) throw new _FrRefusal('damaged');
  const rels = await _zipRels(z, main);
  const date1904 = /^(1|true)$/i.test(_xAttr(_xAll(wb, 'workbookPr')[0], 'date1904') || '');

  const shared = [];
  const ssPath = _relOf(rels, 'sharedStrings');
  const ss = ssPath && await _zipXml(z, ssPath);
  if(ss){
    /* Phonetic guides (rPh) hold furigana, not the cell's text. */
    for(const si of _xAll(ss, 'si')) shared.push(_xAll(si, 't').filter(t => !(t.parentNode && t.parentNode.localName === 'rPh')).map(t => t.textContent).join(''));
  }
  const dateStyle = [];
  const stPath = _relOf(rels, 'styles');
  const st = stPath && await _zipXml(z, stPath);
  if(st){
    const custom = new Map(_xAll(st, 'numFmt').map(f => [+_xAttr(f, 'numFmtId'), _xAttr(f, 'formatCode') || '']));
    const xfs = _xKid(_xAll(st, 'styleSheet')[0], 'cellXfs');
    for(const xf of _xKids(xfs, 'xf')){ const id = +(_xAttr(xf, 'numFmtId') || 0); dateStyle.push(_xlsxIsDateFormat(id, custom.get(id))); }
  }

  const out = []; let sheetCount = 0, cellCount = 0;
  for(const sh of _xAll(wb, 'sheet')){
    const name = _xAttr(sh, 'name') || ('Sheet ' + (sheetCount + 1));
    const state = _xAttr(sh, 'state');
    const rel = rels.get(_xRid(sh));
    sheetCount++;
    const head = '## ' + T('Sheet') + ' “' + name + '”' + (state && state !== 'visible' ? ' (' + T('hidden') + ')' : '');
    if(!rel || !/\/worksheet$/.test(rel.type)){ out.push(head + '\n' + T('(a chart sheet - no cells)')); continue; }
    const ws = await _zipXml(z, rel.path);
    const data = ws && _xAll(ws, 'sheetData')[0];
    const grid = new Map(); const formulas = []; let formulaCount = 0, maxR = 0, maxC = 0, nextR = 1;
    for(const row of _xKids(data, 'row')){
      const r = +(_xAttr(row, 'r') || nextR); nextR = r + 1;
      let nextC = 0;
      for(const c of _xKids(row, 'c')){
        const ref = _xAttr(c, 'r');
        const ci = ref ? _xlsxColIndex(ref) : nextC; nextC = ci + 1;
        const t = _xAttr(c, 't') || 'n';
        const vEl = _xKid(c, 'v'), raw = vEl ? vEl.textContent : '';
        let v;
        if(t === 's') v = shared[+raw] != null ? shared[+raw] : '';
        else if(t === 'inlineStr') v = _xAll(_xKid(c, 'is'), 't').map(x => x.textContent).join('');
        else if(t === 'b') v = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
        else if(t === 'str' || t === 'e' || t === 'd') v = raw;
        else v = (raw !== '' && dateStyle[+(_xAttr(c, 's') || 0)]) ? _xlsxDate(parseFloat(raw), date1904) : raw;
        const f = _xKid(c, 'f');
        if(f && f.textContent){
          formulaCount++;
          if(formulas.length < _FR_FORMULAS) formulas.push(_xlsxColName(ci) + r + ' = ' + f.textContent);
        }
        if(v === '' || v == null) continue;
        grid.set(r + ':' + ci, String(v));
        cellCount++;
        if(r > maxR) maxR = r; if(ci > maxC) maxC = ci;
      }
    }
    if(!grid.size){ out.push(head + '\n' + T('(empty)')); continue; }
    /* Rows and columns are kept where they are, so row 1 of the text is row 1
       of the sheet and the first column is A: a formula that says B7 points
       at something the model can find. */
    const lines = [];
    for(let r = 1; r <= maxR; r++){
      const cells = [];
      for(let c = 0; c <= maxC; c++) cells.push(_csvCell(grid.get(r + ':' + c) || ''));
      lines.push(cells.join(',').replace(/,+$/, ''));
    }
    let block = head + ' - ' + 'A1:' + _xlsxColName(maxC) + maxR + '\n```csv\n' + lines.join('\n') + '\n```';
    if(formulas.length){
      block += '\n' + T('Formulas') + ':\n' + formulas.join('\n');
      if(formulaCount > formulas.length) block += '\n… ' + (formulaCount - formulas.length).toLocaleString() + ' ' + T('more formulas not listed');
    }
    out.push(block);
    if(out.reduce((n, s) => n + s.length, 0) > _FR_TEXT_MAX) throw new _FrRefusal('too_long');
  }
  if(!sheetCount) throw new _FrRefusal('damaged');
  return {
    text: T('Each sheet is below as CSV. Row 1 is spreadsheet row 1 and the first column is column A; formulas are listed after the values they produce.') + '\n\n' + out.join('\n\n'),
    summary: sheetCount + ' ' + (sheetCount === 1 ? T('sheet') : T('sheets')) + ' · ' + cellCount.toLocaleString() + ' ' + T('cells'),
  };
}

/* ── PowerPoint ─────────────────────────────────────────────────────────── */
function _pptxPhType(sp){
  const ph = _xAll(sp, 'ph')[0];
  return ph ? (_xAttr(ph, 'type') || 'body') : '';
}
function _pptxParas(root, skip){
  const lines = [];
  for(const p of _xAll(root, 'p')){
    if(!p.namespaceURI || !/drawingml/.test(p.namespaceURI)) continue;
    if(skip && skip(p)) continue;
    let s = '';
    for(const c of _xAll(p, '*')){
      if(c.localName === 't' && /drawingml/.test(c.namespaceURI || '')) s += c.textContent;
      else if(c.localName === 'br') s += '\n';
    }
    s = s.trim();
    if(s) lines.push(s);
  }
  return lines;
}
async function _readPptx(z, main){
  const pres = await _zipXml(z, main);
  if(!pres) throw new _FrRefusal('damaged');
  const rels = await _zipRels(z, main);
  const ids = _xAll(pres, 'sldId');
  const out = []; let n = 0, words = 0;
  for(const sid of ids){
    const rel = rels.get(_xRid(sid));
    if(!rel) continue;
    const slide = await _zipXml(z, rel.path);
    if(!slide) continue;
    n++;
    const hidden = _xAttr(_xAll(slide, 'sld')[0], 'show') === '0';
    const shapes = _xAll(slide, 'sp');
    const titleShapes = shapes.filter(sp => /^(title|ctrTitle)$/.test(_pptxPhType(sp)));
    const inTitle = p => titleShapes.some(sp => sp.contains(p));
    const title = titleShapes.map(sp => _pptxParas(sp).join(' ')).join(' ').trim();
    const body = _pptxParas(slide, inTitle);
    let block = '## ' + T('Slide') + ' ' + n + (title ? ' - ' + title : '') + (hidden ? ' (' + T('hidden') + ')' : '');
    if(body.length) block += '\n' + body.join('\n');
    const sRels = await _zipRels(z, rel.path);
    const notesPath = _relOf(sRels, 'notesSlide');
    const notes = notesPath && await _zipXml(z, notesPath);
    if(notes){
      /* A notes page also holds the slide-number and header placeholders;
         only what the speaker wrote is wanted. */
      const skipShapes = _xAll(notes, 'sp').filter(sp => /^(sldNum|hdr|ftr|dt|sldImg)$/.test(_pptxPhType(sp)));
      const said = _pptxParas(notes, p => skipShapes.some(sp => sp.contains(p)));
      if(said.length) block += '\n' + T('Speaker notes') + ': ' + said.join(' ');
    }
    words += (block.match(/\S+/g) || []).length;
    out.push(block);
  }
  if(!n) throw new _FrRefusal('damaged');
  return { text: out.join('\n\n'), summary: n + ' ' + (n === 1 ? T('slide') : T('slides')) + ' · ' + words.toLocaleString() + ' ' + T('words') };
}

/* Which Office file a ZIP is, read from its own declaration of what its main
   part is - not from the file name. */
async function _readOoxml(buf, name){
  const z = _zipOpen(buf);
  if(z.entries.has('mimetype') && /opendocument/.test(new TextDecoder().decode(await _zipBytes(z, 'mimetype') || new Uint8Array()))) throw new _FrRefusal('odf');
  const root = await _zipRels(z, '');
  let main = null;
  for(const v of root.values()){ if(/\/officeDocument$/.test(v.type)){ main = v.path; break; } }
  if(!main) throw new _FrRefusal('archive');
  const types = await _zipXml(z, '[Content_Types].xml');
  let ct = '';
  if(types){
    for(const o of _xAll(types, 'Override')){
      if((o.getAttribute('PartName') || '').replace(/^\/+/, '').toLowerCase() === main.toLowerCase()){ ct = o.getAttribute('ContentType') || ''; break; }
    }
  }
  const kind = /wordprocessingml/.test(ct) ? 'docx' : /spreadsheetml/.test(ct) ? 'xlsx' : /presentationml/.test(ct) ? 'pptx'
    : /^word\//i.test(main) ? 'docx' : /^xl\//i.test(main) ? 'xlsx' : /^ppt\//i.test(main) ? 'pptx' : '';
  if(!kind) throw new _FrRefusal('unknown', 'an Office file AMV doesn’t recognise');
  const r = kind === 'docx' ? await _readDocx(z, main) : kind === 'xlsx' ? await _readXlsx(z, main) : await _readPptx(z, main);
  if(r.text.length > _FR_TEXT_MAX) throw new _FrRefusal('too_long');
  return Object.assign({ format: kind }, r);
}

/* ── Plain text, in whatever encoding it arrived ───────────────────────── */
function _frDecodeText(bytes){
  if(_frStarts(bytes, [0xFF,0xFE])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if(_frStarts(bytes, [0xFE,0xFF])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = bytes.subarray(0, 8192);
  /* A NUL byte, or a run of control characters, is a binary file - text in
     any 8-bit encoding has neither. */
  let ctrl = 0;
  for(const b of head){ if(b === 0) return null; if(b < 9 || (b > 13 && b < 32 && b !== 27)) ctrl++; }
  if(head.length && ctrl / head.length > 0.1) return null;
  try{ return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch(e){ return new TextDecoder('windows-1252').decode(bytes); }   /* an older spreadsheet's CSV */
}

/* A picture the engine cannot take (HEIC from an iPhone, BMP, TIFF) is redrawn
   as JPEG when this browser can decode it - Safari decodes HEIC - and refused
   by name when it cannot, instead of being sent as a type the engine rejects. */
async function _frReencodeImage(file){
  if(typeof createImageBitmap !== 'function') return null;
  try{
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bmp.width * scale)); cv.height = Math.max(1, Math.round(bmp.height * scale));
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    try{ bmp.close(); }catch(e){}
    const url = cv.toDataURL('image/jpeg', 0.9);
    return url.indexOf('data:image/jpeg;base64,') === 0 ? url.split(',')[1] : null;
  }catch(e){ return null; }
}

const _frB64 = (bytes) => {
  let s = ''; const CH = 0x8000;
  for(let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};

/* Read one file into an attachment, or a refusal that says why.
     { kind:'img', name, size, b64, mime }
     { kind:'pdf', name, size, b64, mime }
     { kind:'text', name, size, data, format?, summary? }
     { kind:'refused', name, reason }                                        */
async function amvReadFile(file){
  const name = String((file && file.name) || 'file');
  const size = (file && file.size) || 0;
  const refuse = (code, extra) => ({ kind: 'refused', name, code, reason: _frReason(code, name, extra) });
  try{
    if(size > _FR_FILE_MAX) return refuse('too_big');
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mime = String(file.type || '').toLowerCase();
    const sig = _frSniff(bytes);
    const namedImage = (mime.startsWith('image/') && !/svg/.test(mime)) || /^(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|avif)$/.test(ext);

    if(sig === 'png' || sig === 'jpeg' || sig === 'gif' || sig === 'webp')
      return { kind: 'img', name, size, b64: _frB64(bytes), mime: 'image/' + sig };
    if(sig === 'otherimage' || (namedImage && !sig)){
      const b64 = await _frReencodeImage(file);
      if(b64) return { kind: 'img', name, size, b64, mime: 'image/jpeg' };
      return refuse(sig === 'otherimage' ? 'image' : 'not_image');
    }
    if(sig === 'pdf') return { kind: 'pdf', name, size, b64: _frB64(bytes), mime: 'application/pdf' };
    if(ext === 'pdf' || mime === 'application/pdf') return refuse('not_pdf');
    if(sig === 'zip'){
      const r = await _readOoxml(buf, name);
      return { kind: 'text', name, size, data: r.text, format: r.format, summary: r.summary };
    }
    if(sig === 'ole'){
      /* A password-protected .docx/.xlsx/.pptx is stored in the older container,
         so the name is what tells the two apart. */
      if(/^(docx|docm|xlsx|xlsm|pptx|pptm)$/.test(ext)) return refuse('locked');
      return refuse('legacy', ext === 'xls' ? '.xlsx' : ext === 'ppt' ? '.pptx' : ext === 'doc' ? '.docx' : '');
    }
    if(sig === 'audio' || sig === 'video' || sig === 'archive' || sig === 'program') return refuse(sig);
    if(/^(docx|xlsx|pptx|docm|xlsm|pptm)$/.test(ext)) return refuse('damaged');
    /* The type the system reports is only consulted once the bytes are known
       not to be text: a TypeScript file arrives as video/mp2t on most systems. */
    const text = _frDecodeText(bytes);
    if(text == null){
      if(mime.startsWith('audio/')) return refuse('audio');
      if(mime.startsWith('video/')) return refuse('video');
      return refuse('unknown', T('not a text file'));
    }
    if(text.length > _FR_TEXT_MAX) return refuse('too_long');
    return { kind: 'text', name, size, data: text };
  }catch(err){
    if(err instanceof _FrRefusal) return refuse(err.code, err.extra);
    try{ console.warn('[AMV] reading ' + name + ' failed', err); }catch(e){}
    return refuse('damaged');
  }
}
try{ window.amvReadFile = amvReadFile; }catch(e){}
