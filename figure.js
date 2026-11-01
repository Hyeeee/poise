// One ink-sketch person, shared by the Break guide (full body, does the stretches)
// and the Focus avatar (upper body, mirrors how you sit).
// Neutral look: short hair, plain tee, trousers.
//
// Figure space: waist at (0,0), up is negative y.
// P: lean, bend, look, head, drop, shrug, eL/wL/eR/wR (arm points), breath
//    plus avatar extras: shTilt (px, + = screen-left shoulder lower), hx (px head shift), fwd (0..1 head forward)
export function drawFigure(ctx, P, { j = () => 0, ink = '#141412', paper = '#fbfaf6', shirt = ink, legs = true } = {}) {
  let n = 0;
  const jp = p => [p[0] + j(n++), p[1] + j(n++)];
  const poly = (pts, stroke) => { ctx.beginPath(); pts.map(jp).forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath(); ctx.lineJoin = 'round'; ctx.fill(); if (stroke) ctx.stroke(); };
  const limb = (a, b, width, color = ink) => {
    const A = jp(a), B = jp(b);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = width + 4.5; ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
    ctx.strokeStyle = paper; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
    ctx.strokeStyle = ink;
  };

  ctx.strokeStyle = ink; ctx.lineCap = 'round';
  const drop = (P.drop || 0) + (P.breath || 0), shrug = P.shrug || 0, tiltS = P.shTilt || 0, hx = P.hx || 0, fwd = P.fwd || 0;
  const SL = [-40, -116 - shrug + drop + tiltS], SR = [40, -116 - shrug + drop - tiltS];
  const NECK = [hx * .35, -124 + drop];

  if (legs) {
    ctx.fillStyle = ink;
    poly([[-36, -10], [-3, -10], [-6, 60], [-10, 160], [-34, 160], [-38, 60]]);
    poly([[36, -10], [3, -10], [6, 60], [10, 160], [34, 160], [38, 60]]);
    ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
    poly([[-34, 158], [-10, 158], [-6, 170], [-42, 170]], true);
    poly([[34, 158], [10, 158], [6, 170], [42, 170]], true);
  }
  // Everything above the waist bends sideways around the waist.
  ctx.save(); ctx.translate(0, -10); ctx.rotate(P.bend || 0); ctx.translate(0, 10);

  // Plain tee from shoulders to waist.
  ctx.fillStyle = shirt;
  poly([[SL[0] - 2, SL[1] + 1], [NECK[0] - 11, NECK[1] + 7], [NECK[0] + 11, NECK[1] + 7], [SR[0] + 2, SR[1] + 1], [37, SR[1] + 22], [34, -12], [-34, -12], [-37, SL[1] + 22]]);

  // Head on the neck: tilted (head), shifted (hx), and lower + a little bigger when it juts forward (fwd).
  const tilt = P.head || 0, look = P.look || 0, neckLen = 38 - fwd * 14, hs = 1 + fwd * .14;
  const hX = NECK[0] + hx * .65 + Math.sin(tilt) * neckLen + look * 7, hY = NECK[1] - Math.cos(tilt) * neckLen;
  limb(NECK, [NECK[0] + (hX - NECK[0]) * .42, NECK[1] + (hY - NECK[1]) * .42], 13);
  ctx.save();
  ctx.translate(hX, hY); ctx.rotate(tilt); ctx.scale(hs, hs);
  ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.ellipse(j(n++, .5), j(n++, .5), 19, 23, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Short hair: a simple cap with a soft fringe. No bun.
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.ellipse(0, 0, 20.5, 24.5, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.quadraticCurveTo(14, -10 + j(n++, .6), 4, -11); ctx.quadraticCurveTo(-8, -9, -20, -3); ctx.fill();
  // Closed eyes and a small nose line.
  ctx.lineWidth = 1.8; ctx.beginPath();
  const lk = look * 7;
  ctx.moveTo(-11 + lk, 3); ctx.quadraticCurveTo(-7 + lk, 6, -3 + lk, 3);
  ctx.moveTo(4 + lk, 3); ctx.quadraticCurveTo(8 + lk, 6, 12 + lk, 3);
  ctx.moveTo(1 + lk * 1.3, 7); ctx.lineTo(lk * 1.3, 12); ctx.stroke();
  ctx.restore();

  // Arms last so crossing arms sit in front of the body.
  const L = [SL, P.eL, P.wL], R = [SR, P.eR, P.wR];
  for (const [s0, e, wr] of [R, L]) {
    const el = [e[0], e[1] + drop], w = [wr[0], wr[1] + drop];
    limb(s0, el, 11);
    limb(el, w, 9);
    ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(w[0] + j(n++, .6), w[1] + j(n++, .6), 5.5, 7.5, Math.atan2(w[1] - el[1], w[0] - el[0]) - Math.PI / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// Upper body placed in a box (waist at the bottom edge), used by the Reset breathing card.
const REST_ARMS = { eL: [-58, -66], wL: [-40, -14], eR: [58, -66], wR: [40, -14] };
export function drawSeated(ctx, w, h, P = {}, { fit = [240, 215], j } = {}) {
  const s = Math.min(w / fit[0], h / fit[1]);
  ctx.save(); ctx.translate(w / 2, h * 1.02); ctx.scale(s, s); ctx.translate(0, 8);
  drawFigure(ctx, { lean: 0, bend: 0, look: 0, shrug: 0, head: 0, ...REST_ARMS, ...P }, { legs: false, j });
  ctx.restore();
}

// Breathing figure: breathe in, shoulders rise and the chest opens; breathe out, they sink.
// level() returns 0..1 (how full the breath is), mode() returns 'breathe' | 'eyes' | 'idle'.
export class BreathFigure {
  constructor(mount, { level, mode }) {
    this.mount = mount; this.level = level; this.mode = mode;
    this.cv = document.createElement('canvas'); this.cv.setAttribute('aria-hidden', 'true');
    this.cv.className = 'breath-fig'; mount.append(this.cv);
    this.ctx = this.cv.getContext('2d'); this.lv = 0; this.t = 0;
    const loop = now => {
      requestAnimationFrame(loop);
      const dt = Math.min(.05, (now - (this.last || now)) / 1000); this.last = now; this.t += dt;
      if (this.mount.offsetParent === null) return;
      const r = this.mount.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (this.cv.width !== Math.round(r.width * dpr) || this.cv.height !== Math.round(r.height * dpr)) { this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr); }
      const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
      const m = this.mode(), target = m === 'breathe' ? this.level() : 0;
      this.lv += (target - this.lv) * (1 - Math.pow(.01, dt));
      // a soft halo behind the chest grows with the breath
      const cx = r.width / 2, cy = r.height * .62, R = Math.min(r.width, r.height) * (.28 + this.lv * .14);
      const g = c.createRadialGradient(cx, cy, R * .2, cx, cy, R);
      g.addColorStop(0, `rgba(160, 214, 175, ${.15 + this.lv * .35})`); g.addColorStop(1, 'rgba(160, 214, 175, 0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
      // eye rest: the head looks slowly left and right
      const look = m === 'eyes' ? Math.sin(this.t * .9) : 0;
      drawSeated(c, r.width, r.height, { shrug: this.lv * 14, head: -this.lv * .04, look, breath: 0,
        eL: [-58 - this.lv * 4, -66 - this.lv * 6], eR: [58 + this.lv * 4, -66 - this.lv * 6] }, { fit: [230, 220] });
    };
    requestAnimationFrame(loop);
  }
}
