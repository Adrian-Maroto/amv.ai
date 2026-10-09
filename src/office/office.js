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
window.amvDocx = amvDocx; window.amvXlsx = amvXlsx; window.amvPptx = amvPptx;
window.amvXlsxRows = _xlsx; window.amvHasTable = amvHasTable; window.amvExportMsgAs = exportMsgAs; window._amvExportMenu = _exportMenu;
})();
