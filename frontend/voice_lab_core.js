(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceLabCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TEMPOS = Object.freeze([60, 80, 100]);
  const COUNT_IN_BEATS = 4;
  const REFERENCE_PITCH_CLASS = 5;
  const MAX_ASCENT_SEMITONES = 3;
  const ARPEGGIO_QUALITIES = Object.freeze(['major', 'minor', 'major', 'minor']);
  const TRIAD_INVERSIONS = Object.freeze(['root', 'first', 'second']);
  const INVERSION_LABELS = Object.freeze({ root: 'stato fondamentale', first: 'primo rivolto', second: 'secondo rivolto' });
  const DEGREE_TARGETS = Object.freeze([
    Object.freeze({ id: 'sharp1-flat2', label: '♯1 / ♭2', offset: 1 }),
    Object.freeze({ id: '2', label: '2', offset: 2 }),
    Object.freeze({ id: 'sharp2-flat3', label: '♯2 / ♭3', offset: 3 }),
    Object.freeze({ id: '3', label: '3', offset: 4 }),
    Object.freeze({ id: '4', label: '4', offset: 5 }),
    Object.freeze({ id: 'sharp4-flat5', label: '♯4 / ♭5', offset: 6 }),
    Object.freeze({ id: '5', label: '5', offset: 7 }),
    Object.freeze({ id: 'sharp5-flat6', label: '♯5 / ♭6', offset: 8 }),
    Object.freeze({ id: '6', label: '6', offset: 9 }),
    Object.freeze({ id: 'sharp6-flat7', label: '♯6 / ♭7', offset: 10 }),
    Object.freeze({ id: '7', label: '7', offset: 11 }),
    Object.freeze({ id: '8', label: '8', offset: 12 }),
  ]);
  const DEGREE_LEVELS = Object.freeze({
    base: Object.freeze(['2', '3', '4', '5']),
    advanced: Object.freeze(DEGREE_TARGETS.map((target) => target.id)),
  });
  const ROLE_RANGES = Object.freeze({
    soprano: Object.freeze({ lowMidi: 60, highMidi: 77 }),
    alto: Object.freeze({ lowMidi: 53, highMidi: 72 }),
    tenor: Object.freeze({ lowMidi: 48, highMidi: 67 }),
    bass: Object.freeze({ lowMidi: 40, highMidi: 60 }),
  });
  const CHOIR_ANCHORS = Object.freeze({
    soprano: Object.freeze([62, 68, 74]), alto: Object.freeze([57, 63, 69]),
    tenor: Object.freeze([50, 56, 62, 67]), bass: Object.freeze([42, 48, 54, 59]),
  });
  const PITCH_NAMES = Object.freeze(['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']);
  const DEGREE_PATTERNS = Object.fromEntries(DEGREE_TARGETS.map((target) => [
    `degree-${target.id}`,
    Object.freeze({ id: `degree-${target.id}`, family: 'degree', name: `Grado ${target.label}`,
      quality: target.offset % 12 === 0 || [2, 4, 5, 7, 9, 11].includes(target.offset) ? 'diatonic' : 'chromatic',
      inversion: null, chordRootDegree: 1, bassDegree: null, degreeLabels: Object.freeze([target.label]),
      semitoneOffsets: Object.freeze([target.offset]), durationBeats: Object.freeze([4]) }),
  ]));
  const PATTERNS = Object.freeze({
    'scale-major': Object.freeze({ id: 'scale-major', family: 'scale', name: 'Scala 1–5', quality: 'major', inversion: 'root',
      chordRootDegree: 1, bassDegree: 1, degreeLabels: Object.freeze(['1', '2', '3', '4', '5', '4', '3', '2', '1']),
      semitoneOffsets: Object.freeze([0, 2, 4, 5, 7, 5, 4, 2, 0]), durationBeats: Object.freeze(Array(9).fill(1)) }),
    'triad-major-root': Object.freeze({ id: 'triad-major-root', family: 'triad', name: 'Arpeggio maggiore', quality: 'major', inversion: 'root',
      chordRootDegree: 1, bassDegree: 1, degreeLabels: Object.freeze(['1', '3M', '5', '3M', '1']),
      semitoneOffsets: Object.freeze([0, 4, 7, 4, 0]), durationBeats: Object.freeze(Array(5).fill(1)) }),
    'triad-minor-root': Object.freeze({ id: 'triad-minor-root', family: 'triad', name: 'Arpeggio minore', quality: 'minor', inversion: 'root',
      chordRootDegree: 1, bassDegree: 1, degreeLabels: Object.freeze(['1', '3m', '5', '3m', '1']),
      semitoneOffsets: Object.freeze([0, 3, 7, 3, 0]), durationBeats: Object.freeze(Array(5).fill(1)) }),
    'triad-major-first': Object.freeze({ id: 'triad-major-first', family: 'triad', name: 'Arpeggio maggiore · primo rivolto', quality: 'major', inversion: 'first',
      chordRootDegree: 1, bassDegree: 3, degreeLabels: Object.freeze(['3M', '5', '1', '5', '3M']),
      semitoneOffsets: Object.freeze([4, 7, 12, 7, 4]), durationBeats: Object.freeze(Array(5).fill(1)) }),
    'triad-minor-first': Object.freeze({ id: 'triad-minor-first', family: 'triad', name: 'Arpeggio minore · primo rivolto', quality: 'minor', inversion: 'first',
      chordRootDegree: 1, bassDegree: 3, degreeLabels: Object.freeze(['3m', '5', '1', '5', '3m']),
      semitoneOffsets: Object.freeze([3, 7, 12, 7, 3]), durationBeats: Object.freeze(Array(5).fill(1)) }),
    'triad-major-second': Object.freeze({ id: 'triad-major-second', family: 'triad', name: 'Arpeggio maggiore · secondo rivolto', quality: 'major', inversion: 'second',
      chordRootDegree: 1, bassDegree: 5, degreeLabels: Object.freeze(['5', '1', '3M', '1', '5']),
      semitoneOffsets: Object.freeze([7, 12, 16, 12, 7]), durationBeats: Object.freeze(Array(5).fill(1)) }),
    'triad-minor-second': Object.freeze({ id: 'triad-minor-second', family: 'triad', name: 'Arpeggio minore · secondo rivolto', quality: 'minor', inversion: 'second',
      chordRootDegree: 1, bassDegree: 5, degreeLabels: Object.freeze(['5', '1', '3m', '1', '5']),
      semitoneOffsets: Object.freeze([7, 12, 15, 12, 7]), durationBeats: Object.freeze(Array(5).fill(1)) }),
    ...DEGREE_PATTERNS,
  });

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const midiToHz = (midi, tuning = 440) => tuning * 2 ** ((midi - 69) / 12);
  const hzToMidi = (hz, tuning = 440) => 69 + 12 * Math.log2(hz / tuning);
  const midiToName = (midi) => `${PITCH_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const centsBetween = (actualHz, targetHz) => 1200 * Math.log2(actualHz / targetHz);
  const median = (items) => {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const mad = (items, center = median(items)) => center == null ? null : median(items.map((value) => Math.abs(value - center)));

  function shuffled(items, seed = 1) {
    const result = [...items]; let value = Number(seed) >>> 0;
    for (let index = result.length - 1; index > 0; index -= 1) {
      value = (Math.imul(value || 1, 1664525) + 1013904223) >>> 0;
      const swap = value % (index + 1); [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function validateRange(range) {
    const low = Number(range?.lowMidi), high = Number(range?.highMidi);
    return Number.isInteger(low) && Number.isInteger(high) && low >= 24 && high <= 96 && high >= low;
  }

  function pattern(id) {
    const value = PATTERNS[id];
    if (!value) throw new RangeError(`Pattern sconosciuto: ${id}`);
    return value;
  }

  function patternBounds(definition) {
    return { min: Math.min(...definition.semitoneOffsets), max: Math.max(...definition.semitoneOffsets) };
  }

  function chooseReferenceRoot(range, definition, { pitchClass = REFERENCE_PITCH_CLASS, margin = 2, extraHigh = 0 } = {}) {
    if (!validateRange(range)) throw new RangeError('Estensione vocale non valida');
    const bounds = patternBounds(definition), center = (range.lowMidi + range.highMidi) / 2;
    let candidates = Array.from({ length: range.highMidi - range.lowMidi + 25 }, (_, index) => range.lowMidi - 12 + index)
      .filter((midi) => ((midi % 12) + 12) % 12 === pitchClass)
      .filter((rootMidi) => rootMidi + bounds.min >= range.lowMidi + margin
        && rootMidi + bounds.max + extraHigh <= range.highMidi - margin);
    if (!candidates.length && margin) return chooseReferenceRoot(range, definition, { pitchClass, margin: 0, extraHigh });
    if (!candidates.length) throw new RangeError(`Il pattern ${definition.name} non entra nell’estensione selezionata`);
    candidates = candidates.sort((a, b) => Math.abs((a + (bounds.min + bounds.max) / 2) - center)
      - Math.abs((b + (bounds.min + bounds.max) / 2) - center) || a - b);
    return candidates[0];
  }

  function noteEvents(definition, rootMidi) {
    let beat = 0;
    return definition.semitoneOffsets.map((offset, index) => {
      const durationBeats = definition.durationBeats[index], event = Object.freeze({
        id: `note-${index + 1}`, index, beat, durationBeats, degree: definition.degreeLabels[index],
        semitoneOffset: offset, midi: rootMidi + offset, frequencyHz: midiToHz(rootMidi + offset), evaluated: true,
      });
      beat += durationBeats;
      return event;
    });
  }

  function buildExercise({ patternId, rootMidi, bpm, mode = 'model', level = null }) {
    if (!TEMPOS.includes(Number(bpm))) throw new RangeError('Velocità non valida');
    if (!['model', 'inner-ear'].includes(mode)) throw new RangeError('Modalità non valida');
    const definition = pattern(patternId), events = noteEvents(definition, rootMidi), beatSeconds = 60 / bpm;
    const totalBeats = events.reduce((sum, event) => sum + event.durationBeats, 0);
    const previewSeconds = mode === 'model' ? totalBeats * beatSeconds : beatSeconds * 2;
    return Object.freeze({ schemaVersion: 2, id: `${mode}-${patternId}-${rootMidi}-${bpm}`, patternId,
      family: definition.family, name: definition.name, quality: definition.quality, inversion: definition.inversion,
      chordRootDegree: definition.chordRootDegree, bassDegree: definition.bassDegree, level, mode, bpm, previewBpm: bpm,
      rootMidi, rootName: midiToName(rootMidi), countInBeats: COUNT_IN_BEATS, previewSeconds,
      countInSeconds: COUNT_IN_BEATS * beatSeconds, durationSeconds: totalBeats * beatSeconds,
      totalBeats, events, targetVisibleDuringTake: mode === 'model' });
  }

  function transposeExercise(exercise, semitones, range) {
    if (!exercise || !Number.isInteger(semitones)) throw new TypeError('Trasposizione non valida');
    const transposed = buildExercise({ patternId: exercise.patternId, rootMidi: exercise.rootMidi + semitones,
      bpm: exercise.bpm, mode: exercise.mode, level: exercise.level });
    return transposed.events.every((event) => event.midi >= range.lowMidi && event.midi <= range.highMidi)
      ? transposed : null;
  }

  function buildRoutine({ family = 'scale', bpm = 60, mode = 'model', range = ROLE_RANGES.tenor,
    inversion = 'root', degreeLevel = 'base', seed = 1 } = {}) {
    if (!TEMPOS.includes(Number(bpm))) throw new RangeError('Velocità non valida');
    if (family === 'scale') {
      const definition = pattern('scale-major'), baseRoot = chooseReferenceRoot(range, definition);
      const exercises = [buildExercise({ patternId: definition.id, rootMidi: baseRoot, bpm, mode })];
      return Object.freeze({ schemaVersion: 2, family, bpm, mode, label: `Scala in Fa · ${bpm} BPM`, exercises });
    }
    if (family === 'arpeggio') {
      const inversions = inversion === 'all' ? TRIAD_INVERSIONS : [inversion];
      if (!inversions.every((value) => TRIAD_INVERSIONS.includes(value))) throw new RangeError('Rivolto non valido');
      const exercises = inversions.flatMap((position) => {
        const widest = pattern(`triad-major-${position}`), rootMidi = chooseReferenceRoot(range, widest);
        return ARPEGGIO_QUALITIES.map((quality) => buildExercise({ patternId: `triad-${quality}-${position}`, rootMidi, bpm, mode }));
      });
      const positionLabel = inversion === 'all' ? 'tutte le posizioni' : INVERSION_LABELS[inversion];
      return Object.freeze({ schemaVersion: 2, family, bpm, mode, inversion, positionLabel,
        label: `Arpeggi in Fa · ${positionLabel} · ${bpm} BPM`, exercises });
    }
    if (family === 'degree') {
      if (mode !== 'inner-ear') throw new RangeError('I gradi singoli richiedono la modalità Orecchio interno');
      const targetIds = DEGREE_LEVELS[degreeLevel];
      if (!targetIds) throw new RangeError('Livello dei gradi non valido');
      const span = { name: `Gradi ${degreeLevel}`, semitoneOffsets: targetIds.map((targetId) => pattern(`degree-${targetId}`).semitoneOffsets[0]) };
      const rootMidi = chooseReferenceRoot(range, span);
      const order = shuffled(targetIds, seed);
      const exercises = order.map((targetId) => buildExercise({ patternId: `degree-${targetId}`,
        rootMidi, bpm, mode, level: degreeLevel }));
      return Object.freeze({ schemaVersion: 2, family, bpm, mode, degreeLevel, seed: Number(seed) >>> 0,
        label: `Gradi singoli · livello ${degreeLevel === 'base' ? 'base' : 'avanzato'} · ${bpm} BPM`, exercises });
    }
    throw new RangeError('Famiglia di esercizi non valida');
  }

  function segmentBounds(event, bpm, { attackFraction = .16, releaseFraction = .12 } = {}) {
    const beatSeconds = 60 / bpm, start = event.beat * beatSeconds, duration = event.durationBeats * beatSeconds;
    return { start, end: start + duration, analysisStart: start + Math.min(.14, duration * attackFraction),
      analysisEnd: start + duration - Math.min(.1, duration * releaseFraction) };
  }

  function classifySegment(centerCents, spreadCents) {
    if (centerCents == null) return 'uncertain';
    if (Number.isFinite(spreadCents) && spreadCents > 38) return 'unstable';
    if (Math.abs(centerCents) <= 35) return 'centered';
    if (Math.abs(centerCents) <= 60) return 'close';
    return centerCents > 0 ? 'sharp' : 'flat';
  }

  function analyseSequence(exercise, frames, { minConfidence = .3, minCoverage = .3, minFrames = 3 } = {}) {
    const segments = exercise.events.map((event) => {
      const bounds = segmentBounds(event, exercise.bpm);
      const windowFrames = frames.filter((frame) => frame.time >= bounds.analysisStart && frame.time <= bounds.analysisEnd);
      const reliableFrames = windowFrames.filter((frame) => Number.isFinite(frame.hz) && frame.hz > 0 && (frame.confidence ?? 0) >= minConfidence);
      const cents = reliableFrames.map((frame) => centsBetween(frame.hz, event.frequencyHz));
      const centerCents = median(cents), spreadCents = mad(cents, centerCents), coverage = reliableFrames.length / Math.max(1, windowFrames.length);
      const reliable = reliableFrames.length >= minFrames && coverage >= minCoverage;
      return { eventId: event.id, index: event.index, degree: event.degree, targetMidi: event.midi,
        targetName: midiToName(event.midi), ...bounds, coverage, sampleCount: reliableFrames.length,
        centerCents: reliable ? centerCents : null, spreadCents: reliable ? spreadCents : null,
        reliable, status: reliable ? classifySegment(centerCents, spreadCents) : 'uncertain' };
    });
    const reliable = segments.filter((segment) => segment.reliable), centered = reliable.filter((segment) => segment.status === 'centered');
    const globalOffsetCents = median(reliable.map((segment) => segment.centerCents));
    const relativeErrors = reliable.map((segment) => segment.centerCents - globalOffsetCents);
    const relativeSpreadCents = mad(relativeErrors, 0);
    const tendencies = { sharp: reliable.filter((segment) => segment.status === 'sharp').length,
      flat: reliable.filter((segment) => segment.status === 'flat').length,
      unstable: reliable.filter((segment) => segment.status === 'unstable').length };
    let message = 'Segnale insufficiente: riprova mantenendo una distanza regolare dal microfono.';
    if (reliable.length) {
      if (centered.length === reliable.length) message = 'Sequenza centrata: altezze e cambi sono ben definiti.';
      else if (tendencies.flat > tendencies.sharp) message = 'La tendenza principale è calante: sostieni le note più alte.';
      else if (tendencies.sharp > tendencies.flat) message = 'La tendenza principale è crescente: prepara i salti senza spingere.';
      else if (tendencies.unstable) message = 'Le altezze sono vicine: rendi più stabili i centri delle note.';
      else message = 'La sequenza è riconoscibile: affina i segmenti evidenziati.';
    }
    return { schemaVersion: 2, segments, reliableSegments: reliable.length, centeredSegments: centered.length,
      totalSegments: segments.length, reliable: reliable.length >= Math.ceil(segments.length * .6),
      globalOffsetCents, relativeSpreadCents, tendencies, message };
  }

  function result({ exercise, analysis, role, range, durationSeconds, deviceAndLatencyConfig = null,
    completed = true, interruptionReason = null }) {
    return { schemaVersion: 2, id: globalThis.crypto?.randomUUID?.() ?? `warmup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      exercise, roleAndRange: { role, range: { ...range } }, deviceAndLatencyConfig, completed, interruptionReason,
      signalReliability: analysis?.reliable ?? false, segmentResults: analysis?.segments ?? [],
      sequenceSummary: analysis ? { reliableSegments: analysis.reliableSegments, centeredSegments: analysis.centeredSegments,
        globalOffsetCents: analysis.globalOffsetCents, relativeSpreadCents: analysis.relativeSpreadCents,
        message: analysis.message } : null,
      durationSeconds, startedAt: new Date(Date.now() - durationSeconds * 1000).toISOString(), completedAt: new Date().toISOString() };
  }

  function rollPitchBounds(events, { padding = 2, minSpan = 9 } = {}) {
    const pitches = events.map((event) => Number(event?.midi ?? event)).filter(Number.isFinite);
    if (!pitches.length) return { min: 55, max: 67 };
    let min = Math.floor(Math.min(...pitches)) - padding, max = Math.ceil(Math.max(...pitches)) + padding;
    if (max - min < minSpan) { const extra = (minSpan - (max - min)) / 2; min -= extra; max += extra; }
    return { min: Math.floor(min), max: Math.ceil(max) };
  }

  function referenceNormalizationGain(rms, peak, { targetRms = .13, maximumGain = 8, minimumGain = .6,
    loudestCueGain = .2, maximumVolume = 2, peakCeiling = .9 } = {}) {
    if (!(rms > 0) || !(peak > 0)) return 1;
    return clamp(Math.min(targetRms / rms, peakCeiling / (peak * loudestCueGain * maximumVolume)), minimumGain, maximumGain);
  }

  return { TEMPOS, COUNT_IN_BEATS, REFERENCE_PITCH_CLASS, MAX_ASCENT_SEMITONES, ARPEGGIO_QUALITIES,
    TRIAD_INVERSIONS, INVERSION_LABELS, DEGREE_TARGETS, DEGREE_LEVELS,
    ROLE_RANGES, CHOIR_ANCHORS, PATTERNS, midiToHz, hzToMidi, midiToName, centsBetween, median, mad,
    validateRange, pattern, patternBounds, chooseReferenceRoot, noteEvents, shuffled, buildExercise, transposeExercise, buildRoutine,
    segmentBounds, classifySegment, analyseSequence, result, rollPitchBounds, referenceNormalizationGain };
});
