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
  const COMPLETION_COVERAGE = .7;
  const VERTEX_FRACTION = .85;
  function projectEdge(points, edge, x, offset) {
    const [ax, ay] = points[edge], [bx, by] = points[edge + 1];
    const dx = (bx - ax) * HORIZONTAL_SCALE, dy = by - ay;
    const fraction = Math.max(0, Math.min(1, (((x - ax) * HORIZONTAL_SCALE * dx) + (offset - ay) * dy) / (dx * dx + dy * dy)));
    return { distance: Math.hypot((x - ax) * HORIZONTAL_SCALE - fraction * dx, offset - ay - fraction * dy), edge, fraction };
  }
  function nearest(points, x, offset) {
    let best = { distance: Infinity, edge: 0, fraction: 0 };
    for (let edge = 0; edge < points.length - 1; edge += 1) {
      const candidate = projectEdge(points, edge, x, offset);
      if (candidate.distance < best.distance) best = candidate;
    }
    return best;
  }
  const smootherstep = value => {
    const t = Math.max(0, Math.min(1, value));
    return Math.max(0, Math.min(1, t * t * t * (t * (t * 6 - 15) + 10)));
  };
  function createGuideTimeline(points, { initialStopSeconds = .7, vertexStopSeconds = .55 } = {}) {
    let cursor = initialStopSeconds;
    const segments = [];
    for (let edge = 0; edge < points.length - 1; edge += 1) {
      const [ax, ay] = points[edge], [bx, by] = points[edge + 1];
      const length = Math.hypot((bx - ax) * HORIZONTAL_SCALE, by - ay);
      const moveSeconds = Math.max(2.2, Math.min(4.2, length * .56));
      const moveStart = cursor, moveEnd = moveStart + moveSeconds, stopEnd = moveEnd + vertexStopSeconds;
      segments.push({ edge, moveStart, moveEnd, stopEnd, moveSeconds, from: points[edge], to: points[edge + 1] });
      cursor = stopEnd;
    }
    return { points, profile: 'smootherstep-stop', initialStopSeconds, vertexStopSeconds, segments, duration: cursor };
  }
  function guidePosition(timeline, elapsedSeconds, { loop = true } = {}) {
    if (!timeline?.segments?.length) return null;
    const duration = timeline.duration;
    const time = loop && duration > 0 ? ((Math.max(0, elapsedSeconds) % duration) + duration) % duration : Math.min(duration, Math.max(0, elapsedSeconds));
    if (time < timeline.initialStopSeconds) {
      const [x, offset] = timeline.points[0];
      return { x, offset, edge: 0, fraction: 0, stopped: true, stopIndex: 0, time, duration };
    }
    for (const segment of timeline.segments) {
      if (time <= segment.moveEnd) {
        const linearFraction = (time - segment.moveStart) / segment.moveSeconds;
        const fraction = smootherstep(linearFraction);
        return { x: segment.from[0] + (segment.to[0] - segment.from[0]) * fraction,
          offset: segment.from[1] + (segment.to[1] - segment.from[1]) * fraction,
          edge: segment.edge, fraction, stopped: false, stopIndex: null, time, duration };
      }
      if (time <= segment.stopEnd) {
        return { x: segment.to[0], offset: segment.to[1], edge: segment.edge, fraction: 1,
          stopped: true, stopIndex: segment.edge + 1, time, duration };
      }
    }
    const [x, offset] = timeline.points.at(-1);
    return { x, offset, edge: timeline.segments.length - 1, fraction: 1, stopped: true,
      stopIndex: timeline.segments.length, time, duration };
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
    return { shape, centerMidi, points, noteMidis: hasPitchPair ? [lowMidi, highMidi] : null,
      x: points[0][0], insideSeconds: 0, outsideSeconds: 0, elapsed: 0, bins: new Set(), trace: [],
      pathStarted: false, currentEdge: 0, edgeProgress: 0, reachedVertices: new Set(),
      guideTimeline: createGuideTimeline(points), completed: false, timedOut: false, finished: false };
  }
  function score(session) {
    const voiced = session.insideSeconds + session.outsideSeconds;
    const coverage = session.bins.size / ((session.points.length - 1) * BINS_PER_EDGE);
    const ratio = session.outsideSeconds ? session.insideSeconds / session.outsideSeconds : session.insideSeconds ? Infinity : 0;
    const insideFraction = voiced ? session.insideSeconds / voiced : 0;
    const value = coverage * insideFraction;
    return { coverage, ratio, insideFraction, score: value, completed: session.completed, timedOut: session.timedOut,
      currentEdge: session.currentEdge, verticesReached: session.reachedVertices.size,
      success: session.completed && value > SCORE_THRESHOLD };
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
      if (!session.pathStarted && startDistance <= RETURN_RADIUS) {
        session.pathStarted = true;
        session.reachedVertices.add(0);
      }
      if (session.pathStarted && !session.completed) {
        const lastEdge = session.points.length - 2;
        const expected = projectEdge(session.points, session.currentEdge, session.x, offset);
        if (expected.distance <= TOLERANCE) {
          session.edgeProgress = Math.max(session.edgeProgress, expected.fraction);
          if (session.edgeProgress >= VERTEX_FRACTION) {
            session.reachedVertices.add(session.currentEdge + 1);
            if (session.currentEdge < lastEdge) {
              session.currentEdge += 1;
              session.edgeProgress = 0;
            } else {
              const coverage = session.bins.size / ((session.points.length - 1) * BINS_PER_EDGE);
              session.completed = startDistance <= RETURN_RADIUS && coverage >= COMPLETION_COVERAGE;
            }
          }
        }
      }
    }
    if (session.completed || session.elapsed >= MAX_SECONDS) {
      session.timedOut = !session.completed;
      session.finished = true;
    }
    return { ...score(session), inside, finished: session.finished };
  }
  return { SHAPES, TOLERANCE, BINS_PER_EDGE, MAX_SECONDS, RETURN_RADIUS, SCORE_THRESHOLD, COMPLETION_COVERAGE,
    VERTEX_FRACTION, create, update, score, nearest, createGuideTimeline, guidePosition, smootherstep };
});
