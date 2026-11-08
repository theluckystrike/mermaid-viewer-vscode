# Third-party notices

Mermaid Viewer ships one third-party file: `media/mermaid.min.js`, the browser build of Mermaid 12.3.0 from npm (sha256 in `package.json` as `mermaidSha256`). Mermaid's license is in `media/mermaid-LICENSE.txt`.

Mermaid is MIT licensed, Copyright (c) 2014 - 2022 Knut Sveidqvist. Its browser build includes these packages:

| Package | License | Source |
|---|---|---|
| @mermaid-js/parser, langium | MIT | https://github.com/mermaid-js/mermaid, https://github.com/eclipse-langium/langium |
| @braintree/sanitize-url | MIT | https://github.com/braintree/sanitize-url |
| @iconify/utils | MIT | https://github.com/iconify/iconify |
| @upsetjs/venn.js | MIT | https://github.com/upsetjs/venn.js |
| chevrotain | Apache-2.0 | https://github.com/Chevrotain/chevrotain |
| cytoscape, cytoscape-cose-bilkent, cytoscape-fcose | MIT | https://github.com/cytoscape/cytoscape.js |
| d3 | ISC | https://github.com/d3/d3 |
| d3-sankey | BSD-3-Clause | https://github.com/d3/d3-sankey |
| dagre-d3-es | MIT | https://github.com/tbo47/dagre-es |
| dayjs | MIT | https://github.com/iamkun/dayjs |
| DOMPurify | MPL-2.0 or Apache-2.0 (used under Apache-2.0) | https://github.com/cure53/DOMPurify |
| elkjs | EPL-2.0 or GPL-3.0-or-later (used under EPL-2.0) | https://github.com/kieler/elkjs |
| es-toolkit | MIT | https://github.com/toss/es-toolkit |
| KaTeX | MIT | https://github.com/KaTeX/KaTeX |
| khroma | MIT | https://github.com/fabiospampinato/khroma |
| marked | MIT | https://github.com/markedjs/marked |
| roughjs | MIT | https://github.com/pshihn/rough |
| stylis | MIT | https://github.com/thysultan/stylis.js |
| ts-dedent | MIT | https://github.com/tamino-martinius/node-ts-dedent |

elkjs is included unchanged, as part of the Mermaid build. Its source code is available at https://github.com/kieler/elkjs under the Eclipse Public License 2.0.

The rest of Mermaid Viewer (the files in `src/`, `media/preview.js`, `media/preview.css`, `syntaxes/` and the icons) is MIT licensed, see `LICENSE`.
