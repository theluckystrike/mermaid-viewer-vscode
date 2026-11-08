# Theme, background and limits

- Theme: `auto` follows VS Code (the dark Mermaid theme in dark editor themes). You can also pick default, dark, forest, neutral or base. A theme set inside the diagram wins.
- Background: the toolbar choice is kept for each workspace.
- Limits: `mermaidViewer.maxTextSize` (500,000 characters) and `mermaidViewer.maxEdges` (2,000 links) keep very big files from stalling the preview. `mermaidViewer.renderTimeoutSeconds` (10 s) stops a diagram that takes too long and says so.

Mermaid runs with its strict security level. A `%%{init}%%` line in a file cannot change that, so a diagram from someone else cannot run script or open links.
