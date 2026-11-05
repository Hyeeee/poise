// Loaded first in an app when it runs inside the deck as a live demo.
// Only does something when the page sits inside a frame:
//   - settings live in memory, so every demo starts fresh from onboarding and never touches your real Poise settings
//   - arrow and page keys go up to the deck, so you can still change slides after clicking in the app
// The real camera, voice and light bar all work as normal.
(function () {
  if (window.parent === window) return;
  const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
  try { Object.defineProperty(window, 'localStorage', { value: mem(), configurable: true }); Object.defineProperty(window, 'sessionStorage', { value: mem(), configurable: true }); } catch {}
  const KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'];
  addEventListener('keydown', e => {
    if (!KEYS.includes(e.key) || e.target.closest?.('input, textarea, [contenteditable]')) return;
    e.preventDefault(); window.parent.dispatchEvent(new KeyboardEvent('keydown', { key: e.key }));
  }, true);
})();
