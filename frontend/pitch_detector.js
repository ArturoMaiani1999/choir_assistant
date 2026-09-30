// Browser-local pitch detector module.
// The public API is deliberately independent from the page so it can later
// move behind an AudioWorklet/WASM adapter without changing scoring code.
(function exposeChoirPitch(global) {
  const MIN_HZ = 70;
  const MAX_HZ = 1000;
  // Laptop microphones and untreated rooms rarely produce the nearly-perfect
  // periodic waveform assumed by the original threshold.
  const YIN_THRESHOLD = 0.42;

  function rmsOf(buffer) {
    let sum = 0;
    for (const sample of buffer) sum += sample * sample;
    return Math.sqrt(sum / buffer.length);
  }

  function centsBetween(actualHz, targetHz) {
    return 1200 * Math.log2(actualHz / targetHz);
  }

  function semitoneIndex(hz) {
    return 12 * Math.log2(hz / 440);
  }

  function hzFromSemitone(index) {
    return 440 * Math.pow(2, index / 12);
  }

  // YIN-style difference and cumulative mean normalized difference.
  function detectPitch(buffer, sampleRate, { rmsThreshold = 0.001, yinThreshold = YIN_THRESHOLD } = {}) {
    const rms = rmsOf(buffer);
    const effectiveRmsThreshold = Number.isFinite(rmsThreshold) ? Math.max(0, rmsThreshold) : 0.001;
    if (rms < effectiveRmsThreshold) return { hz: null, rms, clarity: 0, confidence: 0 };

    let mean = 0;
    for (const sample of buffer) mean += sample;
    mean /= buffer.length;

    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
    const tauMax = Math.min(
      Math.floor(sampleRate / MIN_HZ),
      Math.floor(buffer.length / 2) - 1,
    );
    if (tauMin >= tauMax) return { hz: null, rms, clarity: 0, confidence: 0 };

    const difference = new Float64Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau += 1) {
      let sum = 0;
      for (let i = 0; i < buffer.length - tau; i += 1) {
        const delta = (buffer[i] - mean) - (buffer[i + tau] - mean);
        sum += delta * delta;
      }
      difference[tau] = sum;
    }

    const cmnd = new Float64Array(tauMax + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      running += difference[tau];
      cmnd[tau] = running === 0 ? 1 : difference[tau] * tau / running;
    }

    let tauEstimate = -1;
    const effectiveYinThreshold = Number.isFinite(yinThreshold) ? Math.max(.05, Math.min(.8, yinThreshold)) : YIN_THRESHOLD;
    for (let tau = tauMin; tau < tauMax; tau += 1) {
      if (cmnd[tau] < effectiveYinThreshold) {
        while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau += 1;
        tauEstimate = tau;
        break;
      }
    }
    if (tauEstimate < 0) return { hz: null, rms, clarity: 0, confidence: 0 };

    const left = cmnd[tauEstimate - 1] ?? cmnd[tauEstimate];
    const center = cmnd[tauEstimate];
    const right = cmnd[tauEstimate + 1] ?? center;
    const denominator = 2 * (2 * center - left - right);
    const refinedTau = denominator === 0
      ? tauEstimate
      : tauEstimate + (right - left) / denominator;
    const hz = sampleRate / refinedTau;
    if (!Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ) {
      return { hz: null, rms, clarity: 0, confidence: 0 };
    }

    const clarity = Math.max(0, Math.min(1, 1 - center));
    // Preserve the frozen v1 behaviour at the default threshold. When the
    // singer deliberately selects a more sensitive gate, allow a strongly
    // periodic whisper-level signal to reach the tracker instead of rejecting
    // it a second time solely because of absolute amplitude.
    const sensitivityConfidenceFloor = effectiveRmsThreshold < 0.001 ? 0.36 : 0;
    const levelConfidence = Math.max(sensitivityConfidenceFloor, Math.max(0, Math.min(1, rms / 0.08)));
    return {
      hz,
      rms,
      clarity,
      confidence: clarity * levelConfidence,
    };
  }

  function refinedTauAt(cmnd, tau) {
    const left = cmnd[tau - 1] ?? cmnd[tau];
    const center = cmnd[tau];
    const right = cmnd[tau + 1] ?? center;
    const denominator = 2 * (2 * center - left - right);
    return denominator === 0 ? tau : tau + (right - left) / denominator;
  }

  // Keeps multiple local CMND minima instead of discarding every candidate
  // after the first threshold crossing. A temporal decoder can then decide
  // between fundamental and harmonic hypotheses across the entire take.
  function yinCandidates(buffer, sampleRate, { maxCandidates = 6, threshold = 0.72 } = {}) {
    const rms = rmsOf(buffer);
    if (rms < 0.001) return { rms, candidates: [] };
    let mean = 0;
    for (const sample of buffer) mean += sample;
    mean /= buffer.length;
    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
    const tauMax = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(buffer.length / 2) - 1);
    if (tauMin >= tauMax) return { rms, candidates: [] };
    const difference = new Float64Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau += 1) {
      let sum = 0;
      for (let index = 0; index < buffer.length - tau; index += 1) {
        const delta = (buffer[index] - mean) - (buffer[index + tau] - mean);
        sum += delta * delta;
      }
      difference[tau] = sum;
    }
    const cmnd = new Float64Array(tauMax + 1); cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau += 1) {
      running += difference[tau];
      cmnd[tau] = running === 0 ? 1 : difference[tau] * tau / running;
    }
    const minima = [];
    for (let tau = tauMin + 1; tau < tauMax - 1; tau += 1) {
      if (cmnd[tau] <= threshold && cmnd[tau] <= cmnd[tau - 1] && cmnd[tau] < cmnd[tau + 1]) minima.push(tau);
    }
    if (!minima.length) {
      let bestTau = tauMin;
      for (let tau = tauMin + 1; tau < tauMax; tau += 1) if (cmnd[tau] < cmnd[bestTau]) bestTau = tau;
      minima.push(bestTau);
    }
    const candidates = minima.map((tau) => {
      const refinedTau = refinedTauAt(cmnd, tau);
      const hz = sampleRate / refinedTau;
      return { hz, cmnd: cmnd[tau], clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
    }).filter((candidate) => Number.isFinite(candidate.hz) && candidate.hz >= MIN_HZ && candidate.hz <= MAX_HZ)
      .sort((left, right) => left.cmnd - right.cmnd).slice(0, maxCandidates);
    return { rms, candidates };
  }

  // Offline Viterbi-style decoder. The observation term favours periodicity;
  // the transition term favours a musically plausible continuous path, without
  // ever using score targets.
  function decodeYinCandidatePath(candidateFrames, {
    transitionWeight = 0.085,
    octaveTransitionPenalty = 0.48,
    voicedStartPenalty = 0.22,
    unvoicedCost = 0.72,
  } = {}) {
    if (!candidateFrames.length) return [];
    const states = candidateFrames.map((frame) => [
      ...frame.candidates.map((candidate) => ({ ...candidate, unvoiced: false, observationCost: candidate.cmnd })),
      { hz: null, cmnd: 1, clarity: 0, unvoiced: true, observationCost: frame.candidates.length ? unvoicedCost + .25 : unvoicedCost },
    ]);
    let previousCosts = states[0].map((state) => state.observationCost + (state.unvoiced ? 0 : voicedStartPenalty));
    const backPointers = [states[0].map(() => -1)];
    for (let index = 1; index < states.length; index += 1) {
      const currentCosts = []; const currentBackPointers = [];
      for (const current of states[index]) {
        let bestCost = Infinity, bestIndex = -1;
        for (let previousIndex = 0; previousIndex < states[index - 1].length; previousIndex += 1) {
          const previous = states[index - 1][previousIndex];
          let transitionCost;
          if (previous.unvoiced && current.unvoiced) transitionCost = .02;
          else if (previous.unvoiced || current.unvoiced) transitionCost = voicedStartPenalty;
          else {
            const distance = Math.abs(centsBetween(current.hz, previous.hz)) / 100;
            transitionCost = transitionWeight * Math.min(distance, 9);
            if (Math.abs(distance - 12) <= 2) transitionCost += octaveTransitionPenalty;
          }
          const total = previousCosts[previousIndex] + current.observationCost + transitionCost;
          if (total < bestCost) { bestCost = total; bestIndex = previousIndex; }
        }
        currentCosts.push(bestCost); currentBackPointers.push(bestIndex);
      }
      previousCosts = currentCosts; backPointers.push(currentBackPointers);
    }
    let bestIndex = previousCosts.reduce((best, cost, index) => cost < previousCosts[best] ? index : best, 0);
    const path = new Array(states.length);
    for (let index = states.length - 1; index >= 0; index -= 1) {
      path[index] = states[index][bestIndex];
      bestIndex = backPointers[index][bestIndex];
    }
    return path;
  }

  // McLeod Pitch Method (NSDF) candidate extraction. This is intentionally a
  // separate acoustic estimator from YIN: no CMND threshold or YIN candidate
  // path is reused here.
  function mpmCandidates(buffer, sampleRate, { maxCandidates = 3, minClarity = 0.78 } = {}) {
    const rms = rmsOf(buffer);
    if (rms < 0.001) return { rms, candidates: [] };
    let mean = 0;
    for (const sample of buffer) mean += sample;
    mean /= buffer.length;
    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
    const tauMax = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(buffer.length / 2) - 1);
    if (tauMin >= tauMax) return { rms, candidates: [] };
    const nsdf = new Float64Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau += 1) {
      let numerator = 0, firstEnergy = 0, secondEnergy = 0;
      for (let index = 0; index < buffer.length - tau; index += 1) {
        const first = buffer[index] - mean, second = buffer[index + tau] - mean;
        numerator += first * second; firstEnergy += first * first; secondEnergy += second * second;
      }
      nsdf[tau] = firstEnergy + secondEnergy === 0 ? 0 : 2 * numerator / (firstEnergy + secondEnergy);
    }
    const peaks = [];
    for (let tau = tauMin + 1; tau < tauMax - 1; tau += 1) {
      if (nsdf[tau] >= minClarity && nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) peaks.push(tau);
    }
    const candidates = peaks.map((tau) => {
      const left = nsdf[tau - 1], center = nsdf[tau], right = nsdf[tau + 1];
      const denominator = 2 * (2 * center - left - right);
      const refinedTau = denominator === 0 ? tau : tau + (right - left) / denominator;
      return { hz: sampleRate / refinedTau, clarity: center };
    }).filter((candidate) => Number.isFinite(candidate.hz) && candidate.hz >= MIN_HZ && candidate.hz <= MAX_HZ)
      .sort((left, right) => right.clarity - left.clarity).slice(0, maxCandidates);
    return { rms, candidates };
  }

  // CREPE exposes 360 independent sigmoid activations (not a softmax).  For
  // an offline benchmark we turn the strongest local neighbourhood into an F0
  // estimate, while retaining the peak activation as a voicing confidence.
  // Keeping this decoder here makes its numerical contract testable without
  // loading an ONNX runtime in the live practice page.
  function decodeCrepeProbabilities(probabilities, { minConfidence = 0.55, neighbourhood = 4 } = {}) {
    if (!probabilities?.length) return { hz: null, confidence: 0, cents: null, bin: null };
    let peak = 0;
    for (let index = 1; index < probabilities.length; index += 1) {
      if (probabilities[index] > probabilities[peak]) peak = index;
    }
    const confidence = Number(probabilities[peak]) || 0;
    if (confidence < minConfidence) return { hz: null, confidence, cents: null, bin: peak };
    let weightedBin = 0, weight = 0;
    const start = Math.max(0, peak - neighbourhood), end = Math.min(probabilities.length - 1, peak + neighbourhood);
    for (let index = start; index <= end; index += 1) {
      const activation = Math.max(0, Number(probabilities[index]) || 0);
      weightedBin += index * activation;
      weight += activation;
    }
    const bin = weight > 0 ? weightedBin / weight : peak;
    const cents = 1997.3794084376191 + bin * (7180 / 359);
    const hz = 10 * Math.pow(2, cents / 1200);
    return { hz: Number.isFinite(hz) ? hz : null, confidence, cents, bin };
  }

  class PitchSmoother {
    constructor({
      releaseFrames = 3,
      fastAlpha = 0.65,
      slowAlpha = 0.3,
      minClarity = 0.45,
      minConfidence = 0.30,
      medianWindowFrames = 3,
      smallJumpCents = 300,
      octaveCenterCents = 1200,
      octaveToleranceCents = 180,
      octaveConfirmFrames = 5,
      largeJumpConfirmFrames = 3,
      candidateConsistencyCents = 100,
      weakSignalHoldFrames = 0,
    } = {}) {
      this.releaseFrames = releaseFrames;
      this.fastAlpha = fastAlpha;
      this.slowAlpha = slowAlpha;
      this.minClarity = minClarity;
      this.minConfidence = minConfidence;
      this.medianWindowFrames = medianWindowFrames;
      this.smallJumpCents = smallJumpCents;
      this.octaveCenterCents = octaveCenterCents;
      this.octaveToleranceCents = octaveToleranceCents;
      this.octaveConfirmFrames = octaveConfirmFrames;
      this.largeJumpConfirmFrames = largeJumpConfirmFrames;
      this.candidateConsistencyCents = candidateConsistencyCents;
      this.weakSignalHoldFrames = weakSignalHoldFrames;
      this.hz = null;
      this.voicedFrames = 0;
      this.unvoicedFrames = 0;
      this.lastTimestampMs = null;
      this.rawSemitones = [];
      this.candidateSemitone = null;
      this.candidateFrames = 0;
    }

    configure({ fastAlpha = this.fastAlpha, slowAlpha = this.slowAlpha, minClarity = this.minClarity,
      minConfidence = this.minConfidence, medianWindowFrames = this.medianWindowFrames,
      weakSignalHoldFrames = this.weakSignalHoldFrames } = {}) {
      const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
      if (Number.isFinite(fastAlpha)) this.fastAlpha = clamp(fastAlpha, .05, .95);
      if (Number.isFinite(slowAlpha)) this.slowAlpha = clamp(slowAlpha, .05, .95);
      if (Number.isFinite(minClarity)) this.minClarity = clamp(minClarity, .05, .95);
      if (Number.isFinite(minConfidence)) this.minConfidence = clamp(minConfidence, .05, .95);
      if (Number.isFinite(weakSignalHoldFrames)) this.weakSignalHoldFrames = Math.max(0, Math.min(4, Math.round(weakSignalHoldFrames)));
      if (Number.isFinite(medianWindowFrames)) {
        this.medianWindowFrames = Math.max(1, Math.min(9, Math.round(medianWindowFrames)));
        this.rawSemitones = this.rawSemitones.slice(-this.medianWindowFrames);
      }
    }

    reset() {
      this.hz = null;
      this.voicedFrames = 0;
      this.unvoicedFrames = 0;
      this.lastTimestampMs = null;
      this.rawSemitones = [];
      this.candidateSemitone = null;
      this.candidateFrames = 0;
    }

    update(estimate, timestampMs) {
      const rawHz = estimate.hz;
      const hasReliablePitch = rawHz != null
        && estimate.clarity >= this.minClarity
        && estimate.confidence >= this.minConfidence;
      if (!hasReliablePitch) {
        this.unvoicedFrames += 1;
        if (this.hz != null && this.unvoicedFrames <= this.weakSignalHoldFrames) {
          this.lastTimestampMs = timestampMs;
          return {
            ...estimate,
            hz: this.hz,
            displayHz: this.hz,
            rawHz,
            stable: true,
            accepted: true,
            rejectionReason: 'weak-signal-held',
            candidateFrames: this.candidateFrames,
            confidence: this.minConfidence,
          };
        }
        this.voicedFrames = 0;
        if (this.unvoicedFrames >= this.releaseFrames) this.hz = null;
        this.rawSemitones = [];
        this.candidateSemitone = null;
        this.candidateFrames = 0;
        this.lastTimestampMs = timestampMs;
        return {
          ...estimate,
          hz: this.hz,
          displayHz: this.hz,
          rawHz,
          stable: false,
          accepted: false,
          rejectionReason: rawHz == null ? 'unvoiced' : 'low-confidence',
          candidateFrames: 0,
          confidence: 0,
        };
      }

      this.unvoicedFrames = 0;
      this.voicedFrames += 1;
      const rawSemitone = semitoneIndex(rawHz);
      this.rawSemitones.push(rawSemitone);
      if (this.rawSemitones.length > this.medianWindowFrames) this.rawSemitones.shift();
      const filteredSemitone = this.medianSemitone();
      const previous = this.hz == null ? null : semitoneIndex(this.hz);
      let accepted = false;
      let rejectionReason = null;

      if (previous == null) {
        this.hz = hzFromSemitone(filteredSemitone);
        this.clearCandidate();
        accepted = this.voicedFrames >= 3;
        if (!accepted) rejectionReason = 'warm-up';
      } else {
        // Continuity decisions deliberately use the raw estimate. A three-frame
        // median would hide a single octave spike before the state machine saw
        // it, making the frame look trustworthy to scoring diagnostics.
        const deltaCents = (rawSemitone - previous) * 100;
        const isOctaveJump = Math.abs(Math.abs(deltaCents) - this.octaveCenterCents)
          <= this.octaveToleranceCents;
        if (Math.abs(deltaCents) <= this.smallJumpCents) {
          this.clearCandidate();
          this.hz = hzFromSemitone(this.smoothSemitone(previous, filteredSemitone));
          accepted = this.voicedFrames >= 3;
          if (!accepted) rejectionReason = 'warm-up';
        } else {
          this.updateCandidate(rawSemitone);
          const requiredFrames = isOctaveJump ? this.octaveConfirmFrames : this.largeJumpConfirmFrames;
          if (this.candidateFrames >= requiredFrames) {
            this.hz = hzFromSemitone(this.candidateSemitone);
            this.rawSemitones = [this.candidateSemitone];
            this.clearCandidate();
            accepted = this.voicedFrames >= 3;
            if (!accepted) rejectionReason = 'warm-up';
          } else {
            rejectionReason = isOctaveJump ? 'octave-transition' : 'large-jump-transition';
          }
        }
      }
      this.lastTimestampMs = timestampMs;

      return {
        ...estimate,
        hz: this.hz,
        displayHz: this.hz,
        rawHz,
        rawSemitone,
        stable: this.voicedFrames >= 3,
        accepted,
        rejectionReason,
        candidateFrames: this.candidateFrames,
        confidence: accepted ? Math.max(0, Math.min(1, estimate.confidence * this.stableFactor())) : 0,
      };
    }

    medianSemitone() {
      const values = [...this.rawSemitones].sort((a, b) => a - b);
      // For the short start-up window use the newest value. Once the window is
      // full, a true median rejects a one-frame octave spike.
      if (values.length < this.medianWindowFrames) return this.rawSemitones.at(-1);
      return values[Math.floor(values.length / 2)];
    }

    smoothSemitone(previous, next) {
      const alpha = this.voicedFrames <= 2 ? this.fastAlpha : this.slowAlpha;
      return previous * (1 - alpha) + next * alpha;
    }

    updateCandidate(semitone) {
      if (this.candidateSemitone != null
        && Math.abs((semitone - this.candidateSemitone) * 100) <= this.candidateConsistencyCents) {
        this.candidateSemitone = (this.candidateSemitone * this.candidateFrames + semitone)
          / (this.candidateFrames + 1);
        this.candidateFrames += 1;
      } else {
        this.candidateSemitone = semitone;
        this.candidateFrames = 1;
      }
    }

    clearCandidate() {
      this.candidateSemitone = null;
      this.candidateFrames = 0;
    }

    stableFactor() {
      return Math.min(1, this.voicedFrames / 3);
    }
  }

  // Experimental offline tracker for benchmark comparison. It deliberately
  // receives exactly the same raw YIN estimates as v1: it only changes the
  // temporal decision, never consults the score.
  class OctaveAwarePitchTracker {
    constructor({
      minClarity = 0.45,
      initialFrames = 3,
      holdPriorMs = 220,
      smallJumpCents = 320,
      largeJumpConfirmFrames = 3,
      octaveCenterCents = 1200,
      octaveToleranceCents = 230,
      octaveConfirmFrames = 6,
      candidateConsistencyCents = 110,
      smoothingAlpha = 0.35,
    } = {}) {
      Object.assign(this, { minClarity, initialFrames, holdPriorMs, smallJumpCents, largeJumpConfirmFrames, octaveCenterCents, octaveToleranceCents, octaveConfirmFrames, candidateConsistencyCents, smoothingAlpha });
      this.reset();
    }

    reset() {
      this.hz = null;
      this.lastReliableTimestampMs = null;
      this.startCandidate = null;
      this.startFrames = 0;
      this.transitionCandidate = null;
      this.transitionFrames = 0;
    }

    clearTransition() {
      this.transitionCandidate = null;
      this.transitionFrames = 0;
    }

    collectCandidate(hz) {
      if (this.transitionCandidate != null
        && Math.abs(centsBetween(hz, this.transitionCandidate)) <= this.candidateConsistencyCents) {
        this.transitionCandidate = (this.transitionCandidate * this.transitionFrames + hz) / (this.transitionFrames + 1);
        this.transitionFrames += 1;
      } else {
        this.transitionCandidate = hz;
        this.transitionFrames = 1;
      }
    }

    update(estimate, timestampMs) {
      const rawHz = estimate.hz;
      const reliable = Number.isFinite(rawHz) && rawHz >= MIN_HZ && rawHz <= MAX_HZ
        && (estimate.clarity ?? 0) >= this.minClarity;
      const gapMs = this.lastReliableTimestampMs == null ? Infinity : timestampMs - this.lastReliableTimestampMs;
      if (!reliable) {
        if (gapMs > this.holdPriorMs) { this.hz = null; this.startCandidate = null; this.startFrames = 0; this.clearTransition(); }
        return { ...estimate, hz: this.hz, accepted: false, rejectionReason: 'unvoiced' };
      }
      this.lastReliableTimestampMs = timestampMs;
      if (this.hz == null || gapMs > this.holdPriorMs) {
        if (this.startCandidate != null && Math.abs(centsBetween(rawHz, this.startCandidate)) <= this.candidateConsistencyCents) {
          this.startCandidate = (this.startCandidate * this.startFrames + rawHz) / (this.startFrames + 1);
          this.startFrames += 1;
        } else { this.startCandidate = rawHz; this.startFrames = 1; }
        if (this.startFrames < this.initialFrames) return { ...estimate, hz: null, accepted: false, rejectionReason: 'warm-up' };
        this.hz = this.startCandidate;
        this.startCandidate = null; this.startFrames = 0; this.clearTransition();
        return { ...estimate, hz: this.hz, accepted: true, rejectionReason: null };
      }

      const deltaCents = centsBetween(rawHz, this.hz);
      const octaveLike = Math.abs(Math.abs(deltaCents) - this.octaveCenterCents) <= this.octaveToleranceCents;
      const jumpLimit = octaveLike ? this.octaveConfirmFrames : this.largeJumpConfirmFrames;
      if (Math.abs(deltaCents) > this.smallJumpCents) {
        this.collectCandidate(rawHz);
        if (this.transitionFrames < jumpLimit) {
          return { ...estimate, hz: this.hz, accepted: true, rejectionReason: octaveLike ? 'octave-held' : 'large-jump-held' };
        }
        this.hz = this.transitionCandidate;
        this.clearTransition();
        return { ...estimate, hz: this.hz, accepted: true, rejectionReason: null };
      }

      this.clearTransition();
      const previousSemitone = semitoneIndex(this.hz);
      const nextSemitone = semitoneIndex(rawHz);
      this.hz = hzFromSemitone(previousSemitone * (1 - this.smoothingAlpha) + nextSemitone * this.smoothingAlpha);
      return { ...estimate, hz: this.hz, accepted: true, rejectionReason: null };
    }
  }

  global.ChoirPitch = {
    MIN_HZ,
    MAX_HZ,
    centsBetween,
    detectPitch,
    yinCandidates,
    decodeYinCandidatePath,
    mpmCandidates,
    decodeCrepeProbabilities,
    PitchSmoother,
    OctaveAwarePitchTracker,
    rmsOf,
  };
})(window);
