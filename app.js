import { GuidePlayer } from './guide.js';
import { store, SENSITIVITY, SENS_ORDER, createMode, deleteMode, patchMode, describeWork, describeBreak, clamp } from './settings.js';
import { runOnboarding, speak } from './onboarding.js';
import { respond } from './assistant.js';
import { mountAgents } from './agent.js';
import { ambient } from './ambient.js';
import { mountPainting } from './painting.js';
import { MoveGame } from './game.js';
import { MiniGame, GAMES } from './minigames.js';
import './seg.js';
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
import { session as posture, showReport, breakLog, showBreakReport, POSTURE_SAY } from './report.js';

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
function light(state, rgb, fast) {
  document.documentElement.style.setProperty('--signal', rgb ? `rgb(${rgb.join(',')})` : colors[state]);
  $('state-agent').dataset.mood = state === 'white' ? 'green' : state;
  const msg = rgb ? `RGB ${rgb.join(' ')}${fast ? ' ' + fast : ''}` : state.toUpperCase();
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
  // 1. The "full" model: more accurate than "lite", still real-time on a laptop.
  //    Runs on the graphics card when it can, otherwise falls back to the CPU.
  const poseOptions = delegate => ({
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', delegate },
    runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
  });
  try { pose = await PoseLandmarker.createFromOptions(files, poseOptions('GPU')); }
  catch { pose = await PoseLandmarker.createFromOptions(files, poseOptions('CPU')); }
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
    setTimeout(maybeStartGame, 300);
    if (sensorRef) { sensorRef = false; showSensorCard(); }
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
  if (sensor.live && !sensorRef) calibrateSensor(); else showSensorCard();   // camera off + sensor: straight to sensor mode
}

function setChip(label, live = false) { text('tracking', label); $('tracking').classList.toggle('live', live); }

const visible = (p, ids) => p && ids.every(i => p[i] && (p[i].visibility ?? 1) > .6);
// ---------- Steadier tracking ----------
// 2. Smoothing: each point eases toward its new position. Big moves follow quickly,
//    tiny jitters are mostly ignored (a simple version of the "One Euro" filter).
// 3. Low-confidence points: when MediaPipe isn't sure about a point, keep the last good
//    position for up to half a second instead of letting it jump around.
let smooth = null, smoothAt = [];
function smoothPose(raw, now) {
  if (!raw) { smooth = null; return null; }
  if (!smooth) { smooth = raw.map(p => ({ ...p })); smoothAt = raw.map(() => now); return smooth; }
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i], s0 = smooth[i];
    if ((r.visibility ?? 1) > .5) {
      const move = Math.hypot(r.x - s0.x, r.y - s0.y);
      const k = Math.min(.85, .25 + move * 10);
      s0.x += (r.x - s0.x) * k; s0.y += (r.y - s0.y) * k; s0.z += ((r.z ?? 0) - (s0.z ?? 0)) * k;
      s0.visibility = r.visibility; smoothAt[i] = now;
    } else if (now - smoothAt[i] > 1000) {
      s0.visibility = r.visibility;                 // gone too long: let it drop out
    }
  }
  return smooth;
}
// 4. Scene check: too dark, or shoulders cut off at the edge of the frame.
let lastLightCheck = 0, sceneIssue = '';
let camGoneSince = 0, camAway = false, camPaused = false;
const lightCanvas = document.createElement('canvas'); lightCanvas.width = 32; lightCanvas.height = 18;
function checkScene(p) {
  let issue = '';
  try {
    const g = lightCanvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(camera, 0, 0, 32, 18);
    const px = g.getImageData(0, 0, 32, 18).data;
    let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11;
    if (sum / (px.length / 4) < 55) issue = 'It’s a bit dark. Add some light in front of you';
  } catch {}
  if (!issue && p && [11, 12].some(i => p[i].x < .04 || p[i].x > .96 || p[i].y > .97)) issue = 'Move back so both shoulders are in view';
  if (!issue && p && !visible(p, [7, 8]) && visible(p, [0, 11, 12])) issue = 'Face the camera so both ears show';
  if (issue !== sceneIssue) { sceneIssue = issue; if (issue && !issue.startsWith('Face')) toast(issue); }
  if (issue) setChip(issue);
}

// Posture cue, all measured in shoulder-widths so it works at any distance.
//  x, y : where the head sits over the shoulders. Uses the ears when both are visible
//         (ears move with the whole head, so looking down at the desk barely changes them);
//         otherwise the nose.
//  tilt : one shoulder lower than the other.
//  roll : head tipped to one side (the line between the eyes).
//  width: shoulder width in the image — bigger means closer to the screen.
function cue(p) {
  const a = p[11], b = p[12], w = Math.hypot(a.x - b.x, a.y - b.y);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const ears = visible(p, [7, 8]);
  const hx = ears ? (p[7].x + p[8].x) / 2 : p[0].x, hy = ears ? (p[7].y + p[8].y) / 2 : p[0].y;
  const roll = visible(p, [2, 5]) ? (p[2].y - p[5].y) / w : 0;
  return { x: (hx - mx) / w, y: (hy - my) / w, tilt: (a.y - b.y) / w, roll, width: w, ears, sy: my };
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

// Which part of the shift is largest → a specific message.
// widthRatio > 1: shoulders look wider than at the reference = closer to the screen.
function shiftCause(delta, widthRatio = 1) {
  const parts = {
    close: widthRatio > 1 ? Math.log(widthRatio) * 2.5 : 0,
    far: widthRatio < 1 ? -Math.log(widthRatio) * 2.5 : 0,
    forward: Math.max(0, delta?.y || 0),
    side: Math.abs(delta?.x || 0) + Math.abs(delta?.roll || 0) * .6,
    shoulders: Math.abs(delta?.tilt || 0),
    slouch: (delta?.sink || 0) * 1.2,
  };
  const [key, size] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  if (size < .05) return null;
  shiftCause.key = key;
  return {
    close: ['Too close to the screen', 'Sit back a little, about an arm’s length away.'],
    far: ['Too far from the screen', 'Move a little closer so you don’t lean in to read.'],
    forward: ['Leaning forward', 'Bring your head back over your shoulders.'],
    side: ['Tilting to one side', 'Center your head between your shoulders.'],
    shoulders: ['Uneven shoulders', 'Let both shoulders drop evenly.'],
    slouch: ['Slouching back', 'Sit up and bring your shoulders back up to where they were.'],
  }[key];
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
  // If the ears were visible when the reference was saved but aren't now (or the other way round),
  // the head point moved source, so take a fresh baseline for the head.
  if (c.ears !== reference.ears) { reference = { ...reference, x: c.x, y: c.y, ears: c.ears }; }
  let d = Math.min(100, Math.round((Math.abs(c.x - reference.x) + Math.abs(c.y - reference.y) + Math.abs(c.tilt - reference.tilt) + Math.abs(c.roll - (reference.roll || 0)) * .6) * 100));
  // The distance sensor is more exact about leaning toward the screen than the camera.
  let widthRatio = c.width / reference.width;
  // Shoulders sinking in the frame = sliding down / leaning back in the chair.
  const sink = reference.sy != null ? Math.max(0, (c.sy - reference.sy) / reference.width) : 0;
  d = Math.min(100, d + Math.round(sink * 120));
  if (sensor.live && sensor.base) { widthRatio = Math.max(widthRatio, sensor.closeness); d = Math.max(d, sensorShift()); }
  applyPosture(d, now, { x: c.x - reference.x, y: c.y - reference.y, tilt: c.tilt - reference.tilt, roll: c.roll - (reference.roll || 0), sink }, widthRatio);
}
// How far you've leaned toward the screen, 0–100, from the sensor alone.
// Sensor-only mode uses the same fixed range as the light bar: 55–80 cm is good.
const SENSOR_GOOD = [55, 80];
function sensorShift() {
  if (sensorRef && sensor.cm > 0) {
    const off = sensor.cm < SENSOR_GOOD[0] ? SENSOR_GOOD[0] - sensor.cm : sensor.cm > SENSOR_GOOD[1] ? sensor.cm - SENSOR_GOOD[1] : 0;
    return Math.min(100, Math.round(Math.max(0, off - 3) * 4));
  }
  const k = sensor.closeness;
  return k > 1.08 ? Math.min(100, Math.round((k - 1.08) * 260)) : 0;
}
// ---------- Posture → light color ----------
// Small, short movements are ignored. The light only reacts when you STAY shifted:
//  1. Grace: shifted for less than 5 s (or the mode's delay, if longer) → nothing changes.
//  2. Fade to yellow: over the next 6 s the light blends slowly from white to yellow.
//  3. Fade to red: if you're still shifted 20 s later (or the shift is large, 80%+),
//     it blends from yellow to red over another 6 s.
//  4. Back in position for 1 s → green for a moment, then white again.
const GRACE_MS = () => Math.max(5000, strongDelay());
const FADE_MS = 6000, RED_AFTER_MS = 20000, SETTLE_MS = 1000;
const WHITE = [140, 140, 130], YELLOW = [255, 130, 0], RED = [255, 0, 0];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
let alignedSince = 0, cueShown = false, lastRgb = null;
function applyPosture(d, now, delta, widthRatio) {
  // Camera distance: shoulders look wider when you lean in, narrower when you sit back.
  // Counted as a shift too (20% closer or farther ≈ 45% shift).
  if (widthRatio) d = Math.max(d, Math.min(100, Math.round(Math.abs(Math.log(widthRatio)) * 250)));
  text('deviation', d); $('deviation-bar').style.width = d + '%';
  let state, rgb = null;
  if (d > threshold()) {
    alignedSince = 0;
    if (!driftSince) driftSince = now;
    const held = now - driftSince, grace = GRACE_MS();
    if (held < grace) {
      state = cueShown ? lastState : 'white';          // still within grace: no change
      if (cueShown) rgb = lastRgb;
    } else {
      cueShown = true;
      const toYellow = Math.min(1, (held - grace) / FADE_MS);
      const redStart = d >= 80 ? grace + FADE_MS : grace + RED_AFTER_MS;
      const toRed = Math.max(0, Math.min(1, (held - redStart) / FADE_MS));
      rgb = toRed > 0 ? mix(YELLOW, RED, toRed) : mix(WHITE, YELLOW, toYellow);
      state = toRed >= 1 ? 'red' : toYellow > .5 ? 'amber' : 'white';
    }
    recoverAt = 0;
  } else {
    if (!alignedSince) alignedSince = now;
    if (now - alignedSince >= SETTLE_MS || !driftSince) {
      // Settled back. Show green only if the light had actually changed.
      if (driftSince && cueShown) recoverAt = now;
      driftSince = 0; cueShown = false;
    }
    state = recoverAt && now - recoverAt < 1500 ? 'green' : driftSince ? lastState : 'white';
    if (driftSince && state !== 'green') rgb = lastRgb;
  }
  if (state === 'red' && lastState !== 'red') {
    if (store.work().chime) chime();
    // Say what's going on, once per red, in the chosen voice.
    if (store.state.voice) { shiftCause.key = null; shiftCause(delta, widthRatio); setTimeout(() => speak(POSTURE_SAY(shiftCause.key), $('state-agent')), store.work().chime ? 700 : 0); }
  }
  lastState = state; lastRgb = rgb;
  light(state, rgb);
  // Say WHAT moved, not just that something did: the biggest part of the shift wins.
  let [title, hint] = STATE_COPY[state];
  // The % label names what moved most: forward, tilt, closer, back, slouch…
  shiftCause.key = null; shiftCause(delta, widthRatio);
  const DEV_LABEL = { close: '% closer', far: '% farther', forward: '% forward', side: '% tilted', shoulders: '% uneven', slouch: '% slouched' };
  text('dev-label', d < 6 ? '% shift' : DEV_LABEL[shiftCause.key] || '% shift');
  if (state === 'amber' || state === 'red') {
    const c = shiftCause(delta, widthRatio);
    if (c) { title = c[0]; hint = state === 'red' ? `${c[1]} You've been like this for a while.` : c[1]; }
  }
  text('posture-state', title); text('posture-hint', hint);
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
      landmarks = smoothPose(r.landmarks[0], now);
      if (now - lastLightCheck > 1000) { lastLightCheck = now; checkScene(landmarks); }
      if (visible(landmarks, [0, 11, 12])) {
        draw(landmarks);
        if (!sceneIssue) setChip('Tracking', true);
        camGoneSince = 0;
        if (camAway) { camAway = false; if (camPaused) { timerRunning = true; timerLast = performance.now(); renderPause(); toast('Welcome back'); } camPaused = false; }
        if (screen === 'work') updateWork(landmarks, now);
        else if (store.brk().style === 'stretch') updateGame(landmarks, now);
        else if (store.brk().style === 'game') { moveGame.update(landmarks); mini.update(landmarks); }
        else if (store.brk().style === 'breathe') updateReset(landmarks);
      } else {
        landmarks = null; ctx.clearRect(0, 0, canvas.width, canvas.height);
        driftSince = 0; nearSince = 0; holdStart = 0; lastStatTick = 0; posture.pause();
        setChip('Keep your head and shoulders in view');
        // Nobody in view for 3 s: you're away. Pause the focus timer until you're back.
        if (!camGoneSince) camGoneSince = now;
        if (!camAway && now - camGoneSince > 3000 && screen === 'work') {
          camAway = true; camPaused = timerRunning; timerRunning = false; renderPause(); light('idle');
          setChip('Away from desk');
        }
        if (screen === 'work') { text('posture-state', camAway ? 'Away' : 'Paused'); text('posture-hint', camAway ? 'Paused until you sit back down.' : 'Move back into the frame to continue.'); text('deviation', '—'); }
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
let barSkipped = false;
const hasRef = () => !!reference || sensorRef;
function syncRef() {
  $('studio').classList.toggle('no-ref', !hasRef() && screen === 'work');
  $('end-session').hidden = !hasRef();
  $('sensor-mode').hidden = true;
  const needBar = !writer && !barSkipped && ('serial' in navigator);
  $('bar-prompt').hidden = !!reference || !active || screen !== 'work' || !needBar;
  $('ref-prompt').hidden = !!reference || !active || screen !== 'work' || needBar;
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
  // Standing stretches, chosen so the arms never cover each other: the camera sees every joint.
  { name: 'Side reach, left', tip: 'Stand tall. Raise both arms overhead and lean gently to the left of your mirror.', type: 'side', side: 'left' },
  { name: 'Side reach, right', tip: 'Now the other way. Arms overhead, lean to the right of your mirror.', type: 'side', side: 'right' },
  { name: 'Neck release, right', tip: 'Soften your shoulders. Tip your head right and slightly forward.', type: 'neck', target: 18 },
  { name: 'Neck release, left', tip: 'Now to the left. Stay within a comfortable range.', type: 'neck', target: -18 },
  { name: 'Overhead reach', tip: 'Stand tall and reach both arms straight up. Grow taller through your fingertips.', type: 'reach' },
  { name: 'T-arms', tip: 'Open both arms straight out to the sides at shoulder height. Keep your shoulders low.', type: 'tee' },
  { name: 'Shoulder shrug', tip: 'Lift both shoulders up toward your ears, hold, then let them drop.', type: 'shrug' },
  { name: 'Look left', tip: 'Keep your shoulders still and turn your head slowly to the left of your mirror.', type: 'turn', side: 'left' },
  { name: 'Look right', tip: 'Now turn your head slowly to the right of your mirror.', type: 'turn', side: 'right' },
  { name: 'Chest opener', tip: 'Elbows out at shoulder height, hands up like a goalpost. Squeeze your shoulder blades together.', type: 'wings' },
];
let holdAcc = 0, holdLast = 0;
let queue = [], round = 0, points = 0, perfect = 0, holdStart = 0, missingSince = 0, betweenUntil = 0, gameDone = false, guidePlaying = false, poseStarted = 0;
const reel = new GuidePlayer({ onPlaying(playing) { guidePlaying = playing; if (!playing) holdStart = 0; } });
const angle = (a, b, c) => { const u = [a.x - b.x, a.y - b.y], v = [c.x - b.x, c.y - b.y]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1)))) * 180 / Math.PI; };

function newGame() {
  const count = clamp(store.brk().count || 10, 1, poses.length);
  // Random subset, kept in the guide's original order so paired sides stay together.
  const picked = new Set([...poses.keys()].sort(() => Math.random() - .5).slice(0, count));
  queue = poses.filter((_, i) => picked.has(i));
  round = 0; points = 0; perfect = 0; gameDone = false; betweenUntil = 0;
  breakLog.start('stretch');
  showPose();
}
function showPose() {
  holdStart = 0; holdAcc = 0; holdLast = 0; missingSince = 0; poseStarted = performance.now(); guidePlaying = false;
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
  guidePlaying = reel.playing;   // load() keeps playing without re-announcing it
}
function advance(passed = false) {
  if (gameDone) return;
  if (passed) breakLog.matched(); else breakLog.skipped();
  if (passed) { points += 100; perfect++; toast('Perfect  +100'); light('green'); }
  round++; betweenUntil = performance.now() + 1500; showPose(); text('points', `${points} points`);
}
// Position-based estimates, normalized by shoulder width. No video is uploaded.
// Scores use points the camera can always see in these poses: shoulders, elbows, wrists, nose, ears.
// Everything is measured in shoulder-widths, so it works at any distance.
let shrugRef = [];
function poseScore(p, target) {
  const vis = i => p && p[i] && (p[i].visibility ?? 1) > .3;
  const need = ['neck', 'shrug', 'turn'].includes(target.type) ? [11, 12] : [11, 12, 15, 16];
  if (!need.every(vis)) return null;
  if (target.type === 'neck') { if (!vis(7) || !vis(8)) return null; const tilt = Math.atan2(p[8].y - p[7].y, Math.abs(p[7].x - p[8].x)) * 180 / Math.PI; return Math.max(0, 100 - Math.abs(tilt - target.target) * 4); }
  const w = Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y); if (w < .04) return null;
  const mid = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const clamp01 = v => Math.max(0, Math.min(1, v));
  if (target.type === 'side') {
    // Both hands overhead (half the score) + hands shifted toward the chosen side (the other half).
    const handsY = (p[15].y + p[16].y) / 2, handsX = (p[15].x + p[16].x) / 2;
    const up = clamp01((mid.y - handsY) / w / 1.1);                   // ~1.1 shoulder-widths above the shoulders = full
    // The view is mirrored: a larger raw x shows on the screen's left.
    const shift = (target.side === 'left' ? handsX - mid.x : mid.x - handsX) / w;
    return Math.round(up * 50 + clamp01(shift / .45) * 50);
  }
  if (target.type === 'reach') {
    const up = Math.min(mid.y - p[15].y, mid.y - p[16].y) / w;            // both hands well above the shoulders
    const centred = 1 - clamp01(Math.max(Math.abs(p[15].x - mid.x), Math.abs(p[16].x - mid.x)) / w - .6);
    return Math.round(clamp01(up / 1.3) * 75 + centred * 25);
  }
  if (target.type === 'tee') {
    const level = clamp01(1 - (Math.abs(p[15].y - p[11].y) + Math.abs(p[16].y - p[12].y)) / 2 / w / .5);
    const spread = clamp01((Math.abs(p[15].x - p[16].x) / w - 1.4) / 1.2);
    return Math.round(level * 50 + spread * 50);
  }
  if (target.type === 'shrug') {
    // Compared with YOUR relaxed shoulders, not a fixed number (camera height and angle change
    // the raw value a lot). shrugRef remembers the lowest-shoulder (largest gap) of the last ~10 s.
    const head = vis(7) && vis(8) ? (p[7].y + p[8].y) / 2 : vis(0) ? p[0].y : null;
    if (head == null) return null;
    const gap = (mid.y - head) / w, now = performance.now();
    shrugRef = shrugRef.filter(r => now - r.t < 10000); shrugRef.push({ t: now, g: gap });
    const relaxed = Math.max(...shrugRef.map(r => r.g));
    return Math.round(clamp01((relaxed - gap) / .1) * 100);              // ~0.1 shoulder-width lift = full
  }
  if (target.type === 'turn') {
    if (!vis(0) || !vis(7) || !vis(8)) return null;
    const ears = (p[7].x + p[8].x) / 2, span = Math.abs(p[7].x - p[8].x) || .01;
    const off = (target.side === 'left' ? p[0].x - ears : ears - p[0].x) / span;   // mirrored view: larger x = screen left
    return Math.round(clamp01(off / .35) * 100);
  }
  // Chest opener: wrists above the shoulders, elbows near shoulder height and spread wide.
  const wristsUp = clamp01(((mid.y - p[15].y) + (mid.y - p[16].y)) / 2 / w / .5);
  const elbows = vis(13) && vis(14);
  const level = elbows ? clamp01(1 - (Math.abs(p[13].y - p[11].y) + Math.abs(p[14].y - p[12].y)) / 2 / w / .6) : .6;
  const spread = clamp01((Math.abs(p[15].x - p[16].x) / w - .9) / .7);
  return Math.round(wristsUp * 40 + level * 30 + spread * 30);
}
// Lenient on purpose: get close for half a second and move on.
const PASS = 40, PASS_MS = 1000;
function updateGame(p, now) {
  if (gameDone || now < betweenUntil) return;
  if (!guidePlaying) { holdStart = 0; missingSince = 0; $('hold-bar').style.width = '0'; text('hold-label', 'Play the guide to continue.'); return; }
  if (now - poseStarted < 800) { holdStart = 0; text('hold-label', 'Watch the figure, then follow along.'); return; }
  const target = queue[round], value = poseScore(p, target);
  if (value === null) {
    holdStart = 0; $('hold-bar').style.width = '0'; text('match-score', '—'); light('idle');
    if (!missingSince) missingSince = now;
    text('hold-label', ['neck', 'shrug', 'turn'].includes(target.type) ? 'Keep your face and shoulders in view.' : 'Step back so your arms fit in the frame.');
    if (now - missingSince > 6000) { toast('Arms out of view. Skipped.'); advance(); }
    return;
  }
  missingSince = 0;
  const score = Math.round(value);
  breakLog.score(score);
  text('match-score', score); light(score >= PASS ? 'green' : score >= PASS - 15 ? 'amber' : 'red');
  // Forgiving hold: time near the pose adds up; brief slips only drain it slowly.
  const dt = holdLast ? Math.min(200, now - holdLast) : 0; holdLast = now;
  holdAcc = score >= PASS ? holdAcc + dt : Math.max(0, holdAcc - dt * .5);
  $('hold-bar').style.width = Math.min(100, holdAcc / PASS_MS * 100) + '%';
  text('hold-label', score >= PASS ? 'Nice, hold it.' : holdAcc > 0 ? 'Almost there, stay with it.' : 'Mirror the figure as closely as you can.');
  if (holdAcc >= PASS_MS) { holdAcc = 0; advance(true); }
}

// ---------- Break: Reset (shoulder-drop breathing, then eye rest) ----------
// Part 1 (first two thirds): breathe in for 4 s, out for 6 s. On each out-breath, let your
//   shoulders drop. The camera measures how far they come down (ear-to-shoulder distance),
//   and the light bar slowly brightens and dims with your breath.
// Part 2 (last third): eye rest. Look at something far away, then blink slowly.
const SHOULDER_CM = 38;                          // average shoulder width, to turn ratios into cm
let breathTimer = null, resetShoulder = { base: null, now: null, best: 0, samples: [] };
// ear-to-shoulder gap in shoulder widths: bigger = shoulders lower / more relaxed
function shoulderGap(p) {
  if (!visible(p, [11, 12]) || !(visible(p, [7, 8]) || visible(p, [0]))) return null;
  const w = Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y);
  const head = visible(p, [7, 8]) ? (p[7].y + p[8].y) / 2 : p[0].y;
  return ((p[11].y + p[12].y) / 2 - head) / w;
}
function updateReset(p) {
  const g = shoulderGap(p); if (g == null) return;
  const s = resetShoulder;
  s.samples.push(g); if (s.samples.length > 5) s.samples.shift();
  const avg = s.samples.reduce((a, b) => a + b, 0) / s.samples.length;
  // Measure each breath, not against the start: remember where your shoulders were highest
  // in the last ~8 s (the top of the in-breath), and how far they've come down from there.
  const now = performance.now();
  s.hist = (s.hist || []).filter(h => now - h.t < 8000); s.hist.push({ t: now, g: avg });
  if (s.base == null && s.samples.length >= 5) s.base = avg;
  s.top = Math.min(...s.hist.map(h => h.g));        // smallest gap = shoulders highest
  s.now = avg;
  if (s.base != null) s.best = Math.max(s.best, (avg - s.top) * SHOULDER_CM);
}
function startBreathe() {
  stopBreathe();
  const total = Math.max(1, store.brk().minutes) * 60 * 1000, began = performance.now(), eyesAt = total * 2 / 3;
  breakLog.start('breathe');
  resetShoulder = { base: null, now: null, best: 0, samples: [] };
  const orb = $('breath-orb');
  let inhale = true, phaseStart = 0, phaseEnd = 0, eyeStep = -1, breaths = 0;
  text('reset-cm', '—'); $('reset-bar').style.width = '0';
  const EYES = [
    ['Look far away', 'Find something at least 6 m (20 ft) away and rest your eyes on it.'],
    ['Blink slowly', 'Close your eyes fully, then open. Do it slowly, a few times.'],
    ['Look around', 'Look up, down, left and right without moving your head.'],
  ];
  const tick = () => {
    const now = performance.now(), t = now - began, left = Math.max(0, total - t);
    $('breath-bar').style.width = (100 - left / total * 100) + '%';
    text('breath-left', `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left`);
    if (!left) {
      stopBreathe(); orb.classList.remove('in'); text('breath-cue', 'Reset complete'); text('breath-tip', 'Nice. Ready when you are.'); light('green');
      breakLog.resetResult({ shoulderCm: resetShoulder.best, eyesMs: total - eyesAt });
      endBreak();
      return;
    }
    if (t < eyesAt) {
      // Part 1: breathing with the light bar.
      if (now >= phaseEnd) {
        inhale = !inhale || phaseEnd === 0;
        if (inhale && phaseEnd) { breakLog.breath(); breaths++; }
        phaseStart = now; phaseEnd = now + (inhale ? 4000 : 6000);
        orb.classList.toggle('in', inhale);
        text('breath-cue', inhale ? 'Breathe in' : 'Breathe out');
      }
      const k = Math.min(1, (now - phaseStart) / (phaseEnd - phaseStart));
      const level = inhale ? k : 1 - k;                      // 0 dim … 1 bright
      const lv = .5 - .5 * Math.cos(level * Math.PI);        // ease in and out
      light('idle', [Math.round(25 + 135 * lv), Math.round(30 + 140 * lv), Math.round(28 + 110 * lv)], 15);
      const s = resetShoulder;
      const drop = s.base != null && s.now != null ? Math.max(0, (s.now - s.top) * SHOULDER_CM) : 0;
      text('breath-tip', inhale ? 'Breathe in slowly through your nose.' : 'Breathe out and let your shoulders sink down, away from your ears.');
      // Same layout as stretching: big number = how far your shoulders have relaxed, bar = toward a 2 cm goal.
      text('reset-cm', s.base == null ? '—' : drop.toFixed(1));
      text('reset-count', `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`);
      $('reset-bar').style.width = Math.min(100, drop / 1.5 * 100) + '%';
      text('breath-metric', !active ? 'Turn on the camera to see your shoulders relax.' : s.base == null ? 'Sit still for a moment…' : inhale ? 'Breathing in: shoulders rise a little. This is the starting point.' : drop >= 1.5 ? 'Lovely. Your shoulders came down a long way from the top of your breath.' : 'Breathing out: let your shoulders sink. The number shows how far they come down.');
    } else {
      // Part 2: eye rest. Gentle steady glow on the bar.
      const step = Math.min(EYES.length - 1, Math.floor((t - eyesAt) / ((total - eyesAt) / EYES.length)));
      if (step !== eyeStep) { eyeStep = step; orb.classList.remove('in'); text('breath-cue', EYES[step][0]); text('breath-tip', EYES[step][1]); }
      light('idle', [90, 100, 85]);
      text('reset-count', 'Eye rest'); text('breath-metric', `${Math.ceil(left / 1000)}s left`);
    }
  };
  tick(); breathTimer = setInterval(tick, 120);
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
  if (next === 'break') { const card = $(brk.style === 'stretch' ? 'break-panel' : brk.style === 'breathe' ? 'breathe-panel' : 'game-panel'); card.prepend($('break-switch')); }
  document.querySelectorAll('#break-switch button').forEach(b => b.classList.toggle('active', b.dataset.style === brk.style));
  $('work').classList.toggle('active', next === 'work'); $('break').classList.toggle('active', next === 'break');
  holdStart = 0; driftSince = 0; light('idle');
  reel.stop(); stopBreathe(); stopGames();
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
  $('pref-voice').checked = store.state.voice; syncVoicePick(); $('pref-music').checked = store.state.music; $('pref-joints').checked = store.state.joints;
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
    html += field('Style', segmented('style', [['stretch', 'Stretch'], ['breathe', 'Reset'], ['game', 'Game']], m.style));
    html += m.style === 'stretch'
      ? field('Stretches', `<input type="range" data-k="count" min="1" max="10" step="1" value="${m.count}">`, `<output>${m.count}</output>`)
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
$('pref-voice').onchange = e => {
  store.update(s => { s.voice = e.target.checked; });
  if (!e.target.checked && 'speechSynthesis' in window) speechSynthesis.cancel();
  syncVoicePick();
};
function syncVoicePick() {
  $('pref-voice-pick').classList.toggle('dim', !store.state.voice);
  document.querySelectorAll('#voice-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === (store.state.voiceId || 'ava')));
}
$('voice-seg').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]'); if (!b) return;
  store.update(s => { s.voiceId = b.dataset.v; s.voice = true; });
  $('pref-voice').checked = true; syncVoicePick();
  speak('All set.', $('ask-orb'));
});
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
// Go back one stretch (the current one and the one you return to are logged fresh).
$('prev-pose').onclick = () => {
  if (gameDone || round === 0) { holdStart = 0; poseStarted = performance.now(); reel.replay(); return; }
  breakLog.unlog(2); round--; betweenUntil = 0; showPose();
};
$('replay').onclick = () => { holdStart = 0; poseStarted = performance.now(); reel.replay(); };
$('restart-break').onclick = newGame;
$('return-work').onclick = () => setScreen('work');
$('breath-end').onclick = () => endBreak();
$('end-break').onclick = () => endBreak();
// ---------- Break: movement game ----------
const fmtClock = ms => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
let gameRgb = null;
// Game card stage: a small map of you (a simple figure) and where the bubbles are around you,
// so you can find them even without looking at the camera view. Popped bubbles ripple out.
function drawGameMap(g) {
  const cv = $('game-map'); if (!cv || !cv.offsetWidth) return;
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.offsetWidth, H = cv.offsetHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * .5, u = W * .11;               // u = one shoulder-width on the map
  // figure
  c.strokeStyle = '#141412'; c.lineWidth = 3; c.lineCap = 'round'; c.fillStyle = '#141412';
  c.beginPath(); c.arc(cx, cy - u * 1.05, u * .32, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(cx - u * .5, cy - u * .5); c.lineTo(cx + u * .5, cy - u * .5); c.lineTo(cx + u * .38, cy + u * .55); c.lineTo(cx - u * .38, cy + u * .55); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(cx - u * .25, cy + u * .55); c.lineTo(cx - u * .3, cy + u * 1.9); c.moveTo(cx + u * .25, cy + u * .55); c.lineTo(cx + u * .3, cy + u * 1.9); c.stroke();
  const b = g.body;
  if (!b) { c.fillStyle = '#6a6b64'; c.font = '500 13px Geist, sans-serif'; c.textAlign = 'center'; c.fillText(active ? 'Step back so your arms fit in view' : 'Bubbles will appear around you', cx, H - 22); return; }
  const aspect = (camera.videoWidth / camera.videoHeight) || 16 / 9;
  const map = (x, y) => [cx - (x - b.cx) / b.w * u, cy - u * .5 + (y - b.cy) / b.w / aspect * u];   // mirrored like the camera
  // hands
  for (const i of [15, 16]) if (b.ok(i)) { const [x, y] = map(b.p[i].x, b.p[i].y); c.fillStyle = '#141412'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); }
  const now = performance.now();
  for (const bub of g.bubbles) {
    const [x, y] = map(bub.x, bub.y), [r, gg, bl] = bub.color, age = (now - bub.born) / bub.life;
    c.fillStyle = `rgba(${r},${gg},${bl},.22)`; c.strokeStyle = `rgba(${r},${gg},${bl},.9)`; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, u * .38, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(x, y, u * .38 + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - age)); c.stroke();
  }
  for (const p of g.pops) {
    const k = (now - p.t) / 800; if (k > 1) continue;
    const [x, y] = map(p.x, p.y), [r, gg, bl] = p.color;
    c.strokeStyle = `rgba(${r},${gg},${bl},${1 - k})`; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, u * (.38 + k * .5), 0, Math.PI * 2); c.stroke();
  }
}
const moveGame = new MoveGame($('game-canvas'), camera, {
  onTick({ score, left, combo, tracking }) {
    gameRgb ? light('idle', gameRgb, 20) : light('idle');
    text('game-score', score); text('game-left', fmtClock(left));
    $('game-bar').style.width = (100 - left / (store.brk().minutes * 60000) * 100) + '%';
    text('game-label', !tracking ? 'Step back so your arms fit in the frame.' : combo > 2 ? `${combo} in a row` : 'Reach for the bubbles.');
  },
  onColor(rgb) { gameRgb = rgb; },
  onFrame(g) { drawGameMap(g); },
  onEnd(r) { breakLog.game(r); endBreak(); },
});
// Which game: Bubbles (camera overlay) or one of the seated games drawn in the stage box.
const gameKind = () => GAMES[store.state.gameKind] ? store.state.gameKind : 'bubbles';
const mini = new MiniGame($('mini-canvas'), {
  helper: $('game-map'),
  onTick({ score, left, label }) {
    // Every catch / ring / seed pulses the light bar softly twice in the
    // event's colour, then it settles back to the calm colour.
    const fk = gameFlash && performance.now() - gameFlash.t;
    if (gameFlash && fk < 1000) {
      // two soft pulses: brightness rises and falls like a breath (sin²), 0.5 s each
      const b = Math.pow(Math.sin(fk / 500 * Math.PI), 2) * .85 + .15;
      light('idle', gameFlash.rgb.map(v => Math.round(v * b / 8) * 8), 35);
    }
    else { gameFlash = null; gameRgb ? light('idle', gameRgb, 20) : light('idle'); }
    text('game-score', score); text('game-left', fmtClock(left));
    $('game-bar').style.width = (100 - left / (store.brk().minutes * 60000) * 100) + '%';
    text('game-label', label);
  },
  onColor(rgb) { if (rgb) gameFlash = { rgb, t: performance.now() }; },
  onEnd(r) { breakLog.game(r); endBreak(); },
});
let gameFlash = null;
const gameRunning = () => moveGame.running || mini.running;
function stopGames() { moveGame.stop(); mini.stop(); $('mini-canvas').hidden = true; gameRgb = null; }
function renderGameChips() {
  const k = gameKind();
  document.querySelectorAll('#game-chips button').forEach(b => b.classList.toggle('on', b.dataset.g === k));
  text('game-title', GAMES[k].title); text('game-tip', GAMES[k].tip);
  text('game-unit', k === 'bells' ? 'bells' : k === 'boat' ? 'drops' : k === 'seeds' ? 'seeds' : 'points');
}
$('game-chips').addEventListener('click', e => {
  const b = e.target.closest('button[data-g]'); if (!b) return;
  store.update(s => { s.gameKind = b.dataset.g; });
  stopGames(); breakLog.start('game'); resetGamePanel();
});
function resetGamePanel() {
  stopGames(); renderGameChips();
  const c = $('game-map'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  text('game-score', 0); text('game-left', fmtClock(store.brk().minutes * 60000)); $('game-bar').style.width = '0';
  text('game-label', active ? 'Step back so your arms fit in the frame.' : 'Turn on your camera to play.');
  if (gameKind() === 'bubbles') requestAnimationFrame(() => drawGameMap({ body: null, bubbles: [], pops: [] }));
  maybeStartGame();
}
// The game starts on its own as soon as you're in Game mode with the camera on.
function maybeStartGame() {
  if (screen !== 'break' || store.brk().style !== 'game' || gameRunning() || endingBreak || !active) return;
  const k = gameKind();
  if (k === 'bubbles') moveGame.start(store.brk().minutes * 60); else { $('mini-canvas').hidden = false; mini.start(k, store.brk().minutes * 60); }
}
$('game-end').onclick = () => { if (moveGame.running) breakLog.game(moveGame.result()); else if (mini.running) breakLog.game(mini.result()); endBreak(); };
function startBreakStyle(brk) {
  if (brk.style === 'stretch') newGame();
  else if (brk.style === 'breathe') startBreathe();
  else { breakLog.start('game'); resetGamePanel(); }
}
// Switch break type on the spot.
// Delegated, so it keeps working after the switch moves between cards or re-renders.
$('break-switch').addEventListener('click', e => {
  const b = e.target.closest('button[data-style]'); if (!b) return;
  const style = b.dataset.style;
  const pick = store.state.breaks.find(m => m.style === style && !m.preset) || store.state.breaks.find(m => m.style === style);
  stopGames();
  store.update(s => {
    let m = pick;
    if (!m) {   // older saved settings may be missing this type: add it
      const defs = { stretch: { name: 'Stretch along', count: 10, minutes: 4 }, breathe: { name: 'Reset', count: 3, minutes: 2 }, game: { name: 'Reach & pop', count: 5, minutes: 1 } };
      m = { id: style === 'breathe' ? 'breathe' : style, style, auto: true, preset: true, ...defs[style] };
      s.breaks = s.breaks.filter(x => x.id !== m.id); s.breaks.push(m);
    }
    s.breakId = m.id;
  });
  setScreen('break');
});
let endingBreak = false;
async function endBreak() {
  if (endingBreak || screen !== 'break') return;
  endingBreak = true;
  reel.stop(); stopBreathe(); stopGames(); light('idle');
  breakLog.away(breakAwayMs); breakAwayMs = 0;
  const r = breakLog.summary();
  const choice = r ? await showBreakReport(r, line => speak(line, $('ask-orb'))) : 'focus';
  endingBreak = false;
  if (choice === 'again' && r?.kind === 'breathe') { setScreen('work'); if (active && visible(landmarks, [0, 11, 12])) calibrate(); else toast('Turn on your camera to save a new reference'); }
  else if (choice === 'again') setScreen('break');
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
  sensor.base = sensor.cm > 0 ? sensor.cm : 65; sensorRef = true; reference = null; driftSince = 0;
  syncRef();
  if (!posture.active) posture.reset();
  text('calibrate', 'Reset reference');
  toast('Sensor mode: tracking with the distance sensor');
  timerRunning = true; timerLast = performance.now(); renderPause();
  showSensorCard();
  setChip(`Sensor mode · ${sensor.cm} cm`, true);
  maybeTour();
  return true;
}
// Camera off + sensor connected: say so on the card, and keep tracking with the sensor.
function showSensorCard() {
  const on = sensorRef && !active;
  $('empty-camera').classList.toggle('sensor-on', on);
  $('empty-camera').querySelector('.say').innerHTML = on
    ? `<b>Sensor mode.</b> <span>The camera is off, so the distance sensor is keeping an eye on how far you sit.</span>`
    : '<b>Camera off.</b> <span>Turn it on and I will start watching your posture.</span>';
  $('enable').textContent = on ? 'Use the camera instead' : 'Turn on camera';
  $('enable').classList.add('primary'); $('enable').classList.remove('ghost'); $('enable').classList.toggle('end-wide', on);
}
$('sensor-mode').onclick = () => { if (screen !== 'work') setScreen('work'); calibrateSensor(); };
sensor.on(() => {
  const now = performance.now();
  $('sensor-chip').hidden = false;
  text('sensor-chip', sensor.cm > 0 ? `${sensor.cm} cm` : '— cm');
  if (now - lastSensorTick > 180) { lastSensorTick = now; sensorTick(now); }
  sensorTap(now);
  // Camera off: switch to sensor mode on its own, so the bar and the session keep working.
  if (!active && !sensorRef && sensor.live && !$('studio').hidden) calibrateSensor();
  if (!active) syncRef();
  $('sensor-row').hidden = false; text('sensor-dist', sensor.cm > 0 ? sensor.cm : '—');
  $('sensor-dist').classList.toggle('off', sensor.cm > 0 && (sensor.cm < SENSOR_GOOD[0] || sensor.cm > SENSOR_GOOD[1]));
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
      toast('You stepped away, so I paused for you');
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
    if (style === 'game' && !gameRunning()) maybeStartGame();
    else if (style === 'stretch') advance();
    else toast('Wave noticed');
  } else if (hasRef()) {
    timerRunning = !timerRunning; timerLast = performance.now(); renderPause();
    toast(timerRunning ? 'Timer on (sensor tap)' : 'Timer paused (sensor tap)');
  }
}

$('bar-connect').onclick = () => $('connect').click();
$('bar-skip').onclick = () => { barSkipped = true; syncRef(); };
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
    syncRef();
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

