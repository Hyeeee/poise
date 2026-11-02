// The part of the camera view that nothing covers: below the top bar, above the ask bar,
// and left of the side panel. Returned in pixels relative to the given canvas.
export function safeArea(canvas, pad = 16) {
  const c = canvas.getBoundingClientRect();
  let l = c.left + pad, r = c.right - pad, t = c.top + pad, b = c.bottom - pad;
  const vis = el => el && !el.hidden && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  const top = document.querySelector('.topbar'); if (vis(top)) t = Math.max(t, top.getBoundingClientRect().bottom + pad);
  const ask = document.querySelector('#ask-form'); if (vis(ask)) b = Math.min(b, ask.getBoundingClientRect().top - pad);
  document.querySelectorAll('.panel').forEach(p => { if (vis(p)) { const pr = p.getBoundingClientRect(); if (pr.left > c.left + c.width / 2) r = Math.min(r, pr.left - pad); } });
  return { l: l - c.left, r: r - c.left, t: t - c.top, b: b - c.top, w: r - l, h: b - t };
}
