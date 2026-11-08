// Writes the sample files used by the tests and the real VS Code check.
// usage: node scripts/make-samples.mjs <dir> [--large <dir>]
//   <dir>          normal samples: one file per diagram type, a Markdown file with 5 blocks, front matter, edge cases
//   --large <dir>  also the big and hostile files (keep them out of the repo; the check deletes them after)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || 'samples');
const li = args.indexOf('--large');
const largeDir = li >= 0 ? path.resolve(args[li + 1]) : null;
fs.mkdirSync(dir, { recursive: true });
const w = (d, name, text) => { fs.writeFileSync(path.join(d, name), text); return name; };

const S = {
  'flowchart.mmd': `flowchart TD
  start([Order received]) --> check{Payment OK?}
  check -- yes --> pack[Pack the items and print the shipping label for the courier]
  check -- no --> retry[Ask the customer to pay again]
  retry --> check
  pack --> ship[(Warehouse)]
  ship --> done((Delivered))
  subgraph Returns
    direction LR
    r1[Return request] --> r2{Within 30 days?}
    r2 -- yes --> r3[Refund]
    r2 -- no --> r4[Decline]
  end
  done -.-> r1
  classDef warn fill:#ffe4b5,stroke:#d2691e,color:#222
  class retry,r4 warn
`,
  'sequence.mmd': `sequenceDiagram
  autonumber
  actor U as User
  participant A as App
  participant S as API server
  participant D as Database
  U->>A: Open the dashboard
  A->>S: GET /reports?since=7d
  activate S
  S->>D: SELECT * FROM reports
  D-->>S: 42 rows
  alt cache is fresh
    S-->>A: 200 (from cache)
  else cache is stale
    S->>S: Rebuild the cache
    S-->>A: 200 (fresh)
  end
  deactivate S
  Note over A,S: Every call is local in this example
  A-->>U: Show the charts
`,
  'class.mmd': `classDiagram
  class Shape {
    <<abstract>>
    +String name
    +area() double
    +perimeter() double
  }
  class Circle {
    +double radius
    +area() double
  }
  class Rectangle {
    +double width
    +double height
    +area() double
  }
  class Canvas {
    -List~Shape~ shapes
    +add(Shape s) void
    +render() void
  }
  Shape <|-- Circle
  Shape <|-- Rectangle
  Canvas "1" o-- "*" Shape : holds
`,
  'state.mmd': `stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Paused : pause
  Paused --> Running : resume
  Running --> Failed : error
  Failed --> Idle : reset
  Running --> Done : finish
  state Running {
    [*] --> Loading
    Loading --> Working
    Working --> Saving
    Saving --> [*]
  }
  Done --> [*]
`,
  'er.mmd': `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "appears in"
  CUSTOMER {
    int id PK
    string name
    string email
  }
  ORDER {
    int id PK
    int customer_id FK
    date placed_at
  }
  LINE_ITEM {
    int order_id FK
    int product_id FK
    int quantity
  }
  PRODUCT {
    int id PK
    string title
    decimal price
  }
`,
  'gantt.mmd': `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  section Build
  Parser work        :done,    p1, 2026-11-02, 3d
  Renderer           :active,  p2, after p1, 4d
  Export options     :         p3, after p2, 2d
  section Check
  Unit tests         :         t1, after p2, 2d
  Real app check     :crit,    t2, after t3, 1d
  Red team           :         t3, after p3, 1d
  section Ship
  Release            :milestone, m1, after t2, 0d
`,
  'pie.mmd': `pie showData
  title Where the build time goes
  "Install" : 38
  "Compile" : 27
  "Tests" : 21
  "Package" : 9
  "Upload" : 5
`,
  'gitgraph.mmd': `gitGraph
  commit id: "init"
  commit id: "parser"
  branch feature/export
  checkout feature/export
  commit id: "svg"
  commit id: "png"
  checkout main
  commit id: "fix"
  merge feature/export
  commit id: "release" tag: "v0.1.0"
`,
  'mindmap.mmd': `mindmap
  root((Mermaid Viewer))
    Open
      .mmd files
      Markdown blocks
      Command palette
    View
      Zoom at pointer
      Drag to pan
      Fit and 100%
    Export
      SVG
      PNG 1x 2x 4x
      Copy to clipboard
    Safe
      No sign-in
      No network
`,
  'timeline.mmd': `timeline
  title Diagram tools over time
  2014 : Mermaid first release
  2019 : Live editor
  2022 : Mindmaps
       : Timelines
  2024 : Architecture diagrams
  2026 : Mermaid 12
`,
  'sankey.mmd': `sankey-beta
Solar,Grid,40
Wind,Grid,35
Gas,Grid,25
Grid,Homes,45
Grid,Industry,40
Grid,Losses,15
`,
  'xychart.mmd': `xychart-beta
  title "Installs per day"
  x-axis [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  y-axis "Installs" 0 --> 120
  bar [32, 45, 51, 60, 72, 88, 97]
  line [30, 40, 50, 60, 70, 80, 90]
`,
  'block.mmd': `block-beta
  columns 3
  frontend["Web app"] api["API"] db[("Database")]
  space:3
  queue["Queue"] worker["Worker"] store[("Object store")]
  frontend --> api
  api --> db
  api --> queue
  queue --> worker
  worker --> store
`,
  'c4.mmd': `C4Context
  title System context for a file viewer
  Person(dev, "Developer", "Writes diagrams in VS Code")
  System(ext, "Mermaid Viewer", "Draws diagrams inside VS Code")
  System_Ext(fs, "Workspace files", "The .mmd and .md files")
  Rel(dev, ext, "Opens the preview")
  Rel(ext, fs, "Reads the open text")
`,
  'architecture.mmd': `architecture-beta
  group cloud(cloud)[Cloud]
  service web(internet)[Web] in cloud
  service api(server)[API] in cloud
  service db(database)[Database] in cloud
  service disk(disk)[Storage] in cloud
  web:R --> L:api
  api:R --> L:db
  db:B --> T:disk
`,
  'front-matter.mermaid': `---
title: Front matter sets the title and theme
config:
  theme: forest
---
flowchart LR
  a[Front matter] --> b[Theme forest]
  b --> c[Title above]
`,
  'syntax-error.mmd': `flowchart TD
  A[Start] --> B[Next]
  B --> C[[Broken
  C --> D
`,
};
const names = Object.entries(S).map(([n, t]) => w(dir, n, t));

names.push(w(dir, 'README.md', `# Service notes

This file has five Mermaid blocks. The fourth one has a syntax error on purpose.

## Request flow

\`\`\`mermaid
flowchart LR
  client --> gateway --> service --> db[(DB)]
\`\`\`

## Login

\`\`\`mermaid
sequenceDiagram
  Browser->>Server: POST /login
  Server-->>Browser: 302 to /home
\`\`\`

Some text between the blocks.

## States

~~~mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Review
  Review --> Published
~~~

## Broken on purpose

\`\`\`mermaid
flowchart TD
  A --> B
  B --> --> C
\`\`\`

## Share of work

\`\`\`mermaid
pie
  "Docs" : 2
  "Code" : 5
  "Tests" : 3
\`\`\`

\`\`\`js
// not a diagram
console.log('hello');
\`\`\`
`));

if (largeDir) {
  fs.mkdirSync(largeDir, { recursive: true });
  // Large: 3,000 nodes and 5,000 links, about 200 KB.
  const L = ['flowchart LR'];
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i++) L.push(`  n${i}["Step ${i}"]`);
  for (let i = 1; i < 3000; i++) L.push(`  n${rnd(i)} --> n${i}`);
  for (let i = 0; i < 2001; i++) { const a = rnd(3000), b = rnd(3000); L.push(`  n${Math.min(a, b)} --> n${Math.max(a, b) === Math.min(a, b) ? Math.min(2999, a + 1) : Math.max(a, b)}`); }
  w(largeDir, 'large-flowchart.mmd', L.join('\n') + '\n');
  // Slow: 1,000 nodes and 1,600 links, under the default limit, about 5 s to draw (used for the time limit check).
  const SL = ['flowchart LR'];
  for (let i = 1; i < 1000; i++) SL.push(`  s${rnd(i)} --> s${i}`);
  for (let i = 0; i < 601; i++) { const a = rnd(999), b = a + 1 + rnd(999 - a); SL.push(`  s${a} --> s${b}`); }
  w(largeDir, 'slow-flowchart.mmd', SL.join('\n') + '\n');
  // Medium: 400 nodes and 600 links, drawn in a few seconds.
  const M = ['flowchart TD'];
  for (let i = 1; i < 400; i++) M.push(`  m${rnd(i)} --> m${i}`);
  for (let i = 0; i < 201; i++) { const a = rnd(399), b = a + 1 + rnd(399 - a); M.push(`  m${a} --> m${b}`); }
  w(largeDir, 'medium-flowchart.mmd', M.join('\n') + '\n');
  // Hostile 1: tries to loosen security, run script and load remote content.
  w(largeDir, 'hostile-script.mmd', `%%{init: {"securityLevel": "loose", "startOnLoad": true, "maxTextSize": 99999999}}%%
flowchart LR
  A["<img src=x onerror=alert(1)> image"] --> B["<script>alert(2)</script> script"]
  B --> C["<a href='javascript:alert(3)'>js link</a>"]
  C --> D["<img src='https://example.com/pixel.png'> remote"]
  D --> E["<iframe src='https://example.com'></iframe> frame"]
  E --> F["<svg onload=alert(4)></svg> svg"]
  click A call alert(5)
  click B href "javascript:alert(6)"
  click C "https://example.com/track" "Tooltip"
  style F fill:#fdd,stroke:#c00,color:#300
`);
  // Hostile 2: 2.2 MB of subgraphs nested 500 deep.
  const H = ['flowchart TB'];
  let size = 0;
  while (size < 2.2e6) {
    const part = [];
    for (let d = 0; d < 500; d++) part.push(' '.repeat(d % 40) + `subgraph s${H.length}_${d}[Level ${d}]`);
    part.push(' '.repeat(10) + `x${H.length} --> y${H.length}`);
    for (let d = 0; d < 500; d++) part.push(' '.repeat(d % 40) + 'end');
    const t = part.join('\n');
    H.push(t); size += t.length;
  }
  w(largeDir, 'hostile-nested-2mb.mmd', H.join('\n') + '\n');
  // Hostile 2b: the same 500-deep nesting in 30 KB, under the size limit, so only the nesting guard stops it.
  const N = ['flowchart TB'];
  for (let d = 0; d < 500; d++) N.push(`subgraph q${d}[Level ${d}]`);
  N.push('a --> b');
  for (let d = 0; d < 500; d++) N.push('end');
  w(largeDir, 'hostile-nested-small.mmd', N.join('\n') + '\n');
  // Hostile 3: invalid UTF-8 bytes and a BOM (opens as text with replacement characters), the same with NUL bytes
  // (VS Code takes it for binary), and an empty file.
  const bad = Buffer.concat([Buffer.from('flowchart LR\n  A["caf'), Buffer.from([0xe9, 0xff, 0xfe, 0xc3]), Buffer.from('"] --> B["ok"]\n')]);
  fs.writeFileSync(path.join(largeDir, 'invalid-utf8.mmd'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bad]));
  fs.writeFileSync(path.join(largeDir, 'binary-nul.mmd'), Buffer.concat([bad, Buffer.from([0x00, 0x00, 0x01, 0x02]), Buffer.from('\n')]));
  fs.writeFileSync(path.join(largeDir, 'empty.mmd'), '');
  // A 2.5 MB file that the check opens only from the Explorer menu, so VS Code never loaded it before.
  fs.writeFileSync(path.join(largeDir, 'huge-unopened.mmd'), 'flowchart LR\n' + '  a --> b\n'.repeat(Math.ceil(2.5e6 / 10)));
}
console.log(`wrote ${names.length} samples to ${dir}` + (largeDir ? ` and the large and hostile files to ${largeDir}` : ''));
