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
  function measureSeekState(measures, selectedIndex) {
    const safeIndex = Math.max(0, Math.min(measures.length - 1, selectedIndex));
    return { selectedIndex: safeIndex, playbackStart: measures[Math.max(0, safeIndex - 1)]?.startBeat ?? 0, scoringStart: measures[safeIndex]?.startBeat ?? 0 };
  }
  function rhythmGridLines(measures, visibleStart, visibleEnd) {
    const lines = [];
    measures.forEach((measure, index) => {
      if (measure.endBeat < visibleStart || measure.startBeat > visibleEnd) return;
      const denominator = measure.timeSignatureDenominator || 4;
      const pulse = 4 / denominator;
      const subdivision = Math.max(.25, pulse / 2);
      lines.push({ beat: measure.startBeat, kind: 'measure', label: `B. ${measure.number}` });
      const slots = Math.round((measure.endBeat - measure.startBeat) / subdivision);
      for (let slot = 1; slot < slots; slot += 1) {
        const offset = slot * subdivision;
        const pulseIndex = offset / pulse;
        const isPulse = Math.abs(pulseIndex - Math.round(pulseIndex)) < 1e-7;
        lines.push({ beat: measure.startBeat + offset, kind: isPulse ? 'beat' : 'subdivision', label: isPulse ? String(Math.round(pulseIndex) + 1) : null });
      }
      if (index === measures.length - 1) lines.push({ beat: measure.endBeat, kind: 'measure', label: null });
    });
    return lines.filter((line) => line.beat >= visibleStart && line.beat <= visibleEnd);
  }
  function smoothPitchBounds(current, target, elapsedMs, responseMs = 180) {
    const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / responseMs);
    const bounds = { min: current.min + (target.min - current.min) * alpha, max: current.max + (target.max - current.max) * alpha };
    const animating = Math.abs(target.min - bounds.min) > .01 || Math.abs(target.max - bounds.max) > .01;
    return { bounds: animating ? bounds : { ...target }, animating };
  }
  return { NOTE_NAMES, hzToPitch, pitchToHz, pitchToName, centsBetween, pitchToY, timeToX, measureSeekState, rhythmGridLines, smoothPitchBounds };
});
