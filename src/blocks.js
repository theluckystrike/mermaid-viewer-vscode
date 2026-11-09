'use strict';
// "Edit diagram" for mermaid blocks inside Markdown. A CodeLens above each ```mermaid fence opens the block as its
// own .mmd document (scheme mermaid-block) next to a live preview. Saving that document writes the text back into
// the Markdown file with a WorkspaceEdit, so Undo in the Markdown file takes it back. Nothing leaves the editor.
const path = require('path');
const T = require('./core/mermaid-text');

const SCHEME = 'mermaid-block';
const MAX_LENS_CHARS = 20e6; // no CodeLens on Markdown files above 20 MB of text

function createBlocks({ vscode, context, isMarkdownDoc, openPreview, setting }) {
  const sessions = new Map(); // id -> { id, mdUri, index, text, mtime, ctime }
  const changed = new vscode.EventEmitter();
  const lensChanged = new vscode.EventEmitter();
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');
  const fsErr = (msg) => (vscode.FileSystemError && vscode.FileSystemError.Unavailable ? vscode.FileSystemError.Unavailable(msg) : new Error(msg));
  const notFound = (u) => (vscode.FileSystemError && vscode.FileSystemError.FileNotFound ? vscode.FileSystemError.FileNotFound(u) : new Error('not found'));

  function stem(mdUri) { return path.basename(mdUri.path).replace(/\.[^.]+$/, '') || 'markdown'; }
  // mermaid-block:/README.md/README diagram 2.mmd?id=<session>&md=<Markdown URI>&i=<block index>
  // The tab says "README diagram 2.mmd" and the breadcrumb "README.md". The query rebuilds the session after a reload.
  function blockUri(s) {
    const q = 'id=' + s.id + '&md=' + encodeURIComponent(s.mdUri.toString()) + '&i=' + s.index;
    return vscode.Uri.from({ scheme: SCHEME, path: `/${path.basename(s.mdUri.path) || 'markdown'}/${stem(s.mdUri)} diagram ${s.index + 1}.mmd`, query: q });
  }
  function idOf(uri) { const m = /(?:^|&)id=([0-9a-f]{8,})(?:&|$)/.exec(uri.query || ''); return m ? m[1] : ''; }

  /** The session for a block URI. After a window reload the id is unknown: rebuild it from the query. */
  async function session(uri) {
    const id = idOf(uri);
    if (sessions.has(id)) return sessions.get(id);
    const q = new URLSearchParams(uri.query || '');
    const md = q.get('md'), i = Number(q.get('i'));
    if (!id || !md || !Number.isInteger(i) || i < 0) throw notFound(uri);
    const mdUri = vscode.Uri.parse(md, true);
    const doc = await vscode.workspace.openTextDocument(mdUri);
    const b = T.findMermaidBlocks(doc.getText()).find(x => x.index === i);
    if (!b) throw notFound(uri);
    const now = Date.now();
    const s = { id, mdUri, index: i, text: b.source, mtime: now, ctime: now };
    sessions.set(id, s);
    return s;
  }

  function newSession(mdUri, b) {
    for (const s of sessions.values()) if (s.mdUri.toString() === mdUri.toString() && s.index === b.index && s.text === b.source) return s;
    let id;
    do { id = require('crypto').randomBytes(5).toString('hex'); } while (sessions.has(id));
    const now = Date.now();
    const s = { id, mdUri, index: b.index, text: b.source, mtime: now, ctime: now };
    sessions.set(id, s);
    return s;
  }

  async function mdDoc(s) { return vscode.workspace.openTextDocument(s.mdUri); }

  /** Write new block text into the Markdown file. Throws a FileSystemError with a plain message when it cannot. */
  async function writeBack(s, content) {
    const text = T.normalizeBlockText(dec.decode(content));
    const doc = await mdDoc(s);
    const name = path.basename(s.mdUri.path);
    const blocks = T.findMermaidBlocks(doc.getText());
    const b = T.locateBlock(blocks, s.index, s.text);
    if (!b) throw fsErr(`Diagram ${s.index + 1} was changed or removed in ${name} after you opened it here, so this text was not written. Copy your text, close this tab and choose "Edit diagram" again.`);
    const bad = T.fenceConflict(b, text);
    if (bad >= 0) throw fsErr(`Line ${bad + 1} would end the code block in ${name} early. Change or indent that line, then save again.`);
    if (b.source === text) { s.text = text; s.index = b.index; return; }
    const eol = doc.eol === (vscode.EndOfLine && vscode.EndOfLine.CRLF) ? '\r\n' : '\n';
    const e = T.blockEdit(b, text, eol);
    const end = e.endLine >= 0 ? new vscode.Position(e.endLine, 0) : doc.lineAt(doc.lineCount - 1).range.end;
    const we = new vscode.WorkspaceEdit();
    we.replace(s.mdUri, new vscode.Range(new vscode.Position(e.startLine, 0), end), e.text);
    const wasDirty = doc.isDirty;
    s.pending = text; // our own change: onMarkdownChange must not reload this block while it saves
    let ok;
    try { ok = await vscode.workspace.applyEdit(we); } finally { s.pending = undefined; }
    if (!ok) throw fsErr(`VS Code did not accept the change to ${name}. Nothing was written.`);
    s.text = text; s.index = b.index; s.mtime = Date.now();
    if (!wasDirty && !doc.isUntitled && setting('saveMarkdownOnBlockSave', true)) {
      await doc.save();
      vscode.window.setStatusBarMessage(`Mermaid Viewer: diagram ${b.index + 1} saved into ${name}. Undo in ${name} takes it back.`, 6000);
    } else {
      vscode.window.setStatusBarMessage(`Mermaid Viewer: diagram ${b.index + 1} written into ${name}. Save ${name} to keep it.`, 6000);
    }
  }

  const provider = {
    onDidChangeFile: changed.event,
    watch: () => ({ dispose() {} }),
    async stat(uri) {
      const s = await session(uri);
      return { type: vscode.FileType ? vscode.FileType.File : 1, ctime: s.ctime, mtime: s.mtime, size: enc.encode(s.text).length };
    },
    readDirectory: () => [],
    createDirectory: () => { throw fsErr('Not supported.'); },
    async readFile(uri) { const s = await session(uri); return enc.encode(s.text + (s.text ? '\n' : '')); },
    async writeFile(uri, content) { const s = await session(uri); await writeBack(s, content); changed.fire([{ type: vscode.FileChangeType ? vscode.FileChangeType.Changed : 1, uri }]); },
    delete: () => { throw fsErr('Delete the block in the Markdown file instead.'); },
    rename: () => { throw fsErr('Not supported.'); },
  };

  /** The Markdown file changed: a block edited there (not here) reloads in its open block editor. */
  function onMarkdownChange(doc) {
    const key = doc.uri.toString();
    const mine = [...sessions.values()].filter(s => s.mdUri.toString() === key);
    if (!mine.length) return;
    const blocks = T.findMermaidBlocks(doc.getText());
    for (const s of mine) {
      if (s.pending !== undefined) continue;
      if (T.locateBlock(blocks, s.index, s.text)) continue;
      const b = blocks.find(x => x.index === s.index);
      if (!b) continue;
      s.text = b.source; s.mtime = Date.now();
      changed.fire([{ type: vscode.FileChangeType ? vscode.FileChangeType.Changed : 1, uri: blockUri(s) }]);
    }
  }

  async function editBlock(mdUri, index) {
    const uri = mdUri instanceof vscode.Uri ? mdUri : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
    if (!uri) { vscode.window.showInformationMessage('Open a Markdown file with a mermaid block first.'); return; }
    const doc = await vscode.workspace.openTextDocument(uri);
    const blocks = T.findMermaidBlocks(doc.getText());
    let i = Number.isInteger(index) ? index : -1;
    if (i < 0) {
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document.uri.toString() === uri.toString()) i = T.blockAtLine(blocks, ed.selection.active.line);
      if (i < 0 && blocks.length === 1) i = 0;
      if (i < 0 && blocks.length > 1) {
        const pick = await vscode.window.showQuickPick(blocks.map(b => ({ label: `Diagram ${b.index + 1}`, description: `line ${b.startLine + 1}`, detail: (T.diagramType(b.source) || 'empty') + ' · ' + b.source.split('\n').find(l => l.trim()).trim().slice(0, 80), index: b.index })), { placeHolder: 'Which diagram do you want to edit?' });
        if (!pick) return;
        i = pick.index;
      }
    }
    const b = blocks.find(x => x.index === i);
    if (!b) { vscode.window.showInformationMessage(`${path.basename(uri.path)} has no mermaid block there.`); return; }
    const s = newSession(uri, b);
    const bu = blockUri(s);
    const bdoc = await vscode.workspace.openTextDocument(bu);
    let shown = bdoc;
    if (bdoc.languageId !== 'mermaid') { try { shown = await vscode.languages.setTextDocumentLanguage(bdoc, 'mermaid'); } catch { /* keep it */ } }
    await vscode.window.showTextDocument(shown, { viewColumn: vscode.ViewColumn.Active, preview: false });
    await openPreview(bu);
    return bu;
  }

  const lenses = {
    onDidChangeCodeLenses: lensChanged.event,
    provideCodeLenses(doc) {
      if (!setting('codeLens', true) || !isMarkdownDoc(doc)) return [];
      const text = doc.getText();
      if (text.length > MAX_LENS_CHARS || !T.hasMermaidFence(text)) return [];
      const out = [];
      for (const b of T.findMermaidBlocks(text)) {
        const r = new vscode.Range(b.fenceLine, 0, b.fenceLine, 0);
        out.push(new vscode.CodeLens(r, { title: 'Edit diagram', tooltip: 'Edit this diagram next to a live preview. Saving writes it back here.', command: 'mermaidViewer.editBlock', arguments: [doc.uri, b.index] }));
        out.push(new vscode.CodeLens(r, { title: 'Preview', tooltip: 'Show this diagram in the preview with zoom and export', command: 'mermaidViewer.previewBlock', arguments: [doc.uri, b.index] }));
      }
      return out;
    },
  };

  /** Where a block's exports go by default: the Markdown file's folder. */
  function sourceFor(uri) {
    if (!uri || uri.scheme !== SCHEME) return null;
    const s = sessions.get(idOf(uri));
    return s ? s.mdUri : null;
  }

  return { SCHEME, provider, lenses, editBlock, onMarkdownChange, sourceFor, refreshLenses: () => lensChanged.fire(), _sessions: sessions, _blockUri: blockUri };
}

module.exports = { createBlocks, SCHEME };
