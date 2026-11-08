'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/core/mermaid-text');

const LIM = { maxTextSize: 500000, maxEdges: 10000 };

test('finds ```mermaid and ~~~mermaid blocks with their lines', () => {
  const md = ['# Title', '```mermaid', 'flowchart LR', '  A --> B', '```', 'text', '~~~mermaid', 'pie', '  "a" : 1', '~~~', '```js', 'x()', '```'].join('\n');
  const b = T.findMermaidBlocks(md);
  assert.equal(b.length, 2);
  assert.deepEqual(b.map(x => [x.index, x.fenceLine, x.startLine, x.endLine]), [[0, 1, 2, 4], [1, 6, 7, 9]]);
  assert.equal(b[0].source, 'flowchart LR\n  A --> B');
  assert.equal(b[1].source, 'pie\n  "a" : 1');
});

test('a backtick line inside a tilde fence is content, a longer fence needs a long close, unclosed runs to the end', () => {
  const md = ['~~~mermaid', 'flowchart LR', '```', '~~~', '````mermaid', 'pie', '```', '  "x" : 1', '````', '```mermaid', 'graph TD', 'A-->B'].join('\n');
  const b = T.findMermaidBlocks(md);
  assert.equal(b.length, 3);
  assert.equal(b[0].source, 'flowchart LR\n```');
  assert.equal(b[1].source, 'pie\n```\n  "x" : 1');
  assert.equal(b[2].closed, false);
  assert.equal(b[2].source, 'graph TD\nA-->B');
});

test('indented fences lose their indent; other languages and inline code are ignored', () => {
  const md = ['  ```mermaid', '  flowchart LR', '    A --> B', '  ```', '`mermaid` inline', '```python', 'print(1)', '```', '```Mermaid', 'pie', '```'].join('\n');
  const b = T.findMermaidBlocks(md);
  assert.equal(b.length, 2);
  assert.equal(b[0].source, 'flowchart LR\n  A --> B');
  assert.equal(b[1].source, 'pie');
});

test('CRLF files work and blockAtLine maps editor lines to blocks', () => {
  const md = 'a\r\n```mermaid\r\nflowchart LR\r\n  A-->B\r\n```\r\nb\r\n';
  const b = T.findMermaidBlocks(md);
  assert.equal(b[0].source, 'flowchart LR\n  A-->B');
  assert.equal(T.blockAtLine(b, 0), -1);
  assert.equal(T.blockAtLine(b, 1), 0);
  assert.equal(T.blockAtLine(b, 4), 0);
  assert.equal(T.blockAtLine(b, 5), -1);
});

test('hasMermaidFence and path checks', () => {
  assert.ok(T.hasMermaidFence('x\n```mermaid\ngraph TD\n```'));
  assert.ok(T.hasMermaidFence('~~~ mermaid\n'));
  assert.ok(!T.hasMermaidFence('```js\nmermaid\n```'));
  assert.ok(T.isMermaidPath('/a/b.mmd') && T.isMermaidPath('C:\\x\\Y.MERMAID') && !T.isMermaidPath('a.md'));
  assert.ok(T.isMarkdownPath('README.md') && T.isMarkdownPath('x.markdown') && !T.isMarkdownPath('x.mmd'));
});

test('diagramType skips front matter, comments and directives', () => {
  assert.equal(T.diagramType('---\ntitle: x\nconfig:\n  theme: forest\n---\n%% c\n%%{init: {}}%%\nsequenceDiagram\n A->>B: x'), 'sequenceDiagram');
  assert.equal(T.diagramType('\n\n  flowchart LR'), 'flowchart');
  assert.equal(T.diagramType(''), '');
});

test('refuseReason: size, nesting, links and one huge line', () => {
  assert.equal(T.refuseReason('flowchart LR\n A --> B', LIM), '');
  assert.match(T.refuseReason('flowchart LR\n' + 'x'.repeat(600000), LIM), /600,0\d\d characters\. The limit is 500,000/);
  const deep = ['flowchart TB', ...Array.from({ length: 500 }, (_, i) => `subgraph s${i}`), 'a --> b', ...Array(500).fill('end')].join('\n');
  assert.match(T.refuseReason(deep, LIM), /nests 500 levels deep/);
  const ok = ['flowchart TB', ...Array.from({ length: 20 }, (_, i) => `subgraph s${i}`), 'a --> b', ...Array(20).fill('end')].join('\n');
  assert.equal(T.refuseReason(ok, LIM), '');
  const many = 'flowchart LR\n' + Array.from({ length: 12000 }, (_, i) => `n${i} --> n${i + 1}`).join('\n');
  assert.match(T.refuseReason(many, LIM), /about 12,000 links\. The limit is 10,000 \(setting mermaidViewer\.maxEdges\)/);
  assert.equal(T.refuseReason(many, { maxTextSize: 1e6, maxEdges: 20000 }), '');
  assert.match(T.refuseReason('flowchart LR\nA["' + 'y'.repeat(250000) + '"]', { maxTextSize: 1e6, maxEdges: 1e4 }), /does not look like a diagram/);
});

test('scan counts nesting in sequence and state diagrams and ignores arrows lines for depth', () => {
  const seq = 'sequenceDiagram\nloop every minute\n alt ok\n  A->>B: x\n else no\n  B->>A: y\n end\nend';
  assert.equal(T.scan(seq).depth, 2);
  const st = 'stateDiagram-v2\nstate Outer {\n state Inner {\n  [*] --> a\n }\n}';
  assert.equal(T.scan(st).depth, 2);
  assert.equal(T.scan('flowchart LR\nloop --> x\nloop --> y').depth, 0);
  assert.equal(T.scan('flowchart LR\nA --> B & C\nB -.-> D\nD ==> E\nE --- F').edges, 4);
});

test('errorLine reads jison, lexer and langium messages', () => {
  assert.equal(T.errorLine("Parse error on line 3:\n...B --> --> C\n-----^\nExpecting 'AMP', got 'LINK'"), 3);
  assert.equal(T.errorLine('Lexical error on line 7. Unrecognized text.'), 7);
  assert.equal(T.errorLine('Parsing failed: unexpected character: ->x<- at offset: 20, skipped 1 characters. Expecting token of type at line 2, column 5'), 2);
  assert.equal(T.errorLine('No diagram type detected matching given configuration for text: hello'), 0);
});

test('shortError keeps the useful part', () => {
  assert.equal(T.shortError("Parse error on line 3:\n...D  A --> B  B --> --> C\n---------------------^\nExpecting 'AMP', 'COLON', got 'LINK'"), 'Syntax error: unexpected LINK near "D  A --> B  B --> --> C"');
  assert.match(T.shortError('No diagram type detected matching given configuration for text: x'), /^No diagram type found\./);
  assert.ok(T.shortError('x'.repeat(1000)).length <= 300);
  assert.equal(T.shortError(''), 'Unknown error');
});

test('cleanSource removes a BOM and NUL bytes', () => {
  assert.equal(T.cleanSource('\uFEFFgraph TD\u0000A'), 'graph TD A');
  assert.equal(T.cleanSource('a\u0001\u0002b\tc\r\nd\u007F'), 'a  b\tc\r\nd ');
  assert.equal(T.cleanSource(null), '');
});
