// Focus avatar: an upper-body figure that copies how you sit, in front of a faint outline
// of your saved reference. The gap between the two is what "off your reference" means.
// Movements are exaggerated (small real shifts would be invisible) and eased so it moves calmly.
import { drawFigure } from './figure.js';

const REST_ARMS = { eL: [-58, -66], wL: [-40, -14], eR: [58, -66], wR: [40, -14] };
const ZERO = { head: 0, hx: 0, bend: 0, bx: 0, fwd: 0, drop: 0, zoom: 1 };
const ARM_KEYS = ['eL', 'wL', 'eR', 'wR'];
const SH = { L: [-40, -116], R: [40, -116] };                      // figure shoulders (80 units apart)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
const vis = (p, i) => p[i] && (p[i].visibility ?? 1) > .5;

export class PostureAvatar {
  constructor(mount) {
    this.mount = mount;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'You, compared with your reference posture');
    mount.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cur = { ...ZERO }; this.goal = { ...ZERO };
    this.arms = clone(REST_ARMS); this.armGoal = clone(REST_ARMS);
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
  // Limits keep the whole figure inside the box, even in the small mini window, however far you lean.
  set(delta, widthRatio = 1) {
    if (!delta) { this.goal = { ...ZERO }; return; }
    // Same small wobble the posture check ignores (0.04 shoulder widths per part): inside it the
    // figure sits right on the outline, so "Aligned" always looks aligned.
    const dz = (v, d = .04) => Math.sign(v || 0) * Math.max(0, Math.abs(v || 0) - d);
    delta = { ...delta, x: dz(delta.x), y: dz(delta.y), tilt: dz(delta.tilt), roll: dz(delta.roll), sx: dz(delta.sx, .1) };
    const E = 1.8;                                                   // exaggeration
    // Leaning sideways tilts the whole upper body around the waist (shoulders, arms and head together),
    // instead of only dropping one shoulder. Positive bend raises the screen-left shoulder.
    const bend = clamp(-(delta.tilt || 0) * 1.6, -.28, .28);
    // The head's own tilt is measured in the camera, so take the body's lean out of it.
    const headAbs = -Math.atan2(delta.roll || 0, .35) * 1.6;
    this.goal = {
      // Camera image is mirrored on screen, so sideways values flip.
      bend,
      bx: clamp(-(delta.sx || 0) * 80 * 1.2, -16, 16),               // whole body slides sideways (kept small so it stays in frame)
      head: clamp(headAbs - bend, -.45, .45),
      hx: clamp(-(delta.x || 0) * 80 * E, -24, 24),
      fwd: clamp((delta.y || 0) * 7, 0, 1),
      drop: clamp((delta.sink || 0) * 80 * 1.5, 0, 26),
      zoom: clamp(1 + (widthRatio - 1) * 1.6, .82, 1.16),
    };
    // Keep the head inside the box: where it ends up is the body slide + the head shift + the lean
    // (the lean swings the head about 150 units around the waist). If that is too far, scale the
    // slides down so the whole figure stays in view, even in the small mini window.
    const g = this.goal, headX = g.bx + g.hx * .65 + 150 * Math.sin(g.bend);
    if (Math.abs(headX) > 44) {
      const lean = 150 * Math.sin(g.bend), room = 44 * Math.sign(headX) - lean;
      const slide = g.bx + g.hx * .65;
      const k = slide && Math.sign(room) === Math.sign(slide) ? Math.min(1, Math.abs(room) / Math.abs(slide)) : 0;
      g.bx *= k; g.hx *= k;
      if (Math.abs(lean) > 44) g.bend = Math.asin(44 * Math.sign(lean) / 150);
    }
  }
  // Arms copy yours straight from the camera (not compared with the reference), so lifting a hand,
  // reaching for a mug or crossing your arms shows up on the figure. Each arm segment keeps its real
  // direction, measured in shoulder widths and turned into the body's frame (the lean is drawn separately).
  setPose(p, aspect = 16 / 9) {
    if (!p || !vis(p, 11) || !vis(p, 12)) { this.armGoal = clone(REST_ARMS); return; }
    const a = p[11], b = p[12];
    const fig = (x, y) => [-x * 80, y / aspect * 80];                  // mirrored, y in the same units as x
    const sw = Math.hypot(a.x - b.x, (a.y - b.y) / aspect) || .2;
    let ang = Math.atan2(-(a.y - b.y) / aspect, a.x - b.x);             // real shoulder-line angle on screen
    // If the shoulders ever come in swapped, keep the angle within a quarter turn so arms never flip upside down.
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    const rot = ([x, y]) => [x * Math.cos(-ang) - y * Math.sin(-ang), x * Math.sin(-ang) + y * Math.cos(-ang)];
    const seg = (i, j) => rot(fig((p[j].x - p[i].x) / sw, (p[j].y - p[i].y) / sw));
    const lim = ([x, y], max) => { const l = Math.hypot(x, y); return l > max ? [x / l * max, y / l * max] : [x, y]; };
    const g = {};
    for (const [side, s0, e, w] of [['L', 11, 13, 15], ['R', 12, 14, 16]]) {
      const rest = [REST_ARMS['e' + side], REST_ARMS['w' + side]], S = SH[side];
      if (!vis(p, e)) { g['e' + side] = rest[0]; g['w' + side] = rest[1]; continue; }
      const up = lim(seg(s0, e), 62), el = [S[0] + up[0], S[1] + up[1]];
      // Wrist out of view (common at a desk): let the forearm hang naturally from where the elbow is.
      const fo = vis(p, w) ? lim(seg(e, w), 58) : [(rest[1][0] - rest[0][0]), (rest[1][1] - rest[0][1])];
      g['e' + side] = el; g['w' + side] = [el[0] + fo[0], el[1] + fo[1]];
    }
    this.armGoal = g;
  }
  // Away / out of frame: the figure fades out; the dashed reference stays.
  setPresent(on) { this.present = !!on; }
  setColor(c) { this.color = c || '#141412'; }
  setActive(on) { this.hasRef = on; if (!on) { this.goal = { ...ZERO }; this.armGoal = clone(REST_ARMS); } }
  // Advance the easing. Safe to call from more than one loop (main page and mini window).
  step(now) {
    const dt = Math.min(.05, Math.max(0, (now - (this.last || now)) / 1000));
    if (dt === 0 && this.last) return;
    this.last = now; this.t += dt;
    const k = 1 - Math.pow(.02, dt);                                // smooth follow, ~1 s to settle
    for (const key in this.cur) this.cur[key] += (this.goal[key] - this.cur[key]) * k;
    const ka = 1 - Math.pow(.0005, dt);                              // arms follow faster, ~0.4 s
    for (const key of ARM_KEYS) for (const i of [0, 1]) this.arms[key][i] += (this.armGoal[key][i] - this.arms[key][i]) * ka;
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
  render(ctx, w, h, { fit = [240, 239], anchor = .918 } = {}) {   // same size and head position as before; the box is taller so the hands show
    const c = this.cur;
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w / fit[0], h / fit[1]);
    const breath = Math.sin(this.t * 1.4) * 1.2;
    const base = { lean: 0, bend: 0, look: 0, shrug: 0, breath, ...REST_ARMS };
    const place = zoom => { ctx.save(); ctx.translate(w / 2, h * anchor); ctx.scale(s * zoom, s * zoom); ctx.translate(0, 8); };

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
    // Leaning in toward the screen: only the head grows (it comes closer); the body and hands stay
    // the same size, so they never run out of the box.
    place(1);
    ctx.translate(c.bx, 0);
    // Keep the hands inside the box: a lean tips one side down (about 45 units x sin(lean) at the hand)
    // and a slouch drops the body, so lift the hands and elbows by that much at most.
    const floor = -14 - 45 * Math.abs(Math.sin(c.bend)) - c.drop, arms = clone(this.arms);
    for (const k of ['wL', 'wR']) arms[k][1] = Math.min(arms[k][1], floor);
    for (const k of ['eL', 'eR']) arms[k][1] = Math.min(arms[k][1], floor - 20);
    drawFigure(ctx, { ...base, ...arms, bend: c.bend, head: c.head, hx: c.hx, fwd: c.fwd, drop: c.drop, headZoom: Math.max(1, c.zoom) },
      { j: (i, a) => this.j(i, a), shirt: this.color, legs: false });
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
