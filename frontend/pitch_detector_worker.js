'use strict';

// pitch_detector.js exposes its API on window in the browser. A dedicated
// worker has the same global capabilities under `self`, so provide the alias
// before loading the unchanged detector module.
self.window = self;
importScripts('pitch_detector.js?v=20261003-weak-voice');

self.onmessage = ({ data }) => {
  const startedAt = performance.now();
  let estimate = null;
  let error = null;
  try {
    estimate = self.ChoirPitch.detectPitch(
      new Float32Array(data.buffer),
      data.sampleRate,
      data.settings,
    );
  } catch (caught) {
    error = caught?.message || String(caught);
  }
  self.postMessage({
    buffer: data.buffer,
    estimate,
    error,
    beat: data.beat,
    sampledAt: data.sampledAt,
    running: data.running,
    generation: data.generation,
    analysisMs: performance.now() - startedAt,
  }, [data.buffer]);
};
