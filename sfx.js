// Little game sounds, made on the fly with Web Audio (no sound files needed).
// Each sound is a short oscillator or noise burst with a fast volume envelope.
let ac = null;
const ctx = () => { ac ||= new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };

// one tone: frequency glides from f0 to f1, volume rises fast then fades out over `dur` seconds
function tone(f0, f1, dur, vol = .2, type = 'sine', delay = 0) {
  const a = ctx(), t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .05);
}
// short burst of filtered noise (splashes, thuds)
function noise(dur, freq, vol = .15, q = 1) {
  const a = ctx(), t = a.currentTime, n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start(t);
}

export const sfx = {
  on: true,
  // bubble: a quick upward "blip" plus a tiny wet click
  pop() { if (!this.on) return; const p = 1 + Math.random() * .3; tone(500 * p, 1400 * p, .07, .22); noise(.03, 3000, .08, 2); },
  // boat catches a drop: soft high "plip"
  drop() { if (!this.on) return; tone(1200, 700, .12, .15); tone(1800, 1300, .08, .06, 'sine', .03); },
  // boat hits a stone: low wooden knock
  thud() { if (!this.on) return; tone(160, 70, .18, .3, 'triangle'); noise(.08, 400, .12); },
  // bell: a few inharmonic partials ringing out for ~2 s, like a small brass bell
  bell() { if (!this.on) return; const f = 660; [[1, .18, 2.2], [2.4, .08, 1.4], [3.9, .05, .9], [5.4, .03, .6]].forEach(([m, v, d]) => tone(f * m, f * m * .998, d, v)); },
  // seed caught: two soft rising notes
  seed() { if (!this.on) return; tone(880, 880, .25, .12); tone(1320, 1320, .35, .1, 'sine', .09); },
};
