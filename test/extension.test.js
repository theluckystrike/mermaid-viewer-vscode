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
    constructor(scheme, p, query) { this.scheme = scheme; this.path = p; this.fsPath = p; this.query = query || ''; }
    toString() { return `${this.scheme}://${this.path}` + (this.query ? '?' + this.query : ''); }
    static file(p) { return new Uri('file', p); }
    static parse(s) { const m = /^([a-z-]+):\/\/([^?]*)(?:\?(.*))?$/.exec(s); return m ? new Uri(m[1], m[2], m[3]) : new Uri('file', s); }
    static from(o) { return new Uri(o.scheme, o.path, o.query); }
    static joinPath(u, ...ps) { return new Uri(u.scheme, path.join(u.path, ...ps)); }
  }
  class EventEmitter { constructor() { this.ls = []; this.event = l => { this.ls.push(l); return { dispose() {} }; }; } fire(x) { this.ls.forEach(l => l(x)); } dispose() {} }
  class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } }
  class CodeLens { constructor(range, command) { this.range = range; this.command = command; } }
  class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
  class SnippetString { constructor(v) { this.value = v; } }
  class TreeItem { constructor(label, st) { this.label = label; this.collapsibleState = st; } }
  class ThemeIcon { constructor(id) { this.id = id; } }
  class MarkdownString { constructor(v) { this.value = v; } }
  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range { constructor(a, b, c, d) { if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); } } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  const files = new Map(opts.files || []); // path -> Buffer
  const docs = [];
  const mkDoc = (uri, text, languageId) => {
    const d = { uri, languageId, version: 1, isDirty: false, isUntitled: false, eol: 1, saved: 0 };
    const set = t => { d.text = t; d.lines = t.split('\n'); d.lineCount = d.lines.length; };
    set(text);
    d.getText = () => d.text;
    d.lineAt = i => ({ text: d.lines[i], range: { end: new Position(i, d.lines[i].length) } });
    d.offsetAt = p => d.lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
    d._set = set;
    d.save = async () => { d.saved++; d.isDirty = false; return true; };
    return d;
  };
  const S = { applied: [], lenses: [], completions: [], fsProviders: new Map(), trees: [], diag: new Map(), panels: [], writes: [], info: [], warn: [], err: [], ctx: {}, opened: [], config: Object.assign({ updateDelayMs: 0 }, opts.config || {}), saveTarget: null, ws: new Map() };
  const commands = new Map();
  const E = { change: ev(), save: ev(), sel: ev(), close: ev(), cfg: ev(), active: ev() };
  const vscode = {
    Uri, Position, Range, Diagnostic, EventEmitter, WorkspaceEdit, CodeLens, CompletionItem, SnippetString, TreeItem, ThemeIcon, MarkdownString,
    CompletionItemKind: { Class: 6, Snippet: 14, Keyword: 13, Operator: 23, Struct: 21 }, TreeItemCollapsibleState: { None: 0 },
    FileType: { File: 1 }, FileChangeType: { Changed: 1 }, EndOfLine: { LF: 1, CRLF: 2 }, ProgressLocation: { Notification: 15 },
    FileSystemError: { Unavailable: m => Object.assign(new Error(m), { code: 'Unavailable' }), FileNotFound: () => Object.assign(new Error('nf'), { code: 'FileNotFound' }) },
    authentication: { getSession: async () => undefined },
    DiagnosticSeverity: { Error: 0, Warning: 1 }, ViewColumn: { Active: -1, Beside: -2, One: 1 }, TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    QuickPickItemKind: { Separator: -1 },
    env: { sessionId: 's', remoteName: undefined, openExternal: async () => true, clipboard: { writeText: async t => { S.clip = t; } } },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async (id, ...a) => { if (id === 'setContext') S.ctx[a[0]] = a[1]; } },
    languages: {
      createDiagnosticCollection: () => ({ set: (u, d) => S.diag.set(u.toString(), d), delete: u => S.diag.delete(u.toString()), dispose() {} }),
      registerCodeLensProvider: (sel, p) => { S.lenses.push(p); return { dispose() {} }; },
      registerCompletionItemProvider: (sel, p) => { S.completions.push(p); return { dispose() {} }; },
      setTextDocumentLanguage: async (d, l) => { d.languageId = l; return d; },
    },
    extensions: { getExtension: () => undefined },
    workspace: {
      textDocuments: docs,
      isTrusted: true,
      workspaceFolders: opts.folders,
      asRelativePath: u => String(u.path || u).replace(/^\/ws\//, ''),
      findFiles: async () => [...files.keys()].filter(k => k.startsWith('/ws/')).map(k => Uri.file(k)),
      registerFileSystemProvider: (scheme, p) => { S.fsProviders.set(scheme, p); return { dispose() {} }; },
      applyEdit: async we => {
        for (const e of we.edits) {
          const d = docs.find(x => x.uri.toString() === e.uri.toString());
          const a = d.offsetAt(e.range.start), b = d.offsetAt(e.range.end);
          d._set(d.text.slice(0, a) + e.text + d.text.slice(b)); d.isDirty = true;
          S.applied.push(e);
          E.change.fire({ document: d, contentChanges: [{}] });
        }
        return true;
      },
      getConfiguration: () => ({ get: (k, d) => (k in S.config ? S.config[k] : d) }),
      openTextDocument: async u => {
        if (u && !(u instanceof Uri)) { const d0 = mkDoc(new Uri('untitled', '/Untitled-' + (docs.length + 1)), u.content || '', u.language || 'plaintext'); docs.push(d0); return d0; }
        let d = docs.find(x => x.uri.toString() === u.toString());
        if (d) return d;
        const fp = S.fsProviders.get(u.scheme);
        if (fp) { d = mkDoc(u, new TextDecoder().decode(await fp.readFile(u)), 'mermaid'); docs.push(d); return d; }
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
        writeFileText: null,
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
      showQuickPick: async (items, o) => (S.pick ? S.pick(await items, o) : undefined),
      showOpenDialog: async () => S.openDialog,
      createTreeView: (id, o) => { S.trees.push(o); return { dispose() {} }; },
      registerUriHandler: () => ({ dispose() {} }),
      withProgress: async (o, fn) => fn({ report() {} }, { isCancellationRequested: false }),
      createWebviewPanel: (type, title, col, o) => {
        const recv = ev(), disp = ev(), view = ev();
        const p = { type, title, visible: true, posted: [], iconPath: null,
          webview: { cspSource: 'vscode-res:', options: o, html: '', asWebviewUri: u => u, onDidReceiveMessage: recv, postMessage: async m => { p.posted.push(m); return true; } },
          onDidDispose: disp, onDidChangeViewState: view, reveal() {}, dispose() { disp.fire(); },
          send: m => recv.fire(m), last: t => [...p.posted].reverse().find(m => m.type === t) };
        S.panels.push(p); if (S.onPanel) S.onPanel(p); return p;
      },
    },
  };
  const secrets = new Map();
  const ctx = { extensionUri: Uri.file('/ext'), subscriptions: [], globalState: { get: () => undefined, update: async () => {} },
    secrets: { get: async k => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async k => { secrets.delete(k); }, onDidChange: () => ({ dispose() {} }) }, workspaceState: { get: k => S.ws.get(k), update: async (k, v) => { S.ws.set(k, v); } } };
  return { vscode, S, E, ctx, commands, Uri, docs, mkDoc, files };
}

function load(env) {
  const orig = Module._load;
  Module._load = function (req, parent, isMain) { return req === 'vscode' ? env.vscode : orig.call(this, req, parent, isMain); };
  try {
    for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(__dirname, '..', 'src') + path.sep)) delete require.cache[k];
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
  assert.deepEqual(env.S.ws.get('mermaidViewer.prefs'), { theme: 'forest', background: 'custom', custom: '#123456', scale: 4, maxW: 1200, maxH: 0, svgText: false });
  p.send({ type: 'prefs', prefs: { theme: '<script>', background: 'url(x)', custom: 'red', scale: 3, maxW: 1e9, svgText: 'yes' } }); await tick();
  assert.deepEqual(env.S.ws.get('mermaidViewer.prefs'), { theme: 'auto', background: 'theme', custom: '#f5f5f0', scale: 2, maxW: 0, maxH: 0, svgText: false });
  p.send({ type: 'prefs', prefs: { svgText: true } }); await tick();
  assert.equal(env.S.ws.get('mermaidViewer.prefs').svgText, true);
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

// ---------- 0.2.0: block editor, CodeLens, completion, templates, outline, batch and PDF export, Pro switch ----------

const MD = '# Doc\n\nIntro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n## Second\n\n  ```mermaid\n  sequenceDiagram\n    A->>B: hi\n  ```\n';

async function mdEnv(extra = {}) {
  const env = makeVscode(Object.assign({ files: [['/w/README.md', Buffer.from(MD)]] }, extra));
  const ext = load(env); const api = ext.activate(env.ctx);
  const md = await env.vscode.workspace.openTextDocument(env.Uri.file('/w/README.md'));
  return { env, ext, api, md };
}

test('CodeLens: "Edit diagram" and "Preview" above each mermaid fence, none when the setting is off', async () => {
  const { env, md } = await mdEnv();
  const lenses = env.S.lenses[0].provideCodeLenses(md);
  assert.equal(lenses.length, 4);
  assert.deepEqual(lenses.map(l => [l.command.title, l.range.start.line, l.command.arguments[1]]), [['Edit diagram', 4, 0], ['Preview', 4, 0], ['Edit diagram', 11, 1], ['Preview', 11, 1]]);
  assert.equal(lenses[0].command.command, 'mermaidViewer.editBlock');
  env.S.config.codeLens = false;
  assert.equal(env.S.lenses[0].provideCodeLenses(md).length, 0);
});

test('Edit diagram: the block opens as its own .mmd next to a preview; saving writes it back with a WorkspaceEdit and saves the .md', async () => {
  const { env, md } = await mdEnv();
  const bu = await env.commands.get('mermaidViewer.editBlock')(md.uri, 1);
  assert.equal(bu.scheme, 'mermaid-block');
  assert.equal(bu.path, '/README.md/README diagram 2.mmd');
  assert.match(bu.query, /^id=[0-9a-f]{10}&md=file%3A%2F%2F%2Fw%2FREADME\.md&i=1$/);
  const bdoc = env.docs.find(d => d.uri.toString() === bu.toString());
  assert.equal(bdoc.getText(), 'sequenceDiagram\n  A->>B: hi\n');
  assert.equal(env.S.panels.length, 1, 'a preview opened for the block');
  const fsp = env.S.fsProviders.get('mermaid-block');
  await fsp.writeFile(bu, new TextEncoder().encode('sequenceDiagram\n  A->>B: hello\n  B-->>A: hi back\n'));
  assert.equal(env.S.applied.length, 1);
  assert.equal(md.getText(), MD.replace('    A->>B: hi\n', '    A->>B: hello\n    B-->>A: hi back\n'), 'indent of the fence is kept');
  assert.equal(md.saved, 1, 'the .md had no other changes, so it is saved');
  // a second save with the same text changes nothing
  await fsp.writeFile(bu, new TextEncoder().encode('sequenceDiagram\n  A->>B: hello\n  B-->>A: hi back\n'));
  assert.equal(env.S.applied.length, 1);
  // exports of a block default to the Markdown file's folder
  env.S.saveTarget = null;
  env.S.panels[0].send({ type: 'saveSvg', svg: '<svg/>' }); await tick(10);
  assert.equal(env.S.saveDefault, 'file:///w/README diagram 2.svg');
});

test('Edit diagram: a dirty .md is not saved; a line that would close the fence is refused; a block changed in the .md is refused', async () => {
  const { env, md, api } = await mdEnv();
  const bu = await env.commands.get('mermaidViewer.editBlock')(md.uri, 0);
  const fsp = env.S.fsProviders.get('mermaid-block');
  md.isDirty = true;
  await fsp.writeFile(bu, new TextEncoder().encode('flowchart LR\n  A --> C\n'));
  assert.equal(md.saved, 0);
  assert.match(md.getText(), /A --> C/);
  const before = md.getText();
  await assert.rejects(fsp.writeFile(bu, new TextEncoder().encode('flowchart LR\n```\nA-->B')), /Line 2 would end the code block/);
  assert.equal(md.getText(), before);
  // someone edits the .md so that block 1 no longer has the text this editor started from, and adds a copy
  md._set(md.getText().replace('A --> C', 'A --> D'));
  env.E.change.fire({ document: md, contentChanges: [{}] });
  // onMarkdownChange took the new text (same index): the editor reloads instead of failing
  assert.equal(new TextDecoder().decode(await fsp.readFile(bu)), 'flowchart LR\n  A --> D\n');
  md._set(md.getText().replace(/```mermaid\nflowchart LR\n  A --> D\n```\n/, ''));
  const s = [...api._blocks._sessions.values()][0]; s.text = 'gone'; s.index = 5;
  await assert.rejects(fsp.writeFile(bu, new TextEncoder().encode('pie\n')), /was changed or removed in README\.md/);
});

test('Edit diagram after a window reload: the block URI rebuilds its session from the query', async () => {
  const { env, md, api } = await mdEnv();
  const bu = await env.commands.get('mermaidViewer.editBlock')(md.uri, 0);
  api._blocks._sessions.clear();
  const fsp = env.S.fsProviders.get('mermaid-block');
  assert.equal(new TextDecoder().decode(await fsp.readFile(bu)), 'flowchart LR\n  A --> B\n');
  await assert.rejects(fsp.readFile(env.Uri.from({ scheme: 'mermaid-block', path: '/x.md/x.mmd', query: 'id=abcdef0123' })), /nf/);
});

test('completion: diagram types and templates on the first line, keywords and arrows after it, Markdown only inside blocks', async () => {
  const env = makeVscode();
  const ext = load(env); ext.activate(env.ctx);
  const prov = env.S.completions[0];
  const mk = (t, lang, p) => { const d = env.mkDoc(env.Uri.file(p || '/w/a.mmd'), t, lang || 'mermaid'); return d; };
  const labels = (d, line, ch) => prov.provideCompletionItems(d, new env.vscode.Position(line, ch)).map(c => c.label);
  const first = labels(mk('seq'), 0, 3);
  for (const k of ['sequenceDiagram', 'flowchart TD', 'classDiagram', 'gantt', 'architecture-beta', 'flowchart (template)']) assert.ok(first.includes(k), k);
  const body = prov.provideCompletionItems(mk('flowchart TD\n  A --'), new env.vscode.Position(1, 6));
  const names = body.map(c => c.label);
  for (const k of ['subgraph', 'classDef', '-->', '-.->', '{ } decision']) assert.ok(names.includes(k), k);
  const arrow = body.find(c => c.label === '-->');
  assert.equal(arrow.range.start.character, 4, 'the typed "--" is replaced');
  assert.ok(body.find(c => c.label === 'subgraph').insertText instanceof env.vscode.SnippetString);
  const seq = labels(mk('sequenceDiagram\n  '), 1, 2);
  assert.ok(seq.includes('participant') && seq.includes('->>') && !seq.includes('subgraph'));
  const md = mk('# t\n```mermaid\nclassDiagram\n  \n```\ntext', 'markdown', '/w/r.md');
  assert.ok(labels(md, 3, 2).includes('<|--'));
  assert.equal(labels(md, 5, 2).length, 0, 'no completion outside mermaid blocks');
});

test('New Diagram from Template: a new mermaid file next to a preview, or a fenced block in Markdown', async () => {
  const env = makeVscode();
  const ext = load(env); ext.activate(env.ctx);
  env.S.pick = items => items.find(i => i.description === 'erDiagram');
  const u = await env.commands.get('mermaidViewer.newDiagram')();
  const d = env.docs.find(x => x.uri.toString() === u.toString());
  assert.equal(d.languageId, 'mermaid');
  assert.match(d.getText(), /^erDiagram\n/);
  assert.equal(env.S.panels.length, 1);
  const md = env.mkDoc(env.Uri.file('/w/r.md'), '# Title\n', 'markdown');
  let inserted = '';
  env.vscode.window.activeTextEditor = { document: md, selection: { active: new env.vscode.Position(1, 0) }, edit: async fn => { fn({ insert: (p, t) => { inserted = t; } }); return true; } };
  await env.commands.get('mermaidViewer.newDiagram')();
  assert.match(inserted, /^```mermaid\nerDiagram\n[\s\S]*```\n$/);
});

test('outline: one row per diagram with its type, heading and line; free in 0.3.0 although Pro is on', async () => {
  const { env, md, api } = await mdEnv();
  assert.equal(api._pro.enabled, true);
  assert.equal(env.S.ctx['mermaidViewer.proEnabled'], true);
  api._outline.track({ document: md });
  const rows = env.S.trees[0].treeDataProvider.getChildren();
  assert.deepEqual(rows.map(r => [r.label, r.description]), [['1. flowchart', 'Doc · line 6'], ['2. sequenceDiagram', 'Second · line 13']]);
  const ti = env.S.trees[0].treeDataProvider.getTreeItem(rows[1]);
  assert.equal(ti.command.command, 'mermaidViewer.outlineReveal');
  assert.equal(ti.contextValue, 'mermaidBlock');
});

function memState() { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => { m.set(k, v); }, _m: m }; }
function fakeLicense() {
  const L = { pro: false, asked: 0, answer: false, ls: [] };
  L.api = { ready: Promise.resolve(), isPro: () => L.pro, requirePro: async () => { L.asked++; if (L.pro) return true; return L.answer; }, onDidChange: fn => { L.ls.push(fn); return { dispose() {} }; }, handleUri() {} };
  L.unlock = () => { L.pro = true; L.ls.forEach(f => f()); };
  return L;
}

test('Pro: 3 free tries per tool with no dialog, then one dialog per start; Escape uses nothing; unlocked runs free', async () => {
  const { createPro } = (() => { const env = makeVscode(); load(env); return require('../src/pro.js'); })();
  const env = makeVscode();
  env.ctx.globalState = memState();
  const L = fakeLicense();
  const p = createPro({ vscode: env.vscode, context: env.ctx, enabled: true, license: L.api });
  assert.equal(p.has(), false);
  // EXEC14: gate() checks, commit() uses the try once the output is written; a cancelled run keeps it.
  assert.equal(await p.gate('Export to PDF with a title page'), true);
  assert.equal(p.triesLeft('Export to PDF with a title page'), 3, 'a run that stops before output keeps the try');
  for (let i = 0; i < 3; i++) { assert.equal(await p.gate('Export to PDF with a title page'), true); await p.commit('Export to PDF with a title page'); }
  assert.equal(L.asked, 0, 'no dialog during the free tries');
  assert.match(env.S.info.join('\n'), /Free try 3 of 3, the last one/);
  assert.equal(p.triesLeft('Export to PDF with a title page'), 0);
  assert.equal(p.triesLeft('Export every diagram in the workspace'), 3, 'tries are counted per tool');
  assert.equal(await p.gate('Export to PDF with a title page'), false);
  assert.equal(L.asked, 1);
  assert.equal(await p.gate('Export to PDF with a title page'), false);
  assert.equal(L.asked, 2, 'cancelled dialogs do not count as a try and ask again only when started again');
  assert.equal(await p.quietGate('Export on save'), true);
  for (let i = 0; i < 2; i++) await p.quietGate('Export on save');
  assert.equal(await p.quietGate('Export on save'), false);
  assert.equal(L.asked, 2, 'quietGate never opens a dialog');
  L.unlock();
  assert.equal(p.has(), true);
  assert.equal(await p.gate('Export to PDF with a title page'), true);
  assert.equal(await p.quietGate('Export on save'), true);
  assert.equal(env.S.ctx['mermaidViewer.proEnabled'], true);
  assert.equal(env.S.ctx['mermaidViewer.proLicensed'], true);
});

test('Pro: showProFeatures=false hides the Pro commands unless licensed; switch off makes every tool free', async () => {
  const { createPro } = (() => { const env = makeVscode(); load(env); return require('../src/pro.js'); })();
  const env = makeVscode({ config: { showProFeatures: false } });
  env.ctx.globalState = memState();
  const L = fakeLicense();
  createPro({ vscode: env.vscode, context: env.ctx, enabled: true, license: L.api });
  assert.equal(env.S.ctx['mermaidViewer.proVisible'], false);
  L.unlock();
  assert.equal(env.S.ctx['mermaidViewer.proVisible'], true);
  const env2 = makeVscode();
  const off = createPro({ vscode: env2.vscode, context: env2.ctx, enabled: false, license: fakeLicense().api });
  assert.equal(off.has(), true);
  assert.equal(await off.gate('x'), true);
  assert.equal(env2.S.ctx['mermaidViewer.proVisible'], true);
});

// A tiny JPEG header (SOI + SOF0 10 x 8, 3 components) is enough for the PDF writer.
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x0a, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]).toString('base64');
function exportPanel(env, answer) {
  env.S.onPanel = p => {
    if (p.type !== 'mermaidViewer.export') return;
    setTimeout(() => p.send({ type: 'ready' }), 1);
    p.jobs = [];
    p.webview.postMessage = async m => { if (m.type === 'job') { p.jobs.push(m); setTimeout(() => p.send(Object.assign({ type: 'done', id: m.id }, answer(m))), 1); } return true; };
  };
}

test('Export to PDF: a title page plus one page per diagram; a failed diagram gets a page that says so', async () => {
  const { env, md, api } = await mdEnv();
  exportPanel(env, m => (/sequence/.test(m.text) ? { ok: false, error: 'Parse error on line 2:\nboom' } : { ok: true, data: FAKE_JPEG, w: 10, h: 8 }));
  env.S.saveTarget = env.Uri.file('/w/README.pdf');
  const r = await env.commands.get('mermaidViewer.exportPdf')(md.uri);
  assert.deepEqual([r.pages, r.failed], [2, 1]);
  const pdf = env.S.writes.find(w => w[0] === 'file:///w/README.pdf')[1];
  const text = pdf.toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count 3/);
  assert.match(text, /\(README\.md\) Tj/);
  assert.match(text, /Not drawn: Syntax error/);
  const panel = env.S.panels.find(p => p.type === 'mermaidViewer.export');
  assert.equal(panel.jobs[0].format, 'jpeg');
  assert.equal(panel.jobs[0].background, 'white');
});

test('Export All Diagrams in Workspace: every .mmd and every Markdown block, folders kept, refused ones listed', async () => {
  const big = 'flowchart LR\n' + '  a --> b\n'.repeat(3000);
  const env = makeVscode({ folders: [{ uri: { scheme: 'file', path: '/ws', fsPath: '/ws', toString: () => 'file:///ws' } }], files: [
    ['/ws/a.mmd', Buffer.from('pie\n "x": 1\n')], ['/ws/docs/b.md', Buffer.from(MD)], ['/ws/c.md', Buffer.from('# no diagrams\n')], ['/ws/big.mmd', Buffer.from(big)],
  ] });
  env.vscode.workspace.workspaceFolders[0].uri = env.Uri.file('/ws');
  const ext = load(env); ext.activate(env.ctx);
  exportPanel(env, () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', w: 1, h: 1 }));
  let picks = 0;
  env.S.pick = items => (picks++ === 0 ? items.find(i => i.label === 'SVG') : items[0]);
  const r = await env.commands.get('mermaidViewer.exportWorkspace')();
  const written = env.S.writes.map(w => w[0]).sort();
  assert.deepEqual(written, ['file:///ws/mermaid-export/a.svg', 'file:///ws/mermaid-export/docs/b-1.svg', 'file:///ws/mermaid-export/docs/b-2.svg']);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0], /^big\.mmd: This diagram has about 3,000 links/);
  assert.match(env.S.writes[0][1].toString(), /^<\?xml/);
});

test('Export on save (Pro): writes name.svg next to a .mmd file on save, skips unchanged diagrams, Markdown gets name-N', async () => {
  const env = makeVscode({ files: [['/w/flow.mmd', Buffer.from('flowchart LR\n  A --> B\n')], ['/w/README.md', Buffer.from(MD)]], config: { exportOnSave: 'svg' } });
  env.ctx.globalState = memState();
  const ext = load(env); const api = ext.activate(env.ctx);
  exportPanel(env, () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', w: 1, h: 1 }));
  const doc = await env.vscode.workspace.openTextDocument(env.Uri.file('/w/flow.mmd'));
  env.E.save.fire(doc);
  await api._batch._saveState.chain; await tick(20);
  assert.deepEqual(env.S.writes.map(w => w[0]), ['file:///w/flow.svg']);
  assert.match(env.S.writes[0][1].toString(), /^<\?xml/);
  // Same text again: nothing is drawn or written (the file "exists" in the fake fs once written).
  env.files.set('/w/flow.svg', env.S.writes[0][1]);
  const r2 = await api._batch.exportOnSave(doc);
  assert.deepEqual([r2.written, r2.unchanged], [0, 1]);
  doc._set('flowchart LR\n  A --> C\n');
  const r3 = await api._batch.exportOnSave(doc);
  assert.equal(r3.written, 1);
  const md = await env.vscode.workspace.openTextDocument(env.Uri.file('/w/README.md'));
  const r4 = await api._batch.exportOnSave(md);
  assert.equal(r4.written, 2);
  assert.deepEqual(env.S.writes.slice(-2).map(w => w[0]), ['file:///w/README-1.svg', 'file:///w/README-2.svg']);
  // One free try per window session, not per save.
  assert.equal(api._pro.triesLeft('Export on save'), 2);
  api._batch.disposeSave();
});

test('Export on save: off by default; after the 3 tries a save shows a quiet status item, never a dialog', async () => {
  const env = makeVscode({ files: [['/w/flow.mmd', Buffer.from('flowchart LR\n  A --> B\n')]] });
  env.ctx.globalState = memState();
  env.ctx.globalState._m.set('mermaidViewer.proTries', { 'Export on save': 3 });
  const items = [];
  env.vscode.window.createStatusBarItem = () => { const it = { shown: false, show() { it.shown = true; }, dispose() { it.disposed = true; } }; items.push(it); return it; };
  let modal = 0;
  const showInfo = env.vscode.window.showInformationMessage;
  env.vscode.window.showInformationMessage = async (m, o, ...b) => { if (o && o.modal) modal++; return showInfo(m); };
  const ext = load(env); const api = ext.activate(env.ctx);
  exportPanel(env, () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', w: 1, h: 1 }));
  const doc = await env.vscode.workspace.openTextDocument(env.Uri.file('/w/flow.mmd'));
  assert.equal(await api._batch.exportOnSave(doc), null, 'the setting is off by default: nothing happens');
  env.S.config.exportOnSave = 'png';
  const r = await api._batch.exportOnSave(doc);
  assert.deepEqual(r, { locked: true });
  assert.equal(env.S.writes.length, 0);
  assert.equal(modal, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].command, 'mermaidViewer.exportOnSaveUnlock');
  assert.equal(items[0].shown, true);
  api._batch.disposeSave();
});
