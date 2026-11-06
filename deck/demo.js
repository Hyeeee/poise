// Demo mode for the deck. Loaded in <head> of the app (both versions) as a classic script.
// Only when the URL has ?demo=<state> does it do anything:
//   - storage lives in memory, so the deck never touches your real Poise settings
//   - the camera is a blank canvas and MediaPipe is a stand-in that returns a steady seated pose
//   - no sound or voice
//   - a small script then clicks through the app until it reaches <state>, and holds it there
(function () {
  const q = new URLSearchParams(location.search), state = q.get('demo');
  if (!state) return;
  document.documentElement.classList.add('demo');

  // 1. Storage in memory
  const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
  try { Object.defineProperty(window, 'localStorage', { value: mem(), configurable: true }); Object.defineProperty(window, 'sessionStorage', { value: mem(), configurable: true }); } catch {}

  // 2. MediaPipe → stand-in module (import map must be in place before any module loads)
  const im = document.createElement('script'); im.type = 'importmap';
  im.textContent = JSON.stringify({ imports: { 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs': '/deck/mock-vision.js' } });
  document.currentScript.after(im);

  // 3. Camera → a blank canvas stream
  // A drawn office as the stand-in camera: a wall, a window, a shelf and a plant, and a person at the desk
  // drawn from the same pose the stand-in tracking reports (window.__P), so the figure and the lines move together.
  const fakeStream = () => {
    const W = 640, H = 360, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    const scene = () => {
      // wall and floor light
      let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#ece6dc'); gr.addColorStop(1, '#d9d1c4'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // window with daylight
      g.fillStyle = '#c9c0b2'; rr(38, 40, 170, 150, 6); g.fill();
      gr = g.createLinearGradient(0, 46, 0, 184); gr.addColorStop(0, '#dfeaf0'); gr.addColorStop(1, '#eef2ef'); g.fillStyle = gr; rr(46, 48, 154, 134, 3); g.fill();
      g.fillStyle = '#c9c0b2'; g.fillRect(121, 48, 4, 134); g.fillRect(46, 112, 154, 4);
      // shelf with books
      g.fillStyle = '#b9a58b'; g.fillRect(450, 92, 150, 7);
      [['#7d8f86', 18, 40], ['#c48f6a', 14, 34], ['#e2d6c2', 20, 42], ['#5f6f78', 12, 30], ['#d9b47a', 16, 38]].reduce((x, [col, w, h]) => { g.fillStyle = col; g.fillRect(x, 92 - h, w, h); return x + w + 3; }, 462);
      // plant
      g.fillStyle = '#b98b6a'; rr(560, 230, 44, 50, 6); g.fill();
      g.fillStyle = '#6f8f6a'; for (const [x, y, rx, ry, a] of [[572, 214, 12, 30, -.5], [592, 210, 12, 32, .4], [582, 200, 10, 34, 0]]) { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); g.fill(); }
    };
    const person = () => {
      const P = Object.assign({ lean: 0, shift: 0, fwd: 0, near: 1, away: 0 }, window.__P || {}); if (P.away) return;
      // same numbers as the stand-in tracking, in pixels
      const cx = (.5 + P.shift) * W, sy = .64 * H, hw = .085 * P.near * W, ly = P.lean * H;
      const hx = cx + P.lean * 1.4 * W, hy = (.64 - .24 * P.near + P.fwd * .07) * H, hr = .052 * W * P.near * (1 + P.fwd * .12);
      g.fillStyle = '#3e4a52';   // a dark top
      g.beginPath(); g.moveTo(cx - hw - 26, H); g.lineTo(cx - hw - 6, sy - ly + 14); g.quadraticCurveTo(cx - hw, sy - ly - 6, cx - hw * .4, sy - ly - 10);
      g.lineTo(cx + hw * .4, sy + ly - 10); g.quadraticCurveTo(cx + hw, sy + ly - 6, cx + hw + 6, sy + ly + 14); g.lineTo(cx + hw + 26, H); g.closePath(); g.fill();
      g.fillStyle = '#d8b9a0'; g.fillRect((cx + hx) / 2 - 9, hy + hr * .7, 18, sy - hy - hr * .7);   // neck
      g.beginPath(); g.ellipse(hx, hy, hr * .86, hr, P.lean * 2, 0, Math.PI * 2); g.fill();          // face
      g.fillStyle = '#2b2622'; g.beginPath(); g.ellipse(hx, hy - hr * .32, hr * .92, hr * .74, P.lean * 2, Math.PI, Math.PI * 2); g.fill();   // hair
    };
    const draw = () => { scene(); person(); };
    draw(); setInterval(draw, 66);
    return c.captureStream(15);
  };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => fakeStream();

  // 4. Silence
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  if ('speechSynthesis' in window) { speechSynthesis.speak = u => setTimeout(() => { u.onstart?.(); u.onend?.(); }, 10); }
  // a sound engine that accepts every call and does nothing
  const noop = new Proxy(function () {}, { get: (_, k) => ['resume', 'suspend', 'close'].includes(k) ? () => Promise.resolve() : k === 'currentTime' ? 0 : k === 'state' ? 'suspended' : k === 'value' ? 0 : k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : noop, apply: () => noop, construct: () => noop, set: () => true });
  window.AudioContext = window.webkitAudioContext = noop;

  // 5. No painted backdrop unless asked (keeps the number of WebGL contexts down in the deck)
  if (q.get('paint') !== '1') {
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, o) { if ((t === 'webgl' || t === 'webgl2') && this.classList.contains('paint-live')) return null; return gc.call(this, t, o); };
  }

  // 6. Fast forward: while the route runs, the app's timers run 6x faster
  let fast = 6; const st = window.setTimeout;
  window.setTimeout = (f, ms = 0, ...a) => st(f, Math.max(0, ms / fast), ...a);
  const realWait = ms => new Promise(r => st(r, ms / fast));

  // 7. The route to each state
  const $ = s => document.querySelector(s);
  const vis = s => { const e = $(s); return !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'; };
  const wait = ms => realWait(ms);
  const until = async (s, ms = 15000) => { const t = performance.now() + ms; while (performance.now() < t) { if (vis(s)) return true; await wait(150); } return false; };
  const click = async s => { if (await until(s, 8000)) $(s).click(); await wait(400); };
  const pose = P => { window.__P = P; };
  const nextSetup = async () => { await wait(1200); const b = [...document.querySelectorAll('.setup .choice.next, .setup .opt-card, .setup .choice')].find(e => e.offsetParent !== null); b?.click(); await wait(1500); };
  const setup = async n => { await click('#start'); await until('.setup .choice, .setup .opt-card', 20000); for (let i = 0; i < n; i++) { await until('.setup .choice, .setup .opt-card', 20000); await nextSetup(); } };
  const skipTours = async () => { for (let i = 0; i < 20; i++) { if (vis('#tour-skip')) { $('#tour-skip').click(); await wait(500); } else if (vis('#tour-next')) { $('#tour-next').click(); await wait(400); } else break; } };
  const intoWork = async () => { await click('#preview'); await wait(1500); for (const s of ['#cam-notice-ok', '#empty-camera .primary', '#enable']) if (vis(s)) { $(s).click(); await wait(1500); } await until('#bar-skip, #ref-set', 6000); if (vis('#bar-skip')) { $('#bar-skip').click(); await wait(1200); } };
  const setRef = async () => { if (await until('#ref-set', 8000)) { $('#ref-set').click(); await wait(1500); } await skipTours(); };
  const toBreak = async style => { await intoWork(); await setRef(); await click('#break'); await wait(1200); await skipTours(); if (style) { $(`#break-switch [data-style=${style}]`)?.click(); await wait(1500); await skipTours(); } };
  const keepBubble = () => setInterval(() => { const b = $('.say-bubble'); if (b && !b.classList.contains('show')) b.classList.add('show'); }, 150);   // the bubble stays up
  const realtime = ms => new Promise(r => st(r, ms));   // unaffected by the fast forward

  const ROUTES = {
    welcome: async () => {},
    voice: async () => { await setup(0); },
    q1: async () => { await setup(1); },
    q2: async () => { await setup(2); },
    q3: async () => { await setup(3); },
    summary: async () => { await setup(0); for (let i = 0; i < 16 && !vis('#setup-save'); i++) { await nextSetup(); await wait(600); } },
    camera: async () => { await setup(0); for (let i = 0; i < 16 && !vis('#setup-save'); i++) { await nextSetup(); await wait(600); } $('#setup-save')?.click(); await wait(2500); },
    bar: async () => { await ROUTES.camera(); for (const s of ['#cam-notice-ok', '#empty-camera .primary']) if (vis(s)) { $(s).click(); await wait(2500); } },
    ref: async () => { await intoWork(); await until('#ref-prompt', 6000); },
    tour: async () => { await intoWork(); await setRef0(); },
    aligned: async () => { pose({}); await intoWork(); await setRef(); pose({}); },
    drifting: async () => { pose({}); await intoWork(); await setRef(); await realtime(1500); pose({ fwd: 1 }); await realtime(11000); },
    bubble: async () => { pose({}); await intoWork(); await setRef(); await wait(500); $('#calibrate')?.click(); keepBubble(); },
    stretch: async () => { pose({}); await toBreak('stretch'); },
    breathe: async () => { pose({}); await toBreak('breathe'); },
    game: async () => { pose({}); await toBreak('game'); },
    report: async () => { pose({}); await intoWork(); await setRef(); await realtime(8000); pose({ fwd: 1 }); await realtime(14000); pose({}); await realtime(6000); await click('#end-session'); },
  };
  // v1 tour: stop on step 7 of 12 instead of skipping it
  const setRef0 = async () => { if (await until('#ref-set', 8000)) { $('#ref-set').click(); await wait(1500); } await until('#tour-next', 6000); for (let i = 0; i < 6 && vis('#tour-next'); i++) { $('#tour-next').click(); await wait(500); } };

  addEventListener('load', async () => {
    await wait(600);
    try { await (ROUTES[state] || ROUTES.welcome)(); } catch (e) { console.warn('demo route', e); }
    fast = 1;
    document.documentElement.classList.add('demo-ready');
    parent.postMessage({ demoReady: state }, '*');
  });
})();
