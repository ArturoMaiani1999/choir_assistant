(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoirMicrophoneCalibration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2;
  const DETECTOR_VERSION = 'yin-live-harmonics-3';
  const MARGIN_SEC = .5;
  const STAGES = Object.freeze([
    { start: 0, end: 4, voiced: null, instruction: 'Mettiti comodo', hint: 'Tra poco misuriamo il silenzio. Non cantare ancora.' },
    { start: 4, end: 8, voiced: false, split: 'train', instruction: 'Resta in silenzio', hint: 'Non parlare e non toccare il microfono.' },
    { start: 8, end: 11, voiced: null, instruction: 'Preparati a cantare', hint: 'Fai un respiro. Aspetta il segnale «Canta».' },
    { start: 11, end: 16, voiced: true, split: 'train', instruction: 'Canta adesso: «aaa»', hint: 'Tieni una nota comoda, a volume naturale.' },
    { start: 16, end: 20, voiced: false, split: 'validation', instruction: 'Pausa: non cantare', hint: 'Rilassa la voce e resta in silenzio.' },
    { start: 20, end: 23, voiced: null, instruction: 'Preparati, più piano', hint: 'Fai un respiro. Aspetta di nuovo «Canta».' },
    { start: 23, end: 27, voiced: true, split: 'validation', instruction: 'Canta adesso, più piano', hint: 'Ripeti «aaa» con meno volume, senza sussurrare.' },
    { start: 27, end: 30, voiced: false, split: 'validation', instruction: 'Ultima pausa', hint: 'Smetti di cantare. Mantieni il silenzio fino alla fine.' },
  ]);
  const REUSE_STAGES = Object.freeze([STAGES[0], { ...STAGES[1], split: 'validation' }]);
  // The unified guide has already prepared the user and warmed the audio chain.
  // Keep independent quiet/soft-voice validation and exclude phase boundaries.
  const AUDIO_STAGES = Object.freeze([
    { ...STAGES[1], start: 0, end: 3 },
    { ...STAGES[2], start: 3, end: 5 },
    { ...STAGES[3], start: 5, end: 10 },
    { ...STAGES[4], start: 10, end: 13 },
    { ...STAGES[5], start: 13, end: 15 },
    { ...STAGES[6], start: 15, end: 19 },
    { ...STAGES[7], start: 19, end: 22 },
  ]);
  const DURATION_SEC = STAGES.at(-1).end;
  const REUSE_DURATION_SEC = REUSE_STAGES.at(-1).end;
  const MAX_FRAMES = 1800;
  const quantile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * p)];
  };
  function labelAt(timeSec, stages = STAGES) {
    return stages.find(s => typeof s.voiced === 'boolean' && timeSec >= s.start + MARGIN_SEC && timeSec < s.end - MARGIN_SEC) || null;
  }
  function settings(input = {}) {
    const result = { rmsThreshold: input.rmsThreshold ?? .000002, yinThreshold: input.yinThreshold ?? .42,
      minClarity: input.minClarity ?? .45, minConfidence: input.minConfidence ?? .30,
      levelConfidenceFloor: input.levelConfidenceFloor ?? null,
      weakSignalHoldFrames: input.weakSignalHoldFrames ?? 0, candidateConsistencyCents: input.candidateConsistencyCents ?? 100 };
    for (const [key, value] of Object.entries(result)) {
      if (key === 'levelConfidenceFloor' && value === null) continue;
      if (!Number.isFinite(value)) throw new Error('Configurazione microfono non valida');
    }
    if (result.rmsThreshold < 0 || result.rmsThreshold > .01 || result.yinThreshold < .05 || result.yinThreshold > .8
      || result.minClarity < .05 || result.minClarity > .95 || result.minConfidence < .05 || result.minConfidence > .95
      || result.levelConfidenceFloor !== null && (result.levelConfidenceFloor < 0 || result.levelConfidenceFloor > 1)
      || !Number.isInteger(result.weakSignalHoldFrames) || result.weakSignalHoldFrames < 0 || result.weakSignalHoldFrames > 8
      || result.candidateConsistencyCents < 50 || result.candidateConsistencyCents > 400) throw new Error('Configurazione microfono fuori intervallo');
    return result;
  }
  function extractFrames(captured, sampleRate, baseline, detector, progress) {
    if (!(sampleRate > 0) || !Number.isFinite(sampleRate) || captured.length > MAX_FRAMES) throw new Error('Acquisizione non valida');
    const config = settings(baseline);
    return captured.map((frame, index) => {
      const pcm = frame.pcm instanceof Float32Array ? frame.pcm : new Float32Array(frame.buffer);
      if (pcm.length !== 2048 || !pcm.every(Number.isFinite) || !Number.isFinite(frame.timeSec)) throw new Error('Frame microfono non valido');
      const raw = detector.detectPitch(pcm, sampleRate, { rmsThreshold: 0, yinThreshold: config.yinThreshold, resolveHarmonics: true });
      let clipped = 0;
      for (const value of pcm) if (Math.abs(value) >= .99) clipped += 1;
      if (index % 25 === 0) progress?.(index / captured.length);
      return { timeSec: frame.timeSec, rms: raw.rms, hz: raw.hz, originalHz: raw.originalHz??raw.hz, clarity: raw.clarity, clippedFraction: clipped / pcm.length };
    });
  }
  function scoreFrames(frames, config, trackerSettings, detector, stages = STAGES) {
    const Tracker = detector.HarmonicPitchSmoother || detector.PitchSmoother;
    const tracker = new Tracker({ ...trackerSettings, ...config });
    const counts = { train: { tp: 0, tn: 0, fp: 0, fn: 0 }, validation: { tp: 0, tn: 0, fp: 0, fn: 0 } };
    for (const frame of frames) {
      const floor = config.levelConfidenceFloor ?? (config.rmsThreshold < .001 ? .36 : 0);
      const raw = { hz: frame.rms >= config.rmsThreshold ? frame.hz : null,
        originalHz: frame.rms >= config.rmsThreshold ? frame.originalHz??frame.hz : null, rms: frame.rms,
        clarity: frame.clarity, confidence: frame.clarity * Math.max(floor, Math.min(1, frame.rms / .08)) };
      const tracked = tracker.update(raw, frame.timeSec * 1000), label = labelAt(frame.timeSec, stages);
      if (!label) continue;
      const present = Boolean(tracked.accepted && tracked.stable && tracked.hz > 0), c = counts[label.split];
      if (label.voiced) c[present ? 'tp' : 'fn'] += 1; else c[present ? 'fp' : 'tn'] += 1;
    }
    for (const c of Object.values(counts)) {
      c.recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
      c.specificity = c.tn + c.fp ? c.tn / (c.tn + c.fp) : null;
      c.balancedAccuracy = c.recall != null && c.specificity != null ? (c.recall + c.specificity) / 2 : null;
    }
    return counts;
  }
  function evaluate(frames, baselineInput, trackerSettings, detector, unified = false) {
    const stages = unified ? AUDIO_STAGES : STAGES, duration = stages.at(-1).end;
    const labelAt = time => stages.find(s => typeof s.voiced === 'boolean' && time >= s.start + MARGIN_SEC && time < s.end - MARGIN_SEC);
    const baseline = settings(baselineInput), labelled = frames.filter(f => labelAt(f.timeSec));
    const noise = labelled.filter(f => !labelAt(f.timeSec).voiced && labelAt(f.timeSec).split === 'train').map(f => f.rms);
    const voice = labelled.filter(f => labelAt(f.timeSec).voiced && labelAt(f.timeSec).split === 'train').map(f => f.rms);
    const soft = labelled.filter(f => labelAt(f.timeSec).voiced && labelAt(f.timeSec).split === 'validation').map(f => f.rms);
    const noise95 = quantile(noise, .95), voice20 = quantile(voice, .2), soft20 = quantile(soft, .2);
    const quality = { noise95, voice20, soft20, clippedFraction: frames.length ? frames.reduce((s, f) => s + f.clippedFraction, 0) / frames.length : 0 };
    const fail = reason => ({ version: VERSION, detectorVersion: DETECTOR_VERSION, status: 'retry', reason, quality, selected: null, reference: 'guided-weak-labels' });
    if (frames.length < duration * 20 || !stages.filter(s => typeof s.voiced === 'boolean').every(s => frames.filter(f => f.timeSec >= s.start + MARGIN_SEC && f.timeSec < s.end - MARGIN_SEC).length >= (s.end - s.start - 2 * MARGIN_SEC) * 20)
      || frames.at(-1).timeSec < duration - MARGIN_SEC || frames.some((f, i) => i && (f.timeSec <= frames[i - 1].timeSec || f.timeSec - frames[i - 1].timeSec > .15))) return fail('capture-incomplete');
    if (quality.clippedFraction > .005 || labelled.some(f => f.clippedFraction > .08)) return fail('clipping');
    if (!(voice20 > Math.max(1e-7, noise95 * 2)) || !(soft20 > Math.max(1e-7, noise95 * 1.5))) return fail('insufficient-separation');
    const threshold = Math.max(.000001, Math.min(.01, voice20 * .5, Math.max(.000002, noise95 * 2)));
    // Changing RMS must not accidentally change detectPitch's automatic
    // confidence floor at RMS=0.001. Keep the baseline amplitude prior explicit.
    const adapted = { ...baseline, rmsThreshold: threshold,
      levelConfidenceFloor: baseline.levelConfidenceFloor ?? (baseline.rmsThreshold < .001 ? .36 : 0) };
    const candidates = [baseline,
      adapted,
      { ...adapted, minConfidence: Math.min(baseline.minConfidence, .2) },
      { ...adapted, minConfidence: Math.min(baseline.minConfidence, .1), minClarity: Math.min(baseline.minClarity, .4) }];
    const evaluations = candidates.map((candidate, index) => ({ index, settings: candidate, ...scoreFrames(frames, candidate, trackerSettings, detector, stages) }));
    // Fit only on train. Validation can reject the winner, never choose a runner-up.
    const winner = [...evaluations].sort((a, b) => b.train.balancedAccuracy - a.train.balancedAccuracy || a.index - b.index)[0];
    const original = evaluations[0], valid = e => e.recall >= .8 && e.specificity >= .9;
    if (!valid(winner.train) || !valid(winner.validation)) return { ...fail('validation-failed'), evaluations };
    const improves = winner.train.balancedAccuracy >= original.train.balancedAccuracy + .02
      && winner.validation.balancedAccuracy >= original.validation.balancedAccuracy
      && winner.validation.recall >= original.validation.recall - .02
      && winner.validation.specificity >= original.validation.specificity - .02;
    const selected = improves ? winner : original;
    if (!valid(selected.train) || !valid(selected.validation)) return { ...fail('no-verified-improvement'), evaluations };
    return { version: VERSION, detectorVersion: DETECTOR_VERSION, status: improves ? 'candidate' : 'baseline',
      selected: selected.settings, selectedIndex: selected.index, evaluations, quality, reference: 'guided-weak-labels',
      scientificNote: 'Stima voce/pausa sulla guida; non misura accuratezza F0 né generalizzazione.' };
  }
  function chainSettings(trackSettings = {}, contextRate) {
    return { sampleRate: trackSettings.sampleRate ?? null, contextRate,
      channelCount: trackSettings.channelCount ?? null, autoGainControl: trackSettings.autoGainControl ?? null,
      echoCancellation: trackSettings.echoCancellation ?? null, noiseSuppression: trackSettings.noiseSuppression ?? null };
  }
  function validProfile(profile, scope, chain, now = Date.now()) {
    try {
      return profile?.version === VERSION && profile.detectorVersion === DETECTOR_VERSION && profile.scope === scope
        && profile.chain === chain && Number.isFinite(profile.createdAt) && now >= profile.createdAt
        && Number.isFinite(profile.quality?.noise95) && profile.quality.noise95 >= 0 && Boolean(settings(profile.settings));
    } catch (_) { return false; }
  }
  function verifyNoise(frames, profile, detector) {
    if (frames.length < REUSE_DURATION_SEC * 20 || frames.at(-1).timeSec < REUSE_DURATION_SEC - MARGIN_SEC
      || frames.some((f, i) => i && (f.timeSec <= frames[i - 1].timeSec || f.timeSec - frames[i - 1].timeSec > .15))) return false;
    const quiet = REUSE_STAGES[1];
    const interior = frames.filter(f => f.timeSec >= quiet.start + MARGIN_SEC && f.timeSec < quiet.end - MARGIN_SEC);
    if (interior.length < (quiet.end - quiet.start - 2 * MARGIN_SEC) * 20) return false;
    const q95 = quantile(interior.map(f => f.rms), .95), reference = profile.quality.noise95;
    if (q95 == null || q95 > Math.max(.000002, reference * 2) || interior.some(f => f.clippedFraction > .005)) return false;
    let fp = 0;
    for (const frame of interior) {
      const config = profile.settings, floor = config.levelConfidenceFloor ?? (config.rmsThreshold < .001 ? .36 : 0);
      if (frame.rms >= config.rmsThreshold && frame.hz > 0 && frame.clarity >= config.minClarity
        && frame.clarity * Math.max(floor, Math.min(1, frame.rms / .08)) >= config.minConfidence) fp += 1;
    }
    return fp / interior.length <= .1;
  }
  return Object.freeze({ VERSION, DETECTOR_VERSION, STAGES, AUDIO_STAGES, REUSE_STAGES, DURATION_SEC, REUSE_DURATION_SEC, MAX_FRAMES, MARGIN_SEC,
    labelAt, settings, extractFrames, scoreFrames, evaluate, chainSettings, validProfile, verifyNoise });
});
