'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHtml, batchHtml, stoppedHtml, csp } = require('../src/html');

const base = { cspSource: 'https://file+.vscode-resource.vscode-cdn.net', scriptUri: 'https://x/preview.js', mermaidUri: 'https://x/mermaid.min.js', toolsUri: 'https://x/svgtools.js', styleUri: 'https://x/preview.css', title: 'a<b>.mmd', theme: 'auto', background: 'theme', custom: '#112233', mermaidVersion: '12.3.0', nonce: 'NONCE123' };

test('CSP: nothing remote, no connect, no frames, no workers, scripts only by nonce', () => {
  const c = csp(base.cspSource, 'N');
  assert.match(c, /default-src 'none'/);
  assert.match(c, /script-src 'nonce-N'(;|$)/);
  for (const d of ['connect-src', 'frame-src', 'worker-src', 'object-src', 'form-action', 'base-uri', 'media-src']) assert.match(c, new RegExp(d + " 'none'"));
  assert.match(c, /img-src https:\/\/file\+\.vscode-resource\.vscode-cdn\.net blob: data:/);
  assert.doesNotMatch(c, /unsafe-eval/);
  assert.doesNotMatch(c.split(base.cspSource).join(''), /https?:/);
});

test('page: all 3 scripts carry the nonce, title is escaped, version shown, export menu has scale, size, text labels and PDF', () => {
  const h = buildHtml(base);
  const scripts = h.match(/<script[^>]*>/g);
  assert.equal(scripts.length, 3);
  assert.ok(scripts.every(s => s.includes('nonce="NONCE123"')));
  assert.ok(h.indexOf('mermaid.min.js') < h.indexOf('svgtools.js') && h.indexOf('svgtools.js') < h.indexOf('preview.js'));
  assert.match(h, /id="svgText" type="checkbox"/); assert.match(h, /id="savePdf"/);
  assert.match(h, /Width or height gives that exact size/);
  assert.match(h, /<title>a&lt;b&gt;\.mmd<\/title>/);
  assert.match(h, /Mermaid 12\.3\.0/);
  for (const v of ['1', '2', '4']) assert.match(h, new RegExp(`name="scale" value="${v}"`));
  assert.match(h, /id="maxW"/); assert.match(h, /id="maxH"/);
  assert.match(h, /id="copyPng"/); assert.match(h, /id="saveSvg"/);
  assert.match(h, /<option value="transparent">Transparent<\/option>/);
  assert.match(h, /value="#112233"/);
  assert.doesNotMatch(h, /\son\w+=/i);
});

test('page: support footer shows by default and hides with the setting', () => {
  assert.match(buildHtml(base), /id="zovo-support"[\s\S]*Rate[\s\S]*More free viewers[\s\S]*Zovo Pro, USD 19/);
  assert.doesNotMatch(buildHtml({ ...base, showSupportLinks: false }), /zovo-support"/);
});

test('page: a bad custom color falls back; toolbar values are fixed lists', () => {
  const h = buildHtml({ ...base, custom: 'red;}<script>' , theme: '"><script>', background: 'custom' });
  assert.match(h, /value="#f5f5f0"/);
  assert.equal((h.match(/<script/g) || []).length, 3);
});

test('export page: same CSP, 3 scripts by nonce, nothing remote', () => {
  const h = batchHtml({ cspSource: base.cspSource, mermaidUri: 'https://x/mermaid.min.js', toolsUri: 'https://x/svgtools.js', scriptUri: 'https://x/batch.js', nonce: 'N2' });
  assert.match(h, /default-src &#39;none&#39;/);
  assert.match(h, /connect-src &#39;none&#39;/);
  const scripts = h.match(/<script[^>]*>/g);
  assert.equal(scripts.length, 3);
  assert.ok(scripts.every(s => s.includes('nonce="N2"')));
  assert.match(h, /id="app"/);
});

test('stopped page has no script at all and escapes the message', () => {
  const h = stoppedHtml({ cspSource: base.cspSource, message: 'x <img src=y onerror=z>', heading: 'Not drawn' });
  assert.doesNotMatch(h, /<script/);
  assert.match(h, /&lt;img src=y onerror=z&gt;/);
  assert.match(h, /<h3>Not drawn<\/h3>/);
});

test('0.3.0: the Save PDF button has a Pro tag while locked and disappears with showProFeatures = false', () => {
  const base = { cspSource: 'vscode-res:', scriptUri: 's.js', mermaidUri: 'm.js', toolsUri: 't.js', styleUri: 'c.css', title: 'a.mmd', theme: 'auto', background: 'theme', custom: '#ffffff', mermaidVersion: '12.3.0' };
  const { buildHtml } = require('../src/html.js');
  assert.match(buildHtml(Object.assign({ pdf: 'pro' }, base)), /id="savePdf"[^>]*>Save PDF <span class="pro">Pro<\/span>/);
  assert.match(buildHtml(Object.assign({ pdf: 'free' }, base)), /id="savePdf"[^>]*>Save PDF<\/button>/);
  assert.doesNotMatch(buildHtml(Object.assign({ pdf: 'hide' }, base)), /savePdf/);
});
