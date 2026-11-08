#!/bin/sh
# Replace the bundled Mermaid with another npm version: scripts/update-mermaid.sh 12.3.0
# Downloads the npm tarball into a fresh temp folder, copies dist/mermaid.min.js and LICENSE into media/,
# and writes the version and sha256 into package.json. Run the tests and the real VS Code check after it.
set -eu
v=${1:?usage: update-mermaid.sh <version>}
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack "mermaid@$v" >/dev/null && tar xzf "mermaid-$v.tgz")
cp "$tmp/package/dist/mermaid.min.js" "$root/media/mermaid.min.js"
cp "$tmp/package/LICENSE" "$root/media/mermaid-LICENSE.txt"
sha=$(shasum -a 256 "$root/media/mermaid.min.js" | cut -d' ' -f1)
node -e 'const f=process.argv[1],p=require(f);p.mermaidVersion=process.argv[2];p.mermaidSha256=process.argv[3];require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$root/package.json" "$v" "$sha"
echo "mermaid $v sha256 $sha"
