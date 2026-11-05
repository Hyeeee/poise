// Calm generative background music, made live with Web Audio (no audio files, no licensing).
// Soft pad chords with a slow swell, a warm low drone, and an occasional bell, all through a
// gentle reverb. start() can be called on page load: if the browser blocks sound until the
// first interaction, it begins at the first click, tap or key press.

let waiting = false, wanted = false;
let ctx, analyser, levelBuf, master, duckGain, reverb, playing = false, timer = null, bellTimer = null, step = 0;

// Slow progression in D major: Dmaj9 → Bm11 → Gmaj9 → Aadd9 (frequencies in Hz).
const CHORDS = [
  [146.83, 220.0, 277.18, 329.63, 440.0],
  [123.47, 185.0, 220.0, 293.66, 369.99],
  [98.0, 196.0, 246.94, 293.66, 369.99],
  [110.0, 164.81, 220.0, 277.18, 329.63],
];
const BELLS = [587.33, 659.25, 739.99, 880.0, 987.77];
const CHORD_SECONDS = 9;

function impulse(seconds = 4.5) {
  const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

function setup() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0;
  duckGain = ctx.createGain(); duckGain.gain.value = 1;
  reverb = ctx.createConvolver(); reverb.buffer = impulse();
  const wet = ctx.createGain(); wet.gain.value = .55;
  const dry = ctx.createGain(); dry.gain.value = .5;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1800;
  tone.connect(dry).connect(duckGain);
  tone.connect(reverb).connect(wet).connect(duckGain);
  duckGain.connect(master).connect(ctx.destination);
  analyser = ctx.createAnalyser(); analyser.fftSize = 256; levelBuf = new Uint8Array(analyser.frequencyBinCount);
  master.connect(analyser);
  setup.input = tone;
}

function pad(freqs, at, attack = 3.5) {
  const dur = CHORD_SECONDS + 4;
  freqs.forEach((f, i) => {
    for (const detune of [-6, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f; o.detune.value = detune;
      const peak = (i === 0 ? .09 : .045) / 2;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.setValueAtTime(peak, at + dur - 4);
      g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g).connect(setup.input);
      o.start(at); o.stop(at + dur + .1);
    }
  });
}

function bell() {
  if (!playing) return;
  const at = ctx.currentTime + .05, f = BELLS[Math.floor(Math.random() * BELLS.length)];
  [1, 2.01].forEach((m, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f * m;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(i ? .008 : .03, at + .02);
    g.gain.exponentialRampToValueAtTime(.0001, at + 4);
    o.connect(g).connect(setup.input);
    o.start(at); o.stop(at + 4.2);
  });
  bellTimer = setTimeout(bell, 5000 + Math.random() * 7000);
}

function schedule() {
  if (!playing) return;
  pad(CHORDS[step % CHORDS.length], ctx.currentTime + .05);
  step++;
  timer = setTimeout(schedule, CHORD_SECONDS * 1000);
}

export const ambient = {
  get playing() { return playing || wanted; },
  start() {
    if (playing) return;
    if (!ctx) setup();
    ctx.resume().catch(() => {});
    // Browsers keep audio locked until the first interaction. If it's still locked,
    // wait for it instead of piling up notes on a frozen clock.
    if (ctx.state !== 'running') {
      if (!waiting) {
        waiting = true;
        const unlock = e => {
          if (e.target?.closest?.('.music-btn')) return; // the music button decides for itself
          ctx.resume().then(() => {
            ['pointerdown', 'keydown', 'touchstart'].forEach(e => removeEventListener(e, unlock, true));
            waiting = false;
            if (wanted) { wanted = false; this.start(); }
          }).catch(() => {});
        };
        ['pointerdown', 'keydown', 'touchstart'].forEach(e => addEventListener(e, unlock, true));
      }
      wanted = true;
      return;
    }
    playing = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(.7, ctx.currentTime + .6);
    pad(CHORDS[0], ctx.currentTime + .02, .5); step = 1;
    timer = setTimeout(schedule, CHORD_SECONDS * 1000);
    bellTimer = setTimeout(bell, 600);
  },
  stop() {
    wanted = false;
    if (!playing) return;
    playing = false;
    clearTimeout(timer); clearTimeout(bellTimer);
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  },
  // 0..1 loudness for visuals: [low, mid, high].
  level() {
    if (!analyser || !playing) return [0, 0, 0];
    analyser.getByteFrequencyData(levelBuf);
    const band = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += levelBuf[i]; return t / (b - a) / 255; };
    return [band(1, 6), band(6, 24), band(24, 64)];
  },
  toggle() { if (playing || wanted) { this.stop(); return false; } this.start(); return true; },
  // Lower the music while Poise is speaking.
  duck(on) {
    if (!ctx) return;
    duckGain.gain.cancelScheduledValues(ctx.currentTime);
    duckGain.gain.setTargetAtTime(on ? .35 : 1, ctx.currentTime, .4);
  },
};
