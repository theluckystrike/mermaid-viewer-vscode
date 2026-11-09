// Release check in a real VS Code. Installs the .vsix into a clean profile, opens the samples (normal, large and
// hostile), drives the preview with real clicks and keys, records every network request and dialog the webviews
// try, saves screenshots and writes a JSON report.
// usage: node scripts/e2e-vscode.mjs <work> <port> <vsix> <workspace> <shotDir> <outJson>
// <workspace> must hold the files from: node scripts/make-samples.mjs <workspace> --large <workspace>
import { launch, installVsix, sleep } from './vsc.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const [work0, port0, vsix, ws0, shotDir, outJson] = process.argv.slice(2);
const work = path.resolve(work0), ws = path.resolve(ws0), port = Number(port0);
const R = { started: new Date().toISOString(), install: null, steps: [], network: [], dialogs: [], console: [], notifications: [] };
fs.rmSync(path.join(work, 'ud'), { recursive: true, force: true });
fs.rmSync(path.join(work, 'ext'), { recursive: true, force: true });
R.install = installVsix(work, vsix);
const clipBefore = (() => { try { return execSync('pbpaste', { encoding: 'utf8' }); } catch { return null; } })();
const SETTINGS = { 'window.menuStyle': 'custom', 'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true, 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.auxiliaryBar.visible': false, 'window.titleBarStyle': 'custom', 'chat.commandCenter.enabled': false, 'workbench.colorTheme': 'Default Dark Modern', 'editor.minimap.enabled': false };
let vs;
const shots = [];
const shot = async name => { const f = path.join(shotDir, `mermaid-${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await vs.shot(f); shots.push(f); return f; };
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const v = await fn(); R.steps.push({ name, ok: v !== false, value: v, ms: Date.now() - t0 }); console.log('PASS', name); }
  catch (e) { R.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 800), ms: Date.now() - t0 }); console.log('FAIL', name, String(e.message || e).slice(0, 300)); try { await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); } catch {} }
};

// Every request from any webview or the workbench that is not a local VS Code resource.
const LOCAL = /^(vscode-file|vscode-webview|vscode-resource|data|blob|devtools|chrome-extension|about):|^https:\/\/[^/]*\.vscode-cdn\.net\/|^https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\//;
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
async function openFile(f) { vs.open(path.join(ws, f)); await vs.waitFor(() => vs.wbEval(`!!document.querySelector('.tabs-container .tab.active[aria-label^="${f}"]')`), 10000); await sleep(400); }
async function preview(f, how = 'palette') {
  await openFile(f);
  const t0 = Date.now();
  if (how === 'title') {
    const b = JSON.parse(await vs.wbEval(`(() => { const a = [...document.querySelectorAll('.editor-actions .action-label')].find(x => /Open Preview to the Side/.test(x.getAttribute('aria-label') || '') && x.getBoundingClientRect().width > 0); if (!a) return 'null'; const r = a.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`));
    if (!b) throw new Error('no editor title button');
    await vs.click(b.x, b.y);
  } else {
    // The palette sometimes drops the typed text in this driver; try again when no preview tab shows up.
    for (let i = 0; i < 3; i++) {
      await vs.command('Mermaid Viewer: Open Preview to the Side');
      if (await vs.waitFor(() => vs.wbEval(`[...document.querySelectorAll('.tabs-container .tab')].some(t => (t.getAttribute('aria-label') || '').startsWith('Preview ${f}'))`), 3000)) break;
      R.paletteRetries = (R.paletteRetries || 0) + 1;
    }
  }
  wv = await findWv(f);
  if (!wv) {
    const tabs = await vs.wbEval(`[...document.querySelectorAll('.tabs-container .tab')].map(t => t.getAttribute('aria-label')).join(' | ')`);
    const notes = await vs.wbEval(`[...document.querySelectorAll('.notification-list-item')].map(n => n.textContent.slice(0, 160)).join(' | ')`);
    const all = (await vs.webviews()).map(w => w.title + ':' + Math.round(w.w));
    throw new Error('no preview webview for ' + f + ' ' + JSON.stringify({ tabs, notes, all }));
  }
  await netOn();
  return t0;
}
const rendered = async (n = 1, ms = 30000) => { const p = await vs.waitFor(async () => { const r = await probe(); return r.rendered >= n ? r : null; }, ms, 100); if (!p) throw new Error('not rendered: ' + JSON.stringify(await probe())); return p; };
const text = sel => E(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
const visible = sel => E(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; })()`);
const closeAll = async () => { await vs.command('View: Close All Editors'); await sleep(500); };
const select = async (sel, value) => { await E(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return 1; })()`); await sleep(500); };
const lag = async () => { const t = Date.now(); await vs.wbEval('1+1'); return Date.now() - t; };
async function saveDialog(target) {
  await vs.waitFor(() => vs.wbEval(`!!document.querySelector('.quick-input-widget input') && document.querySelector('.quick-input-widget').style.display !== 'none'`), 8000);
  await sleep(300);
  const ib = JSON.parse(await vs.wbEval(`JSON.stringify(document.querySelector('.quick-input-widget input').getBoundingClientRect())`));
  await vs.click(ib.x + ib.width / 2, ib.y + ib.height / 2); await vs.key('a', 'KeyA', 4, 65); await vs.type(target);
  await sleep(300); await vs.key('Enter', 'Enter');
  return vs.waitFor(() => fs.existsSync(target) && fs.statSync(target).size > 100, 10000);
}
const pngSize = f => { const h = fs.readFileSync(f).subarray(0, 24); if (h.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG'); return { w: h.readUInt32BE(16), h: h.readUInt32BE(20), bytes: fs.statSync(f).size }; };

const DOCS = ['flowchart.mmd', 'sequence.mmd', 'class.mmd', 'state.mmd', 'er.mmd', 'gantt.mmd', 'pie.mmd', 'gitgraph.mmd', 'mindmap.mmd', 'timeline.mmd', 'sankey.mmd', 'xychart.mmd', 'block.mmd', 'c4.mmd', 'architecture.mmd', 'front-matter.mermaid'];

try {
  vs = await launch(work, port, ws, SETTINGS);
  watch(); await netOn();
  await sleep(2500);

  await step('flowchart.mmd: preview opens from the editor title button; first render under 1 s', async () => {
    const t0 = await preview('flowchart.mmd', 'title');
    const p = await rendered();
    const ms = Date.now() - t0;
    const info = await text('#status');
    await sleep(500); await shot('flowchart-dark');
    if (!p.good.includes(0) || p.errors.length || !/Mermaid 12\.3\.0/.test(info)) throw new Error(JSON.stringify({ p, info }));
    const renderMs = Number((/(\d+) ms/.exec(info) || [])[1]);
    if (!(renderMs < 1000)) throw new Error('render ' + renderMs + ' ms');
    return { clickToDrawnMs: ms, renderMs, info, size: p.size };
  });

  await step('16 docs examples: each draws from the command palette with no error, each under 1 s', async () => {
    const out = {};
    for (const f of DOCS) {
      await closeAll();
      await preview(f);
      const p = await rendered();
      const info = await text('#status');
      const ms = Number((/(\d+) ms/.exec(info) || [])[1]);
      const labels = await E(`[...document.querySelectorAll('#stage svg text, #stage svg foreignObject div, #stage svg tspan')].length`);
      out[f] = { ok: p.good.includes(0) && !p.errors.length, ms, type: (/· ([\w-]+) ·/.exec(info) || [])[1], labels, err: p.errors[0] && p.errors[0][1] };
      if (['sequence.mmd', 'gantt.mmd', 'mindmap.mmd', 'class.mmd'].includes(f)) await shot(f.replace('.', '-'));
    }
    const bad = Object.entries(out).filter(([, v]) => !v.ok || !(v.ms < 1000));
    if (bad.length) throw new Error(JSON.stringify(bad));
    return out;
  });

  await step('labels are not cut off: every label fits inside its box', async () => {
    const out = {};
    for (const f of ['flowchart.mmd', 'class.mmd', 'mindmap.mmd']) {
      await closeAll(); await preview(f); await rendered();
      const r = JSON.parse(await E(`JSON.stringify([...document.querySelectorAll('#stage svg foreignObject')].map(fo => { const w = parseFloat(fo.getAttribute('width')) || 0, h = parseFloat(fo.getAttribute('height')) || 0; const inner = fo.firstElementChild; if (!inner || !w) return null; return { t: fo.textContent.trim().slice(0, 30), w: Math.round(w), h: Math.round(h), sw: inner.scrollWidth, sh: inner.scrollHeight, clipped: inner.scrollWidth > w + 1 || inner.scrollHeight > h + 1 }; }).filter(x => x && x.t))`));
      const t = JSON.parse(await E(`JSON.stringify([...document.querySelectorAll('#stage svg text')].length)`));
      out[f] = { htmlLabels: r.length, svgTexts: t, clipped: r.filter(x => x.clipped) };
    }
    const bad = Object.values(out).filter(v => v.clipped.length || !(v.htmlLabels + v.svgTexts));
    if (bad.length) throw new Error(JSON.stringify(out));
    return out;
  });

  await step('zoom at the pointer with the wheel, drag to pan, Fit and 100% by real input', async () => {
    const off = await vs.wvOffset();
    const vp = JSON.parse(await E(`JSON.stringify(document.getElementById('viewport').getBoundingClientRect())`));
    const cx = off.x + vp.x + vp.width / 2, cy = off.y + vp.y + vp.height / 2;
    const a = (await probe()).view;
    for (let i = 0; i < 3; i++) { await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120 }, vs.wb); await sleep(60); }
    await sleep(300);
    const b = (await probe()).view;
    // the point under the pointer stays put: (c - x) / k is the same before and after
    const lx = vp.width / 2, ly = vp.height / 2;
    const driftX = Math.abs((lx - a.x) / a.k - (lx - b.x) / b.k), driftY = Math.abs((ly - a.y) / a.k - (ly - b.y) / b.k);
    await vs.s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 }, vs.wb);
    for (let i = 1; i <= 5; i++) { await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 20, y: cy + i * 10, button: 'left', buttons: 1 }, vs.wb); await sleep(30); }
    await vs.s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 100, y: cy + 50, button: 'left', clickCount: 1 }, vs.wb);
    await sleep(200);
    const c = (await probe()).view;
    await vs.wvClick(wv, `document.getElementById('actual')`); await sleep(200);
    const d = (await probe()).view;
    await vs.wvClick(wv, `document.getElementById('fit')`); await sleep(200);
    const e = (await probe()).view;
    if (!(b.k > a.k * 1.3) || driftX > 2 || driftY > 2 || Math.abs(c.x - b.x - 100) > 3 || Math.abs(c.y - b.y - 50) > 3 || Math.abs(d.k - 1) > 1e-6 || Math.abs(e.k - a.k) > 1e-3) throw new Error(JSON.stringify({ a, b, c, d, e, driftX, driftY }));
    return { fitK: +a.k.toFixed(3), wheelK: +b.k.toFixed(3), pointerDrift: +Math.max(driftX, driftY).toFixed(3), panned: [Math.round(c.x - b.x), Math.round(c.y - b.y)], label: await text('#zoomLabel') };
  });

  await step('live update while typing; a syntax error shows its line and keeps the last good diagram', async () => {
    await closeAll(); await preview('flowchart.mmd'); await rendered();
    const before = (await probe()).rendered;
    // focus the text editor and go to the end
    await vs.command('View: Focus Active Editor Group');
    const edBox = JSON.parse(await vs.wbEval(`JSON.stringify([...document.querySelectorAll('.monaco-editor .view-lines')].filter(e => e.getBoundingClientRect().width > 0)[0].getBoundingClientRect())`));
    await vs.click(edBox.x + 60, edBox.y + 10);
    await vs.key('ArrowDown', 'ArrowDown', 4, 40); await vs.key('End', 'End', 0, 35); // Cmd+Down, End: end of the file
    await vs.type('\n  done --> extra[Typed live]');
    const p1 = await vs.waitFor(async () => { const r = await probe(); return r.rendered > before && !r.errors.length && (await E(`document.getElementById('stage').textContent.includes('Typed live')`)) ? r : null; }, 8000, 100);
    if (!p1) { await vs.command('File: Revert File'); throw new Error('no live update: ' + JSON.stringify(await probe())); }
    await vs.type('\n  X --> --> Y');
    const p2 = await vs.waitFor(async () => { const r = await probe(); return r.errors.length ? r : null; }, 8000, 100);
    const msg = await text('#problem');
    const stillThere = await E(`document.getElementById('stage').textContent.includes('Typed live')`);
    const diag = await vs.wbEval(`document.querySelector('.statusbar-item[id*="problems"], #status\\\\.problems')?.innerText || ''`);
    await shot('syntax-error-keeps-last-good');
    if (!p2 || !p2.stale || !stillThere || !/^Line 19: Syntax error: unexpected LINK$/m.test(msg)) { await vs.command('File: Revert File'); throw new Error(JSON.stringify({ p2, msg, stillThere })); }
    // click the error: the cursor goes to line 19
    await vs.wvClick(wv, `document.querySelector('#problem button.problem')`); await sleep(500);
    const pos = await vs.wbEval(`[...document.querySelectorAll('.statusbar-item')].map(e => e.innerText).find(t => /^Ln \\d+/.test(t)) || ''`);
    await vs.command('File: Revert File');
    const p3 = await vs.waitFor(async () => { const r = await probe(); return !r.errors.length && !r.stale ? r : null; }, 8000, 100);
    if (!p3 || !/^Ln 19\b/.test(pos)) { await vs.command('File: Revert File'); throw new Error(JSON.stringify({ p3, pos })); }
    return { liveRenders: p1.rendered - before, error: msg.split('\n')[0], cursorAfterClick: pos, problemsBadge: diag, backToGoodAfterRevert: true };
  });

  await step('export PNG 2x with max width 1200 px, SVG, Copy PNG and Copy SVG code', async () => {
    await closeAll(); await preview('flowchart.mmd'); await rendered();
    // flowchart TD is tall: use sequence (wide) for the width limit
    await closeAll(); await preview('sequence.mmd'); const p = await rendered();
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.querySelector('input[name="scale"][value="2"]')`);
    await vs.wvClick(wv, `document.getElementById('maxW')`); await vs.type('1200'); await sleep(200);
    const sizeNote = await text('#pngSize');
    await shot('export-menu');
    const png = path.join(work, 'out-sequence.png'), svg = path.join(work, 'out-sequence.svg');
    fs.rmSync(png, { force: true }); fs.rmSync(svg, { force: true });
    await vs.wvClick(wv, `document.getElementById('savePng')`);
    if (!await saveDialog(png)) throw new Error('PNG not written');
    const ps = pngSize(png);
    const want2x = Math.round(p.size.w * 2);
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('saveSvg')`);
    if (!await saveDialog(svg)) throw new Error('SVG not written');
    const svgText = fs.readFileSync(svg, 'utf8');
    // Copy PNG: the clipboard must then hold a PNG
    execSync(`printf x | pbcopy`);
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('copyPng')`);
    const clip = await vs.waitFor(() => { const i = execSync(`osascript -e 'clipboard info'`, { encoding: 'utf8' }); return /PNGf/.test(i) ? i.trim() : null; }, 8000);
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.getElementById('copySvg')`); await sleep(800);
    const svgClip = execSync('pbpaste', { encoding: 'utf8' });
    if (!(ps.w <= 1200 && ps.w >= 1150) || want2x <= 1200 || !/^<\?xml[\s\S]*<svg[\s\S]*GET \/reports/.test(svgText) || /<script|onerror|javascript:/i.test(svgText) || !clip || !/^<svg/.test(svgClip))
      throw new Error(JSON.stringify({ ps, want2x, svgHead: svgText.slice(0, 120), clip, svgClip: svgClip.slice(0, 60) }));
    return { png: ps, unlimited2xWidth: want2x, sizeNote, svgBytes: svgText.length, clipboard: clip.slice(0, 80), copySvgChars: svgClip.length };
  });

  await step('PNG at 4x without limits has 4x the drawn size', async () => {
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(300);
    await vs.wvClick(wv, `document.querySelector('input[name="scale"][value="4"]')`);
    await E(`(() => { const m = document.getElementById('maxW'); m.value = ''; m.dispatchEvent(new Event('input')); return 1; })()`);
    const p = await probe();
    const png = path.join(work, 'out-sequence-4x.png'); fs.rmSync(png, { force: true });
    await vs.wvClick(wv, `document.getElementById('savePng')`);
    if (!await saveDialog(png)) throw new Error('PNG not written');
    const ps = pngSize(png);
    if (Math.abs(ps.w - Math.round(p.size.w * 4)) > 2) throw new Error(JSON.stringify({ ps, size: p.size }));
    await vs.wvClick(wv, `document.getElementById('exportBtn')`); await sleep(200);
    await vs.wvClick(wv, `document.querySelector('input[name="scale"][value="2"]')`); await vs.key('Escape', 'Escape');
    return ps;
  });

  await step('README.md with 5 blocks: 5 diagrams, only the broken one shows its error', async () => {
    await closeAll(); const t0 = await preview('README.md'); const p = await rendered();
    const cards = JSON.parse(await E(`JSON.stringify([...document.querySelectorAll('.card')].map(c => ({ title: c.querySelector('.title').textContent, svg: !!c.querySelector('.card-body svg'), err: c.querySelector('.card-error').classList.contains('hidden') ? '' : c.querySelector('.card-error').innerText })))`));
    await shot('markdown-five-blocks');
    const errs = cards.filter(c => c.err);
    if (cards.length !== 5 || errs.length !== 1 || !/Diagram 4/.test(errs[0].title) || cards.filter(c => c.svg).length !== 4 || !/^Line 36: Syntax error: unexpected LINK$/m.test(errs[0].err)) throw new Error(JSON.stringify(cards));
    // the Problems panel has the same error
    const probs = await vs.wbEval(`[...document.querySelectorAll('.statusbar-item')].map(e => e.getAttribute('aria-label') || '').find(t => /Error/i.test(t)) || ''`);
    // Cursor on line 26 (inside block 3) highlights card 3
    await vs.command('Go to Line/Column...'); await vs.type('26'); await vs.key('Enter', 'Enter');
    const focused = await vs.waitFor(() => E(`(document.querySelector('.card.focus') || {}).dataset?.index || null`), 5000);
    if (focused !== '2') throw new Error('cursor sync: focused card ' + focused);
    // Zoom on card 2 opens it alone with zoom and pan; the block picker goes back to all
    await vs.wvClick(wv, `document.querySelectorAll('.card')[1].querySelector('.actions button')`); await sleep(500);
    const single = await probe();
    const svgOk = await E(`!!document.querySelector('#stage svg') && document.getElementById('stage').textContent.includes('POST /login')`);
    await select('#block', '-1');
    const back = await probe();
    if (!single.single || !svgOk || back.single) throw new Error(JSON.stringify({ single: single.single, svgOk, back: back.single }));
    return { cards: cards.map(c => c.title + (c.err ? ' ERROR: ' + c.err.slice(0, 80) : '')), problems: probs, cursorLine26Highlights: 'Diagram 3', ms: Date.now() - t0 };
  });

  await step('dark and light VS Code themes: Mermaid theme follows; Mermaid theme picker', async () => {
    await closeAll(); await preview('class.mmd'); await rendered();
    const dark = await probe();
    const sf = path.join(work, 'ud', 'User', 'settings.json');
    const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
    fs.writeFileSync(sf, JSON.stringify({ ...s, 'workbench.colorTheme': 'Default Light Modern' }, null, 1));
    const light = await vs.waitFor(async () => { const r = await probe(); return r.theme === 'default' && r.rendered >= 2 ? r : null; }, 10000);
    await sleep(500); await shot('class-light-theme');
    await select('#theme', 'forest'); const forest = await vs.waitFor(async () => { const r = await probe(); return r.theme === 'forest' && r.good.length ? r : null; }, 8000);
    await shot('class-forest-theme');
    await select('#theme', 'auto');
    fs.writeFileSync(sf, JSON.stringify(s, null, 1));
    const back = await vs.waitFor(async () => { const r = await probe(); return r.theme === 'dark' ? r : null; }, 10000);
    if (dark.theme !== 'dark' || !light || !forest || !back) throw new Error(JSON.stringify({ dark: dark.theme, light: !!light, forest: !!forest, back: !!back }));
    return { dark: dark.theme, light: light.theme, picker: forest.theme, bgLight: light.bg };
  });

  await step('each background option: editor color, white, transparent, custom', async () => {
    await closeAll(); await preview('pie.mmd'); await rendered();
    const out = {};
    for (const b of ['white', 'transparent', 'custom', 'theme']) {
      await select('#bg', b);
      await sleep(300);
      const pr = await probe();
      out[b] = { probe: pr.bg, theme: pr.theme, css: await E(`getComputedStyle(document.getElementById('viewport')).backgroundColor`) };
      if (b === 'custom') { await shot('pie-custom-background'); }
    }
    await select('#bg', 'white'); // kept for the restart check below
    if (out.white.css !== 'rgb(255, 255, 255)' || out.custom.css !== 'rgb(245, 245, 240)' || out.transparent.probe !== '' || !/^rgb/.test(out.theme.probe)
      || out.white.theme !== 'default' || out.custom.theme !== 'default' || out.theme.theme !== 'dark' || out.transparent.theme !== 'dark') throw new Error(JSON.stringify(out));
    return out;
  });

  await step('hostile-script.mmd: no script runs, no dialog, no remote request, %%{init}%% cannot loosen security', async () => {
    await closeAll(); const d0 = R.dialogs.length, n0 = R.network.length;
    await preview('hostile-script.mmd'); const p = await rendered();
    await sleep(1500);
    // click every node: strict mode has no click handlers
    const nodes = await E(`document.querySelectorAll('#stage g.node').length`);
    for (let i = 0; i < Math.min(nodes, 6); i++) { await vs.wvClick(wv, `document.querySelectorAll('#stage g.node')[${i}]`).catch(() => {}); await sleep(150); }
    await sleep(800);
    const dom = JSON.parse(await E(`JSON.stringify({ scripts: document.querySelectorAll('#stage script, #stage iframe, #stage object, #stage embed').length, on: [...document.querySelectorAll('#stage *')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length, links: [...document.querySelectorAll('#stage [href], #stage [*|href]')].map(e => e.getAttribute('href') || e.getAttribute('xlink:href')).filter(h => h && !h.startsWith('#')), imgs: [...document.querySelectorAll('#stage img, #stage image')].length, text: document.getElementById('stage').textContent.slice(0, 200) })`));
    await shot('hostile-script');
    const net = R.network.slice(n0), dl = R.dialogs.slice(d0);
    const csp = (await probe()).cspViolations;
    if (!p.good.length || dom.scripts || dom.on || dom.links.length || dom.imgs || dl.length || net.length || csp.length) throw new Error(JSON.stringify({ p, dom, dl, net, csp }));
    return { drawn: true, nodes, dom, dialogs: dl.length, remoteRequests: net.length, cspRefusals: csp.length };
  });

  await step('hostile-nested-2mb.mmd: clear size message, VS Code stays responsive', async () => {
    await closeAll(); await preview('hostile-nested-2mb.mmd'); await rendered();
    const msg = await text('#problem');
    const l = await lag();
    await shot('hostile-nested-2mb');
    if (!/2,2\d\d,\d{3} characters\. The limit is 500,000/.test(msg) || l > 1000) throw new Error(JSON.stringify({ msg, l }));
    return { message: msg, workbenchLagMs: l };
  });

  await step('huge-unopened.mmd (2.5 MB) from the Explorer right-click menu: the file is not read, a notice shows', async () => {
    await closeAll();
    // The Explorer list is virtual: scroll the row into view, wait, then read its place again and check that the
    // point really is that row before the right-click (more sample files since 0.2.0 moved it down).
    const rowAt = () => vs.wbEval(`(() => { const r = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find(e => (e.getAttribute('aria-label') || '').startsWith('huge-unopened.mmd')); if (!r) return 'null'; const b = r.getBoundingClientRect(); const x = b.x + 40, y = b.y + b.height / 2; const hit = document.elementFromPoint(x, y); return JSON.stringify({ x, y, ok: !!hit && r.contains(hit) }); })()`);
    await vs.wbEval(`(() => { const r = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find(e => (e.getAttribute('aria-label') || '').startsWith('huge-unopened.mmd')); if (r) r.scrollIntoView({ block: 'center' }); return 1; })()`);
    await sleep(600);
    const row = await vs.waitFor(async () => { const v = JSON.parse(await rowAt()); return v && v.ok ? v : null; }, 5000, 200);
    if (!row) throw new Error('no Explorer row');
    let item = null;
    for (let i = 0; i < 3 && !item; i++) {
      await vs.click(row.x, row.y, { button: 'right' }); await sleep(900);
      item = JSON.parse(await vs.wbEval(`(() => { const a = [...document.querySelectorAll('.monaco-menu .action-item .action-label')].find(e => /Open Preview to the Side/.test(e.textContent || e.getAttribute('aria-label') || '')); if (!a) return 'null'; const b = a.getBoundingClientRect(); return JSON.stringify({ x: b.x + 20, y: b.y + b.height / 2 }); })()`));
      if (!item) { await vs.key('Escape', 'Escape'); R.menuRetries = (R.menuRetries || 0) + 1; }
    }
    if (!item) { await shot('explorer-menu'); await vs.key('Escape', 'Escape'); throw new Error('no menu item'); }
    await shot('explorer-menu');
    await vs.click(item.x, item.y); await sleep(1500);
    let page = null;
    for (let i = 0; i < 20 && !page; i++) { for (const [sid, info] of vs.attached) { if (info.type !== 'iframe') continue; for (const c of vs.ctx.get(sid) || []) { try { const r = await vs.s.send('Runtime.evaluate', { expression: 'document.body && document.body.innerText', contextId: c.id, returnByValue: true }, sid); if (/was not read/.test(r.result.value || '')) page = r.result.value; } catch {} } } if (!page) await sleep(300); }
    const opened = await vs.wbEval(`[...document.querySelectorAll('.tabs-container .tab')].map(t => t.getAttribute('aria-label')).join('|')`);
    await shot('explorer-not-read');
    if (!page || opened.split('|').some(t => /^huge-unopened\.mmd/.test(t || ''))) throw new Error(JSON.stringify({ page, opened }));
    return { notice: page.replace(/\s+/g, ' ').slice(0, 220), tabs: opened };
  });

  await step('hostile-nested-small.mmd: 500 levels deep is stopped by the nesting guard', async () => {
    await closeAll(); await preview('hostile-nested-small.mmd'); await rendered();
    const msg = await text('#problem');
    if (!/nests 500 levels deep/.test(msg)) throw new Error(msg);
    return msg;
  });

  await step('invalid-utf8.mmd draws with replacement characters; binary-nul.mmd (VS Code says binary) still previews; empty.mmd says it is empty', async () => {
    await closeAll(); await preview('invalid-utf8.mmd'); const p = await rendered();
    const t = await E(`document.getElementById('stage').textContent`);
    await closeAll();
    vs.open(path.join(ws, 'binary-nul.mmd')); await sleep(1500);
    const binaryNote = await vs.wbEval(`(document.querySelector('.editor-instance') || document.body).innerText.slice(0, 160)`);
    for (let i = 0; i < 3; i++) { await vs.command('Mermaid Viewer: Open Preview to the Side'); if (await vs.waitFor(() => vs.wbEval(`[...document.querySelectorAll('.tabs-container .tab')].some(t => (t.getAttribute('aria-label') || '').startsWith('Preview binary'))`), 3000)) break; }
    wv = await findWv('binary-nul.mmd'); if (!wv) throw new Error('no preview for binary-nul.mmd');
    const b = await rendered(); const bt = await E(`document.getElementById('stage').textContent`);
    await shot('binary-file-preview');
    await closeAll(); await preview('empty.mmd'); await rendered();
    const m = await text('#problem');
    if (!p.good.length || !/caf/.test(t) || !b.good.length || !/caf/.test(bt) || !/empty/i.test(m)) throw new Error(JSON.stringify({ p, t, b, bt, m }));
    return { utf8Text: t.slice(0, 40), binaryEditor: binaryNote.replace(/\s+/g, ' ').slice(0, 120), binaryPreviewText: bt.slice(0, 40), empty: m };
  });

  await step('large-flowchart.mmd (3,000 nodes, 5,000 links): instant message about the link limit, nothing hangs', async () => {
    await closeAll(); await preview('large-flowchart.mmd'); const t0 = Date.now(); await rendered();
    const ms = Date.now() - t0; // from the preview page being there to the message
    const msg = await text('#problem');
    const l = await lag();
    await shot('large-flowchart-limit');
    if (!/about 5,0\d\d links\. The limit is 2,000/.test(msg) || ms > 3000) throw new Error(JSON.stringify({ msg, ms }));
    return { message: msg, msToMessage: ms, workbenchLagMs: l };
  });

  await step('time limit: with renderTimeoutSeconds 2, slow-flowchart.mmd (1,600 links, about 5 s) is stopped with a message', async () => {
    await closeAll();
    const sf = path.join(work, 'ud', 'User', 'settings.json');
    const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
    fs.writeFileSync(sf, JSON.stringify({ ...s, 'mermaidViewer.renderTimeoutSeconds': 2 }, null, 1)); await sleep(1500);
    await openFile('slow-flowchart.mmd');
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) { await vs.command('Mermaid Viewer: Open Preview to the Side'); if (await vs.waitFor(() => vs.wbEval(`[...document.querySelectorAll('.tabs-container .tab')].some(t => (t.getAttribute('aria-label') || '').startsWith('Preview slow'))`), 3000)) break; }
    const lags = [];
    const note = await vs.waitFor(async () => { lags.push(await lag()); const t = await vs.wbEval(`[...document.querySelectorAll('.notifications-toasts .notification-list-item')].map(n => n.textContent).join('|')`); return /slow-flowchart\.mmd took longer than 2 s/.test(t) ? t : null; }, 25000, 300);
    const noteMs = Date.now() - t0;
    // the stuck layout finishes in the background; then the page shows the notice
    let page = null;
    for (let i = 0; i < 30 && !page; i++) { await sleep(500); for (const [sid, info] of vs.attached) { if (info.type !== 'iframe') continue; for (const c of vs.ctx.get(sid) || []) { try { const r = await Promise.race([vs.s.send('Runtime.evaluate', { expression: 'document.body && document.body.innerText', contextId: c.id, returnByValue: true }, sid), sleep(800).then(() => null)]); if (r && /Drawing stopped/.test(r.result.value || '')) page = r.result.value; } catch {} } } }
    await shot('render-stopped');
    fs.writeFileSync(sf, JSON.stringify(s, null, 1)); await sleep(1000);
    if (!note || !page) throw new Error(JSON.stringify({ note: !!note, page: !!page, noteMs }));
    return { notification: note.replace(/^.*?Open Settings/, '').slice(0, 160), msToNotice: noteMs, page: page.replace(/\s+/g, ' ').slice(0, 160), maxWorkbenchLagMs: Math.max(...lags) };
  });

  await step('support footer and More free viewers list; no sign-in prompt anywhere', async () => {
    await closeAll(); await preview('mindmap.mmd'); await rendered();
    const footer = await text('#zovo-support');
    const readRows = () => vs.wbEval(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.innerText.split('\\n')[0]).slice(0, 8)`);
    let rows = [];
    for (let i = 0; i < 3; i++) {
      await vs.command('Mermaid Viewer: More free viewers');
      // The list starts with the extensions most related to this one (picked by monetize.py), then all the others.
      rows = await vs.waitFor(async () => { const r = await readRows(); return r.filter(x => /Viewer|Preview|Reader/.test(x)).length >= 3 ? r : null; }, 4000) || [];
      if (rows.length) break;
      await vs.key('Escape', 'Escape'); R.paletteRetries = (R.paletteRetries || 0) + 1;
    }
    await shot('more-free-viewers');
    await vs.key('Escape', 'Escape');
    const notes = await vs.wbEval(`[...document.querySelectorAll('.notification-list-item')].map(n => n.textContent.slice(0, 200))`);
    R.notifications = notes;
    const signIn = notes.filter(n => /sign in|log in|login|account/i.test(n) && /mermaid/i.test(n));
    if (!/Sponsor/.test(footer) || !/More free viewers/.test(footer) || !/Rate/.test(footer) || rows.length < 3 || signIn.length) throw new Error(JSON.stringify({ footer, rows, signIn }));
    return { footer, rows };
  });

  await step('README screenshots with the side bar closed', async () => {
    await closeAll();
    await vs.command('View: Close Primary Side Bar'); await sleep(600);
    await preview('sequence.mmd'); await rendered(); await sleep(800);
    const a = await shot('readme-sequence');
    await closeAll(); await preview('README.md'); await rendered(); await sleep(800);
    const b = await shot('readme-markdown');
    await closeAll(); await preview('flowchart.mmd'); await rendered(); await sleep(800);
    const c = await shot('readme-flowchart');
    await vs.command('View: Toggle Primary Side Bar Visibility'); await sleep(400);
    return [a, b, c].map(f => path.basename(f));
  });

  await step('no remote request from any webview during the whole run', async () => {
    const mine = R.network.filter(n => /vscode-webview|webview/.test(n.where));
    if (mine.length) throw new Error(JSON.stringify(mine.slice(0, 5)));
    return { webviewRemoteRequests: 0, workbenchRequests: R.network.length };
  });

  // Phase 2: quit and start again on the same profile, clock moved 1 day: background kept, rating ask shows.
  await vs.close();
  process.env.ZOVO_RATING_CLOCK_OFFSET_DAYS = '1';
  vs = await launch(work, port, ws, SETTINGS);
  watch();
  // Other apps on this Mac may hold the OS focus. The rating ask shows only in a focused window, so the
  // workbench page is told it has focus (CDP focus emulation) for this phase.
  await vs.s.send('Emulation.setFocusEmulationEnabled', { enabled: true }, vs.wb).catch(() => {});
  await sleep(2500);
  await step('after a restart the background choice (white) is kept for the workspace', async () => {
    await vs.s.send('Page.bringToFront', {}, vs.wb).catch(() => {});
    await preview('pie.mmd'); const p = await rendered();
    const css = await E(`getComputedStyle(document.getElementById('viewport')).backgroundColor`);
    await select('#bg', 'theme');
    if (p.background !== 'white' || css !== 'rgb(255, 255, 255)') throw new Error(JSON.stringify({ bg: p.background, css }));
    return { background: p.background, css };
  });
  await step('rating ask v2 shows on the second day after 3 good files', async () => {
    let msg = null;
    // The ask shows only while the window has focus (rule in rate.js).
    await vs.s.send('Page.bringToFront', {}, vs.wb).catch(() => {});
    for (const f of ['gantt.mmd', 'er.mmd', 'state.mmd']) {
      await vs.s.send('Page.bringToFront', {}, vs.wb).catch(() => {});
      await closeAll(); await preview(f); await rendered();
      msg = await vs.waitFor(async () => { const t = await vs.wbEval(`[...document.querySelectorAll('.notification-list-item')].map(n => n.textContent).join('|')`); return /Is Mermaid Viewer useful\?/.test(t) ? t : null; }, 4000);
      if (msg) break;
    }
    await shot('rating-ask');
    if (!msg) throw new Error('no rating ask');
    const buttons = await vs.wbEval(`[...document.querySelectorAll('.notification-list-item .monaco-button')].map(b => b.textContent)`);
    return { message: msg.slice(0, 120), buttons };
  });
} catch (e) {
  R.fatal = String(e.stack || e).slice(0, 1000);
  console.log('FATAL', R.fatal);
} finally {
  if (vs) { R.console = vs.console.filter(c => /mermaid|webview|preview|CSP|Content Security/i.test(c.text) || /webview/.test(c.where)).slice(0, 40); await vs.close(); }
  if (clipBefore !== null) { try { execSync('pbcopy', { input: clipBefore }); } catch {} }
  R.shots = shots; R.ended = new Date().toISOString();
  R.pass = R.steps.filter(s => s.ok).length; R.total = R.steps.length;
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(`${R.pass}/${R.total} steps passed; network ${R.network.length}; dialogs ${R.dialogs.length}`);
}
