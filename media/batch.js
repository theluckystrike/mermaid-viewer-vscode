// Mermaid Viewer export page: draws one diagram per message from the extension host and sends back SVG text or
// PNG / JPEG bytes. Same Mermaid settings and cleaning as the preview (media/svgtools.js). No network (CSP).
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const mermaid = window.mermaid || (window.__esbuild_esm_mermaid_nm && window.__esbuild_esm_mermaid_nm.mermaid);
  const ST = window.MermaidSvgTools;
  const log = document.getElementById('log'), count = document.getElementById('count');
  let n = 0, bad = 0, queue = Promise.resolve();
  const BG = { white: '#ffffff', transparent: '' };

  function line(t) { const d = document.createElement('div'); d.textContent = t; log.prepend(d); while (log.childNodes.length > 200) log.lastChild.remove(); }

  async function job(m) {
    const id = `mvb-${m.id}`;
    const t0 = performance.now();
    try {
      if (!mermaid) throw new Error('The Mermaid library did not load.');
      const theme = ['default', 'dark', 'forest', 'neutral', 'base'].includes(m.theme) ? m.theme : 'default';
      mermaid.initialize(ST.mermaidConfig({ theme, darkMode: theme === 'dark', maxTextSize: 20000000, maxEdges: 200000, plain: !!m.plain }));
      let out = await mermaid.render(id, m.text);
      // The browser refuses to export a canvas that drew HTML inside SVG: images use plain text labels.
      if (m.format !== 'svg' && !m.plain && out.svg.includes('<foreignObject')) {
        for (const el of document.querySelectorAll(`#d${id}, #${id}, #i${id}`)) el.remove();
        mermaid.initialize(ST.mermaidConfig({ theme, darkMode: theme === 'dark', maxTextSize: 20000000, maxEdges: 200000, plain: true }));
        out = await mermaid.render(id, m.text);
      }
      const el = ST.toSvgElement(out.svg);
      const sz = ST.svgSize(el);
      const bg = m.background === 'custom' ? (/^#[0-9a-f]{6}$/i.test(m.custom || '') ? m.custom : '#ffffff') : (m.background in BG ? BG[m.background] : '#ffffff');
      if (m.format === 'svg') {
        const s = ST.exportSvg(out.svg, { bg });
        return { ok: true, svg: s.text, w: s.w, h: s.h };
      }
      const d = m.format === 'jpeg'
        ? ST.pngDims(sz.w, sz.h, { scale: 2, width: Math.min(3000, Math.round(sz.w * 2)) })
        : ST.pngDims(sz.w, sz.h, { scale: m.scale || 2, width: m.width, height: m.height });
      const s = ST.exportSvg(out.svg, { w: d.w, h: d.h, bg: m.format === 'jpeg' ? (bg || '#ffffff') : bg });
      const blob = await ST.drawImage(s.text, d.w, d.h, m.format === 'jpeg' ? 'image/jpeg' : 'image/png', bg || '#ffffff');
      return { ok: true, data: await ST.b64(blob), w: d.w, h: d.h, ms: Math.round(performance.now() - t0) };
    } catch (err) {
      return { ok: false, error: String((err && (err.message || err.str)) || err || 'Unknown error').slice(0, 2000) };
    } finally {
      for (const el of document.querySelectorAll(`#d${id}, #${id}, #i${id}`)) el.remove();
    }
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.type !== 'job' || typeof m.text !== 'string') return;
    queue = queue.then(async () => {
      const r = await job(m);
      n++; if (!r.ok) bad++;
      count.textContent = `${n} drawn` + (bad ? `, ${bad} with errors` : '');
      line((r.ok ? 'ok    ' : 'error ') + (m.format || '') + (r.ok ? ` ${r.w} x ${r.h}` : ' ' + r.error.split('\n')[0].slice(0, 120)));
      vscode.postMessage(Object.assign({ type: 'done', id: m.id }, r));
    });
  });
  vscode.postMessage({ type: 'ready' });
})();
