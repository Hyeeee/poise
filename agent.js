// Poise's presence: a cloud of dots that drifts between formations and reacts to what is happening.
// Mount on any element with class "agent". The host's classes drive behaviour:
//   .speaking  pulses with the voice      .thinking  spins and gathers
//   .listening opens up and leans in      .in        expands (breathing)
// data-mood="green|amber|red|idle" changes how calm it is. data-shape pins one formation.

const TAU = Math.PI * 2;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Each formation returns N points in a unit space (-1..1), z used for depth.
// Every formation is a 3D solid with evenly spaced points, so rotation keeps the grid aligned.
function grid(n, rows, fn) {
  const cols = Math.ceil(n / rows), out = [];
  for (let r = 0; r < rows && out.length < n; r++)
    for (let c = 0; c < cols && out.length < n; c++) out.push(fn(r / Math.max(1, rows - 1), c / cols, r, c));
  return out;
}
const rowsFor = n => Math.max(3, Math.round(Math.sqrt(n / 2)));
const SHAPES = {
  cylinder(n) { return grid(n, rowsFor(n), (v, u) => { const a = u * TAU; return [Math.cos(a) * .72, -.78 + v * 1.56, Math.sin(a) * .72]; }); },
  sphere(n) {
    const g = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: n }, (_, i) => {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = g * i;
      return [Math.cos(a) * r * .9, y * .9, Math.sin(a) * r * .9];
    });
  },
  torus(n) { return grid(n, rowsFor(n), (v, u, r, c) => { const a = u * TAU, b = (r / rowsFor(n)) * TAU; const R = .62 + .26 * Math.cos(b); return [Math.cos(a) * R, .26 * Math.sin(b), Math.sin(a) * R]; }); },
  vase(n) { return grid(n, rowsFor(n), (v, u, r) => { const a = u * TAU + r * .2, rad = .38 + .4 * Math.sin(v * Math.PI); return [Math.cos(a) * rad, -.8 + v * 1.6, Math.sin(a) * rad]; }); },
  cone(n) { return grid(n, rowsFor(n), (v, u, r) => { const a = u * TAU + r * .25, rad = .3 + .56 * v; return [Math.cos(a) * rad, -.82 + v * 1.64, Math.sin(a) * rad]; }); },
  helix(n) {
    return Array.from({ length: n }, (_, i) => {
      const s = i % 2, t = Math.floor(i / 2) / Math.ceil(n / 2), a = t * TAU * 2 + s * Math.PI;
      return [Math.cos(a) * .62, -.85 + t * 1.7, Math.sin(a) * .62];
    });
  },
  // A coiled spring: one continuous line wound around the body's axis.
  spring(n) {
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1), a = t * TAU * 5.5;
      return [Math.cos(a) * .58, -.82 + t * 1.64, Math.sin(a) * .58];
    });
  },
  // A flattened pebble: the sphere after a long breath out.
  pebble(n) { return SHAPES.sphere(n).map(([x, y, z]) => [x * 1.05, y * .5, z * 1.05]); },
  // An hourglass: a slow breath, wide at the top and bottom, narrow at the waist.
  hourglass(n) { return grid(n, rowsFor(n), (v, u, r) => { const a = u * TAU + r * .3, rad = .22 + .52 * Math.abs(v * 2 - 1); return [Math.cos(a) * rad, -.8 + v * 1.6, Math.sin(a) * rad]; }); },
  // A ring that ripples up and down: balance.
  wave(n) {
    // Three rings stacked like a ribbon, all following the same slow ripple.
    const rows = 3, per = Math.ceil(n / rows);
    return Array.from({ length: n }, (_, i) => {
      const r = Math.floor(i / per), a = (i % per) / per * TAU + r * .12;
      return [Math.cos(a) * .8, .24 * Math.sin(a * 3) + (r - 1) * .22, Math.sin(a) * .8];
    });
  },
  // A double helix, two strands wound together: health, life.
  dna(n) {
    return Array.from({ length: n }, (_, i) => {
      const s = i % 2, t = Math.floor(i / 2) / Math.ceil(n / 2), a = t * TAU * 1.6 + s * Math.PI;
      return [Math.cos(a) * .5, -.86 + t * 1.72, Math.sin(a) * .5];
    });
  },
};
// The sphere is home: Poise moves through five symbols, then returns to it and loops.
const ORDER = ['sphere', 'spring', 'hourglass', 'wave', 'dna', 'pebble'];
const MOOD_SHAPE = { green: 'sphere', amber: 'spring', red: 'hourglass' };

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
    this.shapeIndex = 0;
    this.target = this.build(host.dataset.shape || ORDER[this.shapeIndex]);
    this.pts = this.target.map(p => ({ x: p[0] * .2, y: p[1] * .2, z: 0, vx: 0, vy: 0, seed: Math.random() * TAU }));
    this.spin = Math.random() * TAU;
    this.next = performance.now() + 9000;
    this.scale = 1; this.energy = 0;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }
  build(name) {
    this.shape = name;
    const pts = SHAPES[name](this.n);
    // Order points by angle so morphs travel around the form instead of crossing it.
    return pts.map(p => ({ p, k: Math.round((p[1] + 1) * 6) * 10 + (Math.atan2(p[2], p[0]) + Math.PI) })).sort((a, b) => a.k - b.k).map(o => o.p);
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
      this.next = now + (this.shape === 'sphere' ? 9000 : 7000);
    }

    const wantScale = (cl.contains('in') ? 1.32 : 1) * (listening ? 1.12 : 1) * (mood === 'red' ? .86 : 1);
    this.scale += (wantScale - this.scale) * Math.min(1, dt * (cl.contains('in') ? .7 : 4));
    const wantEnergy = speaking ? 1 : thinking ? .7 : listening ? .5 : mood === 'amber' ? .45 : mood === 'red' ? .8 : .12;
    this.energy += (wantEnergy - this.energy) * Math.min(1, dt * 3);
    this.spin += dt * (.12 + this.energy * (thinking ? 2.2 : .6));

    const { ctx, w, hgt = this.h } = { ctx: this.ctx, w: this.w, hgt: this.h };
    ctx.clearRect(0, 0, w, hgt);
    const cx = w / 2, cy = hgt / 2, R = (this.size / 2 - this.dot * 2) * .8;
    const rect = this.canvas.getBoundingClientRect();
    const mx = pointer.x - rect.left, my = pointer.y - rect.top;
    const cos = Math.cos(this.spin), sin = Math.sin(this.spin);
    const tilt = .38, ct = Math.cos(tilt), st = Math.sin(tilt);
    const ink = getComputedStyle(h).color || '#2b2c29';
    ctx.fillStyle = ink;

    const speakPulse = speaking ? .06 * Math.sin(now / 90) + .05 * Math.sin(now / 37) : 0;
    const k = reduced ? 1 : Math.min(1, dt * 1.6);

    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i], t = this.target[i];
      // Rotate target around Y, then tilt toward the viewer.
      let x = t[0] * cos + t[2] * sin, z = -t[0] * sin + t[2] * cos, y = t[1];
      const y2 = y * ct - z * st, z2 = y * st + z * ct;
      const wob = this.energy * .06 * Math.sin(now / 420 + y * 3) + speakPulse;
      let tx = cx + x * R * this.scale * (1 + wob), ty = cy + y2 * R * this.scale * (1 + wob);
      // Drift.
      ty += Math.sin(now / 1600) * R * .02;
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
