(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./vocal_feedback.js') : root.VocalFeedback);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceLabCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (feedback) {
  'use strict';

  const INTERVALS = Object.freeze([
    { semitones: 0, name: 'Unisono' }, { semitones: 1, name: 'Seconda minore' },
    { semitones: 2, name: 'Seconda maggiore' }, { semitones: 3, name: 'Terza minore' },
    { semitones: 4, name: 'Terza maggiore' }, { semitones: 5, name: 'Quarta giusta' },
    { semitones: 7, name: 'Quinta giusta' }, { semitones: 8, name: 'Sesta minore' },
    { semitones: 9, name: 'Sesta maggiore' }, { semitones: 11, name: 'Settima maggiore' },
    { semitones: 12, name: 'Ottava' },
  ]);
  const LEVEL_INTERVALS = Object.freeze({ 1: [0, 2, 4], 2: [0, 2, 4, 5, 7, 12], 3: [0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 12] });
  const ROLE_INTERVAL_BASES = Object.freeze({ soprano: 63, alto: 58, tenor: 51, bass: 43 });
  // The amber target fills one chromatic piano-roll lane: its edges are
  // exactly half a semitone (50 cents) from the target pitch.
  const TARGET_BAND_HALF_WIDTH_CENTS = 50;
  const EARLY_COMPLETION_DEFAULTS = Object.freeze({ minConfidence: .45, attackIgnoreSeconds: .25, minVoicedSeconds: 1.4,
    stableWindowSeconds: .8, confirmationOffsetSeconds: .4, acquireCents: TARGET_BAND_HALF_WIDTH_CENTS,
    stableCents: TARGET_BAND_HALF_WIDTH_CENTS,
    minCoverage: .7, maxSpreadCents: 18, maxDriftCents: 18, minFrames: 8,
    holdSeconds: 3, maxSignalGapSeconds: .18 });
  const REPEAT_LEVELS = Object.freeze({
    guided: Object.freeze({ stableCents: TARGET_BAND_HALF_WIDTH_CENTS, holdSeconds: 1.5, label: 'Guidato' }),
    full: Object.freeze({ stableCents: TARGET_BAND_HALF_WIDTH_CENTS, holdSeconds: 3, label: 'Completo' }),
  });
  const INTERVAL_TIMING = Object.freeze({ countInBeats: 4, bpm: 100, noteSeconds: 2.4, soloSeconds: 2 });
  const ROLL_VISIBLE_MEASURES = 3.5;
  const HARMONY_RANGE = Object.freeze({ lowMidi: 36, highMidi: 60 });
  const midiToHz = (midi, tuning = 440) => tuning * 2 ** ((midi - 69) / 12);
  const midiToName = (midi) => `${['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const centsBetween = (actualHz, targetHz) => 1200 * Math.log2(actualHz / targetHz);
  function rollPitchBounds(targets, { padding = 2, minSpan = 9 } = {}) {
    const pitches = targets.filter(Number.isFinite);
    if (!pitches.length) return { min: 55, max: 67 };
    let min = Math.floor(Math.min(...pitches)) - padding;
    let max = Math.ceil(Math.max(...pitches)) + padding;
    if (max - min < minSpan) {
      const extra = (minSpan - (max - min)) / 2;
      min -= extra; max += extra;
    }
    return { min: Math.floor(min), max: Math.ceil(max) };
  }
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const randomInteger = (low, high, random = Math.random) => Math.floor(random() * (high - low + 1)) + low;
  const rollPixelsPerSecond = (plotWidth, bpm = INTERVAL_TIMING.bpm, visibleMeasures = ROLL_VISIBLE_MEASURES) => {
    if (!(plotWidth > 0) || !(bpm > 0) || !(visibleMeasures > 0)) throw new RangeError('Scala temporale non valida');
    return plotWidth / (visibleMeasures * 4) * bpm / 60;
  };

  function planHarmony(targetMidi, { quality, targetDegree, lowMidi = HARMONY_RANGE.lowMidi,
    highMidi = HARMONY_RANGE.highMidi, random = Math.random } = {}) {
    if (!Number.isInteger(targetMidi) || !Number.isInteger(lowMidi) || !Number.isInteger(highMidi) || highMidi - lowMidi < 11)
      throw new RangeError('Configurazione armonica non valida');
    const resolvedQuality = quality ?? (random() < .5 ? 'major' : 'minor');
    if (!['major', 'minor'].includes(resolvedQuality)) throw new RangeError('Qualità armonica non valida');
    const resolvedDegree = targetDegree ?? [1, 3, 5][randomInteger(0, 2, random)];
    if (![1, 3, 5].includes(resolvedDegree)) throw new RangeError('Grado armonico non valido');
    const third = resolvedQuality === 'major' ? 4 : 3;
    const targetOffset = resolvedDegree === 1 ? 0 : resolvedDegree === 3 ? third : 7;
    const rootPitchClass = ((targetMidi - targetOffset) % 12 + 12) % 12;
    const pitchClasses = [rootPitchClass, (rootPitchClass + third) % 12, (rootPitchClass + 7) % 12];
    const candidates = pitchClasses.map((pitchClass) => Array.from({ length: highMidi - lowMidi + 1 }, (_, index) => lowMidi + index)
      .filter((midi) => ((midi % 12) + 12) % 12 === pitchClass));
    let best = null;
    for (const first of candidates[0]) for (const second of candidates[1]) for (const fifth of candidates[2]) {
      const notes = [first, second, fifth].sort((a, b) => a - b);
      if (new Set(notes).size !== 3) continue;
      const span = notes[2] - notes[0], center = (notes[0] + notes[2]) / 2;
      const score = span * 4 + Math.abs(center - (lowMidi + highMidi) / 2);
      if (!best || score < best.score || score === best.score && notes.join() < best.notes.join()) best = { notes, score };
    }
    if (!best) throw new RangeError('Accordo fuori dall’estensione disponibile');
    return { targetMidi, targetPitchClass: ((targetMidi % 12) + 12) % 12, quality: resolvedQuality,
      targetDegree: resolvedDegree, rootPitchClass, notes: best.notes };
  }

  function repeatLevelForIndex(index) {
    return index === 0 ? 'guided' : 'full';
  }

  function buildRepeatTimeline(note, index = 0, random = Math.random) {
    const targetMidi = note?.midi;
    if (!Number.isInteger(targetMidi)) throw new RangeError('Nota target non valida');
    const level = index === 0 ? 'beginner' : index < 3 ? 'intermediate' : 'advanced';
    const targetDegree = level === 'beginner' ? 1 : level === 'intermediate' ? index === 1 ? 5 : 3 : [1, 3, 5][randomInteger(0, 2, random)];
    const quality = level === 'beginner' || index === 1 ? 'major' : level === 'intermediate' ? 'minor' : random() < .5 ? 'major' : 'minor';
    const harmony = planHarmony(targetMidi, { quality, targetDegree, random });
    // Use the exact same three pitches for the plucked attack and the strings.
    // Keep the target itself for the fourth-beat vocal cue, when possible.
    const preparation = harmony.notes.map((midi) => {
      if (midi !== targetMidi) return midi;
      return midi - 12 >= HARMONY_RANGE.lowMidi ? midi - 12 : midi + 12;
    }).sort((a, b) => a - b);
    const events = [0, 1, 2].map((beat, position) => ({
      id: `prepare-${beat}`, beat, durationBeats: 1.15, midi: preparation[Math.min(position, preparation.length - 1)],
      timbre: 'pluck', gain: level === 'beginner' ? .09 : .075, role: 'harmonic-orientation',
      phase: 'preparation', evaluated: false, highlightedMidi: null,
    }));
    events.push({ id: 'target', beat: 3, durationBeats: .82, midi: targetMidi, timbre: 'voice',
      gain: .18, role: 'sing-this-note', phase: 'target-preview', evaluated: false, highlightedMidi: targetMidi });
    return { bpm: INTERVAL_TIMING.bpm, countInBeats: 4, targetMidi, level, scoring: REPEAT_LEVELS[repeatLevelForIndex(index)],
      harmony: { ...harmony, notes: preparation }, events };
  }

  function buildIntervalPreviewTimeline(interval, mode = 'imitation') {
    if (!interval?.first || !interval?.second || !['imitation', 'memory', 'construction'].includes(mode))
      throw new RangeError('Anteprima intervallo non valida');
    const events = [{ id: 'first', beat: 0, durationBeats: 1.2, midi: interval.first.midi, timbre: 'voice',
      gain: .15, role: 'model-first', phase: 'preview', evaluated: false, highlightedMidi: interval.first.midi }];
    if (mode !== 'construction') events.push({ id: 'second', beat: 1.6, durationBeats: 1.2,
      midi: interval.second.midi, timbre: 'voice', gain: .15, role: 'model-second',
      phase: 'preview', evaluated: false, highlightedMidi: interval.second.midi });
    return { bpm: INTERVAL_TIMING.bpm, mode, events, endBeat: mode === 'construction' ? 1.6 : mode === 'memory' ? 4.6 : 3.2 };
  }

  function validateRange(range) {
    const low = Number(range?.lowMidi), high = Number(range?.highMidi);
    return Number.isInteger(low) && Number.isInteger(high) && low >= 24 && high <= 96 && high >= low;
  }
  function randomNote(range, random = Math.random) {
    if (!validateRange(range)) throw new RangeError('Estensione vocale non valida');
    const midi = randomInteger(range.lowMidi, range.highMidi, random);
    return { midi, name: midiToName(midi), frequencyHz: midiToHz(midi) };
  }
  function allowedIntervals(level = 1) { return LEVEL_INTERVALS[clamp(Math.round(level), 1, 3)]; }
  function intervalBySemitones(semitones) { return INTERVALS.find((item) => item.semitones === Math.abs(semitones)); }
  function generateInterval({ range, level = 1, direction, random = Math.random, semitones } = {}) {
    if (!validateRange(range)) throw new RangeError('Estensione vocale non valida');
    const choices = allowedIntervals(level);
    const distance = semitones == null ? choices[randomInteger(0, choices.length - 1, random)] : Math.abs(semitones);
    if (!choices.includes(distance) && semitones == null) throw new RangeError('Intervallo non disponibile');
    let sign = distance === 0 ? 0 : direction === 'descending' ? -1 : direction === 'ascending' ? 1 : random() < .5 ? -1 : 1;
    const possible = [];
    for (let first = range.lowMidi; first <= range.highMidi; first += 1) {
      const second = first + sign * distance;
      if (second >= range.lowMidi && second <= range.highMidi) possible.push(first);
    }
    if (!possible.length && direction == null) {
      sign *= -1;
      for (let first = range.lowMidi; first <= range.highMidi; first += 1) {
        if (first + sign * distance >= range.lowMidi && first + sign * distance <= range.highMidi) possible.push(first);
      }
    }
    if (!possible.length) throw new RangeError('Intervallo fuori dall’estensione configurata');
    const firstMidi = possible[randomInteger(0, possible.length - 1, random)], secondMidi = firstMidi + sign * distance;
    return { first: { midi: firstMidi, name: midiToName(firstMidi), frequencyHz: midiToHz(firstMidi) },
      second: { midi: secondMidi, name: midiToName(secondMidi), frequencyHz: midiToHz(secondMidi) },
      semitones: distance, signedSemitones: sign * distance, direction: sign > 0 ? 'ascending' : sign < 0 ? 'descending' : 'same',
      name: intervalBySemitones(distance)?.name ?? `${distance} semitoni` };
  }

  function generateScoredInterval({ range, role = 'tenor', level = 1, direction, random = Math.random, semitones } = {}) {
    const distance = semitones == null ? allowedIntervals(level)[randomInteger(0, allowedIntervals(level).length - 1, random)] : Math.abs(semitones);
    const resolvedDirection = distance === 0 ? 'same' : direction ?? (random() < .5 ? 'descending' : 'ascending');
    const preferredLower = ROLE_INTERVAL_BASES[role] ?? Math.round((range.lowMidi + range.highMidi - distance) / 2);
    const lowest = range.lowMidi, highestLower = range.highMidi - distance;
    if (highestLower < lowest) throw new RangeError('Intervallo fuori dall’estensione configurata');
    const lower = clamp(preferredLower, lowest, highestLower), firstMidi = resolvedDirection === 'descending' ? lower + distance : lower;
    const interval = generateInterval({ range, level, direction: resolvedDirection, random, semitones: distance });
    const secondMidi = resolvedDirection === 'descending' ? lower : lower + distance;
    return { ...interval, first: { midi: firstMidi, name: midiToName(firstMidi), frequencyHz: midiToHz(firstMidi) },
      second: { midi: secondMidi, name: midiToName(secondMidi), frequencyHz: midiToHz(secondMidi) },
      signedSemitones: secondMidi - firstMidi, scoreKey: `${firstMidi}-${secondMidi}` };
  }

  function definition(input) {
    if (!input?.id || !input?.type || !input?.music || !Array.isArray(input.expectedTimeline)) throw new TypeError('Definizione esercizio incompleta');
    return Object.freeze({ difficulty: 1, durationSeconds: 2, listeningMode: 'before', microphoneRequired: false,
      completion: {}, analysis: {}, ...input });
  }
  function result({ exercise, actualConfig, analysis = null, confidence = 0, feedbackShown = '', durationSeconds = 0, source = null, completed = true }) {
    return { schemaVersion: 1, id: globalThis.crypto?.randomUUID?.() ?? `lab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      exerciseId: exercise.id, exerciseType: exercise.type, actualConfig, analysis, confidence, feedbackShown,
      startedAt: new Date(Date.now() - durationSeconds * 1000).toISOString(), completedAt: new Date().toISOString(),
      durationSeconds, source, completed };
  }
  function frameForFeedback(frame, index, targetHz) {
    const time = Number.isFinite(frame.time) ? frame.time : index * .05;
    return { time, beat: time, confidence: frame.confidence ?? 0, hz: Number.isFinite(frame.hz) ? frame.hz : null, targetHz };
  }
  function analyseSustained(target, frames, durationSeconds, options = {}) {
    const normalized = frames.map((frame, index) => frameForFeedback(frame, index, target.frequencyHz));
    const analysis = feedback.analyseNote({ id: 'exercise-note', onsetBeat: 0, durationBeats: durationSeconds, targetHz: target.frequencyHz }, normalized, options);
    const stable = analysis.series.slice(Math.floor(analysis.series.length * .35));
    const initial = analysis.series.slice(0, Math.max(1, Math.ceil(analysis.series.length * .25)));
    const initialCents = feedback.median(initial.map((point) => point.cents));
    const stabilizedCents = feedback.median(stable.map((point) => point.cents));
    let message = analysis.message;
    if (analysis.metrics.reliable && initialCents != null && stabilizedCents != null
        && Math.abs(stabilizedCents) + 12 < Math.abs(initialCents) && Math.abs(stabilizedCents) <= 22)
      message = `Hai iniziato ${initialCents < 0 ? 'sotto' : 'sopra'} il riferimento, poi ti sei avvicinato alla nota corretta.`;
    return { ...analysis, initialCents, stabilizedCents, message };
  }
  function stablePitch(frames, start, end, minConfidence = .45) {
    const values = frames.filter((frame) => frame.time >= start && frame.time < end && Number.isFinite(frame.hz) && (frame.confidence ?? 0) >= minConfidence).map((frame) => frame.hz);
    return { hz: feedback.median(values), coverage: frames.length ? values.length / Math.max(1, frames.filter((frame) => frame.time >= start && frame.time < end).length) : 0, count: values.length };
  }
  function analyseSungInterval(interval, frames, splitSeconds, durationSeconds, options = {}) {
    const attackIgnoreSeconds = options.attackIgnoreSeconds ?? .25, transitionIgnoreSeconds = options.transitionIgnoreSeconds ?? .2;
    const firstRegion = { start: attackIgnoreSeconds, end: Math.max(attackIgnoreSeconds, splitSeconds - transitionIgnoreSeconds) };
    const secondRegion = { start: Math.min(durationSeconds, splitSeconds + attackIgnoreSeconds), end: durationSeconds };
    const first = stablePitch(frames, firstRegion.start, firstRegion.end), second = stablePitch(frames, secondRegion.start, secondRegion.end);
    const reliable = first.count >= 4 && second.count >= 4 && first.coverage >= .3 && second.coverage >= .3;
    if (!reliable) return { reliable: false, confidence: Math.min(first.coverage, second.coverage), first, second, regions: { first: firstRegion, second: secondRegion }, message: 'Non ci sono informazioni sufficientemente affidabili per valutare l’intervallo.' };
    const firstErrorCents = centsBetween(first.hz, interval.first.frequencyHz), secondErrorCents = centsBetween(second.hz, interval.second.frequencyHz);
    const sungIntervalCents = centsBetween(second.hz, first.hz), requestedIntervalCents = interval.signedSemitones * 100;
    const relativeErrorCents = sungIntervalCents - requestedIntervalCents;
    const relativeCorrect = Math.abs(relativeErrorCents) <= 25, firstAbsoluteCorrect = Math.abs(firstErrorCents) <= 30.5,
      secondAbsoluteCorrect = Math.abs(secondErrorCents) <= 30.5;
    const transitionFrames = frames.filter((frame) => frame.time >= firstRegion.end && frame.time <= secondRegion.start && Number.isFinite(frame.hz));
    const transitionSeconds = transitionFrames.length > 1 ? transitionFrames.at(-1).time - transitionFrames[0].time : null;
    return { reliable, confidence: Math.min(first.coverage, second.coverage), first, second, firstErrorCents, secondErrorCents,
      sungIntervalCents, requestedIntervalCents, relativeErrorCents, relativeCorrect, firstAbsoluteCorrect, secondAbsoluteCorrect,
      transitionSeconds, regions: { first: firstRegion, second: secondRegion },
      message: relativeCorrect && firstAbsoluteCorrect && secondAbsoluteCorrect ? 'Intervallo e intonazione assoluta sono corretti.'
        : relativeCorrect ? 'La distanza fra le note è corretta; ora riallinea entrambe le altezze al riferimento.'
          : `La distanza cantata è ${Math.abs(relativeErrorCents).toFixed(0)} cent ${relativeErrorCents < 0 ? 'più stretta' : 'più ampia'} del riferimento.` };
  }

  function windowStability(points, start, end, allFrames, config) {
    const framesInWindow = allFrames.filter((frame) => frame.time >= start && frame.time <= end);
    const values = points.filter((point) => point.time >= start && point.time <= end);
    const cents = values.map((point) => point.cents), center = feedback.median(cents);
    const spread = feedback.mad(cents, center);
    const half = start + (end - start) / 2;
    const early = feedback.median(values.filter((point) => point.time <= half).map((point) => point.cents));
    const late = feedback.median(values.filter((point) => point.time > half).map((point) => point.cents));
    const drift = early == null || late == null ? null : late - early;
    const coverage = framesInWindow.length ? values.length / framesInWindow.length : 0;
    return { centerCents: center, spreadCents: spread == null ? null : 1.4826 * spread, driftCents: drift,
      coverage, reliableFrames: values.length, stable: values.length >= config.minFrames && coverage >= config.minCoverage
        && Math.abs(center ?? Infinity) <= config.stableCents && (spread == null || 1.4826 * spread <= config.maxSpreadCents)
        && (drift == null || Math.abs(drift) <= config.maxDriftCents) };
  }

  function evaluatePitchProgress(target, frames, nowSeconds, options = {}) {
    const config = { ...EARLY_COMPLETION_DEFAULTS, ...options };
    const reliable = frames.filter((frame) => Number.isFinite(frame.hz) && (frame.confidence ?? 0) >= config.minConfidence);
    const emptyHold = { holdSeconds: 0, holdTargetSeconds: config.holdSeconds, timeToAcquireSeconds: null };
    if (!reliable.length) return { status: 'waiting', completed: false, reliable: false, reason: 'no-reliable-pitch', ...emptyHold };
    const firstVoiced = reliable[0].time, voicedElapsed = nowSeconds - firstVoiced;
    const points = reliable.filter((frame) => frame.time >= firstVoiced + config.attackIgnoreSeconds)
      .map((frame) => ({ time: frame.time, cents: centsBetween(frame.hz, target.frequencyHz) }));
    const recentCenter = feedback.median(points.filter((point) => point.time >= nowSeconds - .35).map((point) => point.cents));
    const acquired = recentCenter != null && Math.abs(recentCenter) <= config.acquireCents;
    let holdStart = null, lastStable = null;
    for (const frame of frames) {
      if (frame.time < firstVoiced + config.attackIgnoreSeconds) continue;
      const valid = Number.isFinite(frame.hz) && (frame.confidence ?? 0) >= config.minConfidence;
      if (valid && Math.abs(centsBetween(frame.hz, target.frequencyHz)) <= config.stableCents) {
        if (lastStable == null || frame.time - lastStable > config.maxSignalGapSeconds) holdStart = frame.time;
        lastStable = frame.time;
      } else if (valid || (lastStable != null && frame.time - lastStable > config.maxSignalGapSeconds)) {
        holdStart = null; lastStable = null;
      }
    }
    if (lastStable != null && nowSeconds - lastStable > config.maxSignalGapSeconds) { holdStart = null; lastStable = null; }
    const holdSeconds = holdStart == null ? 0 : Math.min(config.holdSeconds, Math.max(0, lastStable - holdStart));
    const hold = { holdSeconds, holdTargetSeconds: config.holdSeconds, timeToAcquireSeconds: holdStart };
    if (voicedElapsed < config.minVoicedSeconds) return { status: acquired ? 'acquired' : 'searching', completed: false, reliable: true, recentCenterCents: recentCenter, ...hold };
    const current = windowStability(points, nowSeconds - config.stableWindowSeconds, nowSeconds, frames, config);
    const previous = windowStability(points, nowSeconds - config.stableWindowSeconds - config.confirmationOffsetSeconds,
      nowSeconds - config.confirmationOffsetSeconds, frames, config);
    const completed = holdSeconds >= config.holdSeconds;
    const initial = feedback.median(points.filter((point) => point.time < firstVoiced + .6).map((point) => point.cents));
    return { status: completed ? (Math.abs(initial ?? 0) > config.acquireCents ? 'reached-with-correction' : 'reached')
      : acquired ? 'stabilizing' : 'searching', completed, reliable: true, recentCenterCents: recentCenter,
      initialCents: initial, current, previous, ...hold };
  }

  function pitchTrialOutcome(completionReason, analysis = {}) {
    const reached = completionReason === 'reached' || completionReason === 'reached-with-correction';
    const incremental = analysis.incrementalProgress;
    return {
      completionReason,
      category: analysis.category,
      reliable: reached || incremental?.reliable === true || analysis.metrics?.reliable === true,
      acquired: reached || Boolean(incremental && incremental.status !== 'waiting' && incremental.status !== 'searching'),
    };
  }

  function buildInitialPitchSession(range, random = Math.random) {
    if (!validateRange(range) || range.highMidi - range.lowMidi < 6) throw new RangeError('Estensione troppo stretta per la sessione iniziale');
    const safeLow = range.lowMidi + 2, safeHigh = range.highMidi - 2, center = Math.round((safeLow + safeHigh) / 2);
    const up = Math.min(safeHigh, center + randomInteger(2, 4, random));
    const down = Math.max(safeLow, center - randomInteger(2, 4, random));
    const exploredLow = Math.min(center, down), exploredHigh = Math.max(center, up);
    const midRandom = randomInteger(exploredLow, exploredHigh, random);
    return [center, up, down, midRandom].map((midi, index) => ({ index, midi, name: midiToName(midi), frequencyHz: midiToHz(midi) }));
  }

  function shuffleBalanced(items, random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = randomInteger(0, index, random); [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function buildEarTrainingBlock({ range, role = 'tenor', level = 1, random = Math.random } = {}) {
    if (!validateRange(range)) throw new RangeError('Estensione vocale non valida');
    const rawLevel = clamp(Math.round(level), 1, 5), counts = { 1: 6, 2: 8, 3: 10, 4: 12, 5: 12 }, count = counts[rawLevel];
    let specifications = [];
    if (rawLevel === 1) {
      const directions = ['ascending', 'descending', 'same', 'ascending', 'descending', 'same'];
      specifications = shuffleBalanced(directions, random).map((direction, index) => ({ direction,
        semitones: direction === 'same' ? 0 : [2, 4, 5, 7][index % 4], answerKind: 'direction', mode: 'melodic' }));
    } else {
      const pools = rawLevel === 2 ? [0, 2, 4, 7, 12] : rawLevel === 3 ? [1, 2, 3, 4, 5, 7, 12]
        : rawLevel === 4 ? [1, 2, 3, 4, 5, 7, 8, 9, 12] : [0, 3, 4, 5, 7, 12];
      for (let index = 0; index < count; index += 1) {
        const semitones = pools[index % pools.length];
        const direction = semitones === 0 ? 'same' : rawLevel === 2 ? 'ascending' : index % 2 ? 'descending' : 'ascending';
        specifications.push({ semitones, direction, answerKind: 'interval', mode: rawLevel === 5 ? 'harmonic' : 'melodic' });
      }
      specifications = shuffleBalanced(specifications, random);
    }
    return specifications.map((specification, index) => ({ id: `ear-${rawLevel}-${index}`, level: rawLevel, ...specification,
      interval: generateScoredInterval({ range, role, level: Math.min(3, rawLevel), direction: specification.direction, semitones: specification.semitones, random }), retryCount: 0 }));
  }

  function scheduleEarRetry(queue, trialIndex, offset = 3) {
    const trial = queue[trialIndex];
    if (!trial || trial.retryCount >= 2) return queue;
    const retry = { ...trial, id: `${trial.id}-retry-${trial.retryCount + 1}`, retryCount: trial.retryCount + 1, retryOf: trial.retryOf ?? trial.id };
    const next = [...queue], insertAt = Math.min(next.length, trialIndex + Math.max(2, offset));
    next.splice(insertAt, 0, retry); return next;
  }

  function buildSingingIntervalBlock({ range, role = 'tenor', level = 1, mode = 'imitation', random = Math.random } = {}) {
    if (!validateRange(range)) throw new RangeError('Estensione vocale non valida');
    const normalizedLevel = clamp(Math.round(level), 1, 3), validModes = ['imitation', 'memory', 'construction'];
    if (!validModes.includes(mode)) throw new RangeError('Modalità di canto non valida');
    const pools = { 1: [2, 4, 5], 2: [2, 3, 4, 5, 7], 3: [1, 2, 3, 4, 5, 7, 8, 9, 12] };
    const directions = shuffleBalanced(['ascending', 'descending', 'ascending', 'descending'], random);
    return directions.map((direction, index) => ({ id: `sing-${mode}-${normalizedLevel}-${index}`, mode, level: normalizedLevel,
      interval: generateScoredInterval({ range, role, level: normalizedLevel, semitones: pools[normalizedLevel][index % pools[normalizedLevel].length], direction, random }) }));
  }

  function competenceState(observations, stableMinimum = 8) {
    const reliable = observations.filter((item) => item.reliable), successes = reliable.filter((item) => item.success).length;
    const rate = reliable.length ? successes / reliable.length : null;
    const status = reliable.length === 0 ? 'non_iniziata' : reliable.length < 3 ? 'in_esplorazione'
      : reliable.length >= stableMinimum && rate >= .75 ? 'stabile' : 'in_consolidamento';
    const lastObservedAt = observations.map((item) => Date.parse(item.completedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
    const categoryPerformance = {};
    reliable.forEach((item) => {
      if (item.category == null) return;
      const bucket = categoryPerformance[item.category] ??= { observations: 0, successes: 0, successRate: 0 };
      bucket.observations += 1; if (item.success) bucket.successes += 1; bucket.successRate = bucket.successes / bucket.observations;
    });
    return { status, observations: observations.length, reliableObservations: reliable.length, successes, successRate: rate, lastObservedAt, categoryPerformance };
  }

  function deriveCompetencies(results = []) {
    const evidence = { noteReproduction: [], noteStability: [], melodicDirection: [], intervalRecognition: [],
      majorMinorRecognition: [], advancedIntervalRecognition: [], harmonicRecognition: [], intervalSinging: [], pitchMemory: [], choralIndependence: [] };
    results.filter((item) => item?.completed !== false).forEach((item) => {
      const analysis = item.analysis ?? {};
      if (item.exerciseType === 'repeat') {
        const success = String(analysis.completionReason || '').startsWith('reached');
        const reliable = success || analysis.metrics?.reliable === true;
        evidence.noteReproduction.push({ reliable, success, completedAt: item.completedAt });
        evidence.noteStability.push({ reliable, success: success || (reliable && Math.abs(analysis.metrics?.driftCents ?? Infinity) <= 18), completedAt: item.completedAt });
      } else if (item.exerciseType === 'sustain') {
        const reliable = analysis.metrics?.reliable === true;
        evidence.noteStability.push({ reliable, success: reliable && Math.abs(analysis.metrics?.driftCents ?? Infinity) <= 18, completedAt: item.completedAt });
      } else if (item.exerciseType === 'ear') {
        const difficulty = Number(item.actualConfig?.difficulty ?? 2);
        const target = analysis.answerKind === 'direction' ? evidence.melodicDirection : analysis.mode === 'harmonic' ? evidence.harmonicRecognition
          : difficulty >= 4 ? evidence.advancedIntervalRecognition : difficulty >= 3 ? evidence.majorMinorRecognition : evidence.intervalRecognition;
        target.push({ reliable: true, success: analysis.correct === true, completedAt: item.completedAt,
          category: analysis.answerKind === 'direction' ? analysis.expected : String(analysis.semitones) });
      } else if (item.exerciseType === 'sing-interval') {
        const reliable = analysis.reliable === true;
        evidence.intervalSinging.push({ reliable, success: reliable && analysis.relativeCorrect === true, completedAt: item.completedAt });
        if (item.actualConfig?.mode === 'memory') evidence.pitchMemory.push({ reliable, success: reliable && analysis.relativeCorrect === true, completedAt: item.completedAt });
      }
    });
    return Object.fromEntries(Object.entries(evidence).map(([key, observations]) => [key, competenceState(observations.slice(-24), key === 'harmonicRecognition' ? 12 : 8)]));
  }

  function extractRepertoirePhrase(score, { pieceId = null, partId = null, maxNotes = 8 } = {}) {
    const source = Array.isArray(score?.target_events) ? score.target_events : score?.events;
    if (!Array.isArray(source)) return null;
    let notes = source.filter((event) => event.part_id === partId && Number.isFinite(event.midi_pitch) && !event.is_rest && event.kind !== 'rest');
    if (!notes.length) {
      const fallbackPart = score?.parts?.find((part) => part.kind === 'vocal')?.id ?? source.find((event) => Number.isFinite(event.midi_pitch))?.part_id;
      notes = source.filter((event) => event.part_id === fallbackPart && Number.isFinite(event.midi_pitch) && !event.is_rest && event.kind !== 'rest');
      partId = fallbackPart;
    }
    if (notes.length < 2) return null;
    notes.sort((a, b) => (a.onset_beats ?? 0) - (b.onset_beats ?? 0));
    const measureIndex = new Map((score.measures ?? []).map((measure, index) => [measure.id, index]));
    const candidates = [];
    for (let start = 0; start < notes.length - 1; start += 1) {
      const phrase = [];
      for (let index = start; index < notes.length && phrase.length < maxNotes; index += 1) {
        if (phrase.length && (notes[index].onset_beats ?? 0) - ((phrase.at(-1).onset_beats ?? 0) + (phrase.at(-1).duration_beats ?? 0)) > 1.5) break;
        phrase.push(notes[index]);
        const duration = (notes[index].onset_beats ?? 0) + (notes[index].duration_beats ?? 0) - (phrase[0].onset_beats ?? 0);
        if (phrase.length >= 4 && (/[.,;:!?]$/.test(notes[index].lyric ?? '') || duration >= 5 || phrase.length === maxNotes)) break;
      }
      if (phrase.length < 4) continue;
      const intervals = phrase.slice(1).map((event, index) => event.midi_pitch - phrase[index].midi_pitch);
      const lyricCount = phrase.filter((event) => event.lyric).length;
      const relevance = intervals.reduce((sum, value) => sum + Math.min(12, Math.abs(value)), 0) / intervals.length + lyricCount * .35;
      candidates.push({ phrase, intervals, relevance });
    }
    const selected = candidates.sort((a, b) => b.relevance - a.relevance)[0];
    if (!selected) return null;
    const first = selected.phrase[0], last = selected.phrase.at(-1), startMeasureIndex = measureIndex.get(first.written_measure_id ?? first.measure_id) ?? 0,
      endMeasureIndex = measureIndex.get(last.written_measure_id ?? last.measure_id) ?? startMeasureIndex;
    const lyrics = selected.phrase.map((event) => event.lyric).filter(Boolean).join(' ').replace(/\s+([.,;:!?])/g, '$1');
    return { pieceId, partId, startBeat: first.onset_beats, endBeat: (last.onset_beats ?? 0) + (last.duration_beats ?? 0),
      startMeasureIndex, endMeasureIndex, firstMeasure: score.measures?.[startMeasureIndex]?.number ?? String(startMeasureIndex + 1),
      lastMeasure: score.measures?.[endMeasureIndex]?.number ?? String(endMeasureIndex + 1), lyrics, intervals: selected.intervals,
      midiPitches: selected.phrase.map((event) => event.midi_pitch), relevance: selected.relevance };
  }

  function competencePriority(competence, relevance = 1, now = Date.now()) {
    const difficulty = competence.successRate == null ? 1 : Math.max(.15, 1 - competence.successRate);
    const reliability = Math.max(.35, Math.min(1, competence.reliableObservations / 8));
    const ageDays = competence.lastObservedAt == null ? 14 : Math.max(0, (now - competence.lastObservedAt) / 86400000);
    const recency = Math.min(2, .75 + ageDays / 14);
    return difficulty * reliability * recency * Math.min(2, Math.max(.5, relevance));
  }

  function categoriesConsolidated(competence, minimumRate = .6) {
    const categories = Object.values(competence.categoryPerformance ?? {});
    return competence.status === 'stabile' && categories.length > 0 && categories.every((item) => item.successRate >= minimumRate);
  }

  function buildRecommendedSession(results = [], repertoire = null) {
    const competencies = deriveCompetencies(results), blocks = [];
    if (competencies.noteReproduction.status !== 'stabile') blocks.push({ activity: 'repeat', label: 'Trova e stabilizza quattro note', reason: 'Costruisce un riferimento vocale affidabile.', priority: competencePriority(competencies.noteReproduction) });
    const listening = !categoriesConsolidated(competencies.melodicDirection) ? 1
      : !categoriesConsolidated(competencies.intervalRecognition) ? 2
        : !categoriesConsolidated(competencies.majorMinorRecognition) ? 3
          : !categoriesConsolidated(competencies.advancedIntervalRecognition) ? 4
            : !categoriesConsolidated(competencies.harmonicRecognition) ? 5 : 4;
    const listeningCompetence = [null, competencies.melodicDirection, competencies.intervalRecognition, competencies.majorMinorRecognition,
      competencies.advancedIntervalRecognition, competencies.harmonicRecognition][listening];
    blocks.push({ activity: 'ear', level: listening, label: listening === 1 ? 'Riconosci la direzione' : listening === 5 ? 'Riconosci gli intervalli armonici' : 'Riconosci gli intervalli', reason: 'Allena la competenza uditiva meno consolidata.', priority: competencePriority(listeningCompetence) });
    if (competencies.noteReproduction.reliableObservations >= 3)
      blocks.push({ activity: 'sing-interval', level: competencies.intervalSinging.status === 'stabile' ? 2 : 1,
        mode: competencies.intervalSinging.status !== 'stabile' ? 'imitation' : competencies.pitchMemory.status !== 'stabile' ? 'memory' : 'construction',
        label: 'Canta gli intervalli', reason: 'Trasforma il riconoscimento in controllo della voce.', priority: competencePriority(competencies.intervalSinging, repertoire?.phrase?.relevance ?? 1) });
    blocks.sort((a, b) => b.priority - a.priority);
    if (repertoire?.pieceId) blocks.push({ activity: 'repertoire', pieceId: repertoire.pieceId, partId: repertoire.partId ?? null,
      phrase: repertoire.phrase ?? null, label: repertoire.phrase?.lyrics ? `Applica al brano: ${repertoire.phrase.lyrics}` : 'Applica al brano', reason: repertoire.phrase
        ? `Prova la frase reale, battute ${repertoire.phrase.firstMeasure}–${repertoire.phrase.lastMeasure}.` : 'Riporta la competenza nel repertorio in studio.',
      priority: competencePriority(competencies.intervalSinging, repertoire.phrase?.relevance ?? 1) });
    return { competencies, blocks: blocks.slice(0, 4), estimatedMinutes: Math.max(3, Math.min(8, blocks.length * 2)) };
  }

  return { INTERVALS, LEVEL_INTERVALS, ROLE_INTERVAL_BASES, INTERVAL_TIMING, ROLL_VISIBLE_MEASURES, rollPixelsPerSecond, HARMONY_RANGE, TARGET_BAND_HALF_WIDTH_CENTS, REPEAT_LEVELS, repeatLevelForIndex, buildRepeatTimeline, buildIntervalPreviewTimeline, midiToHz, midiToName, centsBetween, validateRange, randomNote, allowedIntervals, planHarmony,
    generateInterval, generateScoredInterval, definition, result, analyseSustained, analyseSungInterval, EARLY_COMPLETION_DEFAULTS,
    evaluatePitchProgress, pitchTrialOutcome, buildInitialPitchSession, buildEarTrainingBlock, scheduleEarRetry, buildSingingIntervalBlock, rollPitchBounds,
    deriveCompetencies, extractRepertoirePhrase, competencePriority, categoriesConsolidated, buildRecommendedSession };
});
