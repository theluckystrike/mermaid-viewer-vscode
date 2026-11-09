'use strict';
// Completion data for Mermaid text: diagram types on the first line, then the keywords, arrows and shapes of
// that diagram type. Pure (no VS Code), so tests can call it. Snippet strings use VS Code snippet syntax.
const { diagramType } = require('./mermaid-text');
const { TEMPLATES } = require('./templates');

// [keyword, detail, snippet?]
const TYPES = [
  ['flowchart TD', 'Flowchart, top to bottom', 'flowchart ${1|TD,LR,BT,RL|}\n  ${2:A[Start]} --> ${3:B[End]}'],
  ['flowchart LR', 'Flowchart, left to right', 'flowchart LR\n  ${1:A[Start]} --> ${2:B[End]}'],
  ['graph TD', 'Flowchart (older keyword)', 'graph ${1|TD,LR,BT,RL|}\n  ${2:A} --> ${3:B}'],
  ['sequenceDiagram', 'Messages between participants'],
  ['classDiagram', 'Classes and relations'],
  ['stateDiagram-v2', 'States and transitions'],
  ['erDiagram', 'Entity relationship diagram'],
  ['gantt', 'Gantt chart'],
  ['pie', 'Pie chart'],
  ['mindmap', 'Mindmap'],
  ['timeline', 'Timeline'],
  ['gitGraph', 'Git branches and commits'],
  ['C4Context', 'C4 system context'],
  ['C4Container', 'C4 container diagram'],
  ['C4Component', 'C4 component diagram'],
  ['C4Dynamic', 'C4 dynamic diagram'],
  ['C4Deployment', 'C4 deployment diagram'],
  ['sankey-beta', 'Sankey diagram (CSV rows: source,target,value)'],
  ['xychart-beta', 'Bar and line chart'],
  ['block-beta', 'Block diagram'],
  ['architecture-beta', 'Architecture diagram'],
  ['journey', 'User journey'],
  ['quadrantChart', 'Quadrant chart'],
  ['requirementDiagram', 'Requirement diagram'],
  ['packet-beta', 'Network packet layout'],
  ['kanban', 'Kanban board'],
];

const FLOW_SHAPES = [
  ['[ ] rectangle', 'id[Text]', '${1:id}[${2:Text}]'],
  ['( ) rounded', 'id(Text)', '${1:id}(${2:Text})'],
  ['([ ]) stadium', 'id([Text])', '${1:id}([${2:Text}])'],
  ['[[ ]] subroutine', 'id[[Text]]', '${1:id}[[${2:Text}]]'],
  ['[( )] database', 'id[(Text)]', '${1:id}[(${2:Text})]'],
  ['(( )) circle', 'id((Text))', '${1:id}((${2:Text}))'],
  ['{ } decision', 'id{Text}', '${1:id}{${2:Text}}'],
  ['{{ }} hexagon', 'id{{Text}}', '${1:id}{{${2:Text}}}'],
  ['[/ /] parallelogram', 'id[/Text/]', '${1:id}[/${2:Text}/]'],
  ['> ] flag', 'id>Text]', '${1:id}>${2:Text}]'],
];

const K = {
  flowchart: [
    ['subgraph', 'Group nodes; close with end', 'subgraph ${1:Title}\n  $0\nend'],
    ['end', 'Close a subgraph'],
    ['direction', 'Direction inside a subgraph', 'direction ${1|TB,LR,BT,RL|}'],
    ['classDef', 'Define a style class', 'classDef ${1:name} fill:${2:#f9f},stroke:${3:#333},color:${4:#000}'],
    ['class', 'Apply a style class to nodes', 'class ${1:nodeId} ${2:name}'],
    ['style', 'Style one node', 'style ${1:nodeId} fill:${2:#f9f},stroke:${3:#333}'],
    ['linkStyle', 'Style a link by its number', 'linkStyle ${1:0} stroke:${2:#f66},stroke-width:${3:2px}'],
    ['-->', 'Arrow'], ['---', 'Line'], ['-.->', 'Dotted arrow'], ['==>', 'Thick arrow'], ['--o', 'Circle end'], ['--x', 'Cross end'], ['<-->', 'Arrow both ways'],
    ['-- text -->', 'Arrow with a label', '-- ${1:text} -->'],
    ['-->|text|', 'Arrow with a label', '-->|${1:text}|'],
  ],
  sequence: [
    ['participant', 'A participant box', 'participant ${1:A} as ${2:Name}'],
    ['actor', 'A participant drawn as a person', 'actor ${1:U} as ${2:User}'],
    ['autonumber', 'Number the messages'],
    ['activate', 'Start an activation bar', 'activate ${1:A}'],
    ['deactivate', 'End an activation bar', 'deactivate ${1:A}'],
    ['Note right of', 'A note', 'Note right of ${1:A}: ${2:text}'],
    ['Note left of', 'A note', 'Note left of ${1:A}: ${2:text}'],
    ['Note over', 'A note over one or two participants', 'Note over ${1:A},${2:B}: ${3:text}'],
    ['loop', 'Repeat; close with end', 'loop ${1:Every minute}\n  $0\nend'],
    ['alt', 'If / else; close with end', 'alt ${1:success}\n  $2\nelse ${3:failure}\n  $0\nend'],
    ['else', 'Other branch of alt'],
    ['opt', 'Optional part; close with end', 'opt ${1:condition}\n  $0\nend'],
    ['par', 'Parallel parts; close with end', 'par ${1:first}\n  $2\nand ${3:second}\n  $0\nend'],
    ['and', 'Next parallel part'],
    ['critical', 'Critical region; close with end', 'critical ${1:Connect}\n  $0\nend'],
    ['break', 'Stop the flow; close with end', 'break ${1:when}\n  $0\nend'],
    ['rect', 'Highlight a part; close with end', 'rect ${1:rgb(200, 220, 255)}\n  $0\nend'],
    ['box', 'Group participants; close with end', 'box ${1:Group}\n  participant ${2:A}\nend'],
    ['end', 'Close a block'],
    ['->>', 'Message, solid line'], ['-->>', 'Reply, dotted line'], ['->', 'Solid line, no arrow'], ['-->', 'Dotted line, no arrow'],
    ['-x', 'Message with a cross'], ['-)', 'Async message'],
  ],
  class: [
    ['class', 'A class with members', 'class ${1:Name} {\n  +${2:field}\n  +${3:method}()\n}'],
    ['namespace', 'Group classes', 'namespace ${1:Name} {\n  class ${2:A}\n}'],
    ['note', 'A note', 'note "${1:text}"'],
    ['note for', 'A note on a class', 'note for ${1:Name} "${2:text}"'],
    ['direction', 'Layout direction', 'direction ${1|TB,LR,BT,RL|}'],
    ['<<interface>>', 'Annotation'], ['<<abstract>>', 'Annotation'], ['<<enumeration>>', 'Annotation'], ['<<service>>', 'Annotation'],
    ['<|--', 'Inheritance'], ['*--', 'Composition'], ['o--', 'Aggregation'], ['-->', 'Association'], ['..>', 'Dependency'], ['..|>', 'Realization'], ['--', 'Link'],
  ],
  state: [
    ['[*]', 'Start or end'],
    ['state', 'A composite state', 'state ${1:Name} {\n  [*] --> ${2:Inner}\n}'],
    ['note right of', 'A note', 'note right of ${1:State} : ${2:text}'],
    ['note left of', 'A note', 'note left of ${1:State} : ${2:text}'],
    ['direction', 'Layout direction', 'direction ${1|TB,LR,BT,RL|}'],
    ['<<fork>>', 'Fork', 'state ${1:fork1} <<fork>>'], ['<<join>>', 'Join', 'state ${1:join1} <<join>>'], ['<<choice>>', 'Choice', 'state ${1:if1} <<choice>>'],
    ['-->', 'Transition'], ['--', 'Concurrent regions'],
  ],
  er: [
    ['||--o{', 'One to zero or more'], ['||--|{', 'One to one or more'], ['}o--o{', 'Many to many'], ['|o--||', 'Zero or one to one'], ['||--||', 'One to one'],
    ['entity', 'An entity with attributes', '${1:ENTITY} {\n  ${2:int} ${3:id} PK\n  ${4:string} ${5:name}\n}'],
    ['PK', 'Primary key'], ['FK', 'Foreign key'], ['UK', 'Unique key'],
  ],
  gantt: [
    ['title', 'Chart title', 'title ${1:Title}'],
    ['dateFormat', 'Input date format', 'dateFormat ${1:YYYY-MM-DD}'],
    ['axisFormat', 'Axis date format', 'axisFormat ${1:%d %b}'],
    ['tickInterval', 'Axis tick', 'tickInterval ${1:1week}'],
    ['excludes', 'Days to skip', 'excludes ${1:weekends}'],
    ['todayMarker', 'Today line', 'todayMarker ${1:off}'],
    ['section', 'A group of tasks', 'section ${1:Name}'],
    ['task', 'A task', '${1:Task} :${2:t1}, ${3:2026-01-01}, ${4:3d}'],
    ['done', 'Task tag'], ['active', 'Task tag'], ['crit', 'Task tag'], ['milestone', 'Task tag'], ['after', 'Start after another task', 'after ${1:t1}'],
  ],
  pie: [['title', 'Chart title', 'title ${1:Title}'], ['showData', 'Show the values'], ['slice', 'A slice', '"${1:Label}" : ${2:10}']],
  mindmap: [['root', 'The center node', 'root((${1:Topic}))'], ['::icon()', 'Icon class', '::icon(${1:fa fa-book})']],
  timeline: [['title', 'Title', 'title ${1:Title}'], ['section', 'A period group', 'section ${1:Name}'], ['event', 'A period and its events', '${1:2026} : ${2:Event}']],
  gitGraph: [
    ['commit', 'A commit', 'commit id: "${1:message}"'], ['branch', 'New branch', 'branch ${1:feature}'], ['checkout', 'Switch branch', 'checkout ${1:main}'],
    ['merge', 'Merge a branch', 'merge ${1:feature}'], ['cherry-pick', 'Cherry-pick a commit', 'cherry-pick id: "${1:id}"'],
    ['id:', 'Commit id'], ['tag:', 'Commit tag', 'tag: "${1:v1.0}"'], ['type:', 'Commit type', 'type: ${1|NORMAL,REVERSE,HIGHLIGHT|}'],
  ],
  c4: [
    ['title', 'Title', 'title ${1:Title}'],
    ['Person', 'A person', 'Person(${1:id}, "${2:Name}", "${3:Description}")'], ['Person_Ext', 'An outside person', 'Person_Ext(${1:id}, "${2:Name}", "${3:Description}")'],
    ['System', 'A system', 'System(${1:id}, "${2:Name}", "${3:Description}")'], ['System_Ext', 'An outside system', 'System_Ext(${1:id}, "${2:Name}", "${3:Description}")'],
    ['SystemDb', 'A database system', 'SystemDb(${1:id}, "${2:Name}", "${3:Description}")'],
    ['Container', 'A container', 'Container(${1:id}, "${2:Name}", "${3:Technology}", "${4:Description}")'],
    ['ContainerDb', 'A database container', 'ContainerDb(${1:id}, "${2:Name}", "${3:Technology}", "${4:Description}")'],
    ['Component', 'A component', 'Component(${1:id}, "${2:Name}", "${3:Technology}", "${4:Description}")'],
    ['Rel', 'A relation', 'Rel(${1:from}, ${2:to}, "${3:Uses}")'], ['BiRel', 'A two-way relation', 'BiRel(${1:a}, ${2:b}, "${3:Talks to}")'],
    ['Boundary', 'A boundary', 'Boundary(${1:id}, "${2:Name}") {\n  $0\n}'], ['System_Boundary', 'A system boundary', 'System_Boundary(${1:id}, "${2:Name}") {\n  $0\n}'],
  ],
  sankey: [['row', 'source,target,value', '${1:Source},${2:Target},${3:10}']],
  xychart: [
    ['title', 'Chart title', 'title "${1:Title}"'], ['x-axis', 'Categories', 'x-axis [${1:a, b, c}]'], ['y-axis', 'Value range', 'y-axis "${1:Label}" ${2:0} --> ${3:100}'],
    ['bar', 'Bar series', 'bar [${1:1, 2, 3}]'], ['line', 'Line series', 'line [${1:1, 2, 3}]'], ['horizontal', 'Horizontal chart', 'xychart-beta horizontal'],
  ],
  block: [['columns', 'Number of columns', 'columns ${1:3}'], ['block', 'A nested block; close with end', 'block:${1:group}\n  $0\nend'], ['space', 'An empty cell', 'space:${1:1}'], ['end', 'Close a block'], ['-->', 'Arrow']],
  architecture: [
    ['group', 'A group', 'group ${1:id}(${2|cloud,server,database,disk,internet|})[${3:Name}]'],
    ['service', 'A service', 'service ${1:id}(${2|server,database,disk,internet,cloud|})[${3:Name}]'],
    ['junction', 'A junction', 'junction ${1:id}'], ['in', 'Put a service in a group', 'in ${1:group}'],
    ['edge', 'An edge between sides', '${1:a}:${2|L,R,T,B|} --> ${3|L,R,T,B|}:${4:b}'],
  ],
  journey: [['title', 'Title', 'title ${1:Title}'], ['section', 'A stage', 'section ${1:Name}'], ['task', 'A task with a score', '${1:Task}: ${2:5}: ${3:Me}']],
  quadrantChart: [
    ['title', 'Title', 'title ${1:Title}'], ['x-axis', 'X axis', 'x-axis ${1:Low} --> ${2:High}'], ['y-axis', 'Y axis', 'y-axis ${1:Low} --> ${2:High}'],
    ['quadrant-1', 'Top right label', 'quadrant-1 ${1:Name}'], ['quadrant-2', 'Top left label', 'quadrant-2 ${1:Name}'], ['quadrant-3', 'Bottom left label', 'quadrant-3 ${1:Name}'], ['quadrant-4', 'Bottom right label', 'quadrant-4 ${1:Name}'],
    ['point', 'A point', '${1:Item}: [${2:0.3}, ${3:0.6}]'],
  ],
  requirement: [
    ['requirement', 'A requirement', 'requirement ${1:name} {\n  id: ${2:1}\n  text: ${3:The system shall}\n  risk: ${4|low,medium,high|}\n  verifymethod: ${5|test,inspection,analysis,demonstration|}\n}'],
    ['element', 'An element', 'element ${1:name} {\n  type: ${2:module}\n}'],
    ['satisfies', 'Relation'], ['traces', 'Relation'], ['contains', 'Relation'], ['derives', 'Relation'], ['refines', 'Relation'], ['verifies', 'Relation'], ['copies', 'Relation'],
  ],
};

const COMMON = [
  ['%%', 'Comment line', '%% ${1:comment}'],
  ['%%{init}%%', 'Theme for this diagram', '%%{init: {"theme": "${1|default,dark,forest,neutral,base|}"}}%%'],
];

/** Map the first keyword of a diagram to a key of K. */
function family(type) {
  const t = String(type || '');
  if (/^(flowchart|graph)/i.test(t)) return 'flowchart';
  if (t === 'sequenceDiagram') return 'sequence';
  if (t === 'classDiagram' || t === 'classDiagram-v2') return 'class';
  if (/^stateDiagram/.test(t)) return 'state';
  if (t === 'erDiagram') return 'er';
  if (t === 'gantt') return 'gantt';
  if (t === 'pie') return 'pie';
  if (t === 'mindmap') return 'mindmap';
  if (t === 'timeline') return 'timeline';
  if (t === 'gitGraph') return 'gitGraph';
  if (/^C4/.test(t)) return 'c4';
  if (/^sankey/.test(t)) return 'sankey';
  if (/^xychart/.test(t)) return 'xychart';
  if (/^block/.test(t)) return 'block';
  if (/^architecture/.test(t)) return 'architecture';
  if (t === 'journey') return 'journey';
  if (t === 'quadrantChart') return 'quadrantChart';
  if (t === 'requirementDiagram') return 'requirement';
  return '';
}

const item = (kind, [label, detail, snippet]) => ({ label, kind, detail, insertText: snippet || label, snippet: !!snippet });

/**
 * Completion items for a cursor in Mermaid text. text: the whole diagram; line: 0-based cursor line.
 * Returns { stage: 'type' | 'body', family, items: [{ label, kind, detail, insertText, snippet }] }.
 * kind is 'type', 'template', 'keyword', 'arrow' or 'shape'.
 */
function completions(text, line) {
  const lines = String(text || '').split(/\r?\n/);
  const before = lines.slice(0, Math.max(0, line)).join('\n');
  const type = diagramType(before);
  if (!type) {
    const items = TYPES.map(t => item('type', t));
    for (const t of TEMPLATES) items.push({ label: `${t.keyword} (template)`, kind: 'template', detail: `${t.label}: ${t.detail}`, insertText: t.text.replace(/\$/g, '\\$').replace(/\n$/, ''), snippet: true });
    for (const c of COMMON) items.push(item('keyword', c));
    return { stage: 'type', family: '', items };
  }
  const fam = family(type);
  const items = [];
  for (const k of K[fam] || []) items.push(item(/^[-<>|.=*o}{x)(]/.test(k[0]) && !/^[a-z]/i.test(k[0]) ? 'arrow' : 'keyword', k));
  if (fam === 'flowchart') for (const s of FLOW_SHAPES) items.push({ label: s[0], kind: 'shape', detail: s[1], insertText: s[2], snippet: true });
  for (const c of COMMON) items.push(item('keyword', c));
  return { stage: 'body', family: fam, items };
}

module.exports = { completions, family, TYPES, K };
