// Loaded first in an app when it runs inside the deck as a live demo.
// Only does something when the page sits inside a frame:
//   - settings live in memory, so every demo starts fresh from onboarding and never touches your real Poise settings
//   - arrow and page keys go up to the deck, so you can still change slides after clicking in the app
// The real camera, voice and light bar all work as normal.
(function () {
  if (window.parent === window) return;
  window.__bridge = true;
  const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
  try { Object.defineProperty(window, 'localStorage', { value: mem(), configurable: true }); Object.defineProperty(window, 'sessionStorage', { value: mem(), configurable: true }); } catch {}
  // In the deck the app is shown, not navigated with a keyboard, so the keyboard focus ring is hidden.
  // Also: every :hover rule gets a twin for .__hover, so a scripted pointer can show the same hover.
  const css = document.createElement('style'); css.textContent = ':focus-visible { outline: none !important; }';
  document.documentElement.append(css);
  addEventListener('load', () => {
    const extra = [];
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
      const walk = list => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && r.selectorText.includes(':hover')) extra.push(r.cssText.replace(/:hover/g, '.__hover')); } };
      walk(rules); }
    const h = document.createElement('style'); h.textContent = extra.join('\n'); document.head.append(h);
  });
  const KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  addEventListener('keydown', e => {
    if (!KEYS.includes(e.key) || e.target.closest?.('textarea, [contenteditable], input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button])')) return;
    e.preventDefault(); window.parent.dispatchEvent(new KeyboardEvent('keydown', { key: e.key }));
  }, true);
})();
