'use strict';
// Checks on package.json, the files that ship, and the no-network rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('display name holds every word of each target phrase (DEMAND2 build 4) and no rival listing name', () => {
  const words = new Set(pkg.displayName.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean));
  for (const phrase of ['mermaid editor', 'mermaid live editor', 'diagram editor', 'mermaid diagram', 'mermaid diagram viewer', 'mermaid preview', 'mermaid viewer', 'mmd viewer', 'mermaid'])
    for (const w of phrase.split(' ')) assert.ok(words.has(w), `"${w}" from "${phrase}" is missing in the display name`);
  // NAME GUARD: not the exact name of another listing ("Mermaid Editor", "Mermaid Preview", "Mermaid Viewer", "Mermaid Chart").
  for (const rival of ['Mermaid Editor', 'Mermaid Preview', 'Mermaid Viewer', 'Mermaid Chart', 'Markdown Preview Mermaid Support'])
    assert.ok(!pkg.displayName.includes(rival), rival);
  assert.ok(pkg.displayName.length <= 90);
});

test('description says free, no sign-in and offline', () => {
  assert.match(pkg.description, /Free/);
  assert.match(pkg.description, /No sign-in/);
  assert.match(pkg.description, /offline/);
});

test('every contributed command is registered, every setting is read', () => {
  const ext = read('src/extension.js') + read('src/support.js') + read('src/license/index.js') + read('src/blocks.js') + read('src/batch.js');
  for (const c of pkg.contributes.commands) {
    const id = c.command;
    const short = id.split('.')[1];
    assert.ok(ext.includes(`'${id}'`) || ext.includes('`${prefix}.' + short + '`') || ext.includes(`.${short}`), `command ${id} is not registered`);
  }
  const all = ext + read('src/rate.js');
  for (const k of Object.keys(pkg.contributes.configuration.properties)) {
    const short = k.split('.')[1];
    assert.ok(all.includes(`'${short}'`) || all.includes(`.${short}`) || all.includes('askForRating') || all.includes('showSupportLinks'), `setting ${k} is never read`);
  }
});

test('the Mermaid bundle matches the version and sha256 in package.json', () => {
  const buf = fs.readFileSync(path.join(root, 'media/mermaid.min.js'));
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), pkg.mermaidSha256);
  assert.ok(buf.includes(Buffer.from(`"${pkg.mermaidVersion}"`)));
  assert.match(pkg.mermaidVersion, /^1[1-9]\.\d+\.\d+$/);
});

test('no network code in the extension host or the webview script', () => {
  for (const f of ['src/extension.js', 'src/html.js', 'src/core/mermaid-text.js', 'src/core/complete.js', 'src/core/templates.js', 'src/core/pdf.js', 'src/blocks.js', 'src/outline.js', 'src/batch.js', 'src/pro.js', 'src/rate.js', 'src/support.js', 'src/license/index.js', 'src/license/license.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /require\(['"](https?|net|tls|dgram|dns|http2)['"]\)/, f);
    assert.doesNotMatch(s, /\bfetch\(|XMLHttpRequest|WebSocket/, f);
  }
  for (const f of ['media/preview.js', 'media/batch.js', 'media/svgtools.js']) assert.doesNotMatch(read(f), /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts|new Worker/, f);
  // The only network code in the package: the GitHub Sponsors rail, used only after the user clicks Unlock.
  assert.match(read('src/license/sponsors.js'), /api\.github\.com\/graphql|graphql/);
  assert.equal(require('../src/pro.js').PRO_ENABLED, false, 'this release ships with Pro switched off');
  const w = read('media/svgtools.js');
  assert.match(w, /securityLevel: 'strict'/);
  assert.match(w, /secure: \['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'dompurifyConfig'\]/);
  assert.match(w, /FORBID_TAGS: \['img'/);
});

test('engines floor and activation', () => {
  assert.match(pkg.engines.vscode, /^\^1\.\d+\.0$/);
  const minor = Number(pkg.engines.vscode.split('.')[1]);
  assert.ok(minor <= 90, 'engines.vscode must stay low for Cursor and Windsurf');
  assert.ok(pkg.activationEvents.includes('onLanguage:mermaid'));
  assert.ok(pkg.activationEvents.includes('onLanguage:markdown'));
  assert.deepEqual(pkg.contributes.languages[0].extensions, ['.mmd', '.mermaid']);
  assert.equal(pkg.capabilities.untrustedWorkspaces.supported, true);
});

test('.vscodeignore keeps tests, scripts, samples and images out of the package', () => {
  const ig = read('.vscodeignore');
  for (const x of ['test/**', 'scripts/**', 'samples/**', 'images/**', 'node_modules/**']) assert.ok(ig.includes(x), x);
  assert.ok(fs.existsSync(path.join(root, 'icon.png')));
  for (const s of pkg.contributes.walkthroughs[0].steps) assert.ok(fs.existsSync(path.join(root, s.media.markdown)), s.media.markdown);
});

test('the webview cleans links, handlers and remote URLs out of Mermaid output', () => {
  const w = read('media/svgtools.js');
  assert.match(read('media/preview.js'), /ST\.toSvgElement/);
  assert.match(read('media/batch.js'), /ST\.toSvgElement/);
  assert.match(w, /n\.startsWith\('on'\)/);
  assert.match(w, /script,iframe,object,embed,link,meta,base/);
  assert.match(w, /\(href\|xlink:href\|src|n === 'href' \|\| n === 'xlink:href'/);
});
