// Reach & Pop: a short full-body movement game for breaks.
// Soft bubbles appear around you — above your head, out to the sides, down by your hips.
// Touch them with your hands to pop them. Gold bubbles are for your head: lean to reach them.
// Coordinates are MediaPipe's normalized video space, drawn on a canvas mirrored like the camera.

const TAU = Math.PI * 2;

export class MoveGame {
  constructor(canvas, video, { onTick, onEnd } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.video = video;
    this.onTick = onTick; this.onEnd = onEnd;
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
    x = Math.min(.94, Math.max(.06, x)); y = Math.min(.94, Math.max(.06, y));
    this.bubbles.push({ x, y, r: b.w * (zone === 'head' ? .42 : .36), zone, born: now, life: zone === 'head' ? 4200 : 3600, seed: Math.random() * TAU });
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
          this.pops.push({ x: bub.x, y: bub.y, r: bub.r, t: now, pts, gold: bub.zone === 'head' });
        }
      }
    }
    for (const bub of this.bubbles) if (!bub.dead && now - bub.born > bub.life) { bub.dead = true; this.missed++; this.combo = 0; }
    this.bubbles = this.bubbles.filter(x => !x.dead);

    // Bubbles: soft glass discs with a ring that runs down like a timer.
    for (const bub of this.bubbles) {
      const age = (now - bub.born) / bub.life, grow = Math.min(1, (now - bub.born) / 380);
      const r = bub.r * vw * (.6 + .4 * grow) * (1 + .04 * Math.sin(now / 300 + bub.seed));
      const x = X(bub.x), y = Y(bub.y);
      const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
      if (bub.zone === 'head') { g.addColorStop(0, 'rgba(255,248,220,.95)'); g.addColorStop(1, 'rgba(226,196,120,.35)'); }
      else { g.addColorStop(0, 'rgba(255,255,250,.92)'); g.addColorStop(1, 'rgba(190,210,170,.32)'); }
      ctx.globalAlpha = grow; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = bub.zone === 'head' ? 'rgba(170,130,40,.8)' : 'rgba(60,80,50,.55)';
      ctx.beginPath(); ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - age)); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Pops: an expanding ring and the points, drawn un-mirrored so the number reads correctly.
    this.pops = this.pops.filter(p => now - p.t < 700);
    for (const p of this.pops) {
      const k = (now - p.t) / 700, x = X(p.x), y = Y(p.y), r = p.r * vw * (1 + k * .9);
      ctx.globalAlpha = 1 - k; ctx.lineWidth = 2; ctx.strokeStyle = p.gold ? '#c9a24a' : '#fff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.save(); ctx.translate(x, y - r * .2 - k * 30); ctx.scale(-1, 1);
      ctx.fillStyle = '#fff'; ctx.font = '500 22px Newsreader, serif'; ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8; ctx.fillText(`+${p.pts}`, 0, 0);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    this.onTick?.({ score: this.score, left: this.duration - elapsed, combo: this.combo, popped: this.popped, tracking: !!b });
  }
}
