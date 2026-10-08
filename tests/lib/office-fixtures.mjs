/* Office files built byte by byte, for the suites that read them.

   A .docx, .xlsx and .pptx are ZIP archives of XML. These are written here
   from first principles (local headers, central directory, DEFLATE) so a suite
   controls exactly what is inside: a tracked deletion, a hidden sheet, slides
   stored out of order, an entry that inflates to more than any document needs.
   tests/fixtures/office/ holds three more, written by independent open-source
   Office writers (a workbook, a document and a deck), so the reader is also
   held to what other software really produces rather than only to what these
   builders assume. They are committed as bytes; nothing here runs those
   writers. */
import { deflateRawSync, crc32 } from 'zlib';

export function zip(files, { store = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = store ? data : deflateRawSync(data);
    const nm = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, comp);
    centrals.push(ch, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const rels = (list) => X + `<Relationships xmlns="${PKG}">` +
  list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') + '</Relationships>';
const types = (overrides) => X + `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
  overrides.map(([part, ct]) => `<Override PartName="${part}" ContentType="${ct}"/>`).join('') + '</Types>';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wp = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
export function docx() {
  const body =
    wp('Quarterly plan', 'Heading1') +
    wp('Revenue grew in the north and held in the south.') +
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Hire two engineers</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">Budget is </w:t></w:r><w:del w:id="9" w:author="Ana"><w:r><w:delText>ninety</w:delText></w:r></w:del><w:ins w:id="10" w:author="Ana"><w:r><w:t>eighty</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> thousand.</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc>${wp('Region')}</w:tc><w:tc>${wp('Revenue')}</w:tc></w:tr><w:tr><w:tc>${wp('North')}</w:tc><w:tc>${wp('1,200')}</w:tc></w:tr></w:tbl>` +
    `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>See the appendix.</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>`;
  return zip({
    '[Content_Types].xml': types([
      ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
      ['/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'],
      ['/word/footnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': X + `<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    'word/_rels/document.xml.rels': rels([['rId1', 'comments', 'comments.xml'], ['rId2', 'footnotes', 'footnotes.xml']]),
    'word/comments.xml': X + `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Ben">${wp('Check these numbers')}</w:comment></w:comments>`,
    'word/footnotes.xml': X + `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1">${wp('Source: finance team')}</w:footnote></w:footnotes>`,
  });
}

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function xlsx({ bomb = false } = {}) {
  const files = {
    '[Content_Types].xml': types([
      ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
      ['/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
      ['/xl/worksheets/sheet2.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': X + `<workbook xmlns="${S}" xmlns:r="${REL}"><workbookPr/><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'],
      ['rId3', 'sharedStrings', 'sharedStrings.xml'], ['rId4', 'styles', 'styles.xml']]),
    'xl/sharedStrings.xml': X + `<sst xmlns="${S}"><si><t>Region</t></si><si><t>Revenue</t></si><si><t>North</t></si><si><r><t>Sou</t></r><r><t>th</t></r></si><si><t>Date</t></si></sst>`,
    'xl/styles.xml': X + `<styleSheet xmlns="${S}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': X + `<worksheet xmlns="${S}"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>4</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c><c r="C2" s="1"><v>45366</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>800</v></c></row>` +
      `<row r="4"><c r="A4" t="inlineStr"><is><t>Total, all regions</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>2000</v></c><c r="D4" t="b"><v>1</v></c></row>` +
      `</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': X + `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>internal note</t></is></c></row></sheetData></worksheet>`,
  };
  /* Seventy megabytes of one repeated row: the archive is a few hundred
     kilobytes and the part inside is larger than anything a reader should
     agree to build. */
  if (bomb) files['xl/worksheets/sheet2.xml'] = Buffer.alloc(70 * 1024 * 1024, 0x20);
  return zip(files);
}

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const sp = (ph, text) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${
  text.split('\n').map(t => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (shapes) => X + `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${REL}"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
export function pptx() {
  return zip({
    '[Content_Types].xml': types([
      ['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
      ['/ppt/slides/slide1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'],
      ['/ppt/slides/slide2.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'],
      ['/ppt/notesSlides/notesSlide1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    /* The deck's order is the list here, not the file names: slide2.xml is
       shown first. */
    'ppt/presentation.xml': X + `<p:presentation xmlns:p="${P}" xmlns:r="${REL}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml']]),
    'ppt/slides/slide2.xml': slide(sp('title', 'Why AMV') + sp('body', 'Reads real files\nAnswers from them')),
    'ppt/slides/slide1.xml': slide(sp('ctrTitle', 'Next steps') + sp('', 'Ship it on Friday')),
    'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', 'notesSlide', '../notesSlides/notesSlide1.xml']]),
    'ppt/notesSlides/notesSlide1.xml': X + `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${sp('body', 'Open with the customer story') + sp('sldNum', '1')}</p:spTree></p:cSld></p:notes>`,
  });
}
