import { GuidePlayer } from './guide.js';
import { store, SENSITIVITY, SENS_ORDER, createMode, deleteMode, patchMode, describeWork, describeBreak, clamp } from './settings.js';
import { runOnboarding, speak } from './onboarding.js';
import { respond } from './assistant.js';
import { mountAgents } from './agent.js';
import { ambient } from './ambient.js';
import { mountPainting } from './painting.js';
import { MoveGame } from './game.js';
import { sensor, readSensor, stopSensor } from './sensor.js';
mountPainting();
// Welcome entrance: words drift in, then the buttons.
(() => {
  const lede = document.querySelector('.welcome-main .lede');
  if (!lede || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  lede.querySelectorAll('b, span').forEach(part => {
    const words = part.textContent.split(' ');
    part.innerHTML = words.map(w => `<span class="word" style="animation-delay:${600 + (i++) * 90}ms">${w}</span>`).join(' ');
  });
  document.querySelector('.welcome-main').style.setProperty('--cta-delay', `${600 + i * 90 + 250}ms`);
  document.body.classList.add('enter');
})();
import { startTour } from './tour.js';
import { session as posture, showReport, breakLog, showBreakReport } from './report.js';

const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const camera = $('camera'), canvas = $('skeleton'), ctx = canvas.getContext('2d');

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5.5" width="3.6" height="13" rx="1"/><rect x="13.9" y="5.5" width="3.6" height="13" rx="1"/></svg>',
};
const colors = { green: '#4fbf73', amber: '#f0a020', red: '#e5483d', idle: '#b3c2d8', white: '#e9e7df' };

// ---------- State ----------
let session = 0, screen = 'work', stream, pose, face, loading = false, active = false;
let landmarks = null, reference = null, lastFrame = -1, lastDetect = 0, lastFace = 0;
let driftSince = 0, nearSince = 0, recoverAt = 0, lastState = 'idle', blinkTimes = [], eyesClosed = false, faceStart = 0;
let remaining = store.work().focus * 60, timerRunning = false, timerLast = 0, lastFocus = store.work().focus;
let stats = { green: 0, amber: 0, red: 0 }, lastStatTick = 0;
let port, writer, lastSerial = '', lastSerialTime = 0, serialBusy = false, toastTimeout;

const threshold = () => SENSITIVITY[store.work().sensitivity].threshold;
const strongDelay = () => store.work().delay * 1000;

// ---------- Output: light bar, toast, chime ----------
// state: green | amber | red | idle | white. rgb (optional) sends an exact blended color to the bar.
function light(state, rgb) {
  document.documentElement.style.setProperty('--signal', rgb ? `rgb(${rgb.join(',')})` : colors[state]);
  $('state-agent').dataset.mood = state === 'white' ? 'green' : state;
  const msg = rgb ? `RGB ${rgb.join(' ')}` : state.toUpperCase();
  if (writer && (lastSerial !== msg || performance.now() - lastSerialTime > 1000) && !serialBusy) {
    serialBusy = true;
    writer.write(new TextEncoder().encode(msg + '\n'))
      .then(() => { lastSerial = msg; lastSerialTime = performance.now(); })
      .catch(() => { writer = null; $('connect').classList.remove('on'); toast('Light bar disconnected'); })
      .finally(() => { serialBusy = false; });
  }
}
function toast(msg) {
  text('toast', msg); $('toast').hidden = false;
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
let audio;
function chime() {
  try {
    audio ||= new AudioContext();
    const now = audio.currentTime;
    [660, 880].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * .12);
      g.gain.linearRampToValueAtTime(.12, now + i * .12 + .02);
      g.gain.exponentialRampToValueAtTime(.0001, now + i * .12 + .9);
      o.connect(g).connect(audio.destination); o.start(now + i * .12); o.stop(now + i * .12 + 1);
    });
  } catch {}
}

// ---------- Camera + models ----------
function enter() { $('welcome').hidden = true; $('studio').hidden = false; syncUI(); }

async function models() {
  if (pose) return;
  const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
  const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
  pose = await PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
    runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .55, minTrackingConfidence: .55,
  });
  try {
    face = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
    });
  } catch { face = null; }
}

async function start() {
  if (loading || active) return;
  loading = true;
  const run = ++session;
  for (const id of ['start', 'enable']) $(id).disabled = true;
  text('start-status', 'Starting camera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    if (run !== session) { stream.getTracks().forEach(t => t.stop()); return; }
    camera.srcObject = stream; await camera.play();
    enter();
    setChip('Loading tracking…');
    await models();
    if (run !== session) return;
    active = true; lastFrame = -1; faceStart = performance.now();
    $('empty-camera').hidden = true;
    syncRef();
    $('stop').classList.add('on'); $('stop').setAttribute('aria-label', 'Turn camera off');
    text('start-status', '');
    setChip('Find your frame', false);
    requestAnimationFrame(loop);
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop()); stream = null; camera.srcObject = null; active = false;
    const msg = e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow it in your browser settings, then try again.'
      : e.name === 'NotFoundError' ? 'No camera found. Connect one and try again.'
      : 'Tracking could not start. Check your connection and try again.';
    text('start-status', msg); setChip('Camera off'); toast(msg);
  } finally {
    loading = false;
    for (const id of ['start', 'enable']) $(id).disabled = false;
  }
}

function stop() {
  session++; active = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null; camera.srcObject = null;
  landmarks = null; reference = null; if (!sensorRef) timerRunning = false; holdStart = 0; driftSince = 0; nearSince = 0; blinkTimes = []; eyesClosed = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('empty-camera').hidden = false;
  syncRef();
  $('stop').classList.remove('on'); $('stop').setAttribute('aria-label', 'Turn camera on');
  setChip('Camera off');
  text('deviation', '—'); text('blinks', '—'); text('distance', '—'); text('match-score', '—');
  text('posture-state', 'Set a reference'); text('posture-hint', 'Sit the way you want to stay, then save it.'); text('calibrate', 'Set reference');
  $('hold-bar').style.width = '0'; $('deviation-bar').style.width = '0';
  renderPause(); light('idle');
}

function setChip(label, live = false) { text('tracking', label); $('tracking').classList.toggle('live', live); }

const visible = (p, ids) => p && ids.every(i => p[i] && (p[i].visibility ?? 1) > .6);
function cue(p) {
  const a = p[11], b = p[12], w = Math.hypot(a.x - b.x, a.y - b.y);
  return { x: (p[0].x - (a.x + b.x) / 2) / w, y: (p[0].y - (a.y + b.y) / 2) / w, tilt: (a.y - b.y) / w, width: w };
}

function draw(p) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w; canvas.height = h;
  if (!store.state.joints) return;
  const scale = Math.max(w / camera.videoWidth, h / camera.videoHeight), vw = camera.videoWidth * scale, vh = camera.videoHeight * scale, ox = (w - vw) / 2, oy = (h - vh) / 2;
  const xy = a => [a.x * vw + ox, a.y * vh + oy];
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5; ctx.shadowBlur = 12; ctx.shadowColor = getComputedStyle(document.documentElement).getPropertyValue('--signal');
  for (const [a, b] of [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26]]) {
    if (!visible(p, [a, b])) continue;
    ctx.beginPath(); ctx.moveTo(...xy(p[a])); ctx.lineTo(...xy(p[b])); ctx.stroke();
  }
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26]) if (visible(p, [i])) { ctx.beginPath(); ctx.arc(...xy(p[i]), 3.5, 0, Math.PI * 2); ctx.fill(); }
}

const STATE_COPY = {
  white: ['Aligned', 'Close to your reference.'],
  green: ['Back in balance', 'Nice correction.'],
  amber: ['Drifting', 'A small shift. Settle back when you can.'],
  red: ['Reset your posture', 'You have been out of position for a while.'],
};

function updateWork(p, now) {
  if (!reference) { text('posture-state', 'Set a reference'); text('posture-hint', 'Sit the way you want to stay, then save it.'); return; }
  const c = cue(p);
  let d = Math.min(100, Math.round((Math.abs(c.x - reference.x) + Math.abs(c.y - reference.y) + Math.abs(c.tilt - reference.tilt)) * 100));
  // The distance sensor is more exact about leaning toward the screen than the camera.
  let widthRatio = c.width / reference.width;
  if (sensor.live && sensor.base) { widthRatio = Math.max(widthRatio, sensor.closeness); d = Math.max(d, sensorShift()); }
  applyPosture(d, now, { x: c.x - reference.x, y: c.y - reference.y, tilt: c.tilt - reference.tilt }, widthRatio);
}
// How far you've leaned toward the screen, 0–100, from the sensor alone.
function sensorShift() {
  const k = sensor.closeness;
  return k > 1.08 ? Math.min(100, Math.round((k - 1.08) * 260)) : 0;
}
function applyPosture(d, now, delta, widthRatio) {
  text('deviation', d); $('deviation-bar').style.width = d + '%';
  let state, rgb = null;
  if (d > threshold()) {
    // Off reference: yellow up to 50% shift, blending to full red at 100% (or after the strong-cue delay).
    if (!driftSince) driftSince = now;
    const k = now - driftSince >= strongDelay() ? 1 : Math.max(0, Math.min(1, (d - 50) / 50));
    state = k >= 1 ? 'red' : 'amber';
    rgb = [255, Math.round(130 * (1 - k)), 0];
    recoverAt = 0;
  } else {
    driftSince = 0;
    // Just corrected: green for 3 seconds, then back to neutral white.
    if (lastState === 'amber' || lastState === 'red') recoverAt = now;
    state = recoverAt && now - recoverAt < 1200 ? 'green' : 'white';
  }
  if (state === 'red' && lastState !== 'red' && store.work().chime) chime();
  lastState = state;
  light(state, rgb);
  text('posture-state', STATE_COPY[state][0]); text('posture-hint', STATE_COPY[state][1]);
  // Session analysis (only while the focus timer runs).
  if (timerRunning) posture.record(now, d, state, delta, widthRatio);
  else posture.pause();
  if (store.work().eyes) {
    if (widthRatio > 1.25) { if (!nearSince) nearSince = now; text('distance', now - nearSince > 3000 ? 'Too close' : 'Close'); }
    else { nearSince = 0; text('distance', 'Good'); }
  }
}


function updateFace(now) {
  if (!face || !store.work().eyes) return;
  const r = face.detectForVideo(camera, now), s = r.faceBlendshapes?.[0]?.categories;
  if (!s) { text('blinks', '—'); return; }
  const l = s.find(x => x.categoryName === 'eyeBlinkLeft')?.score || 0, rgt = s.find(x => x.categoryName === 'eyeBlinkRight')?.score || 0;
  const closed = (l + rgt) / 2 > .45;
  if (closed && !eyesClosed) blinkTimes.push(now);
  eyesClosed = closed;
  blinkTimes = blinkTimes.filter(t => now - t < 60000);
  text('blinks', now - faceStart < 15000 ? '…' : blinkTimes.length);
}

function loop(now) {
  if (!active) return;
  try {
    if (camera.readyState >= 2 && camera.currentTime !== lastFrame && now - lastDetect > 65) {
      lastFrame = camera.currentTime; lastDetect = now;
      const r = pose.detectForVideo(camera, now);
      landmarks = r.landmarks[0];
      if (visible(landmarks, [0, 11, 12])) {
        draw(landmarks);
        setChip('Tracking', true);
        if (screen === 'work') updateWork(landmarks, now);
        else if (store.brk().style === 'stretch') updateGame(landmarks, now);
        else if (store.brk().style === 'game') moveGame.update(landmarks);
      } else {
        landmarks = null; ctx.clearRect(0, 0, canvas.width, canvas.height);
        driftSince = 0; nearSince = 0; holdStart = 0; lastStatTick = 0; posture.pause();
        setChip('Keep your head and shoulders in view');
        if (screen === 'work') { text('posture-state', 'Paused'); text('posture-hint', 'Move back into the frame to continue.'); text('deviation', '—'); }
        text('match-score', '—'); $('hold-bar').style.width = '0';
        if (!(screen === 'break' && store.brk().style === 'breathe')) light('idle');
      }
      if (now - lastFace > 120) { updateFace(now); lastFace = now; }
    }
  } catch (e) {
    stop(); toast('Tracking stopped. Turn the camera on to try again.'); return;
  }
  requestAnimationFrame(loop);
}

// Before a reference exists: the side panel is hidden and the main screen asks for one.
const hasRef = () => !!reference || sensorRef;
function syncRef() {
  $('studio').classList.toggle('no-ref', !hasRef() && screen === 'work');
  $('end-session').hidden = !hasRef();
  $('sensor-mode').hidden = !(sensor.live && !active);
  $('ref-prompt').hidden = !!reference || !active || screen !== 'work';
}
function calibrate() {
  if (!active && sensor.live && sensor.cm > 0) return calibrateSensor();
  if (!active || !visible(landmarks, [0, 11, 12])) { toast('Keep your head and both shoulders in view'); return false; }
  reference = cue(landmarks); driftSince = 0; nearSince = 0;
  sensorRef = false;
  if (sensor.live && sensor.cm > 0) sensor.base = sensor.cm;
  syncRef();
  if (!posture.active) posture.reset();
  text('calibrate', 'Reset reference');
  toast('Reference saved');
  timerRunning = true; timerLast = performance.now(); renderPause();
  maybeTour();
  return true;
}

// ---------- Break: stretch game ----------
// Each target matches the visible direction and movement in its video segment.
const poses = [
  { name: 'Shoulder release, left', tip: 'Bring the arm on the left of your mirror across your chest. Support it with your other hand.', type: 'cross', side: 'left', video: 'GcPujVayIbI', start: 8, end: 21 },
  { name: 'Shoulder release, right', tip: 'Switch sides. Bring the arm on the right of your mirror across your chest.', type: 'cross', side: 'right', video: 'GcPujVayIbI', start: 23, end: 36 },
  { name: 'Neck release, right', tip: 'Soften your shoulders. Tip your head right and slightly forward.', type: 'neck', target: 18, video: 'Q14tE13GNrs', start: 65, end: 79 },
  { name: 'Neck release, left', tip: 'Now to the left. Stay within a comfortable range.', type: 'neck', target: -18, video: 'Q14tE13GNrs', start: 81, end: 90 },
  { name: 'Upper-back release', tip: 'Wrap your arms around an imaginary cushion and let your shoulders round forward.', type: 'hug', video: 'GcPujVayIbI', start: 38, end: 56 },
];
let queue = [], round = 0, points = 0, perfect = 0, holdStart = 0, missingSince = 0, betweenUntil = 0, gameDone = false, guidePlaying = false, poseStarted = 0;
const reel = new GuidePlayer({ onPlaying(playing) { guidePlaying = playing; if (!playing) holdStart = 0; } });
const angle = (a, b, c) => { const u = [a.x - b.x, a.y - b.y], v = [c.x - b.x, c.y - b.y]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1)))) * 180 / Math.PI; };

function newGame() {
  const count = clamp(store.brk().count || 5, 1, poses.length);
  // Random subset, kept in the guide's original order so paired sides stay together.
  const picked = new Set([...poses.keys()].sort(() => Math.random() - .5).slice(0, count));
  queue = poses.filter((_, i) => picked.has(i));
  round = 0; points = 0; perfect = 0; gameDone = false; betweenUntil = 0;
  breakLog.start('stretch');
  showPose();
}
function showPose() {
  holdStart = 0; missingSince = 0; poseStarted = performance.now(); guidePlaying = false;
  const p = queue[round];
  $('reel-progress').innerHTML = queue.map((_, i) => `<span class="${i < round ? 'done' : i === round ? 'current' : ''}"></span>`).join('');
  $('reel-complete').hidden = !!p; $('pose-actions').hidden = !p;
  if (!p) {
    gameDone = true; reel.stop();
    setTimeout(() => endBreak(), 900);
    text('pose-name', 'Break complete'); text('pose-instruction', `${perfect} of ${queue.length} stretches matched.`);
    text('round', `${queue.length} / ${queue.length}`); text('hold-label', ''); text('match-score', '—');
    $('hold-bar').style.width = '100%';
    return;
  }
  text('pose-name', p.name); text('pose-instruction', p.tip); text('round', `${round + 1} / ${queue.length}`);
  text('match-score', '—'); $('hold-bar').style.width = '0';
  text('hold-label', active ? 'Watch the figure, then follow along.' : 'Turn on your camera to get a match score.');
  text('points', `${points} points`);
  breakLog.pose(p.name);
  reel.load(p);
}
function advance(passed = false) {
  if (gameDone) return;
  if (passed) breakLog.matched(); else breakLog.skipped();
  if (passed) { points += 100; perfect++; toast('Perfect  +100'); light('green'); }
  round++; betweenUntil = performance.now() + 1500; showPose(); text('points', `${points} points`);
}
// Position-based estimates, normalized by shoulder width. No video is uploaded.
function poseScore(p, target) {
  const required = target.type === 'neck' ? [7, 8, 11, 12] : [11, 12, 13, 14, 15, 16];
  if (!p || !required.every(i => p[i] && (p[i].visibility ?? 1) > .3)) return null;
  if (target.type === 'neck') { const tilt = Math.atan2(p[8].y - p[7].y, Math.abs(p[7].x - p[8].x)) * 180 / Math.PI; return Math.max(0, 100 - Math.abs(tilt - target.target) * 4); }
  const w = Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y); if (w < .04) return null;
  const mid = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  if (target.type === 'cross') {
    const left = target.side === 'left', shoulder = p[left ? 11 : 12], elbow = p[left ? 13 : 14], wrist = p[left ? 15 : 16], support = p[left ? 16 : 15];
    // Anatomical left is screen-left after the camera mirror transform.
    const across = (left ? mid.x - wrist.x : wrist.x - mid.x) / w;
    if (across < .08) return 0;
    const heightError = Math.abs((wrist.y - mid.y) / w - .12);
    const supportGap = Math.hypot(support.x - elbow.x, support.y - elbow.y) / w;
    const elbowAngle = angle(shoulder, elbow, wrist);
    return Math.max(0, 100 - heightError * 65 - Math.max(0, supportGap - .45) * 50 - Math.max(0, 120 - elbowAngle) * .35);
  }
  // Upper-back hug: both elbows bent and hands together in front of the torso.
  const handGap = Math.hypot(p[15].x - p[16].x, p[15].y - p[16].y) / w;
  const handsY = ((p[15].y + p[16].y) / 2 - mid.y) / w;
  const elbowL = angle(p[11], p[13], p[15]), elbowR = angle(p[12], p[14], p[16]);
  if (handsY > 1.05 || handsY < .12 || elbowL > 145 || elbowR > 145) return 0;
  return Math.max(0, 100 - Math.max(0, handGap - .4) * 50 - Math.abs(handsY - .55) * 45 - Math.abs(elbowL - elbowR) * .3);
}
// Lenient on purpose: get close for half a second and move on.
const PASS = 45, PASS_MS = 500;
function updateGame(p, now) {
  if (gameDone || now < betweenUntil) return;
  if (!guidePlaying) { holdStart = 0; missingSince = 0; $('hold-bar').style.width = '0'; text('hold-label', 'Play the guide to continue.'); return; }
  if (now - poseStarted < 1200) { holdStart = 0; text('hold-label', 'Watch the figure, then follow along.'); return; }
  const target = queue[round], value = poseScore(p, target);
  if (value === null) {
    holdStart = 0; $('hold-bar').style.width = '0'; text('match-score', '—'); light('idle');
    if (!missingSince) missingSince = now;
    text('hold-label', target.type === 'neck' ? 'Keep your face and shoulders in view.' : 'Keep both arms in view. Skipping in a few seconds.');
    if (target.type !== 'neck' && now - missingSince > 4000) { toast('Arms out of view. Skipped.'); advance(); }
    return;
  }
  missingSince = 0;
  const score = Math.round(value);
  breakLog.score(score);
  text('match-score', score); light(score >= PASS ? 'green' : score >= PASS - 15 ? 'amber' : 'red');
  if (score >= PASS) {
    if (!holdStart) holdStart = now;
    const elapsed = now - holdStart;
    $('hold-bar').style.width = Math.min(100, elapsed / PASS_MS * 100) + '%';
    text('hold-label', 'Nice, that\'s it.');
    if (elapsed >= PASS_MS) advance(true);
  } else if (score < PASS - 10) { holdStart = 0; $('hold-bar').style.width = '0'; text('hold-label', 'Mirror the figure as closely as you can.'); }
}

// ---------- Break: breathe ----------
const TIPS = ['Rest your eyes on something far away.', 'Let your shoulders drop.', 'Blink slowly a few times.', 'Unclench your jaw.'];
let breathTimer = null;
function startBreathe() {
  stopBreathe();
  const total = store.brk().minutes * 60 * 1000, began = performance.now();
  breakLog.start('breathe');
  const orb = $('breath-orb');
  let inhale = true, phaseEnd = 0;
  const tick = () => {
    const now = performance.now(), left = Math.max(0, total - (now - began));
    $('breath-bar').style.width = (100 - left / total * 100) + '%';
    text('breath-left', `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left`);
    if (!left) {
      stopBreathe(); orb.classList.remove('in'); text('breath-cue', 'Break complete'); text('breath-tip', 'Nice. Ready when you are.'); light('green');
      endBreak();
      return;
    }
    if (now >= phaseEnd) {
      inhale = !inhale || phaseEnd === 0;
      if (inhale && phaseEnd) breakLog.breath();
      const ms = inhale ? 4000 : 6000;
      orb.classList.toggle('in', inhale);
      text('breath-cue', inhale ? 'Breathe in' : 'Breathe out');
      light(inhale ? 'green' : 'idle');
      phaseEnd = now + ms;
      text('breath-tip', TIPS[Math.floor((now - began) / 20000) % TIPS.length]);
    }
  };
  tick(); breathTimer = setInterval(tick, 250);
}
function stopBreathe() { clearInterval(breathTimer); breathTimer = null; }

// ---------- Screens ----------
let breakToured = null;
function setScreen(next) {
  screen = next;
  queueMicrotask(syncRef);
  const brk = store.brk();
  $('studio').classList.toggle('break-mode', next === 'break');
  $('studio').classList.toggle('breathing', next === 'break' && brk.style === 'breathe');
  $('work-panel').hidden = next !== 'work';
  $('break-panel').hidden = !(next === 'break' && brk.style === 'stretch');
  $('breathe-panel').hidden = !(next === 'break' && brk.style === 'breathe');
  $('game-panel').hidden = !(next === 'break' && brk.style === 'game');
  $('break-switch').hidden = next !== 'break';
  document.querySelectorAll('#break-switch button').forEach(b => b.classList.toggle('active', b.dataset.style === brk.style));
  $('work').classList.toggle('active', next === 'work'); $('break').classList.toggle('active', next === 'break');
  holdStart = 0; driftSince = 0; light('idle');
  reel.stop(); stopBreathe(); moveGame.stop();
  if (next === 'break') {
    timerRunning = false; renderPause();
    if (breakToured === null) breakToured = !ALWAYS_ONBOARD && !!store.state.breakToured;
    if (!breakToured) {
      breakToured = true; store.update(st => { st.breakToured = true; });
      setTimeout(() => startTour(() => { if (screen === 'break') startBreakStyle(brk); }, brk.style), 400);
      return;
    }
    startBreakStyle(brk);
  } else {
    remaining = store.work().focus * 60; renderTimer();
    if (hasRef()) { timerRunning = true; timerLast = performance.now(); renderPause(); }
  }
}

function renderTimer() {
  const total = store.work().focus * 60;
  text('timer', `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`);
  $('timer-bar').style.width = (1 - remaining / total) * 100 + '%';
}
function renderPause() {
  $('pause').innerHTML = timerRunning ? ICON.pause : ICON.play;
  $('pause').setAttribute('aria-label', timerRunning ? 'Pause timer' : 'Start timer');
}
setInterval(() => {
  const now = performance.now();
  if (timerRunning && (active || sensorRef) && !away && screen === 'work' && !document.hidden) {
    remaining = Math.max(0, remaining - (now - timerLast) / 1000);
    renderTimer();
    if (!remaining) {
      chime();
      endSession('timer');
    }
  }
  timerLast = now;
}, 200);

// Keep panel text in sync with the current modes.
function syncUI() {
  const work = store.work(), brk = store.brk();
  if (work.focus !== lastFocus) { lastFocus = work.focus; remaining = work.focus * 60; }
  text('work-mode-name', work.name);
  text('next-break', `Then ${brk.name.toLowerCase()}: ${describeBreak(brk)}`);
  $('eye-stat').hidden = !work.eyes; $('dist-stat').hidden = !work.eyes;
  document.querySelector('.card.stats').hidden = true;
  renderTimer(); renderPause();
  if (screen === 'break') {
    const showing = !$('break-panel').hidden ? 'stretch' : !$('breathe-panel').hidden ? 'breathe' : 'game';
    if (showing !== brk.style && !endingBreak) setScreen('break');
  }
}
store.on(() => { syncUI(); if ($('modes').open) renderModeList(); });

// ---------- Modes sheet ----------
let tab = 'work';
function openModes(kind = tab) { tab = kind; renderModes(); if (!$('modes').open) $('modes').showModal(); }
function renderModes() {
  document.querySelectorAll('#modes-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('pref-voice').checked = store.state.voice; $('pref-music').checked = store.state.music; $('pref-joints').checked = store.state.joints;
  renderModeList(); renderEditor();
}
function renderModeList() {
  const list = tab === 'work' ? store.state.works : store.state.breaks;
  const current = tab === 'work' ? store.state.workId : store.state.breakId;
  $('mode-list').innerHTML = '';
  list.forEach(m => {
    const b = document.createElement('button');
    b.className = 'mode-chip' + (m.id === current ? ' active' : '');
    b.textContent = m.name;
    b.onclick = () => { store.update(s => { if (tab === 'work') s.workId = m.id; else s.breakId = m.id; }); renderEditor(); };
    $('mode-list').append(b);
  });
  const add = document.createElement('button');
  add.className = 'mode-chip add'; add.textContent = 'New mode';
  add.onclick = () => { createMode(tab, ''); renderModes(); $('editor').querySelector('input[type=text]')?.select(); };
  $('mode-list').append(add);
}
function field(label, control, output = '') {
  return `<div class="field"><span>${label}</span>${output}${control.replace('<input ', `<input aria-label="${label}" `)}</div>`;
}
function segmented(name, options, value) {
  return `<div class="segmented" role="group" data-seg="${name}">${options.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? 'active' : ''}">${l}</button>`).join('')}</div>`;
}
function toggle(name, checked) { return `<label class="toggle"><input type="checkbox" data-k="${name}" ${checked ? 'checked' : ''}></label>`; }
function renderEditor() {
  const ed = $('editor');
  const m = tab === 'work' ? store.work() : store.brk();
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let html = field('Name', `<input type="text" data-k="name" maxlength="32" value="${esc(m.name)}">`);
  if (tab === 'work') {
    html += field('Focus length', `<input type="range" data-k="focus" min="5" max="90" step="5" value="${m.focus}">`, `<output>${m.focus} min</output>`);
    html += field('Sensitivity', segmented('sensitivity', SENS_ORDER.map(k => [k, SENSITIVITY[k].label]), m.sensitivity));
    html += field('Strong cue after', `<input type="range" data-k="delay" min="2" max="20" step="1" value="${m.delay}">`, `<output>${m.delay}s</output>`);
    html += field('Eye care', toggle('eyes', m.eyes));
    html += field('Chime', toggle('chime', m.chime));
  } else {
    html += field('Style', segmented('style', [['stretch', 'Stretch'], ['breathe', 'Breathe'], ['game', 'Game']], m.style));
    html += m.style === 'stretch'
      ? field('Stretches', `<input type="range" data-k="count" min="1" max="5" step="1" value="${m.count}">`, `<output>${m.count}</output>`)
      : field('Length', `<input type="range" data-k="minutes" min="1" max="10" step="1" value="${m.minutes}">`, `<output>${m.minutes} min</output>`);
    html += field('Start automatically', toggle('auto', m.auto));
  }
  const list = tab === 'work' ? store.state.works : store.state.breaks;
  html += `<div class="editor-foot"><span class="sub">${tab === 'work' ? describeWork(m) : describeBreak(m)}</span>${list.length > 1 ? '<button type="button" class="danger" id="delete-mode">Delete</button>' : ''}</div>`;
  ed.innerHTML = html;

  ed.querySelectorAll('input[type=range]').forEach(inp => inp.oninput = () => {
    const v = Number(inp.value); patchMode(tab, { [inp.dataset.k]: v });
    const unit = { focus: ' min', minutes: ' min', delay: 's', count: '' }[inp.dataset.k];
    inp.parentElement.querySelector('output').textContent = v + unit;
    ed.querySelector('.editor-foot .sub').textContent = tab === 'work' ? describeWork(store.work()) : describeBreak(store.brk());
  });
  ed.querySelectorAll('input[type=checkbox]').forEach(inp => inp.onchange = () => patchMode(tab, { [inp.dataset.k]: inp.checked }));
  ed.querySelector('input[type=text]').oninput = e => patchMode(tab, { name: e.target.value.trim() || 'Untitled' });
  ed.querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => { patchMode(tab, { [b.parentElement.dataset.seg]: b.dataset.v }); renderEditor(); });
  const del = $('delete-mode');
  if (del) del.onclick = () => { deleteMode(tab, m.id); renderModes(); };
}
document.querySelectorAll('#modes-tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderModes(); });
$('pref-voice').onchange = e => store.update(s => { s.voice = e.target.checked; });
$('pref-joints').onchange = e => setJoints(e.target.checked);
$('pref-setup').onclick = () => { $('modes').close(); rerunSetup(); };
$('pref-tour').onclick = () => { $('modes').close(); setScreen('work'); startTour(); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
$('modes').addEventListener('click', e => { if (e.target === $('modes')) $('modes').close(); });

function setJoints(v) {
  store.update(s => { s.joints = v; });
  if (!v) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function rerunSetup() {
  const wasBreak = screen === 'break';
  await runOnboarding();
  if (wasBreak) setScreen('work'); else syncUI();
}

// ---------- Ask Poise ----------
const SUGGEST = ['Focus 40 minutes', 'Less sensitive', 'Breaks with breathing', 'How am I doing?'];
function addMessage(who, msg) {
  const el = document.createElement('div');
  el.className = `msg ${who}`; el.textContent = msg;
  $('messages').append(el);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function openThread(suggestions = SUGGEST) {
  $('thread').hidden = false; $('studio').classList.add('chatting');
  if (!$('messages').children.length) addMessage('poise', 'Tell me what to change. Focus length, how strict I am, eye care, your breaks, or a new mode.');
  $('suggest').innerHTML = '';
  suggestions.forEach(s => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
    b.onclick = () => send(s === 'Keep going' ? 'resume timer' : s);
    $('suggest').append(b);
  });
}
function closeThread() { $('thread').hidden = true; $('studio').classList.remove('chatting'); }

const assistantCtx = {
  work: () => store.work(), brk: () => store.brk(),
  works: () => store.state.works, breaks: () => store.state.breaks,
  patchWork: p => patchMode('work', p), patchBreak: p => patchMode('break', p),
  selectWork: id => store.update(s => { s.workId = id; }),
  selectBreak: id => store.update(s => { s.breakId = id; }),
  newMode: (kind, name) => createMode(kind, name),
  startBreak: () => setScreen('break'),
  startFocus: () => setScreen('work'),
  pauseTimer: () => { timerRunning = false; renderPause(); },
  resumeTimer: () => { if (screen !== 'work') setScreen('work'); timerRunning = true; timerLast = performance.now(); renderPause(); },
  calibrate: () => calibrate(),
  setJoints, setVoice: v => store.update(s => { s.voice = v; }),
  rerunSetup: () => { closeThread(); rerunSetup(); },
  openModes: () => openModes(),
  status: () => {
    const sum = posture.summary();
    const share = sum ? sum.aligned : null;
    const mins = Math.ceil(remaining / 60);
    const blinks = store.work().eyes && active ? blinkTimes.length : null;
    return {
      en: [share !== null ? `You've been aligned ${share}% of this session.` : 'Set a reference and start the timer to see how you are doing.',
        `${mins} min left in ${store.work().name}.`, blinks !== null ? `${blinks} blinks in the last minute.` : ''].join(' ').trim(),
      ko: [share !== null ? `이번 세션에서 ${share}% 동안 바른 자세였어요.` : '기준 자세를 저장하고 타이머를 시작하면 알려드릴게요.',
        `${store.work().name} 모드 ${mins}분 남았어요.`, blinks !== null ? `최근 1분 동안 ${blinks}번 깜빡였어요.` : ''].join(' ').trim(),
    };
  },
};

let spoken = false;
function send(message) {
  const msg = message.trim();
  if (!msg) return;
  openThread();
  addMessage('me', msg);
  $('ask-input').value = '';
  $('ask-form').classList.add('thinking'); $('ask-orb').classList.add('thinking');
  setTimeout(() => {
    const { reply } = respond(msg, assistantCtx);
    $('ask-form').classList.remove('thinking'); $('ask-orb').classList.remove('thinking');
    addMessage('poise', reply);
    if (spoken) speak(reply, $('ask-orb'), /[가-힣]/.test(reply) ? 'ko' : 'en');
    spoken = false;
    if ($('modes').open) renderEditor();
  }, 380);
}
$('ask-form').onsubmit = e => { e.preventDefault(); send($('ask-input').value); };
$('ask-input').onfocus = () => openThread();
document.addEventListener('pointerdown', e => { if (!$('ask').contains(e.target) && !$('thread').hidden) closeThread(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('thread').hidden) { closeThread(); $('ask-input').blur(); } });

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  const rec = new Recognition();
  rec.lang = navigator.languages?.some(l => l.startsWith('ko')) ? 'ko-KR' : 'en-US';
  rec.interimResults = false;
  $('mic').hidden = false;
  rec.onresult = e => { spoken = true; send(e.results[0][0].transcript); };
  rec.onend = rec.onerror = () => { $('mic').classList.remove('listening'); $('ask-orb').classList.remove('listening'); };
  $('mic').onclick = () => {
    if ($('mic').classList.contains('listening')) { rec.stop(); return; }
    try { rec.start(); $('mic').classList.add('listening'); $('ask-orb').classList.add('listening'); openThread(); } catch {}
  };
}

// ---------- End of a focus session ----------
let ending = false;
async function endSession(reason) {
  if (ending) return;
  ending = true;
  timerRunning = false; renderPause();
  const r = posture.summary();
  posture.clear();
  if (reason === 'end') { light('idle'); }
  const choice = r ? await showReport(r, line => speak(line, $('ask-orb'))) : 'break';
  ending = false;
  remaining = store.work().focus * 60; renderTimer();
  if (choice === 'break') { setScreen('break'); if (!active) toast('Turn on your camera to follow the stretches'); }
  else if (choice === 'new') {
    setScreen('work');
    if (hasRef()) { posture.reset(); timerRunning = true; timerLast = performance.now(); renderPause(); }
  } else {
    reel.stop(); stopBreathe(); stop(); closeThread();
    $('studio').hidden = true; $('welcome').hidden = false;
  }
}
$('end-session').onclick = () => endSession('end');

// ---------- Background music ----------
function syncMusic() {
  const on = store.state.music;
  document.querySelectorAll('.music-btn').forEach(b => { b.classList.toggle('off', !on); b.setAttribute('aria-pressed', String(on)); });
  if ($('pref-music')) $('pref-music').checked = store.state.music;
}
document.querySelectorAll('.music-btn').forEach(b => b.onclick = () => {
  const on = ambient.toggle();
  store.update(s => { s.music = on; });
  syncMusic();
});
$('pref-music').onchange = e => { store.update(s => { s.music = e.target.checked; }); e.target.checked ? ambient.start() : ambient.stop(); syncMusic(); };
// Browsers only allow sound after the first click anywhere on the page.
// Start the music as soon as the page opens. If the browser blocks sound until the
// first click or key press, ambient.js starts it at that moment.
if (store.state.music) ambient.start();
syncMusic();

// ---------- Wiring ----------
const ALWAYS_ONBOARD = true; // set to false after testing
async function begin(withCamera, skipSetup = false) {
  if (store.state.music) { ambient.start(); syncMusic(); }
  // Testing: always run the setup questions first, even on return visits.
  if (!skipSetup && (ALWAYS_ONBOARD || !store.state.onboarded)) {
    $('welcome').hidden = true;
    await runOnboarding();
  }
  setScreen('work');
  enter();
  tourPending = ALWAYS_ONBOARD || !store.state.toured;
  if (withCamera) start();
}
// The studio guide waits until the first reference is set, so people can start right away.
let tourPending = false;
async function maybeTour() {
  if (!tourPending) return;
  tourPending = false;
  const wasRunning = timerRunning;
  timerRunning = false; renderPause();
  await new Promise(r => setTimeout(r, 900));
  await new Promise(r => startTour(r));
  store.update(s => { s.toured = true; });
  if (wasRunning && hasRef()) { timerRunning = true; timerLast = performance.now(); renderPause(); }
}
$('start').onclick = () => begin(true);
$('preview').onclick = () => begin(true, true);
$('enable').onclick = start;
$('stop').onclick = () => (active ? stop() : start());
$('home').onclick = () => { reel.stop(); stopBreathe(); stop(); closeThread(); $('studio').hidden = true; $('welcome').hidden = false; };
$('work').onclick = () => setScreen('work');
$('break').onclick = () => setScreen('break');
$('skip').onclick = () => advance();
$('replay').onclick = () => { holdStart = 0; poseStarted = performance.now(); reel.replay(); };
$('restart-break').onclick = newGame;
$('return-work').onclick = () => setScreen('work');
$('breath-end').onclick = () => endBreak();
$('end-break').onclick = () => endBreak();
// ---------- Break: movement game ----------
const fmtClock = ms => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
let gameRgb = null;
const moveGame = new MoveGame($('game-canvas'), camera, {
  onTick({ score, left, combo, tracking }) {
    gameRgb ? light('idle', gameRgb) : light('idle');
    text('game-score', score); text('game-left', fmtClock(left));
    $('game-bar').style.width = (100 - left / (store.brk().minutes * 60000) * 100) + '%';
    text('game-label', !tracking ? 'Step back so your arms fit in the frame.' : combo > 2 ? `${combo} in a row` : 'Reach for the bubbles.');
  },
  onColor(rgb) { gameRgb = rgb; },
  onEnd(r) { breakLog.game(r); endBreak(); },
});
function resetGamePanel() {
  moveGame.stop();
  text('game-score', 0); text('game-left', fmtClock(store.brk().minutes * 60000)); $('game-bar').style.width = '0';
  text('game-label', active ? 'Step back so your arms fit in the frame.' : 'Turn on your camera to play.');
  $('game-start').hidden = false;
}
$('game-start').onclick = () => {
  if (!active) { toast('Turn on your camera to play'); return; }
  $('game-start').hidden = true;
  moveGame.start(store.brk().minutes * 60);
};
$('game-end').onclick = () => { if (moveGame.running) breakLog.game(moveGame.result()); endBreak(); };
function startBreakStyle(brk) {
  if (brk.style === 'stretch') newGame();
  else if (brk.style === 'breathe') startBreathe();
  else { breakLog.start('game'); resetGamePanel(); }
}
// Switch break type on the spot.
document.querySelectorAll('#break-switch button').forEach(b => b.onclick = () => {
  const id = { stretch: 'stretch', breathe: 'breathe', game: 'game' }[b.dataset.style];
  const own = store.state.breaks.find(m => m.style === b.dataset.style && !m.preset);
  if (store.brk().style === b.dataset.style) return;
  store.update(s => { s.breakId = own?.id || id; });
  setScreen('break');
});
let endingBreak = false;
async function endBreak() {
  if (endingBreak || screen !== 'break') return;
  endingBreak = true;
  reel.stop(); stopBreathe(); moveGame.stop(); light('idle');
  breakLog.away(breakAwayMs); breakAwayMs = 0;
  const r = breakLog.summary();
  const choice = r ? await showBreakReport(r, line => speak(line, $('ask-orb'))) : 'focus';
  endingBreak = false;
  if (choice === 'again') setScreen('break');
  else if (choice === 'focus') setScreen('work');
  else { stop(); closeThread(); $('studio').hidden = true; $('welcome').hidden = false; }
}
$('calibrate').onclick = calibrate;
$('ref-set').onclick = calibrate;
$('work-mode-name').onclick = () => openModes('work');
$('open-modes').onclick = () => openModes(screen === 'break' ? 'break' : 'work');
$('pause').onclick = () => {
  if (!active && !sensorRef) return toast('Turn on your camera first');
  timerRunning = !timerRunning; timerLast = performance.now(); renderPause();
};
// ---------- Distance sensor (HC-SR04 on the light bar) ----------
let sensorRef = false;        // posture reference taken from the sensor alone (camera off)
let away = false, awaySince = 0, backSince = 0, pausedByAway = false, breakAwayMs = 0, lastSensorTick = 0;
let tapStart = 0, tapFrom = 0, lastTap = 0;
function calibrateSensor() {
  sensor.base = sensor.cm; sensorRef = true; reference = null; driftSince = 0;
  syncRef();
  if (!posture.active) posture.reset();
  text('calibrate', 'Reset reference');
  toast(`Sensor reference saved · ${sensor.cm} cm`);
  timerRunning = true; timerLast = performance.now(); renderPause();
  $('empty-camera').hidden = true;
  setChip(`Sensor mode · ${sensor.cm} cm`, true);
  maybeTour();
  return true;
}
$('sensor-mode').onclick = () => { if (screen !== 'work') setScreen('work'); calibrateSensor(); };
sensor.on(() => {
  const now = performance.now();
  $('sensor-chip').hidden = false;
  text('sensor-chip', sensor.cm > 0 ? `${sensor.cm} cm` : '— cm');
  if (now - lastSensorTick > 180) { lastSensorTick = now; sensorTick(now); }
  sensorTap(now);
  if (!active) syncRef();
});
function sensorTick(now) {
  if (!sensor.base) return;
  // 1. Away from the desk: much farther than your reference, or nothing in range.
  const isFar = sensor.cm < 0 || sensor.cm > sensor.base + 45 || sensor.cm > 220;
  if (isFar) { backSince = 0; if (!awaySince) awaySince = now; }
  else { awaySince = 0; if (!backSince) backSince = now; }
  if (!away && awaySince && now - awaySince > 3000) {
    away = true;
    if (screen === 'work') {
      pausedByAway = timerRunning; timerRunning = false; renderPause(); posture.pause(); light('idle');
      text('posture-state', 'Away'); text('posture-hint', 'Paused until you sit back down.');
      toast('You stepped away — paused');
    }
    setChip('Away from desk');
  }
  if (away) { if (screen === 'break') breakAwayMs += 180; }
  if (away && backSince && now - backSince > 1500) {
    away = false;
    if (screen === 'work' && pausedByAway) { timerRunning = true; timerLast = performance.now(); renderPause(); toast('Welcome back'); }
    pausedByAway = false;
    setChip(active ? 'Tracking' : `Sensor mode · ${sensor.cm} cm`, true);
  }
  // 3. Camera off: posture from distance alone.
  if (sensorRef && !active && !away && screen === 'work') {
    const d = sensorShift();
    applyPosture(d, now, { x: 0, y: Math.max(0, sensor.closeness - 1), tilt: 0 }, sensor.closeness);
  }
}
// 5. Wave a hand close to the sensor (under 15 cm, briefly) to tap.
function sensorTap(now) {
  const v = sensor.raw;
  if (v > 0 && v < 15) { if (!tapStart) { tapStart = now; tapFrom = sensor.cm; } return; }
  if (tapStart) {
    const held = now - tapStart; tapStart = 0;
    if (held > 120 && held < 900 && now - lastTap > 1500) { lastTap = now; onSensorTap(); }
  }
}
function onSensorTap() {
  if (screen === 'break') {
    const style = store.brk().style;
    if (style === 'game' && !moveGame.running) $('game-start').click();
    else if (style === 'stretch') advance();
    else toast('Wave noticed');
  } else if (hasRef()) {
    timerRunning = !timerRunning; timerLast = performance.now(); renderPause();
    toast(timerRunning ? 'Timer on (sensor tap)' : 'Timer paused (sensor tap)');
  }
}

$('connect').onclick = async () => {
  if (!('serial' in navigator)) return toast('Use desktop Chrome or Edge to connect the light bar');
  try {
    if (writer) {
      await stopSensor(); $('sensor-chip').hidden = true;
      await writer.close(); writer.releaseLock(); await port.close(); writer = null;
      $('connect').classList.remove('on'); $('connect').setAttribute('aria-label', 'Connect light bar');
      return;
    }
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter(); lastSerial = '';
    $('connect').classList.add('on'); $('connect').setAttribute('aria-label', 'Disconnect light bar');
    toast('Light bar connected'); light('idle');
    readSensor(port);
  } catch (e) { if (e.name !== 'NotFoundError') toast('Check the USB connection. Another app may be using the port.'); }
};
document.addEventListener('visibilitychange', () => {
  driftSince = 0; holdStart = 0; timerLast = performance.now(); lastStatTick = 0;
  if (document.hidden) { light('idle'); reel.suspend(); }
  else if (screen === 'break' && !gameDone && !$('studio').hidden && store.brk().style === 'stretch') reel.resume();
});
window.addEventListener('pagehide', () => { reel.stop(); stream?.getTracks().forEach(t => t.stop()); });

syncUI();
renderPause();
mountAgents();
syncRef();
