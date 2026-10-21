(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChoirEchoCancellation = api;
})(globalThis, function() {
  'use strict';
  const STAGES = Object.freeze([
    { start: 0, end: 4, title: 'Resta in silenzio', hint: 'Tra poco sentirai un fruscio. Non cantare.' },
    { start: 4, end: 10, title: 'Ascolta senza cantare', hint: 'Misuriamo il percorso dalle casse al microfono.' },
    { start: 10, end: 11, title: 'Ancora silenzio', hint: 'Misuriamo la coda del suono.' },
    { start: 11, end: 13, title: 'Verifica del rientro', hint: 'Un secondo fruscio. Continua a non cantare.' },
    { start: 13, end: 14, title: 'Ultimo silenzio', hint: 'Il controllo sta per terminare.' },
  ]);
  const DURATION = 14, MAX_TAIL_SEC = .75, TTL = 10 * 60_000;
  function fft(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let size = 2; size <= n; size *= 2) {
      const angle = (inverse ? 2 : -2) * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let offset = 0; offset < n; offset += size) {
        let ar = 1, ai = 0;
        for (let j = 0; j < size / 2; j++) {
          const a = offset + j, b = a + size / 2, br = re[b] * ar - im[b] * ai, bi = re[b] * ai + im[b] * ar;
          re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
          const next = ar * wr - ai * wi; ai = ar * wi + ai * wr; ar = next;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  const sizeFor = length => 2 ** Math.ceil(Math.log2(Math.max(2, length)));
  function spectrum(input, n) {
    const re = new Float64Array(n), im = new Float64Array(n); re.set(input); fft(re, im); return { re, im };
  }
  function convolve(input, impulse) {
    const n = sizeFor(input.length + impulse.length - 1), x = spectrum(input, n), h = spectrum(impulse, n);
    for (let i = 0; i < n; i++) {
      const real = x.re[i] * h.re[i] - x.im[i] * h.im[i];
      x.im[i] = x.re[i] * h.im[i] + x.im[i] * h.re[i]; x.re[i] = real;
    }
    fft(x.re, x.im, true); return x.re.slice(0, input.length);
  }
  function noise(length, amplitude, seed = 173) {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const fade = Math.min(1, i / 512, (length - i - 1) / 512);
      out[i] = ((seed >>> 0) / 2147483648 - 1) * amplitude * fade;
    }
    return out;
  }
  function reduction(input, prediction) {
    let before = 0, after = 0;
    for (let i = 0; i < input.length; i++) { before += input[i] ** 2; after += (input[i] - prediction[i]) ** 2; }
    return 10 * Math.log10(Math.max(1e-20, before) / Math.max(1e-20, after));
  }
  // Estimate ONLY a scalar on the already identified echo, never a new H.
  // Narrow-band output is unidentifiable: a same-F0 singer can look exactly
  // like a speaker-volume change. Require broadband excitation, agreement
  // across bands, and a small residual on a separate half-window.
  function gainObservation(prediction, microphone, sampleRate, noiseRms = 0) {
    const refuse = reason => ({ usable: false, reason });
    if (prediction.length !== 8192 || microphone.length !== 8192
      || !prediction.every(Number.isFinite) || !microphone.every(Number.isFinite)
      || ![32000, 44100, 48000, 96000].includes(sampleRate)) return refuse('capture');
    if (microphone.some(v => Math.abs(v) >= .98)) return refuse('clipping');
    function half(from) {
      const p = new Float64Array(4096), y = new Float64Array(4096);
      let pp = 0;
      for (let i = 0; i < p.length; i++) {
        const weight = .5 - .5 * Math.cos(2 * Math.PI * i / (p.length - 1));
        p[i] = prediction[from + i] * weight; y[i] = microphone[from + i] * weight;
        pp += p[i] ** 2;
      }
      if (pp / p.length < 1e-8) return refuse('weak');
      const x = spectrum(p, p.length), z = spectrum(y, y.length);
      // A harmonic-rich vowel may occupy many bands while remaining periodic.
      // Refuse it too: broadband energy alone is not proof of identifiability.
      const autoRe = Float64Array.from(x.re, (v, i) => v * v + x.im[i] ** 2), autoIm = new Float64Array(p.length);
      fft(autoRe, autoIm, true);
      for (let lag = Math.floor(sampleRate / 1000); lag <= Math.ceil(sampleRate / 70); lag++) {
        if (autoRe[lag] > autoRe[0] * .65) return refuse('narrow');
      }
      const bands = Array.from({ length: 6 }, () => ({ p: 0, y: 0, cross: 0, imaginary: 0 }));
      let total = 0, largest = 0;
      for (let k = Math.ceil(150 * p.length / sampleRate); k < p.length / 2; k++) {
        const frequency = k * sampleRate / p.length;
        if (frequency >= 9600) break;
        const band = bands[Math.floor(Math.log2(frequency / 150))];
        const power = x.re[k] ** 2 + x.im[k] ** 2;
        band.p += power; band.y += z.re[k] ** 2 + z.im[k] ** 2;
        band.cross += x.re[k] * z.re[k] + x.im[k] * z.im[k];
        band.imaginary += x.re[k] * z.im[k] - x.im[k] * z.re[k];
        total += power; largest = Math.max(largest, power);
      }
      const active = bands.filter(b => b.p > total * .003);
      if (active.length < 5 || largest > total * .12) return refuse('narrow');
      const gains = active.map(b => b.cross / b.p).sort((a, b) => a - b);
      const gain = gains[Math.floor(gains.length / 2)];
      if (!Number.isFinite(gain) || gain < .125 || gain > 8) return refuse('range');
      for (const b of active) {
        if (Math.abs(b.cross / b.p / gain - 1) > .025
          || Math.abs(b.imaginary) > .03 * gain * b.p) return refuse('double-talk-or-path');
      }
      let error = 0;
      for (let i = 0; i < p.length; i++) error += (y[i] - gain * p[i]) ** 2;
      // Account for the Hann window without giving a weak voice an arbitrary
      // absolute exemption. Room noise comes from the quiet calibration phase.
      const allowance = Math.min(pp * gain ** 2 * .05 ** 2,
        Math.max(pp * gain ** 2 * .025 ** 2, p.length * .375 * (noiseRms * 2) ** 2, 1e-14));
      if (error > allowance) return refuse('double-talk-or-path');
      return { usable: true, gain, residualRatio: Math.sqrt(error / (pp * gain ** 2)) };
    }
    const train = half(0); if (!train.usable) return train;
    const validation = half(4096); if (!validation.usable) return validation;
    if (Math.abs(train.gain / validation.gain - 1) > .02) return refuse('changing');
    return { usable: true, gain: train.gain, validationGain: validation.gain,
      residualRatio: Math.max(train.residualRatio, validation.residualRatio) };
  }
  class GainFollower {
    constructor(gain = 1) { this.gain = gain; this.reset(); }
    reset() { this.candidate = null; this.frames = 0; this.lastEnd = null; }
    observe(observation, endTime) {
      if (!Number.isFinite(endTime) || (this.lastEnd != null && (endTime <= this.lastEnd || endTime - this.lastEnd > .8))) this.reset();
      this.lastEnd = endTime;
      if (!observation.usable) { this.candidate = null; this.frames = 0; return { changed: false, pending: false, gain: this.gain }; }
      const value = observation.gain;
      if (Math.abs(value / this.gain - 1) < .02) { this.candidate = null; this.frames = 0; return { changed: false, pending: false, gain: this.gain }; }
      if (this.candidate == null || Math.abs(value / this.candidate - 1) > .025) { this.candidate = value; this.frames = 1; }
      else { this.candidate = (this.candidate * this.frames + value) / (this.frames + 1); this.frames++; }
      if (this.frames < 3) return { changed: false, pending: true, gain: this.gain };
      this.gain = this.candidate; this.candidate = null; this.frames = 0;
      return { changed: true, pending: false, gain: this.gain };
    }
  }
  function fit(reference, microphone, sampleRate, compact = false) {
    const fail = reason => ({ usable: false, reason });
    const expected = Math.round(sampleRate * (compact ? 10 : DURATION));
    if (![32000, 44100, 48000, 96000].includes(sampleRate) || reference.length !== expected || microphone.length !== expected
      || !reference.every(Number.isFinite) || !microphone.every(Number.isFinite)) return fail('capture');
    if (microphone.some(v => Math.abs(v) >= .98)) return fail('clipping');
    // Complete excitation + a full second of decay. Hold-out never contributes
    // to estimating H. Preparation is not used to identify the acoustic path.
    const from = Math.round((compact ? 3 : 4) * sampleRate), to = Math.round((compact ? 7 : 11) * sampleRate);
    const trainX = reference.slice(from, to), trainY = microphone.slice(from, to);
    const n = sizeFor(trainX.length), x = spectrum(trainX, n), y = spectrum(trainY, n);
    let power = 0, micPower = 0;
    for (let i = 0; i < trainX.length; i++) { power += trainX[i] ** 2; micPower += trainY[i] ** 2; }
    if (power / trainX.length < 1e-7 || micPower / trainY.length < 1e-9) return fail('weak');
    const ridge = power * .002;
    for (let i = 0; i < n; i++) {
      const denominator = x.re[i] ** 2 + x.im[i] ** 2 + ridge;
      const real = (y.re[i] * x.re[i] + y.im[i] * x.im[i]) / denominator;
      y.im[i] = (y.im[i] * x.re[i] - y.re[i] * x.im[i]) / denominator; y.re[i] = real;
    }
    fft(y.re, y.im, true);
    const impulse = Float32Array.from(y.re.slice(0, Math.ceil(sampleRate * MAX_TAIL_SEC)));
    const testX = reference.slice(to), testY = microphone.slice(to);
    const trainDb = reduction(trainY, convolve(trainX, impulse)), validationDb = reduction(testY, convolve(testX, impulse));
    let peak = 0;
    for (let i = 1; i < impulse.length; i++) if (Math.abs(impulse[i]) > Math.abs(impulse[peak])) peak = i;
    const usable = Number.isFinite(trainDb) && Number.isFinite(validationDb) && trainDb >= 15 && validationDb >= 12;
    let quietEnergy = 0;
    const quietFrom = Math.round(sampleRate * (compact ? 1 : 2)), quietTo = Math.round(sampleRate * (compact ? 2.5 : 3.5));
    for (let i = quietFrom; i < quietTo; i++) quietEnergy += microphone[i] ** 2;
    return { usable, reason: usable ? null : 'validation', impulse: usable ? impulse : null,
      trainDb, validationDb, noiseRms: Math.sqrt(quietEnergy / (quietTo - quietFrom)), peakDelayMs: peak / sampleRate * 1000, sampleRate };
  }
  // Compact calibration only. Inspect training excitation, never the holdout.
  // Signed echo paths are valid: compare absolute normalized correlation.
  function trainingStability(reference, microphone, sampleRate) {
    if (![32000, 44100, 48000, 96000].includes(sampleRate)
      || reference.length !== sampleRate * 10 || microphone.length !== reference.length)
      return { unstable: false, observations: [] };
    const length = Math.round(.15 * sampleRate), maxLag = Math.round(.3 * sampleRate);
    const n = sizeFor(length * 2 + maxLag), observations = [];
    for (let step = 0; step < 9; step++) {
      const start = Math.round((3.1 + step * .3) * sampleRate);
      const x = reference.subarray(start, start + length);
      const y = microphone.subarray(start, start + length + maxLag);
      let xx = 0;
      for (const v of x) xx += v * v;
      if (xx < 1e-10) continue;
      const a = spectrum(x, n), b = spectrum(y, n), energy = new Float64Array(y.length + 1);
      for (let i = 0; i < y.length; i++) energy[i + 1] = energy[i] + y[i] * y[i];
      for (let i = 0; i < n; i++) {
        const real = a.re[i] * b.re[i] + a.im[i] * b.im[i];
        b.im[i] = a.re[i] * b.im[i] - a.im[i] * b.re[i]; b.re[i] = real;
      }
      fft(b.re, b.im, true);
      let best = 0, lag = 0;
      for (let i = 0; i <= maxLag; i++) {
        const correlation = Math.abs(b.re[i]) / Math.sqrt(Math.max(1e-30, xx * (energy[i + length] - energy[i])));
        if (correlation > best) { best = correlation; lag = i; }
      }
      if (best >= .2 && lag > 0 && lag < maxLag)
        observations.push({ timeSec: start / sampleRate, delayMs: lag / sampleRate * 1000, correlation: best });
    }
    // Two consecutive observations in each regime prevent one spurious peak
    // from triggering a new audible measurement. A failed fit still fails.
    const plateaus = [];
    for (let i = 1; i < observations.length; i++) {
      const a = observations[i - 1], b = observations[i];
      if (b.timeSec - a.timeSec < .31 && Math.abs(a.delayMs - b.delayMs) < .5)
        plateaus.push((a.delayMs + b.delayMs) / 2);
    }
    return { unstable: plateaus.length > 1 && Math.max(...plateaus) - Math.min(...plateaus) > 2, observations };
  }
  return Object.freeze({ STAGES, DURATION, TTL, MAX_TAIL_SEC, fit, convolve, noise, reduction, gainObservation, GainFollower, fft, trainingStability });
});
