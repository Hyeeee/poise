import { safeArea } from './safearea.js';
import { sfx } from './sfx.js';
// Reach & Pop: a short full-body movement game for breaks.
// Soft bubbles appear around you — above your head, out to the sides, down by your hips.
// Touch them with your hands to pop them. Gold bubbles are for your head: lean to reach them.
// Coordinates are MediaPipe's normalized video space, drawn on a canvas mirrored like the camera.

import { BubbleGL } from './bubblegl.js';

const TAU = Math.PI * 2;
// Bubble colors. The light bar shows the same color as the bubble you should go for next.
const COLORS = [
  [255, 70, 90],   // coral red
  [255, 150, 0],   // orange
  [255, 220, 0],   // yellow
  [40, 220, 90],   // green
  [0, 200, 220],   // cyan
  [40, 110, 255],  // blue
  [150, 70, 255],  // violet
  [255, 60, 200],  // pink
];
const GOLD = [255, 190, 40];
// Muted, refined paint colours for drawing; same order as COLORS (the LED still gets COLORS).
const PAINT = ['#ec6f63', '#f29a3e', '#e9c23a', '#5fc477', '#3fb8c9', '#5b8fe0', '#9b7be0', '#e46fae'];
const PAINT_GOLD = '#f0a93b';
const INK = '#1e1f1c';

export class MoveGame {
  constructor(canvas, video, { onTick, onEnd, onColor, onFrame } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.video = video;
    this.onTick = onTick; this.onEnd = onEnd; this.onColor = onColor; this.onFrame = onFrame; this.lastColor = '';
    this.running = false; this.raf = 0;
    // A WebGL layer under the 2D canvas draws the bubbles themselves (lens + thin film).
    this.glCv = document.createElement('canvas');
    this.glCv.className = 'bubble-gl'; this.glCv.hidden = true;
    canvas.parentNode?.insertBefore(this.glCv, canvas);
    this.glr = null;   // flat illustrated bubbles now; the WebGL lens is no longer used
  }
  start(seconds = 60) {
    this.stop();
    this.duration = seconds * 1000; this.began = performance.now();
    this.bubbles = []; this.pops = []; this.score = 0; this.popped = 0; this.missed = 0; this.combo = 0; this.best = 0;
    this.zones = { high: 0, side: 0, low: 0, head: 0 };
    this.nextSpawn = this.began + 900; this.body = null;
    this.running = true; this.cv.hidden = false; this.glCv.hidden = false;
    const frame = now => { if (!this.running) return; this.step(now); this.raf = requestAnimationFrame(frame); };
    this.raf = requestAnimationFrame(frame);
  }
  stop() {
    this.running = false; cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); this.cv.hidden = true;
    this.glr?.clear(); if (this.glCv) this.glCv.hidden = true;
  }
  get left() { return Math.max(0, this.duration - (performance.now() - this.began)); }
  result() {
    return { score: this.score, popped: this.popped, missed: this.missed, best: this.best, zones: { ...this.zones }, ms: performance.now() - this.began };
  }
  // Called with each pose result.
  update(p) {
    if (!this.running || !p) return;
    const ok = i => p[i] && (p[i].visibility ?? 1) > .4;
    if (!ok(11) || !ok(12)) return;
    const w = Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y);
    this.body = { cx: (p[11].x + p[12].x) / 2, cy: (p[11].y + p[12].y) / 2, w, p, ok };
  }
  spawn(now) {
    const b = this.body; if (!b) return;
    // Pick a zone that makes you move: up, out, down, or a lean with your head.
    const roll = Math.random();
    let zone, a, dist;
    if (roll < .34) { zone = 'high'; a = -Math.PI / 2 + (Math.random() - .5) * 1.6; dist = 1.7 + Math.random() * .5; }
    else if (roll < .68) { zone = 'side'; a = (Math.random() < .5 ? 0 : Math.PI) + (Math.random() - .5) * .7; dist = 1.6 + Math.random() * .6; }
    else if (roll < .86) { zone = 'low'; a = (Math.random() < .5 ? .55 : Math.PI - .55) + (Math.random() - .5) * .4; dist = 1.6 + Math.random() * .4; }
    else { zone = 'head'; a = -Math.PI / 2 + (Math.random() < .5 ? -.9 : .9); dist = 1.25; }
    const aspect = (this.video.videoWidth / this.video.videoHeight) || 16 / 9;
    let x = b.cx + Math.cos(a) * dist * b.w, y = b.cy + Math.sin(a) * dist * b.w * aspect * .7;
    const r = Math.min(.06, b.w * (zone === 'head' ? .26 : .22));
    // Keep the whole bubble inside the part of the camera you can actually see
    // (not under the side panel, top bar or ask bar). The canvas is mirrored, so a screen
    // x maps to 1 - x in video coordinates.
    const cv = this.canvas || this.cv, W = cv.clientWidth, H = cv.clientHeight;
    const vw0 = this.video.videoWidth || 16, vh0 = this.video.videoHeight || 9;
    const sc = Math.max(W / vw0, H / vh0), vw = vw0 * sc, vh = vh0 * sc, ox = (W - vw) / 2, oy = (H - vh) / 2;
    const sa = safeArea(cv), rp = r * vw * 1.25;                       // bubble radius in px (+ grow room)
    const nx = px => (px - ox) / vw, ny = py => (py - oy) / vh;
    const xMin = nx(W - (sa.l + rp)), xMax = nx(W - (sa.r - rp));  // mirrored
    const loX = Math.min(xMin, xMax), hiX = Math.max(xMin, xMax);
    const loY = ny(sa.t + rp), hiY = ny(sa.b - rp);
    x = Math.min(Math.max(loX, hiX - .001), Math.max(loX, x)); y = Math.min(Math.max(loY, hiY - .001), Math.max(loY, y));
    const ci = Math.floor(Math.random() * COLORS.length), color = zone === 'head' ? GOLD : COLORS[ci], paint = zone === 'head' ? PAINT_GOLD : PAINT[ci];
    this.bubbles.push({ x, y, r, zone, color, paint, born: now, life: zone === 'head' ? 4600 : 4000, seed: Math.random() * TAU, size: .8 + Math.random() * .4 });
  }
  step(now) {
    const { cv, ctx } = this;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(3, devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const vw0 = this.video.videoWidth || 16, vh0 = this.video.videoHeight || 9;
    const scale = Math.max(w / vw0, h / vh0), vw = vw0 * scale, vh = vh0 * scale, ox = (w - vw) / 2, oy = (h - vh) / 2;
    const X = x => x * vw + ox, Y = y => y * vh + oy;

    const elapsed = now - this.began;
    if (elapsed >= this.duration) { this.stop(); this.onEnd?.(this.result()); return; }
    // Faster as the round goes on, never more than three at once.
    const gap = 1500 - Math.min(700, elapsed / 60);
    if (now > this.nextSpawn && this.bubbles.length < 3) { this.spawn(now); this.nextSpawn = now + gap; }

    // Hits: hands pop normal bubbles, your nose pops head bubbles.
    const b = this.body;
    if (b) {
      const hands = [15, 16, 19, 20].filter(b.ok).map(i => b.p[i]);
      for (const bub of this.bubbles) {
        if (bub.dead) continue;
        const hitters = bub.zone === 'head' ? (b.ok(0) ? [b.p[0]] : []) : hands;
        if (hitters.some(q => Math.hypot((q.x - bub.x) * vw, (q.y - bub.y) * vh) < bub.r * vw * 1.1)) {
          bub.dead = true; sfx.pop(); this.popped++; this.combo++; this.best = Math.max(this.best, this.combo);
          const pts = (bub.zone === 'head' ? 150 : 100) + Math.min(5, this.combo - 1) * 20;
          this.score += pts; this.zones[bub.zone]++;
          this.pops.push({ x: bub.x, y: bub.y, r: bub.r, size: bub.size || 1, seed: bub.seed, dx: Math.sin(now / 1300 + bub.seed) * 7, dy: Math.cos(now / 1100 + bub.seed) * 6 - Math.min(10, (now - bub.born) / 400), t: now, pts, color: bub.color, paint: bub.paint, drops: Array.from({ length: 8 }, () => ({ a: -Math.PI * .75 + (Math.random() - .5) * 2.6, v: .6 + Math.random() * .9, s: .6 + Math.random() * 1.4 })) });
          this.flash = { color: bub.color, until: now + 1500 };
        }
      }
    }
    for (const bub of this.bubbles) if (!bub.dead && now - bub.born > bub.life) { bub.dead = true; this.missed++; this.combo = 0; }
    this.bubbles = this.bubbles.filter(x => !x.dead);

    // Bubbles: clear glass lenses. Each one shows the camera image behind it, slightly
    // magnified and frosted, with a faint tint of its color, a thin light-catching edge,
    // a soft inner shadow, and a curved highlight — like Apple's glass material.
    const canSee = this.video.readyState >= 2;
    const useGL = this.glr?.ok && canSee;
    if (useGL) {
      // Bubbles float: a slow wander up and sideways, each on its own rhythm.
      const drift = bub => [Math.sin(now / 1300 + bub.seed) * 7 + Math.sin(now / 2100 + bub.seed * 2) * 4, Math.cos(now / 1100 + bub.seed) * 6 - Math.min(10, (now - bub.born) / 400)];
      const list = this.bubbles.map(bub => {
        const age = (now - bub.born) / bub.life, grow = Math.min(1, (now - bub.born) / 650), ease = 1 - Math.pow(1 - grow, 3);
        const [dx, dy] = drift(bub);
        return { x: X(bub.x) + dx, y: Y(bub.y) + dy, r: bub.r * vw * (.5 + .5 * ease) * bub.size,
          alpha: ease * (age > .85 ? 1 - (age - .85) / .15 : 1), color: bub.color, pop: 0, seed: bub.seed, wobble: .035 + .015 * Math.sin(now / 1400 + bub.seed) };
      });
      for (const p of this.pops) {
        const k = (now - p.t) / 220;
        if (k < 1) list.push({ x: X(p.x) + p.dx, y: Y(p.y) + p.dy, r: p.r * vw * p.size, alpha: 1, color: p.color, pop: Math.max(.001, k), seed: p.seed, wobble: .05 });
      }
      this.glr.render(list, this.video, { ox, oy, vw, vh }, now / 1000);
    }
    for (const bub of this.bubbles) {
      if (useGL) continue;
      const age = (now - bub.born) / bub.life, grow = Math.min(1, (now - bub.born) / 520);
      const ease = 1 - Math.pow(1 - grow, 3);
      const r = bub.r * vw * (.6 + .4 * ease) * (1 + .02 * Math.sin(now / 320 + bub.seed));
      const x = X(bub.x), y = Y(bub.y) + Math.sin(now / 800 + bub.seed) * 3;
      const fade = age > .82 ? 1 - (age - .82) / .18 * .6 : 1;
      ctx.globalAlpha = ease * fade;
      // Same simple look as the guide box: pale colour fill, a clear colour ring,
      // and a matching countdown arc just outside.
      const a0 = ease * fade, lw = Math.max(3, r * .07);
      ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.strokeStyle = bub.paint; ctx.fillStyle = bub.paint;
      ctx.globalAlpha = a0 * .28; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = a0; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r + lw * 2.2, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - age)); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Pops: the film tears (WebGL) and a fine mist of droplets sprays out and falls.
    this.pops = this.pops.filter(p => now - p.t < 800);
    for (const p of this.pops) {
      const k = (now - p.t) / 800, x = X(p.x) + (p.dx || 0), y = Y(p.y) + (p.dy || 0), r0 = p.r * vw * (p.size || 1), [cr, cg, cb] = p.color;
      if (k < .4) {
        ctx.globalAlpha = 1 - k / .4; ctx.lineWidth = 1.5; ctx.strokeStyle = INK;
        ctx.beginPath(); ctx.arc(x, y, r0 * (1 + k * .6), 0, TAU); ctx.stroke();
      }
      for (const d of p.drops) {
        const dist = r0 * (.9 + k * 1.4 * d.v);
        const dx = x + Math.cos(d.a) * dist, dy = y + Math.sin(d.a) * dist + k * k * r0 * 1.6;
        ctx.globalAlpha = (1 - k) * .9;
        ctx.fillStyle = p.paint || INK;
        ctx.beginPath(); ctx.arc(dx, dy, (d.s + 1.5) * (1 - k * .6), 0, TAU); ctx.fill();
      }
      ctx.save(); ctx.translate(x, y - r0 * .2 - k * 34); ctx.scale(-1, 1);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = INK; ctx.font = '500 20px Geist, -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`+${p.pts}`, 0, 0);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // Light bar: flash the popped color, otherwise show the oldest bubble on screen.
    const target = this.flash && now < this.flash.until ? this.flash.color : null;   // light up only when you pop one
    const key = target ? target.join(' ') : 'none';
    if (key !== this.lastColor) { this.lastColor = key; this.onColor?.(target || null); }
    this.onFrame?.(this);
    this.onTick?.({ score: this.score, left: this.duration - elapsed, combo: this.combo, popped: this.popped, tracking: !!b });
  }
}
