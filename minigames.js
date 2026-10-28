// Seated movement games played inside the white stage box on the Game card.
// Each game reads the pose (MediaPipe landmarks) and draws into a small canvas.
//   boat   — Paper Boat: lean left/right to steer a boat down a stream (side bends)
//   stones — Stone Stack: hold good posture to stack stones; slumping topples them
//   seeds  — Dandelion: turn and tilt your head to follow drifting seeds (neck)
// Interface: start(seconds), stop(), update(landmarks), running, result()
// Callbacks: onTick({score,left,label}), onEnd(result), onColor([r,g,b]|null)

const TAU = Math.PI * 2;
const vis = (p, i) => p && p[i] && (p[i].visibility ?? 1) > .4;
const ink = '#141412', paper = '#fbfaf6';

export const GAMES = {
  bubbles: { chip: 'Bubbles', title: 'Pop the bubbles', tip: 'Reach up, out and down to pop them with your hands. Gold ones are for your head — lean to touch them.' },
  boat: { chip: 'Boat', title: 'Sail the stream', tip: 'Lean your upper body left and right to steer the paper boat. Miss the stones, catch the drops.' },
  stones: { chip: 'Stones', title: 'Balance the stones', tip: 'Sit tall and still. Every few seconds a stone is added. Slump or lean and the stack starts to wobble.' },
  seeds: { chip: 'Seeds', title: 'Follow the seeds', tip: 'Turn and tilt your head to bring the circle onto a drifting seed, then hold it there.' },
};

export class MiniGame {
  constructor(canvas, { onTick, onEnd, onColor } = {}) {
    this.cv = canvas; this.onTick = onTick; this.onEnd = onEnd; this.onColor = onColor;
    this.running = false; this.kind = 'boat';
  }
  start(kind, seconds = 60) {
    this.stop();
    this.kind = kind; this.duration = seconds * 1000; this.began = performance.now();
    this.running = true; this.base = null; this.baseSamples = []; this.pose = null;
    this.s = { score: 0, a: 0, b: 0 };   // per-game counters
    if (kind === 'boat') Object.assign(this, { boatX: 0, items: [], nextItem: this.began + 800, scroll: 0 });
    if (kind === 'stones') Object.assign(this, { stack: 0, best: 0, goodMs: 0, badMs: 0, wobble: 0, falls: 0, falling: null });
    if (kind === 'seeds') Object.assign(this, { cur: [0, 0], seed: null, holdMs: 0, trail: [] });
    const loop = now => { if (!this.running) return; this.step(now); this.raf = requestAnimationFrame(loop); };
    this.last = performance.now(); this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  update(p) { if (this.running) this.pose = p; }
  result() {
    const ms = performance.now() - this.began, s = this.s;
    if (this.kind === 'boat') return { kind: 'boat', score: s.score, ms, stats: [[s.score, 'drops caught'], [s.b, 'stones hit'], [Math.round(s.a), 'side leans']] };
    if (this.kind === 'stones') return { kind: 'stones', score: this.best, ms, stats: [[this.best, 'tallest stack'], [Math.round(this.goodTotal / 1000 || 0) + 's', 'sitting tall'], [this.falls, 'topples']] };
    return { kind: 'seeds', score: s.score, ms, stats: [[s.score, 'seeds followed'], [Math.round(s.a), 'head turns'], [Math.round(s.b), 'head tilts']] };
  }

  // ---- pose cues, relative to how you sat in the first second ----
  cues() {
    const p = this.pose; if (!p || !vis(p, 11) || !vis(p, 12) || !vis(p, 0)) return null;
    const w = Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y) || .1;
    const mx = (p[11].x + p[12].x) / 2, my = (p[11].y + p[12].y) / 2;
    const c = {
      lean: (mx - p[0].x) / w + (p[12].y - p[11].y) / w * .8,     // + = toward screen right (mirrored)
      headY: (p[0].y - my) / w,
      tilt: (p[11].y - p[12].y) / w,
      yaw: vis(p, 7) && vis(p, 8) ? (((p[7].x + p[8].x) / 2) - p[0].x) / (Math.abs(p[7].x - p[8].x) || .05) : 0,
      pitch: vis(p, 7) && vis(p, 8) ? (p[0].y - (p[7].y + p[8].y) / 2) / w : 0,
    };
    if (!this.base) {
      this.baseSamples.push(c);
      if (this.baseSamples.length >= 15) {
        const avg = k => this.baseSamples.reduce((a, b) => a + b[k], 0) / this.baseSamples.length;
        this.base = { lean: avg('lean'), headY: avg('headY'), tilt: avg('tilt'), yaw: avg('yaw'), pitch: avg('pitch') };
      }
      return null;
    }
    return { lean: c.lean - this.base.lean, headY: c.headY - this.base.headY, tilt: c.tilt - this.base.tilt, yaw: c.yaw - this.base.yaw, pitch: c.pitch - this.base.pitch };
  }

  step(now) {
    const dt = Math.min(64, now - this.last); this.last = now;
    const left = this.duration - (now - this.began);
    const cv = this.cv, dpr = Math.min(2, devicePixelRatio || 1), W = cv.offsetWidth, H = cv.offsetHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const c = this.cues();
    let label = !this.pose ? 'Sit so your head and shoulders are in view.' : !this.base ? 'Sit still for a moment…' : '';
    this[this.kind](ctx, W, H, dt, now, c);
    if (this.hint && !label) label = this.hint;
    this.onTick?.({ score: this.kind === 'stones' ? this.stack : this.s.score, left: Math.max(0, left), label });
    if (left <= 0) { this.stop(); this.onEnd?.(this.result()); }
  }

  // ---------- Paper Boat ----------
  boat(ctx, W, H, dt, now, c) {
    const lane = W * .34;
    // stream
    ctx.fillStyle = '#e8eef0'; ctx.fillRect(W / 2 - lane - 18, 0, (lane + 18) * 2, H);
    this.scroll = (this.scroll + dt * .06) % 40;
    ctx.strokeStyle = 'rgba(120,150,165,.35)'; ctx.lineWidth = 1.5;
    for (let y = -40 + this.scroll; y < H; y += 40) for (const x of [-.5, 0, .5]) { ctx.beginPath(); ctx.moveTo(W / 2 + x * lane - 8, y); ctx.quadraticCurveTo(W / 2 + x * lane, y + 6, W / 2 + x * lane + 8, y); ctx.stroke(); }
    if (c) {
      const target = Math.max(-1, Math.min(1, c.lean / .35));
      if (Math.abs(target) > .6 && Math.abs(this.boatX) <= .6) this.s.a += .5;     // counts each lean out
      this.boatX += (target - this.boatX) * Math.min(1, dt / 160);
    }
    // items
    if (now > this.nextItem && this.base) {
      this.items.push({ x: (Math.random() * 2 - 1) * .9, y: -20, kind: Math.random() < .62 ? 'drop' : 'stone' });
      this.nextItem = now + 900 - Math.min(400, (now - this.began) / 120);
    }
    const bx = W / 2 + this.boatX * lane, by = H * .78;
    for (const it of this.items) {
      it.y += dt * (.07 + (now - this.began) / 1e6);
      const x = W / 2 + it.x * lane;
      if (!it.done && Math.abs(it.y - by) < 16 && Math.abs(x - bx) < 26) {
        it.done = true;
        if (it.kind === 'drop') { this.s.score++; this.onColor?.([40, 180, 255]); } else { this.s.b++; this.onColor?.([255, 130, 0]); }
        setTimeout(() => this.onColor?.(null), 500);
      }
      if (it.done) continue;
      if (it.kind === 'drop') { ctx.fillStyle = '#5aa9d6'; ctx.beginPath(); ctx.moveTo(x, it.y - 9); ctx.quadraticCurveTo(x + 7, it.y + 2, x, it.y + 6); ctx.quadraticCurveTo(x - 7, it.y + 2, x, it.y - 9); ctx.fill(); }
      else { ctx.fillStyle = '#8b8a82'; ctx.beginPath(); ctx.ellipse(x, it.y, 13, 9, .3, 0, TAU); ctx.fill(); }
    }
    this.items = this.items.filter(i => i.y < H + 20 && !i.done);
    // boat (folded paper)
    ctx.save(); ctx.translate(bx, by); ctx.rotate(this.boatX * .25);
    ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(24, 0); ctx.lineTo(16, 10); ctx.lineTo(-16, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(0, -22); ctx.lineTo(12, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    this.hint = c ? (Math.abs(this.boatX) < .2 ? 'Lean left or right to steer.' : 'Nice — keep leaning.') : '';
  }

  // ---------- Stone Stack ----------
  stones(ctx, W, H, dt, now, c) {
    const ground = H * .86;
    ctx.fillStyle = '#efe9dc'; ctx.fillRect(0, ground, W, H - ground);
    let off = 0;
    if (c) off = Math.abs(c.lean) * 1.2 + Math.max(0, c.headY) * 2 + Math.abs(c.tilt) * 2;
    const good = c && off < .18;
    if (good) { this.goodMs += dt; this.goodTotal = (this.goodTotal || 0) + dt; this.badMs = 0; this.wobble *= .9; }
    else if (c) { this.badMs += dt; this.wobble = Math.min(1, this.wobble + dt / 1500); }
    if (this.goodMs > 2500 && !this.falling) { this.goodMs = 0; this.stack++; this.best = Math.max(this.best, this.stack); this.onColor?.([0, 255, 30]); setTimeout(() => this.onColor?.(null), 400); }
    if (this.badMs > 2500 && this.stack > 0 && !this.falling) { this.falling = { at: now, n: this.stack }; this.stack = 0; this.falls++; this.goodMs = 0; this.onColor?.([255, 0, 0]); setTimeout(() => this.onColor?.(null), 700); }
    // draw stack
    const n = this.falling ? this.falling.n : this.stack;
    let y = ground;
    for (let i = 0; i < n; i++) {
      const w = 64 - i * 3.2, h = 15, sway = this.wobble * Math.sin(now / 120 + i) * (i + 1) * 1.4;
      let x = W / 2 + sway, yy = y - h / 2, rot = this.wobble * .06 * Math.sin(now / 150 + i);
      if (this.falling) { const k = (now - this.falling.at) / 900; x += (i + 1) * 14 * k * (i % 2 ? 1 : -1); yy += k * k * (i + 1) * 20; rot += k * (i % 2 ? 1 : -1); ctx.globalAlpha = Math.max(0, 1 - k); }
      ctx.save(); ctx.translate(x, yy); ctx.rotate(rot);
      ctx.fillStyle = ['#9a968b', '#b6b1a5', '#8e897d', '#c3beb2'][i % 4];
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
      y -= h - 2;
    }
    if (this.falling && now - this.falling.at > 900) this.falling = null;
    // next stone progress
    if (!this.falling && good) {
      const k = Math.min(1, this.goodMs / 2500);
      ctx.strokeStyle = 'rgba(20,20,18,.25)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(W / 2, y - 24, 10, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    }
    this.hint = !c ? '' : good ? 'Sitting tall — the next stone is coming.' : this.wobble > .4 ? 'It’s wobbling — sit back up.' : 'Sit tall and still.';
  }

  // ---------- Dandelion seeds ----------
  seeds(ctx, W, H, dt, now, c) {
    if (c) {
      const tx = W / 2 + Math.max(-1, Math.min(1, c.yaw / .5)) * W * .4;
      const ty = H / 2 + Math.max(-1, Math.min(1, (c.pitch + c.tilt * .5) / .25)) * H * .38;
      this.cur[0] += (tx - this.cur[0] || 0) * Math.min(1, dt / 140);
      this.cur[1] += (ty - this.cur[1] || 0) * Math.min(1, dt / 140);
      if (!this.cur[0]) this.cur = [W / 2, H / 2];
    } else if (!this.cur[0]) this.cur = [W / 2, H / 2];
    if (!this.seed && this.base) {
      const a = Math.random() * TAU, r = .55 + Math.random() * .3;
      this.seed = { x: W / 2 + Math.cos(a) * W * .4 * r, y: H / 2 + Math.sin(a) * H * .38 * r, born: now, ph: Math.random() * TAU };
      if (Math.abs(Math.cos(a)) > .6) this.s.a++; else this.s.b++;
    }
    // dandelion head in the middle
    ctx.strokeStyle = 'rgba(20,20,18,.2)'; ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.lineTo(W / 2 + Math.cos(a) * 18, H / 2 + Math.sin(a) * 18); ctx.stroke(); }
    if (this.seed) {
      const s = this.seed; s.x += Math.sin(now / 900 + s.ph) * .25; s.y += Math.cos(now / 1100 + s.ph) * .2;
      // seed: a tiny stem with a fluffy top
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y + 4); ctx.lineTo(s.x, s.y + 14); ctx.stroke();
      for (let i = 0; i < 9; i++) { const a = -Math.PI + i / 8 * Math.PI; ctx.beginPath(); ctx.moveTo(s.x, s.y + 4); ctx.lineTo(s.x + Math.cos(a) * 9, s.y + 4 + Math.sin(a) * 9); ctx.stroke(); }
      const near = Math.hypot(this.cur[0] - s.x, this.cur[1] - s.y) < 26;
      this.holdMs = near ? this.holdMs + dt : Math.max(0, this.holdMs - dt);
      if (this.holdMs > 1200) { this.s.score++; this.seed = null; this.holdMs = 0; this.onColor?.([255, 220, 0]); setTimeout(() => this.onColor?.(null), 400); }
      if (s && near) { ctx.strokeStyle = 'rgba(20,20,18,.5)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y + 6, 22, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, this.holdMs / 1200)); ctx.stroke(); }
    }
    // head cursor
    ctx.strokeStyle = ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.cur[0], this.cur[1], 14, 0, TAU); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(this.cur[0], this.cur[1], 2.5, 0, TAU); ctx.fill();
    this.hint = c ? 'Turn and tilt your head to reach the seed.' : '';
  }
}
