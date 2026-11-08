'use strict';
// Generates the samples (normal, large and hostile) into ~/mermaid-viewer-work/unit-samples, checks how the size
// and nesting guards classify each one, and deletes the folder after (large fixtures stay out of the temp folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const T = require('../src/core/mermaid-text');

const dir = path.join(os.homedir(), 'mermaid-viewer-work', 'unit-samples-' + process.pid);
const LIM = { maxTextSize: 500000, maxEdges: 2000 }; // the defaults
test.before(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'make-samples.mjs'), dir, '--large', dir], { stdio: 'ignore' }));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const read = f => T.cleanSource(fs.readFileSync(path.join(dir, f), 'utf8'));

test('the 16 docs examples pass the guards; the large flowchart is over the default link limit', () => {
  const docs = fs.readdirSync(dir).filter(f => /\.(mmd|mermaid)$/.test(f) && !/hostile|huge|large|medium|slow|invalid|binary|empty|syntax/.test(f));
  assert.equal(docs.length, 16);
  for (const f of docs) assert.equal(T.refuseReason(read(f), LIM), '', f);
  const big = read('large-flowchart.mmd');
  const s = T.scan(big);
  assert.ok(s.edges >= 4900 && s.edges <= 5100, String(s.edges));
  assert.ok(big.length > 100000);
  assert.match(T.refuseReason(big, LIM), /about 5,0\d\d links\. The limit is 2,000/);
  assert.equal(T.refuseReason(big, { maxTextSize: 500000, maxEdges: 10000 }), '');
  assert.equal(T.refuseReason(read('slow-flowchart.mmd'), LIM), '');
});

test('hostile files: the 2 MB nest is over the size limit, the small nest over the depth limit', () => {
  assert.match(T.refuseReason(read('hostile-nested-2mb.mmd'), LIM), /characters\. The limit is 500,000/);
  assert.match(T.refuseReason(read('hostile-nested-small.mmd'), LIM), /nests 500 levels deep/);
  assert.equal(T.refuseReason(read('hostile-script.mmd'), LIM), '');
  assert.ok(fs.statSync(path.join(dir, 'huge-unopened.mmd')).size > LIM.maxTextSize * 4);
});

test('broken bytes decode with replacement characters; empty file is empty', () => {
  const t = new TextDecoder('utf-8', { fatal: false }).decode(fs.readFileSync(path.join(dir, 'binary-nul.mmd')));
  assert.match(T.cleanSource(t), /caf�/);
  assert.ok(!T.cleanSource(t).includes('\u0000'));
  assert.equal(read('empty.mmd'), '');
});

test('README.md: five blocks, the fourth is the broken one', () => {
  const b = T.findMermaidBlocks(read('README.md'));
  assert.equal(b.length, 5);
  assert.match(b[3].source, /B --> --> C/);
  assert.equal(T.diagramType(b[2].source), 'stateDiagram-v2');
});
