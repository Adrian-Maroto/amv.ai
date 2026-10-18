/* AMV's Office exporter - loaded on demand.

   Fetched the first time somebody presses Export (see _loadOffice in the app),
   not shipped in the page: every visitor downloads the page, and only the ones
   who export need this. It runs in the page's own scope, wrapped so none of
   its names can collide with the app's, and it publishes what the app calls
   on window. */
(function(){
'use strict';
/* ── MAKING OFFICE FILES ─────────────────────────────────────────────────────

   The other half of the Office promise. AMV reads .docx/.xlsx/.pptx (see
   05b-file-reader.js); this writes them, from an answer, with no library: an
   Office file is a ZIP of XML, a ZIP can be written STORED (no compression),
   and every part below is the smallest the format allows that Word, Excel and
   PowerPoint open without a repair prompt.

   What is converted is the answer's own structure - headings, paragraphs,
   bold and italic, lists, code, tables - not a picture of it. A table becomes
   a real table in Word and real cells in Excel (numbers as numbers, formulas
   as formulas); a deck is one slide per "##" heading with its points as
   bullets. Text that XML 1.0 cannot hold is dropped rather than producing a
   file that refuses to open. */

/* ── ZIP, stored ───────────────────────────────────────────────────────── */
const _CRC_T = (() => { const t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function _crc32(b){ let c = 0xFFFFFFFF; for(let i = 0; i < b.length; i++) c = _CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function _zipStore(files){
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for(const [name, content] of files){
    const data = typeof content === 'string' ? enc.encode(content) : content, nm = enc.encode(name), crc = _crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nm, data); central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdLen = central.reduce((n, p) => n + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
  return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]));
}

/* XML 1.0 refuses most control characters; one in an answer must not make the
   whole file unopenable. */
const _x = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const _R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const _rels = list => _XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + list.map(([id, type, t]) => '<Relationship Id="' + id + '" Type="' + _R + '/' + type + '" Target="' + t + '"/>').join('') + '</Relationships>';
const _types = (over) => _XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + over.map(([p, t]) => '<Override PartName="' + p + '" ContentType="application/vnd.openxmlformats-officedocument.' + t + '+xml"/>').join('') + '</Types>';

/* ── Markdown, into blocks and runs ─────────────────────────────────────── */
function _mdBlocks(md){
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  while(i < lines.length){
    const l = lines[i];
    if(/^\s*```/.test(l)){ const buf = []; i++; while(i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]); i++; out.push({ t: 'code', text: buf.join('\n') }); continue; }
    let m;
    if((m = /^(#{1,6})\s+(.*)$/.exec(l))){ out.push({ t: 'h', level: m[1].length, text: m[2].trim() }); i++; continue; }
    if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)){ out.push({ t: 'hr' }); i++; continue; }
    if(isRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])){
      const rows = [];
      while(i < lines.length && isRow(lines[i])){
        if(!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')));
        i++;
      }
      out.push({ t: 'table', rows }); continue;
    }
    if((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l))){
      const ordered = /\d/.test(m[2]), items = [];
      while(i < lines.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]))){ items.push({ level: Math.min(2, Math.floor(m[1].length / 2)), text: m[3] }); i++; }
      out.push({ t: ordered ? 'ol' : 'ul', items }); continue;
    }
    if(!l.trim()){ i++; continue; }
    const buf = [l.trim()]; i++;
    while(i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*([-*+]|\d+[.)])\s)/.test(lines[i]) && !isRow(lines[i])) buf.push(lines[i++].trim());
    out.push({ t: 'p', text: buf.join(' ') });
  }
  return out;
}
/* Inline runs: **bold**, *italic*, `code`, [text](link) -> text (link). */
function _mdRuns(s){
  const runs = [], re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  s = String(s || '');
  while((m = re.exec(s))){
    if(m.index > last) runs.push({ text: s.slice(last, m.index) });
    const t = m[0];
    if(/^(\*\*|__)/.test(t)) runs.push({ text: t.slice(2, -2), b: true });
    else if(t[0] === '`') runs.push({ text: t.slice(1, -1), code: true });
    else if(t[0] === '['){ const k = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t); runs.push({ text: k[1] + ' (' + k[2] + ')' }); }
    else runs.push({ text: t.slice(1, -1), i: true });
    last = m.index + t.length;
  }
  if(last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}
const _plain = s => _mdRuns(s).map(r => r.text).join('');

/* ── Word ───────────────────────────────────────────────────────────────── */
function _wRuns(s){
  return _mdRuns(s).map(r => '<w:r>' + (r.b || r.i || r.code ? '<w:rPr>' + (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '')
    + (r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '') + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + _x(r.text) + '</w:t></w:r>').join('');
}
const _wP = (inner, style, extra) => '<w:p>' + (style || extra ? '<w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (extra || '') + '</w:pPr>' : '') + inner + '</w:p>';
function amvDocx(md, title){
  const body = [];
  if(title) body.push(_wP(_wRuns(title), 'Title'));
  for(const b of _mdBlocks(md)){
    if(b.t === 'h') body.push(_wP(_wRuns(b.text), 'Heading' + Math.min(3, b.level)));
    else if(b.t === 'p') body.push(_wP(_wRuns(b.text)));
    else if(b.t === 'hr') body.push(_wP('', null, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr>'));
    else if(b.t === 'code') body.push(...b.text.split('\n').map(l => _wP('<w:r><w:t xml:space="preserve">' + _x(l) + '</w:t></w:r>', 'Code')));
    else if(b.t === 'ul' || b.t === 'ol') body.push(...b.items.map(it => _wP(_wRuns(it.text), 'ListParagraph',
      '<w:numPr><w:ilvl w:val="' + it.level + '"/><w:numId w:val="' + (b.t === 'ul' ? 1 : 2) + '"/></w:numPr>')));
    else if(b.t === 'table'){
      const w = Math.max(...b.rows.map(r => r.length));
      body.push('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>'
        + '<w:gridCol w:w="' + Math.floor(9360 / w) + '"/>'.repeat(w) + '</w:tblGrid>'
        + b.rows.map((r, ri) => '<w:tr>' + Array.from({ length: w }, (_, ci) => '<w:tc><w:tcPr><w:tcW w:w="' + Math.floor(9360 / w) + '" w:type="dxa"/></w:tcPr>'
          + _wP(ri === 0 ? _wRuns('**' + _plain(r[ci] || '') + '**') : _wRuns(r[ci] || '')) + '</w:tc>').join('') + '</w:tr>').join('')
        + '</w:tbl>', _wP(''));
    }
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const st = (id, name, rpr, ppr, extra) => '<w:style w:type="paragraph"' + (id === 'Normal' ? ' w:default="1"' : '') + ' w:styleId="' + id + '"><w:name w:val="' + name + '"/>' + (extra === undefined ? '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' : extra)
    + '<w:qFormat/>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '</w:style>';
  const styles = _XH + '<w:styles ' + W + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + st('Normal', 'Normal', '', '', '')
    + st('Title', 'Title', '<w:b/><w:sz w:val="48"/>', '<w:spacing w:after="240"/>')
    + st('Heading1', 'heading 1', '<w:b/><w:sz w:val="36"/>', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>')
    + st('Heading2', 'heading 2', '<w:b/><w:sz w:val="30"/>', '<w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/>')
    + st('Heading3', 'heading 3', '<w:b/><w:sz w:val="26"/>', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>')
    + st('ListParagraph', 'List Paragraph', '', '<w:spacing w:after="60"/><w:ind w:left="720"/>')
    + st('Code', 'Code', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>', '<w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>')
    + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>').join('')
    + '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
  const lvl = (i, fmt, txt) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + txt + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * i) + '" w:hanging="360"/></w:pPr></w:lvl>';
  const numbering = _XH + '<w:numbering ' + W + '>'
    + '<w:abstractNum w:abstractNumId="0">' + [0, 1, 2].map(i => lvl(i, 'bullet', ['•', '◦', '▪'][i])).join('') + '</w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="1">' + [0, 1, 2].map(i => lvl(i, ['decimal', 'lowerLetter', 'lowerRoman'][i], '%' + (i + 1) + '.')).join('') + '</w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const doc = _XH + '<w:document ' + W + ' xmlns:r="' + _R + '"><w:body>' + (body.join('') || _wP(''))
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  return _zipStore([
    ['[Content_Types].xml', _types([['/word/document.xml', 'wordprocessingml.document.main'], ['/word/styles.xml', 'wordprocessingml.styles'], ['/word/numbering.xml', 'wordprocessingml.numbering']])],
    ['_rels/.rels', _rels([['rId1', 'officeDocument', 'word/document.xml']])],
    ['word/_rels/document.xml.rels', _rels([['rId1', 'styles', 'styles.xml'], ['rId2', 'numbering', 'numbering.xml']])],
    ['word/document.xml', doc], ['word/styles.xml', styles], ['word/numbering.xml', numbering],
  ]);
}

/* ── Excel ──────────────────────────────────────────────────────────────── */
function _colName(i){ let s = ''; i++; while(i > 0){ const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
/* Every table in the answer becomes a sheet; with none, a CSV block does. */
function _mdTables(md){
  const t = _mdBlocks(md).filter(b => b.t === 'table').map(b => b.rows.map(r => r.map(_plain)));
  if(t.length) return t;
  const csv = /```(?:csv)?\n([\s\S]*?)```/.exec(String(md || ''));
  if(csv && /,/.test(csv[1])) return [csv[1].trim().split('\n').map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter(Boolean).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')))];
  return [];
}
function amvHasTable(md){ return _mdTables(md).length > 0; }
function amvXlsx(md, names){ return _xlsx(_mdTables(md), names); }
/* The spreadsheet editor hands its rows over directly - a cell may hold a
   pipe or a line break that a markdown table could not. */
function _xlsx(tables, names){
  if(!tables.length) return null;
  const sheet = rows => _XH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
      const ref = _colName(ci) + (ri + 1), s = String(v == null ? '' : v).trim(), bold = ri === 0 ? ' s="1"' : '';
      if(s === '') return '';
      if(/^=/.test(s) && ri > 0) return '<c r="' + ref + '"><f>' + _x(s.slice(1)) + '</f></c>';
      /* A number is stored as a number - money and percentages too - so the
         sheet can add it up. Anything ambiguous stays text, as typed. */
      const num = s.replace(/^[$€£¥]\s?/, '').replace(/(?<=\d),(?=\d{3}\b)/g, '');
      /* Shown the way it was written: 12% stays a percentage, 1,200 keeps its separator. */
      if(ri > 0 && /^-?\d+(\.\d+)?%?$/.test(num)){
        const pct = num.endsWith('%'), sty = pct ? ' s="2"' : (/\d,\d{3}/.test(s) ? ' s="3"' : '');
        return '<c r="' + ref + '"' + sty + '><v>' + (pct ? parseFloat(num) / 100 : num) + '</v></c>';
      }
      return '<c r="' + ref + '" t="inlineStr"' + bold + '><is><t xml:space="preserve">' + _x(s) + '</t></is></c>';
    }).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const used = new Set();
  const nameOf = (n, i) => { let b = String(n || ('Sheet ' + (i + 1))).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || ('Sheet ' + (i + 1)), k = b, j = 2; while(used.has(k.toLowerCase())) k = b.slice(0, 28) + ' ' + j++; used.add(k.toLowerCase()); return k; };
  const sheetNames = tables.map((_, i) => nameOf((names || [])[i], i));
  const files = [
    ['[Content_Types].xml', _types([['/xl/workbook.xml', 'spreadsheetml.sheet.main'], ['/xl/styles.xml', 'spreadsheetml.styles']]
      .concat(tables.map((_, i) => ['/xl/worksheets/sheet' + (i + 1) + '.xml', 'spreadsheetml.worksheet'])))],
    ['_rels/.rels', _rels([['rId1', 'officeDocument', 'xl/workbook.xml']])],
    ['xl/workbook.xml', _XH + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + _R + '"><sheets>'
      + sheetNames.map((n, i) => '<sheet name="' + _x(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', _rels(tables.map((_, i) => ['rId' + (i + 1), 'worksheet', 'worksheets/sheet' + (i + 1) + '.xml']).concat([['rId' + (tables.length + 1), 'styles', 'styles.xml']]))],
    ['xl/styles.xml', _XH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ];
  tables.forEach((rows, i) => files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheet(rows)]));
  return _zipStore(files);
}

/* ── PowerPoint ─────────────────────────────────────────────────────────── */
/* One slide per "##" (or "#") heading; its lists and paragraphs become the
   points. With no headings at all, the answer is one titled slide. */
function _mdSlides(md, title){
  const slides = []; let cur = null;
  for(const b of _mdBlocks(md)){
    if(b.t === 'h' && b.level <= 2){ cur = { title: _plain(b.text), points: [] }; slides.push(cur); continue; }
    if(!cur){ cur = { title: title || 'Overview', points: [] }; slides.push(cur); }
    if(b.t === 'h') cur.points.push({ text: _plain(b.text), level: 0, b: true });
    else if(b.t === 'p') cur.points.push({ text: _plain(b.text), level: 0 });
    else if(b.t === 'ul' || b.t === 'ol') b.items.forEach(it => cur.points.push({ text: _plain(it.text), level: it.level }));
    else if(b.t === 'table') b.rows.forEach(r => cur.points.push({ text: r.map(_plain).join('  ·  '), level: 0 }));
    else if(b.t === 'code') cur.points.push({ text: b.text.split('\n').slice(0, 8).join('\n'), level: 0 });
  }
  return slides.length ? slides : [{ title: title || 'Slide', points: [] }];
}
function amvPptx(md, title){
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"', RR = 'xmlns:r="' + _R + '"';
  const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  /* The title is a title placeholder, so it is the slide's title to
     PowerPoint's outline, navigation and screen readers - not just large text. */
  const box = (id, name, x, y, w, h, paras, title) => '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/>'
    + (title ? '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr>' : '<p:cNvSpPr txBox="1"/><p:nvPr/>') + '</p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
    + '<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + paras + '</p:txBody></p:sp>';
  const slides = _mdSlides(md, title).slice(0, 60);
  const slideXml = s => _XH + '<p:sld ' + A + ' ' + P + ' ' + RR + '><p:cSld><p:spTree>' + grp
    + box(2, 'Title', 457200, 304800, 8229600, 1066800, '<a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>' + _x(s.title) + '</a:t></a:r></a:p>', true)
    + box(3, 'Content', 457200, 1447800, 8229600, 4876800, (s.points.length ? s.points.slice(0, 14) : [{ text: '', level: 0 }]).map(pt =>
        '<a:p><a:pPr marL="' + (342900 + 342900 * pt.level) + '" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>'
        + '<a:r><a:rPr lang="en-US" sz="' + (pt.level ? 1600 : 2000) + '"' + (pt.b ? ' b="1"' : '') + '/><a:t>' + _x(pt.text) + '</a:t></a:r></a:p>').join(''))
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  const clr = (n, v) => '<a:' + n + '><a:srgbClr val="' + v + '"/></a:' + n + '>';
  const fill3 = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const theme = _XH + '<a:theme ' + A + ' name="AMV"><a:themeElements><a:clrScheme name="AMV">'
    + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
    + clr('dk2', '1F2937') + clr('lt2', 'F3F4F6') + clr('accent1', '3B6FE0') + clr('accent2', '10B981') + clr('accent3', 'F59E0B')
    + clr('accent4', 'EF4444') + clr('accent5', '8B5CF6') + clr('accent6', '14B8A6') + clr('hlink', '2563EB') + clr('folHlink', '7C3AED')
    + '</a:clrScheme><a:fontScheme name="AMV"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
    + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    + '<a:fmtScheme name="AMV"><a:fillStyleLst>' + fill3 + '</a:fillStyleLst><a:lnStyleLst>'
    + '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3) + '</a:lnStyleLst>'
    + '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst>'
    + '<a:bgFillStyleLst>' + fill3 + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
  const master = _XH + '<p:sldMaster ' + A + ' ' + P + ' ' + RR + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + grp + '</p:spTree></p:cSld>'
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
  const layout = _XH + '<p:sldLayout ' + A + ' ' + P + ' ' + RR + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + grp + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  const pres = _XH + '<p:presentation ' + A + ' ' + P + ' ' + RR + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + '<p:sldIdLst>' + slides.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 3) + '"/>').join('') + '</p:sldIdLst>'
    + '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  const files = [
    ['[Content_Types].xml', _types([['/ppt/presentation.xml', 'presentationml.presentation.main'], ['/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster'],
      ['/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout'], ['/ppt/theme/theme1.xml', 'theme']]
      .concat(slides.map((_, i) => ['/ppt/slides/slide' + (i + 1) + '.xml', 'presentationml.slide'])))],
    ['_rels/.rels', _rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['ppt/presentation.xml', pres],
    ['ppt/_rels/presentation.xml.rels', _rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml']]
      .concat(slides.map((_, i) => ['rId' + (i + 3), 'slide', 'slides/slide' + (i + 1) + '.xml'])))],
    ['ppt/slideMasters/slideMaster1.xml', master],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', _rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', layout],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', _rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', theme],
  ];
  slides.forEach((s, i) => { files.push(['ppt/slides/slide' + (i + 1) + '.xml', slideXml(s)]); files.push(['ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', _rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])]); });
  return _zipStore(files);
}

/* ── EDITING THE FILE SOMEBODY GAVE YOU ─────────────────────────────────────

   The round trip. A Word document, a workbook or a deck comes in; the person
   asks for a change; the SAME file goes back with only that change in it -
   its styles, pictures, headers, comments, charts and everything else AMV
   did not touch copied across as the original's own bytes. Exporting an
   answer (above) makes a new file from text; this keeps theirs.

   Word and PowerPoint change by text: "find" must be text in one paragraph
   (or one slide's paragraph) and, unless every copy is meant, appear exactly
   once - an edit that might land in the wrong place is refused and the reason
   given, never guessed. The new text takes the formatting of the text it
   replaces. A new paragraph is a copy of the one it follows, so it has that
   paragraph's style, without its pictures, notes, bookmarks or fields.
   Excel changes by cell: numbers stay numbers, "=..." is a formula, and the
   cell keeps its format. A cell that starts a shared formula, sits under a
   merge or names a table's column is refused by name rather than producing a
   file Excel has to repair.

   Nothing is called done until the new file is opened again, by the same
   reader that read the original, and each change is found in it. */
const _OE_MAX_CHANGES = 200, _OE_MAX_TEXT = 5000;
const _OE_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const _XMLNS = 'http://www.w3.org/XML/1998/namespace';
class _OeStop extends Error {}

async function _oeDeflate(bytes){
  if(typeof CompressionStream === 'undefined') return null;
  try{ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
  catch(e){ return null; }
}
/* A new package: every part that did not change is copied as the original's
   own compressed bytes, with its own checksum - not re-encoded - so "nothing
   else changed" is true to the byte. */
async function _oeRepack(z, changed, drop){
  const enc = new TextEncoder(), src = new DataView(z.buf), parts = [], central = [];
  let off = 0, count = 0;
  for(const [key, e] of z.entries){
    if(drop.has(key)) continue;
    let data, method, crc, usize;
    if(changed.has(key)){
      const raw = changed.get(key);
      crc = _crc32(raw); usize = raw.length;
      const d = await _oeDeflate(raw);
      if(d && d.length < raw.length){ data = d; method = 8; } else { data = raw; method = 0; }
    } else {
      if(e.flags & 1) throw new _OeStop('This file is locked with a password, so AMV cannot change it.');
      if((e.method !== 0 && e.method !== 8) || e.off + 30 > z.buf.byteLength || src.getUint32(e.off, true) !== 0x04034b50)
        throw new _OeStop('Part of this file is stored in a way AMV cannot copy, so nothing was changed.');
      const start = e.off + 30 + src.getUint16(e.off + 26, true) + src.getUint16(e.off + 28, true);
      if(start + e.csize > z.buf.byteLength) throw new _OeStop('This file is damaged, so nothing was changed.');
      data = new Uint8Array(z.buf, start, e.csize); method = e.method; crc = e.crc; usize = e.usize;
    }
    const nm = enc.encode(e.name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, usize, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, usize, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nm, data); central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length; count++;
  }
  const cdLen = central.reduce((n, p) => n + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true);
  e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
  return await new Blob(parts.concat(central, [new Uint8Array(e.buffer)])).arrayBuffer();
}
const _oeSer = doc => new TextEncoder().encode(_XH + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));

/* ── Word and PowerPoint: paragraphs as text, mapped back to their runs ── */
const _OE_FIXED_W = { tab: '\t', br: '\n', cr: '\n', noBreakHyphen: '-' };
const _OE_SKIP_W = new Set(['p', 'del', 'moveFrom', 'delText', 'instrText', 'rPr', 'pPr']);
const _OE_SKIP_A = new Set(['p', 'pPr', 'rPr', 'endParaRPr']);
/* The paragraph's text as the reader shows it, piece by piece. A piece is a
   text element that can change, or something fixed (a tab, a line break, a
   field's result) that an edit may sit beside but not cut through. */
function _oePieces(p, word){
  const out = [];
  const walk = (node, fixed) => {
    for(const c of Array.from(node.children)){
      const ln = c.localName;
      if(ln === 't'){ out.push({ node: c, text: c.textContent, fixed }); continue; }
      if(word && _OE_FIXED_W[ln] != null){ out.push({ node: null, text: _OE_FIXED_W[ln], fixed: true }); continue; }
      if(!word && ln === 'br'){ out.push({ node: null, text: '\n', fixed: true }); continue; }
      if((word ? _OE_SKIP_W : _OE_SKIP_A).has(ln)) continue;
      walk(c, fixed || ln === 'fldSimple' || ln === 'fld');
    }
  };
  walk(p, false);
  return out;
}
const _oeJoin = pieces => pieces.map(x => x.text).join('');
/* The paragraphs that can be changed. Word writes a text box twice - once for
   itself and once as a fallback for old readers - and only the first counts,
   or every edit inside one would read as appearing twice. */
function _oeParas(doc, word){
  return _xAll(doc, 'p').filter(p => (word ? true : /drawingml/.test(p.namespaceURI || ''))
    && !(function up(n){ for(; n; n = n.parentNode) if(n.localName === 'Fallback') return true; return false; })(p.parentNode));
}
function _oeSetText(piece, text, word){
  piece.node.textContent = text; piece.text = text;
  if(word) piece.node.setAttributeNS(_XMLNS, 'xml:space', 'preserve');
}
/* Replace [s, e) in a paragraph, or insert at s when the range is empty.
   False when the range cuts something fixed. */
function _oeSplice(pieces, s, e, text, word){
  let pos = 0;
  const spans = pieces.map(x => { const a = pos; pos += x.text.length; return { x, a, b: pos }; });
  const can = h => !h.x.fixed && h.x.node;
  if(s === e){
    /* Pure insertion: into the text before it, so it reads in that text's style. */
    const h = spans.find(h => can(h) && s > h.a && s <= h.b) || spans.find(h => can(h) && s >= h.a && s < h.b);
    if(!h) return false;
    _oeSetText(h.x, h.x.text.slice(0, s - h.a) + text + h.x.text.slice(s - h.a), word);
    return true;
  }
  const hit = spans.filter(h => h.b > s && h.a < e);
  if(!hit.length || hit.some(h => !can(h))) return false;
  const first = hit[0], last = hit[hit.length - 1];
  const tail = last.x.text.slice(e - last.a);
  if(first === last){ _oeSetText(first.x, first.x.text.slice(0, s - first.a) + text + tail, word); return true; }
  _oeSetText(first.x, first.x.text.slice(0, s - first.a) + text, word);
  for(const h of hit.slice(1, -1)) _oeSetText(h.x, '', word);
  _oeSetText(last.x, tail, word);
  return true;
}
/* Only what differs is replaced: "monthly by the 5th" to "monthly by the 1st"
   changes the 5, so "monthly" keeps its bold and nothing new takes it on. */
function _oeTrim(find, rep){
  let p = 0; const max = Math.min(find.length, rep.length);
  while(p < max && find[p] === rep[p]) p++;
  let q = 0;
  while(q < max - p && find[find.length - 1 - q] === rep[rep.length - 1 - q]) q++;
  const hi = c => c >= 0xD800 && c <= 0xDBFF;
  if(p && hi(find.charCodeAt(p - 1))) p--;
  if(q && hi(find.charCodeAt(find.length - q - 1))) q--;
  return { p, q, text: rep.slice(p, rep.length - q) };
}
function _oeCount(hay, needle){ let n = 0, i = 0; if(!needle) return 0; while((i = hay.indexOf(needle, i)) >= 0){ n++; i += needle.length; } return n; }
/* A new paragraph after `p`, with p's look and none of what must stay single:
   pictures, notes, comments, bookmarks, fields, section breaks, ids. */
const _OE_CLONE_DROP = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference',
  'footnoteReference', 'endnoteReference', 'drawing', 'pict', 'object', 'fldSimple', 'fldChar', 'instrText', 'tab', 'br', 'cr',
  'AlternateContent', 'sectPr', 'fld', 'proofErr', 'permStart', 'permEnd']);
function _oeParaAfter(p, text, word){
  const np = p.cloneNode(true);
  for(const el of Array.from(np.getElementsByTagName('*'))){ if(_OE_CLONE_DROP.has(el.localName) && el.parentNode) el.parentNode.removeChild(el); }
  for(const a of Array.from(np.attributes)){ if(a.localName === 'paraId' || a.localName === 'textId') np.removeAttributeNode(a); }
  const pieces = _oePieces(np, word).filter(x => !x.fixed && x.node);
  if(pieces.length){ _oeSetText(pieces[0], text, word); for(const x of pieces.slice(1)) _oeSetText(x, '', word); }
  else {
    const ns = np.namespaceURI, r = np.ownerDocument.createElementNS(ns, (np.prefix ? np.prefix + ':' : '') + 'r');
    const t = np.ownerDocument.createElementNS(ns, (np.prefix ? np.prefix + ':' : '') + 't');
    t.textContent = text; if(word) t.setAttributeNS(_XMLNS, 'xml:space', 'preserve');
    r.appendChild(t);
    const end = _xKid(np, 'endParaRPr');
    np.insertBefore(r, end || null);
  }
  p.parentNode.insertBefore(np, p.nextSibling);
  return np;
}

/* The parts that hold the text: Word's main document; every slide of a deck,
   in order. Notes, headers and footers are not changed yet - said, not hidden. */
async function _oeTextParts(z, main, format){
  if(format === 'docx') return [main];
  const pres = await _zipXml(z, main), rels = await _zipRels(z, main), out = [];
  for(const sid of _xAll(pres, 'sldId')){ const r = rels.get(_xRid(sid)); if(r) out.push(r.path); }
  return out;
}
async function _oeEditText(z, main, format, changes, applied, refused){
  const word = format === 'docx';
  const paths = await _oeTextParts(z, main, format);
  const docs = [];
  for(const path of paths){ const doc = await _zipXml(z, path); if(doc) docs.push({ path, doc }); }
  const all = () => { const out = []; for(const d of docs) for(const p of _oeParas(d.doc, word)) out.push({ d, p }); return out; };
  const touched = new Set();
  const where = word ? 'the document' : 'the slides';
  for(const ch of changes){
    if(ch.after != null){
      const after = String(ch.after), lines = String(ch.insert == null ? '' : ch.insert).split('\n').map(l => l.replace(_OE_CTRL, '')).filter(l => l.trim());
      if(!after.trim() || !lines.length){ refused.push({ change: ch, why: 'An insert needs "after" (text from the paragraph it follows) and "insert" (the new text).' }); continue; }
      const hits = all().filter(x => _oeJoin(_oePieces(x.p, word)).includes(after));
      if(hits.length !== 1){ refused.push({ change: ch, why: hits.length ? '"' + after.slice(0, 80) + '" is in ' + hits.length + ' paragraphs; quote more of the one meant.' : '"' + after.slice(0, 80) + '" is not in ' + where + '.' }); continue; }
      let at = hits[0].p;
      for(const line of lines) at = _oeParaAfter(at, line, word);
      touched.add(hits[0].d);
      applied.push({ kind: 'insert', after, insert: lines.join('\n') });
      continue;
    }
    const find = String(ch.find == null ? '' : ch.find), rep = String(ch.with == null ? '' : ch.with).replace(_OE_CTRL, '');
    if(!find){ refused.push({ change: ch, why: 'Say which text to change ("find").' }); continue; }
    if(find === rep){ refused.push({ change: ch, why: '"' + find.slice(0, 80) + '" would be replaced by the same text.' }); continue; }
    if(/\n/.test(rep)){ refused.push({ change: ch, why: 'The new text has a line break; change one paragraph at a time, or add paragraphs with "after" and "insert".' }); continue; }
    const paras = all().map(x => ({ x, text: _oeJoin(_oePieces(x.p, word)) }));
    const n = paras.reduce((k, q) => k + _oeCount(q.text, find), 0);
    if(!n){ refused.push({ change: ch, why: '"' + find.slice(0, 80) + '" is not in ' + where + ' as one piece of text' + (word ? ' (footnotes, comments, headers and footers cannot be changed yet)' : ' (speaker notes cannot be changed yet)') + '.' }); continue; }
    if(n > 1 && !ch.all){ refused.push({ change: ch, why: '"' + find.slice(0, 80) + '" appears ' + n + ' times; quote more of the one meant, or say every copy is meant.' }); continue; }
    let done = 0, blocked = 0;
    const cut = _oeTrim(find, rep);
    for(const q of paras){
      if(!q.text.includes(find)) continue;
      const starts = []; for(let i = q.text.indexOf(find); i >= 0; i = q.text.indexOf(find, i + find.length)) starts.push(i);
      for(const s of starts.reverse()){
        const pieces = _oePieces(q.x.p, word);
        if(_oeSplice(pieces, s + cut.p, s + find.length - cut.q, cut.text, word)){ done++; touched.add(q.x.d); } else blocked++;
      }
    }
    if(!done){ refused.push({ change: ch, why: '"' + find.slice(0, 80) + '" runs across a tab, a line break or a field; change the text on either side of it.' }); continue; }
    applied.push({ kind: 'replace', find, with: rep, count: done, blocked, before: n });
  }
  const out = new Map();
  for(const d of touched) out.set(d.path.toLowerCase(), _oeSer(d.doc));
  return out;
}

/* ── Excel: cells ───────────────────────────────────────────────────────── */
const _OE_REF = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const _oeNum = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;
function _oeRange(ref){
  const [a, b] = String(ref || '').toUpperCase().split(':'); const m1 = _OE_REF.exec(a || ''), m2 = _OE_REF.exec(b || a || '');
  if(!m1 || !m2) return null;
  return { c1: _xlsxColIndex(a), r1: +m1[2], c2: _xlsxColIndex(b || a), r2: +m2[2] };
}
/* Rows and cells may leave out their own address; given them, so a new one
   can be put in its place. The addresses are the ones they already had. */
function _oeNumber(sheetData){
  let nextR = 1;
  for(const row of _xKids(sheetData, 'row')){
    const r = +(_xAttr(row, 'r') || nextR); nextR = r + 1;
    if(!row.getAttribute('r')) row.setAttribute('r', String(r));
    let nextC = 0;
    for(const c of _xKids(row, 'c')){
      const ref = c.getAttribute('r'); const ci = ref ? _xlsxColIndex(ref) : nextC; nextC = ci + 1;
      if(!ref) c.setAttribute('r', _xlsxColName(ci) + r);
    }
  }
}
function _oeCell(doc, sheetData, ref, r, ci){
  const ns = doc.documentElement.namespaceURI, mk = n => doc.createElementNS(ns, n);
  let row = _xKids(sheetData, 'row').find(x => +x.getAttribute('r') === r);
  if(!row){
    row = mk('row'); row.setAttribute('r', String(r));
    sheetData.insertBefore(row, _xKids(sheetData, 'row').find(x => +x.getAttribute('r') > r) || null);
  }
  let c = _xKids(row, 'c').find(x => x.getAttribute('r') === ref);
  if(!c){
    c = mk('c'); c.setAttribute('r', ref);
    row.insertBefore(c, _xKids(row, 'c').find(x => _xlsxColIndex(x.getAttribute('r')) > ci) || _xKid(row, 'extLst') || null);
  }
  return c;
}
/* What a value means in a cell, decided once and used both to write it and to
   check it was written. */
function _oeMeaning(value){
  if(value == null || value === '') return { kind: 'empty' };
  if(typeof value === 'boolean') return { kind: 'bool', v: value ? '1' : '0' };
  if(typeof value === 'number') return isFinite(value) ? { kind: 'num', v: String(value) } : null;
  const s = String(value).replace(_OE_CTRL, '');
  if(s.length > 1 && s[0] === '=') return s.length > 8192 ? null : { kind: 'formula', v: s.slice(1) };
  if(_oeNum.test(s.trim())) return { kind: 'num', v: String(Number(s.trim())) };
  const text = s[0] === "'" ? s.slice(1) : s;
  return text.length > 32767 ? null : { kind: 'text', v: text };
}
function _oeWrite(doc, c, m){
  const ns = doc.documentElement.namespaceURI, mk = n => doc.createElementNS(ns, n);
  for(const k of Array.from(c.children)) if(k.localName !== 'extLst') c.removeChild(k);
  c.removeAttribute('t');
  const ext = _xKid(c, 'extLst'), put = el => c.insertBefore(el, ext || null);
  if(m.kind === 'empty') return;
  if(m.kind === 'formula'){ const f = mk('f'); f.textContent = m.v; put(f); return; }
  if(m.kind === 'text'){ c.setAttribute('t', 'inlineStr'); const is = mk('is'), t = mk('t'); t.textContent = m.v; t.setAttributeNS(_XMLNS, 'xml:space', 'preserve'); is.appendChild(t); put(is); return; }
  if(m.kind === 'bool') c.setAttribute('t', 'b');
  const v = mk('v'); v.textContent = m.v; put(v);
}
function _oeRead(c){
  if(!c) return { kind: 'empty' };
  const f = _xKid(c, 'f'), v = _xKid(c, 'v'), t = c.getAttribute('t');
  if(f) return { kind: 'formula', v: f.textContent };
  if(t === 'inlineStr') return { kind: 'text', v: _xAll(_xKid(c, 'is'), 't').map(x => x.textContent).join('') };
  if(!v) return { kind: 'empty' };
  return { kind: t === 'b' ? 'bool' : 'num', v: v.textContent };
}
async function _oeSheets(z, main){
  const wb = await _zipXml(z, main), rels = await _zipRels(z, main), out = [];
  for(const sh of _xAll(wb, 'sheet')){ const rel = rels.get(_xRid(sh)); if(rel && /\/worksheet$/.test(rel.type)) out.push({ name: _xAttr(sh, 'name') || '', path: rel.path }); }
  return { wb, rels, sheets: out };
}
async function _oeEditCells(z, main, changes, applied, refused){
  const { wb, rels, sheets } = await _oeSheets(z, main);
  if(!sheets.length) throw new _OeStop('This workbook has no sheet with cells AMV can change.');
  const out = new Map(), open = new Map();
  const sheetOf = async (name) => {
    const s = name == null || name === '' ? sheets[0] : sheets.find(x => x.name.toLowerCase() === String(name).trim().toLowerCase());
    if(!s) return null;
    if(!open.has(s.path)){
      const doc = await _zipXml(z, s.path), data = doc && _xAll(doc, 'sheetData')[0];
      if(!data) return null;
      _oeNumber(data);
      const merges = _xAll(doc, 'mergeCell').map(m => _oeRange(_xAttr(m, 'ref'))).filter(Boolean);
      const heads = [];
      const sRels = await _zipRels(z, s.path);
      for(const v of sRels.values()){
        if(!/\/table$/.test(v.type)) continue;
        const t = await _zipXml(z, v.path), tbl = t && t.documentElement, rg = tbl && _oeRange(_xAttr(tbl, 'ref'));
        if(rg && (_xAttr(tbl, 'headerRowCount') || '1') !== '0') heads.push(Object.assign({}, rg, { r2: rg.r1 }));
      }
      open.set(s.path, { s, doc, data, merges, heads, touched: false });
    }
    return open.get(s.path);
  };
  const inside = (g, ci, r) => ci >= g.c1 && ci <= g.c2 && r >= g.r1 && r <= g.r2;
  for(const ch of changes){
    const ref = String(ch.cell || '').trim().toUpperCase().replace(/\$/g, ''), m = _OE_REF.exec(ref);
    const sh = await sheetOf(ch.sheet);
    if(!sh){ refused.push({ change: ch, why: 'There is no sheet called "' + String(ch.sheet).slice(0, 60) + '". The sheets are: ' + sheets.map(x => x.name).join(', ') + '.' }); continue; }
    if(!m){ refused.push({ change: ch, why: '"' + String(ch.cell || '').slice(0, 20) + '" is not a cell address like B4.' }); continue; }
    const r = +m[2], ci = _xlsxColIndex(ref);
    if(ci > 16383 || r > 1048576){ refused.push({ change: ch, why: ref + ' is past the edge of a sheet.' }); continue; }
    const mean = _oeMeaning(ch.value);
    if(!mean){ refused.push({ change: ch, why: 'That value is too long for a cell, or is not a number Excel can hold.' }); continue; }
    const merge = sh.merges.find(g => inside(g, ci, r) && !(g.c1 === ci && g.r1 === r));
    if(merge){ refused.push({ change: ch, why: ref + ' is hidden under merged cells; write to ' + _xlsxColName(merge.c1) + merge.r1 + ' instead.' }); continue; }
    if(sh.heads.some(g => inside(g, ci, r))){ refused.push({ change: ch, why: ref + ' is the name of a table column; renaming it has to be done in Excel itself.' }); continue; }
    const c = _oeCell(sh.doc, sh.data, ref, r, ci);
    const f = _xKid(c, 'f');
    if(f && (f.getAttribute('ref') || f.getAttribute('t') === 'array')){ refused.push({ change: ch, why: ref + ' starts a formula other cells share; change it in Excel itself.' }); continue; }
    _oeWrite(sh.doc, c, mean);
    sh.touched = true;
    applied.push({ kind: 'cell', sheet: sh.s.name, cell: ref, mean });
  }
  /* EVERY FORMULA'S SAVED RESULT GOES, IN EVERY SHEET.

     A formula cell carries the answer it had when the file was last saved.
     Excel works it out again when told to (below); LibreOffice, measured,
     does not - it showed the old total beside the new rent, and a new tax
     line worked out from that stale total. A wrong number in somebody's
     budget is worse than an empty one, so no reader is left anything to
     trust but the formula. Any sheet can point at the changed one. */
  if(applied.length){
    for(const s of sheets){
      const sh = await sheetOf(s.name);
      if(!sh) continue;
      for(const c of _xAll(sh.doc, 'c')){
        if(!_xKid(c, 'f')) continue;
        const v = _xKid(c, 'v');
        if(v){ c.removeChild(v); c.removeAttribute('t'); sh.touched = true; }
      }
    }
  }
  let any = false;
  for(const sh of open.values()) if(sh.touched){ out.set(sh.s.path.toLowerCase(), _oeSer(sh.doc)); any = true; }
  const drop = new Set();
  if(any){
    /* Excel works the formulas out again when it opens the file, and the list
       of which cells hold formulas is dropped - it is rebuilt, and a stale one
       is what makes Excel offer to "repair" a file. */
    const chain = _relOf(rels, 'calcChain');
    if(chain){
      drop.add(chain.toLowerCase());
      const relPath = main.replace(/[^/]*$/, '_rels/') + main.split('/').pop() + '.rels';
      const rd = await _zipXml(z, relPath);
      if(rd){ for(const x of _xAll(rd, 'Relationship')) if(/\/calcChain$/.test(x.getAttribute('Type') || '')) x.parentNode.removeChild(x); out.set(relPath.toLowerCase(), _oeSer(rd)); }
      const ct = await _zipXml(z, '[Content_Types].xml');
      if(ct){ for(const o of _xAll(ct, 'Override')) if((o.getAttribute('PartName') || '').replace(/^\/+/, '').toLowerCase() === chain.toLowerCase()) o.parentNode.removeChild(o); out.set('[content_types].xml', _oeSer(ct)); }
    }
    const root = wb.documentElement;
    let calc = _xKid(root, 'calcPr');
    if(!calc){
      calc = wb.createElementNS(root.namespaceURI, 'calcPr');
      const later = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'];
      root.insertBefore(calc, Array.from(root.children).find(k => later.includes(k.localName)) || null);
    }
    calc.setAttribute('fullCalcOnLoad', '1');
    out.set(main.toLowerCase(), _oeSer(wb));
  }
  return { out, drop };
}

/* ── Reading the result back ────────────────────────────────────────────── */
async function _oeCheck(buf, format, main, applied){
  try{ await _readOoxml(buf.slice(0), 'check'); }catch(e){ return 'the new file did not open again'; }
  const z = _zipOpen(buf);
  if(format === 'xlsx'){
    const { sheets } = await _oeSheets(z, main);
    for(const a of applied){
      const s = sheets.find(x => x.name === a.sheet), doc = s && await _zipXml(z, s.path);
      const c = doc && _xAll(doc, 'c').find(x => x.getAttribute('r') === a.cell);
      const got = _oeRead(c);
      if(got.kind !== a.mean.kind || (a.mean.kind !== 'empty' && got.v !== a.mean.v)) return a.cell + ' does not hold what was written';
    }
    return '';
  }
  const word = format === 'docx', texts = [];
  for(const path of await _oeTextParts(z, main, format)){ const d = await _zipXml(z, path); if(d) for(const p of _oeParas(d, word)) texts.push(_oeJoin(_oePieces(p, word))); }
  const all = texts.join('\n');
  for(const a of applied){
    if(a.kind === 'insert'){ for(const l of a.insert.split('\n')) if(!texts.includes(l)) return 'the new paragraph "' + l.slice(0, 40) + '" is not in it'; }
    else if(a.with && !all.includes(a.with)) return '"' + a.with.slice(0, 40) + '" is not in it';
    else if(!a.with.includes(a.find) && _oeCount(all, a.find) !== a.before - a.count) return '"' + a.find.slice(0, 40) + '" is still in it';
  }
  return '';
}

/* amvOfficeEdit(buffer, format, { changes, cells }) -> { buf?, applied, refused, verified, why? } */
async function amvOfficeEdit(buf, format, input){
  const applied = [], refused = [];
  try{
    const changes = (Array.isArray(input && input.changes) ? input.changes : []).slice(0, _OE_MAX_CHANGES);
    const cells = (Array.isArray(input && input.cells) ? input.cells : []).slice(0, _OE_MAX_CHANGES);
    for(const c of changes.concat(cells)) for(const k of ['find', 'with', 'after', 'insert']) if(c && typeof c[k] === 'string' && c[k].length > _OE_MAX_TEXT) throw new _OeStop('One change is longer than AMV makes in one go; split it into smaller changes.');
    const z = _zipOpen(buf.slice(0));
    const root = await _zipRels(z, '');
    let main = null; for(const v of root.values()) if(/\/officeDocument$/.test(v.type)){ main = v.path; break; }
    if(!main) throw new _OeStop('This file is not one AMV can change.');
    let changed = new Map(), drop = new Set();
    if(format === 'xlsx'){
      for(const c of changes) refused.push({ change: c, why: 'A workbook changes cell by cell; use "cells".' });
      if(cells.length){ const r = await _oeEditCells(z, main, cells, applied, refused); changed = r.out; drop = r.drop; }
    } else {
      for(const c of cells) refused.push({ change: c, why: 'Only a workbook has cells; change this file by its text.' });
      if(changes.length) changed = await _oeEditText(z, main, format, changes, applied, refused);
    }
    if(!applied.length) return { applied, refused, verified: false, why: refused.length ? '' : 'No change was asked for.' };
    const out = await _oeRepack(z, changed, drop);
    const bad = await _oeCheck(out, format, main, applied);
    if(bad) return { applied: [], refused, verified: false, why: 'The edited file was checked and ' + bad + ', so it was not offered.' };
    return { buf: out, applied, refused, verified: true };
  }catch(e){
    if(e instanceof _OeStop) return { applied: [], refused, verified: false, why: e.message };
    if(typeof _FrRefusal !== 'undefined' && e instanceof _FrRefusal) return { applied: [], refused, verified: false, why: _frReason(e.code, 'This file', e.extra) };
    try{ console.warn('[AMV] office edit failed', e); }catch(_){}
    return { applied: [], refused, verified: false, why: 'The file could not be changed. Nothing was altered.' };
  }
}

/* ── The chat's office_edit tool: what it tells the model, and the card ── */
function _officeEditName(name, n){
  const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  return base + ' (' + T('edited') + (n > 1 ? ' ' + n : '') + ')' + ext;
}
function _officeSays(a){
  if(a.kind === 'cell') return (a.sheet ? a.sheet + '!' : '') + a.cell + ' = ' + (a.mean.kind === 'empty' ? '(empty)' : a.mean.kind === 'formula' ? '=' + a.mean.v : a.mean.v);
  if(a.kind === 'insert') return 'new paragraph after "' + a.after.slice(0, 60) + '": "' + a.insert.slice(0, 120) + '"';
  return '"' + a.find.slice(0, 80) + '" -> "' + a.with.slice(0, 80) + '"' + (a.count > 1 ? ' (' + a.count + ' places)' : '') + (a.blocked ? ' (' + a.blocked + ' more left alone: they run across a tab, line break or field)' : '');
}
async function amvOfficeEditTool(input){
  const held = _officeHeld(String((input && input.file) || ''));
  if(!held){
    const open = [..._OFFICE_FILES.values()].map(h => '"' + h.name + '"');
    return { text:'No file called "' + String((input && input.file) || '').slice(0, 80) + '" is open in this tab. ' + (open.length ? 'Open: ' + open.join(', ') + '.' : 'Ask the person to attach the file itself again - a copy from their library is text only.') + ' Nothing was changed.', render:null };
  }
  const cur = held.versions[held.versions.length - 1];
  const r = await amvOfficeEdit(cur.buf, held.format, input || {});
  const refusedText = r.refused.map(x => '- ' + x.why).join('\n');
  if(!r.buf){
    return { text:'NOTHING was changed in ' + held.name + '. ' + (r.why || '') + (refusedText ? '\nRefused:\n' + refusedText : '') + '\nTell the person what was refused and why; do not say the file was edited.',
      render:'<div class="chat-run bad"><div class="chat-run-h">' + escH(T('{0} was not changed').replace('{0}', held.name)) + '</div><pre>' + escH([r.why || ''].concat(r.refused.map(x => x.why)).filter(Boolean).join('\n')) + '</pre></div>' };
  }
  const v = _officeKeep(held.name, r.buf, held.format);
  v.file = _officeEditName(held.name, held.versions.length - 1);
  const said = r.applied.map(_officeSays);
  return {
    text:'Edited ' + held.name + ' and checked it by opening the new file again. Changed:\n' + said.map(x => '- ' + x).join('\n')
      + (refusedText ? '\nNOT changed (refused):\n' + refusedText : '')
      + (held.format === 'xlsx' ? '\nEvery formula in the workbook is worked out again when it is opened in Excel, Google Sheets, Numbers or LibreOffice; a preview that does not calculate shows formula cells empty.' : '')
      + '\nThe edited file is ready to download below as "' + v.file + '". A further change builds on this version.',
    render:'<div class="chat-run oe-card"><div class="chat-run-h">' + escH(v.file) + '</div>'
      + '<ul class="oe-list">' + said.map(x => '<li>' + escH(x) + '</li>').join('') + '</ul>'
      + (r.refused.length ? '<p class="pj-note">' + escH(T('Not changed:')) + ' ' + escH(r.refused.map(x => x.why).join(' ')) + '</p>' : '')
      + '<button type="button" class="btn mc-mini" data-dact="amvOfficeSave" data-darg="' + escH(v.id) + '">' + escH(T('Download')) + '</button></div>'
  };
}
/* ── From a message, to a download ──────────────────────────────────────── */
function _exportName(text, ext){
  const first = (String(text || '').match(/^#{1,3}\s+(.+)$/m) || [])[1] || String(text || '').split('\n').find(l => l.trim()) || 'AMV';
  const base = _plain(first).replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60).replace(/\s+/g, ' ');
  return (base || 'AMV') + '.' + ext;
}
/* The download itself is _saveBlob (13-integrations.js), shared with every other export. */
function exportMsgAs(idx, kind){
  const m = getMsgs()[Number(idx)]; if(!m) return;
  const text = m.d || (typeof m.c === 'string' ? m.c : '');
  if(!text.trim()) return;
  let blob = null, ext = kind;
  if(kind === 'docx') blob = amvDocx(text);
  else if(kind === 'pptx') blob = amvPptx(text);
  else if(kind === 'xlsx'){
    blob = amvXlsx(text);
    if(!blob){ toast(T('This answer has no table to put in a spreadsheet. Ask for the data as a table, then export it.'), 'error', 6000); return; }
  } else { blob = new Blob([text], { type: 'text/markdown' }); ext = 'md'; }
  _saveBlob(blob, _exportName(text, ext));
}
function _exportMenu(idx, anchor){
  document.querySelectorAll('.ctxm').forEach(x => x.remove());
  const m = getMsgs()[Number(idx)] || {}, text = m.d || (typeof m.c === 'string' ? m.c : '');
  const menu = document.createElement('div');
  menu.className = 'ctxm'; menu.setAttribute('role', 'menu');
  const item = (k, label) => '<button type="button" class="ctxi" role="menuitem" data-exp="' + k + '">' + escH(label) + '</button>';
  menu.innerHTML = item('docx', T('Word document (.docx)')) + (amvHasTable(text) ? item('xlsx', T('Excel workbook (.xlsx)')) : '')
    + item('pptx', T('PowerPoint deck (.pptx)')) + item('md', T('Markdown (.md)'));
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => { menu.remove(); exportMsgAs(idx, b.dataset.exp); }));
  const close = e => { if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 30);
}
window.amvOfficeEdit = amvOfficeEdit; window.amvOfficeEditTool = amvOfficeEditTool;
window.amvDocx = amvDocx; window.amvXlsx = amvXlsx; window.amvPptx = amvPptx;
window.amvXlsxRows = _xlsx; window.amvHasTable = amvHasTable; window.amvExportMsgAs = exportMsgAs; window._amvExportMenu = _exportMenu;
})();
