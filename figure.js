// One ink-sketch person, shared by the Break guide (full body, does the stretches)
// and the Focus avatar (upper body, mirrors how you sit).
// Neutral look: short hair, plain tee, trousers.
//
// Figure space: waist at (0,0), up is negative y.
// P: lean, bend, look, head, drop, shrug, eL/wL/eR/wR (arm points), breath
//    plus avatar extras: shTilt (px, + = screen-left shoulder lower), hx (px head shift), fwd (0..1 head forward)
export function drawFigure(ctx, P, { j = () => 0, ink = '#141412', paper = '#fbfaf6', shirt = ink, legs = true } = {}) {
  let n = 0;
  const jp = p => [p[0] + j(n++), p[1] + j(n++)];
  const poly = (pts, stroke) => { ctx.beginPath(); pts.map(jp).forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath(); ctx.lineJoin = 'round'; ctx.fill(); if (stroke) ctx.stroke(); };
  const limb = (a, b, width, color = ink) => {
    const A = jp(a), B = jp(b);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = width + 4.5; ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
    ctx.strokeStyle = paper; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
    ctx.strokeStyle = ink;
  };

  ctx.strokeStyle = ink; ctx.lineCap = 'round';
  const drop = (P.drop || 0) + (P.breath || 0), shrug = P.shrug || 0, tiltS = P.shTilt || 0, hx = P.hx || 0, fwd = P.fwd || 0;
  const SL = [-40, -116 - shrug + drop + tiltS], SR = [40, -116 - shrug + drop - tiltS];
  const NECK = [hx * .35, -124 + drop];

  if (legs) {
    ctx.fillStyle = ink;
    poly([[-36, -10], [-3, -10], [-6, 60], [-10, 160], [-34, 160], [-38, 60]]);
    poly([[36, -10], [3, -10], [6, 60], [10, 160], [34, 160], [38, 60]]);
    ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
    poly([[-34, 158], [-10, 158], [-6, 170], [-42, 170]], true);
    poly([[34, 158], [10, 158], [6, 170], [42, 170]], true);
  }
  // Everything above the waist bends sideways around the waist.
  ctx.save(); ctx.translate(0, -10); ctx.rotate(P.bend || 0); ctx.translate(0, 10);

  // Plain tee from shoulders to waist.
  ctx.fillStyle = shirt;
  poly([[SL[0] - 2, SL[1] + 1], [NECK[0] - 11, NECK[1] + 7], [NECK[0] + 11, NECK[1] + 7], [SR[0] + 2, SR[1] + 1], [37, SR[1] + 22], [34, -12], [-34, -12], [-37, SL[1] + 22]]);

  // Head on the neck: tilted (head), shifted (hx), and lower + a little bigger when it juts forward (fwd).
  const tilt = P.head || 0, look = P.look || 0, neckLen = 38 - fwd * 14, hs = 1 + fwd * .14;
  const hX = NECK[0] + hx * .65 + Math.sin(tilt) * neckLen + look * 7, hY = NECK[1] - Math.cos(tilt) * neckLen;
  limb(NECK, [NECK[0] + (hX - NECK[0]) * .42, NECK[1] + (hY - NECK[1]) * .42], 13);
  ctx.save();
  ctx.translate(hX, hY); ctx.rotate(tilt); ctx.scale(hs, hs);
  ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.ellipse(j(n++, .5), j(n++, .5), 19, 23, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Short hair: a simple cap with a soft fringe. No bun.
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.ellipse(0, 0, 20.5, 24.5, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.quadraticCurveTo(14, -10 + j(n++, .6), 4, -11); ctx.quadraticCurveTo(-8, -9, -20, -3); ctx.fill();
  // Closed eyes and a small nose line.
  ctx.lineWidth = 1.8; ctx.beginPath();
  const lk = look * 7;
  ctx.moveTo(-11 + lk, 3); ctx.quadraticCurveTo(-7 + lk, 6, -3 + lk, 3);
  ctx.moveTo(4 + lk, 3); ctx.quadraticCurveTo(8 + lk, 6, 12 + lk, 3);
  ctx.moveTo(1 + lk * 1.3, 7); ctx.lineTo(lk * 1.3, 12); ctx.stroke();
  ctx.restore();

  // Arms last so crossing arms sit in front of the body.
  const L = [SL, P.eL, P.wL], R = [SR, P.eR, P.wR];
  for (const [s0, e, wr] of [R, L]) {
    const el = [e[0], e[1] + drop], w = [wr[0], wr[1] + drop];
    limb(s0, el, 11);
    limb(el, w, 9);
    ctx.fillStyle = paper; ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(w[0] + j(n++, .6), w[1] + j(n++, .6), 5.5, 7.5, Math.atan2(w[1] - el[1], w[0] - el[0]) - Math.PI / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
