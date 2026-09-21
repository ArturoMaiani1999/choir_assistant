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
  function detectPitch(buffer, sampleRate) {
    const rms = rmsOf(buffer);
    if (rms < 0.001) return { hz: null, rms, clarity: 0, confidence: 0 };

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
    for (let tau = tauMin; tau < tauMax; tau += 1) {
      if (cmnd[tau] < YIN_THRESHOLD) {
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
    const levelConfidence = Math.max(0, Math.min(1, rms / 0.08));
    return {
      hz,
      rms,
      clarity,
      confidence: clarity * levelConfidence,
    };
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
      this.hz = null;
      this.voicedFrames = 0;
      this.unvoicedFrames = 0;
      this.lastTimestampMs = null;
      this.rawSemitones = [];
      this.candidateSemitone = null;
      this.candidateFrames = 0;
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

  global.ChoirPitch = {
    MIN_HZ,
    MAX_HZ,
    centsBetween,
    detectPitch,
    PitchSmoother,
    rmsOf,
  };
})(window);
