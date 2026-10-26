// Poise settings: focus modes, break modes, and preferences. Saved on this device only.
const KEY = 'poise.settings.v2';

export const SENSITIVITY = {
  gentle:   { label: 'Gentle',   threshold: 26 },
  balanced: { label: 'Balanced', threshold: 18 },
  firm:     { label: 'Firm',     threshold: 12 },
};
export const SENS_ORDER = ['gentle', 'balanced', 'firm'];

const DEFAULT_WORK = [
  { id: 'deep',   name: 'Deep focus',   focus: 50, sensitivity: 'gentle',   delay: 10, eyes: true,  chime: false, preset: true },
  { id: 'flow',   name: 'Steady flow',  focus: 25, sensitivity: 'balanced', delay: 5,  eyes: true,  chime: false, preset: true },
  { id: 'sprint', name: 'Quick sprint', focus: 15, sensitivity: 'firm',     delay: 3,  eyes: false, chime: true,  preset: true },
];
const DEFAULT_BREAK = [
  { id: 'stretch', name: 'Stretch along', style: 'stretch', count: 5, minutes: 3, auto: true, preset: true },
  { id: 'breathe', name: 'Reset',         style: 'breathe', count: 3, minutes: 2, auto: true, preset: true },
  { id: 'game',    name: 'Reach & pop',   style: 'game',    count: 5, minutes: 1, auto: true, preset: true },
];

function defaults() {
  return {
    onboarded: false,
    voice: true,
    music: true,
    joints: true,
    works: structuredClone(DEFAULT_WORK),
    breaks: structuredClone(DEFAULT_BREAK),
    workId: 'flow',
    breakId: 'stretch',
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    const base = defaults();
    const state = { ...base, ...saved };
    if (!Array.isArray(state.works) || !state.works.length) state.works = base.works;
    if (!Array.isArray(state.breaks) || !state.breaks.length) state.breaks = base.breaks;
    // One stretch mode now (Light move merged in), plus the movement game.
    state.breaks = state.breaks.filter(m => m.id !== 'move');
    const rb = state.breaks.find(m => m.id === 'breathe' && m.preset); if (rb && rb.name === 'Breathe') { rb.name = 'Reset'; rb.minutes = 2; }
    for (const m of base.breaks) if (!state.breaks.some(b => b.id === m.id)) state.breaks.push(m);
    if (!state.breaks.some(b => b.id === state.breakId)) state.breakId = state.breaks[0].id;
    return state;
  } catch { return defaults(); }
}

const listeners = new Set();
export const store = {
  state: load(),
  work() { return this.state.works.find(m => m.id === this.state.workId) || this.state.works[0]; },
  brk() { return this.state.breaks.find(m => m.id === this.state.breakId) || this.state.breaks[0]; },
  update(fn) {
    fn(this.state);
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch {}
    listeners.forEach(cb => cb(this.state));
  },
  on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  reset() { this.update(s => Object.assign(s, defaults())); },
};

export function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Create a mode copied from the current one. kind: 'work' | 'break'. Returns the new mode. */
export function createMode(kind, name) {
  let made;
  store.update(s => {
    const list = kind === 'work' ? s.works : s.breaks;
    const from = kind === 'work' ? store.work() : store.brk();
    made = { ...structuredClone(from), id: uid(kind[0]), name: (name || `${from.name} copy`).slice(0, 32), preset: false };
    list.push(made);
    if (kind === 'work') s.workId = made.id; else s.breakId = made.id;
  });
  return made;
}

export function deleteMode(kind, id) {
  store.update(s => {
    const key = kind === 'work' ? 'works' : 'breaks';
    if (s[key].length <= 1) return;
    s[key] = s[key].filter(m => m.id !== id);
    if (kind === 'work' && s.workId === id) s.workId = s.works[0].id;
    if (kind === 'break' && s.breakId === id) s.breakId = s.breaks[0].id;
  });
}

export function patchMode(kind, patch) {
  store.update(s => {
    const mode = kind === 'work' ? store.work() : store.brk();
    Object.assign(mode, patch);
  });
}

export function describeWork(m) {
  return `${m.focus} min focus, ${SENSITIVITY[m.sensitivity].label.toLowerCase()} cues after ${m.delay}s${m.eyes ? ', eye care on' : ''}`;
}
export function describeBreak(m) {
  if (m.style === 'breathe') return `${m.minutes} min reset: shoulder-drop breathing + eye rest`;
  if (m.style === 'game') return `${m.minutes} min movement game`;
  return `${m.count} guided stretch${m.count > 1 ? 'es' : ''}`;
}
