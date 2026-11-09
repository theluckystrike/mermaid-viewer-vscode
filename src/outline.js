'use strict';
// "Mermaid Diagrams" view in the Explorer: every diagram in the active Markdown or Mermaid file, with its type and
// line. Click to go to it; inline buttons edit or preview it. Built for long documents with many diagrams.
const path = require('path');
const T = require('./core/mermaid-text');

const MAX_CHARS = 20e6;

function createOutline({ vscode, isMarkdownDoc, isMermaidDoc, pro }) {
  const emitter = new vscode.EventEmitter();
  let doc = null;
  let timer = null;

  function items() {
    if (!doc) return [];
    const text = doc.getText();
    if (text.length > MAX_CHARS) return [{ kind: 'note', label: `${path.basename(doc.uri.path)} is too large to list its diagrams.` }];
    if (isMermaidDoc(doc)) {
      const t = T.diagramType(T.cleanSource(text));
      return [{ kind: 'diagram', index: 0, line: 0, label: t || 'empty diagram', description: 'line 1', md: false, text: text.slice(0, 400) }];
    }
    if (!isMarkdownDoc(doc)) return [];
    return T.findMermaidBlocks(text).map(b => {
      const first = (b.source.split('\n').find(l => l.trim() && !l.trim().startsWith('%%')) || '').trim();
      const head = headingAbove(text, b.fenceLine);
      return { kind: 'diagram', index: b.index, line: b.fenceLine, label: `${b.index + 1}. ${T.diagramType(b.source) || 'empty'}`, description: (head ? head + ' · ' : '') + `line ${b.startLine + 1}`, md: true, text: b.source.slice(0, 400), first };
    });
  }

  function headingAbove(text, line) {
    const lines = text.split(/\r?\n/, line + 1);
    for (let i = Math.min(line, lines.length - 1); i >= 0 && i > line - 400; i--) {
      const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]);
      if (m) return m[1].slice(0, 50);
    }
    return '';
  }

  const provider = {
    onDidChangeTreeData: emitter.event,
    getChildren(el) {
      if (el) return [];
      if (!pro.has()) return [{ kind: 'pro' }];
      return items();
    },
    getTreeItem(it) {
      if (it.kind === 'pro') {
        const t = new vscode.TreeItem('The diagram outline is part of Zovo Pro', vscode.TreeItemCollapsibleState.None);
        t.command = { command: 'mermaidViewer.unlockOutline', title: 'Unlock' };
        t.tooltip = 'Everything else in Mermaid Viewer stays free.';
        return t;
      }
      if (it.kind === 'note') return new vscode.TreeItem(it.label, vscode.TreeItemCollapsibleState.None);
      const t = new vscode.TreeItem(it.label, vscode.TreeItemCollapsibleState.None);
      t.description = it.description;
      t.tooltip = new vscode.MarkdownString('```mermaid\n' + it.text.replace(/```/g, "'''") + (it.text.length >= 400 ? '\n...' : '') + '\n```');
      t.contextValue = it.md ? 'mermaidBlock' : 'mermaidFile';
      t.iconPath = new vscode.ThemeIcon('type-hierarchy');
      t.command = { command: 'mermaidViewer.outlineReveal', title: 'Go to diagram', arguments: [doc.uri, it.line, it.index] };
      t.id = `${doc.uri.toString()}#${it.index}`;
      return t;
    },
  };

  function track(editor) {
    const d = editor && editor.document;
    if (d && d.uri.scheme !== 'output' && (isMarkdownDoc(d) || isMermaidDoc(d))) doc = d;
    else if (d) doc = null;
    emitter.fire();
  }
  function changed(d) {
    if (!doc || d.uri.toString() !== doc.uri.toString()) return;
    clearTimeout(timer);
    timer = setTimeout(() => emitter.fire(), 400);
  }

  return { provider, track, changed, refresh: () => emitter.fire(), current: () => doc, _items: items };
}

module.exports = { createOutline };
