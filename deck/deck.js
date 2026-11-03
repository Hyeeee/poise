// Poise case study. Uses the app's own living backdrop, dot orb and posture figure.
import { mountPainting } from '../painting.js';
import { mountAgents } from '../agent.js';
import { PostureAvatar } from '../avatar.js';

// In the deck the figure is drawn smaller and higher than in the app, so the head, arms and
// hands always stay inside the card (the app lets the body run off the bottom edge on purpose).
class DeckAvatar extends PostureAvatar {
  draw() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.render(this.ctx, this.w, this.h * .93, { fit: [250, 240] });
  }
}

const deck = document.getElementById('deck');
const slides = [...deck.querySelectorAll('.slide')];
const progress = document.getElementById('progress');
// The parts of the deck, in order, and how many slides each has (cover and contents come first).
const PARTS = [['Intro', 2], ['The problem', 2], ['UX research', 3], ['Version one', 4], ['Iteration', 1], ['Version two', 6], ['What I learned', 3]];
let at = 0;
const segs = PARTS.map(([name, n]) => {
  const start = at; at += n;
  const el = document.createElement('button');
  el.className = 'seg'; el.style.flexGrow = n;
  el.innerHTML = `<i><b></b></i><span>${name}</span>`;
  el.onclick = e => { e.stopPropagation(); go(start); };
  progress.append(el);
  return { el, start, n };
});
const pad = n => String(n).padStart(2, '0');

// Stagger: each [data-in] element on a slide gets its own delay index; the 11 survey dots pop in one by one.
slides.forEach(sl => sl.querySelectorAll('[data-in]').forEach((el, i) => el.style.setProperty('--i', i)));
document.querySelectorAll('.dots-11 i').forEach((d, i) => d.style.setProperty('--d', i));

// Going to a slide: the old one lifts away, the new one rises in. The white sheet rises over the
// colour when you move onto a content slide and drops away on the cover and chapter slides.
let cur = -1, leaveTimer = 0, sheetTimer = 0;
// ---------- Steps inside a slide ----------
// A slide with data-steps="N" builds in N presses. [data-step="k"] shows from step k on,
// [data-only="k"] shows only at step k, [data-only-from="k"] from step k on.
const stepsOf = sl => +(sl?.dataset.steps || 0);
function setStep(sl, k) {
  sl.dataset.at = k;
  sl.querySelectorAll('[data-step]').forEach(e => e.classList.toggle('shown', +e.dataset.step <= k));
  sl.querySelectorAll('[data-only]').forEach(e => e.classList.toggle('shown', +e.dataset.only === k));
  sl.querySelectorAll('[data-only-from]').forEach(e => e.classList.toggle('shown', +e.dataset.onlyFrom <= k));
  sl.querySelectorAll('[data-mark]').forEach(e => { e.classList.toggle('done', +e.dataset.mark < k); e.classList.toggle('now', +e.dataset.mark === k); });
  sl.dispatchEvent(new CustomEvent('step', { detail: k }));
}
// Forward: next step if the slide has one left, else the next slide (from its first step).
// Back: previous step, else the previous slide at its last step.
function next() { const sl = slides[cur], k = +(sl.dataset.at || 0); if (k < stepsOf(sl)) setStep(sl, k + 1); else go(cur + 1); }
function prev() { const sl = slides[cur], k = +(sl.dataset.at || 0); if (k > 0) setStep(sl, k - 1); else { go(cur - 1, true); } }

function go(i, atEnd = false) {
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
  setStep(next, atEnd ? stepsOf(next) : 0);
  cur = i;
  document.body.classList.toggle('paper', next.classList.contains('paper'));
  document.body.classList.toggle('on-cover', i === 0);
  document.body.classList.toggle('on-end', i === slides.length - 1);   // no progress on the thank you slide
  // each part fills by how far you are into it; the current part's name is darker
  segs.forEach(({ el, start, n }) => {
    const k = Math.max(0, Math.min(1, (i - start + 1) / n));
    el.querySelector('b').style.width = (k * 100) + '%';
    el.classList.toggle('now', i >= start && i < start + n);
  });
  history.replaceState(null, '', '#' + (i + 1));
}

// Keys, clicks (right two thirds forward, left third back), wheel, and #number in the URL.
addEventListener('keydown', e => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
});
const scrolling = () => getComputedStyle(document.body).overflowY === 'auto';   // narrow screens scroll instead
addEventListener('click', e => { if (scrolling() || e.target.closest('a, button')) return; (e.clientX > innerWidth / 3 ? next : prev)(); });
let wheelLock = 0;
addEventListener('wheel', e => { if (scrolling() || Math.abs(e.deltaY) < 30 || performance.now() < wheelLock) return; wheelLock = performance.now() + 900; (e.deltaY > 0 ? next : prev)(); }, { passive: true });
const fromHash = () => go((parseInt(location.hash.slice(1), 10) || 1) - 1);
fromHash(); addEventListener('hashchange', fromHash);

// The app's living backdrop and the dot orbs (the big ones and the small logo marks).
mountPainting();
mountAgents(document);

// Live figure: the real avatar, scripted to drift and come back, with the card colour following.
const host = document.getElementById('live-figure');
if (host) {
  const av = new DeckAvatar(host);
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

// Slide 3: the real figure, leaning off its outline
document.querySelectorAll('.live-avatar').forEach(el => {
  const av = new DeckAvatar(el); av.setActive(true);
  av.set({ x: -.22, y: .18, tilt: .17, roll: .22, sx: -.08 });
});

// ---------- The problem story: one figure that slumps over time, then hurts ----------
class StoryAvatar extends DeckAvatar {
  constructor(el) { super(el); this.pain = { neck: 0, back: 0, disc: 0 }; this.painGoal = { ...this.pain }; }
  draw() {
    const ctx = this.ctx, w = this.w, h = this.h * .86, fit = [250, 240];
    ctx.clearRect(0, 0, this.w, this.h); this.render(ctx, w, h, { fit });
    for (const k in this.pain) this.pain[k] += (this.painGoal[k] - this.pain[k]) * .06;
    // Draw in the figure's own space (same transform as the figure, including the sideways bend),
    // so the glows and the spine stay on the body as it slumps.
    const c = this.cur, k = Math.min(w / fit[0], h / fit[1]) * c.zoom;
    ctx.save(); ctx.translate(w / 2, h * 1.02); ctx.scale(k, k); ctx.translate(0, 8); ctx.translate(c.bx, 0);
    ctx.translate(0, -10); ctx.rotate(c.bend || 0); ctx.translate(0, 10);
    const glow = (x, y, r, a) => { if (a < .01) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(232,82,64,${.75 * a})`); g.addColorStop(.45, `rgba(240,120,90,${.35 * a})`); g.addColorStop(1, 'rgba(240,120,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    const nx = c.hx * .35, top = -116 + c.drop;
    glow(nx, -124 + c.drop + c.fwd * 8, 38, this.pain.neck);
    if (this.pain.back > .01) {
      ctx.globalAlpha = this.pain.back;
      for (let i = 0; i < 9; i++) { const t = i / 8, y = top + 6 + t * (100 - c.drop), x = nx * (1 - t);
        const hot = Math.max(this.pain.disc * (i === 7 ? 1 : 0), Math.max(0, (i - 4) / 4));
        ctx.fillStyle = hot > .2 ? `rgb(${Math.round(250 - 20 * hot)},${Math.round(246 - 150 * hot)},${Math.round(238 - 160 * hot)})` : '#f3f1ea';
        ctx.beginPath(); ctx.roundRect(x - 9, y - 4, 18, 8, 3); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    glow(0, -34, 34, this.pain.back * .8);
    glow(0, top + 6 + 7 / 8 * (100 - c.drop), 22, this.pain.disc);
    ctx.restore();
  }
}
const storyEl = document.getElementById('story-figure');
if (storyEl) {
  const av = new StoryAvatar(storyEl); av.setActive(true);
  const slump = { x: -.12, y: .45, tilt: .16, roll: .26, sx: -.06, sink: .3 };   // head down and forward, one shoulder low, closer to the screen
  const POSE = [
    [null, 1], [{ x: -.06, y: .2, tilt: .09, roll: .12, sx: -.03, sink: .12 }, 1.04], [slump, 1.1],
    [slump, 1.1], [slump, 1.1], [slump, 1.1], [slump, 1.1],
  ];
  const PAIN = [{}, {}, {}, { neck: 1 }, { neck: .8, back: 1 }, { neck: .7, back: 1, disc: 1 }, { neck: .5, back: .7, disc: .7 }];
  storyEl.closest('.slide').addEventListener('step', e => {
    const k = e.detail, [d, wr] = POSE[k];
    av.set(d, wr); av.painGoal = { neck: 0, back: 0, disc: 0, ...PAIN[k] };
  });
}
