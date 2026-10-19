// Animated ink-sketch guide: a seated figure that performs each stretch on a loop.
// Same interface the app used for the video player: load / replay / stop / suspend / resume.
// Screen directions match what the user sees in their mirrored camera.

const $ = id => document.getElementById(id);
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13" stroke-width="2.4"/></svg>',
};

// Figure space: pelvis at (0,0), up is negative y. Units ≈ px at scale 1.
const REST = {
  lean: 0, head: 0, drop: 0, shrug: 0,
  eL: [-60, -66], wL: [-46, -8],   // screen-left arm (user's left in the mirror)
  eR: [60, -66], wR: [46, -8],
};
// Each move: target pose (partial) + how long to hold.
const MOVES = {
  cross: side => {
    const s = side === 'left' ? 1 : -1; // 1 = screen-left arm crosses to the right
    const k = s === 1 ? ['eL', 'wL', 'eR', 'wR'] : ['eR', 'wR', 'eL', 'wL'];
    return { [k[0]]: [-6 * s, -96], [k[1]]: [58 * s, -108], [k[2]]: [52 * s, -74], [k[3]]: [6 * s, -94], head: -.12 * s };
  },
  neck: target => {
    const s = Math.sign(target); // + tilts toward screen-right
    return { head: .42 * s, drop: 4, shrug: -4, ...(s > 0 ? { eL: [-58, -62], wL: [-44, -4] } : { eR: [58, -62], wR: [44, -4] }) };
  },
  hug: () => ({ lean: .16, drop: 10, head: 0, eL: [-30, -78], wL: [40, -100], eR: [30, -84], wR: [-38, -106] }),
};

const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const mix = (a, b, t) => a + (b - a) * t;
const mixP = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t)];

// Timeline of one loop, in seconds.
const IN = 1.4, HOLD = 2.6, OUT = 1.2, REST_T = .9, LOOP = IN + HOLD + OUT + REST_T;

export class GuidePlayer {
  constructor({ onPlaying }) {
    this.onPlaying = onPlaying;
    this.mount = $('reel-player');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Animated stretching guide');
    this.mount.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.playing = false; this.t = 0; this.seed = 0;
    $('reel-play').onclick = () => { if (!this.clip) return; this.playing ? this.pause(true) : this.play(); };
    $('reel-sound').hidden = true;
    new ResizeObserver(() => this.resize()).observe(this.mount);
    this.resize();
    this.tick = this.tick.bind(this);
    this.signal(false);
  }
  resize() {
    const r = this.mount.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    this.w = r.width; this.h = r.height;
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  signal(playing) {
    this.playing = playing; this.onPlaying(playing);
    $('reel-play').innerHTML = playing ? ICON.pause : ICON.play;
    $('reel-play').setAttribute('aria-label', playing ? 'Pause guide' : 'Play guide');
  }
  status(s) { $('reel-status').textContent = s; }
  load(clip) {
    this.clip = clip;
    this.target = clip.type === 'cross' ? MOVES.cross(clip.side) : clip.type === 'neck' ? MOVES.neck(clip.target) : MOVES.hug();
    this.t = 0; this.userPaused = false;
    this.play();
  }
  play() { if (this.playing) return; this.userPaused = false; this.signal(true); this.last = performance.now(); this.status('Follow the figure'); requestAnimationFrame(this.tick); }
  pause(byUser) { this.userPaused = !!byUser; this.signal(false); if (byUser) this.status('Paused'); }
  replay() { if (!this.clip) return; this.t = 0; this.play(); }
  stop() { this.clip = null; this.signal(false); this.status(''); this.draw(); }
  suspend() { this.suspended = this.playing; if (this.playing) this.pause(false); }
  resume() { if (this.suspended && !this.userPaused) this.play(); this.suspended = false; }
  tick(now) {
    if (!this.playing) return;
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    this.t = (this.t + dt) % LOOP;
    // "Boiling" ink: the line wobble changes a few times a second, like redrawn frames.
    this.seed = Math.floor(now / 140);
    this.draw();
    requestAnimationFrame(this.tick);
  }
  amount() {
    const t = this.t;
    if (t < IN) return ease(t / IN);
    if (t < IN + HOLD) return 1;
    if (t < IN + HOLD + OUT) return 1 - ease((t - IN - HOLD) / OUT);
    return 0;
  }
  pose() {
    const k = this.clip ? this.amount() : 0, T = this.target || {}, P = {};
    for (const key of Object.keys(REST)) {
      const a = REST[key], b = T[key] ?? a;
      P[key] = Array.isArray(a) ? mixP(a, b, k) : mix(a, b, k);
    }
    P.breath = Math.sin(this.t / LOOP * Math.PI * 4) * 1.6;
    P.k = k;
    return P;
  }
  // Seeded jitter so lines tremble like a hand drawing.
  j(i, amp = 1.1) { const x = Math.sin((i + 1) * 12.9898 + this.seed * 78.233) * 43758.5453; return (x - Math.floor(x) - .5) * 2 * amp; }

  draw() {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const P = this.pose();
    const s = Math.min(w / 300, h / 330);
    ctx.save();
    ctx.translate(w / 2, h * .74);
    ctx.scale(s, s);
    const INK = '#141412', PAPER = '#fbfaf6';
    let n = 0;
    const jp = p => [p[0] + this.j(n++), p[1] + this.j(n++)];

    // Chair: a few loose strokes.
    ctx.strokeStyle = 'rgba(20,20,18,.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    this.line([[-78, 8], [78, 8]], jp); this.line([[-70, 10], [-74, 78]], jp); this.line([[70, 10], [74, 78]], jp);

    // Upper body pose transforms.
    const lean = P.lean, drop = P.drop + P.breath;
    const sh = (x, y) => [x + lean * (y + 120) * -0, y + drop + lean * 30];
    const SL = sh(-40, -116 - P.shrug), SR = sh(40, -116 - P.shrug), NECK = sh(0, -124);

    // Legs: black trousers, seated front view (knees toward the viewer).
    ctx.fillStyle = INK;
    this.poly([[-48, -10], [-4, -10], [-8, 18], [-12, 72], [-40, 74], [-46, 20]], jp);
    this.poly([[48, -10], [4, -10], [8, 18], [12, 72], [40, 74], [46, 20]], jp);
    ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
    this.poly([[-40, 72], [-12, 72], [-8, 84], [-46, 84]], jp, true);
    this.poly([[40, 72], [12, 72], [8, 84], [46, 84]], jp, true);

    // Torso: narrow bare waist under a black crop top.
    const top = -60 + drop * .6, lx = lean * 40;
    ctx.fillStyle = PAPER; ctx.lineWidth = 2.4;
    this.poly([[-30 + lx * .3, top + 4], [30 + lx * .3, top + 4], [32, -12], [-32, -12]], jp, true);
    ctx.fillStyle = INK;
    this.poly([[SL[0] + 2, SL[1] + 2], [NECK[0] - 10, NECK[1] + 8], [NECK[0] + 10, NECK[1] + 8], [SR[0] - 2, SR[1] + 2], [36 + lx * .3, top - 2], [33 + lx * .3, top + 6], [-33 + lx * .3, top + 6], [-36 + lx * .3, top - 2]], jp);

    // Head on the neck, tilted.
    const tilt = P.head, hx = NECK[0] + Math.sin(tilt) * 38, hy = NECK[1] - Math.cos(tilt) * 38;
    this.limb(NECK, [NECK[0] + Math.sin(tilt) * 16, NECK[1] - Math.cos(tilt) * 16], 13, INK, PAPER, jp);
    ctx.save();
    ctx.translate(hx, hy); ctx.rotate(tilt);
    ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(this.j(n++, .5), this.j(n++, .5), 19, 23, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Hair cap with a soft side part, and a bun.
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 24, 0, Math.PI * 1.06, Math.PI * 1.96);
    ctx.quadraticCurveTo(10, -16 + this.j(n++, .6), 2, -13); ctx.quadraticCurveTo(-10, -12, -19, -2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.j(n++, .4) - 2, -30, 9, 0, Math.PI * 2); ctx.fill();
    // Closed eyes and a small nose line.
    ctx.lineWidth = 1.8; ctx.beginPath();
    ctx.moveTo(-11, 1); ctx.quadraticCurveTo(-7, 4, -3, 1);
    ctx.moveTo(4, 1); ctx.quadraticCurveTo(8, 4, 12, 1);
    ctx.moveTo(1, 5); ctx.lineTo(0, 10); ctx.stroke();
    ctx.restore();

    // Arms last so crossing arms sit in front of the body. Draw the arm that crosses on top.
    const L = [SL, sh(...P.eL), sh(...P.wL)], R = [SR, sh(...P.eR), sh(...P.wR)];
    const order = this.clip?.type === 'cross' && this.clip.side === 'right' ? [L, R] : [R, L];
    for (const [s0, e, wr] of order) {
      this.limb(s0, e, 11, INK, PAPER, jp);
      this.limb(e, wr, 9, INK, PAPER, jp);
      ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.ellipse(wr[0] + this.j(n++, .6), wr[1] + this.j(n++, .6), 5.5, 7.5, Math.atan2(wr[1] - e[1], wr[0] - e[0]) - Math.PI / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  poly(pts, jp, stroke) {
    const c = this.ctx; c.beginPath(); pts.map(jp).forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath();
    c.lineJoin = 'round'; c.fill(); if (stroke) c.stroke();
  }
  line(pts, jp) { this.ctx.beginPath(); pts.map(jp).forEach((p, i) => i ? this.ctx.lineTo(...p) : this.ctx.moveTo(...p)); this.ctx.stroke(); }
  blob(pts, jp, stroke) {
    const c = this.ctx, q = pts.map(jp);
    c.beginPath(); c.moveTo((q[0][0] + q[q.length - 1][0]) / 2, (q[0][1] + q[q.length - 1][1]) / 2);
    q.forEach((p, i) => { const nx = q[(i + 1) % q.length]; c.quadraticCurveTo(p[0], p[1], (p[0] + nx[0]) / 2, (p[1] + nx[1]) / 2); });
    c.closePath(); c.fill(); if (stroke) c.stroke();
  }
  // An outlined limb: thick ink stroke with a paper core.
  limb(a, b, width, ink, paper, jp) {
    const c = this.ctx, A = jp(a), B = jp(b);
    c.lineCap = 'round';
    c.strokeStyle = ink; c.lineWidth = width + 4.5; c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke();
    c.strokeStyle = paper; c.lineWidth = width; c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke();
    c.strokeStyle = ink;
  }
}
