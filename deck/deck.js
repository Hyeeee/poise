// Poise case study. Uses the app's own living backdrop, dot orb and posture figure.
import { mountPainting } from '../painting.js';
import { mountAgents } from '../agent.js';
import { PostureAvatar } from '../avatar.js';

// In the deck the figure is drawn smaller and higher than in the app, so the head, arms and
// hands always stay inside the card (the app lets the body run off the bottom edge on purpose).
class DeckAvatar extends PostureAvatar {
  draw() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.render(this.ctx, this.w, this.h * (this.room || .93), { fit: [250, 240] });   // room: share of the height the figure uses, the rest is space below it
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
  if (slides[cur] === sl) updateProgress();
}
// Forward: next step if the slide has one left, else the next slide (from its first step).
// Back: previous step, else the previous slide at its last step.
// Each part's bar fills by every press inside it: a slide counts as (its steps + 1) presses.
function updateProgress() {
  const units = sl => stepsOf(sl) + 1;
  segs.forEach(({ el, start, n }) => {
    let total = 0, done = 0;
    for (let j = start; j < start + n; j++) {
      const u = units(slides[j]); total += u;
      if (j < cur) done += u; else if (j === cur) done += +(slides[j].dataset.at || 0) + 1;
    }
    el.querySelector('b').style.width = (Math.min(1, done / total) * 100) + '%';
    el.classList.toggle('now', cur >= start && cur < start + n);
  });
}
function next() { const sl = slides[cur], k = +(sl.dataset.at || 0); if (k < stepsOf(sl)) setStep(sl, k + 1); else go(cur + 1); }
function prev() { const sl = slides[cur], k = +(sl.dataset.at || 0); if (k > 0) setStep(sl, k - 1); else { go(cur - 1, true); } }

// Main headlines arrive word by word: each word rises a little and sharpens, one after another
// (the same motion as the problem story's title).
const HEADS = [...document.querySelectorAll('.slide .title, .slide .cover-title, .slide .chapter-title')];
HEADS.forEach(h => {
  h.removeAttribute('data-in');                       // the words do the entrance now, not the whole block
  const walk = node => [...node.childNodes].forEach(c => {
    if (c.nodeType === 3) {
      const parts = c.textContent.split(/(\s+)/); if (parts.length === 1 && !parts[0].trim()) return;
      c.replaceWith(...parts.map(p => { if (!p) return document.createTextNode(''); if (/^\s+$/.test(p)) return document.createTextNode(p);
        const s = document.createElement('x-w'); s.textContent = p; return s; }));
    } else if (c.nodeType === 1 && c.localName !== 'x-w') walk(c);
  });
  walk(h);
});
function wordsIn(slide, delay = 380) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  slide.querySelectorAll('.title, .cover-title, .chapter-title').forEach(h => h.querySelectorAll('x-w').forEach((w, n) => w.animate(
    [{ transform: 'translateY(.34em)', opacity: 0, filter: 'blur(4px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
    { duration: 620, delay: delay + n * 45, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'backwards' })));
}

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
  wordsIn(next, prev ? 380 : 200);
  setStep(next, atEnd ? stepsOf(next) : 0);
  cur = i;
  document.body.classList.toggle('paper', next.classList.contains('paper'));
  document.body.classList.toggle('on-cover', i === 0);
  document.body.classList.toggle('on-end', i === slides.length - 1);   // no progress on the thank you slide
  // each part fills by how far you are into it; the current part's name is darker
  updateProgress();
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
// 4–6: the figure turns to the side; neck, lower back and a disc light up. 7: the treatment card.
const story = document.querySelector('.slide.story');
if (story) {
  // One figure built in 3D (cross-sections for the torso, spheres and capsules for head, neck and arms),
  // drawn in the app's ink style. It can turn from the front to the side like a real model, and slump.
  const cv = document.getElementById('story-3d'), g = cv.getContext('2d');
  const INK = '#141412', PAPER = '#fbfaf6';
  const S = { yaw: 0, slump: 0, bend: 0, lean: 0, away: 0, chin: 0, neck: 0, back: 0, disc: 0 }, goal = { ...S };
  const lerp = (a, b, k) => a + (b - a) * k;
  const glow = (x, y, r, a) => { if (a < .01) return; const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(232,82,64,${.8 * a})`); gr.addColorStop(.45, `rgba(240,120,90,${.35 * a})`); gr.addColorStop(1, 'rgba(240,120,90,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  // Same proportions, line weights and face as the app's avatar (figure.js), just built in 3D so it can turn.
  function draw3d(t) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    for (const k in S) S[k] += (goal[k] - S[k]) * (k === 'yaw' ? .045 : .05);
    const { yaw, slump: s, bend } = S, br = Math.sin(t / 700) * 1.2;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cb = Math.cos(bend), sb = Math.sin(bend);
    // 3D point → screen. Sideways bend turns the upper body around the waist, then the whole body turns (yaw).
    // Leaning back tips the upper body away around the waist; a little perspective makes what is farther look smaller.
    const cl = Math.cos(S.lean), sl = Math.sin(S.lean);
    const P = ([x, y0, z0]) => { const y = y0 * cl - z0 * sl, z = y0 * sl + z0 * cl;
      const x1 = x * cb - y * sb, y1 = x * sb + y * cb, X = x1 * cy + z * sy, Z = -x1 * sy + z * cy, pf = 560 / (560 - Z);
      return [X * pf, y1 * pf, Z]; };
    const k = Math.min(r.width / 250, r.height / 232) * d * (1 - .16 * S.away);   // farther from the screen = smaller
    g.setTransform(k, 0, 0, k, cv.width / 2 - 22 * sy * k, cv.height * .97);
    // spine from the waist (y 0) to the shoulders (y -116, as in the app); the slump rounds the back
    const spine = u => [0, -116 * u + br * u - s * 12 * u * u, -s * 18 * Math.sin(Math.PI * u) + s * 26 * u * u];
    const SH = spine(1);
    const shoulder = side => [side * 40, SH[1] + 5 * Math.sin(yaw), SH[2] - 2];
    // neck: 38 long like the app; slumped, it tips forward (turtle neck) and the head drops a little
    const NECK = [0, SH[1] - 8, SH[2]], na = s * .95, nl = 38 - s * 8;
    // chin in hand: the head slides and tips toward the propping hand (screen left)
    const ch = S.chin, head = [-12 * ch, NECK[1] - Math.cos(na) * nl + 8 * ch + 14 * s * (1 - Math.sin(yaw)), NECK[2] + Math.sin(na) * nl];
    const neckTop = [head[0] * .55, NECK[1] + (head[1] - NECK[1]) * .55, NECK[2] + (head[2] - NECK[2]) * .55];
    // arms rest like the app (elbow out, hands in by the waist); slumped, the forearms reach forward to the desk
    const arm = side => { const sh = shoulder(side), el = [sh[0] + side * 18, sh[1] + 50, sh[2] + 4 + s * 12], hd = [el[0] - side * 18, el[1] + lerp(52, 30, s), el[2] + lerp(2, 46, s)];
      if (side < 0 && ch > .001) {   // propping arm: elbow down on the desk in front, hand under the chin
        const E = [-34, sh[1] + 84, sh[2] + 30], H = [head[0] - 2, head[1] + 19, head[2] + 2];
        for (let i = 0; i < 3; i++) { el[i] = lerp(el[i], E[i], ch); hd[i] = lerp(hd[i], H[i], ch); } }
      return [sh, el, hd]; };
    // tee: the app's shape (42 wide at the shoulders, 37 at the chest, 34 at the waist), 22 deep
    const L = [], R = [];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, c = spine(u), w = u < .81 ? lerp(34, 37, u / .81) : lerp(37, 42, (u - .81) / .19), dp = 22;
      const half = Math.sqrt((w * cy) ** 2 + (dp * sy) ** 2), cc = P(c);
      L.push([cc[0] - half, cc[1]]); R.push([cc[0] + half, cc[1]]);
    }
    const limb = (a, b, w) => { const A = P(a), B = P(b); g.lineCap = 'round';
      g.strokeStyle = INK; g.lineWidth = w + 4.5; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
      g.strokeStyle = PAPER; g.lineWidth = w; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); };
    const drawArm = ([sh, el, hd]) => { limb(sh, el, 11); limb(el, hd, 9);
      const E = P(el), H = P(hd); g.fillStyle = PAPER; g.strokeStyle = INK; g.lineWidth = 2.4;
      g.beginPath(); g.ellipse(H[0], H[1], 5.5, 7.5, Math.atan2(H[1] - E[1], H[0] - E[0]) - Math.PI / 2, 0, Math.PI * 2); g.fill(); g.stroke(); };
    const arms = [-1, 1].map(side => ({ side, pts: arm(side), z: P(shoulder(side))[2] })).sort((a, b) => a.z - b.z);
    // far arm, tee, spine, neck, head, near arm
    if (sy > .2) drawArm(arms[0].pts);
    g.fillStyle = INK; g.lineJoin = 'round'; g.beginPath(); L.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); for (let i = R.length - 1; i >= 0; i--) g.lineTo(...R[i]); g.closePath(); g.fill();
    // the spine, seen as the body turns: an S (lumbar curve forward, upper back curve back, neck curve forward).
    // Slumped, the upper curve deepens and the neck juts forward; the strained curves turn red and ache.
    const showSpine = Math.max(0, sy - .35) / .65 * Math.max(S.neck, S.back);
    const col = [];
    if (showSpine > .01) {
      for (let i = 0; i <= 16; i++) { const u = .07 + i / 16 * .9, c = spine(u);
        const dz = u < .38 ? 7 * Math.sin(Math.PI * u / .38) : -(5 + 2 * s) * Math.sin(Math.PI * (u - .38) / .62);
        col.push({ p: [0, c[1], c[2] - 3 + dz], hot: Math.max(S.back * Math.max(0, 1 - Math.abs(u - .2) / .16), S.disc * Math.max(0, 1 - Math.abs(u - .14) / .07)), u }); }
      const n0 = col[col.length - 1].p;
      // neck vertebrae run down the middle of the neck itself, so they stay inside it
      for (let i = 0; i < 4; i++) { const v = .12 + i * .26;
        col.push({ p: [0, lerp(NECK[1], neckTop[1], v), lerp(NECK[2], neckTop[2], v)], hot: S.neck * (.6 + .4 * Math.sin(Math.PI * v)), neck: 1 }); }
    }
    const pulse = .75 + .25 * Math.sin(t / 260);
    const drawSpine = neckPart => {
      if (showSpine <= .01) return;
      const Q = col.map(c => P(c.p)), from = neckPart ? 16 : 0, to = neckPart ? col.length : 17;
      g.save(); g.globalAlpha = showSpine; g.lineCap = g.lineJoin = 'round';
      g.strokeStyle = '#efe9dc'; g.lineWidth = 3; g.beginPath(); for (let i = from; i < to; i++) i > from ? g.lineTo(Q[i][0], Q[i][1]) : g.moveTo(Q[i][0], Q[i][1]); g.stroke();
      col.forEach((c, i) => { if (i < from || i >= to || (i % 2 && !c.neck)) return; const q = Q[i], q2 = Q[Math.min(i + 1, Q.length - 1)], q1 = Q[Math.max(i - 1, 0)];
        const h = Math.min(1, c.hot * pulse);
        g.save(); g.translate(q[0], q[1]); g.rotate(Math.atan2(q2[1] - q1[1], q2[0] - q1[0]) + Math.PI / 2);
        g.fillStyle = `rgb(${Math.round(244 - 10 * h)},${Math.round(238 - 150 * h)},${Math.round(226 - 160 * h)})`;
        const wv = c.neck ? 7 : 12; g.beginPath(); g.roundRect(-wv / 2, -3.2, wv, 6.4, 2.6); g.fill(); g.restore(); });
      // the squeezed disc bulges out toward the back
      g.restore();
    };
    drawSpine(false);
    limb(NECK, neckTop, 13);
    drawSpine(true);
    if (sy > .2) drawArm(arms[1].pts);   // side on, the near arm hangs in front of the body and neck, behind the forward head
    // head: the app's head (19 × 23), hair cap with a soft fringe, closed eyes and a small nose line.
    // As the body turns, the face slides toward the side it faces and the hair wraps round to the back.
    // chin in hand: the propping arm goes under the head, so the chin rests on the hand
    const propping = ch > .3 && sy <= .2; if (propping) drawArm(arms.find(a => a.side < 0).pts);
    const hc = P(head), tilt = na * sy * .8 - .42 * ch, hs = 1 + s * .08;
    g.save(); g.translate(hc[0], hc[1]); g.rotate(tilt); g.scale(hs, hs);
    g.fillStyle = PAPER; g.strokeStyle = INK; g.lineWidth = 2.4;
    g.beginPath(); g.ellipse(0, 0, 19, 23, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    const a0 = lerp(1.02, .74, sy) * Math.PI, a1 = lerp(1.98, 1.86, sy) * Math.PI;
    g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, 20.5, 24.5, 0, a0, a1);
    g.quadraticCurveTo(lerp(14, 13, sy), lerp(-10, -13, sy), lerp(4, -1, sy), lerp(-11, -9, sy));
    g.quadraticCurveTo(lerp(-8, -8, sy), lerp(-9, 2, sy), 20.5 * Math.cos(a0), 24.5 * Math.sin(a0)); g.fill();
    const face = x => x * cy + 15 * sy, seen = x => -x * sy + 15 * cy > 2, ew = Math.max(.45, cy);
    g.lineWidth = 1.8; g.lineCap = 'round'; g.beginPath();
    for (const ex of [-7, 8]) if (seen(ex)) { const fx = face(ex); g.moveTo(fx - 4 * ew, 0); g.quadraticCurveTo(fx, 3, fx + 4 * ew, 0); }
    g.stroke();
    // the nose line only shows from the front; it fades out as the head turns to the side
    const noseA = Math.max(0, 1 - sy / .55);
    if (noseA > .01) { const nx = face(1); g.save(); g.globalAlpha *= noseA; g.beginPath(); g.moveTo(nx, 4); g.lineTo(nx - .5, 9); g.stroke(); g.restore(); }
    g.restore();
    if (sy <= .2) arms.forEach(a => { if (!(propping && a.side < 0)) drawArm(a.pts); });   // front on, arms last as in the app
    // pain: a warm glow plus little ink ache strokes that throb
    const ache = (x, y, r, a, seed) => { if (a < .05) return; g.save(); g.strokeStyle = `rgba(214,60,44,${a})`; g.lineWidth = 2.4; g.lineCap = 'round';
      for (let j = 0; j < 3; j++) { const an = seed + j * .55, r0 = r * (1 + .12 * Math.sin(t / 200 + j)), r1 = r0 + 9;
        g.beginPath(); g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); g.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1); g.stroke(); } g.restore(); };
    const nk = P([0, lerp(SH[1], neckTop[1], .5), lerp(SH[2], neckTop[2], .5) - 4]); glow(nk[0], nk[1], 40, S.neck * pulse);
    const lo = P(col.length ? col[Math.round(.2 * 16)].p : spine(.2)); glow(lo[0], lo[1], 44, S.back * .85 * pulse);
    const sideOn = Math.max(0, sy - .5) * 2;
    ache(nk[0], nk[1], 26, S.neck * sideOn * (S.disc > .5 ? .5 : 1), -2.1);
    ache(lo[0], lo[1], 28, S.back * sideOn * (S.disc > .5 ? .5 : 1), 2.4);
    if (S.disc > .02 && col.length) { const q = P(col[Math.round(.14 * 16)].p); glow(q[0] - 9 * sy, q[1], 22, S.disc * pulse); }
  }
  (function loop(t) { if (story.classList.contains('open') || story.classList.contains('leaving')) draw3d(t); requestAnimationFrame(loop); })(0);

  // The title: one two-line heading whose letters turn into the next step's words.
  const TITLES = [
    ['We drift', 'without noticing.'],
    ['We sit down', 'sitting well.'],
    ['A few minutes in,', 'we start to drift.'],
    ['By ten minutes, it’s', 'a different posture.'],
    ['The head pushes forward.', 'The neck carries it.'],
    ['The lower back', 'starts to give.'],
    ['A disc slips', 'out of place.'],
    ['Treatment, week after week.', 'It adds up.'],
  ];
  const keyLines = [...story.querySelectorAll('.key .k1, .key .k2')];
  let morphRun = 0;
  // Word by word: the old words lift up and fade, then the new ones rise into place one after another.
  const setWords = (line, text) => { line.replaceChildren(...text.split(' ').flatMap((w, i) => {
    const s = document.createElement('span'); s.className = 'w'; s.textContent = w; return i ? [document.createTextNode(' '), s] : [s]; })); };
  const morphTitle = (to, delay = 0) => {
    const run = ++morphRun;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { keyLines.forEach((l, i) => setWords(l, to[i])); return; }
    let i = 0, outEnd = 0;
    keyLines.forEach(l => l.querySelectorAll('.w').forEach(w => { const d = delay + i++ * 22; outEnd = Math.max(outEnd, d + 260);
      w.animate([{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: 'translateY(-.28em)', opacity: 0, filter: 'blur(3px)' }],
        { duration: 260, delay: d, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }); }));
    setTimeout(() => { if (run !== morphRun) return; let n = 0;
      keyLines.forEach((l, li) => { setWords(l, to[li]); l.querySelectorAll('.w').forEach(w => w.animate(
        [{ transform: 'translateY(.34em)', opacity: 0, filter: 'blur(4px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
        { duration: 620, delay: n++ * 45, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'backwards' })); }); }, outEnd);
  };
  keyLines.forEach(l => setWords(l, l.textContent));
  let lastK = -1, arriveT;
  const onStep = k => {
    // leaving the key message: the figure and copy wait until the headline has settled, so nothing overlaps
    if (lastK === 0 && k > 0) { story.classList.add('arriving'); clearTimeout(arriveT); arriveT = setTimeout(() => story.classList.remove('arriving'), 2200); }
    if (k !== lastK && lastK !== -1) morphTitle(TITLES[k], lastK === 0 ? 120 : 0);
    else if (lastK === -1) keyLines.forEach((l, i) => setWords(l, TITLES[k][i]));
    lastK = k;
    story.classList.toggle('intro', k === 0);
    // 3 and 10 min: sinking back into the chair, farther from the screen, with only a slight tilt
    // 3 min: chin in hand, tilted hard toward it and leaning in. 10 min: leaning in close to the screen, head pushed forward (turtle neck).
    const SL = [0, 0, .35, .7, 1, 1, 1, 1], BE = [0, 0, -.24, -.03, 0, 0, 0, 0], LE = [0, 0, -.2, -.5, 0, 0, 0, 0], AW = [0, 0, 0, 0, 0, 0, 0, 0], CH = [0, 0, 1, 0, 0, 0, 0, 0];
    Object.assign(goal, { yaw: k >= 4 ? Math.PI / 2 : 0, slump: SL[k], bend: BE[k], lean: LE[k], away: AW[k], chin: CH[k],
      neck: k >= 4 ? (k >= 7 ? .5 : 1) : 0, back: k >= 5 ? (k >= 7 ? .6 : 1) : 0, disc: k >= 6 ? (k >= 7 ? .6 : 1) : 0 });
    story.classList.toggle('paying', k === 7);
  };
  story.addEventListener('step', e => onStep(e.detail));
  onStep(+(story.dataset.at || 0));   // the slide may already be open (deep link)
}
