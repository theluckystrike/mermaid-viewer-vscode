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
    if (stats.written > 0) await pro.commit('Export every diagram in the workspace');
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
    await pro.commit('Export to PDF with a title page');
    const bad = pages.filter(p => p.error).length;
    vscode.window.setStatusBarMessage(`Mermaid Viewer: saved ${path.basename(target.path)} (${pages.length} diagram${pages.length === 1 ? '' : 's'}${bad ? `, ${bad} not drawn` : ''})`, 6000);
    return { target: target.toString(), pages: pages.length, failed: bad, bytes: pdf.length };
  }

  // ---------- export on save (Pro) ----------
  // When mermaidViewer.exportOnSave is svg, png or svg+png, saving a .mmd / .mermaid file (or a Markdown file with
  // mermaid blocks) writes its diagrams next to it: name.svg, or name-1.svg, name-2.svg ... for Markdown blocks.
  // Only diagrams whose text or export options changed are drawn again. One free try is one window session.
  const FEATURE_SAVE = 'Export on save';
  const saveState = { allowed: null, chain: Promise.resolve(), renderer: null, idle: null, done: new Map(), lock: null };
  const formatsOf = (v) => ({ svg: ['svg'], png: ['png'], 'svg+png': ['svg', 'png'] })[v] || [];
  function saveFormats(uri) {
    try { return formatsOf(vscode.workspace.getConfiguration('mermaidViewer', uri).get('exportOnSave', 'off')); } catch { return []; }
  }
  function lockItem(show) {
    if (!show) { if (saveState.lock) { saveState.lock.dispose(); saveState.lock = null; } return; }
    if (saveState.lock || !vscode.window.createStatusBarItem) return;
    const it = vscode.window.createStatusBarItem(vscode.StatusBarAlignment ? vscode.StatusBarAlignment.Left : 1, 0);
    it.text = '$(lock) Mermaid export on save';
    it.tooltip = 'Export on save is a Zovo Pro tool and its 3 free tries are used. Click for the unlock ways. Saving still works; only the automatic export is paused.';
    it.command = 'mermaidViewer.exportOnSaveUnlock';
    it.show();
    saveState.lock = it;
  }
  if (pro.onDidChange) pro.onDidChange(() => { if (pro.has()) { saveState.allowed = true; lockItem(false); } });

  function itemTarget(uri, it, format) {
    const dir = path.dirname(uri.fsPath);
    const base = path.basename(uri.fsPath).replace(/\.[^.]+$/, '');
    return vscode.Uri.file(path.join(dir, base + (it.many ? `-${it.index + 1}` : '') + '.' + format));
  }

  async function exportOnSave(doc) {
    if (!doc || !doc.uri || doc.uri.scheme !== 'file') return null;
    const formats = saveFormats(doc.uri);
    if (!formats.length) return null;
    const md = T.isMarkdownPath(doc.uri.path) || doc.languageId === 'markdown';
    const text = doc.getText();
    if (md && !T.hasMermaidFence(text)) return null;
    if (!md && !(T.isMermaidPath(doc.uri.path) || doc.languageId === 'mermaid')) return null;
    if (saveState.allowed === null) {
      saveState.allowed = await pro.quietGate(FEATURE_SAVE);
      if (saveState.allowed && !pro.has()) vscode.window.setStatusBarMessage(`Mermaid Viewer: export on save is a Zovo Pro tool. This window uses one free try (${pro.triesLeft(FEATURE_SAVE)} left after it).`, 8000);
    }
    if (!saveState.allowed) { lockItem(true); return { locked: true }; }
    const run = saveState.chain.then(() => exportDoc(doc.uri, text, md, formats));
    saveState.chain = run.catch(() => {});
    return run;
  }

  async function exportDoc(uri, text, md, formats) {
    const s = settings();
    const items = itemsIn(uri, text, md, s);
    const ro = renderOpts(false);
    const optKey = JSON.stringify(ro);
    const stats = { written: 0, unchanged: 0, failed: [] };
    clearTimeout(saveState.idle);
    for (const it of items) {
      const label = `${path.basename(uri.fsPath)}${it.many ? ` #${it.index + 1}` : ''}`;
      if (it.refuse) { stats.failed.push(`${label}: ${it.refuse}`); continue; }
      if (!it.text.trim()) continue;
      for (const format of formats) {
        const target = itemTarget(uri, it, format);
        const key = target.toString();
        const sig = format + '\n' + optKey + '\n' + it.text;
        if (saveState.done.get(key) === sig) {
          let exists = true;
          try { await vscode.workspace.fs.stat(target); } catch { exists = false; }
          if (exists) { stats.unchanged++; continue; }
        }
        if (!saveState.renderer) saveState.renderer = new Renderer(vscode, context, makeHtml, s.timeoutMs + 5000);
        const res = await saveState.renderer.render(Object.assign({ text: it.text, format }, ro));
        if (!res.ok) { stats.failed.push(`${label}: ${T.shortError(res.error)}`); break; }
        const bytes = format === 'svg' ? Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' + res.svg + '\n', 'utf8') : b64bytes(res.data);
        if (!bytes) { stats.failed.push(`${label}: no image data`); break; }
        await vscode.workspace.fs.writeFile(target, bytes);
        saveState.done.set(key, sig);
        stats.written++;
      }
    }
    // Keep the export page for 20 s, so a burst of saves does not open and close it each time.
    saveState.idle = setTimeout(() => { if (saveState.renderer) { saveState.renderer.close(); saveState.renderer = null; } }, 20000);
    const parts = [];
    if (stats.written) parts.push(`exported ${stats.written} file${stats.written === 1 ? '' : 's'}`);
    if (stats.unchanged && !stats.written) parts.push('exports are up to date');
    if (stats.failed.length) parts.push(`${stats.failed.length} not drawn (${stats.failed[0]})`);
    if (parts.length) vscode.window.setStatusBarMessage(`Mermaid Viewer: ${parts.join(', ')}`, stats.failed.length ? 10000 : 5000);
    return stats;
  }

  /** "Export on Save" command: choose the formats (workspace setting). Off is always free. */
  async function configureExportOnSave() {
    const ed = vscode.window.activeTextEditor;
    const cur = vscode.workspace.getConfiguration('mermaidViewer', ed && ed.document.uri).get('exportOnSave', 'off');
    const pick = await vscode.window.showQuickPick([
      { label: 'SVG', value: 'svg' }, { label: 'PNG', value: 'png' }, { label: 'SVG and PNG', value: 'svg+png' }, { label: 'Off', value: 'off' },
    ].map(x => Object.assign(x, { description: x.value === cur ? 'current' : '' })), {
      placeHolder: 'When you save a .mmd file or a Markdown file with mermaid blocks, write its diagrams next to it as',
    });
    if (!pick) return null;
    if (pick.value !== 'off' && !pro.has() && pro.triesLeft(FEATURE_SAVE) === 0) {
      if (!(await pro.gate(FEATURE_SAVE, undefined, true))) return null;
      saveState.allowed = true;
    }
    const target = (vscode.workspace.workspaceFolders || []).length ? 2 : 1; // Workspace, else Global
    await vscode.workspace.getConfiguration('mermaidViewer').update('exportOnSave', pick.value, target);
    if (pick.value === 'off') { lockItem(false); vscode.window.setStatusBarMessage('Mermaid Viewer: export on save is off', 4000); return pick.value; }
    const where = 'next to the source file (name.svg, or name-1.svg, name-2.svg for Markdown blocks)';
    vscode.window.setStatusBarMessage(`Mermaid Viewer: export on save is on (${pick.label}), ${where}`, 8000);
    if (ed && ed.document && !ed.document.isDirty) await exportOnSave(ed.document);
    return pick.value;
  }

  async function unlockExportOnSave() {
    if (!(await pro.gate(FEATURE_SAVE, undefined, true))) return false;
    saveState.allowed = true;
    lockItem(false);
    const ed = vscode.window.activeTextEditor;
    if (ed) await exportOnSave(ed.document);
    return true;
  }

  function disposeSave() { clearTimeout(saveState.idle); if (saveState.renderer) saveState.renderer.close(); lockItem(false); }

  return { exportWorkspace, exportPdf, exportOnSave, configureExportOnSave, unlockExportOnSave, disposeSave, _saveState: saveState, Renderer };
}

module.exports = { createBatch, Renderer };
