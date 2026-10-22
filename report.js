// Session analysis: records posture while the focus timer runs, then shows a summary
// when the session ends (End button or timer finished).
const $ = id => document.getElementById(id);

const CAUSES = {
  forward: { label: 'Leaning forward', tip: 'Your head drifted forward and down, toward the screen.', stretch: 'Upper-back release', ko: '앞으로 숙임' },
  side: { label: 'Tilting to one side', tip: 'Your head leaned off to one side.', stretch: 'Neck release', ko: '옆으로 기울어짐' },
  shoulders: { label: 'Uneven shoulders', tip: 'One shoulder dropped lower than the other.', stretch: 'Shoulder release', ko: '어깨 비대칭' },
  far: { label: 'Too far from the screen', tip: 'You sat back far from the screen, which often ends in leaning in to read.', stretch: 'Shoulder release', ko: '화면에서 너무 멂' },
  close: { label: 'Too close to the screen', tip: 'You leaned in close to the screen.', stretch: 'Breathe and look far away', ko: '화면에 너무 가까움' },
};

let s = null;

export const session = {
  reset() {
    s = { start: performance.now(), samples: [], time: { good: 0, amber: 0, red: 0 }, drifts: 0, reds: 0,
      driftStart: 0, longest: 0, recoveries: [], causes: { forward: 0, side: 0, shoulders: 0, close: 0, far: 0 }, lastT: 0, lastSample: 0, prev: 'white' };
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
      const scores = { forward: Math.max(0, delta.y) * 1.2, side: Math.abs(delta.x), shoulders: Math.abs(delta.tilt), close: widthRatio > 1 ? Math.log(widthRatio) * 2.5 : 0, far: widthRatio < 1 ? -Math.log(widthRatio) * 2.5 : 0 };
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
  'Great moves.': 'Great moves. Here is how you did.',
  'Nice moves.': 'Nice moves. Here is how you did.',
  'A quick move.': 'A quick move. Every bit helps.',
};
export const SPOKEN_LINES = Object.values(SAY);

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
  summary() {
    if (!b) return null;
    const r = { ...b, ms: performance.now() - b.start, poses: b.poses.slice() };
    b = null; return r;
  },
};

function bars(poses) {
  const W = 560, H = 120, pad = 6, n = poses.length || 1, gap = 14, bw = (W - pad * 2 - gap * (n - 1)) / n;
  return `<svg viewBox="0 0 ${W} ${H}" class="tl" role="img" aria-label="Best match for each stretch">
    <line x1="${pad}" x2="${W - pad}" y1="${H - 12 - (45 / 100) * (H - 24)}" y2="${H - 12 - (45 / 100) * (H - 24)}" class="tl-mid"/>
    ${poses.map((p, i) => { const h = Math.max(3, (p.best / 100) * (H - 24)); return `<rect x="${pad + i * (bw + gap)}" y="${H - 12 - h}" width="${bw}" height="${h}" rx="6" fill="${p.matched ? 'var(--aligned)' : p.best > 30 ? 'var(--drift)' : 'var(--reset)'}"/>`; }).join('')}</svg>`;
}

/** Break report. Resolves 'again' | 'focus' | 'done'. */
export function showBreakReport(r, speak) {
  return new Promise(resolve => {
    const mins = r.ms / 60000, len = mins < 1 ? `${Math.max(1, Math.round(r.ms / 1000))} sec` : `${Math.round(mins)} min`;
    const set = (id, v) => { $(id).textContent = v; };
    const labels = { 'rep-aligned-l': '', 'rep-recover-l': '', 'rep-drift-note': '', 'rep-causes-h': '', 'report-new': '', 'report-break': '' };
    for (const k in labels) labels[k] = $(k).textContent;
    const legend = $('report-legend'); const legendWas = legend.hidden;
    let title, line;
    if (r.kind === 'game') {
      const g = r.game || { score: 0, popped: 0, missed: 0, best: 0, zones: { high: 0, side: 0, low: 0, head: 0 } };
      const tries = g.popped + g.missed, rate = tries ? Math.round(g.popped / tries * 100) : 0;
      title = g.popped >= 20 ? 'Great moves.' : g.popped >= 8 ? 'Nice moves.' : 'A quick move.';
      line = g.popped ? `You popped ${g.popped} bubbles for ${g.score} points, best streak ${g.best}.` : 'Start the game next time to get moving.';
      $('report-chart').hidden = true; legend.hidden = true;
      set('rep-aligned', g.score); set('rep-aligned-l', 'points');
      set('rep-recover', g.popped); set('rep-recover-l', 'bubbles popped');
      set('rep-drifts', tries ? rate + '%' : '—'); set('rep-drift-note', 'hit rate');
      const zones = [['high', 'Reaching up'], ['side', 'Reaching out'], ['low', 'Reaching down'], ['head', 'Leaning (head)']];
      const zt = Object.values(g.zones).reduce((a, n) => a + n, 0);
      $('rep-causes-h').hidden = !zt; $('rep-causes-h').textContent = 'How you moved';
      $('rep-causes').innerHTML = zt ? zones.map(([k, l]) => `<div class="cause"><span>${l}</span><i style="--w:${Math.round(g.zones[k] / zt * 100)}%"></i><b>${g.zones[k]}</b></div>`).join('') : '';
      const weakest = zones.filter(([k]) => k !== 'head').sort((a, c) => g.zones[a[0]] - g.zones[c[0]])[0];
      $('rep-tip').innerHTML = zt ? `<b>Next round:</b> <span>Try more ${weakest[1].toLowerCase()} — it opens the parts you use least while sitting.</span>` : '<b>Tip:</b> <span>Step back from the screen so your whole upper body and arms are in view.</span>';
    } else if (r.kind === 'breathe') {
      title = mins >= 2 ? 'Good rest.' : 'Short rest.';
      line = `You rested ${len} and took ${r.cycles} slow breath${r.cycles === 1 ? '' : 's'}.`;
      $('report-chart').innerHTML = ''; $('report-chart').hidden = true; legend.hidden = true;
      set('rep-aligned', len); set('rep-aligned-l', 'rested');
      set('rep-recover', r.cycles); set('rep-recover-l', 'slow breaths');
      set('rep-drifts', mins >= 2 ? '✓' : '—'); set('rep-drift-note', mins >= 2 ? 'full reset' : 'try two minutes or more');
      $('rep-causes-h').hidden = true; $('rep-causes').innerHTML = '';
      $('rep-tip').innerHTML = '<b>Next time:</b> <span>Look at something far away while you breathe out — it rests your eyes too.</span>';
    } else {
      const done = r.poses.filter(p => p.matched), total = r.poses.length;
      const avg = total ? Math.round(r.poses.reduce((a, p) => a + p.best, 0) / total) : 0;
      title = !total ? 'Break ended.' : done.length === total ? 'Great stretch.' : done.length >= total / 2 ? 'Nice stretch.' : 'A light stretch.';
      line = total ? `You rested ${len} and followed ${done.length} of ${total} stretches.` : `You rested ${len}.`;
      $('report-chart').hidden = false; $('report-chart').innerHTML = bars(r.poses); legend.hidden = true;
      set('rep-aligned', len); set('rep-aligned-l', 'rested');
      set('rep-recover', `${done.length}/${total}`); set('rep-recover-l', 'stretches followed');
      set('rep-drifts', total ? avg + '%' : '—'); set('rep-drift-note', 'average best match');
      $('rep-causes-h').hidden = !total; $('rep-causes-h').textContent = 'Each stretch';
      $('rep-causes').innerHTML = r.poses.map(p => `<div class="cause"><span>${p.name}</span><i style="--w:${Math.round(p.best)}%"></i><b>${p.matched ? '✓' : p.skipped ? 'skip' : Math.round(p.best) + '%'}</b></div>`).join('');
      const miss = r.poses.find(p => !p.matched);
      $('rep-tip').innerHTML = miss ? `<b>Try again later: ${miss.name}.</b> <span>Keep your arms in view and mirror the figure slowly.</span>` : '<b>Nicely done.</b> <span>Your shoulders and neck should feel looser now.</span>';
    }
    if (r.awayMs > 15000) line += ` You stepped away from your desk for ${r.awayMs < 60000 ? Math.round(r.awayMs / 1000) + ' seconds' : Math.round(r.awayMs / 60000) + ' min'}.`;
    set('report-title', title); set('report-line', line); set('report-len', `${len} break`);
    set('report-new', r.kind === 'game' ? 'Play again' : r.kind === 'breathe' ? 'Breathe again' : 'Stretch again'); set('report-break', 'Back to focus');
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
