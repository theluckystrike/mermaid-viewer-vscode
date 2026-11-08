// Mermaid Viewer webview. Draws Mermaid text that the extension host sends, with zoom, pan, a list of every
// diagram in a Markdown file, and SVG / PNG export. Mermaid runs with securityLevel "strict", and its output is
// cleaned again here before it goes into the page. Nothing is fetched: the page has no network access (CSP).
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const viewport = $('viewport'), stage = $('stage'), list = $('list'), empty = $('empty'), problemBox = $('problem');
  const blockSel = $('block'), themeSel = $('theme'), bgSel = $('bg'), bgColor = $('bgColor'), info = $('info'), zoomLabel = $('zoomLabel');
  const exportBtn = $('exportBtn'), exportMenu = $('exportMenu'), maxW = $('maxW'), maxH = $('maxH'), pngSize = $('pngSize');
  const mermaid = window.mermaid || (window.__esbuild_esm_mermaid_nm && window.__esbuild_esm_mermaid_nm.mermaid);

  const st = Object.assign({ view: { x: 0, y: 0, k: 1, fitted: true } }, vscode.getState() || {});
  let view = st.view;
  let prefs = { theme: 'auto', background: 'theme', custom: '#f5f5f0', scale: 2, maxW: 0, maxH: 0, wheel: 'zoom', choice: -1 };
  let limits = { maxTextSize: 500000, maxEdges: 2000 };
  let doc = { items: [], markdown: false, fileName: '' };
  // Last good render per item index: { svg (clean string), w, h, type, ms }
  const good = new Map();
  const errors = new Map();
  let seq = 0, renderedSeq = 0, size = null, firstFit = true, lastKey = '', focusIndex = -1, fontsReady = false;

  // ---------- cleaning ----------
  const BAD = 'script,iframe,object,embed,link,meta,base,audio,video,frame,frameset,applet,form,input,button,textarea,select';
  function clean(root) {
    root.querySelectorAll(BAD).forEach(n => n.remove());
    root.querySelectorAll('img,image').forEach(n => {
      const src = n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('xlink:href') || '';
      if (!/^data:image\/(png|gif|jpeg|webp);/i.test(src)) n.remove();
    });
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      for (const a of Array.from(el.attributes || [])) {
        const n = a.name.toLowerCase(), v = a.value;
        if (n.startsWith('on')) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'xlink:href' || n === 'src' || n === 'action' || n === 'formaction') && !/^#/.test(v) && !(el.localName === 'image' && /^data:image\//i.test(v))) el.removeAttribute(a.name);
        else if (n === 'style' && /url\s*\(\s*['"]?\s*(?!#|data:)/i.test(v)) el.removeAttribute(a.name);
      }
    }
    root.querySelectorAll('style').forEach(s => { if (/@import|url\s*\(\s*['"]?\s*(?!#|data:)/i.test(s.textContent)) s.textContent = s.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\s*\(\s*['"]?\s*(?!#|data:)[^)]*\)/gi, 'none'); });
    return root;
  }
  /** Parse Mermaid's SVG string with the inert template parser, clean it, return the <svg> element. */
  function toSvgElement(svgText) {
    const t = document.createElement('template');
    t.innerHTML = svgText;
    const svg = t.content.querySelector('svg');
    if (!svg) throw new Error('Mermaid returned no SVG.');
    clean(svg);
    return document.importNode(svg, true);
  }
  function svgSize(svg) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
    const w = parseFloat(svg.getAttribute('width')) || 400, h = parseFloat(svg.getAttribute('height')) || 300;
    return { w, h };
  }

  // ---------- theme / background ----------
  function isDarkUi() { const c = document.body.classList; return c.contains('vscode-dark') || (c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light')); }
  /** Is the diagram drawn on a dark surface? White and light custom colors are light, whatever the UI theme. */
  function darkSurface() {
    if (prefs.background === 'white') return false;
    if (prefs.background === 'custom') {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(prefs.custom || '');
      if (m) { const [r, g, b] = m.slice(1).map(h => parseInt(h, 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5; }
    }
    return isDarkUi();
  }
  function mermaidTheme() { return prefs.theme === 'auto' ? (darkSurface() ? 'dark' : 'default') : prefs.theme; }
  function bgColorValue() {
    if (prefs.background === 'white') return '#ffffff';
    if (prefs.background === 'transparent') return '';
    if (prefs.background === 'custom') return prefs.custom;
    return getComputedStyle(document.body).backgroundColor || '';
  }
  function applyBg() {
    document.body.dataset.bg = prefs.background;
    document.documentElement.style.setProperty('--mv-custom', prefs.custom);
    bgColor.classList.toggle('hidden', prefs.background !== 'custom');
  }

  // ---------- rendering ----------
  let lastTheme = '';
  function configure() {
    const theme = mermaidTheme();
    lastTheme = theme;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'dompurifyConfig'],
      // Labels may not carry images, styles or embedded content: Mermaid would put them in the page while it draws.
      dompurifyConfig: { FORBID_TAGS: ['img', 'image', 'picture', 'source', 'style', 'link', 'iframe', 'frame', 'object', 'embed', 'video', 'audio', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base'], FORBID_ATTR: ['srcset', 'background', 'poster', 'formaction'] },
      suppressErrorRendering: true,
      maxTextSize: limits.maxTextSize,
      maxEdges: limits.maxEdges,
      theme,
      darkMode: theme === 'dark' || (theme === 'base' && darkSurface()),
      fontFamily: '"trebuchet ms", verdana, arial, sans-serif',
    });
  }

  async function renderOne(item, s) {
    const id = `mv-${s}-${item.index}`;
    const t0 = performance.now();
    try {
      if (item.refuse) throw Object.assign(new Error(item.refuse), { refuse: true });
      if (!item.text.trim()) throw Object.assign(new Error('This diagram is empty.'), { empty: true });
      const parsed = await mermaid.parse(item.text);
      const out = await mermaid.render(id, item.text);
      const el = toSvgElement(out.svg);
      const sz = svgSize(el);
      const ms = Math.round(performance.now() - t0);
      good.set(item.index, { svg: el.outerHTML, w: sz.w, h: sz.h, type: (parsed && parsed.diagramType) || out.diagramType || '', ms });
      errors.delete(item.index);
      return { index: item.index, ok: true, ms, type: (parsed && parsed.diagramType) || out.diagramType || '' };
    } catch (err) {
      const message = String((err && (err.message || err.str)) || err || 'Unknown error');
      errors.set(item.index, { message, refuse: !!(err && err.refuse), empty: !!(err && err.empty) });
      return { index: item.index, ok: false, ms: Math.round(performance.now() - t0), error: message.slice(0, 4000), refuse: !!(err && err.refuse), empty: !!(err && err.empty) };
    } finally {
      // Mermaid leaves its scratch element behind after some errors.
      for (const n of document.querySelectorAll(`#d${id}, #${id}, #i${id}`)) if (!stage.contains(n) && !list.contains(n)) n.remove();
    }
  }

  async function renderAll() {
    const s = ++seq;
    if (!mermaid) { showProblem([{ message: 'The Mermaid library did not load.' }]); return; }
    if (!fontsReady) { try { await document.fonts.ready; } catch {} fontsReady = true; }
    configure();
    info.textContent = ' · drawing…';
    const results = [];
    const order = doc.items.map(it => it.index);
    if (prefs.choice >= 0 && order.includes(prefs.choice)) { order.splice(order.indexOf(prefs.choice), 1); order.unshift(prefs.choice); }
    for (const idx of order) {
      const it = doc.items.find(x => x.index === idx);
      results.push(await renderOne(it, s));
      if (s !== seq) return; // a newer text came in
      vscode.postMessage({ type: 'progress', seq: doc.seq });
      if (doc.items.length > 1) { show(); await new Promise(r => setTimeout(r, 0)); }
    }
    renderedSeq = s;
    show();
    vscode.postMessage({ type: 'rendered', seq: doc.seq, results });
    document.body.dataset.rendered = String(Number(document.body.dataset.rendered || 0) + 1);
  }

  // ---------- showing ----------
  function single() { return !doc.markdown || prefs.choice >= 0 || doc.items.length === 1; }
  function currentIndex() { return doc.markdown ? (prefs.choice >= 0 ? prefs.choice : (doc.items[0] ? doc.items[0].index : 0)) : 0; }

  function show() {
    showBlocks();
    const isSingle = single();
    viewport.classList.toggle('hidden', !isSingle);
    list.classList.toggle('hidden', isSingle);
    document.body.classList.toggle('single', isSingle);
    if (!doc.items.length) {
      stage.replaceChildren(); list.replaceChildren(); size = null;
      empty.textContent = doc.markdown ? 'This Markdown file has no ```mermaid block yet.' : 'This file is empty. Write a diagram, for example:\n\nflowchart LR\n  A --> B';
      empty.classList.remove('hidden'); showProblem([]); info.textContent = ''; return;
    }
    if (isSingle) showSingle(); else showList();
  }

  function itemLabel(it) { return `Diagram ${it.index + 1} (line ${it.line + 1})`; }

  function showSingle() {
    const idx = currentIndex();
    const it = doc.items.find(x => x.index === idx) || doc.items[0];
    const g = good.get(it.index), e = errors.get(it.index);
    if (g) {
      if (stage.dataset.svgFor !== it.index + '|' + g.svg.length + '|' + g.ms) {
        const el = toSvgElement(g.svg);
        el.removeAttribute('style'); el.setAttribute('width', String(g.w)); el.setAttribute('height', String(g.h));
        stage.replaceChildren(el);
        stage.dataset.svgFor = it.index + '|' + g.svg.length + '|' + g.ms;
      }
      size = { w: g.w, h: g.h };
      empty.classList.add('hidden');
      const key = doc.fileName + '|' + it.index;
      if (firstFit || key !== lastKey) {
        firstFit = false;
        if (st.key === key && st.view && !lastKey) { view = st.view; apply(); } else fit();
      } else if (view.fitted) fit();
      lastKey = key; vscode.setState(Object.assign(vscode.getState() || {}, { key }));
    } else {
      stage.replaceChildren(); size = null; delete stage.dataset.svgFor;
      empty.textContent = e ? (e.refuse || e.empty ? e.message : 'Fix the error above to see the diagram.') : 'Drawing…';
      empty.classList.remove('hidden');
    }
    document.body.classList.toggle('stale', !!(g && e));
    showProblem(e ? [{ message: e.message, line: it.line, index: it.index, refuse: e.refuse, empty: e.empty }] : []);
    info.textContent = g ? ` · ${g.type || 'diagram'} · ${g.ms} ms` : '';
  }

  function card(it) {
    const c = document.createElement('section');
    c.className = 'card'; c.dataset.index = String(it.index);
    const head = document.createElement('div'); head.className = 'card-head';
    const title = document.createElement('button'); title.className = 'link title'; title.textContent = itemLabel(it); title.title = 'Go to this block in the editor';
    title.addEventListener('click', () => vscode.postMessage({ type: 'revealLine', line: it.line }));
    head.appendChild(title);
    const type = document.createElement('span'); type.className = 'type'; head.appendChild(type);
    const actions = document.createElement('span'); actions.className = 'actions';
    const mk = (label, tip, fn) => { const b = document.createElement('button'); b.textContent = label; b.title = tip; b.addEventListener('click', fn); actions.appendChild(b); return b; };
    mk('Zoom', 'Open this diagram with zoom and pan', () => { setChoice(it.index); });
    mk('SVG', 'Save this diagram as SVG', () => exportSvg(it.index));
    mk('PNG', 'Save this diagram as PNG with the export settings', () => exportPng(it.index, false));
    mk('Copy PNG', 'Copy this diagram to the clipboard as PNG', () => exportPng(it.index, true));
    head.appendChild(actions);
    const body = document.createElement('div'); body.className = 'card-body';
    const err = document.createElement('div'); err.className = 'card-error hidden'; err.setAttribute('role', 'alert');
    c.append(head, err, body);
    return c;
  }

  function showList() {
    const want = doc.items.map(it => it.index).join(',');
    if (list.dataset.items !== want) { list.replaceChildren(...doc.items.map(card)); list.dataset.items = want; }
    for (const it of doc.items) {
      const c = list.querySelector(`.card[data-index="${it.index}"]`);
      const g = good.get(it.index), e = errors.get(it.index);
      c.querySelector('.title').textContent = itemLabel(it);
      c.querySelector('.type').textContent = g ? `${g.type || 'diagram'} · ${g.ms} ms` : '';
      const body = c.querySelector('.card-body');
      const key = g ? g.svg.length + '|' + g.ms : '';
      if (g && body.dataset.key !== key) {
        const el = toSvgElement(g.svg);
        el.removeAttribute('style'); el.setAttribute('width', String(g.w)); el.setAttribute('height', String(g.h));
        el.style.maxWidth = '100%'; el.style.height = 'auto';
        body.replaceChildren(el); body.dataset.key = key;
      } else if (!g) { body.replaceChildren(); body.dataset.key = ''; }
      c.classList.toggle('stale', !!(g && e));
      c.classList.toggle('focus', it.index === focusIndex);
      c.querySelectorAll('.actions button').forEach(b => { b.disabled = !g; });
      const errBox = c.querySelector('.card-error');
      errBox.replaceChildren();
      if (e) { errBox.appendChild(problemRow({ message: e.message, line: it.line, refuse: e.refuse, empty: e.empty })); errBox.classList.remove('hidden'); }
      else errBox.classList.add('hidden');
    }
    empty.classList.add('hidden');
    showProblem([]);
    const n = doc.items.length, bad = doc.items.filter(it => errors.has(it.index)).length;
    info.textContent = ` · ${n} diagrams` + (bad ? ` · ${bad} with errors` : '');
  }

  function showBlocks() {
    if (!doc.markdown || doc.items.length < 2) { blockSel.classList.add('hidden'); return; }
    blockSel.classList.remove('hidden');
    const key = doc.items.map(it => it.index + ':' + it.line).join('|');
    if (blockSel.dataset.key !== key) {
      const all = document.createElement('option'); all.value = '-1'; all.textContent = `All ${doc.items.length} diagrams`;
      blockSel.replaceChildren(all, ...doc.items.map(it => { const o = document.createElement('option'); o.value = String(it.index); o.textContent = itemLabel(it); return o; }));
      blockSel.dataset.key = key;
    }
    blockSel.value = String(prefs.choice >= 0 && doc.items.some(it => it.index === prefs.choice) ? prefs.choice : -1);
  }

  function setChoice(i) {
    prefs.choice = i; firstFit = true; savePrefs(); show();
  }

  // ---------- problems ----------
  /** Location of an error in the editor: the block's first line plus the line Mermaid names. */
  function errLine(message, itemLine) {
    const m = /Parse error on line (\d+)/i.exec(message) || /Lexical error on line (\d+)/i.exec(message) || /\bline[: ]+(\d+)(?:,?\s*column|:)/i.exec(message) || /\bline (\d+)\b/i.exec(message);
    return m ? itemLine + Math.max(0, parseInt(m[1], 10) - 1) : -1;
  }
  function problemRow(p) {
    const line = p.refuse || p.empty ? -1 : errLine(p.message, p.line || 0);
    // With a line number the source excerpt only adds noise.
    const short = line >= 0 ? shortMsg(p.message).replace(/ near ".*"$/, '') : shortMsg(p.message);
    const row = document.createElement(line >= 0 ? 'button' : 'div');
    row.className = 'problem' + (p.refuse ? ' limit' : ' error');
    row.textContent = (line >= 0 ? `Line ${line + 1}: ` : '') + short;
    if (line >= 0) { row.title = 'Go to line ' + (line + 1); row.addEventListener('click', () => vscode.postMessage({ type: 'revealLine', line })); }
    return row;
  }
  function shortMsg(message) {
    const lines = String(message).replace(/\r/g, '').split('\n').map(x => x.trimEnd()).filter(Boolean);
    let out = lines[0] || 'Unknown error';
    out = out.replace(/^(Parse|Lexical) error on line \d+:?\s*/i, (m, k) => k === 'Lexical' ? 'Unknown character' : 'Syntax error');
    const exp = lines.find(l => /^Expecting /.test(l));
    if (exp) {
      const got = /got '([^']*)'/.exec(exp);
      out = out.replace(/:$/, '') + (got ? `: unexpected ${got[1]}` : '');
      const excerpt = lines.slice(1).find(l => !/^-*\^$/.test(l.trim()) && !/^Expecting /.test(l));
      if (excerpt) out += ` near "${excerpt.replace(/^\.\.\./, '').trim().slice(0, 60)}"`;
    }
    if (/No diagram type detected/i.test(out)) out = 'No diagram type found. The first line must name one, for example flowchart TD, sequenceDiagram or classDiagram.';
    return out.length > 300 ? out.slice(0, 297) + '...' : out;
  }
  function showProblem(items) {
    problemBox.replaceChildren();
    if (!items.length) { problemBox.classList.add('hidden'); return; }
    for (const p of items) problemBox.appendChild(problemRow(p));
    if (items.some(p => !p.refuse && !p.empty) && document.body.classList.contains('stale')) {
      const d = document.createElement('div'); d.className = 'note'; d.textContent = 'The last good diagram is shown, faded, until the error is fixed.'; problemBox.appendChild(d);
    }
    problemBox.classList.remove('hidden');
  }

  // ---------- zoom / pan ----------
  function apply() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    zoomLabel.textContent = Math.round(view.k * 100) + '%';
    vscode.setState(Object.assign(vscode.getState() || {}, { view }));
  }
  function fit() {
    if (!size) return;
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min((r.width - 32) / size.w, (r.height - 32) / size.h, 2);
    view.k = Math.max(0.01, k);
    view.x = (r.width - size.w * view.k) / 2;
    view.y = Math.max(16, (r.height - size.h * view.k) / 2);
    view.fitted = true; apply();
  }
  function actual() {
    if (!size) return;
    const r = viewport.getBoundingClientRect();
    view.k = 1; view.fitted = false; view.x = Math.max(16, (r.width - size.w) / 2); view.y = Math.max(16, (r.height - size.h) / 2); apply();
  }
  function zoomAt(f, cx, cy) {
    const r = viewport.getBoundingClientRect();
    if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
    const k = Math.min(32, Math.max(0.01, view.k * f));
    const g = k / view.k;
    view.x = cx - (cx - view.x) * g; view.y = cy - (cy - view.y) * g; view.k = k; view.fitted = false; apply();
  }
  let drag = null;
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    viewport.setPointerCapture(e.pointerId); viewport.focus({ preventScroll: true });
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; viewport.classList.add('panning'); }
    if (drag.moved) { view.fitted = false; view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
  });
  const endDrag = () => { drag = null; viewport.classList.remove('panning'); };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const zoom = e.ctrlKey || e.metaKey || prefs.wheel !== 'pan';
    if (zoom) {
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-d * (e.ctrlKey && !e.metaKey && Math.abs(d) < 30 ? 0.02 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
    } else { view.x -= e.deltaX; view.y -= e.deltaY; view.fitted = false; apply(); }
  }, { passive: false });
  viewport.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    else if (e.key === '-') zoomAt(0.8);
    else if (e.key === '0') fit();
    else if (e.key === '1') actual();
    else if (e.key === 'ArrowLeft') { view.x += 40; apply(); } else if (e.key === 'ArrowRight') { view.x -= 40; apply(); }
    else if (e.key === 'ArrowUp') { view.y += 40; apply(); } else if (e.key === 'ArrowDown') { view.y -= 40; apply(); }
    else return;
    e.preventDefault();
  });
  $('zoomIn').addEventListener('click', () => zoomAt(1.25));
  $('zoomOut').addEventListener('click', () => zoomAt(0.8));
  $('fit').addEventListener('click', fit);
  $('actual').addEventListener('click', actual);
  window.addEventListener('resize', () => { if (view.fitted && single()) fit(); });

  // ---------- toolbar ----------
  function savePrefs() { vscode.postMessage({ type: 'prefs', prefs: { theme: prefs.theme, background: prefs.background, custom: prefs.custom, scale: prefs.scale, maxW: prefs.maxW, maxH: prefs.maxH, choice: prefs.choice } }); }
  themeSel.addEventListener('change', () => { prefs.theme = themeSel.value; savePrefs(); good.clear(); renderAll(); });
  // With the "auto" Mermaid theme, a change between a light and a dark surface draws the diagrams again.
  function bgChanged() { const before = lastTheme; applyBg(); savePrefs(); if (mermaidTheme() !== before && doc.items.length) { good.clear(); renderAll(); } }
  bgSel.addEventListener('change', () => { prefs.background = bgSel.value; bgChanged(); });
  bgColor.addEventListener('input', () => { prefs.custom = bgColor.value; applyBg(); });
  bgColor.addEventListener('change', () => { prefs.custom = bgColor.value; bgChanged(); });
  blockSel.addEventListener('change', () => setChoice(Number(blockSel.value)));

  function toggleMenu(open) {
    const want = open === undefined ? exportMenu.classList.contains('hidden') : open;
    exportMenu.classList.toggle('hidden', !want);
    exportBtn.setAttribute('aria-expanded', String(want));
    if (want) {
      const b = exportBtn.getBoundingClientRect();
      exportMenu.style.left = Math.max(4, Math.min(b.left, window.innerWidth - exportMenu.offsetWidth - 4)) + 'px';
      exportMenu.style.top = (b.bottom + 4) + 'px';
      updatePngSize();
      exportMenu.querySelector('#savePng').focus();
    }
  }
  exportBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', e => { if (!exportMenu.contains(e.target) && e.target !== exportBtn) toggleMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleMenu(false); });
  exportMenu.querySelectorAll('input[name="scale"]').forEach(r => r.addEventListener('change', () => { prefs.scale = Number(r.value); updatePngSize(); savePrefs(); }));
  const num = el => { const v = Math.floor(Number(el.value)); return v >= 16 && v <= 32000 ? v : 0; };
  for (const el of [maxW, maxH]) el.addEventListener('input', () => { prefs.maxW = num(maxW); prefs.maxH = num(maxH); updatePngSize(); savePrefs(); });
  $('savePng').addEventListener('click', () => { toggleMenu(false); exportPng(exportIndex(), false); });
  $('copyPng').addEventListener('click', () => { toggleMenu(false); exportPng(exportIndex(), true); });
  $('saveSvg').addEventListener('click', () => { toggleMenu(false); exportSvg(exportIndex()); });
  $('copySvg').addEventListener('click', () => { toggleMenu(false); const s = svgForExport(exportIndex(), 1); if (s) vscode.postMessage({ type: 'copySvg', svg: s.text }); });
  function exportIndex() { return single() ? currentIndex() : (focusIndex >= 0 ? focusIndex : (doc.items[0] ? doc.items[0].index : 0)); }

  // ---------- export ----------
  /** PNG pixel size for a diagram of w x h: scale, then shrink to fit max width / height, then a 16k / 128 MP cap. */
  function pngDims(w, h) {
    let s = prefs.scale || 2;
    if (prefs.maxW && w * s > prefs.maxW) s = prefs.maxW / w;
    if (prefs.maxH && h * s > prefs.maxH) s = prefs.maxH / h;
    s = Math.min(s, 16384 / w, 16384 / h, Math.sqrt(128e6 / (w * h)));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), s };
  }
  function updatePngSize() {
    const g = good.get(exportIndex());
    if (!g) { pngSize.textContent = 'Nothing drawn yet.'; return; }
    const d = pngDims(g.w, g.h);
    pngSize.textContent = `PNG size: ${d.w} × ${d.h} px` + (Math.abs(d.s - (prefs.scale || 2)) > 1e-6 ? ` (scaled to ${d.s.toFixed(2)}x)` : '');
  }
  function svgForExport(index, scale, dims) {
    const g = good.get(index);
    if (!g) { vscode.postMessage({ type: 'warn', message: 'There is no drawn diagram to export yet.' }); return null; }
    const el = toSvgElement(g.svg);
    el.removeAttribute('style');
    el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    el.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const w = dims ? dims.w : Math.ceil(g.w * scale), h = dims ? dims.h : Math.ceil(g.h * scale);
    el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
    if (!el.getAttribute('viewBox')) el.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
    const bg = bgColorValue();
    if (bg) {
      const vb = el.viewBox.baseVal;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', String(vb.x)); r.setAttribute('y', String(vb.y)); r.setAttribute('width', String(vb.width)); r.setAttribute('height', String(vb.height));
      r.setAttribute('fill', bg); r.setAttribute('class', 'mv-background');
      el.insertBefore(r, el.firstChild);
    }
    return { text: new XMLSerializer().serializeToString(el), w, h };
  }
  function exportSvg(index) {
    const s = svgForExport(index, 1);
    if (s) vscode.postMessage({ type: 'saveSvg', svg: s.text, index });
  }
  async function exportPng(index, copy) {
    try {
      const g = good.get(index);
      if (!g) { vscode.postMessage({ type: 'warn', message: 'There is no drawn diagram to export yet.' }); return; }
      const d = pngDims(g.w, g.h);
      const s = svgForExport(index, 1, d);
      const blob = await drawPng(s.text, d.w, d.h);
      if (copy) {
        let done = false;
        try {
          if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); done = true; }
        } catch {}
        if (done) { vscode.postMessage({ type: 'copied', what: 'PNG', w: d.w, h: d.h }); return; }
      }
      vscode.postMessage({ type: copy ? 'copyPng' : 'savePng', data: await b64(blob), index, w: d.w, h: d.h });
    } catch (err) {
      vscode.postMessage({ type: 'error', message: 'PNG export failed: ' + String(err && err.message || err).slice(0, 300) });
    }
  }
  async function drawPng(svgText, w, h) {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.decoding = 'sync';
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the SVG could not be drawn')); img.src = url; });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const out = await new Promise((res, rej) => { try { c.toBlob(b => b ? res(b) : rej(new Error('the image is too large for the canvas')), 'image/png'); } catch (e) { rej(e); } });
      return out;
    } finally { URL.revokeObjectURL(url); }
  }
  async function b64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // ---------- messages from the extension host ----------
  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'init') {
      prefs = Object.assign(prefs, m.prefs || {});
      limits = Object.assign(limits, m.limits || {});
      themeSel.value = prefs.theme; bgSel.value = prefs.background; bgColor.value = prefs.custom;
      maxW.value = prefs.maxW ? String(prefs.maxW) : ''; maxH.value = prefs.maxH ? String(prefs.maxH) : '';
      const r = exportMenu.querySelector(`input[name="scale"][value="${prefs.scale}"]`); if (r) r.checked = true;
      applyBg();
      if (typeof m.uri === 'string') vscode.setState(Object.assign(vscode.getState() || {}, { uri: m.uri }));
    } else if (m.type === 'render') {
      const keep = new Set((m.items || []).map(it => it.index));
      for (const k of [...good.keys()]) if (!keep.has(k)) good.delete(k);
      if (m.fileName !== doc.fileName) { good.clear(); errors.clear(); firstFit = true; }
      doc = { items: m.items || [], markdown: !!m.markdown, fileName: m.fileName || '', seq: m.seq };
      vscode.postMessage({ type: 'progress', seq: m.seq });
      if (m.limits) limits = Object.assign(limits, m.limits);
      if (doc.markdown && prefs.choice >= doc.items.length) prefs.choice = -1;
      renderAll().catch(err => { showProblem([{ message: String(err && err.message || err) }]); vscode.postMessage({ type: 'rendered', seq: doc.seq, results: [{ index: 0, ok: false, error: String(err && err.message || err) }] }); });
    } else if (m.type === 'focusBlock') {
      focusIndex = m.index;
      if (!single()) {
        list.querySelectorAll('.card').forEach(c => c.classList.toggle('focus', Number(c.dataset.index) === focusIndex));
        const c = list.querySelector(`.card[data-index="${focusIndex}"]`);
        if (c) c.scrollIntoView({ block: 'nearest' });
      }
    } else if (m.type === 'wheel') {
      prefs.wheel = m.wheel;
    }
  });

  // Theme change in VS Code: the body class changes; draw again for the "auto" Mermaid theme.
  let lastDark = null;
  new MutationObserver(() => {
    const d = isDarkUi();
    if (lastDark !== null && d !== lastDark && prefs.theme === 'auto' && mermaidTheme() !== lastTheme && doc.items.length) { good.clear(); renderAll(); }
    lastDark = d;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  lastDark = isDarkUi();

  // Anything the page tried to load and the CSP refused. Shown in the release check; nothing is sent anywhere.
  const cspViolations = [];
  document.addEventListener('securitypolicyviolation', e => { if (cspViolations.length < 50) cspViolations.push(String(e.blockedURI || e.violatedDirective).slice(0, 120)); });

  // Read-only state for the release check (scripts/e2e-vscode.mjs). No side effects.
  window.mermaidViewerProbe = () => ({
    single: single(), items: doc.items.length, good: [...good.keys()], errors: [...errors.entries()].map(([k, v]) => [k, v.message.slice(0, 200)]),
    view: Object.assign({}, view), size, theme: mermaidTheme(), background: prefs.background, bg: bgColorValue(), prefs: Object.assign({}, prefs),
    rendered: Number(document.body.dataset.rendered || 0), stale: document.body.classList.contains('stale'), cspViolations: cspViolations.slice(),
  });

  vscode.postMessage({ type: 'ready' });
})();
