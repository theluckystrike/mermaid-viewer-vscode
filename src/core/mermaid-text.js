'use strict';
// Pure text helpers for Mermaid Viewer. No VS Code and no DOM, so the tests can call them directly.

const EXT_RE = /\.(mmd|mermaid)$/i;
const MD_EXT_RE = /\.(md|markdown|mdx)$/i;
// Hard guards that no setting can raise. Real diagrams stay far below them; hostile files do not.
const MAX_NESTING = 64; // subgraph / block / state nesting depth
const MAX_LINE_CHARS = 200000; // one line longer than this is not a diagram

/** Is this path a Mermaid file by extension? */
function isMermaidPath(p) { return EXT_RE.test(String(p || '')); }
function isMarkdownPath(p) { return MD_EXT_RE.test(String(p || '')); }

/**
 * Every ```mermaid or ~~~mermaid fenced block in a Markdown text.
 * Returns [{ index, fenceLine, startLine, endLine, source, closed }]: fenceLine is the 0-based line of the
 * opening fence, startLine the first line of the diagram, endLine the closing fence (or the last line).
 */
function findMermaidBlocks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const m = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)(.*)$/.exec(line);
      if (!m) continue;
      const fence = m[2], info = m[3].toLowerCase();
      // A backtick fence's info string may not hold a backtick (CommonMark); [^`\s]* already enforces that.
      open = { fence, indent: m[1].length, mermaid: info === 'mermaid' || info === 'mmd' || info.startsWith('mermaid{') || info === '{mermaid}' || info === '{.mermaid}', fenceLine: i, body: [] };
      continue;
    }
    const close = new RegExp('^ {0,3}' + (open.fence[0] === '`' ? '`' : '~') + '{' + open.fence.length + ',}\\s*$');
    if (close.test(line)) {
      if (open.mermaid) out.push(block(out.length, open, i, true));
      open = null;
      continue;
    }
    // Content lines lose up to `indent` leading spaces, as CommonMark says.
    open.body.push(open.indent ? line.replace(new RegExp('^ {0,' + open.indent + '}'), '') : line);
  }
  if (open && open.mermaid) out.push(block(out.length, open, lines.length - 1, false));
  return out;
}

function block(index, open, endLine, closed) {
  return { index, fenceLine: open.fenceLine, startLine: open.fenceLine + 1, endLine, source: open.body.join('\n'), closed };
}

/** Index of the block that holds a 0-based line, or -1. */
function blockAtLine(blocks, line) {
  for (const b of blocks) if (line >= b.fenceLine && line <= b.endLine) return b.index;
  return -1;
}

/** Quick check used for the editor title button: does this Markdown text have a mermaid fence? */
function hasMermaidFence(text) {
  return /^ {0,3}(`{3,}|~{3,})\s*(mermaid|mmd)\b/im.test(String(text || ''));
}

/** The first keyword after front matter, comments and directives: flowchart, sequenceDiagram, ... or ''. */
function diagramType(text) {
  const lines = String(text || '').split(/\r?\n/);
  let i = 0;
  if (/^---\s*$/.test(lines[0] || '')) {
    for (i = 1; i < lines.length && !/^---\s*$/.test(lines[i]); i++);
    i++;
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('%%')) continue;
    const m = /^([A-Za-z][\w-]*)/.exec(t);
    return m ? m[1] : '';
  }
  return '';
}

/**
 * Cheap structure scan used before any drawing: size, link count estimate and nesting depth.
 * Returns { chars, lines, edges, depth, longestLine }.
 */
function scan(text) {
  const s = String(text || '');
  const lines = s.split(/\r?\n/);
  let depth = 0, maxDepth = 0, edges = 0, longest = 0;
  for (const raw of lines) {
    if (raw.length > longest) longest = raw.length;
    const t = raw.trim();
    if (!t || t.startsWith('%%')) continue;
    // Links: -->, ---, -.->, ==>, ~~~, --o, --x, <-->. Count arrows, not lines.
    const m = t.match(/<?(-{2,}|={2,}|-\.+-|~{3,})[>ox]?/g);
    if (m) { edges += m.length; continue; }
    // Opening keywords closed by "end" (flowchart, block and sequence diagrams) or by "}" (state, class).
    if (/^(subgraph|block:|block\s*$|loop|alt|opt|par|critical|break|rect|box)(\s|$|:)/i.test(t) || /^(state|namespace|class)\b.*\{\s*$/.test(t)) {
      depth++; if (depth > maxDepth) maxDepth = depth;
    } else if (/^end\s*$/i.test(t) || t === '}') {
      if (depth > 0) depth--;
    }
  }
  return { chars: s.length, lines: lines.length, edges, depth: maxDepth, longestLine: longest };
}

/**
 * Should we refuse to draw? Returns '' when it is fine, else a plain sentence for the user.
 * limits: { maxTextSize, maxEdges }
 */
function refuseReason(text, limits) {
  const s = scan(text);
  const fmt = n => Number(n).toLocaleString('en-US');
  if (s.chars > limits.maxTextSize)
    return `This diagram has ${fmt(s.chars)} characters. The limit is ${fmt(limits.maxTextSize)} (setting mermaidViewer.maxTextSize). Raise it to draw this diagram.`;
  if (s.longestLine > MAX_LINE_CHARS)
    return `Line length ${fmt(s.longestLine)} is over ${fmt(MAX_LINE_CHARS)} characters. This does not look like a diagram, so it is not drawn.`;
  if (s.depth > MAX_NESTING)
    return `This diagram nests ${fmt(s.depth)} levels deep (subgraphs, blocks or states). Mermaid Viewer draws up to ${MAX_NESTING} levels, because deeper nesting can stall the layout for minutes.`;
  if (s.edges > limits.maxEdges)
    return `This diagram has about ${fmt(s.edges)} links. The limit is ${fmt(limits.maxEdges)} (setting mermaidViewer.maxEdges), because layout time grows fast: 2,000 links take about 8 s, 5,000 about a minute. To draw it, raise that setting and mermaidViewer.renderTimeoutSeconds.`;
  return '';
}

/**
 * The 1-based line in the diagram text that a Mermaid error names, or 0.
 * Handles jison ("Parse error on line 3:"), langium ("at line 2, column 5" / "line 2:") and lexer messages.
 */
function errorLine(message) {
  const m = String(message || '');
  const r = /Parse error on line (\d+)/i.exec(m) || /Lexical error on line (\d+)/i.exec(m) || /\bline[: ]+(\d+)(?:,?\s*column|:)/i.exec(m) || /\bline (\d+)\b/i.exec(m);
  return r ? Math.max(0, parseInt(r[1], 10)) : 0;
}

/** First useful line of a Mermaid error, without the long "Expecting ..." list, at most 300 chars. */
function shortError(message) {
  const m = String(message || 'Unknown error').replace(/\r/g, '');
  const lines = m.split('\n').map(x => x.trimEnd()).filter(Boolean);
  let out = lines[0] || 'Unknown error';
  out = out.replace(/^(Parse|Lexical) error on line \d+:?\s*/i, (m, k) => k === 'Lexical' ? 'Unknown character' : 'Syntax error');
  // jison: "Parse error on line 3:" then the source excerpt, the caret line, then "Expecting ..., got 'X'"
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

/** Strip a UTF-8 BOM and turn NUL and other control bytes (not tab or line breaks) into spaces. */
function cleanSource(text) {
  return String(text || '').replace(/^\uFEFF/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
}

module.exports = {
  isMermaidPath, isMarkdownPath, findMermaidBlocks, blockAtLine, hasMermaidFence, diagramType, scan, refuseReason,
  errorLine, shortError, cleanSource, MAX_NESTING, MAX_LINE_CHARS,
};
