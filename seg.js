// Segmented controls: a dark "thumb" slides under the selected button instead of each
// button fading on its own. Works for every .segmented on the page, including ones added later.
function place(seg, animate) {
  const active = seg.querySelector('button.active');
  let thumb = seg.querySelector(':scope > .seg-thumb');
  if (!thumb) { thumb = document.createElement('span'); thumb.className = 'seg-thumb'; seg.prepend(thumb); animate = false; }
  if (!active || !seg.offsetWidth) { thumb.style.opacity = active ? thumb.style.opacity : '0'; return; }
  const x = active.offsetLeft, w = active.offsetWidth;
  if (!animate || thumb.dataset.ready !== '1') {
    thumb.style.transition = 'none';
    thumb.style.transform = `translateX(${x}px)`; thumb.style.width = `${w}px`; thumb.style.opacity = '1';
    thumb.offsetWidth;                       // apply before turning transitions back on
    thumb.style.transition = ''; thumb.dataset.ready = '1';
    return;
  }
  thumb.style.transform = `translateX(${x}px)`; thumb.style.width = `${w}px`; thumb.style.opacity = '1';
}
let queued = false;
function updateAll(animate = true) {
  if (queued) return; queued = true;
  requestAnimationFrame(() => { queued = false; document.querySelectorAll('.segmented').forEach(s => place(s, animate)); });
}
new MutationObserver(list => {
  // Ignore the thumb's own style changes.
  if (list.every(m => m.target.classList?.contains('seg-thumb'))) return;
  updateAll(true);
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
addEventListener('resize', () => updateAll(false));
document.fonts?.ready.then(() => updateAll(false));
updateAll(false);
