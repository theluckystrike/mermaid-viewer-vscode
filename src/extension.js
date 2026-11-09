'use strict';
// Mermaid Viewer: a live Mermaid preview for .mmd / .mermaid files and for mermaid blocks in Markdown.
// The extension host only reads the text VS Code already has open, checks sizes, and sends the text to the
// webview, where the bundled Mermaid library draws it. No network, no account, no telemetry.
const vscode = require('vscode');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { buildHtml, batchHtml, stoppedHtml } = require('./html');
const T = require('./core/mermaid-text');
const { completions } = require('./core/complete');
const { TEMPLATES } = require('./core/templates');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');
const { createBlocks, SCHEME: BLOCK_SCHEME } = require('./blocks');
const { createOutline } = require('./outline');
const { createBatch } = require('./batch');
const { createPro } = require('./pro');

const SECTION = 'mermaidViewer';
const VIEW_TYPE = 'mermaidViewer.preview';
const EXT_ID = 'zovo.mermaid-viewer';
const PREFS_KEY = 'mermaidViewer.prefs';
const MERMAID_VERSION = require('../package.json').mermaidVersion;
let rating = { success() {}, failure() {} };
let blocks = null;

function settings() {
  const c = vscode.workspace.getConfiguration(SECTION);
  const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const ids = c.get('languageIds', ['mermaid']);
  return {
    theme: c.get('theme', 'auto'),
    background: c.get('background', 'theme'),
    custom: /^#[0-9a-f]{6}$/i.test(c.get('customBackground', '')) ? c.get('customBackground') : '#f5f5f0',
    wheel: ['auto', 'zoom', 'pan'].includes(c.get('wheel', 'auto')) ? c.get('wheel', 'auto') : 'auto',
    delay: clamp(c.get('updateDelayMs', 100), 0, 5000, 100),
    svgText: c.get('svgTextLabels', false) === true,
    exportFolder: String(c.get('exportFolder', 'mermaid-export') || 'mermaid-export').replace(/^[\\/]+/, '').replace(/\.\.(?=[\\/]|$)/g, '') || 'mermaid-export',
    maxTextSize: Math.floor(clamp(c.get('maxTextSize', 500000), 1000, 20000000, 500000)),
    maxEdges: Math.floor(clamp(c.get('maxEdges', 2000), 100, 200000, 2000)),
    timeoutMs: clamp(c.get('renderTimeoutSeconds', 10), 2, 300, 10) * 1000,
    languageIds: Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : ['mermaid'],
  };
}

function isMermaidDoc(doc) {
  if (!doc) return false;
  return settings().languageIds.includes(doc.languageId) || doc.languageId === 'mermaid' || T.isMermaidPath(doc.uri.path);
}
function isMarkdownDoc(doc) { return !!doc && !isMermaidDoc(doc) && (doc.languageId === 'markdown' || T.isMarkdownPath(doc.uri.path)); }

const THEMES = ['auto', 'default', 'dark', 'forest', 'neutral', 'base'];
const BGS = ['theme', 'white', 'transparent', 'custom'];
/** Toolbar choices kept per workspace, checked so a bad stored value cannot reach the page. */
function cleanPrefs(p, s) {
  const o = p && typeof p === 'object' ? p : {};
  const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return n >= lo && n <= hi ? n : 0; };
  return {
    theme: THEMES.includes(o.theme) ? o.theme : s.theme,
    background: BGS.includes(o.background) ? o.background : s.background,
    custom: /^#[0-9a-f]{6}$/i.test(o.custom || '') ? o.custom : s.custom,
    scale: [1, 2, 4].includes(Number(o.scale)) ? Number(o.scale) : 2,
    maxW: int(o.maxW, 16, 32000), maxH: int(o.maxH, 16, 32000),
    svgText: typeof o.svgText === 'boolean' ? o.svgText : !!s.svgText,
  };
}

class Preview {
  constructor(manager, uri, panel, opts = {}) {
    this.manager = manager; this.uri = uri; this.key = uri.toString(); this.panel = panel;
    this.fileName = path.basename(uri.path);
    this.timer = null; this.watchdog = null; this.seq = 0; this.ready = false; this.disposed = false; this.pending = false;
    this.counted = false; this.items = []; this.choice = -1; this.stoppedFor = null; this.notice = opts.notice || '';
    this.staticDoc = opts.staticDoc || null;
    this.noticeHeading = opts.notice ? 'Not drawn' : ''; this.noticeHint = opts.notice ? 'Raise the limit in Settings, then open the preview again.' : '';
    this.subs = [
      panel.webview.onDidReceiveMessage(m => this.onMessage(m).catch(err => vscode.window.showErrorMessage('Mermaid Viewer: ' + (err && err.message || err)))),
      panel.onDidDispose(() => this.dispose()),
      panel.onDidChangeViewState(e => { if (e.webviewPanel.visible && this.pending) { this.pending = false; this.schedule(0); } }),
    ];
    panel.iconPath = vscode.Uri.joinPath(manager.context.extensionUri, 'media', 'preview-icon.svg');
    this.load();
  }

  /** (Re)build the page. Used at start and after a render was stopped. */
  load() {
    const wv = this.panel.webview;
    const media = vscode.Uri.joinPath(this.manager.context.extensionUri, 'media');
    wv.options = { enableScripts: true, localResourceRoots: [media], enableCommandUris: commandUris(SECTION) };
    this.ready = false;
    if (this.notice) { wv.html = stoppedHtml({ cspSource: wv.cspSource, message: this.notice, heading: this.noticeHeading, hint: this.noticeHint }); return; }
    const p = this.prefs();
    wv.html = buildHtml({
      cspSource: wv.cspSource,
      scriptUri: wv.asWebviewUri(vscode.Uri.joinPath(media, 'preview.js')).toString(),
      mermaidUri: wv.asWebviewUri(vscode.Uri.joinPath(media, 'mermaid.min.js')).toString(),
      toolsUri: wv.asWebviewUri(vscode.Uri.joinPath(media, 'svgtools.js')).toString(),
      styleUri: wv.asWebviewUri(vscode.Uri.joinPath(media, 'preview.css')).toString(),
      title: this.fileName, theme: p.theme, background: p.background, custom: p.custom, mermaidVersion: MERMAID_VERSION,
      showSupportLinks: showLinks(vscode, SECTION),
    });
  }

  prefs() { return cleanPrefs(this.manager.context.workspaceState.get(PREFS_KEY), settings()); }

  doc() { return vscode.workspace.textDocuments.find(d => d.uri.toString() === this.key) || this.staticDoc; }

  post(m) { if (!this.disposed) this.panel.webview.postMessage(m).then(undefined, () => {}); }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update().catch(err => vscode.window.showErrorMessage('Mermaid Viewer: ' + (err && err.message || err))), delay);
  }

  /** The diagrams to draw: one for a Mermaid file, one per block for Markdown. */
  collect(doc, s) {
    const text = T.cleanSource(doc.getText());
    const limits = { maxTextSize: s.maxTextSize, maxEdges: s.maxEdges };
    if (isMarkdownDoc(doc)) {
      return { markdown: true, items: T.findMermaidBlocks(text).map(b => ({ index: b.index, line: b.startLine, text: b.source, refuse: T.refuseReason(b.source, limits) || undefined })) };
    }
    return { markdown: false, items: [{ index: 0, line: 0, text, refuse: T.refuseReason(text, limits) || undefined }] };
  }

  async update() {
    if (this.disposed || !this.ready) return;
    if (!this.panel.visible) { this.pending = true; return; }
    const doc = this.doc();
    if (!doc) return;
    const s = settings();
    const src = this.collect(doc, s);
    if (this.stoppedFor && this.stoppedFor === this.textSig(src)) return; // same text that ran over the limit
    this.items = src.items;
    this.seq++;
    this.post({ type: 'render', seq: this.seq, items: src.items, markdown: src.markdown, fileName: this.fileName, limits: { maxTextSize: s.maxTextSize, maxEdges: s.maxEdges } });
    this.lastSrc = src;
    this.armWatchdog(s.timeoutMs, src);
  }

  textSig(src) { let h = 0; for (const it of src.items) { const t = it.text; h = (h * 31 + t.length) | 0; for (let i = 0; i < t.length; i += Math.max(1, t.length >> 8)) h = (h * 31 + t.charCodeAt(i)) | 0; } return h + ':' + src.items.length; }

  armWatchdog(ms, src) {
    clearTimeout(this.watchdog);
    const seq = this.seq;
    this.watchdog = setTimeout(() => this.stop(seq, ms, src), ms);
  }

  /** The webview did not answer in time: replace the page (this ends the stuck script) and say why. */
  stop(seq, ms, src) {
    if (this.disposed || seq !== this.seq) return;
    this.stoppedFor = this.textSig(src);
    const msg = `Drawing ${this.fileName} took longer than ${Math.round(ms / 1000)} s, so Mermaid Viewer stopped it. Very large or deeply nested diagrams can take minutes to lay out. You can raise mermaidViewer.renderTimeoutSeconds.`;
    this.notice = msg; this.noticeHeading = 'Drawing stopped'; this.noticeHint = '';
    this.load();
    if (!this.counted) { this.counted = true; rating.failure(); }
    vscode.window.showWarningMessage(msg, 'Open Settings').then(p => { if (p) vscode.commands.executeCommand('workbench.action.openSettings', 'mermaidViewer.renderTimeoutSeconds'); });
  }

  /** Text changed after a stop: go back to the normal page. */
  restart() {
    if (!this.notice) return false;
    this.notice = ''; this.stoppedFor = null; this.load();
    return true;
  }

  async onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'ready': {
        this.ready = true;
        const s = settings();
        this.post({ type: 'init', prefs: { ...this.prefs(), wheel: s.wheel, choice: this.choice }, limits: { maxTextSize: s.maxTextSize, maxEdges: s.maxEdges }, uri: this.key });
        this.schedule(0);
        break;
      }
      case 'rendered': this.onRendered(m); break;
      case 'progress': if (m.seq === this.seq && this.lastSrc) this.armWatchdog(settings().timeoutMs, this.lastSrc); break;
      case 'prefs': {
        const p = m.prefs || {};
        if (Number.isInteger(p.choice) && p.choice >= -1 && p.choice < 100000) this.choice = p.choice;
        await this.manager.context.workspaceState.update(PREFS_KEY, cleanPrefs(p, settings()));
        break;
      }
      case 'revealLine': if (Number.isInteger(m.line) && m.line >= 0) await this.reveal(m.line); break;
      case 'exportPdf': await vscode.commands.executeCommand('mermaidViewer.exportPdf', this.uri); break;
      case 'saveSvg': if (typeof m.svg === 'string') await this.save(Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' + m.svg + '\n', 'utf8'), 'svg', m.index); break;
      case 'savePng': { const b = pngBytes(m.data); if (b) await this.save(b, 'png', m.index); else vscode.window.showErrorMessage('PNG export failed: the image data was not a PNG.'); break; }
      case 'copyPng': { const b = pngBytes(m.data); if (b) await this.copyPng(b, m.w, m.h, m.index); break; }
      case 'copySvg': if (typeof m.svg === 'string') { await vscode.env.clipboard.writeText(m.svg); vscode.window.setStatusBarMessage('Mermaid Viewer: SVG code copied', 4000); } break;
      case 'copied': vscode.window.setStatusBarMessage(`Mermaid Viewer: PNG copied (${Number(m.w) | 0} × ${Number(m.h) | 0} px)`, 4000); break;
      case 'warn': vscode.window.showWarningMessage(String(m.message || '').slice(0, 300)); break;
      case 'error': vscode.window.showErrorMessage(String(m.message || '').slice(0, 400)); break;
    }
  }

  onRendered(m) {
    if (m.seq !== this.seq) return;
    clearTimeout(this.watchdog);
    const results = Array.isArray(m.results) ? m.results : [];
    const doc = this.doc();
    if (doc) this.manager.setProblems(doc, results.filter(r => r && !r.ok && !r.refuse && !r.empty).map(r => {
      const it = this.items.find(x => x.index === r.index) || { line: 0 };
      const l = T.errorLine(r.error);
      return { line: l ? it.line + l - 1 : it.line, message: l ? T.shortError(r.error).replace(/ near ".*"$/, '') : T.shortError(r.error) };
    }));
    if (!this.counted && results.length) {
      this.counted = true;
      if (results.every(r => r && r.ok)) rating.success(this.uri); else if (results.some(r => r && !r.ok && !r.refuse && !r.empty)) rating.failure();
    }
  }

  async reveal(line) {
    if (this.staticDoc && !vscode.workspace.textDocuments.some(d => d.uri.toString() === this.key)) { vscode.window.setStatusBarMessage(`Mermaid Viewer: VS Code shows ${this.fileName} as binary, so the preview cannot jump to line ${line + 1}.`, 5000); return; }
    const doc = this.doc() || await vscode.workspace.openTextDocument(this.uri);
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.key);
    const pos = new vscode.Position(Math.min(line, Math.max(0, doc.lineCount - 1)), 0);
    const ed = await vscode.window.showTextDocument(doc, { viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One, preserveFocus: false, selection: new vscode.Range(pos, pos) });
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  target(ext, index) {
    const many = this.items.length > 1 && Number.isInteger(index);
    const base = this.fileName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-') + (many ? `-${index + 1}` : '') + '.' + ext;
    const src = (blocks && blocks.sourceFor(this.uri)) || this.uri; // a Markdown block: next to its Markdown file
    const dir = src.scheme === 'file' ? vscode.Uri.file(path.dirname(src.fsPath)) : undefined;
    return dir ? vscode.Uri.joinPath(dir, base) : undefined;
  }

  async save(bytes, ext, index) {
    const target = await vscode.window.showSaveDialog({ defaultUri: this.target(ext, index), filters: ext === 'svg' ? { SVG: ['svg'] } : { PNG: ['png'] }, saveLabel: 'Save ' + ext.toUpperCase() });
    if (!target) return;
    if (target.toString() === this.key) { vscode.window.showErrorMessage('Choose a different file; this would overwrite the diagram source.'); return; }
    await vscode.workspace.fs.writeFile(target, bytes);
    vscode.window.setStatusBarMessage(`Mermaid Viewer: saved ${path.basename(target.path)}`, 5000);
  }

  async copyPng(bytes, w, h, index) {
    if (vscode.env.remoteName) {
      const pick = await vscode.window.showWarningMessage('Copying an image works only when VS Code runs on this computer. Save the PNG instead?', 'Save PNG');
      if (pick) await this.save(bytes, 'png', index);
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-viewer-'));
    const file = path.join(dir, 'diagram.png');
    try {
      fs.writeFileSync(file, bytes);
      await copyImageFile(file);
      vscode.window.setStatusBarMessage(`Mermaid Viewer: PNG copied (${Number(w) | 0} × ${Number(h) | 0} px)`, 4000);
    } catch (err) {
      const pick = await vscode.window.showWarningMessage('Mermaid Viewer could not copy the image: ' + String(err && err.message || err).slice(0, 200) + '. Save the PNG instead?', 'Save PNG');
      if (pick) await this.save(bytes, 'png', index);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  onSelection(editor) {
    if (!isMarkdownDoc(editor.document)) return;
    const b = T.blockAtLine(T.findMermaidBlocks(editor.document.getText()), editor.selection.active.line);
    if (b >= 0 && b !== this.focused) { this.focused = b; this.post({ type: 'focusBlock', index: b }); }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer); clearTimeout(this.watchdog);
    this.subs.forEach(s => s.dispose());
    this.manager.previews.delete(this.key);
    this.manager.diagnostics.delete(this.uri);
  }
}

/** A read-only stand-in for a TextDocument, for files VS Code will not open as text. */
async function readAsText(uri, s) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, s.maxTextSize * 4)));
  const lines = text.split(/\r?\n/);
  return { uri, languageId: T.isMarkdownPath(uri.path) ? 'markdown' : 'mermaid', version: 1, lineCount: lines.length, getText: () => text, lineAt: i => ({ text: lines[i] || '' }), isStatic: true };
}

/** Put a PNG file on the OS clipboard. Local commands only, no network. */
function copyImageFile(file) {
  return new Promise((resolve, reject) => {
    const done = (err) => (err ? reject(err) : resolve());
    if (process.platform === 'darwin') {
      execFile('osascript', ['-e', `set the clipboard to (read (POSIX file ${JSON.stringify(file)}) as «class PNGf»)`], { timeout: 10000 }, done);
    } else if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('${file.replace(/'/g, "''")}'); [System.Windows.Forms.Clipboard]::SetImage($i); $i.Dispose()`;
      execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { timeout: 15000, windowsHide: true }, done);
    } else {
      const wl = !!process.env.WAYLAND_DISPLAY;
      const cmd = wl ? 'wl-copy' : 'xclip';
      const args = wl ? ['--type', 'image/png'] : ['-selection', 'clipboard', '-t', 'image/png', '-i', file];
      const child = execFile(cmd, args, { timeout: 10000 }, err => done(err && err.code === 'ENOENT' ? new Error(`${cmd} is not installed`) : err));
      if (wl && child.stdin) { child.stdin.end(fs.readFileSync(file)); }
    }
  });
}

/** Decode base64 PNG data from the webview. null unless it is a real PNG (signature check) under 512 MB. */
function pngBytes(data) {
  if (typeof data !== 'string' || data.length > 700e6) return null;
  const b = Buffer.from(data, 'base64');
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return b.length > 8 && sig.every((v, i) => b[i] === v) ? b : null;
}

class Manager {
  constructor(context) {
    this.context = context; this.previews = new Map();
    this.diagnostics = vscode.languages.createDiagnosticCollection('mermaid');
  }
  setProblems(doc, problems) {
    this.diagnostics.set(doc.uri, problems.map(p => {
      const line = Math.max(0, Math.min(p.line, doc.lineCount - 1));
      const text = doc.lineAt(line).text;
      const d = new vscode.Diagnostic(new vscode.Range(line, text.length - text.trimStart().length, line, text.length), p.message, vscode.DiagnosticSeverity.Error);
      d.source = 'Mermaid';
      return d;
    }));
  }
  panel(uri, column) {
    return vscode.window.createWebviewPanel(VIEW_TYPE, 'Preview ' + path.basename(uri.path), { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: false, enableFindWidget: true, enableCommandUris: commandUris(SECTION), localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
  }
  async open(uri, column) {
    const existing = this.previews.get(uri.toString());
    if (existing) { existing.panel.reveal(column, true); return existing; }
    const s = settings();
    const isOpen = vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString());
    let notice = '', staticDoc = null, size = -1;
    // A file that is not open yet and far over the limit is not read at all: its size is checked first.
    if (!isOpen) {
      try { size = (await vscode.workspace.fs.stat(uri)).size; } catch {}
      if (size > s.maxTextSize * 4) notice = `${path.basename(uri.path)} is ${(size / 1048576).toFixed(1)} MB. Mermaid Viewer draws diagrams up to ${s.maxTextSize.toLocaleString('en-US')} characters (setting mermaidViewer.maxTextSize), so this file was not read.`;
    }
    if (!notice && !isOpen) {
      try { await vscode.workspace.openTextDocument(uri); }
      catch (err) {
        // VS Code refuses files it takes for binary (a NUL byte, broken encoding). Read the bytes and decode them
        // with replacement characters, so the preview can still show the diagram or a clear error.
        staticDoc = await readAsText(uri, s);
      }
    }
    const p = new Preview(this, uri, this.panel(uri, column), { notice, staticDoc });
    this.previews.set(p.key, p);
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document.uri.toString() === p.key) p.onSelection(ed);
    return p;
  }
  async revive(panel, uri) {
    try { await vscode.workspace.openTextDocument(uri); } catch { panel.dispose(); return; }
    const old = this.previews.get(uri.toString());
    if (old) { panel.dispose(); return; }
    const p = new Preview(this, uri, panel);
    this.previews.set(p.key, p);
  }
  dispose() { for (const p of [...this.previews.values()]) p.panel.dispose(); this.diagnostics.dispose(); }
}

function targetUri(arg) {
  if (arg instanceof vscode.Uri) return arg;
  const ed = vscode.window.activeTextEditor;
  if (ed) return ed.document.uri;
  // No text editor: VS Code may show the file as binary. Use the active tab's file.
  try {
    const tab = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup.activeTab;
    const u = tab && tab.input && tab.input.uri;
    if (u instanceof vscode.Uri && (T.isMermaidPath(u.path) || T.isMarkdownPath(u.path))) return u;
  } catch {}
  return null;
}

function updateContext(editor) {
  const doc = editor && editor.document;
  vscode.commands.executeCommand('setContext', 'mermaidViewer.isMermaid', !!doc && isMermaidDoc(doc));
  const md = !!doc && isMarkdownDoc(doc) && doc.lineCount < 200000 && T.hasMermaidFence(doc.getText());
  vscode.commands.executeCommand('setContext', 'mermaidViewer.markdownHasMermaid', md);
}

const KIND = () => ({ type: vscode.CompletionItemKind.Class, template: vscode.CompletionItemKind.Snippet, keyword: vscode.CompletionItemKind.Keyword, arrow: vscode.CompletionItemKind.Operator, shape: vscode.CompletionItemKind.Struct });

/** Completion in .mmd files and inside ```mermaid blocks of Markdown files. */
function completionProvider() {
  return {
    provideCompletionItems(doc, pos) {
      let text, line, offset = 0;
      if (isMarkdownDoc(doc)) {
        if (doc.lineCount > 200000) return [];
        const b = T.findMermaidBlocks(doc.getText()).find(x => pos.line >= x.startLine && (x.closed ? pos.line < x.endLine : pos.line <= x.endLine));
        if (!b) return [];
        text = b.source; line = pos.line - b.startLine; offset = b.indent || 0;
      } else if (isMermaidDoc(doc) || doc.uri.scheme === BLOCK_SCHEME) {
        if (doc.lineCount > 200000) return [];
        text = doc.getText(); line = pos.line;
      } else return [];
      const lineText = doc.lineAt(pos.line).text.slice(0, pos.character);
      // Replace the whole token before the cursor, so arrows like --> complete after "--" too.
      const start = Math.max(offset, lineText.search(/\S+$/) < 0 ? pos.character : lineText.search(/\S+$/));
      const range = new vscode.Range(pos.line, start, pos.line, pos.character);
      const kinds = KIND();
      const r = completions(text, line);
      return r.items.map((it, i) => {
        const c = new vscode.CompletionItem(it.label, kinds[it.kind] || vscode.CompletionItemKind.Keyword);
        c.detail = it.detail;
        c.insertText = it.snippet ? new vscode.SnippetString(it.insertText) : it.insertText;
        c.range = range;
        c.filterText = it.label;
        c.sortText = String(i).padStart(4, '0');
        return c;
      });
    },
  };
}

function activate(context) {
  const manager = new Manager(context);
  context.subscriptions.push({ dispose: () => manager.dispose() });
  registerSupport({ vscode, context, prefix: SECTION, selfId: EXT_ID });
  rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: SECTION, name: 'Mermaid Viewer' });
  const pro = createPro({ vscode, context });
  const setting = (k, d) => vscode.workspace.getConfiguration(SECTION).get(k, d);

  const openCmd = side => async arg => {
    const uri = targetUri(arg);
    if (!uri) { vscode.window.showInformationMessage('Open a .mmd file, or a Markdown file with a mermaid block, first.'); return; }
    return manager.open(uri, side ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);
  };
  blocks = createBlocks({ vscode, context, isMarkdownDoc, setting, openPreview: uri => manager.open(uri, vscode.ViewColumn.Beside) });
  const outline = createOutline({ vscode, isMarkdownDoc, isMermaidDoc, pro });
  const rel = u => { try { return vscode.workspace.asRelativePath(u, false); } catch { return path.basename(u.path); } };
  const batch = createBatch({
    vscode, context, settings, pro, rel, sourceFor: u => blocks.sourceFor(u),
    prefs: () => cleanPrefs(context.workspaceState.get(PREFS_KEY), settings()),
    makeHtml: wv => {
      const media = vscode.Uri.joinPath(context.extensionUri, 'media');
      const u = f => wv.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
      return batchHtml({ cspSource: wv.cspSource, mermaidUri: u('mermaid.min.js'), toolsUri: u('svgtools.js'), scriptUri: u('batch.js') });
    },
  });

  /** The split editor: the text on the left, the live diagram on the right. Markdown: the block at the cursor. */
  async function openEditor(arg) {
    const uri = targetUri(arg);
    if (!uri) { vscode.window.showInformationMessage('Open a .mmd file, or a Markdown file with a mermaid block, first.'); return; }
    const isMd = T.isMarkdownPath(uri.path) || vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString() && isMarkdownDoc(d));
    if (isMd) return blocks.editBlock(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
    await vscode.window.showTextDocument(doc, { viewColumn: ed ? ed.viewColumn : vscode.ViewColumn.Active, preview: false });
    return manager.open(uri, vscode.ViewColumn.Beside);
  }

  async function newDiagram() {
    const ed = vscode.window.activeTextEditor;
    const intoMd = !!ed && isMarkdownDoc(ed.document) && ed.document.uri.scheme !== BLOCK_SCHEME;
    const pick = await vscode.window.showQuickPick(TEMPLATES.map(t => ({ label: t.label, description: t.keyword, detail: t.detail, t })), {
      placeHolder: intoMd ? 'Pick a diagram type. It goes into this Markdown file at the cursor as a ```mermaid block.' : 'Pick a diagram type. It opens in a new file next to a live preview.',
      matchOnDescription: true, matchOnDetail: true,
    });
    if (!pick) return;
    if (intoMd) {
      const at = ed.selection.active;
      const pre = at.character > 0 ? '\n\n' : '';
      await ed.edit(b => b.insert(at, pre + '```mermaid\n' + pick.t.text + '```\n'));
      return ed.document.uri;
    }
    const doc = await vscode.workspace.openTextDocument({ language: 'mermaid', content: pick.t.text });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active, preview: false });
    await manager.open(doc.uri, vscode.ViewColumn.Beside);
    return doc.uri;
  }

  async function previewBlock(mdUri, index) {
    const uri = mdUri instanceof vscode.Uri ? mdUri : targetUri();
    if (!uri) return;
    const p = await manager.open(uri, vscode.ViewColumn.Beside);
    if (p && Number.isInteger(index)) { p.choice = index; p.post({ type: 'choose', index }); }
    return p;
  }

  let ctxTimer = null;
  const tree = vscode.window.createTreeView('mermaidViewer.outline', { treeDataProvider: outline.provider, showCollapseAll: false });
  context.subscriptions.push(
    tree,
    vscode.workspace.registerFileSystemProvider(BLOCK_SCHEME, blocks.provider, { isCaseSensitive: true, isReadonly: false }),
    vscode.languages.registerCodeLensProvider([{ language: 'markdown' }, { pattern: '**/*.{md,markdown,mdx}' }], blocks.lenses),
    vscode.languages.registerCompletionItemProvider([{ language: 'mermaid' }, { language: 'markdown' }, { scheme: BLOCK_SCHEME }], completionProvider()),
    vscode.commands.registerCommand('mermaidViewer.showPreviewToSide', openCmd(true)),
    vscode.commands.registerCommand('mermaidViewer.showPreview', openCmd(false)),
    vscode.commands.registerCommand('mermaidViewer.openEditor', openEditor),
    vscode.commands.registerCommand('mermaidViewer.newDiagram', newDiagram),
    vscode.commands.registerCommand('mermaidViewer.editBlock', (u, i) => blocks.editBlock(u, i)),
    vscode.commands.registerCommand('mermaidViewer.previewBlock', previewBlock),
    vscode.commands.registerCommand('mermaidViewer.exportWorkspace', () => batch.exportWorkspace()),
    vscode.commands.registerCommand('mermaidViewer.exportPdf', u => batch.exportPdf(u instanceof vscode.Uri ? u : targetUri())),
    vscode.commands.registerCommand('mermaidViewer.outlineReveal', async (u, line) => {
      const doc = await vscode.workspace.openTextDocument(u);
      const pos = new vscode.Position(Math.max(0, Math.min(line, doc.lineCount - 1)), 0);
      const ed = await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preserveFocus: false });
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop || 3);
    }),
    vscode.commands.registerCommand('mermaidViewer.outlineEdit', it => { const d = outline.current(); if (d) return blocks.editBlock(d.uri, it && it.index); }),
    vscode.commands.registerCommand('mermaidViewer.outlinePreview', it => { const d = outline.current(); if (d) return previewBlock(d.uri, it && it.md ? it.index : undefined); }),
    vscode.commands.registerCommand('mermaidViewer.unlockOutline', async () => { if (await pro.gate('Diagram outline')) outline.refresh(); }),
    pro.onDidChange(() => outline.refresh()),
    vscode.commands.registerCommand('mermaidViewer.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#mermaidViewer.start`, false)),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel, state) {
        const u = state && typeof state.uri === 'string' ? state.uri : '';
        if (!u) { panel.dispose(); return; }
        await manager.revive(panel, vscode.Uri.parse(u));
      },
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      const p = manager.previews.get(e.document.uri.toString());
      if (p && e.contentChanges.length) { if (!p.restart()) p.schedule(settings().delay); }
      if (!e.contentChanges.length) return;
      if (isMarkdownDoc(e.document)) blocks.onMarkdownChange(e.document);
      outline.changed(e.document);
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document === e.document && isMarkdownDoc(e.document)) { clearTimeout(ctxTimer); ctxTimer = setTimeout(() => updateContext(ed), 500); }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => { const p = manager.previews.get(doc.uri.toString()); if (p) p.schedule(0); }),
    vscode.window.onDidChangeTextEditorSelection(e => { const p = manager.previews.get(e.textEditor.document.uri.toString()); if (p) p.onSelection(e.textEditor); }),
    vscode.window.onDidChangeActiveTextEditor(ed => { updateContext(ed); outline.track(ed); }),
    vscode.workspace.onDidCloseTextDocument(doc => { if (!manager.previews.has(doc.uri.toString())) manager.diagnostics.delete(doc.uri); }),
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (!e.affectsConfiguration(SECTION)) return;
      if (e.affectsConfiguration(SECTION + '.codeLens')) blocks.refreshLenses();
      if (e.affectsConfiguration(SECTION + '.theme') || e.affectsConfiguration(SECTION + '.background') || e.affectsConfiguration(SECTION + '.customBackground') || e.affectsConfiguration(SECTION + '.svgTextLabels')) {
        const s = settings(), cur = cleanPrefs(context.workspaceState.get(PREFS_KEY), s);
        if (e.affectsConfiguration(SECTION + '.theme')) cur.theme = s.theme;
        if (e.affectsConfiguration(SECTION + '.background')) cur.background = s.background;
        if (e.affectsConfiguration(SECTION + '.customBackground')) cur.custom = s.custom;
        if (e.affectsConfiguration(SECTION + '.svgTextLabels')) cur.svgText = s.svgText;
        await context.workspaceState.update(PREFS_KEY, cur);
      }
      updateContext(vscode.window.activeTextEditor);
      for (const p of manager.previews.values()) { p.notice = ''; p.stoppedFor = null; p.load(); }
    }),
  );
  updateContext(vscode.window.activeTextEditor);
  outline.track(vscode.window.activeTextEditor);
  return { _manager: manager, _blocks: blocks, _outline: outline, _batch: batch, _pro: pro };
}

function deactivate() {}

module.exports = { activate, deactivate, _test: { cleanPrefs, pngBytes, isMermaidDoc, isMarkdownDoc, completionProvider } };
