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
// EXEC14: the shared module (buy path v2) writes the price, the other Pro tools, the count of Zovo extensions and
// "Everything that is free today stays free." under this detail, then [Get Zovo Pro, USD 19] [Pay with PayPal]
// [I already paid]. DETAIL is the one line about the tools.
const DETAIL = 'Opening, editing, previewing, the outline and exporting one diagram as PNG or SVG stay free.';
const TOOLS = { 'Export every diagram in the workspace': 'Writes every Mermaid diagram in the workspace as SVG or PNG files, in one run.',
  'Export to PDF with a title page': 'Writes all diagrams of this file into one PDF with a title page and a caption per diagram.',
  'Export on save': 'Keeps .svg and .png files next to the source up to date each time you save.' };

function createPro({ vscode, context, enabled = PRO_ENABLED, license, tries = FREE_TRIES }) {
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: 'Mermaid Viewer', proTools: Object.keys(TOOLS), commandPrefix: 'mermaidViewer' });
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

  async function commit(feature) {
    if (!enabled || isPro()) return;
    const n = await spend(feature);
    const left = Math.max(0, tries - n);
    vscode.window.setStatusBarMessage(`Mermaid Viewer: ${feature} is a Zovo Pro tool. Free try ${Math.min(n, tries)} of ${tries}${left ? ` (${left} left)` : ', the last one'}.`, 8000);
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
     * For a Pro tool the user started. True when it may run: Pro is unlocked, a free try is left, or the user
     * unlocked Pro in the panel. The panel shows only when no try is left. With spendNow (export on save, a switch)
     * the try is used here; otherwise call commit(feature) once the tool has written its output (EXEC14: Escape in a
     * picker or a dialog keeps the try).
     */
    async gate(feature, detail, spendNow = false) {
      if (!enabled) return true;
      await lic.ready;
      const text = { detail: [TOOLS[feature], detail || DETAIL].filter(Boolean).join(' ') };
      if (isPro()) return lic.requirePro(feature, text);
      if (used(feature) < tries) {
        if (spendNow) await commit(feature);
        return true;
      }
      return lic.requirePro(feature, Object.assign(text, { triesUsed: tries }));
    },
    /** One free try used, after the Pro tool wrote its output. Nothing when Pro is on. */
    commit,
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

module.exports = { createPro, PRO_ENABLED, SKU, FREE_TRIES, TRIES_KEY, TOOLS };
