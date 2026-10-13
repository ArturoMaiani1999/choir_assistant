(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VocalFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    minConfidence: .45, minCoverage: .35, minFrames: 5, minDriftSeconds: .55,
    edgeFraction: .12, maxEdgeSeconds: .12, smoothingSeconds: .18,
    inTuneCents: 18, biasedCents: 22, driftCents: 24, irregularCents: 18,
    shortSeconds: .25, sustainedSeconds: .7, shortBiasCents: 55,
    mediumBiasCents: 35, sustainedBiasCents: 25, phraseDriftCents: 35,
  });

  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const mad = (values, center = median(values)) => center == null ? null : median(values.map((value) => Math.abs(value - center)));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function weightedMedian(items) {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0);
    let seen = 0;
    for (const item of sorted) { seen += item.weight; if (seen >= total / 2) return item.value; }
    return sorted.at(-1).value;
  }

  function smoothCentSeries(points, windowSeconds) {
    return points.map((point, index) => {
      const neighbours = [];
      for (let cursor = index; cursor >= 0 && point.time - points[cursor].time <= windowSeconds / 2; cursor -= 1)
        neighbours.push({ value: points[cursor].cents, weight: points[cursor].confidence });
      for (let cursor = index + 1; cursor < points.length && points[cursor].time - point.time <= windowSeconds / 2; cursor += 1)
        neighbours.push({ value: points[cursor].cents, weight: points[cursor].confidence });
      return { ...point, centerCents: weightedMedian(neighbours) };
    });
  }

  function robustSlope(points) {
    if (points.length < 3) return null;
    const slopes = [];
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const elapsed = points[right].time - points[left].time;
        if (elapsed > .04) slopes.push((points[right].centerCents - points[left].centerCents) / elapsed);
      }
    }
    return median(slopes);
  }

  function categoryFor(metrics, config = DEFAULTS) {
    if (!metrics.judgementReliable) return 'uncertain';
    const biasThreshold = metrics.analysisMode === 'short' ? config.shortBiasCents
      : metrics.analysisMode === 'medium' ? config.mediumBiasCents : config.sustainedBiasCents;
    if (metrics.driftCents != null && metrics.driftCents <= -config.driftCents) return 'drifting-low';
    if (metrics.driftCents != null && metrics.driftCents >= config.driftCents) return 'drifting-high';
    if (metrics.analysisMode === 'sustained' && metrics.residualSpreadCents >= config.irregularCents) return 'irregular';
    if (metrics.medianCents <= -biasThreshold) return 'stable-low';
    if (metrics.medianCents >= biasThreshold) return 'stable-high';
    return 'in-tune';
  }

  const MESSAGES = Object.freeze({
    'stable-low': 'Hai mantenuto la nota abbastanza stabile, ma leggermente sotto il riferimento.',
    'stable-high': 'La nota è stabile, ma rimane sopra il riferimento.',
    'drifting-low': 'Hai iniziato vicino alla nota corretta, ma l’intonazione è progressivamente scesa durante la tenuta.',
    'drifting-high': 'La tua intonazione tende a salire mentre sostieni questa nota.',
    irregular: 'Il centro dell’intonazione varia durante la tenuta. Prova a mantenere più stabile il riferimento.',
    'in-tune': 'Hai mantenuto l’intonazione vicino al riferimento per tutta la tenuta.',
    uncertain: 'Non ci sono informazioni sufficientemente affidabili per valutare questa nota.',
  });

  function analyseNote(note, frames, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const start = Number(note.onsetBeat), end = start + Number(note.durationBeats);
    const candidates = frames.filter((frame) => frame.beat >= start && frame.beat < end);
    const usable = candidates.filter((frame) => Number.isFinite(frame.hz) && (frame.confidence ?? 0) >= config.minConfidence)
      .map((frame) => ({ time: Number(frame.time), beat: frame.beat, hz: frame.hz,
        confidence: clamp(frame.confidence ?? 0, 0, 1), cents: 1200 * Math.log2(frame.hz / note.targetHz) }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.cents));
    const theoreticalDuration = candidates.length > 1 ? candidates.at(-1).time - candidates[0].time : 0;
    const duration = usable.length > 1 ? usable.at(-1).time - usable[0].time : 0;
    const analysisMode = theoreticalDuration < config.shortSeconds ? 'short'
      : theoreticalDuration < config.sustainedSeconds ? 'medium' : 'sustained';
    const trim = Math.min(config.maxEdgeSeconds, duration * config.edgeFraction);
    let body = usable.filter((point) => point.time >= (usable[0]?.time ?? 0) + trim && point.time <= (usable.at(-1)?.time ?? 0) - trim);
    if (body.length < config.minFrames) body = usable;
    const series = smoothCentSeries(body, config.smoothingSeconds);
    const offset = weightedMedian(series.map((point) => ({ value: point.cents, weight: point.confidence })));
    const slope = robustSlope(series);
    const drift = analysisMode === 'sustained' && duration >= config.minDriftSeconds && slope != null ? slope * duration : null;
    const residuals = series.map((point) => point.cents - point.centerCents);
    const coverage = candidates.length ? usable.length / candidates.length : 0;
    const confidence = usable.length ? usable.reduce((sum, point) => sum + point.confidence, 0) / usable.length : 0;
    const pitchSpread = mad(series.map((point) => point.cents), offset);
    const f0Reliability = clamp(confidence * Math.min(1, usable.length / config.minFrames), 0, 1);
    const alignmentReliability = clamp(coverage * (theoreticalDuration > 0 ? Math.min(1, duration / theoreticalDuration) : 0), 0, 1);
    const prevailingPitchReliability = clamp(f0Reliability * (1 - Math.min(1, (pitchSpread ?? 200) / 180)), 0, 1);
    const driftReliability = drift == null ? 0 : clamp(f0Reliability * alignmentReliability * Math.min(1, duration / 1.2), 0, 1);
    const minimumCoverage = analysisMode === 'short' ? .22 : config.minCoverage;
    const judgementReliable = usable.length >= (analysisMode === 'short' ? 3 : config.minFrames)
      && coverage >= minimumCoverage && prevailingPitchReliability >= (analysisMode === 'short' ? .28 : .34);
    const metrics = { medianCents: offset, driftCents: drift, driftCentsPerSecond: drift == null ? null : slope,
      residualSpreadCents: mad(residuals) == null ? null : 1.4826 * mad(residuals), coverage, confidence,
      theoreticalDurationSeconds: theoreticalDuration, observedDurationSeconds: duration, analysisMode,
      f0Reliability, alignmentReliability, prevailingPitchReliability, driftReliability,
      judgementReliable, reliable: judgementReliable };
    const category = categoryFor(metrics, config);
    const severity = category === 'uncertain' || category === 'in-tune' ? 0 : Math.min(100,
      Math.max(Math.abs(offset ?? 0), Math.abs(drift ?? 0)) * (analysisMode === 'short' ? .65 : 1)
      * prevailingPitchReliability);
    return { noteId: note.id, note, series, metrics, category, message: MESSAGES[category],
      severity,
      correctionAvailable: metrics.reliable && metrics.coverage >= .55 && metrics.confidence >= .55
        && metrics.observedDurationSeconds >= .3 && Math.abs(metrics.medianCents ?? 0) <= 200 };
  }

  function analyseTake(notes, frames, options = {}) {
    return notes.map((note) => analyseNote(note, frames, options));
  }

  function analysePhrases(results, options = {}) {
    const config = { ...DEFAULTS, ...options }, reliable = results.filter((result) => result.metrics.judgementReliable && Number.isFinite(result.metrics.medianCents));
    if (reliable.length < 4) return [];
    const points = reliable.map((result) => ({ time: result.note.onsetBeat, centerCents: result.metrics.medianCents }));
    const slope = robustSlope(points), span = points.at(-1).time - points[0].time, driftCents = slope == null ? null : slope * span;
    const intervalErrors = [];
    for (let index = 1; index < reliable.length; index += 1) {
      const expected = reliable[index].note.midiPitch - reliable[index - 1].note.midiPitch;
      const observed = expected + (reliable[index].metrics.medianCents - reliable[index - 1].metrics.medianCents) / 100;
      intervalErrors.push(Math.abs((observed - expected) * 100));
    }
    const medianIntervalError = median(intervalErrors);
    const insights = [];
    if (Math.abs(driftCents ?? 0) >= config.phraseDriftCents) insights.push({
      id: 'phrase-drift', kind: 'phrase', category: driftCents < 0 ? 'phrase-drifting-low' : 'phrase-drifting-high',
      startBeat: reliable[0].note.onsetBeat, endBeat: reliable.at(-1).note.onsetBeat + reliable.at(-1).note.durationBeats,
      measureStart: reliable[0].note.measureNumber, measureEnd: reliable.at(-1).note.measureNumber,
      severity: Math.min(100, Math.abs(driftCents)), driftCents, medianIntervalError,
      title: driftCents < 0 ? 'Il riferimento scende nella frase' : 'Il riferimento sale nella frase',
      message: `Gli intervalli sono ${medianIntervalError < 30 ? 'abbastanza coerenti' : 'variabili'}, ma il centro complessivo ${driftCents < 0 ? 'scende' : 'sale'} lungo la frase.`,
    });
    return insights;
  }

  function prioritise(results, phraseInsights = [], limit = 3) {
    const noteInsights = results.filter((result) => result.severity >= 22 && result.category !== 'uncertain').map((result) => ({
      id: result.noteId, kind: 'note', category: result.category, startBeat: result.note.onsetBeat,
      endBeat: result.note.onsetBeat + result.note.durationBeats, measureStart: result.note.measureNumber,
      severity: result.severity, title: result.category === 'drifting-low' ? 'La tenuta tende a calare'
        : result.category === 'drifting-high' ? 'La tenuta tende a crescere'
          : result.category === 'stable-low' ? 'Altezza prevalentemente bassa'
            : result.category === 'stable-high' ? 'Altezza prevalentemente alta' : 'Centro poco stabile',
      message: result.message,
    }));
    return [...phraseInsights, ...noteInsights].sort((left, right) => right.severity - left.severity).slice(0, limit);
  }

  function analysePerformance(notes, frames, options = {}) {
    const results = analyseTake(notes, frames, options), phrases = analysePhrases(results, options);
    return { results, phrases, priorities: prioritise(results, phrases, options.priorityLimit ?? 3) };
  }

  // Offline granular pitch shifter. The Hann-window overlap/add keeps output
  // duration unchanged. Ratios are interpolated per grain and silence is copied.
  function pitchShiftPcm(input, sampleRate, ratioAtTime, options = {}) {
    const grain = options.grainSize ?? 2048, output = new Float32Array(input.length);
    const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
    const sampleAt = (position, fallback) => {
      const left = Math.floor(position), fraction = position - left;
      if (left < 0 || left + 1 >= input.length) return fallback;
      return input[left] * (1 - fraction) + input[left + 1] * fraction;
    };
    // Two phase-offset read heads crossfade at their wrap points. This is a
    // time-domain granular shifter: duration stays fixed and ratio changes can
    // be supplied per sample without changing playback rate.
    for (let index = 0; index < input.length; index += 1) {
      const ratio = clamp(Number(ratioAtTime(index / sampleRate)) || 1, .67, 1.5);
      if (Math.abs(ratio - 1) < 1e-5) { output[index] = input[index]; continue; }
      const phaseA = modulo((ratio - 1) * index, grain), phaseB = modulo(phaseA + grain / 2, grain);
      const weightA = .5 - .5 * Math.cos(2 * Math.PI * phaseA / grain), weightB = .5 - .5 * Math.cos(2 * Math.PI * phaseB / grain);
      const total = Math.max(.001, weightA + weightB);
      output[index] = clamp((sampleAt(index + phaseA, input[index]) * weightA + sampleAt(index + phaseB, input[index]) * weightB) / total, -1, 1);
    }
    return output;
  }

  function resampleLinear(input, ratio) {
    const length = Math.max(1, Math.round(input.length / ratio)), output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const position = Math.min(input.length - 1, index * ratio), left = Math.floor(position), right = Math.min(input.length - 1, left + 1), mix = position - left;
      output[index] = input[left] * (1 - mix) + input[right] * mix;
    }
    return output;
  }

  // WSOLA restores the original duration after resampling. Candidate frames
  // are aligned by waveform correlation before overlap/add, avoiding the
  // phase-incoherent combing of the former dual-read-head implementation.
  function timeStretchWsola(input, outputLength, options = {}) {
    const windowSize = Math.min(options.windowSize ?? 2048, Math.max(128, input.length));
    const synthesisHop = Math.max(32, Math.floor(windowSize / 4));
    const stretch = outputLength / Math.max(1, input.length), analysisHop = synthesisHop / stretch;
    const search = Math.min(options.searchRadius ?? Math.floor(windowSize / 8), Math.floor(windowSize / 3));
    const output = new Float32Array(outputLength), weights = new Float32Array(outputLength);
    let previousInput = 0, predictedInput = 0, outputStart = 0;
    while (outputStart < outputLength) {
      let inputStart = Math.max(0, Math.min(input.length - windowSize, Math.round(predictedInput)));
      if (outputStart > 0) {
        const expected = inputStart, low = Math.max(0, expected - search), high = Math.min(input.length - windowSize, expected + search);
        let bestScore = -Infinity;
        for (let candidate = low; candidate <= high; candidate += 4) {
          let dot = 0, leftEnergy = 1e-9, rightEnergy = 1e-9;
          for (let index = 0; index < windowSize - synthesisHop; index += 8) {
            const left = input[Math.min(input.length - 1, previousInput + synthesisHop + index)], right = input[candidate + index];
            dot += left * right; leftEnergy += left * left; rightEnergy += right * right;
          }
          const score = dot / Math.sqrt(leftEnergy * rightEnergy);
          if (score > bestScore) { bestScore = score; inputStart = candidate; }
        }
      }
      for (let index = 0; index < windowSize && outputStart + index < outputLength && inputStart + index < input.length; index += 1) {
        const weight = .5 - .5 * Math.cos(2 * Math.PI * index / Math.max(1, windowSize - 1));
        output[outputStart + index] += input[inputStart + index] * weight; weights[outputStart + index] += weight;
      }
      previousInput = inputStart; outputStart += synthesisHop; predictedInput = inputStart + analysisHop;
    }
    for (let index = 0; index < output.length; index += 1) output[index] = weights[index] > .01 ? clamp(output[index] / weights[index], -1, 1) : 0;
    return output;
  }

  function pitchShiftRegion(input, startSample, endSample, ratio, options = {}) {
    const start = Math.max(0, Math.floor(startSample)), end = Math.min(input.length, Math.ceil(endSample)), output = Float32Array.from(input);
    if (end - start < 256 || Math.abs(ratio - 1) < 1e-4) return output;
    const source = input.slice(start, end), shifted = timeStretchWsola(resampleLinear(source, ratio), source.length, options);
    const fade = Math.min(options.fadeSamples ?? 512, Math.floor(source.length / 4));
    for (let index = 0; index < source.length; index += 1) {
      const mix = Math.min(1, index / Math.max(1, fade), (source.length - 1 - index) / Math.max(1, fade));
      output[start + index] = clamp(source[index] * (1 - mix) + shifted[index] * mix, -1, 1);
    }
    return output;
  }

  function pitchShiftRegions(input, regions, options = {}) {
    const output = Float32Array.from(input);
    for (const region of regions) {
      const start = Math.max(0, Math.floor(region.startSample)), end = Math.min(input.length, Math.ceil(region.endSample));
      if (end - start < 256 || Math.abs(region.ratio - 1) < 1e-4) continue;
      const source = input.slice(start, end), shifted = timeStretchWsola(resampleLinear(source, region.ratio), source.length, options);
      const fade = Math.min(options.fadeSamples ?? 512, Math.floor(source.length / 4));
      for (let index = 0; index < source.length; index += 1) {
        const mix = Math.min(1, index / Math.max(1, fade), (source.length - 1 - index) / Math.max(1, fade));
        output[start + index] = clamp(source[index] * (1 - mix) + shifted[index] * mix, -1, 1);
      }
    }
    return output;
  }

  return { DEFAULTS, MESSAGES, median, mad, smoothCentSeries, robustSlope, categoryFor, analyseNote, analyseTake, analysePhrases, prioritise, analysePerformance, pitchShiftPcm, pitchShiftRegion, pitchShiftRegions, timeStretchWsola };
});
