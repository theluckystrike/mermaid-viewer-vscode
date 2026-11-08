'use strict';
// No bundler: the extension host runs src/ as is. This check makes sure the Mermaid bundle in media/ is the one
// package.json names, so the version shown in the toolbar is true. To update Mermaid, see scripts/update-mermaid.sh.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const file = path.join(root, 'media', 'mermaid.min.js');
if (!fs.existsSync(file)) { console.error('media/mermaid.min.js is missing. Run scripts/update-mermaid.sh ' + pkg.mermaidVersion); process.exit(1); }
const buf = fs.readFileSync(file);
const want = pkg.mermaidSha256;
const got = crypto.createHash('sha256').update(buf).digest('hex');
if (want && got !== want) { console.error(`media/mermaid.min.js sha256 ${got} does not match package.json mermaidSha256 ${want}`); process.exit(1); }
if (!buf.includes(Buffer.from(`"${pkg.mermaidVersion}"`))) { console.error(`media/mermaid.min.js does not contain version ${pkg.mermaidVersion}`); process.exit(1); }
console.log(`mermaid ${pkg.mermaidVersion} ok (${(buf.length / 1048576).toFixed(2)} MB, sha256 ${got.slice(0, 16)}...)`);
