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

// ---------- The problem story ----------
// Step 0: only the key message. 1–3: the front figure slumps (0, 3, 10 min).
// 4–6: the figure turns to the side; neck, lower back and a disc light up. 7: money flutters away.
const story = document.querySelector('.slide.story');
if (story) {
  const front = new DeckAvatar(document.getElementById('story-front')); front.setActive(true);
  const slump = { x: -.12, y: .45, tilt: .16, roll: .26, sx: -.06, sink: .3 };
  const POSE = [[null, 1], [null, 1], [{ x: -.06, y: .2, tilt: .09, roll: .12, sx: -.03, sink: .12 }, 1.04], [slump, 1.1]];

  // Side view, drawn here in the same ink style as the app's figure.
  const cv = document.getElementById('story-side'), g = cv.getContext('2d');
  const INK = '#141412', PAPER = '#fbfaf6';
  const S = { slump: .2, neck: 0, back: 0, disc: 0 }, goal = { ...S };
  const lerp = (a, b, k) => a + (b - a) * k, mix = (A, B, k) => [lerp(A[0], B[0], k), lerp(A[1], B[1], k)];
  const qp = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
  const limb = (pts, w, fill = PAPER) => { g.lineCap = g.lineJoin = 'round'; for (const [lw, c] of [[w + 4.5, INK], [w, fill]]) { g.lineWidth = lw; g.strokeStyle = c; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); } };
  const glow = (x, y, r, a) => { if (a < .01) return; const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(232,82,64,${.8 * a})`); gr.addColorStop(.45, `rgba(240,120,90,${.35 * a})`); gr.addColorStop(1, 'rgba(240,120,90,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  function drawSide(t) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    const k = Math.min(r.width / 420, r.height / 330) * d * .92;          // whole scene always fits: nothing cut
    g.setTransform(k, 0, 0, k, cv.width / 2 - 40 * k, cv.height * .64);
    const s = S.slump, br = Math.sin(t / 900) * 1.2;
    // chair, desk and laptop in a light line
    g.strokeStyle = 'rgba(20,20,18,.28)'; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-46, 22); g.lineTo(52, 22); g.moveTo(-44, 22); g.lineTo(-56, -84); g.moveTo(0, 22); g.lineTo(0, 92); g.moveTo(-30, 92); g.lineTo(30, 92); g.stroke();
    g.beginPath(); g.moveTo(96, -34); g.lineTo(230, -34); g.moveTo(210, -34); g.lineTo(210, 92); g.stroke();
    g.beginPath(); g.moveTo(128, -36); g.lineTo(196, -36); g.lineTo(186, -112); g.stroke();
    // body: pelvis, spine curve, neck and head (the slump rounds the back and pushes the head forward)
    const pel = [0, 4], top = mix([2, -118 + br], [30, -100 + br], s), ctl = mix([-8, -62], [-30, -66], s);
    const nk = mix([6, -138 + br], [62, -118 + br], s), head = mix([10, -164 + br], [84, -128 + br], s);
    // legs (trousers) and feet
    limb([[pel[0] + 4, pel[1] + 6], [74, 10], [78, 84]], 26, INK); limb([[78, 84], [100, 86]], 9, INK);
    // torso: a thick black stroke along the spine
    g.strokeStyle = INK; g.lineWidth = 64; g.lineCap = 'round'; g.beginPath(); g.moveTo(pel[0] + 10, pel[1] - 18); g.quadraticCurveTo(ctl[0] + 10, ctl[1], top[0] + 6, top[1] + 14); g.stroke();
    // spine: vertebrae along the back, the low ones turning red
    const sp = i => { const tt = .08 + i / 11 * .9, p = qp(pel, ctl, top, 1 - tt), q = qp(pel, ctl, top, 1 - tt + .01); const a = Math.atan2(q[1] - p[1], q[0] - p[0]); return [p[0] - 16 * Math.cos(a - Math.PI / 2) * .0 - 14, p[1], a]; };
    if (S.back > .01) for (let i = 0; i < 11; i++) {
      const [x, y, a] = sp(i), hot = Math.max(S.disc * (i === 2 ? 1 : 0), S.back * Math.max(0, (4 - i) / 4));
      g.save(); g.translate(x + 4, y - 6); g.rotate(a + Math.PI / 2); g.globalAlpha = S.back;
      g.fillStyle = hot > .15 ? `rgb(${Math.round(250 - 20 * hot)},${Math.round(240 - 150 * hot)},${Math.round(230 - 150 * hot)})` : '#f1efe7';
      g.beginPath(); g.roundRect(-9, -3.6, 18, 7.2, 3); g.fill(); g.restore();
    }
    // neck and head (hair at the back, closed eye looking at the screen)
    limb([top, nk], 14);
    g.fillStyle = PAPER; g.strokeStyle = INK; g.lineWidth = 3.2; g.beginPath(); g.ellipse(head[0], head[1], 23, 26, s * .5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.ellipse(head[0], head[1], 23.5, 26.5, s * .5, Math.PI * .9 + s * .5, Math.PI * 1.75 + s * .5); g.closePath(); g.fill();
    g.lineWidth = 2.6; g.beginPath(); const ex = head[0] + 12, ey = head[1] - 2 + s * 6; g.moveTo(ex - 5, ey); g.quadraticCurveTo(ex, ey + 4, ex + 5, ey); g.stroke();
    // arm reaching to the keyboard
    const sh = mix([8, -104 + br], [38, -90 + br], s), el = mix([30, -50], [64, -46], s);
    limb([sh, el, [140, -42]], 13);
    // pain
    glow(lerp(top[0], nk[0], .4), lerp(top[1], nk[1], .4), 44, S.neck);
    const low = qp(pel, ctl, top, .82); glow(low[0] - 10, low[1], 46, S.back * .8);
    const disc = sp(2); glow(disc[0] + 4, disc[1] - 6, 26, S.disc);
    for (const k2 in S) S[k2] += (goal[k2] - S[k2]) * .06;
  }
  (function loop(t) { if (story.classList.contains('open') || story.classList.contains('leaving')) drawSide(t); requestAnimationFrame(loop); })(0);

  // Money: notes flutter down from the top and fade away.
  const mc = document.getElementById('money'), m = mc.getContext('2d'); let notes = [], raining = false;
  const note = (y0 = -.12 - Math.random() * .15) => ({ x: Math.random(), y: y0, vx: (Math.random() - .5) * .0006, vy: .0012 + Math.random() * .0012, a: Math.random() * 6, va: (Math.random() - .5) * .04, f: Math.random() * 6, vf: .05 + Math.random() * .05, s: .7 + Math.random() * .6 });
  function drawNote(n, W, H, u) {
    m.save(); m.translate(n.x * W + Math.sin(n.f * .7) * 30 * u, n.y * H); m.rotate(n.a); m.scale(n.s * u, n.s * u * Math.max(.12, Math.abs(Math.cos(n.f))));
    m.globalAlpha = Math.max(0, Math.min(1, (1 - n.y) * 2.2));
    m.fillStyle = '#d7ecd9'; m.strokeStyle = INK; m.lineWidth = 2.4; m.lineJoin = 'round';
    m.beginPath(); m.roundRect(-44, -22, 88, 44, 6); m.fill(); m.stroke();
    m.lineWidth = 1.8; m.beginPath(); m.ellipse(0, 0, 12, 14, 0, 0, Math.PI * 2); m.stroke();
    m.beginPath(); m.roundRect(-38, -16, 76, 32, 4); m.globalAlpha *= .5; m.stroke(); m.globalAlpha /= .5;
    m.fillStyle = INK; m.font = '700 18px Inter, sans-serif'; m.textAlign = 'center'; m.textBaseline = 'middle'; m.fillText('$', 0, 1);
    m.restore();
  }
  (function rain() {
    const r = mc.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (mc.width !== Math.round(r.width * d)) { mc.width = Math.round(r.width * d); mc.height = Math.round(r.height * d); }
    m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, mc.width, mc.height);
    if (raining && notes.length < 34 && Math.random() < .25) notes.push(note());
    const u = d * Math.max(.6, r.width / 1600);
    notes.forEach(n => { n.x += n.vx; n.y += n.vy; n.a += n.va; n.f += n.vf; drawNote(n, mc.width, mc.height, u); });
    notes = notes.filter(n => n.y < 1.1);
    requestAnimationFrame(rain);
  })();

  const onStep = k => {
    story.classList.toggle('intro', k === 0);
    story.classList.toggle('turned', k >= 4);
    const [dd, wr] = POSE[Math.min(k, 3)]; front.set(dd, wr);
    Object.assign(goal, { slump: k >= 4 ? 1 : .2, neck: k >= 4 ? (k >= 7 ? .5 : 1) : 0, back: k >= 5 ? (k >= 7 ? .6 : 1) : 0, disc: k >= 6 ? (k >= 7 ? .6 : 1) : 0 });
    if (k === 7 && !raining) for (let i = 0; i < 14; i++) notes.push(note(-.1 - Math.random() * .5 + i * .02));   // a first handful, already in the air
    raining = k === 7;
  };
  story.addEventListener('step', e => onStep(e.detail));
  onStep(+(story.dataset.at || 0));   // the slide may already be open (deep link)
}
