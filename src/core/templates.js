'use strict';
// Starter diagrams for "New Diagram from Template" and for completion on the first line of a file.
// Each one is small, valid in Mermaid 12.3 and shows the main syntax of its type. Checked in a real
// VS Code by scripts/e2e-editor.mjs (every template must draw with no error).

const TEMPLATES = [
  { id: 'flowchart', label: 'Flowchart', keyword: 'flowchart', detail: 'Boxes and arrows, with a decision and a subgraph', text: `flowchart TD
  start([Start]) --> input[/Read the input/]
  input --> check{Valid?}
  check -- yes --> work[Process it]
  check -- no --> fix[Show an error]
  fix --> input
  subgraph Output
    work --> save[(Save)]
    save --> done([Done])
  end
` },
  { id: 'sequence', label: 'Sequence diagram', keyword: 'sequenceDiagram', detail: 'Messages between participants over time', text: `sequenceDiagram
  autonumber
  actor U as User
  participant A as App
  participant S as Server
  U->>A: Click Save
  A->>S: POST /items
  alt saved
    S-->>A: 201 Created
    A-->>U: Show "Saved"
  else failed
    S-->>A: 500 Error
    A-->>U: Show the error
  end
  Note over A,S: The app retries once
` },
  { id: 'class', label: 'Class diagram', keyword: 'classDiagram', detail: 'Classes, fields, methods and relations', text: `classDiagram
  class Shape {
    <<interface>>
    +area() double
  }
  class Circle {
    -double radius
    +area() double
  }
  class Square {
    -double side
    +area() double
  }
  Shape <|.. Circle
  Shape <|.. Square
  Drawing "1" *-- "many" Shape : contains
` },
  { id: 'state', label: 'State diagram', keyword: 'stateDiagram-v2', detail: 'States and the events that move between them', text: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Draft : changes requested
  Review --> Published : approve
  state Published {
    [*] --> Live
    Live --> Archived : after 1 year
  }
  Published --> [*]
` },
  { id: 'er', label: 'Entity relationship diagram', keyword: 'erDiagram', detail: 'Tables, columns and how they relate', text: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "is in"
  CUSTOMER {
    int id PK
    string name
    string email
  }
  ORDER {
    int id PK
    int customer_id FK
    date created
  }
` },
  { id: 'gantt', label: 'Gantt chart', keyword: 'gantt', detail: 'Tasks on a timeline, with sections and milestones', text: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  section Build
    Design        :done,   d1, 2026-01-05, 5d
    Code          :active, c1, after d1, 10d
  section Ship
    Test          :t1, after c1, 5d
    Release       :milestone, after t1, 0d
` },
  { id: 'pie', label: 'Pie chart', keyword: 'pie', detail: 'Parts of a whole', text: `pie showData
  title Time spent
  "Writing code" : 45
  "Reviews" : 25
  "Meetings" : 20
  "Other" : 10
` },
  { id: 'mindmap', label: 'Mindmap', keyword: 'mindmap', detail: 'Ideas around one central topic', text: `mindmap
  root((Project))
    Goals
      Faster builds
      Fewer bugs
    People
      Design
      Engineering
    Risks
      Deadline
` },
  { id: 'timeline', label: 'Timeline', keyword: 'timeline', detail: 'Events grouped by period', text: `timeline
  title Product history
  2024 : First version
  2025 : Mobile app
       : Dark mode
  2026 : Team plans
` },
  { id: 'gitgraph', label: 'Git graph', keyword: 'gitGraph', detail: 'Commits, branches and merges', text: `gitGraph
  commit id: "init"
  branch feature
  checkout feature
  commit id: "add export"
  commit id: "tests"
  checkout main
  commit id: "fix typo"
  merge feature tag: "v1.0"
` },
  { id: 'c4', label: 'C4 context diagram', keyword: 'C4Context', detail: 'People, systems and their relations (C4 model)', text: `C4Context
  title System context
  Person(user, "Customer", "Buys things online")
  System(shop, "Web shop", "Lists products and takes orders")
  System_Ext(pay, "Payment provider", "Takes card payments")
  Rel(user, shop, "Uses")
  Rel(shop, pay, "Sends payments to")
` },
  { id: 'sankey', label: 'Sankey diagram', keyword: 'sankey-beta', detail: 'Flows between nodes, sized by amount (CSV rows)', text: `sankey-beta
Visitors,Sign-ups,300
Visitors,Left,700
Sign-ups,Trial,200
Sign-ups,Free plan,100
Trial,Paid,80
Trial,Cancelled,120
` },
  { id: 'xychart', label: 'XY chart (bar and line)', keyword: 'xychart-beta', detail: 'Bars and lines on x and y axes', text: `xychart-beta
  title "Downloads per month"
  x-axis [Jan, Feb, Mar, Apr, May, Jun]
  y-axis "Downloads" 0 --> 1000
  bar [120, 260, 380, 520, 700, 910]
  line [100, 240, 360, 500, 680, 880]
` },
  { id: 'block', label: 'Block diagram', keyword: 'block-beta', detail: 'Blocks in columns, with arrows', text: `block-beta
  columns 3
  web["Web app"] api["API"] db[("Database")]
  space:3
  queue["Queue"] worker["Worker"] store[("Files")]
  web --> api
  api --> db
  api --> queue
  queue --> worker
  worker --> store
` },
  { id: 'architecture', label: 'Architecture diagram', keyword: 'architecture-beta', detail: 'Services in groups, with built-in icons', text: `architecture-beta
  group cloud(cloud)[Cloud]
  service web(internet)[Web] in cloud
  service api(server)[API] in cloud
  service db(database)[Database] in cloud
  service files(disk)[Files] in cloud
  web:R --> L:api
  api:R --> L:db
  api:B --> T:files
` },
];

module.exports = { TEMPLATES };
