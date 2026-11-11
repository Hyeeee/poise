// Session analysis: records posture while the focus timer runs, then shows a summary
// when the session ends (End button or timer finished).
import { postureChart, bucket } from './chart.js';
const $ = id => document.getElementById(id);

const CAUSES = {
  forward: { label: 'Leaning forward', tip: 'Your head drifted forward and down, toward the screen.', stretch: 'Upper-back release', ko: '앞으로 숙임' },
  side: { label: 'Tilting to one side', tip: 'Your head leaned off to one side.', stretch: 'Neck release', ko: '옆으로 기울어짐' },
  shoulders: { label: 'Uneven shoulders', tip: 'One shoulder dropped lower than the other.', stretch: 'Shoulder release', ko: '어깨 비대칭' },
  slouch: { label: 'Slouching back', tip: 'Your shoulders sank as you slid down in the chair.', stretch: 'Chest opener', ko: '뒤로 기대 앉음' },
  far: { label: 'Too far from the screen', tip: 'You sat back far from the screen, which often ends in leaning in to read.', stretch: 'Shoulder release', ko: '화면에서 너무 멂' },
  close: { label: 'Too close to the screen', tip: 'You leaned in close to the screen.', stretch: 'Breathe and look far away', ko: '화면에 너무 가까움' },
};

let s = null;

// For the report's hover card: which part moved the most at that moment, and which way.
// The camera view is mirrored like a mirror, so left and right are your own left and right.
function whatMoved(d, delta, widthRatio = 1) {
  if (!delta || d < 6) return {};
  const parts = {
    close: widthRatio > 1 ? Math.max(0, Math.log(widthRatio) - .12) * 2 : 0,
    far: widthRatio < 1 ? Math.max(0, -Math.log(widthRatio) - .12) * 2 : 0,
    forward: Math.max(0, delta.y || 0),
    side: Math.abs(delta.x || 0) + Math.abs(delta.roll || 0) * .6,
    shoulders: Math.abs(delta.tilt || 0),
    slouch: (delta.sink || 0) * 1.2,
  };
  const [cause, size] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  if (size < .03) return {};
  const dir = cause === 'side' ? ((delta.x || 0) + (delta.roll || 0) * .3 > 0 ? 'left' : 'right')
    : cause === 'shoulders' ? ((delta.tilt || 0) > 0 ? 'left' : 'right') : null;
  return { cause, dir };
}
const MOVED = {
  forward: () => 'Leaning forward', slouch: () => 'Slouching back', close: () => 'Too close to the screen', far: () => 'Too far from the screen',
  side: dir => `Head tilting ${dir}`, shoulders: dir => `${dir === 'left' ? 'Left' : 'Right'} shoulder lower`,
};
const STATE_NAME = { white: 'Aligned', green: 'Aligned', amber: 'Drifting', red: 'Time to reset' };
const STATE_DOT = { white: 'var(--aligned)', green: 'var(--aligned)', amber: 'var(--drift)', red: 'var(--reset)' };
const clock = ms => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// Hover card on a report chart, like a stock chart: a thin line and a dot follow the pointer,
// and a small card says what was happening at that moment.
// items: [{ x: 0..1, d: value on the chart's scale, html }]; scale: the chart's { H, top, bottom, ymax }.
function hoverChart(host, items, { H, top, bottom, ymax }) {
  const plot = host.querySelector('.rc-plot'); if (!plot || !items.length) return;
  plot.insertAdjacentHTML('beforeend', '<i class="rc-vline" hidden></i><i class="rc-dot" hidden></i><div class="rc-tip" hidden></div>');
  const vline = plot.querySelector('.rc-vline'), dot = plot.querySelector('.rc-dot'), tip = plot.querySelector('.rc-tip');
  const show = on => { vline.hidden = dot.hidden = tip.hidden = !on; };
  const move = e => {
    const r = plot.getBoundingClientRect(), fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    let best = items[0];
    for (const it of items) if (Math.abs(it.x - fx) < Math.abs(best.x - fx)) best = it;
    const xPx = best.x * r.width, yPx = (top + Math.min(best.d, ymax) / ymax * (H - top - bottom)) / H * r.height;
    vline.style.left = dot.style.left = xPx + 'px'; dot.style.top = yPx + 'px';
    tip.innerHTML = best.html; show(true);
    // Card above the dot, flipped below when there is no room, and kept inside the chart on both sides.
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(r.width - tw, Math.max(0, xPx - tw / 2)) + 'px';
    tip.style.top = (yPx - th - 12 < -6 ? yPx + 14 : yPx - th - 12) + 'px';
  };
  plot.addEventListener('pointermove', move);
  plot.addEventListener('pointerdown', move);
  plot.addEventListener('pointerleave', () => show(false));
}

export const session = {
  reset() {
    s = { start: performance.now(), samples: [], time: { good: 0, amber: 0, red: 0 }, drifts: 0, reds: 0,
      driftStart: 0, longest: 0, recoveries: [], causes: { forward: 0, side: 0, shoulders: 0, close: 0, far: 0, slouch: 0 }, lastT: 0, lastSample: 0, prev: 'white' };
  },
  get active() { return !!s; },
  clear() { s = null; },
  // state: white | green | amber | red. delta: cue minus reference. widthRatio: shoulder width vs reference.
  record(now, d, state, delta, widthRatio) {
    if (!s) return;
    const bad = state === 'amber' || state === 'red', wasBad = s.prev === 'amber' || s.prev === 'red';
    if (s.lastT) s.time[bad ? state : 'good'] += Math.min(now - s.lastT, 500);
    s.lastT = now;
    if (bad && !wasBad) { s.drifts++; s.driftStart = now; }
    if (state === 'red' && s.prev !== 'red') s.reds++;
    if (!bad && wasBad && s.driftStart) {
      const took = now - s.driftStart;
      s.recoveries.push(took); s.longest = Math.max(s.longest, took); s.driftStart = 0;
    }
    if (bad && delta) {
      // Which part of the posture moved the most while off reference.
      const scores = { forward: Math.max(0, delta.y) * 1.2, side: Math.abs(delta.x), shoulders: Math.abs(delta.tilt), close: widthRatio > 1 ? Math.log(widthRatio) * 2.5 : 0, far: widthRatio < 1 ? -Math.log(widthRatio) * 2.5 : 0, slouch: (delta.sink || 0) * 1.2 };
      const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
      s.causes[top]++;
    }
    if (now - s.lastSample > 1000) { s.samples.push({ t: now - s.start, d, state, ...whatMoved(d, delta, widthRatio) }); s.lastSample = now; }
    s.prev = state;
  },
  pause() { if (s) s.lastT = 0; },
  summary() {
    if (!s) return null;
    const total = s.time.good + s.time.amber + s.time.red;
    const avgRecover = s.recoveries.length ? s.recoveries.reduce((a, b) => a + b, 0) / s.recoveries.length : null;
    const causeTotal = Object.values(s.causes).reduce((a, b) => a + b, 0);
    const ranked = Object.entries(s.causes).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, share: Math.round(n / causeTotal * 100), ...CAUSES[k] }));
    return {
      minutes: Math.round((performance.now() - s.start) / 60000),
      tracked: total,
      aligned: total > 3000 ? Math.round(s.time.good / total * 100) : null,
      avgRecover, longest: s.longest, drifts: s.drifts, reds: s.reds,
      causes: ranked, samples: s.samples.slice(),
    };
  },
};

const fmtSec = ms => ms == null ? '—' : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.round(ms / 60000)}m`;

// Spoken lines are fixed so they can be pre-recorded in every voice (tools/make-voice.py).
const SAY = {
  'Great session.': 'Great session. Here is how your posture went.',
  'Good session.': 'Good session. Here is how your posture went.',
  'Time to reset.': 'A tough one. A short break will help.',
  other: 'Session ended. Here is your summary.',
  'Great stretch.': 'Great stretch. Here is how your break went.',
  'Nice stretch.': 'Nice stretch. Here is how your break went.',
  'A light stretch.': 'A light stretch. Try again when you can.',
  'Good rest.': 'Good rest. Here is how your break went.',
  'Short rest.': 'A short rest. Try two minutes or more next time.',
  breakOther: 'Break ended. Here is your summary.',
  pose_close: 'You are leaning in close to the screen. Sit back a little.',
  pose_far: 'You have drifted far from the screen. Come a bit closer.',
  pose_forward: 'Your head is pushing forward. Bring it back over your shoulders.',
  pose_side: 'You are tilting to one side. Center yourself.',
  pose_shoulders: 'One shoulder has dropped. Let both shoulders relax evenly.',
  pose_slouch: 'You are slouching back. Sit up tall.',
  pose_other: 'Your posture has drifted for a while. Take a moment to reset.',
  'Great moves.': 'Great moves. Here is how you did.',
  'Nice moves.': 'Nice moves. Here is how you did.',
  'A quick move.': 'A quick move. Every bit helps.',
};
export const SPOKEN_LINES = Object.values(SAY);
export const POSTURE_SAY = k => SAY['pose_' + k] || SAY.pose_other;

// "In this 25 min session" / "In this 40 sec session" — said once, at the start of the line.
const lenPhrase = r => { const ms = r.tracked || r.minutes * 60000; return ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} sec` : `${Math.round(ms / 60000)} min`; };
function headline(r) {
  if (r.aligned == null) return { en: 'Short session. Set a reference and keep the timer running to see your full analysis.', title: 'Session ended.' };
  const quick = r.avgRecover != null && r.avgRecover < 6000;
  if (r.aligned >= 80) return { en: `Great session. In ${lenPhrase(r)}, you stayed aligned ${r.aligned}% of the time${quick ? ` and caught yourself in about ${Math.round(r.avgRecover / 1000)} seconds` : ''}.`, title: 'Great session.' };
  if (r.aligned >= 55) return { en: `Good session. In ${lenPhrase(r)}, you stayed aligned ${r.aligned}% of the time${r.causes[0] ? `, and most drifts were ${r.causes[0].label.toLowerCase()}` : ''}.`, title: 'Good session.' };
  return { en: `A tough one. In ${lenPhrase(r)}, you were aligned ${r.aligned}% of the time${r.causes[0] ? `, mostly ${r.causes[0].label.toLowerCase()}` : ''}. A short break will help.`, title: 'Time to reset.' };
}

// Same chart as the live one in the Focus panel, plus a coloured strip for aligned / drifting / reset
// and time marks, so the report reads as the full version of what you watched during the session.
function timeline(samples) {
  if (samples.length < 2) return `<p class="sub tl-empty-msg">Not enough data yet</p>`;
  const t0 = samples[0].t, span = (samples[samples.length - 1].t - t0) || 1, maxT = span;
  const pts = bucket(samples.map(p => ({ x: (p.t - t0) / span, d: p.d, state: p.state })), 220);
  const ymax = Math.max(30, Math.min(100, Math.max(...pts.map(p => p.d)) * 1.1));
  const c = postureChart(pts, { W: 560, H: 140, top: 14, bottom: 10, ymax, cue: 0.0001 });
  timeline.scale = { H: 140, top: 14, bottom: 10, ymax };
  const color = { white: 'var(--aligned)', green: 'var(--aligned)', amber: 'var(--drift)', red: 'var(--reset)' };
  let strip = '';
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    strip += `<i style="left:${((a.t - t0) / maxT * 100).toFixed(2)}%;width:${Math.max(.3, (b.t - a.t) / maxT * 100).toFixed(2)}%;background:${color[a.state] || color.white}"></i>`;
  }
  const fmt = ms => ms < 120000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)} min`;
  return `<div class="rc-plot">${c.svg}</div><div class="rc-strip">${strip}</div>
    <div class="live-axis"><span>0</span><span>${fmt(maxT / 2)}</span><span>${fmt(maxT)}</span></div>`;
}

/** Show the report. Resolves with 'break' | 'new' | 'done'. */
export function showReport(r, speak) {
  return new Promise(resolve => {
    const h = headline(r), top = r.causes[0];
    $('report-title').textContent = h.title;
    $('report-line').textContent = h.en.replace(/^[^.]+\. /, '');
    $('report-chart').innerHTML = timeline(r.samples);
    if (r.samples.length >= 2) {
      const t0 = r.samples[0].t, span = (r.samples.at(-1).t - t0) || 1;
      hoverChart($('report-chart'), r.samples.map(p => ({
        x: (p.t - t0) / span, d: p.d,
        html: `<span class="rt-time">${clock(p.t - t0)}</span>`
          + `<span class="rt-state"><i style="background:${STATE_DOT[p.state] || STATE_DOT.white}"></i>${(p.state === 'white' || !p.state) && p.d >= 12 ? 'Just shifted' : STATE_NAME[p.state] || 'Aligned'}</span>`
          + (p.cause && p.d >= 6 ? `<b>${MOVED[p.cause](p.dir)}</b><span class="rt-sub">${Math.round(p.d)}% off your reference</span>`
            : `<b>On your reference</b>${p.d >= 1 ? `<span class="rt-sub">${Math.round(p.d)}% off, within the normal wobble</span>` : ''}`),
      })), timeline.scale);
    }
    $('rep-causes-h').hidden = $('rep-causes').hidden = !r.causes.length;   // what pulled you out, under the numbers
    $('report-card').classList.add('show-causes');
    $('report-len').textContent = r.minutes < 1 ? 'Under a minute' : `${r.minutes} min session`;
    $('rep-aligned').textContent = r.aligned == null ? '—' : r.aligned + '%';
    $('rep-recover').textContent = fmtSec(r.avgRecover);
    $('rep-drifts').textContent = r.drifts;
    $('rep-drift-note').textContent = r.reds ? `drifts · ${r.reds} reached red` : 'drifts · none reached red';
    $('rep-causes').innerHTML = r.causes.length
      ? r.causes.map(c => `<div class="cause"><span>${c.label}</span><i style="--w:${c.share}%"></i><b>${c.share}%</b></div>`).join('')
      : '<p class="sub">No drifts to analyze. Nicely done.</p>';
    $('rep-tip').innerHTML = top ? `<b>Try: ${top.stretch}.</b> <span>${top.tip}</span>` : '<b>Keep it up.</b> <span>Take a short break anyway, since moving helps.</span>';
    $('report').hidden = false;
    $('report-break').focus({ preventScroll: true });
    speak?.(SAY[h.title] || SAY.other);
    const done = choice => { $('report').hidden = true; ['report-break', 'report-new', 'report-done'].forEach(id => { $(id).onclick = null; }); resolve(choice); };
    $('report-break').onclick = () => done('break');
    $('report-new').onclick = () => done('new');
    $('report-done').onclick = () => done('done');
  });
}

// ---------- Break analysis ----------
let b = null;
export const breakLog = {
  start(kind) { b = { kind, start: performance.now(), poses: [], cycles: 0 }; },
  pose(name) { if (b) b.poses.push({ name, best: 0, matched: false, skipped: false, began: performance.now(), took: 0 }); },
  score(v) { const p = b?.poses.at(-1); if (p) p.best = Math.max(p.best, v); },
  matched() { const p = b?.poses.at(-1); if (p) { p.matched = true; p.took = performance.now() - p.began; } },
  skipped() { const p = b?.poses.at(-1); if (p && !p.matched) p.skipped = true; },
  breath() { if (b) b.cycles++; },
  game(r) { if (b) b.game = r; },
  away(ms) { if (b) b.awayMs = ms; },
  resetResult(x) { if (b) b.reset = x; },
  unlog(n) { if (b) b.poses.splice(-n, n); },
  summary() {
    if (!b) return null;
    const r = { ...b, ms: performance.now() - b.start, poses: b.poses.slice() };
    b = null; return r;
  },
};

// Stretch report chart: the same smooth line chart as the focus report. Higher = closer match.
function bars(poses) {
  if (poses.length < 2) return `<p class="sub tl-empty-msg">Not enough data yet</p>`;
  const pts = poses.map((p, i) => ({ x: i / (poses.length - 1), d: 100 - Math.round(p.best) }));
  const c = postureChart(pts, { W: 560, H: 140, top: 14, bottom: 10, ymax: 100, cue: 0.0001, fill: 'var(--aligned)', stroke: 'color-mix(in srgb, var(--aligned), #0d0d0d 35%)' });
  const strip = poses.map((p, i) => `<i style="left:${(i / poses.length * 100).toFixed(2)}%;width:${(100 / poses.length).toFixed(2)}%;background:${p.matched ? 'var(--aligned)' : p.best > 30 ? 'var(--drift)' : 'var(--reset)'}"></i>`).join('');
  return `<div class="rc-plot">${c.svg}</div><div class="rc-strip">${strip}</div>
    <div class="live-axis"><span>First</span><span>Last stretch</span></div>`;
}
// Group stretches by the part of the body they work, so the list stays short.
const STRETCH_GROUP = n => /neck|look/i.test(n) ? 'Neck' : /side reach/i.test(n) ? 'Side reaches' : /shrug/i.test(n) ? 'Shoulders' : 'Arms and chest';
function groupPoses(poses) {
  const g = {};
  for (const p of poses) { const k = STRETCH_GROUP(p.name); (g[k] ||= []).push(p); }
  return Object.entries(g).map(([name, list]) => ({ name, avg: Math.round(list.reduce((a, p) => a + p.best, 0) / list.length), done: list.filter(p => p.matched).length, total: list.length }));
}

/** Break report. Resolves 'again' | 'focus' | 'done'. */
export function showBreakReport(r, speak) {
  return new Promise(resolve => {
    const mins = r.ms / 60000, len = mins < 1 ? `${Math.max(1, Math.round(r.ms / 1000))} sec` : `${Math.round(mins)} min`;
    const set = (id, v) => { $(id).textContent = v; };
    $('rep-causes').hidden = false;
    $('report-card').classList.remove('show-causes');
    const labels = { 'rep-aligned-l': '', 'rep-recover-l': '', 'rep-drift-note': '', 'rep-causes-h': '', 'report-new': '', 'report-break': '' };
    for (const k in labels) labels[k] = $(k).textContent;
    const legend = $('report-legend'); const legendWas = legend.hidden;
    let title, line;
    if (r.kind === 'game' && r.game && r.game.kind && r.game.kind !== 'bubbles') {
      const g = r.game, names = { boat: 'Sail the stream', bells: 'Ring the bells', seeds: 'Follow the seeds' };
      title = g.score >= 8 ? 'Great moves.' : g.score >= 3 ? 'Nice moves.' : 'A quick move.';
      line = `In ${len}, ${g.stats.map(([v, l]) => `${v} ${l}`).join(', ')}.`;
      $('report-chart').hidden = true; legend.hidden = true;
      set('rep-aligned', g.stats[0][0]); set('rep-aligned-l', g.stats[0][1]);
      set('rep-recover', g.stats[1][0]); set('rep-recover-l', g.stats[1][1]);
      set('rep-drifts', g.stats[2][0]); set('rep-drift-note', g.stats[2][1]);
      $('rep-causes-h').hidden = true; $('rep-causes').innerHTML = '';
    } else if (r.kind === 'game') {
      const g = r.game || { score: 0, popped: 0, missed: 0, best: 0, zones: { high: 0, side: 0, low: 0, head: 0 } };
      const tries = g.popped + g.missed, rate = tries ? Math.round(g.popped / tries * 100) : 0;
      title = g.popped >= 20 ? 'Great moves.' : g.popped >= 8 ? 'Nice moves.' : 'A quick move.';
      line = g.popped ? `In ${len}, you popped ${g.popped} bubbles for ${g.score} points, best streak ${g.best}.` : 'Start the game next time to get moving.';
      $('report-chart').hidden = true; legend.hidden = true;
      set('rep-aligned', g.score); set('rep-aligned-l', 'points');
      set('rep-recover', g.popped); set('rep-recover-l', 'bubbles popped');
      set('rep-drifts', tries ? rate + '%' : '—'); set('rep-drift-note', 'hit rate');
      const zones = [['high', 'Reaching up'], ['side', 'Reaching out'], ['low', 'Reaching down'], ['head', 'Leaning (head)']];
      const zt = Object.values(g.zones).reduce((a, n) => a + n, 0);
      $('rep-causes-h').hidden = !zt; $('rep-causes-h').textContent = 'How you moved';
      $('rep-causes').innerHTML = zt ? zones.map(([k, l]) => `<div class="cause"><span>${l}</span><i style="--w:${Math.round(g.zones[k] / zt * 100)}%"></i><b>${g.zones[k]}</b></div>`).join('') : '';
      const weakest = zones.filter(([k]) => k !== 'head').sort((a, c) => g.zones[a[0]] - g.zones[c[0]])[0];
      $('rep-tip').innerHTML = zt ? `<b>Next round:</b> <span>Try more ${weakest[1].toLowerCase()}. It opens the parts you use least while sitting.</span>` : '<b>Tip:</b> <span>Step back from the screen so your whole upper body and arms are in view.</span>';
    } else if (r.kind === 'breathe') {
      const rs = r.reset || { shoulderCm: 0, eyesMs: 0 };
      const cm = rs.shoulderCm || 0;
      title = mins >= 1.5 ? 'Good rest.' : 'Short rest.';
      line = cm >= .3 ? `In ${len}, you took ${r.cycles} slow breath${r.cycles === 1 ? '' : 's'} and your shoulders came down ${cm.toFixed(1)} cm.` : `In ${len}, you took ${r.cycles} slow breath${r.cycles === 1 ? '' : 's'} and rested your eyes.`;
      $('report-chart').innerHTML = ''; $('report-chart').hidden = true; legend.hidden = true;
      set('rep-aligned', cm >= .3 ? `${cm.toFixed(1)} cm` : '—'); set('rep-aligned-l', 'shoulders lowered');
      set('rep-recover', r.cycles); set('rep-recover-l', 'slow breaths');
      set('rep-drifts', rs.eyesMs ? `${Math.round(rs.eyesMs / 1000)}s` : '—'); set('rep-drift-note', 'eye rest');
      $('rep-causes-h').hidden = true; $('rep-causes').innerHTML = '';
      $('rep-tip').innerHTML = cm >= .3 ? '<b>Keep this feeling.</b> <span>Save how you\'re sitting now as your new reference, so relaxed shoulders become your baseline.</span>' : '<b>Next time:</b> <span>On every out-breath, let your shoulders fall away from your ears.</span>';
    } else {
      const done = r.poses.filter(p => p.matched), total = r.poses.length;
      const avg = total ? Math.round(r.poses.reduce((a, p) => a + p.best, 0) / total) : 0;
      title = !total ? 'Break ended.' : done.length === total ? 'Great stretch.' : done.length >= total / 2 ? 'Nice stretch.' : 'A light stretch.';
      line = total ? `In ${len}, you followed ${done.length} of ${total} stretches.` : `You rested ${len}.`;
      $('report-chart').hidden = false; $('report-chart').innerHTML = bars(r.poses); legend.hidden = true;
      if (r.poses.length >= 2) hoverChart($('report-chart'), r.poses.map((p, i) => ({
        x: i / (r.poses.length - 1), d: 100 - Math.round(p.best),
        html: `<span class="rt-time">Stretch ${i + 1} of ${r.poses.length}</span>`
          + `<span class="rt-state"><i style="background:${p.matched ? 'var(--aligned)' : p.best > 30 ? 'var(--drift)' : 'var(--reset)'}"></i>${p.matched ? 'Followed' : p.skipped ? 'Skipped' : 'Partly'}</span>`
          + `<b>${p.name}</b><span class="rt-sub">Best match ${Math.round(p.best)}%${p.matched && p.took ? `, in ${Math.max(1, Math.round(p.took / 1000))}s` : ''}</span>`,
      })), { H: 140, top: 14, bottom: 10, ymax: 100 });
      set('rep-aligned', len); set('rep-aligned-l', 'rested');
      set('rep-recover', `${done.length}/${total}`); set('rep-recover-l', 'stretches followed');
      set('rep-drifts', total ? avg + '%' : '—'); set('rep-drift-note', 'average best match');
      $('rep-causes-h').hidden = !total;
      $('rep-causes-h').textContent = 'By area';
      $('rep-causes').innerHTML = groupPoses(r.poses).map(g => `<div class="cause"><span>${g.name}</span><i style="--w:${g.avg}%"></i><b>${g.done}/${g.total}</b></div>`).join('');
      const miss = r.poses.find(p => !p.matched);
      $('rep-tip').innerHTML = miss ? `<b>Give ${miss.name.toLowerCase()} another try later.</b> <span>Keep your arms in view and mirror the figure slowly.</span>` : '<b>Nicely done.</b> <span>Your shoulders and neck should feel looser now.</span>';
    }
    if (r.awayMs > 15000) line += ` You stepped away from your desk for ${r.awayMs < 60000 ? Math.round(r.awayMs / 1000) + ' seconds' : Math.round(r.awayMs / 60000) + ' min'}.`;
    set('report-title', title); set('report-line', line); set('report-len', `${len} break`);
    set('report-new', r.kind === 'game' ? 'Play again' : r.kind === 'breathe' ? 'Save as reference' : 'Stretch again'); set('report-break', 'Back to focus');
    $('report').hidden = false; $('report-break').focus({ preventScroll: true });
    speak?.(SAY[title] || SAY.breakOther);
    const finish = choice => {
      $('report').hidden = true;
      for (const k in labels) $(k).textContent = labels[k];
      $('rep-causes-h').hidden = false; $('report-chart').hidden = false; legend.hidden = legendWas;
      ['report-break', 'report-new', 'report-done'].forEach(id => { $(id).onclick = null; });
      resolve(choice);
    };
    $('report-break').onclick = () => finish('focus');
    $('report-new').onclick = () => finish('again');
    $('report-done').onclick = () => finish('done');
  });
}
