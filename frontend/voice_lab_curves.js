/* Planar Lissajous illustrations for the three exercise paths. */
(() => {
  'use strict';
  const picker = document.getElementById('warmup-choose');
  if (!picker) return;
  const TURN = 2 * Math.PI, RADIUS = 48, PHASE = Math.PI / 2;
  const PERIOD = 12, TAIL_SECONDS = 4, TAIL_SEGMENTS = 32, SVG = 'http://www.w3.org/2000/svg';
  const curves = [...picker.querySelectorAll('.warmup-path-curve')].map(svg => {
    const [a, b] = svg.dataset.ratio.split(':').map(Number);
    const group = svg.querySelector('g'), path = svg.querySelector('path'), dot = svg.querySelector('circle');
    // The chart uses the relative phase a*phaseX-b*phaseY: distributing pi/2
    // over a keeps all three figures open into lobes, rather than retracing
    // the 2:3 figure. Vertical orientation matches the supplied reference.
    const point = t => [RADIUS * Math.cos(b * t + PHASE / a), -RADIUS * Math.cos(a * t)];
    path.classList.add('warmup-path-guide');
    path.setAttribute('d', Array.from({length:769}, (_, i) => {
      const [x, y] = point(TURN * i / 768);
      return `${i ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)}`;
    }).join(' ') + ' Z');
    const trail = document.createElementNS(SVG, 'g');
    trail.classList.add('warmup-path-trail');
    const segments = Array.from({length:TAIL_SEGMENTS}, (_, i) => {
      const segment = document.createElementNS(SVG, 'path'), strength = (i + 1) / TAIL_SEGMENTS;
      segment.setAttribute('stroke-opacity', strength * strength);
      segment.style.strokeWidth = .7 + 1.1 * strength;
      trail.append(segment);
      return segment;
    });
    group.insertBefore(trail, dot);
    return {svg, dot, point, segments, visible:false};
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController(), options = {signal:events.signal};
  let frame = 0, last = null, elapsed = 0, pageHidden = false;

  function draw(curve) {
    const head = elapsed * TURN / PERIOD;
    const [x, y] = curve.point(head);
    curve.dot.setAttribute('cx', x);
    curve.dot.setAttribute('cy', y);
    // Sample backwards in parameter time, so crossings and the loop boundary
    // preserve the actual route of the dot. Each adjacent segment shares its
    // endpoint; the head lands exactly under the dot, without a closing chord.
    const step = TAIL_SECONDS * TURN / PERIOD / TAIL_SEGMENTS;
    curve.segments.forEach((segment, i) => {
      const start = head - (TAIL_SEGMENTS - i) * step;
      segment.setAttribute('d', Array.from({length:5}, (_, sample) => {
        const [sx, sy] = curve.point(start + sample * step / 4);
        return `${sample ? 'L' : 'M'}${sx.toFixed(3)},${sy.toFixed(3)}`;
      }).join(' '));
    });
  }
  function active() {
    return !pageHidden && !document.hidden && !picker.hidden
      && !document.querySelector('dialog[open]') && !reduced.matches
      && curves.some(curve => curve.visible);
  }
  function tick(now) {
    frame = 0;
    if (!active()) { last = null; return; }
    if (last !== null) elapsed += Math.min((now - last) / 1000, .1);
    last = now;
    for (const curve of curves) if (curve.visible) draw(curve);
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; last = null;
    if (reduced.matches) {
      elapsed = 0;
      curves.forEach(draw);
    }
    if (active()) frame = requestAnimationFrame(tick);
  }
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) curves.find(curve => curve.svg === entry.target).visible = entry.isIntersecting;
    sync();
  });
  curves.forEach(curve => { draw(curve); visibility.observe(curve.svg); });
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {subtree:true, attributes:true, attributeFilter:['hidden', 'open']});
  reduced.addEventListener('change', sync, options);
  document.addEventListener('visibilitychange', sync, options);
  window.addEventListener('pagehide', event => {
    pageHidden = true; sync();
    if (!event.persisted) { visibility.disconnect(); observer.disconnect(); events.abort(); }
  }, options);
  window.addEventListener('pageshow', () => { pageHidden = false; sync(); }, options);
  sync();
})();
