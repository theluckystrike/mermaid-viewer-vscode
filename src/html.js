'use strict';
// Builds the preview page. Strict CSP: no remote source of any kind, scripts only by nonce, no connect, no frames,
// no workers. style-src allows inline styles because Mermaid writes a <style> element and style attributes into
// each SVG; with img-src, font-src and connect-src closed to remote hosts, a style cannot load or send anything.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function csp(cspSource, nonce) {
  return [
    "default-src 'none'",
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

const THEMES = [['auto', 'Auto (follow VS Code)'], ['default', 'Default'], ['dark', 'Dark'], ['forest', 'Forest'], ['neutral', 'Neutral'], ['base', 'Base']];
const BACKGROUNDS = [['theme', 'Editor color'], ['white', 'White'], ['transparent', 'Transparent'], ['custom', 'Custom']];
const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');

/**
 * o: { cspSource, scriptUri, mermaidUri, styleUri, title, theme, background, custom, mermaidVersion, showSupportLinks, nonce? }
 */
function buildHtml(o) {
  const nonce = o.nonce || crypto.randomBytes(16).toString('base64');
  const footer = footerHtml('mermaidViewer', o.showSupportLinks !== false, '');
  const custom = /^#[0-9a-f]{6}$/i.test(o.custom || '') ? o.custom : '#f5f5f0';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp(o.cspSource, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(o.styleUri)}">
${footer ? `<style nonce="${esc(nonce)}">${FOOTER_CSS}\n.zovo-support{flex:0 0 auto;text-align:right;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.35))}</style>` : ''}
<title>${esc(o.title || 'Mermaid Viewer')}</title>
</head>
<body data-bg="${esc(o.background || 'theme')}">
<div id="app">
  <div id="toolbar" role="toolbar" aria-label="Mermaid preview">
    <select id="block" class="hidden" aria-label="Diagram in this Markdown file"></select>
    <label class="grp" title="Mermaid theme. A theme set in the diagram itself wins.">Theme
      <select id="theme" aria-label="Mermaid theme">${opts(THEMES, o.theme || 'auto')}</select></label>
    <label class="grp" title="Background of the preview and of exported files">Background
      <select id="bg" aria-label="Background">${opts(BACKGROUNDS, o.background || 'theme')}</select>
      <input id="bgColor" type="color" value="${esc(custom)}" aria-label="Custom background color" class="${o.background === 'custom' ? '' : 'hidden'}"></label>
    <span class="grp zoomgrp">
      <button id="zoomOut" title="Zoom out (-)" aria-label="Zoom out">−</button>
      <span id="zoomLabel" title="Zoom">100%</span>
      <button id="zoomIn" title="Zoom in (+)" aria-label="Zoom in">+</button>
      <button id="fit" title="Fit to window (0)">Fit</button>
      <button id="actual" title="Actual size (1)">100%</button>
    </span>
    <span class="grp"><button id="exportBtn" aria-haspopup="true" aria-expanded="false" title="Save or copy the diagram">Export ▾</button></span>
    <span id="status" aria-live="polite"><span id="version">Mermaid ${esc(o.mermaidVersion || '')}</span><span id="info"></span></span>
  </div>
  <div id="exportMenu" class="hidden" role="dialog" aria-label="Export">
    <div class="row"><span class="lbl">Scale</span>
      <label><input type="radio" name="scale" value="1"> 1x</label>
      <label><input type="radio" name="scale" value="2" checked> 2x</label>
      <label><input type="radio" name="scale" value="4"> 4x</label></div>
    <div class="row"><label class="lbl" for="maxW">Max width</label><input id="maxW" type="number" min="16" max="32000" step="1" placeholder="none"> px</div>
    <div class="row"><label class="lbl" for="maxH">Max height</label><input id="maxH" type="number" min="16" max="32000" step="1" placeholder="none"> px</div>
    <div class="row note" id="pngSize"></div>
    <div class="row actions">
      <button id="savePng" class="primary">Save PNG</button>
      <button id="copyPng">Copy PNG</button>
      <button id="saveSvg">Save SVG</button>
      <button id="copySvg">Copy SVG code</button>
    </div>
  </div>
  <div id="problem" class="hidden" role="alert"></div>
  <div id="viewport" tabindex="0" aria-label="Diagram. Scroll to zoom, drag to pan.">
    <div id="stage"></div>
  </div>
  <div id="list" class="hidden" tabindex="0" aria-label="All Mermaid diagrams in this file"></div>
  <div id="empty">Drawing…</div>
  ${footer}
</div>
<script nonce="${nonce}" src="${esc(o.mermaidUri)}"></script>
<script nonce="${nonce}" src="${esc(o.scriptUri)}"></script>
</body>
</html>`;
}

/** A page with no script at all, shown after a render ran over the time limit. */
function stoppedHtml(o) {
  const nonce = o.nonce || crypto.randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp(o.cspSource, nonce))}">
<style nonce="${esc(nonce)}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;line-height:1.5}code{font-family:var(--vscode-editor-font-family)}</style>
</head><body><h3>${esc(o.heading || 'Drawing stopped')}</h3><p>${esc(o.message)}</p><p>${esc(o.hint || 'Change the file, or close this preview and open it again, to try once more.')}</p></body></html>`;
}

module.exports = { buildHtml, stoppedHtml, csp, esc, THEMES, BACKGROUNDS };
