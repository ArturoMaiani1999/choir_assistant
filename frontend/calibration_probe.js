(() => {
  'use strict';
  const cache = new WeakMap();
  async function load(context) {
    if (cache.has(context)) return cache.get(context);
    // Restore the exact independent broadband signals used before the musical
    // experiment. Matching RMS alone did not validate native AEC adaptation.
    // The output gain is applied by the caller, once, at the current app volume.
    const promise = Promise.resolve().then(() => [173, 957].map(seed => {
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      buffer.copyToChannel(window.ChoirEchoCancellation.noise(buffer.length, .08, seed), 0);
      return buffer;
    }));
    cache.set(context, promise);
    try { return await promise; }
    catch (error) { cache.delete(context); throw error; }
  }
  window.ChoirCalibrationProbe = Object.freeze({ load, id: 'broadband-noise-v1' });
})();
