# Changelog

## 0.3.1 (2026-11-10)

- "More free viewers" now starts with the Zovo extensions most related to this one. Picking one opens its Marketplace page, where you choose to install it.
- The README has a "Support Zovo" section with GitHub Sponsors and the developer's GitHub profile, and "More tools by Zovo" lists related extensions.
- The walkthrough ends with a step that links free Zovo extensions for the files that often come with this one. A link opens the extension page; nothing installs on its own.
- The footer reads "Rate · More free viewers · Zovo Pro, USD 19 · PayPal · Hide". "Zovo Pro, USD 19" and the Marketplace Sponsor button open the Zovo Pro tier; "PayPal" opens the PayPal steps with the amount.
- Zovo Pro buy path: the Pro message names the other Pro tools in Mermaid Viewer and the number of Zovo extensions Pro covers, with 4 buttons: Get Zovo Pro (USD 19), Pay with PayPal, I already paid, Cancel. "I already paid" turns Pro on with GitHub Sponsors or a license key.
- Turn Zovo Pro on once per computer: the other Zovo extensions you have pick it up from `~/.zovo/pro.json`, with no second sign-in or paste. After an unlock you get one offer to turn it on in your other Zovo tools; "Not now" is final.
- "Support the developer" lists Zovo Pro first. Every Pro link opens the USD 19 Zovo Pro tier on GitHub Sponsors, not the general Sponsors page.
- The 5 Zovo Pro commands share one "Zovo Pro" group in the Command Palette, with the same names in every Zovo extension.
- A free try of workspace export and PDF export is used only when the files are written. Escape in the format, folder or save dialog keeps it.
- Nothing that was free changed. No popup on open.

## 0.3.0 (2026-11-10)

- 0.2.0 was not published on its own. 0.3.0 contains all of 0.2.0 (the diagram editor, Markdown block editing, completion, templates and the export options below) plus the changes in this list.
- Optional Zovo Pro (USD 19 once, every Zovo extension): PDF export with a title page, Export All Diagrams in Workspace, and the new Export on Save. Each Pro tool has 3 free tries on a computer. Everything that was free in 0.1.x stays free: preview, zoom, PNG and SVG export of a diagram, Copy PNG and Copy SVG code.
- New: Export on Save (`mermaidViewer.exportOnSave`): saving a `.mmd` file writes `name.svg` and/or `name.png` next to it, and a Markdown file gets `name-1.svg`, `name-2.svg` and so on. Only changed diagrams are drawn again. When the free tries are used, saving still works and a small status bar item offers the unlock; there is no dialog on save.
- The "Mermaid Diagrams" outline in the Explorer is free.
- New setting `mermaidViewer.showProFeatures` hides the Pro tools and the license commands.
- Rating ask v2.2: a window that stays open all week counts a new session after 4 hours. In Cursor, Windsurf, VSCodium and other editors that install from Open VSX, "Rate it" and the footer Rate link open the Open VSX review page instead of the Marketplace.

## 0.2.0 (2026-11-09)

- Diagram editor: "Open Diagram Editor" puts the text on the left and the live diagram on the right. The preview draws again 100 ms after you stop typing (was 300 ms). While a big diagram is still drawing, only the newest text is drawn after it.
- Markdown: "Edit diagram" above each mermaid block opens the block next to a live preview. Saving writes it back into the Markdown file with a normal edit, so Undo in the Markdown file takes it back. "Preview" shows one block with zoom and export.
- Completion for diagram types, keywords, arrows and node shapes, in .mmd files and inside mermaid blocks.
- "New Diagram from Template" with 15 diagram types; in Markdown it inserts a mermaid block at the cursor.
- Export: Width and Height now give an exact PNG size (one of them keeps the shape, both fit a box). "Text labels for wikis" writes SVG labels as plain text for Azure DevOps and GitHub wikis. Smaller SVG files: unused CSS removed, coordinates rounded. "Save PDF" puts every diagram of a file in one PDF with a title page (Zovo Pro from 0.3.0).
- Fix: PNG export and Copy PNG of diagrams with HTML labels (most flowcharts, class and state diagrams) failed with "Tainted canvases may not be exported" in current VS Code. Images now use plain text labels for those diagrams.
- "Export All Diagrams in Workspace" writes every diagram to SVG and/or PNG (Zovo Pro from 0.3.0).
- "Mermaid Diagrams" view in the Explorer lists the diagrams of the open file.
- Trackpad: with the new default `mermaidViewer.wheel` = `auto`, two fingers pan and a pinch zooms; a mouse wheel still zooms.
- New settings: `codeLens`, `saveMarkdownOnBlockSave`, `svgTextLabels`, `exportFolder`.
- Rating ask v2.1 (2 files in 2 sessions at least 4 hours apart). The footer and "More free viewers" now start with Rate and with the Zovo extensions most related to this one.
- The listing name is now "Mermaid Diagram Viewer & Mermaid Editor, Live Mermaid Preview (MMD, PNG/SVG, Offline)": "Mermaid Diagram Viewer" (the phrase this listing ranks #1 on) stays first and together, and "Mermaid Editor" and "Live Mermaid Preview" are added. Commands, settings and the extension id are unchanged.

## 0.1.1 (2026-11-08)

- Listing name and short description only: "Mermaid Diagram Viewer & Mermaid Preview (MMD, Offline)". No code change.

## 0.1.0

- First release. Live preview of Mermaid diagrams in `.mmd` and `.mermaid` files and in Markdown `mermaid` blocks, with Mermaid 12.3.0 bundled.
- Zoom at the pointer, drag to pan, Fit and 100%.
- Markdown files: every block in one list, each with its own error and export buttons.
- Export SVG, PNG at 1x, 2x or 4x with an optional largest width or height, Copy PNG and Copy SVG code.
- Background: editor color, white, transparent or custom, kept per workspace. Mermaid theme picker, or follow VS Code.
- Errors show the line, and the last good diagram stays on screen.
- No sign-in, no AI, no telemetry, no network. Strict Mermaid security level that `%%{init}%%` cannot change.
