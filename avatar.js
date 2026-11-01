// Focus avatar: an upper-body figure that copies how you sit, in front of a faint outline
// of your saved reference. The gap between the two is what "off your reference" means.
// Movements are exaggerated (small real shifts would be invisible) and eased so it moves calmly.
import { drawFigure } from './figure.js';

const REST_ARMS = { eL: [-58, -66], wL: [-40, -14], eR: [58, -66], wR: [40, -14] };
const ZERO = { head: 0, hx: 0, shTilt: 0, fwd: 0, drop: 0, zoom: 1 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class PostureAvatar {
  constructor(mount) {
    this.mount = mount;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'You, compared with your reference posture');
    mount.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cur = { ...ZERO }; this.goal = { ...ZERO };
    this.color = '#141412'; this.hasRef = false; this.present = true; this.alpha = 1; this.seed = 0; this.t = 0;
    new ResizeObserver(() => this.resize()).observe(mount);
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  resize() {
    const r = this.mount.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    this.w = r.width; this.h = r.height;
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // delta: cue minus reference, in shoulder widths. widthRatio: shoulder width now / at reference.
  set(delta, widthRatio = 1) {
    if (!delta) { this.goal = { ...ZERO }; return; }
    const E = 1.8;                                                   // exaggeration
    this.goal = {
      // Camera image is mirrored on screen, so sideways values flip.
      head: clamp(-Math.atan2(delta.roll || 0, .35) * 1.6, -.6, .6),
      hx: clamp(-(delta.x || 0) * 80 * E, -40, 40),
      shTilt: clamp((delta.tilt || 0) * 80, -18, 18),
      fwd: clamp((delta.y || 0) * 7, 0, 1),
      drop: clamp((delta.sink || 0) * 80 * 1.5, 0, 26),
      zoom: clamp(1 + (widthRatio - 1) * 1.6, .78, 1.3),
    };
  }
  // Away / out of frame: the figure fades out; the dashed reference stays.
  setPresent(on) { this.present = !!on; }
  setColor(c) { this.color = c || '#141412'; }
  setActive(on) { this.hasRef = on; if (!on) this.goal = { ...ZERO }; }
  // Advance the easing. Safe to call from more than one loop (main page and mini window).
  step(now) {
    const dt = Math.min(.05, Math.max(0, (now - (this.last || now)) / 1000));
    if (dt === 0 && this.last) return;
    this.last = now; this.t += dt;
    const k = 1 - Math.pow(.02, dt);                                // smooth follow, ~1 s to settle
    for (const key in this.cur) this.cur[key] += (this.goal[key] - this.cur[key]) * k;
    this.alpha += ((this.present ? 1 : 0) - this.alpha) * (1 - Math.pow(.004, dt));
    this.seed = Math.floor(now / 220);
  }
  loop(now) {
    requestAnimationFrame(this.loop);
    this.step(now);
    if (!this.w || this.mount.offsetParent === null) return;
    this.draw();
  }
  j(i, amp = .9) { const x = Math.sin((i + 1) * 12.9898 + this.seed * 78.233) * 43758.5453; return (x - Math.floor(x) - .5) * 2 * amp; }
  draw() { this.render(this.ctx, this.w, this.h); }
  // Draw into any 2D context (the panel, or the mini window's canvas).
  render(ctx, w, h, { fit = [240, 215] } = {}) {
    const c = this.cur;
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w / fit[0], h / fit[1]);
    const breath = Math.sin(this.t * 1.4) * 1.2;
    const base = { lean: 0, bend: 0, look: 0, shrug: 0, breath, ...REST_ARMS };
    const place = zoom => { ctx.save(); ctx.translate(w / 2, h * 1.02); ctx.scale(s * zoom, s * zoom); ctx.translate(0, 8); };

    // Reference: just a dashed outline of head and shoulders where you sat when you saved it.
    if (this.hasRef) {
      place(1);
      ctx.setLineDash([5, 5]); ctx.lineDashOffset = -this.t * 6;       // dashes drift slowly
      ctx.strokeStyle = 'rgba(13,13,13,.32)'; ctx.lineWidth = 1.6 / s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.ellipse(0, -162, 22, 26, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (const m of [-1, 1]) {
        ctx.moveTo(10 * m, -134); ctx.lineTo(10 * m, -126);
        ctx.quadraticCurveTo(14 * m, -122, 38 * m, -121);
        ctx.quadraticCurveTo(54 * m, -119, 56 * m, -102);
        ctx.lineTo(66 * m, -64); ctx.lineTo(52 * m, 4);
      }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }

    // You.
    if (this.alpha < .02) return;
    ctx.globalAlpha = this.alpha;
    place(c.zoom);
    drawFigure(ctx, { ...base, head: c.head, hx: c.hx, shTilt: c.shTilt, fwd: c.fwd, drop: c.drop },
      { j: (i, a) => this.j(i, a), shirt: this.color, legs: false });
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
