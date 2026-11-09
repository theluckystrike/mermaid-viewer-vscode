'use strict';
// A small PDF writer for "Export to PDF": a title page with the list of diagrams, then one page per diagram
// with its JPEG image fitted to A4 (landscape for wide diagrams). Standard Helvetica fonts, so nothing is
// embedded except the images. Pure Node (Buffer only), so the tests can parse what it writes.

const A4 = [595.28, 841.89];
const MARGIN = 40;

/** Text for a PDF string in WinAnsi: printable ASCII and Latin-1 kept, other characters become '?'. */
function pdfText(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c <= 126) out += ch;
    else if (c >= 160 && c <= 255) out += '\\' + c.toString(8).padStart(3, '0');
    else if (c === 9) out += ' ';
    else out += '?';
  }
  return out;
}

/** Cut a line to about maxChars, with an ellipsis. Helvetica at 11 pt fits about 95 characters on A4. */
function clip(s, maxChars) { s = String(s || ''); return s.length > maxChars ? s.slice(0, maxChars - 3) + '...' : s; }

function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    i += 2 + len;
  }
  return null;
}

/**
 * o: { title, subtitle: [lines], date: Date, pages: [{ caption, jpeg: Buffer, pxPerPt?: number }] }
 * Returns a Buffer with the PDF. Pages with a bad JPEG get a page that says so instead of an image.
 */
function buildPdf(o) {
  const objs = []; // index = object number - 1; each a Buffer or string
  const add = v => { objs.push(v); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  const pages = o.pages || [];
  const total = () => titlePages.length + pages.length;

  // Title pages: title, subtitle lines, then the list of diagrams with their page numbers.
  const rows = pages.map((p, i) => ({ text: clip(p.caption || `Diagram ${i + 1}`, 82), page: i }));
  const titlePages = [];
  const firstRows = 36, nextRows = 52;
  titlePages.push(rows.slice(0, firstRows));
  for (let i = firstRows; i < rows.length; i += nextRows) titlePages.push(rows.slice(i, i + nextRows));

  function page(w, h, content, xobjects) {
    const stream = Buffer.from(content, 'latin1');
    const cid = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
    const xo = xobjects ? ' /XObject << ' + Object.entries(xobjects).map(([k, v]) => `/${k} ${v} 0 R`).join(' ') + ' >>' : '';
    const pid = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >>${xo} >> /Contents ${cid} 0 R >>`);
    pageIds.push(pid);
  }
  const footer = (w, n) => `BT /F1 9 Tf 0.45 g ${(w / 2 - 22).toFixed(2)} 20 Td (${pdfText(`Page ${n} of ${total()}`)}) Tj ET\n`;

  titlePages.forEach((list, ti) => {
    const [w, h] = A4;
    let y = h - MARGIN - 30;
    let c = '0 g\n';
    if (ti === 0) {
      c += `BT /F2 22 Tf ${MARGIN} ${y.toFixed(2)} Td (${pdfText(clip(o.title || 'Mermaid diagrams', 48))}) Tj ET\n`;
      y -= 26;
      for (const s of o.subtitle || []) { c += `BT /F1 11 Tf 0.3 g ${MARGIN} ${y.toFixed(2)} Td (${pdfText(clip(s, 95))}) Tj ET\n`; y -= 16; }
      y -= 14;
      c += `BT /F2 13 Tf 0 g ${MARGIN} ${y.toFixed(2)} Td (${pdfText(`${pages.length} diagram${pages.length === 1 ? '' : 's'}`)}) Tj ET\n`;
      y -= 22;
    } else {
      c += `BT /F2 13 Tf ${MARGIN} ${y.toFixed(2)} Td (${pdfText('Diagrams, continued')}) Tj ET\n`;
      y -= 22;
    }
    for (const r of list) {
      c += `BT /F1 11 Tf 0 g ${MARGIN} ${y.toFixed(2)} Td (${pdfText(r.text)}) Tj ET\n`;
      c += `BT /F1 11 Tf 0.4 g ${(w - MARGIN - 40).toFixed(2)} ${y.toFixed(2)} Td (${pdfText(String(titlePages.length + r.page + 1))}) Tj ET\n`;
      y -= 14.5;
    }
    c += footer(w, ti + 1);
    page(w, h, c);
  });

  pages.forEach((p, i) => {
    const size = jpegSize(p.jpeg);
    const wide = size && size.w > size.h;
    const [w, h] = wide ? [A4[1], A4[0]] : A4;
    let c = `BT /F2 12 Tf 0 g ${MARGIN} ${(h - MARGIN - 4).toFixed(2)} Td (${pdfText(clip(p.caption || `Diagram ${i + 1}`, wide ? 120 : 82))}) Tj ET\n`;
    let xo;
    if (size) {
      const cs = size.comps === 1 ? '/DeviceGray' : size.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${size.w} /Height ${size.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`), p.jpeg, Buffer.from('\nendstream')]));
      const boxW = w - 2 * MARGIN, boxH = h - 2 * MARGIN - 28;
      const ratio = p.pxPerPt > 0 ? p.pxPerPt : 2;
      const k = Math.min(boxW / size.w, boxH / size.h, 1 / ratio * 1.5);
      const dw = size.w * k, dh = size.h * k;
      const x = MARGIN + (boxW - dw) / 2, y = MARGIN + 10 + (boxH - dh);
      c += `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q\n`;
      xo = { Im1: img };
    } else {
      c += `BT /F1 11 Tf 0.6 0 0 rg ${MARGIN} ${(h - MARGIN - 30).toFixed(2)} Td (${pdfText(p.error || 'This diagram could not be drawn.')}) Tj ET\n`;
    }
    c += footer(w, titlePages.length + i + 1);
    page(w, h, c, xo);
  });

  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const d = o.date instanceof Date ? o.date : new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const info = add(`<< /Title (${pdfText(o.title || 'Mermaid diagrams')}) /Producer (Mermaid Viewer by Zovo) /CreationDate (${stamp}) >>`);

  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = parts[0].length;
  const offsets = [];
  objs.forEach((v, i) => {
    const body = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'latin1');
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    offsets.push(pos); parts.push(b); pos += b.length;
  });
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f '].concat(offsets.map(n => String(n).padStart(10, '0') + ' 00000 n ')).join('\n') + '\n';
  parts.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

module.exports = { buildPdf, jpegSize, pdfText };
