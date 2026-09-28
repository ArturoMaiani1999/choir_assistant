// Pure One Euro filter implementation. Time is expressed in seconds.
(function exposeOneEuro(global) {
  'use strict';

  function smoothingFactor(dt, cutoff) {
    const safeDt = Math.max(1e-6, dt);
    const tau = 1 / (2 * Math.PI * Math.max(1e-6, cutoff));
    return 1 / (1 + tau / safeDt);
  }

  class LowPassFilter {
    constructor() { this.value = null; }
    reset() { this.value = null; }
    filter(value, alpha) {
      this.value = this.value == null ? value : alpha * value + (1 - alpha) * this.value;
      return this.value;
    }
  }

  class OneEuroFilter {
    constructor({ minCutoff = .05, beta = 100, dCutoff = .2, snapThreshold = .01 } = {}) {
      Object.assign(this, { minCutoff, beta, dCutoff, snapThreshold });
      this.signal = new LowPassFilter();
      this.derivative = new LowPassFilter();
      this.lastRaw = null;
      this.lastTimeSec = null;
    }

    reset() {
      this.signal.reset(); this.derivative.reset();
      this.lastRaw = null; this.lastTimeSec = null;
    }

    filter(value, timeSec) {
      if (!Number.isFinite(value) || !Number.isFinite(timeSec)) { this.reset(); return null; }
      if (this.lastTimeSec == null || timeSec <= this.lastTimeSec) {
        this.reset(); this.lastRaw = value; this.lastTimeSec = timeSec;
        return this.signal.filter(value, 1);
      }
      const dt = timeSec - this.lastTimeSec;
      // Pitch uses MIDI-semitone units. A movement of at least one cent is a
      // deliberate trajectory, not stationary jitter: pass it through exactly
      // and restart so the display never adds transition latency.
      if (Math.abs(value - this.lastRaw) >= this.snapThreshold) {
        this.reset(); this.lastRaw = value; this.lastTimeSec = timeSec;
        return this.signal.filter(value, 1);
      }
      const rawDerivative = (value - this.lastRaw) / dt;
      const filteredDerivative = this.derivative.filter(rawDerivative, smoothingFactor(dt, this.dCutoff));
      const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
      const filtered = this.signal.filter(value, smoothingFactor(dt, cutoff));
      this.lastRaw = value; this.lastTimeSec = timeSec;
      return filtered;
    }
  }

  global.ChoirOneEuro = { OneEuroFilter, smoothingFactor };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ChoirOneEuro;
})(typeof window !== 'undefined' ? window : globalThis);
