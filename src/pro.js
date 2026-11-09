'use strict';
// Zovo Pro switch for Mermaid Viewer. PRO_ENABLED is false in this release: every feature is free and no Pro
// prompt, label or command shows. When the owner turns it on, the Pro features (batch export of the whole
// workspace, PDF export with a title page, the diagram outline) ask once, at the moment the user starts one,
// through the shared Zovo license module (src/license: GitHub Sponsors or an offline Ed25519 key). Opening,
// viewing, editing, single exports and everything that was free in 0.1.x never ask.
const { createLicense } = require('./license');

const PRO_ENABLED = false;
const SKU = 'mermaid-pro';

function createPro({ vscode, context, enabled = PRO_ENABLED, license }) {
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', commandPrefix: 'mermaidViewer' });
  vscode.commands.executeCommand('setContext', 'mermaidViewer.proEnabled', !!enabled);
  if (enabled && vscode.window.registerUriHandler) {
    context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: (uri) => lic.handleUri(uri) }));
  }
  const listeners = new Set();
  lic.onDidChange(() => { for (const fn of listeners) { try { fn(); } catch { /* listener error */ } } });
  return {
    enabled: !!enabled,
    license: lic,
    /** Sync: may the user run Pro features right now? Always true while the switch is off. */
    has() { return !enabled || lic.isPro(SKU); },
    /** For a Pro action the user started. True when it may run. */
    async gate(feature, detail) {
      if (!enabled) return true;
      await lic.ready;
      return lic.requirePro(feature, detail || 'Zovo Pro is USD 15 once and unlocks the Pro features in every Zovo viewer. Opening, editing, previewing and exporting one diagram stay free.');
    },
    onDidChange(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
  };
}

module.exports = { createPro, PRO_ENABLED, SKU };
