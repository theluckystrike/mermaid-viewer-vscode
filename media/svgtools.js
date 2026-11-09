// Shared SVG export helpers for the preview and the batch export page. Plain script: in a webview it sets
// window.MermaidSvgTools; in Node (tests) it is a CommonJS module. No network, no DOM needed for the string parts.
(function (root) {
  'use strict';
  const GEOMETRY = /\s(d|points|transform|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|viewBox|dx|dy|refX|refY|markerWidth|markerHeight|stroke-width)="([^"]*)"/g;
  const LONG_NUMBER = /-?\d*\.\d{3,}(?:e[-+]?\d+)?/gi;
  const round = s => { const n = Number(s); if (!Number.isFinite(n)) return s; const r = Math.round(n * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };

  /** Minify CSS text: drop comments and the spaces around punctuation. Quoted strings are kept as they are. */
  function minifyCss(css) {
    const parts = String(css).split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    return parts.map((p, i) => (i % 2 ? p : p.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>]|&gt;)\s*/g, '$1').replace(/;}/g, '}'))).join('').trim();
  }

  /**
   * Make Mermaid's SVG text smaller without changing how it looks: numbers in geometry get 2 decimals
   * (1/100 of a pixel), CSS loses comments and spaces, XML comments go. Text content is not touched.
   */
  function compactSvgText(svg) {
    let s = String(svg);
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(GEOMETRY, (m, name, value) => ` ${name}="${value.replace(LONG_NUMBER, round)}"`);
    s = s.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (m, a, css, b) => a + minifyCss(css) + b);
    return s;
  }

  /** http(s) URLs in an SVG text, apart from XML namespace names (they are names, not requests). */
  function externalRefs(svg) {
    const out = [];
    const re = /(?:url\(\s*['"]?|(?:href|src)\s*=\s*["']|@import\s+['"]?)\s*(https?:\/\/[^'")\s]+)/gi;
    let m;
    while ((m = re.exec(String(svg)))) out.push(m[1]);
    return out;
  }

  /**
   * Drop CSS rules that match nothing in this SVG (DOM, webview only). Mermaid writes the CSS for every part of a
   * diagram type into each SVG; most of it is unused. @-rules (keyframes, media) are kept.
   */
  function pruneStyles(svgEl) {
    if (typeof CSSStyleSheet !== 'function') return;
    for (const st of svgEl.querySelectorAll('style')) {
      let sheet;
      try { sheet = new CSSStyleSheet(); sheet.replaceSync(st.textContent || ''); } catch { continue; }
      const keep = [];
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== 1) { keep.push(rule.cssText); continue; } // not a plain style rule
        const used = rule.selectorText.split(',').some(sel => {
          const bare = sel.replace(/::?[a-z-]+(\([^)]*\))?/gi, '').trim();
          if (!bare) return true;
          try { return svgEl.matches(bare) || !!svgEl.querySelector(bare); } catch { return true; }
        });
        if (used) keep.push(rule.cssText);
      }
      st.textContent = keep.join('');
    }
  }

  /**
   * PNG pixel size for a diagram drawn at w x h. Width only: exactly that width. Height only: exactly that height.
   * Both: the largest size that fits in that box and keeps the shape. Neither: w x h times the scale.
   * Capped at 16,384 px a side and 128 megapixels (the canvas limits). Returns { w, h, s, capped }.
   */
  function pngDims(w, h, o) {
    const W = o && o.width > 0 ? o.width : 0, H = o && o.height > 0 ? o.height : 0;
    let s = (o && o.scale) || 2;
    if (W && H) s = Math.min(W / w, H / h); else if (W) s = W / w; else if (H) s = H / h;
    const cap = Math.min(16384 / w, 16384 / h, Math.sqrt(128e6 / (w * h)));
    const capped = s > cap;
    if (capped) s = cap;
    let pw = Math.max(1, Math.round(w * s)), ph = Math.max(1, Math.round(h * s));
    if (!capped && W && !H) pw = W;
    if (!capped && H && !W) ph = H;
    return { w: pw, h: ph, s, capped };
  }


  // ---------- DOM parts (webview only) ----------
  const BAD = 'script,iframe,object,embed,link,meta,base,audio,video,frame,frameset,applet,form,input,button,textarea,select';
  /** Remove anything that could run, load or send: scripts, frames, handlers, remote links and images. */
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
  /**
   * Mermaid settings for every drawing. securityLevel strict, and the "secure" list stops %%{init}%% or front matter
   * from changing it. plain: SVG text labels instead of HTML in foreignObject (for wikis that drop foreignObject).
   */
  function mermaidConfig(o) {
    const cfg = {
      startOnLoad: false,
      securityLevel: 'strict',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'dompurifyConfig'],
      // Labels may not carry images, styles or embedded content: Mermaid would put them in the page while it draws.
      dompurifyConfig: { FORBID_TAGS: ['img', 'image', 'picture', 'source', 'style', 'link', 'iframe', 'frame', 'object', 'embed', 'video', 'audio', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base'], FORBID_ATTR: ['srcset', 'background', 'poster', 'formaction'] },
      suppressErrorRendering: true,
      maxTextSize: o.maxTextSize || 500000,
      maxEdges: o.maxEdges || 2000,
      theme: o.theme,
      darkMode: !!o.darkMode,
      fontFamily: '"trebuchet ms", verdana, arial, sans-serif',
    };
    if (o.plain) { cfg.htmlLabels = false; cfg.flowchart = { htmlLabels: false }; cfg.class = { htmlLabels: false }; cfg.state = { htmlLabels: false }; }
    return cfg;
  }
  /** A finished SVG string for a file: namespaces, a size, an optional background rect, unused CSS dropped, compacted. */
  function exportSvg(svgText, o) {
    const el = toSvgElement(svgText);
    const sz = svgSize(el);
    el.removeAttribute('style');
    el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    el.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const w = o && o.w ? o.w : Math.ceil(sz.w), h = o && o.h ? o.h : Math.ceil(sz.h);
    el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
    if (!el.getAttribute('viewBox')) el.setAttribute('viewBox', `0 0 ${sz.w} ${sz.h}`);
    if (o && o.bg) {
      const vb = el.viewBox.baseVal;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', String(vb.x)); r.setAttribute('y', String(vb.y)); r.setAttribute('width', String(vb.width)); r.setAttribute('height', String(vb.height));
      r.setAttribute('fill', o.bg); r.setAttribute('class', 'mv-background');
      el.insertBefore(r, el.firstChild);
    }
    if (!o || o.prune !== false) pruneStyles(el);
    const text = new XMLSerializer().serializeToString(el);
    return { text: o && o.compact === false ? text : compactSvgText(text), w, h, drawn: sz };
  }
  /** Draw an SVG string onto a canvas: a PNG blob, or a JPEG on a solid background. */
  async function drawImage(svgText, w, h, type, bg) {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.decoding = 'sync';
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the SVG could not be drawn')); img.src = url; });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = bg || '#ffffff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      return await new Promise((res, rej) => { try { c.toBlob(b => b ? res(b) : rej(new Error('the image is too large for the canvas')), type || 'image/png', 0.92); } catch (e) { rej(e); } });
    } finally { URL.revokeObjectURL(url); }
  }
  async function b64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const api = { compactSvgText, minifyCss, externalRefs, pruneStyles, pngDims, clean, toSvgElement, svgSize, mermaidConfig, exportSvg, drawImage, b64 };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MermaidSvgTools = api;
})(typeof window !== 'undefined' ? window : this);
