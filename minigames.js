import { safeArea } from './safearea.js';
import { sfx } from './sfx.js';
// Seated movement games played inside the white stage box on the Game card.
// Each game reads the pose (MediaPipe landmarks) and draws into a small canvas.
//   boat   — Paper Boat: lean left/right to steer a boat down a stream (side bends)
//   bells  — Shoulder Bells: shrug both shoulders up, then drop them, to ring a bell
//   seeds  — Dandelion: turn and tilt your head to follow drifting seeds (neck)
// Interface: start(seconds), stop(), update(landmarks), running, result()
// Callbacks: onTick({score,left,label}), onEnd(result), onColor([r,g,b]|null)

const TAU = Math.PI * 2;
const vis = (p, i) => p && p[i] && (p[i].visibility ?? 1) > .4;
const ink = '#141412', paper = '#fbfaf6';

export const GAMES = {
  bubbles: { chip: 'Bubbles', title: 'Pop the bubbles', tip: 'Reach up, out and down to pop them with your hands. Gold ones are for your head, so lean over to touch them.' },
  boat: { chip: 'Boat', title: 'Sail the stream', tip: 'Lean your upper body left and right to steer the paper boat. Miss the stones, catch the drops.' },
  bells: { chip: 'Bells', title: 'Ring the bells', tip: 'Lift both shoulders up toward your ears, hold for a beat, then let them drop. Each full lift rings a bell.' },
  seeds: { chip: 'Seeds', title: 'Follow the seeds', tip: 'Turn and tilt your head to bring the circle onto a drifting seed, then hold it there.' },
};

export class MiniGame {
  constructor(canvas, { onTick, onEnd, onColor, helper } = {}) {
    this.cv = canvas; this.helper = helper; this.onTick = onTick; this.onEnd = onEnd; this.onColor = onColor;
    this.running = false; this.kind = 'boat';
  }
  start(kind, seconds = 60) {
    this.stop();
    this.kind = kind; this.duration = seconds * 1000; this.began = performance.now();
    this.running = true; this.base = null; this.baseSamples = []; this.pose = null;
    this.s = { score: 0, a: 0, b: 0 };   // per-game counters
    if (kind === 'boat') Object.assign(this, { boatX: 0, items: [], nextItem: this.began + 800, scroll: 0 });
    if (kind === 'bells') Object.assign(this, { up: false, upMs: 0, lift: 0, rings: [], swing: 0 });
    if (kind === 'seeds') Object.assign(this, { cur: [0, 0], seed: null, holdMs: 0, trail: [] });
    const loop = now => { if (!this.running) return; this.step(now); this.raf = requestAnimationFrame(loop); };
    this.last = performance.now(); this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  update(p) { if (this.running) this.pose = p; }
  result() {
    const ms = performance.now() - this.began, s = this.s;
    if (this.kind === 'boat') return { kind: 'boat', score: s.score, ms, stats: [[s.score, 'drops caught'], [s.b, 'stones hit'], [Math.round(s.a), 'side leans']] };
    if (this.kind === 'bells') return { kind: 'bells', score: s.score, ms, stats: [[s.score, 'bells rung'], [Math.round(s.a / 1000) + 's', 'shoulders lifted'], [s.b, 'half lifts']] };
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
      nx: (mx - p[0].x) / w,                                        // nose left/right of the shoulder middle (+ = screen right)
      pitch: vis(p, 7) && vis(p, 8) ? (p[0].y - (p[7].y + p[8].y) / 2) / w : 0,
    };
    if (!this.base) {
      this.baseSamples.push(c);
      if (this.baseSamples.length >= 15) {
        const avg = k => this.baseSamples.reduce((a, b) => a + b[k], 0) / this.baseSamples.length;
        this.base = { nx: avg('nx'), lean: avg('lean'), headY: avg('headY'), tilt: avg('tilt'), yaw: avg('yaw'), pitch: avg('pitch') };
      }
      return null;
    }
    return { nx: c.nx - this.base.nx, lean: c.lean - this.base.lean, headY: c.headY - this.base.headY, tilt: c.tilt - this.base.tilt, yaw: c.yaw - this.base.yaw, pitch: c.pitch - this.base.pitch };
  }

  step(now) {
    const dt = Math.min(64, now - this.last); this.last = now;
    const left = this.duration - (now - this.began);
    const cv = this.cv, dpr = Math.min(2, devicePixelRatio || 1), W = cv.offsetWidth, H = cv.offsetHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    // The game is drawn over the camera picture. Shapes were designed for a ~360px box,
    // so everything is scaled up by k to fit the camera view.
    // Only use the uncovered part of the camera view (not under the panel or bars).
    const sa = safeArea(cv);
    const k = Math.max(1, Math.min(sa.w, sa.h) / 360), gw = sa.w / k, gh = sa.h / k;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * sa.l, dpr * sa.t);
    // a soft white halo keeps dark lines readable on top of the camera
    ctx.shadowColor = 'rgba(255,255,250,.9)'; ctx.shadowBlur = 6;
    const c = this.cues();
    let label = !this.pose ? 'Sit so your head and shoulders are in view.' : !this.base ? 'Sit still for a moment…' : '';
    this[this.kind](ctx, gw, gh, dt, now, c);
    ctx.shadowBlur = 0;
    // side box: a small live copy of the game, as a helper
    const hp = this.helper;
    if (hp && hp.offsetWidth) {
      const hw = hp.offsetWidth, hh = hp.offsetHeight;
      if (hp.width !== Math.round(hw * dpr)) { hp.width = Math.round(hw * dpr); hp.height = Math.round(hh * dpr); }
      const h = hp.getContext('2d'); h.setTransform(1, 0, 0, 1, 0, 0); h.clearRect(0, 0, hp.width, hp.height);
      const f = Math.min(hp.width / cv.width, hp.height / cv.height);
      h.drawImage(cv, (hp.width - cv.width * f) / 2, (hp.height - cv.height * f) / 2, cv.width * f, cv.height * f);
    }
    if (this.hint && !label) label = this.hint;
    this.onTick?.({ score: this.s.score, left: Math.max(0, left), label });
    if (left <= 0) { this.stop(); this.onEnd?.(this.result()); }
  }

  // ---------- Paper Boat ----------
  boat(ctx, W, H, dt, now, c) {
    const lane = W / 2 - 40;                    // the stream spans the whole visible width
    // stream
    ctx.fillStyle = 'rgba(225,238,245,.22)'; ctx.fillRect(0, 0, W, H);
    this.scroll = (this.scroll + dt * .06) % 40;
    ctx.strokeStyle = 'rgba(120,150,165,.35)'; ctx.lineWidth = 1.5;
    for (let y = -40 + this.scroll; y < H; y += 40) for (const x of [-.75, -.25, .25, .75]) { ctx.beginPath(); ctx.moveTo(W / 2 + x * lane - 8, y); ctx.quadraticCurveTo(W / 2 + x * lane, y + 6, W / 2 + x * lane + 8, y); ctx.stroke(); }
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
        if (it.kind === 'drop') { sfx.drop(); this.s.score++; this.onColor?.([40, 180, 255]); } else { sfx.thud(); this.s.b++; this.onColor?.([255, 130, 0]); }
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
    this.hint = c ? (Math.abs(this.boatX) < .2 ? 'Lean left or right to steer.' : 'Nice, keep leaning.') : '';
  }

  // ---------- Shoulder Bells ----------
  // Shrugging moves the shoulders up toward the nose, so headY (nose minus shoulder height,
  // relative to sitting normally) goes up. Lift past 0.12, hold half a second, drop back = one ring.
  bells(ctx, W, H, dt, now, c) {
    const lift = c ? Math.max(0, Math.min(1, c.headY / .18)) : 0;
    this.lift += (lift - this.lift) * Math.min(1, dt / 120);
    if (this.lift > .65) { this.upMs += dt; this.s.a += dt; if (!this.up && this.upMs > 500) this.up = true; }
    else if (this.lift < .25) {
      if (this.up) { sfx.bell(); this.s.score++; this.rings.push(now); this.swing = 1; this.onColor?.([255, 200, 60]); setTimeout(() => this.onColor?.(null), 450); }
      else if (this.upMs > 120) this.s.b++;
      this.up = false; this.upMs = 0;
    }
    this.swing *= Math.pow(.997, dt);
    // rope from the top, bell hangs from it; the rope is pulled up as you lift
    const cx = W / 2, top = H * .1, by = H * .42 - this.lift * H * .14;
    const rot = Math.sin(now / 110) * .45 * this.swing;
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, by); ctx.stroke();
    ctx.save(); ctx.translate(cx, by); ctx.rotate(rot);
    ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(-12, 10, -16, 34); ctx.quadraticCurveTo(-26, 44, -30, 48); ctx.lineTo(30, 48); ctx.quadraticCurveTo(26, 44, 16, 34); ctx.quadraticCurveTo(12, 10, 8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(rot * -20, 54, 5, 0, TAU); ctx.fill();
    ctx.restore();
    // sound rings expanding from the bell
    this.rings = this.rings.filter(t => now - t < 1400);
    for (const t of this.rings) { const k = (now - t) / 1400; ctx.strokeStyle = `rgba(20,20,18,${.35 * (1 - k)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, by + 30, 40 + k * W * .35, 0, TAU); ctx.stroke(); }
    // lift meter: two shoulder marks that rise
    const my = H * .82, mx = W * .3;
    ctx.strokeStyle = 'rgba(20,20,18,.18)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const x of [cx - mx, cx + mx]) { ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my - H * .22); ctx.stroke(); }
    ctx.strokeStyle = this.up ? '#c99a1e' : ink;
    for (const x of [cx - mx, cx + mx]) { ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my - H * .22 * this.lift); ctx.stroke(); }
    this.hint = !c ? '' : this.up ? 'Now let your shoulders drop.' : this.lift > .65 ? 'Hold it up there…' : 'Lift both shoulders up to your ears.';
  }

  // ---------- Dandelion seeds ----------
  seeds(ctx, W, H, dt, now, c) {
    if (c) {
      // Follow where the nose moves relative to the shoulders: steadier than reading head
      // rotation from the ears, which jumps when an ear leaves the frame.
      const dz = (v, d) => Math.abs(v) < d ? 0 : v - Math.sign(v) * d;          // ignore tiny jitter
      const tx = W / 2 + Math.max(-1, Math.min(1, dz(c.nx, .03) / .28)) * W * .42;
      const ty = H / 2 + Math.max(-1, Math.min(1, dz(c.headY, .03) / .22)) * H * .4;
      const ease = Math.min(1, dt / 260);                                        // slower, calmer follow
      this.cur[0] += (tx - this.cur[0] || 0) * ease;
      this.cur[1] += (ty - this.cur[1] || 0) * ease;
      if (!this.cur[0]) this.cur = [W / 2, H / 2];
    } else if (!this.cur[0]) this.cur = [W / 2, H / 2];
    if (!this.seed && this.base) {
      const a = Math.random() * TAU, r = .55 + Math.random() * .3;
      const dy = Math.sin(a) * H * .38 * r; this.seed = { x: W / 2 + Math.cos(a) * W * .4 * r, y: H / 2 + (dy > 0 ? dy * .3 : dy), born: now, ph: Math.random() * TAU };
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
      const near = Math.hypot(this.cur[0] - s.x, this.cur[1] - s.y) < 34;
      this.holdMs = near ? this.holdMs + dt : Math.max(0, this.holdMs - dt);
      if (this.holdMs > 1200) { sfx.seed(); this.s.score++; this.seed = null; this.holdMs = 0; this.onColor?.([255, 220, 0]); setTimeout(() => this.onColor?.(null), 400); }
      if (s && near) { ctx.strokeStyle = 'rgba(20,20,18,.5)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y + 6, 22, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, this.holdMs / 1200)); ctx.stroke(); }
    }
    // head cursor
    ctx.strokeStyle = ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.cur[0], this.cur[1], 14, 0, TAU); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(this.cur[0], this.cur[1], 2.5, 0, TAU); ctx.fill();
    this.hint = c ? 'Turn and tilt your head to reach the seed.' : '';
  }
}
