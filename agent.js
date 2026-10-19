// Poise's presence: a cloud of dots that drifts between formations and reacts to what is happening.
// Mount on any element with class "agent". The host's classes drive behaviour:
//   .speaking  pulses with the voice      .thinking  spins and gathers
//   .listening opens up and leans in      .in        expands (breathing)
// data-mood="green|amber|red|idle" changes how calm it is. data-shape pins one formation.

const TAU = Math.PI * 2;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Each formation returns N points in a unit space (-1..1), z used for depth.
const SHAPES = {
  ring(n) { return Array.from({ length: n }, (_, i) => { const a = i / n * TAU; return [Math.cos(a) * .82, Math.sin(a) * .82, 0]; }); },
  diamond(n) {
    return Array.from({ length: n }, (_, i) => {
      const t = i / n * 4, side = Math.floor(t), f = t - side;
      const c = [[0, -.9], [.9, 0], [0, .9], [-.9, 0]];
      const a = c[side], b = c[(side + 1) % 4];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 0];
    });
  },
  sphere(n) {
    const g = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: n }, (_, i) => {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = g * i;
      return [Math.cos(a) * r * .9, y * .9, Math.sin(a) * r * .9];
    });
  },
  stack(n) {
    const rings = 5, per = Math.ceil(n / rings);
    return Array.from({ length: n }, (_, i) => {
      const k = Math.floor(i / per), a = (i % per) / per * TAU;
      return [Math.cos(a) * .7, -.62 + k * .31, Math.sin(a) * .7];
    });
  },
  burst(n) {
    return Array.from({ length: n }, (_, i) => {
      const ring = i % 3, a = i / n * TAU * 3 + ring * .4, r = [.35, .62, .9][ring];
      return [Math.cos(a) * r, Math.sin(a) * r, 0];
    });
  },
  knot(n) {
    return Array.from({ length: n }, (_, i) => {
      const t = i / n * TAU, r = .55 + .25 * Math.cos(3 * t);
      return [r * Math.cos(2 * t), r * Math.sin(2 * t), .35 * Math.sin(3 * t)];
    });
  },
};
const ORDER = ['ring', 'sphere', 'diamond', 'stack', 'burst', 'knot'];
const MOOD_SHAPE = { green: 'ring', amber: 'knot', red: 'diamond' };

const agents = new Set();
let raf = 0, pointer = { x: -1e4, y: -1e4 };
addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

class Agent {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    host.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.size = host.clientWidth || parseFloat(getComputedStyle(host).width) || 100;
    const small = this.size < 60;
    this.n = Number(host.dataset.dots) || (small ? 12 : this.size < 140 ? 32 : 84);
    this.dot = Number(host.dataset.dot) || Math.max(1, this.size / (small ? 16 : 72));
    this.shapeIndex = Math.floor(Math.random() * ORDER.length);
    this.target = this.build(host.dataset.shape || ORDER[this.shapeIndex]);
    this.pts = this.target.map(p => ({ x: p[0] * .2, y: p[1] * .2, z: 0, vx: 0, vy: 0, seed: Math.random() * TAU }));
    this.spin = Math.random() * TAU;
    this.next = performance.now() + 4000 + Math.random() * 3000;
    this.scale = 1; this.energy = 0;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }
  build(name) {
    this.shape = name;
    const pts = SHAPES[name](this.n);
    // Order points by angle so morphs travel around the form instead of crossing it.
    return pts.map(p => ({ p, a: Math.atan2(p[1], p[0]) })).sort((a, b) => a.a - b.a).map(o => o.p);
  }
  morph(name) { if (name && name !== this.shape) this.target = this.build(name); }
  resize() {
    const r = this.host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    this.size = Math.min(r.width, r.height) || r.width;
    if (!this.host.dataset.dot) this.dot = Math.max(1, this.size / (this.size < 60 ? 16 : 72));
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }
  frame(now, dt) {
    const h = this.host, cl = h.classList;
    if (!h.isConnected) { agents.delete(this); return; }
    if (h.offsetParent === null && getComputedStyle(h).position !== 'fixed') return;
    if (!this.w) { this.resize(); if (!this.w) return; }
    const mood = h.dataset.mood;
    const speaking = cl.contains('speaking'), thinking = cl.contains('thinking'), listening = cl.contains('listening');

    // Choose a formation.
    if (h.dataset.shape) this.morph(h.dataset.shape);
    else if (mood && MOOD_SHAPE[mood]) this.morph(MOOD_SHAPE[mood]);
    else if (thinking) this.morph('sphere');
    else if (now > this.next) {
      this.shapeIndex = (this.shapeIndex + 1) % ORDER.length;
      this.morph(ORDER[this.shapeIndex]);
      this.next = now + 5200 + Math.random() * 2600;
    }

    const wantScale = (cl.contains('in') ? 1.32 : 1) * (listening ? 1.12 : 1) * (mood === 'red' ? .86 : 1);
    this.scale += (wantScale - this.scale) * Math.min(1, dt * (cl.contains('in') ? .7 : 4));
    const wantEnergy = speaking ? 1 : thinking ? .7 : listening ? .5 : mood === 'amber' ? .45 : mood === 'red' ? .8 : .12;
    this.energy += (wantEnergy - this.energy) * Math.min(1, dt * 3);
    this.spin += dt * (.18 + this.energy * (thinking ? 2.2 : .6));

    const { ctx, w, hgt = this.h } = { ctx: this.ctx, w: this.w, hgt: this.h };
    ctx.clearRect(0, 0, w, hgt);
    const cx = w / 2, cy = hgt / 2, R = this.size / 2 - this.dot * 2;
    const rect = this.canvas.getBoundingClientRect();
    const mx = pointer.x - rect.left, my = pointer.y - rect.top;
    const cos = Math.cos(this.spin), sin = Math.sin(this.spin);
    const tilt = .38, ct = Math.cos(tilt), st = Math.sin(tilt);
    const ink = getComputedStyle(h).color || '#2b2c29';
    ctx.fillStyle = ink;

    const speakPulse = speaking ? .06 * Math.sin(now / 90) + .05 * Math.sin(now / 37) : 0;
    const k = reduced ? 1 : Math.min(1, dt * 5.5);

    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i], t = this.target[i];
      // Rotate target around Y, then tilt toward the viewer.
      let x = t[0] * cos + t[2] * sin, z = -t[0] * sin + t[2] * cos, y = t[1];
      if (this.shape === 'ring' || this.shape === 'diamond' || this.shape === 'burst') { x = t[0] * Math.cos(this.spin * .4) - t[1] * Math.sin(this.spin * .4); y = t[0] * Math.sin(this.spin * .4) + t[1] * Math.cos(this.spin * .4); z = 0; }
      const y2 = y * ct - z * st, z2 = y * st + z * ct;
      const wob = this.energy * .09 * Math.sin(now / 400 + p.seed * 3) + speakPulse;
      let tx = cx + x * R * this.scale * (1 + wob), ty = cy + y2 * R * this.scale * (1 + wob);
      // Drift.
      tx += Math.sin(now / 1300 + p.seed) * R * .025;
      ty += Math.cos(now / 1500 + p.seed * 1.3) * R * .025;
      // Spring toward target, with damping.
      const px = cx + p.x * R, py = cy + p.y * R;
      p.vx = (p.vx + (tx - px) * k * 6) * .72;
      p.vy = (p.vy + (ty - py) * k * 6) * .72;
      let nx = px + p.vx * dt * 10, ny = py + p.vy * dt * 10;
      // Shy away from the pointer.
      const dx = nx - mx, dy = ny - my, d2 = dx * dx + dy * dy, reach = R * .9;
      if (d2 < reach * reach && !reduced) { const d = Math.sqrt(d2) || 1, f = (1 - d / reach) * R * .18; nx += dx / d * f; ny += dy / d * f; }
      p.x = (nx - cx) / R; p.y = (ny - cy) / R; p.z += (z2 - p.z) * k;
      const depth = (p.z + 1) / 2;
      ctx.globalAlpha = .35 + .65 * (1 - depth * .7);
      ctx.beginPath();
      ctx.arc(nx, ny, this.dot * (.75 + (1 - depth) * .45), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  agents.forEach(a => a.frame(now, dt));
  raf = agents.size ? requestAnimationFrame(loop) : 0;
}

export function mountAgents(root = document) {
  root.querySelectorAll('.agent').forEach(el => {
    if (el._agent) return;
    el._agent = new Agent(el);
    agents.add(el._agent);
  });
  if (!raf) raf = requestAnimationFrame(loop);
}
