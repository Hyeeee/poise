// Poise case study. Uses the app's own living backdrop, dot orb and posture figure.
import { mountPainting } from '../painting.js';
import { mountAgents } from '../agent.js';
import { PostureAvatar } from '../avatar.js';

const deck = document.getElementById('deck');
const slides = [...deck.querySelectorAll('.slide')];
const progress = document.getElementById('progress');
const pad = n => String(n).padStart(2, '0');
document.getElementById('page-all').textContent = pad(slides.length);

// Stagger: each [data-in] element on a slide gets its own delay index; the 11 survey dots pop in one by one.
slides.forEach(sl => sl.querySelectorAll('[data-in]').forEach((el, i) => el.style.setProperty('--i', i)));
document.querySelectorAll('.dots-11 i').forEach((d, i) => d.style.setProperty('--d', i));

// Going to a slide: the old one lifts away, the new one rises in. The white sheet rises over the
// colour when you move onto a content slide and drops away on the cover and chapter slides.
let cur = -1, leaveTimer = 0, sheetTimer = 0;
function go(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur) return;
  const prev = slides[cur], next = slides[i];
  document.body.classList.toggle('back', i < cur);
  const sheetMoves = !!prev && prev.classList.contains('paper') !== next.classList.contains('paper');
  document.body.classList.toggle('sheet-moving', sheetMoves);
  clearTimeout(sheetTimer); sheetTimer = setTimeout(() => document.body.classList.remove('sheet-moving'), 1400);
  slides.forEach(s => s.classList.remove('leaving'));
  if (prev) { prev.classList.remove('open'); prev.classList.add('leaving'); clearTimeout(leaveTimer); leaveTimer = setTimeout(() => prev.classList.remove('leaving'), 700); }
  next.classList.add('open');
  cur = i;
  document.body.classList.toggle('paper', next.classList.contains('paper'));
  document.body.classList.toggle('on-cover', i === 0);
  document.getElementById('page-now').textContent = pad(i + 1);
  progress.style.width = ((i + 1) / slides.length * 100) + '%';
  history.replaceState(null, '', '#' + (i + 1));
}

// Round arrows, keys, clicks (right two thirds forward, left third back), wheel, and #number in the URL.
document.getElementById('prev').onclick = e => { e.stopPropagation(); go(cur - 1); };
document.getElementById('next').onclick = e => { e.stopPropagation(); go(cur + 1); };
addEventListener('keydown', e => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
});
const scrolling = () => getComputedStyle(document.body).overflowY === 'auto';   // narrow screens scroll instead
addEventListener('click', e => { if (scrolling() || e.target.closest('a, button')) return; go(cur + (e.clientX > innerWidth / 3 ? 1 : -1)); });
let wheelLock = 0;
addEventListener('wheel', e => { if (scrolling() || Math.abs(e.deltaY) < 30 || performance.now() < wheelLock) return; wheelLock = performance.now() + 900; go(cur + Math.sign(e.deltaY)); }, { passive: true });
const fromHash = () => go((parseInt(location.hash.slice(1), 10) || 1) - 1);
fromHash(); addEventListener('hashchange', fromHash);

// The app's living backdrop and the dot orbs (the big ones and the small logo marks).
mountPainting();
mountAgents(document);

// Live figure: the real avatar, scripted to drift and come back, with the card colour following.
const host = document.getElementById('live-figure');
if (host) {
  const av = new PostureAvatar(host);
  av.setActive(true);
  const card = document.getElementById('live-card'), st = document.getElementById('live-state'), hint = document.getElementById('live-hint');
  const SCRIPT = [
    [0, null, 'Aligned', 'Close to your reference.', '#cfeedb'],
    [3.5, { x: .05, y: .3, tilt: 0, roll: .04, sx: 0 }, 'Leaning forward', 'Your head is moving toward the screen.', '#f5e1a6'],
    [7.5, { x: -.2, y: .2, tilt: .16, roll: .2, sx: -.1 }, 'Tilting to one side', 'One shoulder has dropped.', '#f6caa0'],
    [11, null, 'Back in balance', 'You are on your outline again.', '#cfeedb'],
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
