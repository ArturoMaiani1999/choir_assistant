(function exposePracticeMath(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PracticeMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPracticeMath() {
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function hzToPitch(hz) { return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null; }
  function pitchToHz(pitch) { return 440 * Math.pow(2, (pitch - 69) / 12); }
  function pitchToName(pitch) {
    if (!Number.isFinite(pitch)) return '—';
    const midi = Math.round(pitch);
    return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }
  function centsBetween(singerHz, targetHz) { return singerHz > 0 && targetHz > 0 ? 1200 * Math.log2(singerHz / targetHz) : null; }
  function pitchToY(pitch, minPitch, maxPitch, top, bottom) { return maxPitch === minPitch ? (top + bottom) / 2 : bottom - ((pitch - minPitch) / (maxPitch - minPitch)) * (bottom - top); }
  function timeToX(eventBeat, currentBeat, left, right, historyBeats, futureBeats) {
    const width = right - left;
    return left + width * (historyBeats / (historyBeats + futureBeats)) + (eventBeat - currentBeat) * width / (historyBeats + futureBeats);
  }
  function melodicIntervalLabel(semitones) {
    if (!Number.isFinite(semitones)) return null;
    const distance = Math.abs(semitones);
    const rounded = Math.round(distance);
    if (Math.abs(distance - rounded) > 1e-6) return null;
    return ({ 2: '2', 3: '3m', 4: '3M', 5: '4', 7: '5' })[rounded] ?? null;
  }
  function adjacentMelodicIntervals(events, epsilon = .001) {
    const intervals = [];
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1], next = events[index];
      const previousEnd = previous.onsetBeat + previous.durationBeats;
      if (Math.abs(previousEnd - next.onsetBeat) > epsilon) continue;
      const difference = next.midiPitch - previous.midiPitch;
      const label = melodicIntervalLabel(difference);
      if (label) intervals.push({ previous, next, label, direction: Math.sign(difference) });
    }
    return intervals;
  }
  function measureSeekState(measures, selectedIndex, { preRoll = true } = {}) {
    const safeIndex = Math.max(0, Math.min(measures.length - 1, selectedIndex));
    const scoringStart = measures[safeIndex]?.startBeat ?? 0;
    return { selectedIndex: safeIndex,
      playbackStart: preRoll ? measures[Math.max(0, safeIndex - 1)]?.startBeat ?? 0 : scoringStart,
      scoringStart };
  }
  function attemptResumeState(measures, checkpointBeat) {
    const endBeat = measures.at(-1)?.endBeat ?? 0;
    const resumeBeat = Math.max(0, Math.min(endBeat, Number(checkpointBeat) || 0));
    let resumeIndex = measures.findIndex((measure) => measure.startBeat <= resumeBeat && resumeBeat < measure.endBeat);
    if (resumeIndex < 0) resumeIndex = Math.max(0, measures.length - 1);
    return {
      resumeIndex,
      playbackStart: measures[Math.max(0, resumeIndex - 1)]?.startBeat ?? 0,
      scoringStart: resumeBeat,
    };
  }
  function metronomePerformanceTime(performanceTime, speed, offsetMs) {
    const safeTime = Math.max(0, Number(performanceTime) || 0);
    const safeSpeed = Math.max(.1, Number(speed) || 1);
    const safeOffset = Number(offsetMs) || 0;
    return Math.max(0, safeTime - safeOffset / 1000 * safeSpeed);
  }
  function delayedVisualBeat(runtime, performanceTime, speed, delayMs) {
    const safeTime = Math.max(0, Number(performanceTime) || 0);
    const safeSpeed = Math.max(.1, Number(speed) || 1);
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    return runtime.beatAtSeconds(Math.max(0, safeTime - safeDelay / 1000 * safeSpeed));
  }
  // Presentation only. Media time remains authoritative for samples/scoring.
  // Chromium Bluetooth positions can repeat for several animation frames.
  class VisualPlaybackTime {
    reset() { this.previous = null; }
    update(snapshot, nowMs, blocked = false) {
      const time = Math.max(0, Number(snapshot.performanceTime) || 0);
      const speed = Math.max(.1, Number(snapshot.speed) || 1);
      const previous = this.previous;
      const elapsed = previous ? (nowMs - previous.nowMs) / 1000 : 0;
      const reanchor = !previous || !snapshot.running || blocked || !previous.running
        || speed !== previous.speed || elapsed < 0 || elapsed > .25
        || time < previous.observed - .025 * speed
        || Math.abs(time - previous.value) > .3 * speed;
      let value = time, progressedAt = nowMs;
      if (!reanchor) {
        progressedAt = time > previous.observed + 1e-6 ? nowMs : previous.progressedAt;
        // Limit free-running prediction to 120 ms of unchanged media time.
        // A waiting/seeking event freezes immediately; this also bounds silent
        // stalls where the browser has not delivered an event yet.
        if (nowMs - progressedAt >= 120) value = previous.value;
        else {
          const predicted = previous.value + elapsed * speed;
          const correction = Math.max(-elapsed * speed * .1, Math.min(elapsed * speed * .1, time - predicted));
          value = Math.max(previous.value, Math.min(predicted + correction, time + .12 * speed));
        }
      }
      this.previous = { observed: time, value, speed, nowMs, progressedAt, running: snapshot.running && !blocked };
      return value;
    }
  }
  function rhythmGridLines(measures, visibleStart, visibleEnd) {
    const lines = [];
    measures.forEach((measure, index) => {
      if (measure.endBeat < visibleStart || measure.startBeat > visibleEnd) return;
      const denominator = measure.timeSignatureDenominator || 4;
      const pulse = 4 / denominator;
      const subdivision = Math.max(.25, pulse / 2);
      const beatOffset = measure.beatOffset ?? 0;
      const pickupBeat = beatOffset > 0 ? ` · ${Math.round(beatOffset) + 1}` : '';
      lines.push({ beat: measure.startBeat, kind: 'measure', label: `B. ${measure.number}${pickupBeat}` });
      const slots = Math.round((measure.endBeat - measure.startBeat) / subdivision);
      for (let slot = 1; slot < slots; slot += 1) {
        const offset = slot * subdivision;
        const pulseIndex = offset / pulse;
        const isPulse = Math.abs(pulseIndex - Math.round(pulseIndex)) < 1e-7;
        lines.push({ beat: measure.startBeat + offset, kind: isPulse ? 'beat' : 'subdivision', label: isPulse ? String(Math.round(pulseIndex + beatOffset) + 1) : null });
      }
      if (index === measures.length - 1) lines.push({ beat: measure.endBeat, kind: 'measure', label: null });
    });
    return lines.filter((line) => line.beat >= visibleStart && line.beat <= visibleEnd);
  }

  function limitTimelineWindowToMeasures(measures, centerBeat, historyBeats, futureBeats, maximumMeasures) {
    const validMeasures = (measures ?? []).filter((measure) => Number.isFinite(measure.startBeat)
      && Number.isFinite(measure.endBeat) && measure.endBeat > measure.startBeat);
    const limit = Math.max(1, Math.floor(Number(maximumMeasures) || 1));
    const countVisible = (scale) => {
      const start = centerBeat - historyBeats * scale;
      const end = centerBeat + futureBeats * scale;
      const epsilon = 1e-7;
      return validMeasures.filter((measure) => measure.endBeat > start + epsilon
        && measure.startBeat < end - epsilon).length;
    };
    if (!validMeasures.length || countVisible(1) <= limit) return { historyBeats, futureBeats };
    let lower = 0;
    let upper = 1;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const scale = (lower + upper) / 2;
      if (countVisible(scale) <= limit) lower = scale;
      else upper = scale;
    }
    return { historyBeats: historyBeats * lower, futureBeats: futureBeats * lower };
  }
  function smoothPitchBounds(current, target, elapsedMs, responseMs = 180) {
    const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / responseMs);
    const bounds = { min: current.min + (target.min - current.min) * alpha, max: current.max + (target.max - current.max) * alpha };
    const animating = Math.abs(target.min - bounds.min) > .01 || Math.abs(target.max - bounds.max) > .01;
    return { bounds: animating ? bounds : { ...target }, animating };
  }
  return { NOTE_NAMES, hzToPitch, pitchToHz, pitchToName, centsBetween, pitchToY, timeToX, melodicIntervalLabel, adjacentMelodicIntervals, measureSeekState, attemptResumeState, metronomePerformanceTime, delayedVisualBeat, VisualPlaybackTime, rhythmGridLines, limitTimelineWindowToMeasures, smoothPitchBounds };
});
