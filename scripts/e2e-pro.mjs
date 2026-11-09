// Release check for Zovo Pro in Mermaid Viewer 0.3.0, in a real VS Code with a clean profile:
// nothing about Pro on open, the Save PDF button has a small Pro tag, PDF export runs 3 free tries (status bar note,
// no dialog) and the 4th start shows one modal with the unlock ways and the USD 19 text, Escape runs nothing;
// Export on Save writes name.svg next to a .mmd and name-1.svg / name-2.svg next to a Markdown file and redraws only
// changed diagrams; the outline is free; showProFeatures=false hides the Pro commands. Records network requests.
// usage: node scripts/e2e-pro.mjs <work> <port> <vsix> <shotDir> <outJson>
import { launch, installVsix, sleep } from './vsc.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [work0, port0, vsix, shotDir, outJson] = process.argv.slice(2);
const work = path.resolve(work0), port = Number(port0);
const ws = path.join(work, 'ws');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });
fs.writeFileSync(path.join(ws, 'flow.mmd'), 'flowchart LR\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n');
fs.writeFileSync(path.join(ws, 'seq.mmd'), 'sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: GET /items\n  S-->>U: 200 OK\n');
fs.writeFileSync(path.join(ws, 'README.md'), '# Docs\n\n## Flow\n\n```mermaid\nflowchart TD\n  X --> Y\n```\n\n## Calls\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n');
const R = { started: new Date().toISOString(), steps: [], network: [] };
R.install = installVsix(work, vsix);
const SETTINGS = { 'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true, 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.colorTheme': 'Default Dark Modern', 'editor.minimap.enabled': false, 'workbench.editor.enablePreview': false, 'mermaidViewer.askForRating': false };
let vs;
const W = (e) => vs.wbEval(e);
const shot = async (name) => { const f = path.join(shotDir, `pro-${name}.png`); try { await vs.shot(f); } catch { /* recorded below */ } return f; };
async function clearDialogs() {
  for (let i = 0; i < 3; i++) {
    const d = await dialog().catch(() => null);
    const qp = await W(`(() => { const w = document.querySelector('.quick-input-widget'); return !!(w && w.style.display !== 'none' && w.offsetParent); })()`).catch(() => false);
    if (!d && !qp) return;
    await vs.key('Escape', 'Escape'); await sleep(400);
  }
}
const step = async (name, fn) => {
  const t0 = Date.now();
  await clearDialogs();
  try { const v = await fn(); const ok = v !== false && !(v && v.ok === false); R.steps.push({ name, ok, value: v, ms: Date.now() - t0 }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(v).slice(0, 300)); }
  catch (e) { R.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 800), ms: Date.now() - t0 }); console.log('FAIL', name, String(e.message || e).slice(0, 400)); await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); }
};
const dialog = () => W(`(() => { const d = document.querySelector('.monaco-dialog-box'); return d ? [...d.querySelectorAll('.monaco-button')].map(b => b.textContent).join(' | ') + ' :: ' + d.textContent.slice(0, 500) : null; })()`);
const statusText = () => W(`[...document.querySelectorAll('.part.statusbar .statusbar-item')].map(x => x.textContent.trim()).filter(Boolean).join(' || ')`);
const notes = () => W(`[...document.querySelectorAll('.notification-list-item')].map(n => n.textContent.slice(0, 300))`);
async function openFile(f) { vs.open(path.join(ws, f)); await vs.waitFor(() => W(`!!document.querySelector('.tabs-container .tab.active[aria-label^="${path.basename(f)}"]')`), 15000); await sleep(600); }
async function saveDialog(target) {
  await vs.waitFor(() => W(`!!document.querySelector('.quick-input-widget input') && document.querySelector('.quick-input-widget').style.display !== 'none'`), 8000);
  await sleep(300);
  const ib = JSON.parse(await W(`JSON.stringify(document.querySelector('.quick-input-widget input').getBoundingClientRect())`));
  await vs.click(ib.x + ib.width / 2, ib.y + ib.height / 2); await vs.key('a', 'KeyA', 4, 65); await vs.type(target);
  await sleep(300); await vs.key('Enter', 'Enter');
  return vs.waitFor(() => fs.existsSync(target) && fs.statSync(target).size > 100, 25000);
}
async function pick(label) {
  await vs.waitFor(() => W(`(() => { const w = document.querySelector('.quick-input-widget'); return !!(w && w.style.display !== 'none' && w.offsetParent); })()`), 8000);
  await sleep(300); await vs.type(label); await sleep(500); await vs.key('Enter', 'Enter'); await sleep(700);
}
async function focusEditor() {
  const b = JSON.parse(await W(`JSON.stringify([...document.querySelectorAll('.editor-group-container.active .monaco-editor .view-lines')].filter(e => e.getBoundingClientRect().width > 0)[0]?.getBoundingClientRect() || null)`));
  if (!b) throw new Error('no text editor');
  await vs.click(b.x + 200, b.y + 8);
}
async function paletteHas(text) {
  await vs.wbEval(`(document.querySelector('.part.statusbar') || document.body).focus && 1`);
  await vs.key('p', 'KeyP', 4 | 8, 80);
  await vs.waitFor(() => W(`!!document.querySelector('.quick-input-widget input')`), 4000);
  await vs.type(text); await sleep(900);
  const rows = await W(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') || r.textContent).slice(0, 10)`);
  await vs.key('Escape', 'Escape'); await sleep(300);
  return rows;
}

try {
  vs = await launch(work, port, ws, SETTINGS);
  vs.s.on((m) => { if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (!/^(vscode-file|vscode-webview|data|blob|devtools|about):|^https:\/\/[^/]*\.vscode-cdn\.net\//.test(u)) R.network.push(u.slice(0, 200)); } });
  await sleep(3000);
  await step('install', async () => ({ ok: R.install.code === 0, out: R.install.out.trim().split('\n').pop() }));

  await step('open flow.mmd with the diagram editor: drawn, no Pro dialog or toast on open', async () => {
    await openFile('flow.mmd');
    await vs.command('Mermaid Viewer: Open Diagram Editor');
    const wv = await vs.waitFor(async () => (await vs.webviews()).find((w) => w.title === 'flow.mmd' && w.w > 0), 20000);
    if (!wv) throw new Error('no preview');
    const ok = await vs.waitFor(() => vs.wvEval(wv, `!!document.querySelector('svg[id^="mv"]') || document.querySelectorAll('svg').length > 1`), 20000);
    const tag = await vs.wvEval(wv, `(document.getElementById('savePdf') || {}).outerHTML || 'none'`);
    const d = await dialog(); const n = (await notes()).filter((x) => /Pro|Zovo|license/i.test(x));
    await shot('01-open');
    return { ok: !!ok && !d && n.length === 0 && /<span class="pro">Pro<\/span>/.test(tag), drawn: !!ok, dialog: d, proToasts: n, pdfButton: tag.slice(0, 200) };
  });

  const pdfs = [];
  for (let i = 1; i <= 3; i++) {
    await step(`Export to PDF, free try ${i} of 3: the PDF is written, the status bar says so, no dialog`, async () => {
      await openFile('flow.mmd');
      await vs.command('Mermaid Viewer: Export Diagrams to PDF');
      const target = path.join(ws, `flow-${i}.pdf`);
      const st = await vs.waitFor(async () => { const t = await statusText(); return new RegExp(`Free try ${i} of 3`).test(t) ? t : null; }, 6000, 150);
      const d0 = await dialog();
      const ok = await saveDialog(target);
      const head = ok ? fs.readFileSync(target).subarray(0, 8).toString('latin1') : '';
      pdfs.push(target);
      return { ok: !!ok && /^%PDF-1\.4/.test(head) && !!st && !d0, status: st && st.match(/Mermaid Viewer: [^|]*/)?.[0], bytes: ok ? fs.statSync(target).size : 0 };
    });
  }
  await step('Export to PDF, 4th start: one modal with Sponsors, license key, Get Zovo Pro and USD 19; Escape writes nothing', async () => {
    await vs.command('Mermaid Viewer: Export Diagrams to PDF');
    const d = await vs.waitFor(dialog, 6000, 200);
    await shot('02-modal');
    await vs.key('Escape', 'Escape'); await sleep(1000);
    const after = await dialog();
    const qp = await W(`(() => { const w = document.querySelector('.quick-input-widget'); return !!(w && w.style.display !== 'none' && w.offsetParent); })()`);
    return { ok: !!d && /GitHub Sponsors/.test(d) && /license key/i.test(d) && /Get Zovo Pro/.test(d) && /USD 19/.test(d) && !/USD 15/.test(d) && !after && !qp, dialog: (d || '').slice(0, 400) };
  });

  await step('Export on Save: pick SVG; saving flow.mmd writes flow.svg next to it (one try for this window)', async () => {
    await openFile('flow.mmd');
    await vs.command('Mermaid Viewer: Export on Save');
    await pick('SVG');
    const svg = path.join(ws, 'flow.svg');
    let ok = await vs.waitFor(() => fs.existsSync(svg), 15000); // the command exports the open file at once
    const first = ok ? fs.statSync(svg).mtimeMs : 0;
    await clearDialogs();
    await focusEditor();
    await vs.command('Go to Line/Column...'); await vs.type('5'); await vs.key('Enter', 'Enter'); await sleep(300);
    await vs.type('  C --> E[Done]'); await sleep(400);
    await vs.key('s', 'KeyS', 4, 83); await sleep(300);
    ok = await vs.waitFor(() => fs.existsSync(svg) && fs.statSync(svg).mtimeMs > first && /Done/.test(fs.readFileSync(svg, 'utf8')), 20000);
    const settings = JSON.parse(fs.readFileSync(path.join(ws, '.vscode', 'settings.json'), 'utf8'));
    await shot('03-export-on-save');
    if (!ok) R.debugFlow = fs.readFileSync(path.join(ws, 'flow.mmd'), 'utf8');
    return { ok: !!ok && settings['mermaidViewer.exportOnSave'] === 'svg', settings, status: (await statusText()).match(/Mermaid Viewer: [^|]*/)?.[0], bytes: fs.existsSync(svg) ? fs.statSync(svg).size : 0 };
  });
  await step('Export on Save: saving again without a change redraws nothing; README.md writes README-1.svg and README-2.svg', async () => {
    const svg = path.join(ws, 'flow.svg');
    const m0 = fs.statSync(svg).mtimeMs;
    await vs.key('s', 'KeyS', 4, 83); await sleep(300); await sleep(2500);
    const same = fs.statSync(svg).mtimeMs === m0;
    await openFile('README.md');
    await clearDialogs();
    await focusEditor();
    await vs.command('Go to Line/Column...'); await vs.type('1'); await vs.key('Enter', 'Enter'); await sleep(300);
    await vs.type('Intro '); await sleep(400);
    await vs.key('s', 'KeyS', 4, 83); await sleep(300);
    const ok = await vs.waitFor(() => fs.existsSync(path.join(ws, 'README-1.svg')) && fs.existsSync(path.join(ws, 'README-2.svg')), 20000);
    return { ok: same && !!ok, unchangedNotRewritten: same, files: fs.readdirSync(ws).filter((f) => /\.svg$/.test(f)) };
  });
  await step('outline view lists the diagrams without any Pro row', async () => {
    await openFile('README.md');
    await vs.command('Explorer: Focus on Mermaid Diagrams View');
    await sleep(1500);
    const rows = await W(`[...document.querySelectorAll('.monaco-list-row')].map(r => r.getAttribute('aria-label') || '').filter(x => /flowchart|sequence|Zovo Pro/i.test(x))`);
    return { ok: rows.length >= 2 && !rows.some((r) => /Zovo Pro/.test(r)), rows };
  });
  await step('showProFeatures=false hides the Pro commands from the Command Palette; true shows them', async () => {
    const on = await paletteHas('Mermaid Viewer: Export Diagrams to PDF');
    const user = path.join(work, 'ud', 'User', 'settings.json');
    const s = JSON.parse(fs.readFileSync(user, 'utf8')); s['mermaidViewer.showProFeatures'] = false; fs.writeFileSync(user, JSON.stringify(s, null, 1));
    await sleep(2500);
    const off = await paletteHas('Mermaid Viewer: Export Diagrams to PDF');
    const offKey = await paletteHas('Zovo: Get Pro');
    return { ok: on.some((r) => /Export Diagrams to PDF/.test(r)) && !off.some((r) => /Export Diagrams to PDF/.test(r)) && !offKey.some((r) => /Zovo: Get Pro/.test(r)), on: on.slice(0, 3), off: off.slice(0, 3), offKey: offKey.slice(0, 3) };
  });
  await step('no network requests from the extension or its pages', async () => ({ ok: R.network.length === 0, network: R.network.slice(0, 5) }));
  const errs = vs.console.filter((c) => /mermaid|zovo|preview\.js|batch\.js/i.test(c.text) && !/Electron Security Warning/.test(c.text));
  await step('no console errors from the extension', async () => ({ ok: errs.length === 0, errors: errs.slice(0, 5) }));
} catch (e) {
  R.steps.push({ name: 'gate script', ok: false, error: String(e.stack || e).slice(0, 1200) });
  console.log('FAIL gate script', e.stack || e);
} finally {
  R.ended = new Date().toISOString();
  R.pass = R.steps.filter((s) => s.ok).length; R.fail = R.steps.filter((s) => !s.ok).length;
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(`${R.pass} PASS, ${R.fail} FAIL`);
  if (vs) await vs.close();
}
