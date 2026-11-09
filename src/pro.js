'use strict';
// Zovo Pro for Mermaid Viewer (0.3.0). Pro tools: export every diagram in the workspace, PDF export with a title
// page, and export on save (keeps .svg / .png files next to the source up to date). Each Pro tool can be used 3 times
// for free on this computer. After that, starting the tool shows one explanation with the unlock ways (GitHub Sponsors
// or an offline license key, both from the shared module in src/license). Nothing about Pro shows when a file opens.
// Opening, viewing, editing, the outline, single-diagram PNG/SVG export and copy stay free, as in 0.1.x and 0.2.0.
//
// mermaidViewer.showProFeatures = false hides the Pro commands, menu items and the Get Pro commands, unless a
// license is active (context key mermaidViewer.proLicensed).
const { createLicense } = require('./license');

const PRO_ENABLED = true;
const SKU = 'mermaid-pro';
const FREE_TRIES = 3;
const TRIES_KEY = 'mermaidViewer.proTries';
const DETAIL = 'Zovo Pro is USD 19 once (the "$19 one time" tier on GitHub Sponsors, or PayPal for a license key) and unlocks the Pro tools in every Zovo extension. Opening, editing, previewing, the outline and exporting one diagram as PNG or SVG stay free.';

function createPro({ vscode, context, enabled = PRO_ENABLED, license, tries = FREE_TRIES }) {
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', commandPrefix: 'mermaidViewer' });
  const showSetting = () => vscode.workspace.getConfiguration('mermaidViewer').get('showProFeatures', true) !== false;
  const isPro = () => { try { return !!lic.isPro(SKU); } catch { return false; } };
  function publish() {
    vscode.commands.executeCommand('setContext', 'mermaidViewer.proEnabled', !!enabled);
    vscode.commands.executeCommand('setContext', 'mermaidViewer.proLicensed', !!enabled && isPro());
    vscode.commands.executeCommand('setContext', 'mermaidViewer.proVisible', !enabled || isPro() || showSetting());
  }
  publish();
  if (enabled && vscode.window.registerUriHandler) {
    context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: (uri) => lic.handleUri(uri) }));
  }
  if (vscode.workspace.onDidChangeConfiguration) {
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('mermaidViewer.showProFeatures')) publish(); }));
  }
  Promise.resolve(lic.ready).then(publish, () => {});
  const listeners = new Set();
  lic.onDidChange(() => { publish(); for (const fn of listeners) { try { fn(); } catch { /* listener error */ } } });

  const used = (feature) => { const t = context.globalState.get(TRIES_KEY, {}); return Number((t && t[feature]) || 0); };
  async function spend(feature) {
    const t = Object.assign({}, context.globalState.get(TRIES_KEY, {}));
    t[feature] = Number(t[feature] || 0) + 1;
    await context.globalState.update(TRIES_KEY, t);
    return t[feature];
  }

  return {
    enabled: !!enabled,
    license: lic,
    FREE_TRIES: tries,
    /** Sync: is Pro unlocked (or switched off, which makes every tool free)? */
    has() { return !enabled || isPro(); },
    /** Free tries left for a Pro tool on this computer. */
    triesLeft(feature) { return Math.max(0, tries - used(feature)); },
    /**
     * For a Pro tool the user started. True when it may run: Pro is unlocked, a free try is left (it is used up
     * here), or the user unlocked Pro in the dialog. The dialog shows only when no try is left. Escape uses nothing.
     */
    async gate(feature, detail) {
      if (!enabled) return true;
      await lic.ready;
      if (isPro()) return lic.requirePro(feature, detail || DETAIL);
      if (used(feature) < tries) {
        const n = await spend(feature);
        const left = tries - n;
        vscode.window.setStatusBarMessage(`Mermaid Viewer: ${feature} is a Zovo Pro tool. Free try ${n} of ${tries}${left ? ` (${left} left)` : ', the last one'}.`, 8000);
        return true;
      }
      return lic.requirePro(feature, `You used your ${tries} free tries. ${detail || DETAIL}`);
    },
    /** Like gate, but never opens a dialog: for work that runs on its own (export on save). */
    async quietGate(feature) {
      if (!enabled) return true;
      await lic.ready;
      if (isPro()) return true;
      if (used(feature) < tries) { await spend(feature); return true; }
      return false;
    },
    onDidChange(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
  };
}

module.exports = { createPro, PRO_ENABLED, SKU, FREE_TRIES, TRIES_KEY };
