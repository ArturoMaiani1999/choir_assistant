(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceDrawCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SHAPES = Object.freeze({
    square: { label: 'Rettangolo', points: [[.22, 2.7], [.78, 2.7], [.78, -2.7], [.22, -2.7], [.22, 2.7]] },
    diamond: { label: 'Rombo', points: [[.5, 3.2], [.82, 0], [.5, -3.2], [.18, 0], [.5, 3.2]] },
  });
  const TOLERANCE = 1; // A generous semitone on either side of the contour.
  const HORIZONTAL_SCALE = 10;
  const BINS_PER_EDGE = 6;
  const MAX_SECONDS = 60;
  const RETURN_RADIUS = TOLERANCE;
  const SCORE_THRESHOLD = .5;
  function nearest(points, x, offset) {
    let best = { distance: Infinity, edge: 0, fraction: 0 };
    for (let edge = 0; edge < points.length - 1; edge += 1) {
      const [ax, ay] = points[edge], [bx, by] = points[edge + 1];
      const dx = (bx - ax) * HORIZONTAL_SCALE, dy = by - ay;
      const fraction = Math.max(0, Math.min(1, (((x - ax) * HORIZONTAL_SCALE * dx) + (offset - ay) * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot((x - ax) * HORIZONTAL_SCALE - fraction * dx, offset - ay - fraction * dy);
      if (distance < best.distance) best = { distance, edge, fraction };
    }
    return best;
  }
  function create(shape = 'square', centerMidi = 60, { lowMidi, highMidi } = {}) {
    if (!SHAPES[shape]) throw new Error('Figura sconosciuta');
    const hasPitchPair = Number.isFinite(lowMidi) && Number.isFinite(highMidi) && lowMidi < highMidi;
    const top = hasPitchPair ? highMidi - centerMidi : SHAPES[shape].points[0][1];
    const bottom = hasPitchPair ? lowMidi - centerMidi : SHAPES[shape].points[2][1];
    const middle = (top + bottom) / 2;
    const points = shape === 'square'
      ? [[.22, top], [.78, top], [.78, bottom], [.22, bottom], [.22, top]]
      : [[.5, top], [.82, middle], [.5, bottom], [.18, middle], [.5, top]];
    return { shape, centerMidi, points, noteMidis: hasPitchPair ? [lowMidi, highMidi] : null, x: points[0][0], insideSeconds: 0, outsideSeconds: 0, elapsed: 0, bins: new Set(), trace: [], leftStart: false, completed: false, timedOut: false, finished: false };
  }
  function score(session) {
    const voiced = session.insideSeconds + session.outsideSeconds;
    const coverage = session.bins.size / ((session.points.length - 1) * BINS_PER_EDGE);
    const ratio = session.outsideSeconds ? session.insideSeconds / session.outsideSeconds : session.insideSeconds ? Infinity : 0;
    const insideFraction = voiced ? session.insideSeconds / voiced : 0;
    const value = coverage * insideFraction;
    return { coverage, ratio, insideFraction, score: value, completed: session.completed, timedOut: session.timedOut, success: session.completed && value > SCORE_THRESHOLD };
  }
  function update(session, { direction = 0, midi = null, confidence = 0, seconds = 0 }) {
    if (session.finished) return score(session);
    const dt = Math.max(0, Math.min(.1, seconds));
    session.elapsed += dt;
    session.x = Math.max(.08, Math.min(.92, session.x + Math.sign(direction) * dt * .17));
    const valid = Number.isFinite(midi) && confidence >= .3;
    const offset = valid ? midi - session.centerMidi : null;
    const closest = valid ? nearest(session.points, session.x, offset) : null;
    const inside = Boolean(closest && closest.distance <= TOLERANCE);
    if (inside) {
      session.insideSeconds += dt;
      session.bins.add(closest.edge * BINS_PER_EDGE + Math.min(BINS_PER_EDGE - 1, Math.floor(closest.fraction * BINS_PER_EDGE)));
    } else session.outsideSeconds += dt;
    if (dt && valid) session.trace.push({ x: session.x, midi, inside, time: session.elapsed });
    if (valid) {
      const [startX, startOffset] = session.points[0];
      const startDistance = Math.hypot((session.x - startX) * HORIZONTAL_SCALE, offset - startOffset);
      if (startDistance > RETURN_RADIUS * 2) session.leftStart = true;
      else if (session.leftStart && startDistance <= RETURN_RADIUS) session.completed = true;
    }
    if (session.completed || session.elapsed >= MAX_SECONDS) {
      session.timedOut = !session.completed;
      session.finished = true;
    }
    return { ...score(session), inside, finished: session.finished };
  }
  return { SHAPES, TOLERANCE, BINS_PER_EDGE, MAX_SECONDS, RETURN_RADIUS, SCORE_THRESHOLD, create, update, score, nearest };
});
