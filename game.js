// Reach & Pop: a short full-body movement game for breaks.
// Soft bubbles appear around you — above your head, out to the sides, down by your hips.
// Touch them with your hands to pop them. Gold bubbles are for your head: lean to reach them.
// Coordinates are MediaPipe's normalized video space, drawn on a canvas mirrored like the camera.

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

export class MoveGame {
  constructor(canvas, video, { onTick, onEnd, onColor } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.video = video;
    this.onTick = onTick; this.onEnd = onEnd; this.onColor = onColor; this.lastColor = '';
    this.running = false; this.raf = 0;
  }
  start(seconds = 60) {
    this.stop();
    this.duration = seconds * 1000; this.began = performance.now();
    this.bubbles = []; this.pops = []; this.score = 0; this.popped = 0; this.missed = 0; this.combo = 0; this.best = 0;
    this.zones = { high: 0, side: 0, low: 0, head: 0 };
    this.nextSpawn = this.began + 900; this.body = null;
    this.running = true; this.cv.hidden = false;
    const frame = now => { if (!this.running) return; this.step(now); this.raf = requestAnimationFrame(frame); };
    this.raf = requestAnimationFrame(frame);
  }
  stop() {
    this.running = false; cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); this.cv.hidden = true;
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
    const mx = r + .03, my = r * aspect + .04;            // keep the whole bubble on screen
    x = Math.min(1 - mx, Math.max(mx, x)); y = Math.min(1 - my, Math.max(my, y));
    const color = zone === 'head' ? GOLD : COLORS[Math.floor(Math.random() * COLORS.length)];
    this.bubbles.push({ x, y, r, zone, color, born: now, life: zone === 'head' ? 4200 : 3600, seed: Math.random() * TAU });
  }
  step(now) {
    const { cv, ctx } = this;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
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
          bub.dead = true; this.popped++; this.combo++; this.best = Math.max(this.best, this.combo);
          const pts = (bub.zone === 'head' ? 150 : 100) + Math.min(5, this.combo - 1) * 20;
          this.score += pts; this.zones[bub.zone]++;
          this.pops.push({ x: bub.x, y: bub.y, r: bub.r, t: now, pts, color: bub.color, drops: Array.from({ length: 10 }, (_, i) => ({ a: i / 10 * TAU + Math.random() * .4, v: .7 + Math.random() * .6 })) });
          this.flash = { color: bub.color, until: now + 350 };
        }
      }
    }
    for (const bub of this.bubbles) if (!bub.dead && now - bub.born > bub.life) { bub.dead = true; this.missed++; this.combo = 0; }
    this.bubbles = this.bubbles.filter(x => !x.dead);

    // Bubbles: clear glass lenses. Each one shows the camera image behind it, slightly
    // magnified and frosted, with a faint tint of its color, a thin light-catching edge,
    // a soft inner shadow, and a curved highlight — like Apple's glass material.
    const canSee = this.video.readyState >= 2;
    for (const bub of this.bubbles) {
      const age = (now - bub.born) / bub.life, grow = Math.min(1, (now - bub.born) / 520);
      const ease = 1 - Math.pow(1 - grow, 3);
      const r = bub.r * vw * (.6 + .4 * ease) * (1 + .02 * Math.sin(now / 320 + bub.seed));
      const x = X(bub.x), y = Y(bub.y) + Math.sin(now / 800 + bub.seed) * 3;
      const [cr, cg, cb] = bub.color, c = a => `rgba(${cr},${cg},${cb},${a})`;
      const fade = age > .82 ? 1 - (age - .82) / .18 * .6 : 1;
      ctx.globalAlpha = ease * fade;

      // drop shadow under the glass
      ctx.save();
      ctx.shadowColor = 'rgba(10, 14, 8, .28)'; ctx.shadowBlur = r * .5; ctx.shadowOffsetY = r * .12;
      ctx.fillStyle = 'rgba(255,255,255,.01)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
      // the scene behind, magnified 15% and frosted
      if (canSee) {
        ctx.save();
        ctx.translate(x, y); ctx.scale(1.15, 1.15); ctx.translate(-x, -y);
        ctx.filter = 'blur(6px) saturate(1.35) brightness(1.12)';
        ctx.drawImage(this.video, ox, oy, vw, vh);
        ctx.restore();
        ctx.filter = 'none';
      }
      // milky glass + a whisper of color, stronger toward the edge
      const body = ctx.createRadialGradient(x, y - r * .2, r * .1, x, y, r);
      body.addColorStop(0, 'rgba(255,255,255,.16)');
      body.addColorStop(.7, c(.14));
      body.addColorStop(1, c(.32));
      ctx.fillStyle = body; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // inner shadow along the lower edge gives the lens depth
      const inner = ctx.createRadialGradient(x, y - r * .25, r * .55, x, y, r * 1.05);
      inner.addColorStop(0, 'rgba(0,0,0,0)'); inner.addColorStop(1, 'rgba(0,0,0,.18)');
      ctx.fillStyle = inner; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // curved specular highlight across the top
      const spec = ctx.createLinearGradient(x, y - r, x, y - r * .2);
      spec.addColorStop(0, 'rgba(255,255,255,.55)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.beginPath(); ctx.ellipse(x, y - r * .52, r * .72, r * .4, 0, Math.PI, TAU); ctx.ellipse(x, y - r * .52, r * .72, r * .22, 0, 0, Math.PI); ctx.fill();
      ctx.restore();

      // hairline rim: bright at the top-left, fading around the bottom
      const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      rim.addColorStop(0, 'rgba(255,255,255,.95)'); rim.addColorStop(.45, 'rgba(255,255,255,.25)'); rim.addColorStop(.75, c(.5)); rim.addColorStop(1, 'rgba(255,255,255,.6)');
      ctx.lineWidth = Math.max(1, r * .03); ctx.strokeStyle = rim;
      ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, 0, TAU); ctx.stroke();

      // countdown: a fine colored arc just outside the glass
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = c(.9);
      ctx.shadowColor = c(.6); ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - age)); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    // Pops: colored droplets fly out, a ring expands, and the points float up (un-mirrored).
    this.pops = this.pops.filter(p => now - p.t < 750);
    for (const p of this.pops) {
      const k = (now - p.t) / 750, x = X(p.x), y = Y(p.y), r0 = p.r * vw, [cr, cg, cb] = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${cr},${cg},${cb},.9)`;
      ctx.beginPath(); ctx.arc(x, y, r0 * (1 + k * .8), 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      for (const d of p.drops) {
        const dist = r0 * (1 + k * 1.6 * d.v);
        ctx.beginPath(); ctx.arc(x + Math.cos(d.a) * dist, y + Math.sin(d.a) * dist + k * k * 20, Math.max(1, 4 * (1 - k)), 0, TAU); ctx.fill();
      }
      ctx.save(); ctx.translate(x, y - r0 * .2 - k * 34); ctx.scale(-1, 1);
      ctx.fillStyle = '#fff'; ctx.font = '500 22px Newsreader, serif'; ctx.textAlign = 'center';
      ctx.shadowColor = `rgba(${cr},${cg},${cb},.9)`; ctx.shadowBlur = 10; ctx.fillText(`+${p.pts}`, 0, 0);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // Light bar: flash the popped color, otherwise show the oldest bubble on screen.
    const target = this.flash && now < this.flash.until ? this.flash.color : this.bubbles[0]?.color;
    const key = target ? target.join(' ') : 'none';
    if (key !== this.lastColor) { this.lastColor = key; this.onColor?.(target || null); }
    this.onTick?.({ score: this.score, left: this.duration - elapsed, combo: this.combo, popped: this.popped, tracking: !!b });
  }
}
