// Browser-local pitch detector module.
// The public API is deliberately independent from the page so it can later
// move behind an AudioWorklet/WASM adapter without changing scoring code.
(function exposeChoirPitch(global) {
  const MIN_HZ = 70;
  const MAX_HZ = 1000;
  const YIN_THRESHOLD = 0.28;

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
    if (rms < 0.004) return { hz: null, rms, clarity: 0, confidence: 0 };

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
    constructor({ releaseFrames = 3, fastAlpha = 0.65, slowAlpha = 0.3 } = {}) {
      this.releaseFrames = releaseFrames;
      this.fastAlpha = fastAlpha;
      this.slowAlpha = slowAlpha;
      this.hz = null;
      this.voicedFrames = 0;
      this.unvoicedFrames = 0;
      this.lastTimestampMs = null;
    }

    reset() {
      this.hz = null;
      this.voicedFrames = 0;
      this.unvoicedFrames = 0;
      this.lastTimestampMs = null;
    }

    update(estimate, timestampMs) {
      if (estimate.hz == null) {
        this.unvoicedFrames += 1;
        this.voicedFrames = 0;
        if (this.unvoicedFrames >= this.releaseFrames) this.hz = null;
        this.lastTimestampMs = timestampMs;
        return {
          ...estimate,
          hz: this.hz,
          stable: false,
          confidence: 0,
        };
      }

      this.unvoicedFrames = 0;
      this.voicedFrames += 1;
      const previous = this.hz;
      if (previous == null) {
        this.hz = estimate.hz;
      } else {
        const alpha = this.voicedFrames <= 2 ? this.fastAlpha : this.slowAlpha;
        const smoothedSemitone = semitoneIndex(previous) * (1 - alpha)
          + semitoneIndex(estimate.hz) * alpha;
        this.hz = hzFromSemitone(smoothedSemitone);
      }
      this.lastTimestampMs = timestampMs;

      return {
        ...estimate,
        hz: this.hz,
        rawHz: estimate.hz,
        stable: this.voicedFrames >= 3,
        confidence: Math.max(0, Math.min(1, estimate.confidence * (this.stableFactor()))),
      };
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
