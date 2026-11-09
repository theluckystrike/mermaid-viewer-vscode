'use strict';
// Export many diagrams at once: every diagram in the workspace to SVG and/or PNG, or every diagram in one file to a
// PDF with a title page. Diagrams are drawn one by one in a small "Mermaid export" panel that runs the bundled
// Mermaid under the same strict CSP as the preview. A diagram that takes too long is stopped and skipped.
const path = require('path');
const T = require('./core/mermaid-text');
const { buildPdf } = require('./core/pdf');

const EXCLUDE = '**/{node_modules,.git,.hg,.svn,dist,out,build,.venv,venv,__pycache__,.next,.cache}/**';
const MAX_FILES = 5000;
const MAX_MD_BYTES = 20e6;

class Renderer {
  constructor(vscode, context, makeHtml, timeoutMs) {
    Object.assign(this, { vscode, context, makeHtml, timeoutMs });
    this.panel = null; this.waiters = new Map(); this.seq = 0; this.readyP = null;
  }
  open() {
    const vscode = this.vscode;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('mermaidViewer.export', 'Mermaid export', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    panel.webview.html = this.makeHtml(panel.webview);
    let ready;
    this.readyP = new Promise(r => { ready = r; });
    panel.webview.onDidReceiveMessage(m => {
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'ready') ready();
      else if (m.type === 'done' && this.waiters.has(m.id)) { const w = this.waiters.get(m.id); this.waiters.delete(m.id); w(m); }
    });
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = null; for (const w of this.waiters.values()) w({ ok: false, error: 'The export panel was closed.' }); this.waiters.clear(); });
    this.panel = panel;
  }
  async render(job) {
    if (!this.panel) this.open();
    const ok = await Promise.race([this.readyP.then(() => true), new Promise(r => setTimeout(() => r(false), 20000))]);
    if (!ok) { this.close(); return { ok: false, error: 'The export panel did not start.' }; }
    const id = ++this.seq;
    const answer = new Promise(r => this.waiters.set(id, r));
    this.panel.webview.postMessage(Object.assign({ type: 'job', id }, job));
    let timer;
    const timeout = new Promise(r => { timer = setTimeout(() => r(null), this.timeoutMs); });
    const res = await Promise.race([answer, timeout]);
    clearTimeout(timer);
    if (res) return res;
    // Too slow: replacing the page ends the stuck script. The next job gets a fresh panel.
    this.waiters.delete(id);
    this.close();
    return { ok: false, error: `Drawing took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped.` };
  }
  close() { if (this.panel) { const p = this.panel; this.panel = null; p.dispose(); } }
}

function b64bytes(data) { return typeof data === 'string' ? Buffer.from(data, 'base64') : null; }

function createBatch({ vscode, context, settings, prefs, makeHtml, pro, rel, sourceFor }) {
  const say = (m) => vscode.window.showInformationMessage(m);

  /** Diagrams in one text: one per block for Markdown, one for a Mermaid file. */
  function itemsIn(uri, text, markdown, s) {
    const limits = { maxTextSize: s.maxTextSize, maxEdges: s.maxEdges };
    const clean = T.cleanSource(text);
    if (markdown) return T.findMermaidBlocks(clean).map(b => ({ uri, index: b.index, line: b.startLine, text: b.source, many: true, refuse: T.refuseReason(b.source, limits) }));
    return [{ uri, index: 0, line: 0, text: clean, many: false, refuse: T.refuseReason(clean, limits) }];
  }

  async function textOf(uri) {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function renderOpts(forPdf) {
    const p = prefs();
    const theme = p.theme === 'auto' ? 'default' : p.theme;
    const background = forPdf ? 'white' : (p.background === 'theme' ? 'white' : p.background);
    return { theme, background, custom: p.custom, plain: !!p.svgText, scale: p.scale || 2, width: p.maxW || 0, height: p.maxH || 0 };
  }

  async function exportWorkspace() {
    if (!(await pro.gate('Export every diagram in the workspace'))) return;
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) { say('Open a folder first. This command exports every diagram in the open folder.'); return; }
    const fmt = await vscode.window.showQuickPick([
      { label: 'SVG', formats: ['svg'] }, { label: 'PNG', formats: ['png'] }, { label: 'SVG and PNG', formats: ['svg', 'png'] },
    ], { placeHolder: 'Export every Mermaid diagram in this workspace (.mmd, .mermaid and mermaid blocks in Markdown) as' });
    if (!fmt) return;
    const s = settings();
    const outDefault = vscode.Uri.joinPath(folders[0].uri, s.exportFolder || 'mermaid-export');
    const where = await vscode.window.showQuickPick([
      { label: rel(outDefault), description: 'in this workspace (setting mermaidViewer.exportFolder)', uri: outDefault },
      { label: 'Choose a folder…', uri: null },
    ], { placeHolder: 'Where should the files go? Folders inside it follow the folders of the source files.' });
    if (!where) return;
    let out = where.uri;
    if (!out) {
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: folders[0].uri, openLabel: 'Export here' });
      if (!picked || !picked[0]) return;
      out = picked[0];
    }
    const files = await vscode.workspace.findFiles('**/*.{mmd,mermaid,md,markdown,mdx}', EXCLUDE, MAX_FILES);
    files.sort((a, b) => a.path.localeCompare(b.path));
    const ro = renderOpts(false);
    const r = new Renderer(vscode, context, makeHtml, s.timeoutMs + 5000);
    const stats = { files: 0, diagrams: 0, written: 0, failed: [], skipped: 0 };
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Exporting Mermaid diagrams', cancellable: true }, async (progress, token) => {
        const all = [];
        for (const f of files) {
          if (token.isCancellationRequested) return;
          let size = 0;
          try { size = (await vscode.workspace.fs.stat(f)).size; } catch { continue; }
          const md = T.isMarkdownPath(f.path);
          if ((md && size > MAX_MD_BYTES) || (!md && size > s.maxTextSize * 4)) { stats.skipped++; continue; }
          let text;
          try { text = await textOf(f); } catch { stats.skipped++; continue; }
          if (md && !T.hasMermaidFence(text)) continue;
          const its = itemsIn(f, text, md, s);
          if (its.length) stats.files++;
          all.push(...its);
        }
        stats.diagrams = all.length;
        let n = 0;
        for (const it of all) {
          if (token.isCancellationRequested) return;
          n++;
          progress.report({ message: `${n} of ${all.length}: ${rel(it.uri)}${it.many ? ` #${it.index + 1}` : ''}`, increment: 100 / all.length });
          if (it.refuse) { stats.failed.push(`${rel(it.uri)}${it.many ? ` #${it.index + 1}` : ''}: ${it.refuse}`); continue; }
          if (!it.text.trim()) { stats.skipped++; continue; }
          for (const format of fmt.formats) {
            const res = await r.render(Object.assign({ text: it.text, format }, ro));
            if (!res.ok) { stats.failed.push(`${rel(it.uri)}${it.many ? ` #${it.index + 1}` : ''}: ${T.shortError(res.error)}`); break; }
            const relPath = rel(it.uri).replace(/\.[^./\\]+$/, '') + (it.many ? `-${it.index + 1}` : '') + '.' + format;
            const target = vscode.Uri.joinPath(out, ...relPath.split(/[\\/]/).filter(x => x && x !== '..'));
            const bytes = format === 'svg' ? Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' + res.svg + '\n', 'utf8') : b64bytes(res.data);
            if (!bytes) { stats.failed.push(`${rel(it.uri)}: no image data`); break; }
            await vscode.workspace.fs.writeFile(target, bytes);
            stats.written++;
          }
        }
      });
    } finally { r.close(); }
    const msg = `Mermaid Viewer exported ${stats.written} file${stats.written === 1 ? '' : 's'} from ${stats.diagrams} diagram${stats.diagrams === 1 ? '' : 's'} in ${stats.files} file${stats.files === 1 ? '' : 's'} to ${rel(out)}.` + (stats.failed.length ? ` ${stats.failed.length} could not be drawn.` : '');
    const buttons = stats.failed.length ? ['Show problems'] : [];
    const pick = await vscode.window.showInformationMessage(msg, ...buttons);
    if (pick === 'Show problems') {
      const d = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Diagrams that were not exported\n\n' + stats.failed.map(x => '- ' + x).join('\n') + '\n' });
      await vscode.window.showTextDocument(d, { preview: true });
    }
    return Object.assign(stats, { out: out.toString() });
  }

  async function exportPdf(arg) {
    const ed = vscode.window.activeTextEditor;
    const uri = arg instanceof vscode.Uri ? arg : (ed && ed.document.uri);
    if (!uri) { say('Open a .mmd file, or a Markdown file with mermaid blocks, first.'); return; }
    if (!(await pro.gate('Export to PDF with a title page'))) return;
    const s = settings();
    const md = T.isMarkdownPath(uri.path) || (ed && ed.document.uri.toString() === uri.toString() && ed.document.languageId === 'markdown');
    const text = await textOf(uri);
    const items = itemsIn(uri, text, md, s);
    if (!items.length) { say(`${path.basename(uri.path)} has no mermaid diagram.`); return; }
    const base = path.basename(uri.path).replace(/\.[^.]+$/, '');
    const near = (sourceFor && sourceFor(uri)) || uri; // a Markdown block: next to its Markdown file
    const dir = near.scheme === 'file' ? vscode.Uri.file(path.dirname(near.fsPath)) : undefined;
    const target = await vscode.window.showSaveDialog({ defaultUri: dir ? vscode.Uri.joinPath(dir, base + '.pdf') : undefined, filters: { PDF: ['pdf'] }, saveLabel: 'Save PDF' });
    if (!target) return;
    const ro = Object.assign(renderOpts(true), { format: 'jpeg', scale: 2, width: 0, height: 0 });
    const r = new Renderer(vscode, context, makeHtml, s.timeoutMs + 5000);
    const pages = [];
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Making ${base}.pdf`, cancellable: true }, async (progress, token) => {
        for (const it of items) {
          if (token.isCancellationRequested) throw new Error('cancelled');
          progress.report({ message: `diagram ${it.index + 1} of ${items.length}`, increment: 100 / items.length });
          const type = T.diagramType(it.text) || 'diagram';
          const caption = `${it.many ? `Diagram ${it.index + 1}` : base} - ${type} - line ${it.line + 1}`;
          if (it.refuse || !it.text.trim()) { pages.push({ caption, error: it.refuse || 'This diagram is empty.' }); continue; }
          const res = await r.render(Object.assign({ text: it.text }, ro));
          pages.push(res.ok ? { caption, jpeg: b64bytes(res.data), pxPerPt: 2 } : { caption, error: 'Not drawn: ' + T.shortError(res.error) });
        }
      });
    } catch (e) { if (String(e && e.message) === 'cancelled') return; throw e; } finally { r.close(); }
    const pdf = buildPdf({ title: path.basename(uri.path), subtitle: [rel(uri), `Exported ${new Date().toISOString().slice(0, 10)} with Mermaid Viewer`], pages });
    await vscode.workspace.fs.writeFile(target, pdf);
    const bad = pages.filter(p => p.error).length;
    vscode.window.setStatusBarMessage(`Mermaid Viewer: saved ${path.basename(target.path)} (${pages.length} diagram${pages.length === 1 ? '' : 's'}${bad ? `, ${bad} not drawn` : ''})`, 6000);
    return { target: target.toString(), pages: pages.length, failed: bad, bytes: pdf.length };
  }

  return { exportWorkspace, exportPdf, Renderer };
}

module.exports = { createBatch, Renderer };
