// Deterministic pitch-test harness shared by Node tests and dev/test browser builds.
(function exposePitchTestHarness(global) {
  'use strict';

  const DEFAULT_ANALYSIS = Object.freeze({ frameSize: 4096, hopMs: 20, rmsThreshold: .001 });
  const METRIC_POLICY = Object.freeze({ settledToleranceCents: 50, settledFrames: 3, octaveToleranceCents: 100 });

  function finiteHz(value) {
    return Number.isFinite(value) && value > 0 ? Number(value) : null;
  }

  function frame(tSec, hz, clarity = 0, confidence = 0, voiced = false) {
    return { tSec: Number(tSec.toFixed(6)), hz: finiteHz(hz), clarity: Number(clarity) || 0,
      confidence: Number(confidence) || 0, voiced: Boolean(voiced) };
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ result >>> 15, result | 1);
      result ^= result + Math.imul(result ^ result >>> 7, result | 61);
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  function renderTone({ sampleRate = 16000, durationSec = 2, frequencyAt, amplitude = .12,
    harmonics = [1], noiseAmplitude = 0, seed = 1 }) {
    const length = Math.max(1, Math.round(sampleRate * durationSec));
    const pcm = new Float32Array(length);
    const random = mulberry32(seed);
    const phases = harmonics.map(() => 0);
    const normalizer = harmonics.reduce((sum, gain) => sum + Math.abs(gain), 0) || 1;
    for (let index = 0; index < length; index += 1) {
      const tSec = index / sampleRate;
      const hz = finiteHz(frequencyAt(tSec));
      let sample = 0;
      if (hz != null) {
        for (let harmonic = 0; harmonic < harmonics.length; harmonic += 1) {
          phases[harmonic] += 2 * Math.PI * hz * (harmonic + 1) / sampleRate;
          sample += harmonics[harmonic] * Math.sin(phases[harmonic]);
        }
        sample *= amplitude / normalizer;
      }
      sample += noiseAmplitude * (random() * 2 - 1);
      pcm[index] = Math.max(-1, Math.min(1, sample));
    }
    return pcm;
  }

  function take(name, pcm, sampleRate, groundTruth, metadata = {}) {
    return { name, pcm, sampleRate, groundTruth, metadata };
  }

  function steadyTone({ hz = 220, durationSec = 2, sampleRate = 16000, amplitude = .12,
    noiseAmplitude = 0, seed = 1 } = {}) {
    const pcm = renderTone({ sampleRate, durationSec, amplitude, noiseAmplitude, seed, frequencyAt: () => hz });
    return take('steadyTone', pcm, sampleRate, [{ tSec: 0, hz }, { tSec: durationSec, hz }], { kind: 'steady' });
  }

  function stepChange({ fromHz = 220, toHz = 246.9416506, changeSec = 1, durationSec = 2.2,
    sampleRate = 16000, amplitude = .12, noiseAmplitude = 0, seed = 2 } = {}) {
    const pcm = renderTone({ sampleRate, durationSec, amplitude, noiseAmplitude, seed,
      frequencyAt: (tSec) => tSec < changeSec ? fromHz : toHz });
    return take('stepChange', pcm, sampleRate,
      [{ tSec: 0, hz: fromHz }, { tSec: changeSec, hz: toHz }, { tSec: durationSec, hz: toHz }],
      { kind: 'step', transitions: [{ tSec: changeSec, fromHz, toHz }] });
  }

  function vibratoTone({ hz = 220, depthCents = 50, rateHz = 5, durationSec = 2.4,
    sampleRate = 16000, amplitude = .12, noiseAmplitude = 0, seed = 3 } = {}) {
    const frequencyAt = (tSec) => hz * Math.pow(2, depthCents * Math.sin(2 * Math.PI * rateHz * tSec) / 1200);
    const pcm = renderTone({ sampleRate, durationSec, amplitude, noiseAmplitude, seed, frequencyAt });
    const groundTruth = [];
    for (let tSec = 0; tSec <= durationSec + 1e-9; tSec += .01) groundTruth.push({ tSec, hz: frequencyAt(tSec) });
    return take('vibratoTone', pcm, sampleRate, groundTruth, { kind: 'continuous' });
  }

  function harmonicRichTone({ hz = 220, durationSec = 2, sampleRate = 16000, amplitude = .16,
    harmonics = [1, 1.8, .8, .35], noiseAmplitude = 0, seed = 4 } = {}) {
    const pcm = renderTone({ sampleRate, durationSec, amplitude, harmonics, noiseAmplitude, seed, frequencyAt: () => hz });
    return take('harmonicRichTone', pcm, sampleRate, [{ tSec: 0, hz }, { tSec: durationSec, hz }], { kind: 'steady' });
  }

  function silenceGap({ hz = 220, beforeSec = .8, gapSec = .35, afterSec = .8,
    sampleRate = 16000, amplitude = .12, noiseAmplitude = 0, seed = 5 } = {}) {
    const durationSec = beforeSec + gapSec + afterSec;
    const frequencyAt = (tSec) => tSec >= beforeSec && tSec < beforeSec + gapSec ? null : hz;
    const pcm = renderTone({ sampleRate, durationSec, amplitude, noiseAmplitude, seed, frequencyAt });
    return take('silenceGap', pcm, sampleRate,
      [{ tSec: 0, hz }, { tSec: beforeSec, hz: null }, { tSec: beforeSec + gapSec, hz }, { tSec: durationSec, hz }],
      { kind: 'segments' });
  }

  function truthAt(groundTruth, tSec) {
    if (!groundTruth?.length) return null;
    let selected = groundTruth[0];
    for (const point of groundTruth) {
      if (point.tSec > tSec) break;
      selected = point;
    }
    return finiteHz(selected?.hz);
  }

  function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))];
  }

  function standardDeviation(values) {
    if (!values.length) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  }

  function transitionsFrom(takeRecord) {
    if (takeRecord.metadata?.transitions?.length) return takeRecord.metadata.transitions;
    if (takeRecord.metadata?.kind) return [];
    const result = [];
    for (let index = 1; index < takeRecord.groundTruth.length; index += 1) {
      const previous = takeRecord.groundTruth[index - 1], current = takeRecord.groundTruth[index];
      if (finiteHz(previous.hz) != null && finiteHz(current.hz) != null && previous.hz !== current.hz) {
        result.push({ tSec: current.tSec, fromHz: previous.hz, toHz: current.hz });
      }
    }
    return result;
  }

  function metricsFor(takeRecord, result, streamName = 'trackedPitch') {
    const stream = result[streamName] ?? [];
    const errors = [];
    let octaveErrors = 0;
    const voicedFrames = stream.filter((item) => item.voiced && finiteHz(item.hz) != null);
    for (let index = 0; index < stream.length; index += 1) {
      const item = stream[index];
      if (!item.voiced || finiteHz(item.hz) == null) continue;
      const expected = takeRecord.frameTruthHz ? finiteHz(takeRecord.frameTruthHz[index]) : truthAt(takeRecord.groundTruth, item.tSec);
      if (expected == null) continue;
      const error = 1200 * Math.log2(item.hz / expected);
      errors.push(error);
      if (Math.abs(Math.abs(error) - 1200) <= METRIC_POLICY.octaveToleranceCents) octaveErrors += 1;
    }
    let largeJumps = 0;
    for (let index = 1; index < voicedFrames.length; index += 1) {
      const previous = voicedFrames[index - 1], current = voicedFrames[index];
      if (current.tSec - previous.tSec <= .12
        && Math.abs(1200 * Math.log2(current.hz / previous.hz)) > 700) largeJumps += 1;
    }
    const settling = [], overshoots = [];
    for (const transition of transitionsFrom(takeRecord)) {
      const after = stream.filter((item) => item.tSec >= transition.tSec && item.voiced && finiteHz(item.hz) != null);
      let settledAt = null;
      for (let index = 0; index <= after.length - METRIC_POLICY.settledFrames; index += 1) {
        const stable = after.slice(index, index + METRIC_POLICY.settledFrames)
          .every((item) => Math.abs(1200 * Math.log2(item.hz / transition.toHz)) <= METRIC_POLICY.settledToleranceCents);
        if (stable) { settledAt = after[index].tSec; break; }
      }
      if (settledAt != null) settling.push(Math.max(0, (settledAt - transition.tSec) * 1000));
      const direction = Math.sign(Math.log2(transition.toHz / transition.fromHz));
      const until = settledAt ?? (transitionsFrom(takeRecord).find((item) => item.tSec > transition.tSec)?.tSec ?? Infinity);
      const overshoot = after.filter((item) => item.tSec <= until).map((item) => {
        const signedError = direction * 1200 * Math.log2(item.hz / transition.toHz);
        return Math.max(0, signedError);
      });
      overshoots.push(overshoot.length ? Math.max(...overshoot) : 0);
    }
    const absoluteErrors = errors.map(Math.abs);
    return {
      frameCount: stream.length,
      voicedFrameCount: voicedFrames.length,
      voicedPercent: stream.length ? voicedFrames.length / stream.length * 100 : 0,
      medianErrorCents: percentile(absoluteErrors, .5),
      jitterCents: standardDeviation(errors),
      settlingTimeMs: settling.length ? Math.max(...settling) : null,
      overshootCents: overshoots.length ? Math.max(...overshoots) : 0,
      octaveErrorRate: errors.length ? octaveErrors / errors.length : 0,
      largeJumpsOver700Cents: largeJumps,
    };
  }

  function createHarness(pitchApi = global.ChoirPitch, analysisDefaults = {}) {
    if (!pitchApi?.detectPitch || !pitchApi?.PitchSmoother) throw new Error('ChoirPitch non disponibile');
    const takes = new Map();
    const results = new Map();
    let nextId = 1;

    function loadSyntheticTake(pcm, sampleRate, groundTruth, metadata = {}) {
      if (!(pcm instanceof Float32Array)) throw new TypeError('pcm deve essere Float32Array');
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError('sampleRate non valido');
      if (!Array.isArray(groundTruth)) throw new TypeError('groundTruth deve essere un array');
      const takeId = `synthetic-${nextId++}`;
      takes.set(takeId, { pcm: new Float32Array(pcm), sampleRate, groundTruth: groundTruth.map((point) => ({ ...point })), metadata: { ...metadata } });
      return takeId;
    }

    function loadRecordedTake(record) {
      if (!Array.isArray(record?.frames)) throw new TypeError('record.frames deve essere un array');
      const takeId = `recorded-${nextId++}`;
      const origin = Number(record.startAudioTimeSec) || 0;
      const trackedPitch = [], displayPitch = [], confirmationStates = [], rawCandidates = [], frameTruthHz = [];
      const groundTruth = [];
      let previousTruth = Symbol('initial');
      for (const source of record.frames) {
        const tSec = Math.max(0, (Number(source.audioTimeSec) || 0) - origin);
        const accepted = source.voicing === 'voiced' && finiteHz(source.trackedHz) != null;
        const tracked = frame(tSec, accepted ? source.trackedHz : null, source.clarity, source.confidence, accepted);
        trackedPitch.push(tracked);
        displayPitch.push({ ...tracked });
        rawCandidates.push(frame(tSec, source.rawHz, source.clarity, source.confidence, finiteHz(source.rawHz) != null));
        const provisional = source.voicing === 'uncertain'
          && ['octave-transition', 'large-jump-transition'].includes(source.rejectionReason);
        confirmationStates.push({ tSec: Number(tSec.toFixed(6)), state: provisional ? 'provisional' : (accepted ? 'confirmed' : null),
          reason: source.rejectionReason ?? null });
        const targetHz = Number.isFinite(source.targetMidiPitch)
          ? 440 * Math.pow(2, (source.targetMidiPitch - 69) / 12) : null;
        frameTruthHz.push(targetHz);
        if (previousTruth !== targetHz) {
          groundTruth.push({ tSec, hz: targetHz });
          previousTruth = targetHz;
        }
      }
      const result = { trackedPitch, displayPitch, confirmationStates, rawCandidates };
      takes.set(takeId, { groundTruth, frameTruthHz, metadata: { kind: 'recorded', sourceId: record.id }, precomputedV1: result });
      results.set(`${takeId}:v1`, result);
      return takeId;
    }

    function runAlgorithm(takeId, algorithmId = 'v1', options = {}) {
      const normalizedAlgorithm = algorithmId.replace(/\s+/g, '');
      if (!['v1', 'v1+display-filter'].includes(normalizedAlgorithm)) throw new Error(`Algoritmo non supportato: ${algorithmId}`);
      const takeRecord = takes.get(takeId);
      if (!takeRecord) throw new Error(`Take non trovato: ${takeId}`);
      if (normalizedAlgorithm === 'v1+display-filter') {
        const base = results.get(`${takeId}:v1`) ?? runAlgorithm(takeId, 'v1', options);
        const Filter = global.ChoirOneEuro?.OneEuroFilter;
        if (!Filter) throw new Error('OneEuroFilter non disponibile');
        const filter = new Filter(options.displayFilter);
        const displayPitch = base.trackedPitch.map((item) => {
          if (!item.voiced || finiteHz(item.hz) == null) { filter.reset(); return { ...item, hz: null, voiced: false }; }
          const midi = 69 + 12 * Math.log2(item.hz / 440);
          const filteredMidi = filter.filter(midi, item.tSec);
          return { ...item, hz: 440 * Math.pow(2, (filteredMidi - 69) / 12) };
        });
        const filteredResult = { trackedPitch: base.trackedPitch.map((item) => ({ ...item })), displayPitch,
          confirmationStates: base.confirmationStates.map((item) => ({ ...item })), rawCandidates: base.rawCandidates.map((item) => ({ ...item })) };
        results.set(`${takeId}:${algorithmId}`, filteredResult);
        return filteredResult;
      }
      if (takeRecord.precomputedV1) return takeRecord.precomputedV1;
      const config = { ...DEFAULT_ANALYSIS, ...analysisDefaults, ...options };
      const frameSize = Math.max(64, Math.round(config.frameSize));
      const hopSamples = Math.max(1, Math.round(takeRecord.sampleRate * config.hopMs / 1000));
      const smoother = new pitchApi.PitchSmoother(options.tracker ?? {});
      const trackedPitch = [], displayPitch = [], confirmationStates = [], rawCandidates = [];
      for (let end = frameSize; end <= takeRecord.pcm.length; end += hopSamples) {
        const tSec = end / takeRecord.sampleRate;
        const estimate = pitchApi.detectPitch(takeRecord.pcm.subarray(end - frameSize, end), takeRecord.sampleRate,
          { rmsThreshold: config.rmsThreshold });
        const smoothed = smoother.update(estimate, tSec * 1000);
        const acceptedHz = smoothed.stable && smoothed.accepted ? smoothed.hz : null;
        const provisional = smoothed.rejectionReason === 'octave-transition' || smoothed.rejectionReason === 'large-jump-transition';
        rawCandidates.push(frame(tSec, estimate.hz, estimate.clarity, estimate.confidence, estimate.hz != null));
        trackedPitch.push(frame(tSec, acceptedHz, smoothed.clarity, smoothed.confidence, acceptedHz != null));
        displayPitch.push(frame(tSec, acceptedHz, smoothed.clarity, smoothed.confidence, acceptedHz != null));
        confirmationStates.push({ tSec: Number(tSec.toFixed(6)), state: provisional ? 'provisional' : (acceptedHz != null ? 'confirmed' : null),
          reason: smoothed.rejectionReason ?? null });
      }
      const result = { trackedPitch, displayPitch, confirmationStates, rawCandidates };
      results.set(`${takeId}:${algorithmId}`, result);
      return result;
    }

    function getMetrics(takeId, algorithmId = 'v1', streamName = 'trackedPitch') {
      const takeRecord = takes.get(takeId);
      if (!takeRecord) throw new Error(`Take non trovato: ${takeId}`);
      const result = results.get(`${takeId}:${algorithmId}`) ?? runAlgorithm(takeId, algorithmId);
      return metricsFor(takeRecord, result, streamName);
    }

    return { loadSyntheticTake, loadRecordedTake, runAlgorithm, getMetrics };
  }

  function archivedTake(criteria = {}) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('choir-ground-truth', 2);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB non disponibile'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('benchmark-takes')) { resolve(null); return; }
        const all = db.transaction('benchmark-takes').objectStore('benchmark-takes').getAll();
        all.onerror = () => reject(all.error ?? new Error('Archivio benchmark non leggibile'));
        all.onsuccess = () => resolve(all.result.find((item) => Object.entries(criteria)
          .every(([key, value]) => value == null || item[key] === value)) ?? null);
      };
    });
  }

  const api = { DEFAULT_ANALYSIS, METRIC_POLICY, createHarness, metricsFor, fixtures: {
    steadyTone, stepChange, vibratoTone, harmonicRichTone, silenceGap,
  } };
  global.ChoirPitchTest = api;
  const browserDevBuild = typeof location !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(location.hostname);
  if (browserDevBuild && global.ChoirPitch) {
    const hooks = createHarness(global.ChoirPitch);
    hooks.loadArchivedTake = async (criteria) => {
      const record = await archivedTake(criteria);
      if (!record) throw new Error('Take benchmark richiesto non trovato');
      return hooks.loadRecordedTake(record);
    };
    global.__pitchTestHooks = hooks;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
