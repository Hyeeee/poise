// Session analysis: records posture while the focus timer runs, then shows a summary
// when the session ends (End button or timer finished).
const $ = id => document.getElementById(id);

const CAUSES = {
  forward: { label: 'Leaning forward', tip: 'Your head drifted forward and down, toward the screen.', stretch: 'Upper-back release', ko: '앞으로 숙임' },
  side: { label: 'Tilting to one side', tip: 'Your head leaned off to one side.', stretch: 'Neck release', ko: '옆으로 기울어짐' },
  shoulders: { label: 'Uneven shoulders', tip: 'One shoulder dropped lower than the other.', stretch: 'Shoulder release', ko: '어깨 비대칭' },
  close: { label: 'Too close to the screen', tip: 'You leaned in close to the screen.', stretch: 'Breathe and look far away', ko: '화면에 너무 가까움' },
};

let s = null;

export const session = {
  reset() {
    s = { start: performance.now(), samples: [], time: { good: 0, amber: 0, red: 0 }, drifts: 0, reds: 0,
      driftStart: 0, longest: 0, recoveries: [], causes: { forward: 0, side: 0, shoulders: 0, close: 0 }, lastT: 0, lastSample: 0, prev: 'white' };
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
      const scores = { forward: Math.max(0, delta.y) * 1.2, side: Math.abs(delta.x), shoulders: Math.abs(delta.tilt), close: Math.max(0, widthRatio - 1) * 1.5 };
      const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
      s.causes[top]++;
    }
    if (now - s.lastSample > 1000) { s.samples.push({ t: now - s.start, d, state }); s.lastSample = now; }
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

function headline(r) {
  if (r.aligned == null) return { en: 'Short session. Set a reference and keep the timer running to see your full analysis.', title: 'Session ended.' };
  const quick = r.avgRecover != null && r.avgRecover < 6000;
  if (r.aligned >= 80) return { en: `Great session. You stayed aligned ${r.aligned}% of the time${quick ? ` and caught yourself in about ${Math.round(r.avgRecover / 1000)} seconds` : ''}.`, title: 'Great session.' };
  if (r.aligned >= 55) return { en: `Good session. You stayed aligned ${r.aligned}% of the time${r.causes[0] ? `, and most drifts were ${r.causes[0].label.toLowerCase()}` : ''}.`, title: 'Good session.' };
  return { en: `A tough one. You were aligned ${r.aligned}% of the time${r.causes[0] ? `, mostly ${r.causes[0].label.toLowerCase()}` : ''}. A short break will help.`, title: 'Time to reset.' };
}

function timeline(samples) {
  const W = 560, H = 120, pad = 6;
  if (samples.length < 2) return `<svg viewBox="0 0 ${W} ${H}" class="tl"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="tl-empty">Not enough data yet</text></svg>`;
  const maxT = samples[samples.length - 1].t || 1;
  const x = t => pad + (t / maxT) * (W - pad * 2), y = d => H - pad - (Math.min(100, d) / 100) * (H - pad * 2);
  const color = { white: 'var(--aligned)', green: 'var(--aligned)', amber: 'var(--drift)', red: 'var(--reset)' };
  let bands = '';
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    bands += `<rect x="${x(a.t)}" y="${H - 10}" width="${Math.max(1, x(b.t) - x(a.t))}" height="8" rx="2" fill="${color[a.state] || color.white}"/>`;
  }
  const line = samples.map(p => `${x(p.t).toFixed(1)},${y(p.d).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="tl" role="img" aria-label="Posture shift over the session">
    <line x1="${pad}" x2="${W - pad}" y1="${y(50)}" y2="${y(50)}" class="tl-mid"/>
    <polyline points="${line}" class="tl-line"/>${bands}</svg>`;
}

/** Show the report. Resolves with 'break' | 'new' | 'done'. */
export function showReport(r, speak) {
  return new Promise(resolve => {
    const h = headline(r), top = r.causes[0];
    $('report-title').textContent = h.title;
    $('report-line').textContent = h.en.replace(/^[^.]+\. /, '');
    $('report-chart').innerHTML = timeline(r.samples);
    $('report-len').textContent = r.minutes < 1 ? 'Under a minute' : `${r.minutes} min session`;
    $('rep-aligned').textContent = r.aligned == null ? '—' : r.aligned + '%';
    $('rep-recover').textContent = fmtSec(r.avgRecover);
    $('rep-drifts').textContent = r.drifts;
    $('rep-drift-note').textContent = r.reds ? `drifts · ${r.reds} reached red` : 'drifts · none reached red';
    $('rep-causes').innerHTML = r.causes.length
      ? r.causes.map(c => `<div class="cause"><span>${c.label}</span><i style="--w:${c.share}%"></i><b>${c.share}%</b></div>`).join('')
      : '<p class="sub">No drifts to analyze. Nicely done.</p>';
    $('rep-tip').innerHTML = top ? `<b>Try: ${top.stretch}.</b> <span>${top.tip}</span>` : '<b>Keep it up.</b> <span>Take a short break anyway — moving helps.</span>';
    $('report').hidden = false;
    $('report-break').focus({ preventScroll: true });
    speak?.(h.en);
    const done = choice => { $('report').hidden = true; ['report-break', 'report-new', 'report-done'].forEach(id => { $(id).onclick = null; }); resolve(choice); };
    $('report-break').onclick = () => done('break');
    $('report-new').onclick = () => done('new');
    $('report-done').onclick = () => done('done');
  });
}
