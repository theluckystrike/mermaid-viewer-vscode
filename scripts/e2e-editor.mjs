// Release check for the 0.2.0 editor features in a real VS Code: the split editor, "Edit diagram" on Markdown blocks
// (save writes back, Undo takes it back), completion, templates, error markers, exact PNG width, SVG with text
// labels, PDF, batch export, the outline view, trackpad pan, big and hostile files. Records every network request.
// usage: node scripts/e2e-editor.mjs <work> <port> <vsix> <workspace> <shotDir> <outJson>
// <workspace>: node scripts/make-samples.mjs <ws> --large <ws>, plus tmpl-*.mmd (written here) and real/*.md
import { launch, installVsix, sleep } from './vsc.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TEMPLATES } = require('../src/core/templates.js');
const [work0, port0, vsix, ws0, shotDir, outJson] = process.argv.slice(2);
const work = path.resolve(work0), ws = path.resolve(ws0), port = Number(port0);
const R = { started: new Date().toISOString(), install: null, steps: [], network: [], dialogs: [], console: [] };
fs.rmSync(path.join(work, 'ud'), { recursive: true, force: true });
fs.rmSync(path.join(work, 'ext'), { recursive: true, force: true });
R.install = installVsix(work, vsix);
for (const t of TEMPLATES) fs.writeFileSync(path.join(ws, `tmpl-${t.id}.mmd`), t.text);
const README0 = fs.readFileSync(path.join(ws, 'README.md'), 'utf8');
const SETTINGS = { 'window.menuStyle': 'custom', 'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true, 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.auxiliaryBar.visible': false, 'window.titleBarStyle': 'custom', 'chat.commandCenter.enabled': false, 'workbench.colorTheme': 'Default Dark Modern', 'editor.minimap.enabled': false, 'editor.fontSize': 13, 'editor.codeLens': true, 'workbench.editor.enablePreview': false, 'files.insertFinalNewline': false };
let vs;
const shots = [];
const shot = async name => { const f = path.join(shotDir, `editor-${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await vs.shot(f); shots.push(f); return f; };
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const v = await fn(); R.steps.push({ name, ok: v !== false, value: v, ms: Date.now() - t0 }); console.log('PASS', name, JSON.stringify(v).slice(0, 300)); }
  catch (e) { R.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 1200), ms: Date.now() - t0 }); console.log('FAIL', name, String(e.message || e).slice(0, 400)); try { await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); } catch {} }
};
const LOCAL = /^(vscode-file|vscode-webview|vscode-resource|data|blob|devtools|chrome-extension|about):|^https:\/\/[^/]*\.vscode-cdn\.net\//;
function watch() {
  vs.s.on(m => {
    if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (!LOCAL.test(u)) R.network.push({ url: u.slice(0, 200), where: (vs.attached.get(m.sessionId) || {}).url?.slice(0, 80) || 'workbench', at: new Date().toISOString() }); }
    if (m.method === 'Page.javascriptDialogOpening') { R.dialogs.push({ type: m.params.type, message: m.params.message.slice(0, 200) }); vs.s.send('Page.handleJavaScriptDialog', { accept: false }, m.sessionId).catch(() => {}); }
  });
}
async function netOn() { for (const sid of vs.attached.keys()) await vs.s.send('Network.enable', {}, sid).catch(() => {}); }

let wv;
const E = expr => vs.wvEval(wv, expr);
const probe = async () => JSON.parse(await E('JSON.stringify(window.mermaidViewerProbe())'));
const findWv = title => vs.waitFor(async () => (await vs.webviews()).find(w => w.title === title && w.w > 0), 20000);
const W = expr => vs.wbEval(expr);
const tabs = () => W(`[...document.querySelectorAll('.tabs-container .tab')].map(t => t.getAttribute('aria-label'))`);
const activeTab = () => W(`(document.querySelector('.tabs-container .tab.active[aria-selected="true"]') || document.querySelector('.editor-group-container.active .tab.active') || {}).getAttribute?.('aria-label') || ''`);
async function openFile(f) { vs.open(path.join(ws, f)); await vs.waitFor(() => W(`!!document.querySelector('.tabs-container .tab.active[aria-label^="${path.basename(f)}"]')`), 15000); await sleep(500); }
const closeAll = async () => { await vs.command('View: Close All Editors'); await sleep(600); if (await W(`!!document.querySelector('.monaco-dialog-box')`)) { await vs.key('Tab', 'Tab'); await vs.key('Enter', 'Enter'); await sleep(300); } };
const rendered = async (n = 1, ms = 30000) => { const p = await vs.waitFor(async () => { const r = await probe(); return r.rendered >= n ? r : null; }, ms, 100); if (!p) throw new Error('not rendered: ' + JSON.stringify(await probe()).slice(0, 400)); return p; };
const text = sel => E(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
const lag = async () => { const t = Date.now(); await W('1+1'); return Date.now() - t; };
const notes = () => W(`[...document.querySelectorAll('.notification-list-item')].map(n => n.textContent.slice(0, 300))`);
async function focusEditor() {
  const b = JSON.parse(await W(`JSON.stringify([...document.querySelectorAll('.editor-group-container.active .monaco-editor .view-lines')].filter(e => e.getBoundingClientRect().width > 0)[0]?.getBoundingClientRect() || null)`));
  if (!b) throw new Error('no text editor');
  await vs.click(b.x + 40, b.y + 8);
}
async function palette(label) { await vs.command(label); }
async function quickPick(textToType) {
  await vs.waitFor(() => W(`(() => { const w = document.querySelector('.quick-input-widget'); return !!(w && w.style.display !== 'none' && w.offsetParent); })()`), 8000);
  await sleep(300);
  if (textToType) { await vs.type(textToType); await sleep(500); }
  await vs.key('Enter', 'Enter'); await sleep(700);
}
async function saveDialog(target) {
  await vs.waitFor(() => W(`!!document.querySelector('.quick-input-widget input') && document.querySelector('.quick-input-widget').style.display !== 'none'`), 8000);
  await sleep(300);
  const ib = JSON.parse(await W(`JSON.stringify(document.querySelector('.quick-input-widget input').getBoundingClientRect())`));
  await vs.click(ib.x + ib.width / 2, ib.y + ib.height / 2); await vs.key('a', 'KeyA', 4, 65); await vs.type(target);
  await sleep(300); await vs.key('Enter', 'Enter');
  return vs.waitFor(() => fs.existsSync(target) && fs.statSync(target).size > 100, 20000);
}
const pngSize = f => { const h = fs.readFileSync(f).subarray(0, 24); if (h.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG'); return { w: h.readUInt32BE(16), h: h.readUInt32BE(20), bytes: fs.statSync(f).size }; };
async function editorFor(f) {
  await openFile(f);
  for (let i = 0; i < 3; i++) {
    await palette('Mermaid Viewer: Open Diagram Editor');
    if (await vs.waitFor(() => W(`[...document.querySelectorAll('.tabs-container .tab')].some(t => (t.getAttribute('aria-label') || '').startsWith('Preview ${f}'))`), 4000)) break;
  }
  wv = await findWv(f);
  if (!wv) throw new Error('no preview for ' + f + ' tabs=' + JSON.stringify(await tabs()));
  await netOn();
}
async function previewOf(f) {
  await openFile(f);
  const base = path.basename(f);
  for (let i = 0; i < 3; i++) {
    await palette('Mermaid Viewer: Open Preview to the Side');
    if (await vs.waitFor(() => W(`[...document.querySelectorAll('.tabs-container .tab')].some(t => (t.getAttribute('aria-label') || '').startsWith('Preview ${base}'))`), 4000)) break;
  }
  wv = await findWv(base);
  if (!wv) throw new Error('no preview for ' + f);
  await netOn();
}
// Typing-to-drawn time: type one character at the end and wait for the next drawing.
async function typeToDrawn(ch) {
  const before = (await probe()).rendered;
  const t0 = Date.now();
  await vs.type(ch);
  const p = await vs.waitFor(async () => { const r = await probe(); return r.rendered > before ? r : null; }, 15000, 10);
  return { ms: Date.now() - t0, p };
}

try {
  vs = await launch(work, port, ws, SETTINGS);
  watch(); await netOn();
  await sleep(2500);

  await step('split editor: "Open Diagram Editor" shows the text on the left and the live diagram on the right', async () => {
    await editorFor('flowchart.mmd');
    const p = await rendered();
    const groups = await W(`[...document.querySelectorAll('.editor-group-container')].filter(g => g.getBoundingClientRect().width > 0).map(g => Math.round(g.getBoundingClientRect().x))`);
    if (groups.length < 2 || !p.good.includes(0) || p.errors.length) throw new Error(JSON.stringify({ groups, p }));
    return { groups, renderMs: p.renderMs, tabs: await tabs() };
  });

  await step('typing to drawn: 300-node flowchart redraws within the debounce plus its render time', async () => {
    await closeAll(); await editorFor('flow-300.mmd'); await rendered();
    await focusEditor();
    await vs.key('ArrowDown', 'ArrowDown', 4, 40); await vs.key('End', 'End', 0, 35);
    await vs.type('\n  f299 --> extra'); await sleep(1500);
    const runs = [];
    for (const ch of ['X', 'Y', 'Z']) { const r = await typeToDrawn(ch); runs.push({ typeToDrawnMs: r.ms, renderMs: r.p && r.p.renderMs[0] }); await sleep(800); }
    const p = await probe();
    await vs.command('File: Revert File'); await sleep(500);
    if (p.errors.length || runs.some(r => !r.renderMs)) throw new Error(JSON.stringify({ runs, p }));
    return { runs, debounceMs: 100, nodes: 300 };
  });

  await step('15 templates: each draws with no error (New Diagram from Template content)', async () => {
    const out = {};
    for (const t of TEMPLATES) {
      await closeAll(); await previewOf(`tmpl-${t.id}.mmd`);
      const p = await rendered();
      out[t.id] = p.errors.length ? 'ERROR ' + p.errors[0][1].slice(0, 120) : `ok ${p.renderMs[0]} ms`;
      if (t.id === 'architecture' || t.id === 'c4') await shot('template-' + t.id);
    }
    const bad = Object.entries(out).filter(([, v]) => v.startsWith('ERROR'));
    if (bad.length) throw new Error(JSON.stringify(out));
    return out;
  });

  await step('New Diagram from Template command: quick pick, untitled mermaid file, live preview; completion offers keywords', async () => {
    await closeAll();
    await palette('Mermaid Viewer: New Diagram from Template');
    await quickPick('Sequence diagram');
    wv = await vs.waitFor(async () => (await vs.webviews()).find(w => /^Untitled/.test(w.title) && w.w > 0), 15000);
    if (!wv) throw new Error('no preview for the new file: ' + JSON.stringify(await tabs()));
    await netOn();
    const p = await rendered();
    await focusEditor();
    await vs.key('ArrowDown', 'ArrowDown', 4, 40); await vs.key('End', 'End', 0, 35);
    await vs.type('\n  parti');
    await vs.key(' ', 'Space', 2, 32); // Ctrl+Space: trigger suggest
    const sug = await vs.waitFor(() => W(`(() => { const w = document.querySelector('.suggest-widget.visible'); return w ? [...w.querySelectorAll('.monaco-list-row')].map(r => r.getAttribute('aria-label') || r.textContent).join(' | ') : ''; })()`), 6000, 150);
    await shot('completion');
    await vs.key('Escape', 'Escape');
    if (!p.good.length || p.errors.length || !/participant/.test(sug || '')) throw new Error(JSON.stringify({ p, sug }));
    return { firstDraw: p.renderMs, suggestions: sug.slice(0, 300) };
  });

  await step('error marker: a broken line gets a red squiggle in the editor and a line in the preview', async () => {
    await closeAll(); await editorFor('sequence.mmd'); await rendered();
    await focusEditor();
    await vs.key('ArrowDown', 'ArrowDown', 4, 40); await vs.key('End', 'End', 0, 35);
    await vs.type('\n  A ->> ->> B');
    const p = await vs.waitFor(async () => { const r = await probe(); return r.errors.length ? r : null; }, 8000, 100);
    const squiggle = await vs.waitFor(() => W(`document.querySelectorAll('.editor-group-container .squiggly-error').length`), 6000, 150);
    const msg = await text('#problem');
    await shot('error-marker');
    await vs.command('File: Revert File');
    if (!p || !squiggle || !/^Line \d+:/.test(msg)) throw new Error(JSON.stringify({ p, squiggle, msg }));
    return { squiggles: squiggle, message: msg.split('\n')[0] };
  });

  await step('CodeLens "Edit diagram" on a Markdown block: edit, save, the .md changes on disk; Undo in the .md takes it back', async () => {
    await closeAll();
    await openFile('README.md'); await sleep(1500);
    const lenses = await vs.waitFor(() => W(`[...document.querySelectorAll('.codelens-decoration a')].map(a => a.textContent)`), 10000, 200);
    if (!lenses || !lenses.filter(t => /Edit diagram/.test(t)).length) throw new Error('no CodeLens: ' + JSON.stringify(lenses));
    const b = JSON.parse(await W(`JSON.stringify([...document.querySelectorAll('.codelens-decoration a')].filter(a => /Edit diagram/.test(a.textContent))[1].getBoundingClientRect())`));
    await vs.click(b.x + b.width / 2, b.y + b.height / 2);
    const tab = await vs.waitFor(async () => (await tabs()).find(t => /^README diagram 2\.mmd/.test(t || '')), 10000);
    wv = await findWv('README diagram 2.mmd');
    if (!tab || !wv) throw new Error('block editor did not open: ' + JSON.stringify(await tabs()));
    await netOn();
    const p0 = await rendered();
    await sleep(500); await shot('markdown-block-editor');
    await focusEditor();
    await vs.key('ArrowDown', 'ArrowDown', 4, 40); await vs.key('End', 'End', 0, 35);
    const marker = 'Edited from the block editor';
    await vs.type(`\n  Note over U: ${marker}`);
    const p1 = await vs.waitFor(async () => { const r = await probe(); return r.rendered > p0.rendered && !r.errors.length ? r : null; }, 8000, 100);
    await vs.key('s', 'KeyS', 4, 83); // Cmd+S
    const disk = await vs.waitFor(() => { const t = fs.readFileSync(path.join(ws, 'README.md'), 'utf8'); return t.includes(marker) ? t : null; }, 8000, 200);
    if (!disk) throw new Error('README.md on disk did not change; notes=' + JSON.stringify(await notes()));
    const blockLines = disk.split('\n').filter(l => l.includes(marker));
    await shot('markdown-block-saved');
    // Undo in README.md
    await openFile('README.md'); await sleep(500);
    await focusEditor();
    await vs.key('z', 'KeyZ', 4, 90); await sleep(800);
    const dirty = await W(`!!document.querySelector('.tabs-container .tab.active.dirty')`);
    await vs.key('s', 'KeyS', 4, 83); await sleep(1200);
    const after = fs.readFileSync(path.join(ws, 'README.md'), 'utf8');
    if (!p1 || after !== README0 || !dirty) throw new Error(JSON.stringify({ p1: !!p1, dirty, sameAsOriginal: after === README0 }));
    return { lenses: lenses.length, writtenLine: blockLines[0], undoRestoredOriginal: true, dirtyAfterUndo: dirty };
  });

  await step('export: PNG with Width 2000 px is exactly 2000 px wide; SVG with text labels has no foreignObject and no remote URL; PDF has a title page', async () => {
    await closeAll(); await previewOf('flowchart.mmd'); const p = await rendered();
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await E(`(() => { const m = document.getElementById('maxW'); m.value = ''; m.dispatchEvent(new Event('input')); const h = document.getElementById('maxH'); h.value = ''; h.dispatchEvent(new Event('input')); return 1; })()`);
    await vs.wvClick(wv, `document.getElementById('maxW')`); await vs.type('2000'); await sleep(200);
    const note = await text('#pngSize');
    await shot('export-menu-width');
    const png = path.join(work, 'flow-2000.png'); fs.rmSync(png, { force: true });
    await vs.wvClick(wv, `document.getElementById('savePng')`);
    if (!await saveDialog(png)) throw new Error('PNG not written');
    const ps = pngSize(png);
    // SVG, HTML labels
    const svgHtml = path.join(work, 'flow-html.svg'); fs.rmSync(svgHtml, { force: true });
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('saveSvg')`);
    if (!await saveDialog(svgHtml)) throw new Error('SVG not written');
    const e1 = (await probe()).lastExport;
    // SVG, text labels
    const svgText = path.join(work, 'flow-text.svg'); fs.rmSync(svgText, { force: true });
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('svgText')`); await sleep(200);
    await vs.wvClick(wv, `document.getElementById('saveSvg')`);
    if (!await saveDialog(svgText)) throw new Error('SVG (text labels) not written');
    const e2 = (await probe()).lastExport;
    const st = fs.readFileSync(svgText, 'utf8'), sh = fs.readFileSync(svgHtml, 'utf8');
    const remote = s => (s.match(/(?:url\(|href=|src=|@import)\s*['"]?https?:\/\/[^'")\s]+/gi) || []);
    // put the checkbox back
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('svgText')`); await vs.key('Escape', 'Escape');
    // PDF of README.md from the export menu
    await closeAll(); await previewOf('README.md'); await rendered();
    const pdf = path.join(work, 'README.pdf'); fs.rmSync(pdf, { force: true });
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('savePdf')`);
    if (!await saveDialog(pdf)) throw new Error('PDF not written');
    await sleep(1500);
    const pdfText = fs.readFileSync(pdf).toString('latin1');
    const count = Number((/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdfText) || [])[1]);
    const images = (pdfText.match(/\/Subtype \/Image/g) || []).length;
    const res = { png: ps, note, svgHtml: { bytes: sh.length, foreignObject: (sh.match(/<foreignObject/g) || []).length, mermaidRawChars: e1 && e1.raw }, svgText: { bytes: st.length, foreignObject: (st.match(/<foreignObject/g) || []).length, remote: remote(st).length }, remoteInHtmlSvg: remote(sh).length, pdf: { bytes: pdfText.length, pages: count, images } };
    if (ps.w !== 2000 || res.svgText.foreignObject !== 0 || res.svgText.remote || res.remoteInHtmlSvg || !/^%PDF-1\.4/.test(pdfText) || count !== 6 || images < 4) throw new Error(JSON.stringify(res));
    return res;
  });

  await step('Export All Diagrams in Workspace (SVG): files written under mermaid-export, big and hostile files skipped with reasons', async () => {
    await closeAll();
    const out = path.join(ws, 'mermaid-export'); fs.rmSync(out, { recursive: true, force: true });
    const t0 = Date.now();
    await palette('Mermaid Viewer: Export All Diagrams in Workspace');
    await quickPick('SVG');
    await quickPick('');
    const msg = await vs.waitFor(async () => (await notes()).find(n => /exported \d+ file/.test(n)), 600000, 1000);
    const files = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(out, p)); } };
    if (fs.existsSync(out)) walk(out);
    await shot('batch-export-done');
    if (!msg || files.length < 100) throw new Error(JSON.stringify({ msg, files: files.length }));
    const sizes = files.map(f => fs.statSync(path.join(out, f)).size);
    return { message: msg.slice(0, 220), files: files.length, seconds: Math.round((Date.now() - t0) / 1000), totalKB: Math.round(sizes.reduce((a, b) => a + b, 0) / 1024), examples: files.filter(f => /README|many-blocks-1\.|real/.test(f)).slice(0, 4) };
  });

  await step('outline view "Mermaid Diagrams" lists the diagrams of a long Markdown file; a click moves the cursor', async () => {
    await closeAll();
    await vs.command('View: Show Explorer'); await sleep(500);
    await openFile('real/mermaid-docs-sequenceDiagram.md'); await sleep(1500);
    const rows = await vs.waitFor(() => W(`(() => { const pane = [...document.querySelectorAll('.pane')].find(p => /Mermaid Diagrams/i.test(p.querySelector('.pane-header')?.textContent || '')); if (!pane) return null; if (pane.querySelector('.pane-header')?.getAttribute('aria-expanded') === 'false') { pane.querySelector('.pane-header').click(); return null; } const r = [...pane.querySelectorAll('.monaco-list-row')].map(x => x.textContent); return r.length ? r : null; })()`), 10000, 300);
    if (!rows) throw new Error('no outline rows');
    const b = JSON.parse(await W(`JSON.stringify([...document.querySelectorAll('.pane')].find(p => /Mermaid Diagrams/i.test(p.querySelector('.pane-header')?.textContent || '')).querySelectorAll('.monaco-list-row')[3].getBoundingClientRect())`));
    await vs.click(b.x + 60, b.y + b.height / 2); await sleep(700);
    const pos = await W(`[...document.querySelectorAll('.statusbar-item')].map(e => e.innerText).find(t => /^Ln \\d+/.test(t)) || ''`);
    await shot('outline-view');
    if (!/^Ln \d+/.test(pos) || /^Ln 1,/.test(pos)) throw new Error(JSON.stringify({ rows: rows.slice(0, 5), pos }));
    return { visibleRows: rows.length, firstRows: rows.slice(0, 4), cursorAfterClick: pos };
  });

  await step('real MIT docs pages (116 and 38 mermaid blocks): every block draws or shows its own error; VS Code stays responsive', async () => {
    const out = {};
    for (const f of ['real/mermaid-docs-flowchart.md', 'real/mermaid-docs-sequenceDiagram.md']) {
      await closeAll(); await previewOf(f);
      const t0 = Date.now();
      const p = await vs.waitFor(async () => { const r = await probe(); return r.rendered >= 1 ? r : null; }, 360000, 500); // a busy shared Mac can take minutes for 116 diagrams
      const l = await lag();
      out[path.basename(f)] = { items: p && p.items, good: p && p.good.length, errors: p && p.errors.length, firstErrors: p && p.errors.slice(0, 3).map(e => e[1].slice(0, 90)), seconds: Math.round((Date.now() - t0) / 100) / 10, workbenchLagMs: l };
      if (!p || p.good.length + p.errors.length !== p.items || l > 1500) throw new Error(JSON.stringify(out));
    }
    await shot('real-docs');
    return out;
  });

  await step('large: 2,000-node flowchart and 300-step sequence draw; 5 MB .mmd gets a size message; 200 blocks in one .md', async () => {
    const out = {};
    const sf = path.join(vs.ud, 'User', 'settings.json');
    const cfg = JSON.parse(fs.readFileSync(sf, 'utf8'));
    for (const [f, limit] of [['flow-2000-nodes.mmd', 10], ['flow-2000-nodes.mmd', 90], ['sequence-300.mmd', 10]]) {
      fs.writeFileSync(sf, JSON.stringify({ ...cfg, 'mermaidViewer.renderTimeoutSeconds': limit }, null, 1)); await sleep(1200);
      await closeAll(); await previewOf(f);
      const t0 = Date.now();
      let res = null;
      while (!res && Date.now() - t0 < (limit + 20) * 1000) {
        try { const r = await probe(); if (r.rendered >= 1) res = { drawn: r.good.includes(0), errors: r.errors.map(e => e[1].slice(0, 120)), renderMs: r.renderMs[0] }; } catch { /* page replaced */ }
        const n = (await notes()).find(x => /took longer than/.test(x));
        if (!res && n) res = { stopped: true, message: n.slice(0, 200) };
        await sleep(300);
      }
      out[`${f} (limit ${limit} s)`] = Object.assign(res || { hang: true }, { seconds: Math.round((Date.now() - t0) / 100) / 10, lagMs: await lag() });
      await vs.command('Notifications: Clear All Notifications');
    }
    fs.writeFileSync(sf, JSON.stringify(cfg, null, 1)); await sleep(1000);
    await shot('large-sequence-300');
    await closeAll(); await previewOf('huge-5mb.mmd');
    const p5 = await rendered(1, 60000);
    out['huge-5mb.mmd'] = { message: p5 && p5.errors.map(e => e[1].slice(0, 160)), lagMs: await lag() };
    await closeAll(); await previewOf('many-blocks.md');
    const t0 = Date.now();
    const pm = await rendered(1, 120000);
    out['many-blocks.md'] = { items: pm.items, good: pm.good.length, errors: pm.errors.length, seconds: Math.round((Date.now() - t0) / 100) / 10, lagMs: await lag() };
    await shot('many-blocks');
    const f10 = out['flow-2000-nodes.mmd (limit 10 s)'], f90 = out['flow-2000-nodes.mmd (limit 90 s)'];
    if (f10.hang || !(f10.drawn || f10.stopped) || !f90.drawn || !out['sequence-300.mmd (limit 10 s)'].drawn || !/characters/.test(JSON.stringify(out['huge-5mb.mmd'].message)) || pm.items !== 200 || pm.good.length !== 198 || pm.errors.length !== 2) throw new Error(JSON.stringify(out));
    return out;
  });

  await step('hostile: HTML and javascript: links in Markdown blocks do nothing; a 4,000-line error file shows an error fast; no dialog, no request', async () => {
    await closeAll(); await previewOf('hostile-links.md'); const p = await rendered();
    const dom = await E(`(() => { const all = [...document.querySelectorAll('#list *, #stage *')]; return JSON.stringify({ js: all.filter(e => [...e.attributes].some(a => /^on/i.test(a.name) || /javascript:/i.test(a.value))).length, img: document.querySelectorAll('#list img, #stage img').length, remote: all.filter(e => [...e.attributes].some(a => /^(href|src|xlink:href)$/i.test(a.name) && /^https?:/i.test(a.value))).length }); })()`);
    await shot('hostile-links');
    await closeAll(); await openFile('hostile-loop-error.mmd'); await sleep(800);
    const t0 = Date.now();
    await palette('Mermaid Viewer: Open Preview to the Side');
    wv = await findWv('hostile-loop-error.mmd'); await netOn();
    const pe = await rendered(1, 30000);
    const errMs = Date.now() - t0;
    const l = await lag();
    const res = { linksMd: { items: p.items, good: p.good.length, errors: p.errors.map(e => e[1].slice(0, 100)), dom: JSON.parse(dom), cspViolations: p.cspViolations.length }, loopError: { ms: errMs, drawn: pe.good.length, error: (pe.errors[0] || [])[1]?.slice(0, 140), lagMs: l }, dialogs: R.dialogs.length };
    if (JSON.parse(dom).js || JSON.parse(dom).img || JSON.parse(dom).remote || R.dialogs.length || l > 1500 || errMs > 20000) throw new Error(JSON.stringify(res));
    return res;
  });

  await step('trackpad and mouse (wheel setting "auto"): two-finger scroll pans, pinch zooms, a mouse wheel notch zooms', async () => {
    await closeAll(); await previewOf('class.mmd'); await rendered();
    const off = await vs.wvOffset();
    const vp = JSON.parse(await E(`JSON.stringify(document.getElementById('viewport').getBoundingClientRect())`));
    const cx = off.x + vp.x + vp.width / 2, cy = off.y + vp.y + vp.height / 2;
    const a = (await probe()).view;
    for (let i = 0; i < 4; i++) { await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 15, deltaY: 7 }, vs.wb); await sleep(40); }
    await sleep(400);
    const b = (await probe()).view;
    for (let i = 0; i < 3; i++) { await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -12, modifiers: 2 }, vs.wb); await sleep(40); }
    await sleep(400);
    const c = (await probe()).view;
    for (let i = 0; i < 2; i++) { await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120 }, vs.wb); await sleep(40); }
    await sleep(400);
    const d = (await probe()).view;
    const res = { pan: { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), zoomSame: Math.abs(b.k - a.k) < 1e-6 }, pinchZoom: +(c.k / b.k).toFixed(3), wheelZoom: +(d.k / c.k).toFixed(3) };
    if (!res.pan.zoomSame || res.pan.dx > -20 || !(res.pinchZoom > 1.05) || !(res.wheelZoom > 1.05)) throw new Error(JSON.stringify({ res, a, b, c, d }));
    return res;
  });

  await step('light theme: the diagram theme follows VS Code; README screenshot of the split editor', async () => {
    await closeAll();
    await vs.command('View: Close Primary Side Bar'); await sleep(500);
    await editorFor('sequence.mmd'); await rendered(); await sleep(900);
    const hero = await shot('readme-split-editor-dark');
    const sf = path.join(vs.ud, 'User', 'settings.json');
    const cfg = JSON.parse(fs.readFileSync(sf, 'utf8'));
    fs.writeFileSync(sf, JSON.stringify({ ...cfg, 'workbench.colorTheme': 'Default Light Modern' }, null, 1));
    const p = await vs.waitFor(async () => { const r = await probe(); return r.theme === 'default' && r.rendered >= 2 ? r : null; }, 15000, 200);
    await sleep(800);
    const light = await shot('readme-split-editor-light');
    fs.writeFileSync(sf, JSON.stringify(cfg, null, 1)); await sleep(1500);
    // Markdown with its CodeLens next to the preview of all its diagrams
    await closeAll(); await previewOf('README.md'); await rendered(); await sleep(400);
    await openFile('README.md'); await sleep(1500);
    const lensShot = await shot('readme-markdown-codelens');
    // Markdown + block editor screenshot
    await closeAll(); await openFile('README.md'); await sleep(1200);
    const b = JSON.parse(await W(`JSON.stringify([...document.querySelectorAll('.codelens-decoration a')].filter(a => /Edit diagram/.test(a.textContent))[0].getBoundingClientRect())`));
    await vs.click(b.x + b.width / 2, b.y + b.height / 2);
    wv = await findWv('README diagram 1.mmd'); await netOn(); await rendered(); await sleep(900);
    const md = await shot('readme-markdown-block-editor');
    await vs.command('View: Toggle Primary Side Bar Visibility'); await sleep(400);
    if (!p) throw new Error('theme did not follow');
    return { theme: p.theme, shots: [hero, light, lensShot, md].map(f => path.basename(f)) };
  });

  await step('no remote request from any webview during the whole run; rating ask and footer links unchanged', async () => {
    const mine = R.network.filter(n => /vscode-webview|webview/.test(n.where));
    await closeAll(); await previewOf('pie.mmd'); await rendered();
    const footer = await text('#zovo-support');
    if (mine.length || !/Rate/.test(footer) || !/Sponsor/.test(footer) || !/More free viewers/.test(footer)) throw new Error(JSON.stringify({ mine: mine.slice(0, 5), footer }));
    return { webviewRemoteRequests: 0, workbenchRequests: R.network.length, footer };
  });
} catch (e) {
  R.fatal = String(e.stack || e).slice(0, 1000);
  console.log('FATAL', R.fatal);
} finally {
  if (vs) { R.console = vs.console.filter(c => /mermaid|webview|preview|CSP|Content Security/i.test(c.text) || /webview/.test(c.where)).slice(0, 40); await vs.close(); }
  for (const t of TEMPLATES) fs.rmSync(path.join(ws, `tmpl-${t.id}.mmd`), { force: true });
  fs.writeFileSync(path.join(ws, 'README.md'), README0);
  R.shots = shots; R.ended = new Date().toISOString();
  R.pass = R.steps.filter(s => s.ok).length; R.total = R.steps.length;
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(`${R.pass}/${R.total} steps passed; network ${R.network.length}; dialogs ${R.dialogs.length}`);
}
