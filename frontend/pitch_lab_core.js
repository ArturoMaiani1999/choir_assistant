(function exposePitchLabCore(global) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const ALGORITHM_VERSION = '2026.10.18-3';
  const EPSILON = 1e-12;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const finite = value => Number.isFinite(value) ? Number(value) : null;
  const hzToMidi = hz => hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
  const midiToHz = midi => 440 * Math.pow(2, (midi - 69) / 12);
  const centsBetween = (actual, expected) => actual > 0 && expected > 0 ? 1200 * Math.log2(actual / expected) : null;

  const DEFAULTS = Object.freeze({
    algorithm: 'yin',
    frameLength: 2048,
    hopLength: 512,
    analysisSampleRate: 16000,
    fmin: 70,
    fmax: 1000,
    removeDc: true,
    rmsThreshold: 0.000002,
    yinThreshold: 0.42,
    levelConfidenceFloor: 0.36,
    minClarity: 0.45,
    minConfidence: 0.30,
    warmupFrames: 3,
    releaseFrames: 3,
    weakSignalHoldFrames: 0,
    medianWindowFrames: 3,
    fastAlpha: 0.65,
    slowAlpha: 0.30,
    smallJumpCents: 300,
    largeJumpConfirmFrames: 3,
    octaveCenterCents: 1200,
    octaveToleranceCents: 180,
    octaveConfirmFrames: 5,
    candidateConsistencyCents: 100,
    tracking: true,
    nThresholds: 100,
    betaAlpha: 2,
    betaBeta: 18,
    boltzmannParameter: 2,
    resolution: 0.1,
    maxTransitionRate: 35.92,
    switchProb: 0.01,
    noTroughProb: 0.01,
    decoder: 'normalized-grid',
    minVoicedProbability: 0,
    discontinuityCents: 700,
    disagreementCents: 100,
  });

  const PRESETS = Object.freeze({
    'yin-production': { label: 'YIN Production', algorithm: 'yin', slowAlpha: .65 },
    'yin-lab-original': { label: 'YIN Lab originale', algorithm: 'yin' },
    'yin-relaxed': { label: 'YIN Relaxed Gates', algorithm: 'yin', minClarity: 0.32, minConfidence: 0.10,
      yinThreshold: 0.68, levelConfidenceFloor: 0.68, weakSignalHoldFrames: 6 },
    'yin-raw': { label: 'YIN Raw Only', algorithm: 'yin', tracking: false },
    'yin-no-confidence': { label: 'YIN No Confidence Gate', algorithm: 'yin', minConfidence: 0 },
    'yin-no-temporal': { label: 'YIN No Temporal Confirmation', algorithm: 'yin', warmupFrames: 1,
      largeJumpConfirmFrames: 1, octaveConfirmFrames: 1, medianWindowFrames: 1, fastAlpha: 1, slowAlpha: 1 },
    'pyin-default': { label: 'pYIN Default', algorithm: 'pyin', removeDc: false },
    'pyin-original': { label: 'pYIN originale (diagnosi)', algorithm: 'pyin', removeDc: false, decoder: 'legacy-sparse' },
    'pyin-balanced': { label: 'pYIN gate sperimentale', algorithm: 'pyin', removeDc: false, minVoicedProbability: .05 },
  });

  function preset(id) {
    const selected = PRESETS[id];
    if (!selected) throw new Error(`Preset sconosciuto: ${id}`);
    return { ...DEFAULTS, ...selected, presetId: id };
  }

  function validateConfig(input = {}) {
    const config = { ...DEFAULTS, ...input };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof DEFAULTS[key] === 'number') {
        config[key] = Number(config[key]);
        if (!Number.isFinite(config[key])) throw new Error(`${key} deve essere finito`);
      }
    }
    if (!['yin', 'pyin'].includes(config.algorithm)) throw new Error('Algoritmo non valido');
    if (!['normalized-grid', 'legacy-sparse'].includes(config.decoder)) throw new Error('Decoder non valido');
    if (![2048, 4096, 8192].includes(Number(config.frameLength))) throw new Error('Frame length non valido');
    if (![128, 256, 512, 1024, 2048].includes(Number(config.hopLength))) throw new Error('Hop length non valido');
    if (![12000, 16000, 22050, 24000, 32000, 44100, 48000].includes(Number(config.analysisSampleRate))) {
      throw new Error('Sample rate di analisi non valido');
    }
    const positive = ['fmin', 'fmax', 'yinThreshold', 'betaAlpha', 'betaBeta', 'boltzmannParameter',
      'resolution', 'maxTransitionRate', 'discontinuityCents', 'disagreementCents'];
    for (const key of positive) if (!(Number(config[key]) > 0)) throw new Error(`${key} deve essere positivo`);
    if (config.fmin >= config.fmax || config.fmax > config.analysisSampleRate / 2) throw new Error('Intervallo F0 non valido');
    if (config.analysisSampleRate / config.fmin >= config.frameLength - 1) throw new Error('Il frame è troppo corto per fmin');
    if (config.yinThreshold > .99 || config.resolution >= 1) throw new Error('Soglia o risoluzione non valida');
    for (const key of ['rmsThreshold', 'levelConfidenceFloor', 'minClarity', 'minConfidence', 'switchProb', 'noTroughProb', 'minVoicedProbability']) {
      if (Number(config[key]) < 0 || Number(config[key]) > 1) throw new Error(`${key} deve essere tra 0 e 1`);
    }
    for (const key of ['warmupFrames', 'releaseFrames', 'medianWindowFrames', 'largeJumpConfirmFrames',
      'octaveConfirmFrames', 'nThresholds']) {
      if (!Number.isInteger(Number(config[key])) || Number(config[key]) < 1) throw new Error(`${key} deve essere un intero positivo`);
    }
    if (config.nThresholds > 400) throw new Error('nThresholds supera il limite di 400');
    if (config.medianWindowFrames > 15) throw new Error('Finestra mediana troppo ampia');
    if (config.switchProb <= 0 || config.switchProb >= 1) throw new Error('switchProb deve essere tra 0 e 1 esclusi');
    if (!Number.isInteger(config.weakSignalHoldFrames) || config.weakSignalHoldFrames < 0) throw new Error('Hold non valido');
    if (config.smallJumpCents <= 0 || config.candidateConsistencyCents <= 0 || config.octaveToleranceCents < 0) throw new Error('Soglia tracker non valida');
    for (const key of ['fastAlpha', 'slowAlpha']) if (!(Number(config[key]) > 0 && Number(config[key]) <= 1)) throw new Error(`${key} non valido`);
    return Object.freeze({ ...config, frameLength: Number(config.frameLength), hopLength: Number(config.hopLength),
      analysisSampleRate: Number(config.analysisSampleRate) });
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function configHash(config) { return fnv1a(stableStringify(validateConfig(config))); }

  function audioFingerprint(audio, sampleRate) {
    const step = Math.max(1, Math.floor(audio.length / 4096));
    let value = `${audio.length}:${sampleRate}:`;
    for (let index = 0; index < audio.length; index += step) value += `${Math.round((audio[index] + 1) * 32767)},`;
    return fnv1a(value);
  }

  function resampleLinear(audio, sourceRate, targetRate) {
    if (!(sourceRate > 0) || !Number.isFinite(sourceRate) || !(targetRate > 0) || !Number.isFinite(targetRate)) throw new Error('Sample rate non valido');
    if (!audio.length) return new Float32Array(0);
    if (sourceRate === targetRate) return audio instanceof Float32Array ? audio : Float32Array.from(audio);
    const outputLength = Math.max(1, Math.round(audio.length * targetRate / sourceRate));
    const output = new Float32Array(outputLength);
    const ratio = sourceRate / targetRate;
    for (let index = 0; index < outputLength; index += 1) {
      const source = index * ratio;
      const left = Math.min(audio.length - 1, Math.floor(source));
      const right = Math.min(audio.length - 1, left + 1);
      const fraction = source - left;
      output[index] = audio[left] * (1 - fraction) + audio[right] * fraction;
    }
    return output;
  }

  function frameRms(audio, start, length) {
    let sum = 0;
    for (let index = 0; index < length; index += 1) { const value = audio[start + index] || 0; sum += value * value; }
    return Math.sqrt(sum / length);
  }

  function cmndFrame(audio, start, length, sampleRate, config) {
    const minimumPeriod = Math.max(2, Math.floor(sampleRate / config.fmax));
    const maximumPeriod = Math.min(Math.ceil(sampleRate / config.fmin), length - 2);
    const cmnd = new Float64Array(maximumPeriod + 1);
    const difference = new Float64Array(maximumPeriod + 1);
    let mean = 0;
    if (config.removeDc) {
      for (let index = 0; index < length; index += 1) mean += audio[start + index] || 0;
      mean /= length;
    }
    for (let tau = 1; tau <= maximumPeriod; tau += 1) {
      let sum = 0;
      const limit = length - tau;
      for (let index = 0; index < limit; index += 1) {
        const delta = ((audio[start + index] || 0) - mean) - ((audio[start + index + tau] || 0) - mean);
        sum += delta * delta;
      }
      difference[tau] = sum;
    }
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maximumPeriod; tau += 1) {
      running += difference[tau];
      cmnd[tau] = running <= EPSILON ? 1 : difference[tau] * tau / running;
    }
    return { cmnd, minimumPeriod, maximumPeriod };
  }

  function parabolicPeriod(cmnd, tau) {
    if (tau <= 0 || tau >= cmnd.length - 1) return tau;
    const left = cmnd[tau - 1], center = cmnd[tau], right = cmnd[tau + 1];
    const a = right + left - 2 * center;
    const b = (right - left) / 2;
    if (Math.abs(a) <= EPSILON || Math.abs(b) >= Math.abs(a)) return tau;
    return tau - b / a;
  }

  function octaveAlternate(troughs, selectedHz) {
    if (!selectedHz) return null;
    let best = null; let distance = Infinity;
    for (const candidate of troughs) {
      const cents = Math.abs(Math.abs(centsBetween(candidate.hz, selectedHz)) - 1200);
      if (cents < 120 && cents < distance) { best = candidate.hz; distance = cents; }
    }
    return best;
  }

  function troughsFromCmnd(analysis, sampleRate) {
    const { cmnd, minimumPeriod, maximumPeriod } = analysis; const troughs = [];
    for (let tau = minimumPeriod; tau < maximumPeriod; tau += 1) {
      const local = tau === minimumPeriod
        ? cmnd[tau] < cmnd[tau + 1]
        : cmnd[tau] <= cmnd[tau - 1] && cmnd[tau] < cmnd[tau + 1];
      if (!local) continue;
      const period = parabolicPeriod(cmnd, tau);
      troughs.push({ tau, period, cmnd: cmnd[tau], height: cmnd[tau], hz: sampleRate / period });
    }
    return troughs;
  }

  function yinEstimateFromCmnd(rms, analysis, sampleRate, config, includeTroughs = false) {
    if (rms < config.rmsThreshold) return { rawHz: null, rms, clarity: 0, confidence: 0, troughs: [] };
    const { cmnd, minimumPeriod, maximumPeriod } = analysis;
    const troughs = troughsFromCmnd(analysis, sampleRate);
    let selected = null;
    for (let tau = minimumPeriod; tau < maximumPeriod; tau += 1) {
      if (cmnd[tau] < config.yinThreshold) {
        while (tau + 1 < maximumPeriod && cmnd[tau + 1] < cmnd[tau]) tau += 1;
        selected = { tau, period: parabolicPeriod(cmnd, tau), cmnd: cmnd[tau] };
        selected.hz = sampleRate / selected.period;
        break;
      }
    }
    if (!selected || selected.hz < config.fmin || selected.hz > config.fmax) {
      return { rawHz: null, rms, clarity: 0, confidence: 0, troughs: includeTroughs ? troughs : [] };
    }
    const clarity = clamp(1 - selected.cmnd, 0, 1);
    const level = Math.max(config.levelConfidenceFloor, clamp(rms / 0.08, 0, 1));
    return { rawHz: selected.hz, rms, clarity, confidence: clarity * level,
      octaveAlternateHz: octaveAlternate(troughs, selected.hz), troughs: includeTroughs ? troughs : [] };
  }

  function yinEstimate(audio, start, sampleRate, config, includeTroughs = false) {
    const rms = frameRms(audio, start, config.frameLength);
    if (rms < config.rmsThreshold) return { rawHz: null, rms, clarity: 0, confidence: 0, troughs: [] };
    return yinEstimateFromCmnd(rms, cmndFrame(audio, start, config.frameLength, sampleRate, config),
      sampleRate, config, includeTroughs);
  }

  class ConfigurableTracker {
    constructor(config) { this.config = config; this.reset(); }
    reset() { this.hz = null; this.voicedFrames = 0; this.unvoicedFrames = 0; this.rawMidis = []; this.candidateMidi = null; this.candidateFrames = 0; }
    clearCandidate() { this.candidateMidi = null; this.candidateFrames = 0; }
    collectCandidate(midi) {
      if (this.candidateMidi != null && Math.abs(midi - this.candidateMidi) * 100 <= this.config.candidateConsistencyCents) {
        this.candidateMidi = (this.candidateMidi * this.candidateFrames + midi) / (this.candidateFrames + 1); this.candidateFrames += 1;
      } else { this.candidateMidi = midi; this.candidateFrames = 1; }
    }
    update(estimate) {
      const reliable = estimate.rawHz != null && estimate.clarity >= this.config.minClarity && estimate.confidence >= this.config.minConfidence;
      if (!reliable) {
        this.unvoicedFrames += 1;
        if (this.hz != null && this.unvoicedFrames <= this.config.weakSignalHoldFrames) {
          return { trackedHz: this.hz, accepted: true, rejectionReason: 'weak-signal-held' };
        }
        this.voicedFrames = 0; this.rawMidis = []; this.clearCandidate();
        if (this.unvoicedFrames >= this.config.releaseFrames) this.hz = null;
        return { trackedHz: null, accepted: false, rejectionReason: estimate.rawHz == null ? 'unvoiced' : 'low-confidence' };
      }
      this.unvoicedFrames = 0; this.voicedFrames += 1;
      const rawMidi = hzToMidi(estimate.rawHz);
      this.rawMidis.push(rawMidi);
      if (this.rawMidis.length > this.config.medianWindowFrames) this.rawMidis.shift();
      const sorted = [...this.rawMidis].sort((a, b) => a - b);
      const filtered = this.rawMidis.length < this.config.medianWindowFrames ? rawMidi : sorted[Math.floor(sorted.length / 2)];
      if (this.hz == null) {
        this.collectCandidate(rawMidi);
        if (this.candidateFrames < this.config.warmupFrames) return { trackedHz: null, accepted: false, rejectionReason: 'warm-up' };
        this.hz = midiToHz(this.candidateMidi); this.rawMidis = [this.candidateMidi]; this.clearCandidate();
        return { trackedHz: this.hz, accepted: true, rejectionReason: null };
      }
      const previousMidi = hzToMidi(this.hz), deltaCents = (rawMidi - previousMidi) * 100;
      const octave = Math.abs(Math.abs(deltaCents) - this.config.octaveCenterCents) <= this.config.octaveToleranceCents;
      if (Math.abs(deltaCents) > this.config.smallJumpCents) {
        this.collectCandidate(rawMidi);
        const required = octave ? this.config.octaveConfirmFrames : this.config.largeJumpConfirmFrames;
        if (this.candidateFrames < required) return { trackedHz: null, accepted: false,
          rejectionReason: octave ? 'octave-transition' : 'large-jump-transition' };
        this.hz = midiToHz(this.candidateMidi); this.rawMidis = [this.candidateMidi]; this.clearCandidate();
        return { trackedHz: this.hz, accepted: true, rejectionReason: null };
      }
      this.clearCandidate();
      const alpha = this.voicedFrames <= 2 ? this.config.fastAlpha : this.config.slowAlpha;
      this.hz = midiToHz(previousMidi * (1 - alpha) + filtered * alpha);
      return { trackedHz: this.hz, accepted: true, rejectionReason: null };
    }
  }

  function logGamma(value) {
    const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
      -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
    if (value < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
    let x = .9999999999998099; const z = value - 1;
    for (let index = 0; index < coefficients.length; index += 1) x += coefficients[index] / (z + index + 1);
    const t = z + coefficients.length - .5;
    return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
  }

  function betaContinuedFraction(a, b, x) {
    const maximumIterations = 160; const fpmin = 1e-30;
    let qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap; d = 1 / Math.max(fpmin, Math.abs(d)) * Math.sign(d || 1);
    let h = d;
    for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
      const m2 = 2 * iteration;
      let aa = iteration * (b - iteration) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d; h *= d * c;
      aa = -(a + iteration) * (qab + iteration) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d; const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) < 3e-10) break;
    }
    return h;
  }

  function regularizedBeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2)
      ? front * betaContinuedFraction(a, b, x) / a
      : 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
  }

  function thresholdMasses(config) {
    const result = new Float64Array(config.nThresholds);
    let previous = 0;
    for (let index = 1; index <= config.nThresholds; index += 1) {
      const current = regularizedBeta(index / config.nThresholds, config.betaAlpha, config.betaBeta);
      result[index - 1] = Math.max(0, current - previous); previous = current;
    }
    return result;
  }

  function pyinCandidatesFromCmnd(rms, analysis, sampleRate, config, betaMasses) {
    const troughs = troughsFromCmnd(analysis, sampleRate).map(item => ({ ...item, probability: 0 }));
    if (!troughs.length) return { rms, candidates: [], voicedProbability: 0 };
    let globalMinimum = 0;
    for (let index = 1; index < troughs.length; index += 1) if (troughs[index].height < troughs[globalMinimum].height) globalMinimum = index;
    for (let thresholdIndex = 0; thresholdIndex < config.nThresholds; thresholdIndex += 1) {
      const threshold = (thresholdIndex + 1) / config.nThresholds;
      const valid = troughs.map((item, index) => item.height < threshold ? index : -1).filter(index => index >= 0);
      const mass = betaMasses[thresholdIndex];
      if (!valid.length) { troughs[globalMinimum].probability += config.noTroughProb * mass; continue; }
      const weights = valid.map((_, rank) => Math.exp(-config.boltzmannParameter * rank));
      const normalizer = weights.reduce((sum, value) => sum + value, 0) || 1;
      valid.forEach((index, rank) => { troughs[index].probability += mass * weights[rank] / normalizer; });
    }
    const candidates = troughs.filter(item => item.probability > EPSILON && item.hz >= config.fmin && item.hz <= config.fmax);
    const voicedProbability = clamp(candidates.reduce((sum, item) => sum + item.probability, 0), 0, 1);
    return { rms, candidates, voicedProbability };
  }

  function pyinCandidates(audio, start, sampleRate, config, betaMasses) {
    const rms = frameRms(audio, start, config.frameLength);
    return pyinCandidatesFromCmnd(rms, cmndFrame(audio, start, config.frameLength, sampleRate, config),
      sampleRate, config, betaMasses);
  }

  function decodePyinLegacy(candidateFrames, config, sampleRate) {
    const frames = candidateFrames.length;
    if (!frames) return [];
    const resolution = config.resolution;
    const transitionBins = Math.max(1, Math.round(config.maxTransitionRate * 12 * config.hopLength / sampleRate / resolution));
    const voicedStates = candidateFrames.map(frame => {
      const byBin = new Map();
      for (const candidate of frame.candidates) {
        const bin = Math.round((hzToMidi(candidate.hz) - hzToMidi(config.fmin)) / resolution);
        const existing = byBin.get(bin);
        if (!existing || candidate.probability > existing.probability) byBin.set(bin, { ...candidate, bin });
      }
      return [...byBin.values()];
    });
    const backVoiced = new Array(frames); const backUnvoiced = new Int32Array(frames); backUnvoiced.fill(-1);
    let previousVoiced = voicedStates[0].map(candidate => Math.log(Math.max(EPSILON, candidate.probability)) + Math.log(.5));
    let previousUnvoiced = Math.log(Math.max(EPSILON, 1 - candidateFrames[0].voicedProbability)) + Math.log(.5);
    backVoiced[0] = voicedStates[0].map(() => -1);
    for (let frameIndex = 1; frameIndex < frames; frameIndex += 1) {
      const current = voicedStates[frameIndex]; const previous = voicedStates[frameIndex - 1];
      const currentCosts = new Array(current.length); const pointers = new Array(current.length);
      for (let currentIndex = 0; currentIndex < current.length; currentIndex += 1) {
        let best = previousUnvoiced + Math.log(config.switchProb); let pointer = -1;
        for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) {
          const distance = Math.abs(current[currentIndex].bin - previous[previousIndex].bin);
          if (distance > transitionBins) continue;
          const local = Math.max(EPSILON, (transitionBins + 1 - distance) / ((transitionBins + 1) ** 2));
          const score = previousVoiced[previousIndex] + Math.log(1 - config.switchProb) + Math.log(local);
          if (score > best) { best = score; pointer = previousIndex; }
        }
        currentCosts[currentIndex] = best + Math.log(Math.max(EPSILON, current[currentIndex].probability)); pointers[currentIndex] = pointer;
      }
      let bestUnvoiced = previousUnvoiced + Math.log(1 - config.switchProb); let unvoicedPointer = -1;
      for (let previousIndex = 0; previousIndex < previousVoiced.length; previousIndex += 1) {
        const score = previousVoiced[previousIndex] + Math.log(config.switchProb);
        if (score > bestUnvoiced) { bestUnvoiced = score; unvoicedPointer = previousIndex; }
      }
      previousUnvoiced = bestUnvoiced + Math.log(Math.max(EPSILON, 1 - candidateFrames[frameIndex].voicedProbability));
      previousVoiced = currentCosts; backVoiced[frameIndex] = pointers; backUnvoiced[frameIndex] = unvoicedPointer;
    }
    let state = -1; let best = previousUnvoiced;
    for (let index = 0; index < previousVoiced.length; index += 1) if (previousVoiced[index] > best) { best = previousVoiced[index]; state = index; }
    const output = new Array(frames);
    for (let frameIndex = frames - 1; frameIndex >= 0; frameIndex -= 1) {
      output[frameIndex] = state < 0 ? null : voicedStates[frameIndex][state];
      state = state < 0 ? backUnvoiced[frameIndex] : backVoiced[frameIndex][state];
    }
    return output;
  }

  // Two copies of the same pitch grid: V and UV retain identical pitch
  // transition priors. In particular UV emissions are (1-pVoice)/nBins;
  // collapsing UV to one state changes the model and biases it toward UV.
  function decodePyin(candidateFrames, config, sampleRate) {
    if (config.decoder === 'legacy-sparse') return decodePyinLegacy(candidateFrames.map(frame =>
      frame.voicedProbability < config.minVoicedProbability ? { ...frame, candidates: [], voicedProbability: 0 } : frame), config, sampleRate);
    const count = candidateFrames.length;
    if (!count) return [];
    const binsPerSemitone = Math.ceil(1 / config.resolution);
    const bins = Math.floor(12 * binsPerSemitone * Math.log2(config.fmax / config.fmin)) + 1;
    const states = 2 * bins;
    if (bins > 2048 || count * states > 25_000_000) throw new Error('Decoder: riduci durata, risoluzione o range F0 (limite memoria 100 MB).');
    const width = Math.min(bins, Math.round(config.maxTransitionRate * 12 * config.hopLength / sampleRate) * binsPerSemitone + 1);
    const radius = Math.floor(width / 2);
    const kernel = Float64Array.from({ length: width }, (_, i) => 1 - Math.abs((i - (width - 1) / 2) / (width % 2 ? (width + 1) / 2 : width / 2)));
    const rowNorm = new Float64Array(bins);
    for (let source = 0; source < bins; source += 1) {
      let total = 0;
      for (let k = 0; k < width; k += 1) if (source + k - radius >= 0 && source + k - radius < bins) total += kernel[k];
      rowNorm[source] = Math.log(total);
    }
    const logKernel = Float64Array.from(kernel, Math.log);
    const stay = Math.log1p(-config.switchProb), change = Math.log(config.switchProb);
    const tinyLog = Math.log(Number.MIN_VALUE);
    const back = new Int32Array(count * states);
    let previous = new Float64Array(states), current = new Float64Array(states);
    previous.fill(-Math.log(states));
    const emission = new Float64Array(bins);
    const binAt = hz => clamp(Math.round(12 * binsPerSemitone * Math.log2(hz / config.fmin)), 0, bins - 1);
    for (let t = 0; t < count; t += 1) {
      emission.fill(0);
      const gatePassed = candidateFrames[t].voicedProbability >= config.minVoicedProbability;
      if (gatePassed) for (const candidate of candidateFrames[t].candidates) emission[binAt(candidate.hz)] += candidate.probability;
      const uv = Math.log(Math.max(Number.MIN_VALUE, (1 - (gatePassed ? candidateFrames[t].voicedProbability : 0)) / bins));
      for (let dest = 0; dest < bins; dest += 1) {
        let bestV = -Infinity, bestU = -Infinity, ptrV = 0, ptrU = bins;
        if (t === 0) { bestV = bestU = -Math.log(states); }
        else for (let source = Math.max(0, dest - (width - 1 - radius)); source <= Math.min(bins - 1, dest + radius); source += 1) {
          const local = logKernel[dest - source + radius] - rowNorm[source];
          const v = previous[source] + local, u = previous[bins + source] + local;
          if (v > bestV) { bestV = v; ptrV = source; }
          if (u > bestU) { bestU = u; ptrU = bins + source; }
        }
        const vFromV = bestV + (t ? stay : 0), vFromU = bestU + (t ? change : 0);
        const uFromV = bestV + (t ? change : 0), uFromU = bestU + (t ? stay : 0);
        current[dest] = Math.max(vFromV, vFromU) + (emission[dest] > 0 ? Math.log(emission[dest]) : tinyLog);
        current[bins + dest] = Math.max(uFromV, uFromU) + uv;
        back[t * states + dest] = vFromV >= vFromU ? ptrV : ptrU;
        back[t * states + bins + dest] = uFromV >= uFromU ? ptrV : ptrU;
      }
      [previous, current] = [current, previous];
    }
    let state = 0;
    for (let i = 1; i < states; i += 1) if (previous[i] > previous[state]) state = i;
    const output = new Array(count);
    for (let t = count - 1; t >= 0; t -= 1) {
      output[t] = state >= bins ? null : candidateFrames[t].candidates
        .filter(candidate => binAt(candidate.hz) === state).sort((a, b) => b.probability - a.probability)[0] || null;
      state = back[t * states + state];
    }
    return output;
  }

  function pyinFrame(frame, selected, index, timeSec, config) {
    const best = frame.candidates.reduce((current, item) => !current || item.probability > current.probability ? item : current, null);
    return { index, timeSec, rawHz: best?.hz ?? null, trackedHz: selected?.hz ?? null,
      rawMidi: hzToMidi(best?.hz), trackedMidi: hzToMidi(selected?.hz), rms: frame.rms,
      clarity: best ? 1 - best.cmnd : null, confidence: null, voicedProbability: frame.voicedProbability,
      candidateCount: frame.candidates.length, candidates: frame.candidates.map(({ hz, probability, cmnd }) => ({ hz, probability, cmnd })),
      frameVoiced: frame.voicedProbability >= .5, decoderVoiced: Boolean(selected),
      voicingGatePassed: frame.voicedProbability >= config.minVoicedProbability,
      rejectionReason: selected ? null : !best ? 'pyin-no-candidate' : frame.voicedProbability < config.minVoicedProbability ? 'pyin-voicing-gate'
        : frame.voicedProbability < .5 ? 'pyin-low-voicing' : 'pyin-decoder-unvoiced',
      octaveAlternateHz: octaveAlternate(frame.candidates, selected?.hz ?? best?.hz) };
  }

  function targetAt(targets, timeSec) {
    if (!targets?.length) return null;
    let low = 0, high = targets.length;
    while (low < high) { const middle = (low + high) >>> 1; if (targets[middle].startSec <= timeSec) low = middle + 1; else high = middle; }
    const target = targets[Math.max(0, low - 1)];
    return target && timeSec >= target.startSec && timeSec < target.endSec ? target : null;
  }

  function finishResult(algorithmId, config, originalRate, analysisRate, audio, frames, processingMs, metadata = {}) {
    const result = { schemaVersion: SCHEMA_VERSION, algorithmId, algorithmVersion: ALGORITHM_VERSION,
      configHash: configHash(config), audioHash: metadata.audioHash || audioFingerprint(audio, analysisRate),
      sampleRate: originalRate, analysisSampleRate: analysisRate, frameLength: config.frameLength,
      hopLength: config.hopLength, durationSec: metadata.durationSec || audio.length / analysisRate,
      processingMs, config: { ...config }, frames,
      computation: { timingMeasurement: 'wall-clock', includesDecode: false, includesRendering: false,
        frameDurationMs: 1000 * config.frameLength / analysisRate, hopDurationMs: 1000 * config.hopLength / analysisRate,
        timestampAnchor: 'frame-center', liveLatencyMs: null,
        estimatedDecoderBackpointerBytes: algorithmId === 'pyin-offline' && config.decoder === 'normalized-grid'
          ? frames.length * 2 * (Math.floor(12 * Math.ceil(1 / config.resolution) * Math.log2(config.fmax / config.fmin)) + 1) * 4 : null } };
    result.metrics = metrics(result, metadata.targets || [], config);
    return result;
  }

  function analyzeYin(sourceAudio, sourceRate, inputConfig = {}, hooks = {}) {
    const config = validateConfig({ ...inputConfig, algorithm: 'yin' }); const started = performance.now();
    const audio = resampleLinear(sourceAudio, sourceRate, config.analysisSampleRate);
    const tracker = new ConfigurableTracker(config); const frames = [];
    const frameCount = Math.max(0, Math.floor((audio.length - config.frameLength) / config.hopLength) + 1);
    for (let frameIndex = 0, start = 0; start + config.frameLength <= audio.length; frameIndex += 1, start += config.hopLength) {
      if (hooks.cancelled?.()) throw new Error('Analisi interrotta');
      const estimate = yinEstimate(audio, start, config.analysisSampleRate, config, true);
      const tracked = config.tracking ? tracker.update(estimate) : { trackedHz: estimate.rawHz, accepted: estimate.rawHz != null, rejectionReason: estimate.rawHz == null ? 'unvoiced' : null };
      const timeSec = (start + config.frameLength / 2) / config.analysisSampleRate;
      frames.push({ index: frameIndex, timeSec, rawHz: estimate.rawHz, trackedHz: tracked.trackedHz,
        rawMidi: hzToMidi(estimate.rawHz), trackedMidi: hzToMidi(tracked.trackedHz), rms: estimate.rms,
        clarity: estimate.clarity, confidence: estimate.confidence, voicedProbability: null,
        rejectionReason: tracked.rejectionReason, octaveAlternateHz: estimate.octaveAlternateHz });
      if (frameIndex % 20 === 0) hooks.progress?.(frameIndex / Math.max(1, frameCount), 'yin');
    }
    hooks.progress?.(1, 'yin');
    return finishResult('yin-offline', config, sourceRate, config.analysisSampleRate, audio, frames, performance.now() - started, hooks.metadata);
  }

  function analyzePyin(sourceAudio, sourceRate, inputConfig = {}, hooks = {}) {
    const config = validateConfig({ ...inputConfig, algorithm: 'pyin' }); const started = performance.now();
    const audio = resampleLinear(sourceAudio, sourceRate, config.analysisSampleRate); const betaMasses = thresholdMasses(config);
    const candidateFrames = []; const frameCount = Math.max(0, Math.floor((audio.length - config.frameLength) / config.hopLength) + 1);
    for (let frameIndex = 0, start = 0; start + config.frameLength <= audio.length; frameIndex += 1, start += config.hopLength) {
      if (hooks.cancelled?.()) throw new Error('Analisi interrotta');
      candidateFrames.push(pyinCandidates(audio, start, config.analysisSampleRate, config, betaMasses));
      if (frameIndex % 20 === 0) hooks.progress?.(.82 * frameIndex / Math.max(1, frameCount), 'pyin-candidates');
    }
    hooks.progress?.(.84, 'pyin-viterbi');
    const path = decodePyin(candidateFrames, config, config.analysisSampleRate);
    const frames = candidateFrames.map((frame, index) => pyinFrame(frame, path[index], index,
      (index * config.hopLength + config.frameLength / 2) / config.analysisSampleRate, config));
    hooks.progress?.(1, 'pyin');
    return finishResult('pyin-offline', config, sourceRate, config.analysisSampleRate, audio, frames, performance.now() - started, hooks.metadata);
  }

  const SHARED_CMND_KEYS = ['analysisSampleRate', 'frameLength', 'hopLength', 'fmin', 'fmax', 'removeDc'];

  function assertSharedCmndShape(configs) {
    const reference = configs[0];
    for (const config of configs.slice(1)) for (const key of SHARED_CMND_KEYS) {
      if (config[key] !== reference[key]) throw new Error(`Lo sweep non può riusare CMND quando cambia ${key}`);
    }
  }

  function prepareCmndFrames(sourceAudio, sourceRate, config, hooks = {}) {
    const audio = resampleLinear(sourceAudio, sourceRate, config.analysisSampleRate); const frames = [];
    const frameCount = Math.max(0, Math.floor((audio.length - config.frameLength) / config.hopLength) + 1);
    for (let index = 0, start = 0; start + config.frameLength <= audio.length; index += 1, start += config.hopLength) {
      if (hooks.cancelled?.()) throw new Error('Analisi interrotta');
      frames.push({ index, start, timeSec: (start + config.frameLength / 2) / config.analysisSampleRate,
        rms: frameRms(audio, start, config.frameLength),
        analysis: cmndFrame(audio, start, config.frameLength, config.analysisSampleRate, config) });
      if (index % 20 === 0) hooks.progress?.(.65 * index / Math.max(1, frameCount), 'shared-cmnd');
    }
    return { audio, frames };
  }

  function yinFramesFromPrepared(prepared, config, hooks = {}) {
    const tracker = new ConfigurableTracker(config); const frames = [];
    for (const preparedFrame of prepared.frames) {
      if (hooks.cancelled?.()) throw new Error('Analisi interrotta');
      const estimate = yinEstimateFromCmnd(preparedFrame.rms, preparedFrame.analysis,
        config.analysisSampleRate, config, true);
      const tracked = config.tracking
        ? tracker.update(estimate)
        : { trackedHz: estimate.rawHz, accepted: estimate.rawHz != null,
          rejectionReason: estimate.rawHz == null ? 'unvoiced' : null };
      frames.push({ index: preparedFrame.index, timeSec: preparedFrame.timeSec,
        rawHz: estimate.rawHz, trackedHz: tracked.trackedHz,
        rawMidi: hzToMidi(estimate.rawHz), trackedMidi: hzToMidi(tracked.trackedHz), rms: estimate.rms,
        clarity: estimate.clarity, confidence: estimate.confidence, voicedProbability: null,
        rejectionReason: tracked.rejectionReason, octaveAlternateHz: estimate.octaveAlternateHz });
    }
    return frames;
  }

  function pyinFramesFromPrepared(prepared, config, hooks = {}) {
    const betaMasses = thresholdMasses(config); const candidateFrames = [];
    for (const preparedFrame of prepared.frames) {
      if (hooks.cancelled?.()) throw new Error('Analisi interrotta');
      candidateFrames.push(pyinCandidatesFromCmnd(preparedFrame.rms, preparedFrame.analysis,
        config.analysisSampleRate, config, betaMasses));
    }
    const path = decodePyin(candidateFrames, config, config.analysisSampleRate);
    return candidateFrames.map((frame, index) => pyinFrame(frame, path[index], index, prepared.frames[index].timeSec, config));
  }

  function analyzeBatch(sourceAudio, sourceRate, inputConfigs, hooks = {}) {
    if (!Array.isArray(inputConfigs) || !inputConfigs.length || inputConfigs.length > 6) {
      throw new Error('Il batch richiede da 1 a 6 configurazioni');
    }
    const configs = inputConfigs.map(config => validateConfig(config)); assertSharedCmndShape(configs);
    const batchStarted = performance.now(); const sharedStarted = performance.now();
    const prepared = prepareCmndFrames(sourceAudio, sourceRate, configs[0], hooks);
    const sharedPreprocessingMs = performance.now() - sharedStarted; const results = [];
    for (let index = 0; index < configs.length; index += 1) {
      const config = configs[index]; const exclusiveStarted = performance.now();
      const frames = config.algorithm === 'pyin'
        ? pyinFramesFromPrepared(prepared, config, hooks)
        : yinFramesFromPrepared(prepared, config, hooks);
      const exclusiveProcessingMs = performance.now() - exclusiveStarted;
      const processingMs = exclusiveProcessingMs + sharedPreprocessingMs / configs.length;
      const result = finishResult(config.algorithm === 'pyin' ? 'pyin-offline' : 'yin-offline', config,
        sourceRate, config.analysisSampleRate, prepared.audio, frames, processingMs, hooks.metadata);
      result.performance = { sharedPreprocessingMs, exclusiveProcessingMs, amortizedProcessingMs: processingMs,
        batchConfigurationCount: configs.length, cmndFrameCount: prepared.frames.length };
      results.push(result);
      hooks.progress?.(.65 + .34 * (index + 1) / configs.length, config.algorithm === 'pyin' ? 'pyin-batch' : 'yin-batch');
    }
    const batchProcessingMs = performance.now() - batchStarted;
    results.forEach(result => { result.performance.batchProcessingMs = batchProcessingMs; });
    hooks.progress?.(1, 'batch');
    return { results, performance: { batchProcessingMs, sharedPreprocessingMs,
      configurationCount: configs.length, cmndFrameCount: prepared.frames.length } };
  }

  function gaps(frames, key, hopSec) {
    const output = []; let start = null;
    for (let index = 0; index <= frames.length; index += 1) {
      const absent = index < frames.length && !Number.isFinite(frames[index][key]);
      if (absent && start == null) start = index;
      if (!absent && start != null) { output.push({ startSec: frames[start].timeSec, endSec: (frames[index - 1]?.timeSec || 0) + hopSec,
        durationSec: (index - start) * hopSec }); start = null; }
    }
    return output;
  }

  function metrics(result, targets = [], config = result.config || DEFAULTS, acousticTruth = null) {
    const frames = result.frames || []; const hopSec = result.hopLength / result.analysisSampleRate;
    const detected = frames.filter(frame => Number.isFinite(frame.trackedHz)); const raw = frames.filter(frame => Number.isFinite(frame.rawHz));
    const rejectionReasons = {};
    frames.forEach(frame => { if (frame.rejectionReason) rejectionReasons[frame.rejectionReason] = (rejectionReasons[frame.rejectionReason] || 0) + 1; });
    let discontinuities = 0, octaveCandidates = 0;
    for (let index = 1; index < detected.length; index += 1) {
      const delta = Math.abs(centsBetween(detected[index].trackedHz, detected[index - 1].trackedHz));
      if (detected[index].timeSec - detected[index - 1].timeSec <= hopSec * 2.5 && delta > config.discontinuityCents) discontinuities += 1;
      if (Math.abs(delta - 1200) <= 100) octaveCandidates += 1;
    }
    const targetErrors = []; let evaluableFrames = 0;
    for (const frame of frames) {
      const target = targetAt(targets, frame.timeSec);
      if (!target) continue;
      if (Number.isFinite(frame.trackedHz)) { evaluableFrames += 1; targetErrors.push(centsBetween(frame.trackedHz, midiToHz(target.midi))); }
    }
    const absolute = targetErrors.map(Math.abs).sort((a, b) => a - b);
    const dropoutGaps = gaps(frames, 'trackedHz', hopSec);
    const resultMetrics = { audioDurationSec: result.durationSec, processingMs: result.processingMs,
      processingMsPerFrame: frames.length ? result.processingMs / frames.length : null,
      realtimeFactor: result.durationSec ? result.processingMs / 1000 / result.durationSec : null,
      frameRate: result.hopLength ? result.analysisSampleRate / result.hopLength : null,
      frameCount: frames.length, rawDetectedPercent: frames.length ? raw.length / frames.length * 100 : 0,
      detectedPercent: frames.length ? detected.length / frames.length * 100 : 0,
      gaps: dropoutGaps, gapDurationSec: dropoutGaps.reduce((sum, gap) => sum + gap.durationSec, 0),
      gapMedianSec: quantile(dropoutGaps.map(gap => gap.durationSec), .5),
      gapP95Sec: quantile(dropoutGaps.map(gap => gap.durationSec), .95),
      rejectionReasons, discontinuities, possibleOctaveJumps: octaveCandidates,
      diagnostics: { noCandidateFrames: frames.filter(frame => frame.candidateCount === 0).length,
        candidateRejectedFrames: frames.filter(frame => frame.candidateCount > 0 && !frame.decoderVoiced).length,
        highProbabilityRejectedFrames: frames.filter(frame => frame.candidateCount > 0 && frame.frameVoiced && !frame.decoderVoiced).length },
      targetEvaluableSec: evaluableFrames * hopSec, targetEvaluablePercent: frames.length ? evaluableFrames / frames.length * 100 : 0,
      targetMedianAbsoluteCents: absolute.length ? absolute[Math.floor(absolute.length / 2)] : null,
      conditionalIntonationPercent: targetErrors.length ? targetErrors.filter(value => Math.abs(value) <= 30).length / targetErrors.length * 100 : null,
      acousticAccuracy: null, scientificNote: 'Le distanze dalla partitura misurano aderenza musicale, non accuratezza acustica della F0.' };
    if (Array.isArray(acousticTruth) && acousticTruth.length) resultMetrics.acousticAccuracy = acousticMetrics(frames, acousticTruth, hopSec);
    return resultMetrics;
  }

  function quantile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q;
    const lower = Math.floor(index), fraction = index - lower;
    return sorted[lower] * (1 - fraction) + sorted[Math.ceil(index)] * fraction;
  }

  // An omitted interval is unknown, never implicit silence. Voicing-only
  // annotations use {voiced:true}; hz:null explicitly labels unvoiced audio.
  function normalizeTruth(input) {
    if (!Array.isArray(input)) throw new Error('Riferimento acustico non valido');
    const output = input.map(item => {
      const startSec = Number(item.startSec), endSec = Number(item.endSec);
      if (!Number.isFinite(startSec) || startSec < 0 || !Number.isFinite(endSec) || endSec <= startSec) throw new Error('Intervallo acustico non valido');
      const hasHz = Object.prototype.hasOwnProperty.call(item, 'hz');
      const hz = item.hz == null ? null : Number(item.hz);
      if ((!hasHz && typeof item.voiced !== 'boolean') || (hz != null && (!Number.isFinite(hz) || hz <= 0))
        || (hz > 0 && item.voiced === false) || (hasHz && hz == null && item.voiced === true)) throw new Error('Voicing/F0 di riferimento non valido');
      return { ...item, startSec, endSec, ...(hasHz ? { hz } : {}), voiced: hz > 0 || (!hasHz && item.voiced === true) };
    }).sort((a, b) => a.startSec - b.startSec);
    for (let i = 1; i < output.length; i += 1) if (output[i].startSec < output[i - 1].endSec) throw new Error('Intervalli acustici sovrapposti');
    return output;
  }

  function acousticMetrics(frames, truth, hopSec) {
    const intervals = normalizeTruth(truth);
    const segmentOf = new Map(); let segmentIndex = -1, previousInterval = null;
    for (const interval of intervals) {
      if (interval.voiced) {
        if (!previousInterval?.voiced || Math.abs(interval.startSec - previousInterval.endSec) > 1e-8) segmentIndex += 1;
        segmentOf.set(interval, segmentIndex);
      }
      previousInterval = interval;
    }
    let voicedTruth = 0, unvoicedTruth = 0, voicedDetected = 0, falseAlarm = 0, pitchTruth = 0;
    let correct30 = 0, correct50 = 0, chroma = 0, octave = 0, gross = 0, evaluated = 0;
    const errors = [], missed = [], coveredSegments = new Map();
    for (const frame of frames) {
      const reference = targetAt(intervals, frame.timeSec), actual = finite(frame.trackedHz);
      if (!reference) { missed.push({ ...frame, missed: 1 }); continue; }
      evaluated += 1;
      if (reference.voiced) {
        voicedTruth += 1;
        const present = actual > 0;
        const segment = segmentOf.get(reference), coverage = coveredSegments.get(segment) || { total: 0, detected: 0 };
        coverage.total += 1; coverage.detected += present ? 1 : 0; coveredSegments.set(segment, coverage);
        if (present) voicedDetected += 1;
        missed.push({ timeSec: frame.timeSec, missed: present ? 1 : null });
        if (reference.hz > 0) {
          pitchTruth += 1;
          if (present) {
            const error = Math.abs(centsBetween(actual, reference.hz)); errors.push(error);
            if (error <= 30) correct30 += 1; if (error <= 50) correct50 += 1;
            if (Math.min(error % 1200, 1200 - error % 1200) <= 50) chroma += 1;
            if (error > 200) gross += 1;
            if (Math.round(error / 1200) >= 1 && Math.abs(error - 1200 * Math.round(error / 1200)) <= 100) octave += 1;
          }
        }
      } else {
        unvoicedTruth += 1; if (actual > 0) falseAlarm += 1;
        missed.push({ timeSec: frame.timeSec, missed: 1 });
      }
    }
    const precision = voicedDetected + falseAlarm ? voicedDetected / (voicedDetected + falseAlarm) : null;
    const recall = voicedTruth ? voicedDetected / voicedTruth : null;
    const f1 = voicedTruth ? 2 * voicedDetected / (2 * voicedDetected + falseAlarm + voicedTruth - voicedDetected) : null;
    const dropout = gaps(missed, 'missed', hopSec);
    const segmentValues = [...coveredSegments.values()];
    return { rawPitchAccuracy30: pitchTruth ? correct30 / pitchTruth : null, rawPitchAccuracy50: pitchTruth ? correct50 / pitchTruth : null,
      rawChromaAccuracy50: pitchTruth ? chroma / pitchTruth : null, voicingRecall: recall, voicingPrecision: precision, voicingF1: f1,
      voicingFalseAlarmRate: unvoicedTruth ? falseAlarm / unvoicedTruth : null,
      truePositiveFrames: voicedDetected, falsePositiveFrames: falseAlarm, falseNegativeFrames: voicedTruth - voicedDetected,
      voicedReferenceFrames: voicedTruth, unvoicedReferenceFrames: unvoicedTruth, pitchReferenceFrames: pitchTruth,
      pitchDetectedFrames: errors.length,
      octaveErrorRate: errors.length ? octave / errors.length : null, grossPitchErrorRate: errors.length ? gross / errors.length : null,
      maeCents: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
      medianAbsoluteCents: quantile(errors, .5), p90AbsoluteCents: quantile(errors, .9), p95AbsoluteCents: quantile(errors, .95),
      lostVoicedSegmentPercent: segmentValues.length ? 100 * segmentValues.filter(segment => !segment.detected).length / segmentValues.length : null,
      evaluatedVoicedSegmentCount: segmentValues.length,
      dropoutCount: dropout.length, dropoutDurationSec: dropout.reduce((sum, gap) => sum + gap.durationSec, 0),
      dropoutMedianSec: quantile(dropout.map(gap => gap.durationSec), .5), dropoutP95Sec: quantile(dropout.map(gap => gap.durationSec), .95), dropout,
      overallAccuracy30: pitchTruth + unvoicedTruth ? (correct30 + unvoicedTruth - falseAlarm) / (pitchTruth + unvoicedTruth) : null,
      evaluatedFrames: evaluated, unknownFrames: frames.length - evaluated, evaluatedSec: evaluated * hopSec,
      referenceCoveragePercent: frames.length ? 100 * evaluated / frames.length : 0 };
  }

  // Small deterministic hierarchical search: diagnose the decoder first,
  // then threshold prior/switching. No score/target enters this objective.
  function tuningConfigs(input) {
    const base = validateConfig(input);
    const changes = base.algorithm === 'pyin'
      ? [{ decoder: 'legacy-sparse', minVoicedProbability: 0 }, { decoder: 'normalized-grid', minVoicedProbability: 0 },
        { decoder: 'normalized-grid', minVoicedProbability: .05 },
        { decoder: 'normalized-grid', minVoicedProbability: .1 },
        { decoder: 'normalized-grid', minVoicedProbability: .05, betaAlpha: 2, betaBeta: 12 },
        { decoder: 'normalized-grid', minVoicedProbability: .05, switchProb: .03 }]
      : [{}, { minClarity: .32, minConfidence: .1 }, { minConfidence: .2 },
        { yinThreshold: .3 }, { yinThreshold: .55 }, { warmupFrames: 1, largeJumpConfirmFrames: 1 }];
    return changes.map(change => validateConfig({ ...base, ...change }));
  }

  const TUNING_OBJECTIVE = Object.freeze({ version: 1, voicingF1: .45, rawPitchAccuracy50: .4,
    grossPitchErrorRate: -.1, octaveErrorRate: -.05, realtimeFactor: -.02, realtimeFactorBucket: .1, maxRealtimeFactor: 1 });

  function evaluateObjective(metric) {
    const acoustic = metric.acousticAccuracy;
    const referenced = Boolean(acoustic?.voicedReferenceFrames && acoustic?.unvoicedReferenceFrames && acoustic?.pitchReferenceFrames);
    const quality = referenced ? .45 * acoustic.voicingF1 + .4 * acoustic.rawPitchAccuracy50
      - .1 * (acoustic.grossPitchErrorRate ?? 0) - .05 * (acoustic.octaveErrorRate ?? 0) : null;
    const costPenalty = .02 * Math.min(Math.round((metric.realtimeFactor || 0) * 10) / 10, 1);
    return { quality, costPenalty, objective: referenced ? quality - costPenalty : null,
      eligible: referenced && metric.realtimeFactor <= 1 };
  }

  function rankExperiments(results, truth = []) {
    const reference = normalizeTruth(truth);
    const evaluations = results.map((result, index) => {
      const metric = metrics(result, [], result.config, reference);
      // Recall alone cannot select a configuration: explicit negative examples
      // and independent pitch references must both be present.
      // Coarse 0.1× RTF buckets avoid selecting among equivalent parameters
      // because of sub-millisecond timer/JIT noise. Preserve search order on ties.
      return { index, config: result.config, configHash: result.configHash, metrics: metric,
        ...evaluateObjective(metric) };
    });
    const ranked = evaluations.filter(item => item.eligible).sort((a, b) => b.objective - a.objective);
    return { status: ranked.length ? 'in-sample-only' : 'diagnostic-only', objectiveDefinition: TUNING_OBJECTIVE,
      selectedIndex: ranked[0]?.index ?? null, evaluations,
      note: ranked.length ? 'Candidato sul riferimento caricato; richiede verifica su registrazioni escluse dal tuning.'
        : 'Nessun vincitore: servono intervalli voiced, unvoiced e F0 indipendente. La copertura non misura accuratezza.' };
  }

  function falseNegativeSegments(liveFrames, resultFrames, options = {}) {
    const toleranceSec = options.toleranceSec || .05; const minimumCents = options.disagreementCents || 100;
    const live = [...(liveFrames || [])].sort((a, b) => a.timeSec - b.timeSec); const segments = [];
    let current = null;
    for (const frame of resultFrames || []) {
      let nearest = null; let distance = Infinity;
      for (const item of live) { const next = Math.abs(item.timeSec - frame.timeSec); if (next < distance) { nearest = item; distance = next; } if (item.timeSec > frame.timeSec + toleranceSec) break; }
      const recovered = Number.isFinite(frame.trackedHz) && (!nearest || distance > toleranceSec || !Number.isFinite(nearest.trackedHz));
      const disagreement = Number.isFinite(frame.trackedHz) && Number.isFinite(nearest?.trackedHz)
        && Math.abs(centsBetween(frame.trackedHz, nearest.trackedHz)) >= minimumCents;
      if (recovered || disagreement) {
        const kind = recovered ? 'offline-f0-live-gap' : 'detector-disagreement';
        if (!current || current.kind !== kind || frame.timeSec - current.endSec > .12) {
          current = { kind, startSec: frame.timeSec, endSec: frame.timeSec, frameCount: 1 }; segments.push(current);
        } else { current.endSec = frame.timeSec; current.frameCount += 1; }
      }
    }
    return segments;
  }

  const api = Object.freeze({ SCHEMA_VERSION, ALGORITHM_VERSION, DEFAULTS, PRESETS, preset, validateConfig,
    stableStringify, configHash, audioFingerprint, resampleLinear, hzToMidi, midiToHz, centsBetween,
    yinEstimate, analyzeYin, analyzePyin, analyzeBatch, metrics, acousticMetrics, normalizeTruth,
    tuningConfigs, rankExperiments, evaluateObjective, TUNING_OBJECTIVE, decodePyin, falseNegativeSegments, regularizedBeta });
  global.PitchLabCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
