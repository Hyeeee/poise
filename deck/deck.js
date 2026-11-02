// Poise case study deck. Uses the app's own living backdrop, dot orb and posture figure.
import { mountPainting } from '../painting.js';
import { mountAgents } from '../agent.js';
import { PostureAvatar } from '../avatar.js';

const stage = document.getElementById('stage');
const slides = [...stage.querySelectorAll('.slide')];
const dots = document.getElementById('dots'), count = document.getElementById('count');

// Scale the 1920×1080 stage to fit the window, centred.
const fit = () => {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s}) translate(-50%, -50%)`;
};
fit(); addEventListener('resize', fit);

// Stagger: each [data-in] element on a slide gets its own delay index.
slides.forEach(sl => sl.querySelectorAll('[data-in]').forEach((el, i) => el.style.setProperty('--i', i)));

// Navigation: arrows, space, page keys, click left or right half, #slide number in the URL.
let cur = 0;
slides.forEach((sl, i) => {
  const b = document.createElement('button');
  b.setAttribute('aria-label', `Slide ${i + 1}: ${sl.dataset.title}`);
  b.onclick = e => { e.stopPropagation(); go(i); };
  dots.append(b);
});
function go(i) {
  cur = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((sl, k) => sl.classList.toggle('open', k === cur));
  [...dots.children].forEach((b, k) => b.classList.toggle('on', k === cur));
  count.textContent = `${cur + 1} / ${slides.length}`;
  history.replaceState(null, '', '#' + (cur + 1));
}
addEventListener('keydown', e => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
});
addEventListener('click', e => { if (e.target.closest('a, button')) return; go(cur + (e.clientX > innerWidth / 3 ? 1 : -1)); });
const fromHash = () => go((parseInt(location.hash.slice(1), 10) || 1) - 1);
fromHash(); addEventListener('hashchange', fromHash);

// The app's living backdrop and the dot orbs.
mountPainting();
mountAgents(stage);

// Live figure: the real avatar, scripted to drift and come back, with the card colour following.
const host = document.getElementById('live-figure');
if (host) {
  const av = new PostureAvatar(host);
  av.setActive(true);
  const card = document.getElementById('live-card'), st = document.getElementById('live-state'), hint = document.getElementById('live-hint');
  const SCRIPT = [
    [0, null, 'Aligned', 'Close to your reference.', '#bfe6cc'],
    [3.5, { x: .05, y: .3, tilt: 0, roll: .04, sx: 0 }, 'Drifting', 'Your head is moving forward.', '#f3dc9c'],
    [7.5, { x: -.2, y: .2, tilt: .16, roll: .2, sx: -.1 }, 'Drifting', 'You are leaning to one side.', '#f2c08c'],
    [11, null, 'Aligned', 'Back in balance.', '#bfe6cc'],
  ];
  const LOOP = 14.5, t0 = performance.now();
  let last = -1;
  setInterval(() => {
    const t = ((performance.now() - t0) / 1000) % LOOP;
    let k = 0; for (let i = 0; i < SCRIPT.length; i++) if (t >= SCRIPT[i][0]) k = i;
    if (k === last) return; last = k;
    const [, d, s, h, c] = SCRIPT[k];
    av.set(d); st.textContent = s; hint.textContent = h; card.style.setProperty('--sig', c);
  }, 200);
}
