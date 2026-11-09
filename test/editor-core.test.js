'use strict';
// Pure parts of 0.2.0: block write-back, templates, completion data, the PDF writer and the SVG export helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/core/mermaid-text');
const { TEMPLATES } = require('../src/core/templates');
const { completions, family } = require('../src/core/complete');
const { buildPdf, jpegSize, pdfText } = require('../src/core/pdf');
const S = require('../media/svgtools.js');

test('blockEdit puts text back with the fence indent and the file line ends; empty and unclosed blocks work', () => {
  const md = '# T\r\n\r\n   ```mermaid\r\n   pie\r\n   ```\r\nafter\r\n~~~mermaid\r\nflowchart LR\r\n  a-->b';
  const [a, b] = T.findMermaidBlocks(md);
  assert.equal(a.indent, 3); assert.equal(a.fence, '```'); assert.equal(b.closed, false);
  assert.deepEqual(T.blockEdit(a, 'pie\n  "x": 1\n', '\r\n'), { startLine: 3, endLine: 4, text: '   pie\r\n     "x": 1\r\n' });
  assert.deepEqual(T.blockEdit(a, '', '\n'), { startLine: 3, endLine: 4, text: '' });
  assert.deepEqual(T.blockEdit(b, 'pie\r\n', '\n'), { startLine: 7, endLine: -1, text: 'pie' });
  assert.equal(T.blockEdit(a, 'a\n\nb', '\n').text, '   a\n\n   b\n', 'empty lines get no trailing spaces');
});

test('fenceConflict finds a line that would close the block; other fence kinds are fine', () => {
  const [bt] = T.findMermaidBlocks('```mermaid\npie\n```');
  const [tl] = T.findMermaidBlocks('~~~~mermaid\npie\n~~~~');
  assert.equal(T.fenceConflict(bt, 'pie\n```'), 1);
  assert.equal(T.fenceConflict(bt, 'pie\n   ````  '), 1);
  assert.equal(T.fenceConflict(bt, 'pie\n~~~'), -1);
  assert.equal(T.fenceConflict(tl, 'pie\n~~~'), -1, 'shorter than the 4-tilde fence');
  assert.equal(T.fenceConflict(tl, '~~~~~'), 0);
  assert.equal(T.fenceConflict(bt, 'A["x ``` y"]'), -1);
});

test('locateBlock: same index and text first, else the only block with that text, else null', () => {
  const blocks = T.findMermaidBlocks('```mermaid\npie\n```\n```mermaid\ngantt\n```\n```mermaid\npie\n```');
  assert.equal(T.locateBlock(blocks, 2, 'pie').index, 2);
  assert.equal(T.locateBlock(blocks, 0, 'gantt').index, 1, 'moved');
  assert.equal(T.locateBlock(blocks, 1, 'pie'), null, 'two candidates: refuse to guess');
  assert.equal(T.locateBlock(blocks, 0, 'flowchart'), null);
  assert.equal(T.normalizeBlockText('﻿a\r\nb\n'), 'a\nb');
});

test('templates: the 15 diagram types of the brief, each starts with its keyword', () => {
  const ids = TEMPLATES.map(t => t.id);
  assert.deepEqual(ids, ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'pie', 'mindmap', 'timeline', 'gitgraph', 'c4', 'sankey', 'xychart', 'block', 'architecture']);
  for (const t of TEMPLATES) {
    assert.equal(T.diagramType(t.text), t.keyword, t.id);
    assert.ok(family(t.keyword), t.id + ' has keyword completion');
    assert.ok(t.text.endsWith('\n') && !/\t/.test(t.text), t.id);
    assert.equal(T.refuseReason(t.text, { maxTextSize: 500000, maxEdges: 2000 }), '');
  }
});

test('completion: first line offers every type and template; after it, the family of the diagram', () => {
  const a = completions('', 0);
  assert.equal(a.stage, 'type');
  assert.equal(a.items.filter(i => i.kind === 'template').length, 15);
  assert.ok(a.items.find(i => i.label === 'flowchart (template)').insertText.startsWith('flowchart TD'));
  const b = completions('%% comment\n---\ntitle: x\n---\n', 4);
  assert.equal(b.stage, 'type', 'comments and front matter are skipped');
  const c = completions('---\ntitle: x\n---\ngantt\n  ', 4);
  assert.equal(c.family, 'gantt');
  assert.ok(c.items.some(i => i.label === 'dateFormat'));
  for (const [kw, fam] of [['graph LR', 'flowchart'], ['stateDiagram', 'state'], ['C4Container', 'c4'], ['xychart-beta', 'xychart'], ['requirementDiagram', 'requirement']]) assert.equal(completions(kw + '\n', 1).family, fam);
  const tpl = a.items.find(i => i.label === 'gantt (template)');
  assert.doesNotMatch(tpl.insertText.replace(/\\\$/g, ''), /\$/, 'a $ in a template is escaped for the snippet engine');
});

test('PDF: valid structure, xref offsets point at their objects, landscape for wide images, text escaped', () => {
  const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegSize(jpeg(300, 100)), { w: 300, h: 100, comps: 3 });
  assert.equal(jpegSize(Buffer.from('nope')), null);
  const pages = [{ caption: 'Diagram 1 (wide)', jpeg: jpeg(300, 100) }, { caption: 'Diagram 2 (tall)', jpeg: jpeg(100, 300) }, { caption: 'Diagram 3', error: 'Not drawn: x' }];
  const buf = buildPdf({ title: 'README (draft).md', subtitle: ['docs/README.md', 'Ümlaut and 中文'], pages, date: new Date(Date.UTC(2026, 10, 9)) });
  const s = buf.toString('latin1');
  assert.match(s, /^%PDF-1\.4\n/); assert.match(s, /%%EOF\n$/);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const offs = s.slice(startxref).split('\n').filter(l => / 00000 n $/.test(l)).map(l => Number(l.slice(0, 10)));
  offs.forEach((o, i) => assert.equal(s.slice(o, o + String(i + 1).length + 6), `${i + 1} 0 obj`));
  assert.match(s, /\/Count 4/);
  assert.match(s, /\/MediaBox \[0 0 841\.89 595\.28\]/, 'wide image page is landscape');
  assert.match(s, /\(README \\\(draft\\\)\.md\) Tj/);
  assert.match(s, /\\334mlaut and \?\?/);
  assert.match(s, /Page 4 of 4/);
  assert.equal(pdfText('a(b)\\c\t'), 'a\\(b\\)\\\\c ');
  // a long list spills onto more title pages
  const many = buildPdf({ title: 't', pages: Array.from({ length: 100 }, (_, i) => ({ caption: 'D' + i, error: 'x' })) }).toString('latin1');
  assert.match(many, /\/Count 103/);
  assert.match(many, /Diagrams, continued/);
});

test('SVG export helpers: compact keeps text, rounds geometry, minifies CSS, finds remote refs; PNG sizes are exact', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100.123456 50.98765"><!-- x --><style>\n#m .node rect {\n  fill: #fff ;\n  font-family: "trebuchet ms" , verdana;\n}\n</style><g transform="translate(10.555555, 20.444444)"><path d="M1.23456,2.34567L3.000001,4"/><text x="1.23456">Pi is 3.14159</text></g></svg>';
  const c = S.compactSvgText(svg);
  assert.match(c, /viewBox="0 0 100\.12 50\.99"/);
  assert.match(c, /translate\(10\.56, 20\.44\)/);
  assert.match(c, /d="M1\.23,2\.35L3,4"/);
  assert.match(c, />Pi is 3\.14159</, 'label text untouched');
  assert.match(c, /#m \.node rect\{fill: #fff;font-family: "trebuchet ms",verdana\}/);
  assert.doesNotMatch(c, /<!--/);
  assert.ok(c.length < svg.length);
  assert.deepEqual(S.externalRefs(svg), []);
  assert.deepEqual(S.externalRefs('<style>@import url("https://fonts.example/x.css");</style><image href="http://e/x.png"/>'), ['https://fonts.example/x.css', 'http://e/x.png']);
  assert.deepEqual(S.pngDims(640, 480, { width: 2000 }), { w: 2000, h: 1500, s: 3.125, capped: false });
  assert.equal(S.pngDims(640, 480, { height: 333 }).h, 333);
  assert.deepEqual(S.pngDims(640, 480, { width: 1000, height: 1000 }).w, 1000);
  assert.equal(S.pngDims(640, 480, { width: 1000, height: 300 }).h, 300);
  assert.equal(S.pngDims(640, 480, { scale: 4 }).w, 2560);
  assert.equal(S.pngDims(1000, 1000, { width: 32000 }).capped, true);
  const cfg = S.mermaidConfig({ theme: 'dark', plain: true });
  assert.equal(cfg.securityLevel, 'strict'); assert.equal(cfg.htmlLabels, false); assert.equal(cfg.flowchart.htmlLabels, false);
  assert.ok(cfg.secure.includes('securityLevel'));
  assert.equal(S.mermaidConfig({ theme: 'default' }).htmlLabels, undefined);
});
