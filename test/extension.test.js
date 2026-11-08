'use strict';
// Runs src/extension.js against a small fake of the VS Code API: open a preview, answer as the webview would,
// check diagnostics, the size guard, the binary fallback, the time limit, prefs and exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

function makeVscode(opts = {}) {
  const ev = () => { const ls = []; const f = l => { ls.push(l); return { dispose() { const i = ls.indexOf(l); if (i >= 0) ls.splice(i, 1); } }; }; f.fire = x => ls.forEach(l => l(x)); return f; };
  class Uri {
    constructor(scheme, p) { this.scheme = scheme; this.path = p; this.fsPath = p; }
    toString() { return `${this.scheme}://${this.path}`; }
    static file(p) { return new Uri('file', p); }
    static parse(s) { return new Uri('file', s.replace(/^file:\/\//, '')); }
    static joinPath(u, ...ps) { return new Uri(u.scheme, path.join(u.path, ...ps)); }
  }
  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range { constructor(a, b, c, d) { if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); } } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  const files = new Map(opts.files || []); // path -> Buffer
  const docs = [];
  const mkDoc = (uri, text, languageId) => { const lines = text.split('\n'); return { uri, languageId, version: 1, getText: () => text, lineCount: lines.length, lineAt: i => ({ text: lines[i] }) }; };
  const S = { diag: new Map(), panels: [], writes: [], info: [], warn: [], err: [], ctx: {}, opened: [], config: Object.assign({ updateDelayMs: 0 }, opts.config || {}), saveTarget: null, ws: new Map() };
  const commands = new Map();
  const E = { change: ev(), save: ev(), sel: ev(), close: ev(), cfg: ev(), active: ev() };
  const vscode = {
    Uri, Position, Range, Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1 }, ViewColumn: { Active: -1, Beside: -2, One: 1 }, TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    QuickPickItemKind: { Separator: -1 },
    env: { sessionId: 's', remoteName: undefined, openExternal: async () => true, clipboard: { writeText: async t => { S.clip = t; } } },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async (id, ...a) => { if (id === 'setContext') S.ctx[a[0]] = a[1]; } },
    languages: { createDiagnosticCollection: () => ({ set: (u, d) => S.diag.set(u.toString(), d), delete: u => S.diag.delete(u.toString()), dispose() {} }) },
    extensions: { getExtension: () => undefined },
    workspace: {
      textDocuments: docs,
      isTrusted: true,
      getConfiguration: () => ({ get: (k, d) => (k in S.config ? S.config[k] : d) }),
      openTextDocument: async u => {
        let d = docs.find(x => x.uri.toString() === u.toString());
        if (d) return d;
        const b = files.get(u.path);
        if (!b) throw new Error('not found');
        if (b.includes(0)) throw new Error('File seems to be binary and cannot be opened as text');
        S.opened.push(u.path);
        d = mkDoc(u, b.toString('utf8'), /\.md$/.test(u.path) ? 'markdown' : 'mermaid'); docs.push(d); return d;
      },
      fs: {
        stat: async u => { const b = files.get(u.path); if (!b) throw new Error('nf'); return { size: opts.sizes && opts.sizes[u.path] || b.length }; },
        readFile: async u => { S.opened.push('raw:' + u.path); return new Uint8Array(files.get(u.path)); },
        writeFile: async (u, b) => { S.writes.push([u.toString(), Buffer.from(b)]); },
      },
      onDidChangeTextDocument: E.change, onDidSaveTextDocument: E.save, onDidCloseTextDocument: E.close, onDidChangeConfiguration: E.cfg,
    },
    window: {
      state: { focused: true },
      activeTextEditor: undefined, visibleTextEditors: [],
      tabGroups: { activeTabGroup: { activeTab: undefined } },
      onDidChangeTextEditorSelection: E.sel, onDidChangeActiveTextEditor: E.active,
      registerWebviewPanelSerializer: () => ({ dispose() {} }),
      setStatusBarMessage: m => { S.info.push(m); return { dispose() {} }; },
      showInformationMessage: async m => { S.info.push(m); }, showWarningMessage: async m => { S.warn.push(m); }, showErrorMessage: async m => { S.err.push(m); },
      showSaveDialog: async o => { S.saveDefault = o.defaultUri && o.defaultUri.toString(); return S.saveTarget; },
      showTextDocument: async (doc, o) => ({ revealRange() {}, doc, o }),
      showQuickPick: async () => undefined,
      createWebviewPanel: (type, title, col, o) => {
        const recv = ev(), disp = ev(), view = ev();
        const p = { type, title, visible: true, posted: [], iconPath: null,
          webview: { cspSource: 'vscode-res:', options: o, html: '', asWebviewUri: u => u, onDidReceiveMessage: recv, postMessage: async m => { p.posted.push(m); return true; } },
          onDidDispose: disp, onDidChangeViewState: view, reveal() {}, dispose() { disp.fire(); },
          send: m => recv.fire(m), last: t => [...p.posted].reverse().find(m => m.type === t) };
        S.panels.push(p); return p;
      },
    },
  };
  const ctx = { extensionUri: Uri.file('/ext'), subscriptions: [], globalState: { get: () => undefined, update: async () => {} }, workspaceState: { get: k => S.ws.get(k), update: async (k, v) => { S.ws.set(k, v); } } };
  return { vscode, S, E, ctx, commands, Uri, docs, mkDoc, files };
}

function load(env) {
  const orig = Module._load;
  Module._load = function (req, parent, isMain) { return req === 'vscode' ? env.vscode : orig.call(this, req, parent, isMain); };
  try {
    for (const k of Object.keys(require.cache)) if (k.includes(path.join('mermaid-viewer-vscode', 'src'))) delete require.cache[k];
    return require('../src/extension.js');
  } finally { Module._load = orig; }
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('open a .mmd preview: init then render with the text; diagnostics from a webview error', async () => {
  const env = makeVscode({ files: [['/w/a.mmd', Buffer.from('flowchart LR\n  A --> B\n  B --> --> C\n')]] });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/a.mmd'));
  const p = env.S.panels[0];
  assert.match(p.webview.html, /default-src &#39;none&#39;/);
  assert.equal(p.webview.options.enableScripts, true);
  p.send({ type: 'ready' }); await tick(20);
  assert.equal(p.last('init').prefs.theme, 'auto');
  const r = p.last('render');
  assert.equal(r.items.length, 1); assert.equal(r.markdown, false); assert.match(r.items[0].text, /B --> --> C/);
  p.send({ type: 'rendered', seq: r.seq, results: [{ index: 0, ok: false, error: "Parse error on line 3:\n...B --> --> C\n---^\nExpecting 'AMP', got 'LINK'" }] });
  const d = env.S.diag.get('file:///w/a.mmd');
  assert.equal(d.length, 1); assert.equal(d[0].range.start.line, 2); assert.equal(d[0].message, 'Syntax error: unexpected LINK');
  p.send({ type: 'rendered', seq: r.seq, results: [{ index: 0, ok: true }] });
  assert.equal(env.S.diag.get('file:///w/a.mmd').length, 0);
});

test('Markdown: one item per block with its first line; error lines map into the file', async () => {
  const md = '# T\n\n```mermaid\nflowchart LR\n A-->B\n```\n\ntext\n\n```mermaid\nflowchart TD\n A --> --> B\n```\n';
  const env = makeVscode({ files: [['/w/r.md', Buffer.from(md)]] });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreview')(env.Uri.file('/w/r.md'));
  const p = env.S.panels[0]; p.send({ type: 'ready' }); await tick(20);
  const r = p.last('render');
  assert.equal(r.markdown, true);
  assert.deepEqual(r.items.map(i => i.line), [3, 10]);
  p.send({ type: 'rendered', seq: r.seq, results: [{ index: 0, ok: true }, { index: 1, ok: false, error: 'Parse error on line 2:\nx\n^\nExpecting a' }] });
  assert.equal(env.S.diag.get('file:///w/r.md')[0].range.start.line, 11);
});

test('a file far over the limit that is not open is not read; the page says so', async () => {
  const env = makeVscode({ files: [['/w/big.mmd', Buffer.from('flowchart LR\n')]], sizes: { '/w/big.mmd': 3e6 } });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/big.mmd'));
  assert.deepEqual(env.S.opened, []);
  const h = env.S.panels[0].webview.html;
  assert.match(h, /Not drawn/); assert.match(h, /2\.9 MB.*was not read/); assert.doesNotMatch(h, /<script/);
});

test('a file VS Code calls binary is read as bytes and decoded, so it still previews', async () => {
  const bytes = Buffer.concat([Buffer.from('flowchart LR\n  A["caf'), Buffer.from([0xe9, 0x00]), Buffer.from('"] --> B\n')]);
  const env = makeVscode({ files: [['/w/bin.mmd', bytes]] });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/bin.mmd'));
  assert.deepEqual(env.S.opened, ['raw:/w/bin.mmd']);
  const p = env.S.panels[0]; p.send({ type: 'ready' }); await tick(20);
  const t = p.last('render').items[0].text;
  assert.match(t, /caf�/); assert.ok(!t.includes('\u0000'));
});

test('over-limit text and deep nesting are refused before drawing, with the reason', async () => {
  const deep = ['flowchart TB', ...Array.from({ length: 100 }, (_, i) => `subgraph s${i}`), 'a-->b', ...Array(100).fill('end')].join('\n');
  const env = makeVscode({ files: [['/w/deep.mmd', Buffer.from(deep)], ['/w/long.mmd', Buffer.from('flowchart LR\n' + 'x'.repeat(2000))]], config: { maxTextSize: 1000 } });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/deep.mmd'));
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/long.mmd'));
  const [a, b] = env.S.panels; a.send({ type: 'ready' }); b.send({ type: 'ready' }); await tick(20);
  assert.match(a.last('render').items[0].refuse, /The limit is 1,000|nests 100 levels/);
  assert.match(b.last('render').items[0].refuse, /2,013 characters\. The limit is 1,000/);
});

test('time limit: no answer from the webview replaces the page and warns; same text is not tried again', async () => {
  const env = makeVscode({ files: [['/w/slow.mmd', Buffer.from('flowchart LR\n A-->B\n')]], config: { renderTimeoutSeconds: 2 } });
  const ext = load(env); ext.activate(env.ctx);
  const prev = await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/slow.mmd'));
  const p = env.S.panels[0]; p.send({ type: 'ready' }); await tick(20);
  prev.armWatchdog(30, prev.lastSrc); await tick(80);
  assert.match(p.webview.html, /Drawing stopped/); assert.doesNotMatch(p.webview.html, /<script/);
  assert.match(env.S.warn[0], /took longer than 0 s|took longer than/);
  const n = p.posted.length;
  p.send({ type: 'ready' }); await tick(20);
  assert.equal(p.posted.filter(m => m.type === 'render').length, p.posted.slice(0, n).filter(m => m.type === 'render').length);
  // a text change brings the normal page back
  env.E.change.fire({ document: env.docs[0], contentChanges: [{}] });
  assert.match(p.webview.html, /mermaid\.min\.js/);
});

test('progress messages keep the watchdog from firing on long Markdown files', async () => {
  const env = makeVscode({ files: [['/w/m.mmd', Buffer.from('pie\n "a" : 1\n')]] });
  const ext = load(env); ext.activate(env.ctx);
  const prev = await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/m.mmd'));
  const p = env.S.panels[0]; p.send({ type: 'ready' }); await tick(20);
  let armed = 0; const orig = prev.armWatchdog.bind(prev); prev.armWatchdog = (...a) => { armed++; return orig(...a); };
  p.send({ type: 'progress', seq: p.last('render').seq });
  p.send({ type: 'progress', seq: -5 });
  assert.equal(armed, 1);
  p.send({ type: 'rendered', seq: p.last('render').seq, results: [{ index: 0, ok: true }] });
});

test('prefs from the webview are cleaned and kept per workspace', async () => {
  const env = makeVscode({ files: [['/w/a.mmd', Buffer.from('pie\n')]] });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/a.mmd'));
  const p = env.S.panels[0];
  p.send({ type: 'prefs', prefs: { theme: 'forest', background: 'custom', custom: '#123456', scale: 4, maxW: 1200, maxH: 'x', choice: 2 } }); await tick();
  assert.deepEqual(env.S.ws.get('mermaidViewer.prefs'), { theme: 'forest', background: 'custom', custom: '#123456', scale: 4, maxW: 1200, maxH: 0 });
  p.send({ type: 'prefs', prefs: { theme: '<script>', background: 'url(x)', custom: 'red', scale: 3, maxW: 1e9 } }); await tick();
  assert.deepEqual(env.S.ws.get('mermaidViewer.prefs'), { theme: 'auto', background: 'theme', custom: '#f5f5f0', scale: 2, maxW: 0, maxH: 0 });
});

test('exports: SVG gets an XML header, PNG must be a real PNG, the source file is never overwritten', async () => {
  const env = makeVscode({ files: [['/w/a.mmd', Buffer.from('pie\n')]] });
  const ext = load(env); ext.activate(env.ctx);
  await env.commands.get('mermaidViewer.showPreviewToSide')(env.Uri.file('/w/a.mmd'));
  const p = env.S.panels[0];
  env.S.saveTarget = env.Uri.file('/w/out.svg');
  p.send({ type: 'saveSvg', svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }); await tick(10);
  assert.equal(env.S.saveDefault, 'file:///w/a.svg');
  assert.match(env.S.writes[0][1].toString(), /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg/);
  env.S.saveTarget = env.Uri.file('/w/out.png');
  p.send({ type: 'savePng', data: Buffer.from('GIF89a....').toString('base64') }); await tick(10);
  assert.equal(env.S.writes.length, 1); assert.match(env.S.err[0], /not a PNG/);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  p.send({ type: 'savePng', data: png.toString('base64') }); await tick(10);
  assert.equal(env.S.writes.length, 2);
  env.S.saveTarget = env.Uri.file('/w/a.mmd');
  p.send({ type: 'saveSvg', svg: '<svg/>' }); await tick(10);
  assert.equal(env.S.writes.length, 2); assert.match(env.S.err[1], /overwrite the diagram source/);
  p.send({ type: 'copySvg', svg: '<svg/>' }); await tick(10);
  assert.equal(env.S.clip, '<svg/>');
});

test('context keys: .mmd, custom language ids, Markdown with a mermaid fence', async () => {
  const env = makeVscode({ config: { languageIds: ['mermaid', 'mmdx'] } });
  const ext = load(env); ext.activate(env.ctx);
  const ed = d => ({ document: d, selection: { active: { line: 0 } } });
  env.E.active.fire(ed(env.mkDoc(env.Uri.file('/w/x.txt'), 'graph TD', 'mmdx')));
  assert.equal(env.S.ctx['mermaidViewer.isMermaid'], true);
  env.E.active.fire(ed(env.mkDoc(env.Uri.file('/w/r.md'), '```mermaid\npie\n```', 'markdown')));
  assert.equal(env.S.ctx['mermaidViewer.isMermaid'], false); assert.equal(env.S.ctx['mermaidViewer.markdownHasMermaid'], true);
  env.E.active.fire(ed(env.mkDoc(env.Uri.file('/w/r.md'), '# nothing', 'markdown')));
  assert.equal(env.S.ctx['mermaidViewer.markdownHasMermaid'], false);
});

test('pngBytes and cleanPrefs helpers', () => {
  const env = makeVscode();
  const ext = load(env);
  const { pngBytes, cleanPrefs } = ext._test;
  assert.equal(pngBytes(123), null);
  assert.equal(pngBytes(Buffer.from('hello').toString('base64')), null);
  assert.ok(pngBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64')));
  assert.equal(cleanPrefs(null, { theme: 'dark', background: 'white', custom: '#000000' }).theme, 'dark');
});
