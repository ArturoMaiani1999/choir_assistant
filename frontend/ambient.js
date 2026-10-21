/* Corner scene for the desktop exercise picker only. */
(() => {
  'use strict';
  const element = document.querySelector('.ambient-curve');
  if (!element) return;
  const scene = Lissajous.create(element.querySelector('.ambient-curve__line'),
    element.querySelector('.ambient-curve__glow'), {home:true, compact:true, active:false});
  const events = new AbortController(), options = {signal:events.signal};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let pending = 0, pageHidden = false;
  // Only check on layout/navigation changes, never on scroll or every frame.
  function sync() {
    pending = 0;
    const body = document.body;
    const picker = body.classList.contains('warmup-body');
    const busy = pageHidden || (picker && (innerWidth<900 || body.dataset.screen!=='choose'))
      || body.classList.contains('performance-review-open') || body.classList.contains('pitch-lab-open')
      || Boolean(document.querySelector('dialog[open]'));
    const bounds = element.getBoundingClientRect();
    let overlaps = false;
    if (picker && !busy) {
      // Yield to text, music and controls when a small viewport has no free
      // corner. Pointer transparency alone would still impair readability.
      for (const item of document.querySelectorAll('main :is(a,button,input,select,summary,h1,h2,h3,p,label,table,.piece-card,.panel,.welcome,.warmup-path,.warmup-lesson,.warmup-setup)')) {
        if (!item.checkVisibility()) continue;
        const r = item.getBoundingClientRect();
        if (r.width && r.height && r.left < bounds.right && r.right > bounds.left
          && r.top < bounds.bottom && r.bottom > bounds.top) { overlaps=true;break; }
      }
    }
    const suspended = busy || overlaps;
    element.dataset.suspended = String(suspended);
    if (scene.state.paused !== reduced.matches) scene.setPaused(reduced.matches);
    if (scene.state.active !== !suspended) scene.setActive(!suspended);
  }
  function schedule() { if (!pending && !pageHidden) pending=requestAnimationFrame(sync); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-screen','open','hidden']});
  const sizeObserver = new ResizeObserver(schedule);
  sizeObserver.observe(element);
  sizeObserver.observe(document.querySelector('main'));
  reduced.addEventListener('change',schedule,options);
  window.addEventListener('resize',schedule,options);
  window.addEventListener('pagehide',event => {
    pageHidden=true;
    if(pending)cancelAnimationFrame(pending);
    pending=0;scene.setActive(false);
    if(!event.persisted) { observer.disconnect();sizeObserver.disconnect();events.abort();scene.destroy(); }
  },options);
  window.addEventListener('pageshow',() => {pageHidden=false;sync();},options);
  sync();
})();
