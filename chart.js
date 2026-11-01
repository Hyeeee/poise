// Small stock-style charts for posture. Higher on the chart = closer to your reference;
// the line dips when you drift. Used live in the Focus panel and again in the session report.

// Smooth line through points (Catmull-Rom turned into cubic Béziers), with no overshoot past the chart.
export function smooth(pts, minY = -Infinity, maxY = Infinity) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const c = v => Math.min(maxY, Math.max(minY, v));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, c(p1[1] + (p2[1] - p0[1]) * t)];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, c(p2[1] - (p3[1] - p1[1]) * t)];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// Keep at most n points. Each bucket keeps its largest drift, so short slouches still show.
export function bucket(points, n, key = 'x') {
  if (points.length <= n) return points;
  const out = [], size = points.length / n;
  for (let i = 0; i < n; i++) {
    const slice = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    if (!slice.length) continue;
    const worst = slice.reduce((a, b) => (b.d > a.d ? b : a));
    out.push({ ...worst, [key]: slice[slice.length - 1][key] });
  }
  return out;
}

let uid = 0;
/**
 * points: [{ x: 0..1 across the chart, d: % off reference }]
 * Returns { svg, end: { x, y } } — end is the last point in % of the box, for the live dot.
 */
export function postureChart(points, { W = 300, H = 110, top = 34, bottom = 8, ymax = 40, cue = 12, stroke = 'var(--live-line)', fill = 'var(--signal)' } = {}) {
  const id = 'pg' + (++uid);
  const y = d => top + (Math.min(d, ymax) / ymax) * (H - top - bottom);
  const pts = points.map(p => [p.x * W, y(p.d)]);
  const ref = y(0), cueY = y(cue);
  let line = '', area = '';
  if (pts.length) {
    line = smooth(pts, top, H - bottom);
    area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z`;
  }
  const last = pts[pts.length - 1] || [0, ref];
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pchart" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:${fill};stop-opacity:.55"/><stop offset="1" style="stop-color:${fill};stop-opacity:0"/>
    </linearGradient></defs>
    <line x1="0" x2="${W}" y1="${ref}" y2="${ref}" class="pc-ref"/>
    <line x1="0" x2="${W}" y1="${cueY}" y2="${cueY}" class="pc-cue"/>
    ${area ? `<path d="${area}" fill="url(#${id})" stroke="none"/>` : ''}
    ${line ? `<path d="${line}" class="pc-line" style="stroke:${stroke}"/>` : ''}
  </svg>`;
  return { svg, end: { x: last[0] / W * 100, y: last[1] / H * 100 }, cueY: cueY / H * 100, refY: ref / H * 100 };
}
