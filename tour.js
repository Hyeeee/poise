// Guided tour: highlights one part of the studio at a time and dims the rest.
const $ = id => document.getElementById(id);

// Grouped after playtesting: 12 single stops became 4, one per area of the screen.
// A step can point at several elements; the highlight wraps all of them.
const WORK_STEPS = [
  { sel: ['.state'], title: 'Your posture', text: 'Your figure moves with you over your reference. Drift too far from it and Poise lets you know.' },
  { sel: ['.session'], title: 'Your session', text: 'The timer starts when you set a reference. Tap the mode name to change its length or when to notice.' },
  { sel: ['.topbar .segmented', '.tools'], title: 'Controls', text: 'Connect the light bar, turn the camera on or off, open a mini window, or change your preferences in Settings.' },
  { sel: ['#ask-form'], title: 'Ask Poise', text: 'Type or speak to change anything. Try “focus 40 minutes” or “take a break”.' },
];

const BREAK_STEPS = {
  game: [
    { sel: '#break-switch', title: 'Choose your break', text: 'Switch between stretching, a calm reset and a movement game any time.' },
    { sel: '#game-panel h2', title: 'Pop the bubbles', text: 'Bubbles appear around you. Reach up, out and down to pop them with your hands. Gold ones need a head lean.' },
    { sel: '#game-label', title: 'It starts right away', text: 'Step back so your arms fit in the frame. The bubbles start as soon as the camera sees you.' },
    { sel: '#game-end', title: 'End break', text: 'Finish any time to see your score and how you moved.' },
  ],
  stretch: [
    { sel: '#break-switch', title: 'Choose your break', text: 'Switch between stretching, a calm reset and a movement game any time.' },
    { sel: '#reel-player', title: 'Follow the figure', text: 'Watch the sketch, then copy the stretch in front of your camera.' },
    { sel: '.match', title: 'Match score', text: 'How close you are to the figure. Get near it for half a second and the next stretch begins.' },
    { sel: '#end-break', title: 'End break', text: 'Finish any time to see how long you rested and how much you followed.' },
  ],
  breathe: [
    { sel: '#break-switch', title: 'Choose your break', text: 'Switch between stretching, a calm reset and a movement game any time.' },
    { sel: '#breath-orb', title: 'Breathe, then drop', text: 'Breathe in as the dots grow. On the out-breath, let your shoulders fall. The camera measures how far, and the light bar breathes with you.' },
    { sel: '#breath-metric', title: 'Your shoulders', text: 'Shows how much lower your shoulders are than when you started. The last part of the reset rests your eyes.' },
    { sel: '#breath-bar', title: 'Time left', text: 'Your rest runs until the line fills.' },
    { sel: '#breath-end', title: 'End break', text: 'Finish any time to see your rest summary.' },
  ],
};
let STEPS = WORK_STEPS;
let i = 0, onDone = null;

const shown = e => e && e.offsetParent !== null ? e : null;
// First visible element of a step (a step's sel can be one selector or a list).
function el(sel) {
  for (const s of [].concat(sel)) { const e = shown(document.querySelector(s)); if (e) return e; }
  return null;
}
// One box around every visible element of the step.
function rectOf(sel) {
  const rs = [].concat(sel).map(s => shown(document.querySelector(s))).filter(Boolean).map(e => e.getBoundingClientRect());
  const left = Math.min(...rs.map(r => r.left)), top = Math.min(...rs.map(r => r.top));
  const right = Math.max(...rs.map(r => r.right)), bottom = Math.max(...rs.map(r => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top, many: rs.length > 1 };
}

function place() {
  const step = STEPS[i], target = el(step.sel);
  const spot = $('tour-spot'), card = $('tour-card');
  if (!target) return i + 1 < STEPS.length ? go(1, true) : end();
  target.scrollIntoView({ block: 'nearest' });
  const r = rectOf(step.sel), pad = 8;
  Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  // Match the highlight's corners to the element's own rounding (plus the padding around it).
  const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
  spot.style.setProperty('--spot-r', (r.many ? 20 : radius > 0 ? Math.min(radius, r.height / 2) + pad : 12) + 'px');
  card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
  $('tour-title').textContent = step.title;
  $('tour-text').textContent = step.text;
  $('tour-count').textContent = `${i + 1} / ${STEPS.length}`;
  $('tour-back').hidden = i === 0;
  $('tour-next').textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
  // Put the card beside the highlight, where there is room.
  const cw = Math.min(320, innerWidth - 32), ch = card.offsetHeight || 170, gap = 16;
  let left = r.left + r.width / 2 - cw / 2, top = r.bottom + gap;
  if (top + ch > innerHeight - 16) top = r.top - ch - gap;
  if (top < 16) { top = Math.max(16, r.top); left = r.left - cw - gap; if (left < 16) left = r.right + gap; }
  left = Math.max(16, Math.min(left, innerWidth - cw - 16));
  top = Math.max(16, Math.min(top, innerHeight - ch - 16));
  Object.assign(card.style, { left: left + 'px', top: top + 'px', width: cw + 'px' });
}

function go(delta, skipMissing) {
  const nextI = i + delta;
  if (nextI >= STEPS.length) return end();
  if (nextI < 0) return;
  i = nextI;
  if (skipMissing && !el(STEPS[i].sel) && i < STEPS.length - 1) return go(1, true);
  place();
}

function end() {
  $('tour').hidden = true;
  $('studio').classList.remove('touring');
  removeEventListener('resize', place);
  document.removeEventListener('keydown', keys);
  onDone?.();
}

function keys(e) {
  if (e.key === 'Escape') end();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1, true);
  else if (e.key === 'ArrowLeft') go(-1);
}

export function startTour(done, kind) {
  STEPS = kind ? (BREAK_STEPS[kind] || BREAK_STEPS.stretch) : WORK_STEPS;
  onDone = done; i = 0;
  $('tour').hidden = false;
  $('studio').classList.add('touring');
  $('tour-next').onclick = () => go(1, true);
  $('tour-back').onclick = () => go(-1);
  $('tour-skip').onclick = end;
  addEventListener('resize', place);
  document.addEventListener('keydown', keys);
  requestAnimationFrame(() => { if (!el(STEPS[0].sel)) go(1, true); else place(); $('tour-next').focus({ preventScroll: true }); });
}
